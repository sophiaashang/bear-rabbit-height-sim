// 公主抱（princess）：S 的双臂按手工摆好的参数固化。
//   对比结果：参考身高 T=1.86 / S=1.65 时，参考参数里 T 全部参数、S 的盆骨/朝向/腿/头都和原来的自动生成器一模一样，
//   只有 S 的两条手臂（hL、hR 目标和 armPoleL 肘朝向）是手工调过的。所以这里不重写身体：
//   身体照旧交给 poses_c.js 的 princess 按身高求解（已验证过各种身高），只把 S 的双臂换成参考姿势的样子。
//   参考身高下与原始参数逐字段一致（不做任何清洗，不修穿模）。
//   换身高：S 双手目标是落在 T 脖子/肩背附近的点，相对 T 盆骨按 kT 缩放跟着 T 走，超出臂长 96% 时收回；肘朝向（armPole）是方向，原样沿用。
//   换了身高后若 S 的手臂碰到 T / 自己躯干 / 另一只手臂超过容差，才在目标周围做一次小范围局部搜索（三档步长 4/2/1cm，带偏离惩罚），
//   原样不超容差的不动。参考身高下不走这一步。
import { fk, penetration } from './model.js';
import { princess as princessBody } from './poses_c.js';

const REF = { T: 1.86, S: 1.65 };
const TP_REF = [0, 0.837, 0];                       // 参考姿势的 T 盆骨位置
const ARMS = {                                      // 参考姿势的 S 双臂
  hL: [-0.0763, 1.4741, 0.0712], hR: [-0.0006, 1.3371, -0.1956],
  armPoleL: [0.8334, -0.494, -0.2479], armPoleR: [-0.7653, 0.6218, -0.1664],
};
const ARM = { L: ['uaL', 'faL', 'hdL'], R: ['uaR', 'faR', 'hdR'] };
// 点 q 以 a 为锚缩放 k，再把锚平移到 b
const map = (q, a, b, k) => [b[0] + k * (q[0] - a[0]), b[1] + k * (q[1] - a[1]), b[2] + k * (q[2] - a[2])];
// 目标超出臂长 96% 时收回
const clampReach = (t, sh, reach) => {
  const dx = t[0] - sh.x, dy = t[1] - sh.y, dz = t[2] - sh.z, L = Math.hypot(dx, dy, dz);
  return L > reach ? [sh.x + (dx * reach) / L, sh.y + (dy * reach) / L, sh.z + (dz * reach) / L] : t;
};
// 一只手臂的惩罚：碰 T 超过 2cm、碰自己躯干/头/另一只手臂超过 1.5cm、够不着
const armScore = (S, dS, JT, side) => {
  const J = fk(S, dS), names = new Set(ARM[side]);
  const lim = { parts: J.parts.filter((q) => names.has(q.n)) };
  const toT = penetration(lim, JT).depth;
  const self = penetration(lim, J, (a, b) => b.own === 'torso' || b.own === 'head' || (!names.has(b.n) && ['ua', 'fa', 'hd'].includes(b.own))).depth;
  return Math.max(0, toT - 0.02) * 6 + Math.max(0, self - 0.015) * 6 + (J.miss['h' + side] || 0) * 25;
};

export const princess = (dT, dS) => {
  const r = princessBody(dT, dS);
  const S = {};
  for (const k of Object.keys(r.S)) S[k] = r.S[k].slice();
  const kT = dT.h / REF.T, kS = dS.h / REF.S;
  S.armPoleL = ARMS.armPoleL.slice(); S.armPoleR = ARMS.armPoleR.slice();
  S.hL = ARMS.hL.slice(); S.hR = ARMS.hR.slice();
  if (Math.abs(kT - 1) > 1e-6 || Math.abs(kS - 1) > 1e-6) {
    const JT = fk(r.T, dT), reach = (dS.upper + dS.fore) * 0.96;
    for (const side of ['L', 'R']) {
      const key = 'h' + side, sh = fk(S, dS)['sh' + side];
      const base = clampReach(map(ARMS[key], TP_REF, r.T.p, kT), sh, reach);
      S[key] = base.slice();
      let bs = armScore(S, dS, JT, side);
      if (bs <= 1e-9) continue;                                 // 原样不超容差，不动
      let best = base.slice();
      for (const step of [0.04, 0.02, 0.01]) {
        const c0 = best.slice();
        for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) for (const dz of [-1, 0, 1]) {
          const c = clampReach([c0[0] + dx * step, c0[1] + dy * step, c0[2] + dz * step], sh, reach);
          S[key] = c;
          const sc = armScore(S, dS, JT, side) + Math.hypot(c[0] - base[0], c[1] - base[1], c[2] - base[2]) * 0.05;
          if (sc < bs - 1e-9) { bs = sc; best = c; }
        }
      }
      S[key] = best;
    }
  }
  return { ...r, S };
};
