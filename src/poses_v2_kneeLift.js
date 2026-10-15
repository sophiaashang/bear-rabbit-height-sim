// 托膝抱（kneeLift）：按手工摆好的参数固化。
//   T（熊）面朝 -x 站着，双臂从下面托住 S 的小腿；S（兔）被抱起，两腿并拢、小腿向后折得很深，双臂环 T 的肩背。
//   参考身高 T=1.86 / S=1.63（页面默认）时就是参考姿势的样子；不改站位、不改朝向、不修穿模。
//   换身高：T 以脚下为锚等比缩放；S 的盆骨跟着 T 走（相对 T 脚下按 T 的比例），腿按自己的身高缩放；
//   S 双手相对 T 盆骨按 T 的比例落点，T 双手相对 S 盆骨按 S 的比例落点，够不到时收到臂长 96%。
import { fk } from './model.js';

const REF = { T: 1.86, S: 1.63 };
const POSE = {
  T: {
    p: [0.4, 0.837, 0], yaw: [-1.5708], pitch: [0], roll: [0], twist: [0], lean: [0, -0.12], head: [-0.33, 0, 0],
    hL: [0.2131, 0.9215, 0.0976], hR: [0.2218, 0.9337, -0.1115], fL: [0.3628, 0.0837, 0.1257], fR: [0.3628, 0.0837, -0.1257],
    armPoleL: [0.4283, -0.2913, -0.8554], armPoleR: [-0.2873, -0.3259, -0.9007], kneePoleL: [0, 0, 1], kneePoleR: [0, 0, 1], eyes: [1],
  },
  S: {
    p: [0.2145, 1.328, 0], yaw: [1.5708], pitch: [0], roll: [0], twist: [0], lean: [0, 0], head: [0.45, 0, 0],
    hL: [0.5809, 1.4792, -0.2101], hR: [0.5928, 1.5028, 0.1618], fL: [-0.0722, 1.205, -0.1419], fR: [-0.1076, 1.1975, 0.0288],
    armPoleL: [0.6501, -0.4845, -0.5854], armPoleR: [-0.3976, -0.6622, -0.6351], kneePoleL: [-0.0615, -0.7448, 0.6645], kneePoleR: [0.0483, -0.8857, 0.4617], eyes: [1],
  },
};
const LOOSE = ['hd', 'fa', 'ua', 'head', 'ear', 'torso', 'th', 'sh'];
const fresh = (o) => { const s = {}; for (const k of Object.keys(o)) s[k] = o[k].slice(); return s; };
// 点 q 以 a 为锚缩放 k，再把锚平移到 b
const map = (q, a, b, k) => [b[0] + k * (q[0] - a[0]), b[1] + k * (q[1] - a[1]), b[2] + k * (q[2] - a[2])];
// 目标超出臂长 96% 时收回
const clampReach = (t, sh, reach) => {
  const dx = t[0] - sh.x, dy = t[1] - sh.y, dz = t[2] - sh.z, L = Math.hypot(dx, dy, dz);
  return L > reach ? [sh.x + (dx * reach) / L, sh.y + (dy * reach) / L, sh.z + (dz * reach) / L] : t;
};

export const kneeLift = (dT, dS) => {
  const T = fresh(POSE.T), S = fresh(POSE.S);
  const kT = dT.h / REF.T, kS = dS.h / REF.S;
  if (Math.abs(kT - 1) > 1e-6 || Math.abs(kS - 1) > 1e-6) {
    const tp = POSE.T.p, sp = POSE.S.p;
    const aT = [tp[0], 0, tp[2]];
    // T：脚下为锚，整体按 kT 缩放
    for (const key of ['p', 'hL', 'hR', 'fL', 'fR']) T[key] = map(POSE.T[key], aT, aT, kT);
    // S：盆骨相对 T 脚下按 kT 跟着走，自己的脚/手另算
    S.p = map(sp, aT, aT, kT);
    for (const key of ['fL', 'fR']) S[key] = map(POSE.S[key], sp, S.p, kS);
    // S 双手：相对 T 盆骨按 kT 落点（仍在 T 肩背上）
    for (const key of ['hL', 'hR']) S[key] = map(POSE.S[key], tp, T.p, kT);
    // T 双手：相对 S 盆骨按 kS 落点（仍托在 S 小腿下）
    for (const key of ['hL', 'hR']) T[key] = map(POSE.T[key], sp, S.p, kS);
    const JT = fk(T, dT), JS = fk(S, dS);
    for (const [key, sh] of [['hL', JT.shL], ['hR', JT.shR]]) T[key] = clampReach(T[key], sh, (dT.upper + dT.fore) * 0.96);
    for (const [key, sh] of [['hL', JS.shL], ['hR', JS.shR]]) S[key] = clampReach(S[key], sh, (dS.upper + dS.fore) * 0.96);
  }
  const hold = ['T.L', 'T.R', 'S.L', 'S.R'];
  return { T, S, loose: LOOSE, air: ['S'], elbowWorld: ['S'], carry: true, hold, skipAuto: ['T', 'S'], noAuto: true, noNat: true };
};
