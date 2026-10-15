// 求婚（propose）：按手工摆好的参数固化（不再自动搜索）。
//   T（熊）面朝 +x 单膝跪地，双手托戒指盒；S（兔）站在他前方（+x）面朝 -x，双手捂嘴。
//   参考身高 T=1.86 / S=1.65（摆姿势时的身高；S=1.65 时 S 的手脚 miss 只剩 0.1cm，1.63 时是 0.9cm）时就是参考姿势的样子，只有两类画面等价/最小修正：
//     ①T 左手目标原本比够得着的远 40.7cm、S 两脚目标差 0.12cm：手脚目标换成 fk 实际到达点（画面不变）；
//     ②T 整体刚性抬 LIFT（原最低点入地 4.2cm），戒指盒跟着 T 一起抬。S 不动。
//   换身高：T 以脚下 (T.p.x,0,T.p.z) 为锚等比缩放 p/hL/hR/fL/fR；S 水平站位 = T 的水平偏移 × 两人缩放均值，
//   盆骨高度按 kS（脚贴地），S 手脚相对 S 盆骨按 kS 落点；戒指盒 = T 两手中点 + 偏移×kT（跟着 T 的手）；
//   手目标超出臂长 96% 时收到 96%。
import { fk } from './model.js';

const REF = { T: 1.86, S: 1.65 };
const LIFT = 0.0419;                              // T 整体抬升（米）
const POSE = {
  T: {
    p: [-0.63, 0.4146, -0.2098], yaw: [1.5708], pitch: [0], roll: [0], twist: [0], lean: [0, 0], head: [-0.25, 0, 0],
    hL: [-0.0751, 0.9839, -0.2164], hR: [-0.1267, 0.9559, -0.0302], fL: [-0.2416, 0.0568, -0.2324], fR: [-1.0552, 0.103, -0.0957],
    armPoleL: [0.6027, -0.7886, 0.1219], armPoleR: [-0.4949, -0.8688, -0.0154], kneePoleL: [0, 0.716, 0.6981], kneePoleR: [-0.0379, -0.8123, 0.582], eyes: [1],
  },
  S: {
    p: [0.5796, 0.7425, 0], yaw: [-1.5708], pitch: [0], roll: [0], twist: [0], lean: [0, 0.16], head: [0.12, 0, 0],
    hL: [0.2735, 1.3804, 0.0507], hR: [0.2735, 1.3905, -0.0507], fL: [0.5467, 0.0606, 0.0832], fR: [0.5467, 0.0606, -0.0832],
    armPoleL: [0.2531, -0.7258, 0.6396], armPoleR: [-0.2473, -0.7062, 0.6634], kneePoleL: [0, 0, 1], kneePoleR: [0, 0, 1], eyes: [1],
  },
};
const BOX = [-0.0785, 0.944, -0.1583];            // 参考姿势里戒指盒的世界位置（未抬升）
const LOOSE = ['hd', 'fa', 'ua', 'head', 'ear', 'torso', 'th', 'sh'];
const fresh = (o) => { const s = {}; for (const k of Object.keys(o)) s[k] = o[k].slice(); return s; };
const lift = (q, dy) => [q[0], q[1] + dy, q[2]];
// 点 q 以 a 为锚缩放 k，再把锚平移到 b
const map = (q, a, b, k) => [b[0] + k * (q[0] - a[0]), b[1] + k * (q[1] - a[1]), b[2] + k * (q[2] - a[2])];
// 目标超出臂长 96% 时收回
const clampReach = (t, sh, reach) => {
  const dx = t[0] - sh.x, dy = t[1] - sh.y, dz = t[2] - sh.z, L = Math.hypot(dx, dy, dz);
  return L > reach ? [sh.x + (dx * reach) / L, sh.y + (dy * reach) / L, sh.z + (dz * reach) / L] : t;
};

export const propose = (dT, dS) => {
  const T = fresh(POSE.T), S = fresh(POSE.S);
  // ① T 整体刚性抬到贴地（p/手/脚一起抬），戒指盒同抬
  for (const key of ['p', 'hL', 'hR', 'fL', 'fR']) T[key] = lift(T[key], LIFT);
  let box = lift(BOX, LIFT);
  const kT = dT.h / REF.T, kS = dS.h / REF.S;
  if (Math.abs(kT - 1) > 1e-6 || Math.abs(kS - 1) > 1e-6) {
    const tp = T.p.slice(), sp = POSE.S.p;
    const aT = [tp[0], 0, tp[2]];
    const mid0 = [(T.hL[0] + T.hR[0]) / 2, (T.hL[1] + T.hR[1]) / 2, (T.hL[2] + T.hR[2]) / 2];
    const boxRel = [box[0] - mid0[0], box[1] - mid0[1], box[2] - mid0[2]];
    // T：脚下为锚，整体按 kT 缩放
    for (const key of ['p', 'hL', 'hR', 'fL', 'fR']) T[key] = map(T[key], aT, aT, kT);
    // S：水平站位 = T 的水平偏移 × 两人缩放均值；盆骨高度按 kS（脚贴地）
    const km = (kT + kS) / 2;
    S.p = [aT[0] + km * (sp[0] - aT[0]), kS * sp[1], aT[2] + km * (sp[2] - aT[2])];
    for (const key of ['hL', 'hR', 'fL', 'fR']) S[key] = map(POSE.S[key], sp, S.p, kS);
    const JT = fk(T, dT), JS = fk(S, dS);
    for (const [key, sh] of [['hL', JT.shL], ['hR', JT.shR]]) T[key] = clampReach(T[key], sh, (dT.upper + dT.fore) * 0.96);
    for (const [key, sh] of [['hL', JS.shL], ['hR', JS.shR]]) S[key] = clampReach(S[key], sh, (dS.upper + dS.fore) * 0.96);
    // 戒指盒跟 T 两手中点：偏移 × kT
    const mid = [(T.hL[0] + T.hR[0]) / 2, (T.hL[1] + T.hR[1]) / 2, (T.hL[2] + T.hR[2]) / 2];
    box = [mid[0] + kT * boxRel[0], mid[1] + kT * boxRel[1], mid[2] + kT * boxRel[2]];
  }
  const props = [{ type: 'ringBox', at: [box[0], box[1], box[2]], ry: 0 }];
  return { T, S, props, loose: LOOSE, skipAuto: ['T', 'S'], noAuto: true, noNat: true, hold: [], elbowWorld: ['T', 'S'], cam: { el: 0.14 } };
};
