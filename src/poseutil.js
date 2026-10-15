// 姿势构造工具：所有姿势都由「身体参数 + 接触目标点」生成，目标点取自对方的 FK 关节，所以随身高自适应。
import { V, blank, fk, groundMin, penetration, selfPen, sdf } from './model.js';

export const PI = Math.PI;
export const rotY = (yaw, x, y, z) => V(x * Math.cos(yaw) + z * Math.sin(yaw), y, -x * Math.sin(yaw) + z * Math.cos(yaw));
export const arr = (v) => [v.x, v.y, v.z];
export const set = (s, k, v) => { s[k] = arr(v); return s; };

// 站姿：骨盆在 (x, 髋高, z)，朝向 yaw（0 面向 +z，即面向镜头），双脚平放，双手自然下垂
export function base(d, x, z, yaw = 0) {
  const s = blank();
  s.p = [x, d.leg, z]; s.yaw = [yaw];
  feetStand(s, d); handsHang(s, d);
  return s;
}
export function feetStand(s, d, spread = 1, fwd = 0.02) {
  const P = V(...s.p), y = s.yaw[0];
  set(s, 'fL', P.clone().add(rotY(y, d.hw * spread, d.footR - P.y, fwd * d.h)));
  set(s, 'fR', P.clone().add(rotY(y, -d.hw * spread, d.footR - P.y, fwd * d.h)));
}
export function handsHang(s, d, out = 0.02) {
  out += Math.max(0, d.handR / d.h - 0.027) + Math.max(0, d.bodyW / d.h - 0.2) * 0.5;   // 男生胳膊粗、躯干宽，下垂的手离身体远一点
  const J = fk(s, d);
  const down = V(0, -1, 0).multiplyScalar(0.7).add(V(0, -1, 0).applyQuaternion(J.Qc).multiplyScalar(0.3)).normalize();
  const o = (sg) => V(sg * out * d.h, 0, 0).applyQuaternion(J.Qc);
  set(s, 'hL', J.shL.clone().add(o(1)).addScaledVector(down, 0.95 * d.arm));
  set(s, 'hR', J.shR.clone().add(o(-1)).addScaledVector(down, 0.95 * d.arm));
}

// 二分求躯干前弯角 b，使头心高度 = targetY（骨盆位置不变）
export function bendForHeadY(s, d, targetY, hi = 1.3) {
  let lo = 0;
  const t = { ...s, lean: s.lean.slice() };
  const hy = (b) => { t.lean = [s.lean[0], b]; return fk(t, d).headC.y; };
  if (hy(0) <= targetY) return 0;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (hy(m) > targetY) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

// 手够不到时，逐步增加侧倾 lean[0]（朝目标方向）直到够到；返回是否成功
export function fitReach(s, d, side, target, maxLean = 0.5) {
  const key = side === 'L' ? 'hL' : 'hR';
  set(s, key, target);
  for (const sign of [1, -1]) {
    const t0 = s.lean[0];
    for (let a = 0; a <= maxLean; a += 0.01) {
      s.lean[0] = t0 + sign * a;
      const J = fk(s, d);
      if (J.miss[key] < 1e-4) return true;
    }
    s.lean[0] = t0;
  }
  return false;
}

export const sideOf = (J, side) => (side === 'L' ? J : J);
export const sh = (J, side) => (side === 'L' ? J.shL : J.shR);
export const wrist = (J, side) => (side === 'L' ? J.wristL : J.wristR);

// 数值求解：调整 params（[key, idx, lo, hi]）使 resFn(fk) 的残差趋零（阻尼最小二乘）
export function solve(s, d, params, resFn, iters = 60) {
  const n = params.length;
  const get = (p) => s[p[0]][p[1]];
  const put = (p, v) => { s[p[0]][p[1]] = Math.min(p[3] ?? 1e9, Math.max(p[2] ?? -1e9, v)); };
  let err = 1e9;
  for (let it = 0; it < iters; it++) {
    const r0 = resFn(fk(s, d));
    err = Math.hypot(...r0);
    if (err < 2e-4) break;
    const cols = [];
    for (let j = 0; j < n; j++) {
      const v = get(params[j]); put(params[j], v + 1e-4);
      const r1 = resFn(fk(s, d)); put(params[j], v);
      cols.push(r1.map((x, i) => (x - r0[i]) / 1e-4));
    }
    const A = Array.from({ length: n }, () => new Array(n + 1).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) A[i][j] = cols[i].reduce((t, x, k) => t + x * cols[j][k], 0) + (i === j ? 1e-3 : 0);
      A[i][n] = -cols[i].reduce((t, x, k) => t + x * r0[k], 0);
    }
    for (let i = 0; i < n; i++) {
      let m = i; for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[m][i])) m = r;
      [A[i], A[m]] = [A[m], A[i]];
      for (let r = i + 1; r < n; r++) { const f = A[r][i] / A[i][i]; for (let c = i; c <= n; c++) A[r][c] -= f * A[i][c]; }
    }
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) { let t = A[i][n]; for (let c = i + 1; c < n; c++) t -= A[i][c] * x[c]; x[i] = t / A[i][i]; }
    for (let j = 0; j < n; j++) put(params[j], get(params[j]) + Math.max(-0.25, Math.min(0.25, x[j])));
  }
  return err;
}
export const loc = (J, v) => v.clone().applyQuaternion(J.Qc).add(J.P);   // 躯干局部点 -> 世界
export const fwdOf = (yaw) => rotY(yaw, 0, 0, 1);

// 手够不到时夹紧到最大可达距离（保证 IK 不报 miss，接触点最多差几厘米）
export function touch(s, d, side, target, slack = 0.985) {
  const J = fk(s, d);
  const sh = side === 'L' ? J.shL : J.shR;
  const v = target.clone().sub(sh), m = d.arm * Math.min(slack, 0.955);
  if (v.length() > m) v.setLength(m);
  set(s, side === 'L' ? 'hL' : 'hR', sh.clone().add(v));
}
// 整体下沉/抬升，使最低点恰好贴地
export function grounded(s, d, extra = 0) { s.p[1] -= groundMin(fk(s, d)) - extra; }
// 整体平移（位置类字段）
export function shift(s, v) {
  for (const k of ['p', 'hL', 'hR', 'fL', 'fR']) { s[k][0] += v.x; s[k][1] += v.y; s[k][2] += v.z; }
}
// 沿 dir 平移 mover，直到与 other 的（filter 选中的）部位刚好接触，穿透深度 = depth
export function approach(m, dm, J_other, dir, filter, depth = 0.004, range = 0.8) {
  const orig = JSON.parse(JSON.stringify({ p: m.p, hL: m.hL, hR: m.hR, fL: m.fL, fR: m.fR }));
  const at = (t) => {
    for (const k of Object.keys(orig)) m[k] = orig[k].slice();
    shift(m, dir.clone().multiplyScalar(t));
    return penetration(fk(m, dm), J_other, filter).depth;
  };
  let lo = -range, hi = range;                       // 约定：t 越大越深入
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (at(mid) > depth) hi = mid; else lo = mid; }
  at(lo);
  return lo;
}
export const headOnly = (a, b) => a.own === 'head' || b.own === 'head' || a.own === 'ear' || b.own === 'ear';
export const bodyOnly = (a, b) => ['torso', 'head', 'ear'].includes(a.own) && ['torso', 'head', 'ear'].includes(b.own);
export const unit = (x, y, z) => V(x, y, z).normalize();

// 在候选参数里挑评分最小的（score 返回数字，越小越好）
export function best(cands, score) {
  let bc = null, bs = Infinity;
  for (const c of cands) { const v = score(c); if (v < bs) { bs = v; bc = c; } }
  return { cand: bc, score: bs };
}

// ---------- 自动选肘/膝朝向 ----------
const _dirs = (() => {
  const out = [], n = 56;
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - y * y), a = i * 2.399963;
    out.push([r * Math.cos(a), y, r * Math.sin(a)]);
  }
  return out;
})();
const ARM = { L: ['uaL', 'faL'], R: ['uaR', 'faR'] };
const LEG = { L: ['thL', 'shL'], R: ['thR', 'shR'] };
export function extent(J, axis) {  // axis: 'x'|'y'|'z' -> [min,max]
  let lo = 1e9, hi = -1e9;
  for (const p of J.parts) {
    if (p.t === 'sph') { lo = Math.min(lo, p.c[axis] - p.r); hi = Math.max(hi, p.c[axis] + p.r); }
    else if (p.t === 'cap') { lo = Math.min(lo, p.a[axis] - p.r, p.b[axis] - p.r); hi = Math.max(hi, p.a[axis] + p.r, p.b[axis] + p.r); }
    else for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const v = p.c.clone().add(V(sx * p.hx, sy * p.hy, sz * p.hz).applyQuaternion(p.q))[axis]; lo = Math.min(lo, v); hi = Math.max(hi, v);
    }
  }
  return [lo, hi];
}
function limbScore(X, dX, O, dO, names, key, cand, pref, ground, side, noNat) {
  X[key] = cand;
  const JX = fk(X, dX), JO = fk(O, dO);
  const set_ = new Set(names);
  const a = penetration(JX, JO, (p) => set_.has(p.n)).depth;
  const b = penetration(JX, JX, (p, q) => set_.has(p.n) && (q.own === 'torso' || q.own === 'head')).depth;
  let g = 0;
  for (const p of JX.parts) if (set_.has(p.n)) g = Math.max(g, -(Math.min(p.a.y, p.b.y) - p.r));
  const ang = Math.acos(Math.max(-1, Math.min(1, (cand[0] * pref[0] + cand[1] * pref[1] + cand[2] * pref[2]) / (Math.hypot(...cand) * Math.hypot(...pref) + 1e-9))));
  const nat = noNat ? 0 : (key.startsWith('arm') ? elbowPenalty(JX, side) : kneePenalty(JX, side));
  return Math.max(a, b, ground ? g : 0) + 0.004 * ang + nat;
}
export function autoPoles(r, dT, dS, opts = {}) {
  const people = [[r.T, dT, r.S, dS, 'T'], [r.S, dS, r.T, dT, 'S']];
  for (let pass = 0; pass < 2; pass++) for (const [X, dX, O, dO, tag] of people) {
    if (opts.skip && opts.skip.includes(tag)) continue;
    for (const side of ['L', 'R']) {
      for (const [names, key] of [[ARM[side], 'armPole' + side], [LEG[side], 'kneePole' + side]]) {
        if (opts.noLegs && key.startsWith('knee')) continue;
        const pref = X[key].slice();
        let bestS = limbScore(X, dX, O, dO, names, key, pref, pref, opts.ground, side, opts.noNat), bestC = pref;
        for (const c of (key.startsWith('arm') ? [ELBOW_NAT[side], ..._dirs] : _dirs)) { const sc = limbScore(X, dX, O, dO, names, key, c, pref, opts.ground, side, opts.noNat); if (sc < bestS) { bestS = sc; bestC = c; } }
        X[key] = bestC.slice();
      }
    }
  }
  return r;
}

// 在候选落点 × 肘朝向里搜索：穿模最小、离首选落点最近。JO=对方的 FK（对方须已定型）
let QUICK = false;
export const setQuick = (v) => { QUICK = v; };
export function fitArm(s, d, side, targets, JO, extra = [], armsToo = false) {
  const key = side === 'L' ? 'hL' : 'hR', pk = side === 'L' ? 'armPoleL' : 'armPoleR';
  const names = new Set(side === 'L' ? ['uaL', 'faL', 'hdL'] : ['uaR', 'faR', 'hdR']);
  let bs = 1e9, bt = null, bp = null;
  targets.forEach((tg, idx) => {
    touch(s, d, side, tg);
    const gap = V(...s[key]).distanceTo(tg);
    for (const pl of (QUICK ? [ELBOW_NAT[side], ...extra] : [ELBOW_NAT[side], ...extra, ..._dirs])) {
      s[pk] = pl.slice();
      const J = fk(s, d);
      let pen = JO ? penetration(J, JO, (a, b) => names.has(a.n) && (['torso', 'head', 'ear'].includes(b.own) || (armsToo && ['ua', 'fa', 'hd'].includes(b.own)))).depth : 0;
      pen = Math.max(pen, penetration(J, J, (a, b) => names.has(a.n) && (b.own === 'torso' || b.own === 'head')).depth);
      const sc = pen + 0.003 * idx + 2 * gap + elbowPenalty(J, side);
      if (sc < bs) { bs = sc; bt = tg; bp = pl; }
    }
  });
  touch(s, d, side, bt); s[pk] = bp.slice();
  return bs;
}

// 脚落点：水平距离超出腿长时向髋正下方收拢
export function footAt(s, d, side, x, z, y = null) {
  const key = side === 'L' ? 'fL' : 'fR';
  const J = fk(s, d);
  const hip = side === 'L' ? J.hipL : J.hipR;
  const ty = y ?? d.footR;
  const R = (d.thigh + d.shin) * 0.985;
  const dy = ty - hip.y;
  let dx = x - hip.x, dz = z - hip.z;
  const maxH = Math.sqrt(Math.max(R * R - dy * dy, 0));
  const hl = Math.hypot(dx, dz);
  if (hl > maxH) { dx *= maxH / hl; dz *= maxH / hl; }
  set(s, key, V(hip.x + dx, ty, hip.z + dz));
}
// 整体抬到最低点贴地（位置类字段）
export function settle(s, d) {
  const g = groundMin(fk(s, d));
  shift(s, V(0, -g, 0));
}
export const BODY = ['torso', 'head', 'ear'];

// ---------- 关节自然度：肘/膝只能朝人体允许的方向弯 ----------
const _clamp1 = (x) => Math.max(-1, Math.min(1, x));
// 躯干坐标：肘尖朝 后/下，只略微向外。外分量太大 = 双手放身前时肘往两边翻（她说的「胳膊肘外翻」）
export const ELBOW_NAT = { L: [0.16, -0.6, -1], R: [-0.16, -0.6, -1] };
function perpDir(pt, a, b) {          // pt 相对线段 a-b 的垂直分量方向；太小返回 null
  const ax = b.clone().sub(a); const L = ax.length(); if (L < 1e-6) return null; ax.divideScalar(L);
  const e = pt.clone().sub(a); e.addScaledVector(ax, -e.dot(ax));
  return e.length() < 0.004 ? null : { e: e.normalize(), ax };
}
export function elbowAngle(J, side) {
  const sh = side === 'L' ? J.shL : J.shR, el = side === 'L' ? J.elbowL : J.elbowR, wr = side === 'L' ? J.wristL : J.wristR;
  const r = perpDir(el, sh, wr); if (!r) return 0;
  const nat = V(...ELBOW_NAT[side]).applyQuaternion(J.Qc); nat.addScaledVector(r.ax, -nat.dot(r.ax));
  if (nat.length() < 0.18) { nat.copy(V(0, 0, -1).applyQuaternion(J.Qc)); nat.addScaledVector(r.ax, -nat.dot(r.ax)); }
  if (nat.length() < 1e-4) return 0;
  return Math.acos(_clamp1(r.e.dot(nat.normalize()))) * 180 / PI;
}
export function kneeAngle(J, side) {
  const hip = side === 'L' ? J.hipL : J.hipR, kn = side === 'L' ? J.kneeL : J.kneeR, an = side === 'L' ? J.ankleL : J.ankleR;
  const r = perpDir(kn, hip, an); if (!r) return 0;
  const nat = V(side === 'L' ? 0.25 : -0.25, 0, 1).applyQuaternion(J.Qp); nat.addScaledVector(r.ax, -nat.dot(r.ax));
  if (nat.length() < 1e-4) return 0;
  return Math.acos(_clamp1(r.e.dot(nat.normalize()))) * 180 / PI;
}
// 肘外翻：肘尖在躯干坐标里朝外的偏移超过朝后的偏移（双手放身前时最明显）。返回外翻量（米）
export function elbowFlare(J, side) {
  const sh = side === 'L' ? J.shL : J.shR, el = side === 'L' ? J.elbowL : J.elbowR, wr = side === 'L' ? J.wristL : J.wristR;
  const ax = wr.clone().sub(sh); if (ax.lengthSq() < 1e-8) return 0; ax.normalize();
  const e = el.clone().sub(sh); e.addScaledVector(ax, -e.dot(ax));
  const l = e.applyQuaternion(J.Qc.clone().invert());
  const out = side === 'L' ? l.x : -l.x, back = -l.z;
  return Math.max(0, out - Math.max(back, 0) * 0.8 - 0.02);
}
export const elbowPenalty = (J, side) => { const a = elbowAngle(J, side); return (a > 80 ? 1 : a > 22 ? (a - 22) * 0.006 : 0) + elbowFlare(J, side) * 4; };
export const kneePenalty = (J, side) => { const a = kneeAngle(J, side); return a > 85 ? 1 : a > 60 ? (a - 60) * 0.0009 : 0; };

// 前弯身体、双手往前下方扶人时：肘尖应朝世界的下方、略向外（躯干坐标的「朝后」此时在世界里是朝上，旧判断会漏）
export function elbowAngleWorld(J, side, outK = 0.3) {
  const sh = side === 'L' ? J.shL : J.shR, el = side === 'L' ? J.elbowL : J.elbowR, wr = side === 'L' ? J.wristL : J.wristR;
  const r = perpDir(el, sh, wr); if (!r) return 0;
  const nat = V(0, -1, 0).addScaledVector(V(side === 'L' ? 1 : -1, 0, 0).applyQuaternion(J.Qc), outK);
  nat.addScaledVector(r.ax, -nat.dot(r.ax)); if (nat.length() < 1e-4) return 0;
  return Math.acos(_clamp1(r.e.dot(nat.normalize()))) * 180 / PI;
}
export function elbowFlareWorld(J, side) {
  const sh = side === 'L' ? J.shL : J.shR, el = side === 'L' ? J.elbowL : J.elbowR, wr = side === 'L' ? J.wristL : J.wristR;
  const ax = wr.clone().sub(sh); if (ax.lengthSq() < 1e-8) return 0; ax.normalize();
  const e = el.clone().sub(sh); e.addScaledVector(ax, -e.dot(ax));
  const out = e.dot(V(side === 'L' ? 1 : -1, 0, 0).applyQuaternion(J.Qc)), down = -e.y;
  return Math.max(0, out - Math.max(down, 0) * 0.6 - 0.01);
}
export const elbowPenaltyWorld = (J, side) => { const a = elbowAngleWorld(J, side); return (a > 80 ? 1 : a > 30 ? (a - 30) * 0.006 : 0) + elbowFlareWorld(J, side) * 4; };
export const jointCostWorldArms = (J) => elbowPenaltyWorld(J, 'L') + elbowPenaltyWorld(J, 'R') + kneePenalty(J, 'L') + kneePenalty(J, 'R');
export const penAll = (JT, JS) => Math.max(penetration(JT, JS).depth, penetration(JS, JT).depth);
export function jointCost(J) {
  return elbowPenalty(J, 'L') + elbowPenalty(J, 'R') + kneePenalty(J, 'L') + kneePenalty(J, 'R');
}
// 候选 -> build(c) 返回 {T,S,...}；按「穿模超出容差 + 自碰 + 关节不自然 + 偏好序」打分，返回最优
// 手应当扶在对方身上（r.hold = ['T.L', ...]）却悬空时的惩罚
function holdGap(r, JT, JS) {
  let t = 0;
  for (const h of r.hold || []) {
    const [who, side] = h.split('.'); const J = who === 'T' ? JT : JS, O = who === 'T' ? JS : JT;
    const hand = J.parts.find((q) => q.n === 'hd' + side); let g = 1e9;
    for (const q of O.parts) if (['torso', 'head', 'ua', 'fa', 'hd', 'th', 'sh'].includes(q.own)) g = Math.min(g, sdf(q, hand.c) - hand.r);
    t += Math.max(0, g - 0.015) * 2;
  }
  return t;
}
// 托膝：r.cradle=['R'] 表示 T 的右前臂要从她两个膝盖正下面托过去（长度够到远侧膝盖、比膝心低、水平位置在膝关节附近）
export function cradleGap(r, JT, JS) {
  let t = 0;
  for (const side of r.cradle || []) {
    const fa = JT.parts.find((q) => q.n === 'fa' + side), hd = JT.parts.find((q) => q.n === 'hd' + side);
    const need = JT.d.armR + JS.d.legR;
    for (const K of [JS.kneeL, JS.kneeR]) {
      const E = fa.a, H = hd.c, dz = H.z - E.z;
      t += Math.max(0, K.z - (H.z + JT.d.handR * 0.5)) * 3;
      const sp = Math.min(Math.max((K.z - E.z) / (Math.abs(dz) < 1e-6 ? 1e-6 : dz), 0), 1);
      const p = E.clone().lerp(H, sp);
      t += Math.max(0, p.y - (K.y - need * 0.9)) * 3;
      t += Math.max(0, Math.abs(p.x - K.x) - 0.08) * 2;
    }
  }
  return t;
}
export function pick2(cands, build, dT, dS, { tol = 0.012, noNat = false, jointT = jointCost } = {}) {
  let bestC = cands[0], bs = Infinity;
  setQuick(true);
  cands.forEach((c, i) => {
    const r = build(c); const JT = fk(r.T, dT), JS = fk(r.S, dS);
    const sc = Math.max(0, penAll(JT, JS) - tol) * 2 + Math.max(selfPen(JT).depth, selfPen(JS).depth) * 1.5
      + (noNat ? 0 : jointT(JT) + jointCost(JS)) + 0.0004 * i + holdGap(r, JT, JS) + cradleGap(r, JT, JS);
    if (sc < bs) { bs = sc; bestC = c; }
  });
  setQuick(false);
  return build(bestC);
}
export const grid2 = (...axes) => axes.reduce((acc, ax) => acc.flatMap((a) => ax.map((v) => [...a, v])), [[]]);

// 让 IK 精确经过设计好的中间关节（肘/膝）：把它相对「根-末端」连线的偏移换算成局部极向量
export function poleThrough(s, d, key, root, mid, end) {
  const ax = end.clone().sub(root).normalize();
  const e = mid.clone().sub(root); e.addScaledVector(ax, -e.dot(ax));
  if (e.length() < 1e-5) return;
  const J = fk(s, d);
  const q = (key.startsWith('arm') ? J.Qc : J.Qp).clone().invert();
  const l = e.normalize().applyQuaternion(q);
  s[key] = key === 'kneePoleR' ? [-l.x, l.y, l.z] : [l.x, l.y, l.z];
}
// 按「膝、脚的期望位置」摆腿：保持方向、校正长度，并让膝盖严格落在设计位置
export function legTo(s, d, side, knee, foot, minY = null) {
  const J = fk(s, d), hip = side === 'L' ? J.hipL : J.hipR;
  const k = hip.clone().add(knee.clone().sub(hip).setLength(d.thigh * 0.995));
  const f = k.clone().add(foot.clone().sub(k).setLength(d.shin * 0.995));
  const lo = minY ?? d.footR + 0.002;
  if (f.y < lo) f.y = lo;
  set(s, side === 'L' ? 'fL' : 'fR', f);
  poleThrough(s, d, 'kneePole' + side, hip, k, f);
}
// 按「肘、手的期望位置」摆手臂
export function armTo(s, d, side, elbow, hand, _unused) {
  const J = fk(s, d), sh = side === 'L' ? J.shL : J.shR;
  const e = sh.clone().add(elbow.clone().sub(sh).setLength(d.upper * 0.99));
  const h = e.clone().add(hand.clone().sub(e).setLength(d.fore * 0.97));
  set(s, side === 'L' ? 'hL' : 'hR', h);
  poleThrough(s, d, 'armPole' + side, sh, e, h);
}

// ---------- 新姿势专用：整肢放置（与对方全身 + 自己躯干/头/另一侧肢体都查穿模） ----------
const LIMB = { arm: { L: ['uaL', 'faL', 'hdL'], R: ['uaR', 'faR', 'hdR'] }, leg: { L: ['thL', 'shL', 'ftL'], R: ['thR', 'shR', 'ftR'] } };
// wantMid：理想的肘/膝位置；ends：手/脚候选落点（按偏好排序）；allow：允许的接触深度（手贴身体时用）
export function placeLimb(s, d, kind, side, JO, wantMid, ends, { allow = 0.008, wMid = 0.15, minY = null, natural = true, natFn = null } = {}) {
  const names = new Set(LIMB[kind][side]);
  const otherSide = LIMB[kind][side === 'L' ? 'R' : 'L'];
  const J0 = fk(s, d);
  const root = kind === 'arm' ? (side === 'L' ? J0.shL : J0.shR) : (side === 'L' ? J0.hipL : J0.hipR);
  const L1 = kind === 'arm' ? d.upper : d.thigh;
  const dirs = [wantMid.clone().sub(root).normalize()];
  if (!QUICK) for (const v of _dirs) dirs.push(V(...v));
  // 在理想方向附近加密采样（快速模式只用这些）
  for (let i = 0; i < (QUICK ? 12 : 24); i++) { const a = i * 2.39996, r = 0.12 + 0.35 * (i / 24); dirs.push(dirs[0].clone().add(V(Math.cos(a) * r, Math.sin(a) * r * 0.8, Math.sin(a * 1.7) * r)).normalize()); }
  let best = null, bs = Infinity;
  const toFn = kind === 'arm' ? armTo : legTo;
  ends.forEach((end, ei) => {
    for (const dir of dirs) {
      const mid = root.clone().addScaledVector(dir, L1);
      if (kind === 'arm') armTo(s, d, side, mid, end); else legTo(s, d, side, mid, end, minY);
      const J = fk(s, d);
      const lim = J.parts.filter((p) => names.has(p.n));
      const pO = JO ? penetration({ parts: lim }, JO).depth : 0;
      const pS = penetration({ parts: lim }, J, (a, b) => b.own === 'torso' || b.own === 'head' || otherSide.includes(b.n)).depth;
      const endNow = V(...s[kind === 'arm' ? 'h' + side : 'f' + side]);
      const gap = endNow.distanceTo(end);
      let nat = 0;
      if (natFn) nat = natFn(J, side);
      else if (natural) nat = kind === 'arm' ? elbowPenalty(J, side) : kneePenalty(J, side);
      else if (kind === 'arm') nat = elbowFlare(J, side) * 3;     // 环颈/托背这类动作也不许肘往外撇
      const sc = Math.max(0, pO - allow) * 3 + Math.max(0, pS - 0.004) * 3 + 1.5 * gap + wMid * mid.distanceTo(wantMid) + 0.004 * ei + nat;
      if (sc < bs) { bs = sc; best = [mid, end]; }
    }
  });
  toFn(s, d, side, best[0], best[1], minY);
  return bs;
}
