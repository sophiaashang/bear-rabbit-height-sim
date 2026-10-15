// 暮光之境（角色卡构图）：按手工摆好的参数固化。
//   T（熊）靠坐在沙发上、身体后仰；S（兔）面对他、两膝分开跪坐在他腿上方，双手撑在他胸口，俯身向他。
//   参考身高 T=1.86 / S=1.63（页面默认）时就是参考姿势的样子，不改站位、不改朝向、不修穿模。
//   场景：参考姿势里带着一个隐藏的座位盒（上个姿势「坐他怀里」的残留，按 T 的坐高算的），沿用它当沙发座面，
//   画面上由「坐他怀里」同款的沙发/地毯/茶几/书架/落地灯代替（poses.js dressScene）。
//   换身高：T 以脚下为锚等比缩放（座位盒同步缩放）；S 盆骨水平位置跟 T 走、座面以上的高度按 S 的身高缩放，
//   S 的脚相对 S 盆骨缩放；S 双手相对 T 盆骨按 T 的比例落点，T 双手相对 S 盆骨按 S 的比例落点，够不到收到臂长 96%。
import { fk } from './model.js';

const REF = { T: 1.86, S: 1.63 };
const POSE = {
  T: {
    p: [-0.0627, 0.4412, 0.1172], yaw: [0], pitch: [0], roll: [0], twist: [0], lean: [0.154, -0.5824], head: [0.4386, 0.1187, 0.15],
    hL: [0.1938, 0.5915, 0.3019], hR: [-0.0071, 1.1397, 0.2788], fL: [0.3047, 0.0763, 0.4233], fR: [-0.3269, 0.0707, 0.4175],
    armPoleL: [-0.1805, -0.6372, -0.7492], armPoleR: [-0.738, -0.6633, -0.1236], kneePoleL: [0.3769, 0.6401, 0.6695], kneePoleR: [0.3525, 0.5705, 0.7418], eyes: [1],
  },
  S: {
    p: [-0.0641, 0.5409, 0.4074], yaw: [2.7851], pitch: [0], roll: [0], twist: [0.65], lean: [-0.1882, 0.4189], head: [-0.3792, -0.6664, 0],
    hL: [-0.2863, 0.8106, -0.0252], hR: [0.1698, 0.8203, 0.048], fL: [-0.5354, 0.309, 0.3628], fR: [0.4584, 0.2443, 0.2624],
    armPoleL: [0.5449, -0.6192, 0.5654], armPoleR: [-0.3785, -0.1171, -0.9181], kneePoleL: [0, 0.7269, 0.6867], kneePoleR: [0, 0.7269, 0.6867], eyes: [1],
  },
};
// 座位盒（参考身高下的世界坐标，只给检测和 dressScene 摆沙发用，画面上不画）
const SEAT = { c: [-0.27429, 0.188325, 0.019483], s: [0.46971, 0.188325, 0.261283], color: 14277859 };
const LOOSE = ['hd', 'fa', 'ua', 'head', 'ear', 'torso', 'th', 'sh'];
const fresh = (o) => { const s = {}; for (const k of Object.keys(o)) s[k] = o[k].slice(); return s; };
// 点 q 以 a 为锚缩放 k，再把锚平移到 b
const map = (q, a, b, k) => [b[0] + k * (q[0] - a[0]), b[1] + k * (q[1] - a[1]), b[2] + k * (q[2] - a[2])];
const clampReach = (t, sh, reach) => {
  const dx = t[0] - sh.x, dy = t[1] - sh.y, dz = t[2] - sh.z, L = Math.hypot(dx, dy, dz);
  return L > reach ? [sh.x + (dx * reach) / L, sh.y + (dy * reach) / L, sh.z + (dz * reach) / L] : t;
};
const r4 = (v) => Math.round(v * 10000) / 10000;

export const twilight = (dT, dS) => {
  const T = fresh(POSE.T), S = fresh(POSE.S);
  const kT = dT.h / REF.T, kS = dS.h / REF.S;
  const tp = POSE.T.p, sp = POSE.S.p, aT = [tp[0], 0, tp[2]];
  const seat = { c: SEAT.c.slice(), s: SEAT.s.slice() };
  if (Math.abs(kT - 1) > 1e-6 || Math.abs(kS - 1) > 1e-6) {
    for (const key of ['p', 'hL', 'hR', 'fL', 'fR']) T[key] = map(POSE.T[key], aT, aT, kT);
    seat.c = map(SEAT.c, aT, aT, kT); seat.s = SEAT.s.map((v) => v * kT);
    const top0 = SEAT.c[1] + SEAT.s[1], top = seat.c[1] + seat.s[1];
    const px = map(sp, aT, aT, kT);                             // S 盆骨水平位置跟 T
    S.p = [px[0], top + kS * (sp[1] - top0), px[2]];            // 座面以上的高度按 S 缩放
    for (const key of ['fL', 'fR']) S[key] = map(POSE.S[key], sp, S.p, kS);
    for (const key of ['hL', 'hR']) S[key] = map(POSE.S[key], tp, T.p, kT);
    for (const key of ['hL', 'hR']) T[key] = map(POSE.T[key], sp, S.p, kS);
    const JT = fk(T, dT), JS = fk(S, dS);
    for (const [key, sh] of [['hL', JT.shL], ['hR', JT.shR]]) T[key] = clampReach(T[key], sh, (dT.upper + dT.fore) * 0.96);
    for (const [key, sh] of [['hL', JS.shL], ['hR', JS.shR]]) S[key] = clampReach(S[key], sh, (dS.upper + dS.fore) * 0.96);
  }
  return {
    T, S,
    props: [{ type: 'box', c: seat.c.map(r4), s: seat.s.map(r4), color: SEAT.color, hidden: true }],
    loose: LOOSE, air: ['S'], elbowWorld: ['T', 'S'], skipAuto: ['T', 'S'], noAuto: true, noNat: true, groundOK: true,
  };
};
