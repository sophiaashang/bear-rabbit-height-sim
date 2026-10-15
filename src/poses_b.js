// 姿势 7-14。约定同 poses_a.js：矮个 S、高个 T；侧面姿势 S 朝 +x(yaw=π/2)、T 朝 -x(yaw=-π/2)。
// 侧面时：S 的左手在世界 -z、右手在 +z；T 的左手在 +z、右手在 -z。镜头在 +z 侧，所以 +z 侧是「近侧」。
import { V, fk, penetration, sdf, selfPen, groundMin, refDims } from './model.js';
import { PI, rotY, set, base, feetStand, handsHang, bendForHeadY, solve, touch, shift, settle, footAt, fitArm, BODY, pick2, grid2, ELBOW_NAT, placeLimb, elbowAngleWorld, setQuick, elbowFlare, elbowPenalty, armTo, poleThrough, loc, kneeAngle, extent } from './poseutil.js';

const NOARM = (p) => !['ua', 'fa', 'hd'].includes(p.own);
const pen = (JA, JB, filt = NOARM) => Math.max(penetration(JA, JB, (a, b) => filt(a) && filt(b)).depth, penetration(JB, JA, (a, b) => filt(a) && filt(b)).depth);
// 在候选集合里挑「穿模+偏好」得分最小者。cands 按偏好从高到低排列。
function pick(cands, build, dT, dS, extra = () => 0) {
  let bestR = null, bs = Infinity;
  cands.forEach((c, i) => {
    const r = build(c);
    const sc = pen(fk(r.T, dT), fk(r.S, dS)) + 0.0006 * i + extra(r);
    if (sc < bs) { bs = sc; bestR = r; }
  });
  return bestR;
}
const grid = (...axes) => axes.reduce((acc, ax) => acc.flatMap((a) => ax.map((v) => [...a, v])), [[]]);

// ---------- 7 蹲下平视：T 单膝下蹲，双手扶在 S 双肩上，两人对视 ----------
export const kneelEye = (dT, dS) => {
  const cands = grid2([0.0, 0.03, -0.03], [0.30, 0.24, 0.18], [0.33, 0.26, 0.2], [0.9, 1.0]);
  const build = ([dz, fa, ba, sc]) => {
    const S = base(dS, 0, 0, PI / 2);
    S.head = [-0.04, 0, 0];
    const JS0 = fk(S, dS);
    const T = base(dT, 0, 0, -PI / 2);
    const pelvisY = Math.max(0.30 * dT.h, Math.min(JS0.headC.y - (dT.torso + dT.neck + dT.headR) + 0.01, dT.leg));
    const xT = JS0.P.x + dS.bodyD / 2 + dT.bodyD / 2 + (dS.arm + dT.arm) * 0.30 * sc;
    T.p = [xT, pelvisY, dz * dT.h];
    T.lean = [0, 0.06]; T.head = [0.0, 0, 0];
    footAt(T, dT, 'L', xT - fa * dT.h, dT.hw * 1.6, dT.footR + 0.002);   // 前脚（朝 S）平放
    footAt(T, dT, 'R', xT + ba * dT.h, -dT.hw * 1.6, dT.footR + 0.002);   // 后脚点地（单膝跪）
    T.kneePoleL = [0, 0.1, 1]; T.kneePoleR = [0, 0.2, 1];
    handsHang(T, dT, 0.03);
    const JS = fk(S, dS);
    // T 左=+z 对 S 的 R 肩(+z)；T 右=-z 对 S 的 L 肩(-z)。手掌覆在肩头上方
    const shoulder = (J, sg) => (sg > 0 ? J.shR : J.shL).clone();
    const tg = (sg) => [[0, 0.012], [0.01, 0.02], [-0.01, 0.03]].map(([dx, up]) => shoulder(JS, sg).add(V(dx, dT.armR + up + dT.handR * 0.4, sg * 0.02)));
    fitArm(T, dT, 'L', tg(1), JS, [[0.2, -0.3, 1], [0.5, 0.2, 0.6]], true);
    fitArm(T, dT, 'R', tg(-1), JS, [[-0.2, -0.3, -1], [-0.5, 0.2, -0.6]], true);
    // S 双手自然垂放，略微外展
    handsHang(S, dS, 0.04);
    return { T, S };
  };
  const r = pick2(cands, build, dT, dS, { tol: 0.02 });
  return { ...r, loose: ['hd', 'fa', 'ua', 'ear', 'head', 'th', 'sh'], hold: ['T.L', 'T.R'] };
};

// ---------- 8 面对面拥抱：胸口贴胸口，她侧脸靠在他胸口/肩头，他双臂环她后背，她双臂环他腰 ----------
// 重写：旧版他弯腰去够她的头，骨盆被推远，两人胸口隔 7–22cm，胳膊夹在中间互穿。
// 新解法：两人上身基本直立、躯干正面贴住（嵌入约 0.6cm）；头放不下就各自往一侧歪/仰，不再靠弯腰对头。
// 脚尖会顶在一起：双方脚往各自身后收、宽窄错开（站宽/站窄进候选）。
const torsoGap = (T, dT_, S, dS_) => {        // 她躯干正面到他躯干的最小有符号距离
  const JT = fk(T, dT_), JS = fk(S, dS_), tb = JT.parts[0];
  let mn = 1e9;
  for (const ky of [0.05, 0.25, 0.45, 0.65, 0.85, 1.0]) for (const kx of [-0.9, -0.45, 0, 0.45, 0.9]) {
    const pt = JS.P.clone().addScaledVector(JS.upC, ky * dS_.torso).add(V(kx * dS_.bodyW / 2, 0, dS_.bodyD / 2).applyQuaternion(JS.Qc));
    mn = Math.min(mn, sdf(tb, pt));
  }
  return mn;
};
const hugStand = (s, d, fb, spread) => {      // 脚往身后收 fb·h，骨盆随之略降，躯干保持直立
  const L = (d.thigh + d.shin) * 0.985;
  s.p[1] = d.footR + Math.sqrt(Math.max(L * L - (fb * d.h) ** 2, 1e-4)) * 0.998;
  for (const [side, sg] of [['L', 1], ['R', -1]]) {
    const o = rotY(s.yaw[0], sg * d.hw * spread, 0, -fb * d.h);
    footAt(s, d, side, s.p[0] + o.x, s.p[2] + o.z, d.footR + 0.002);
  }
};
const own = (set_) => (p) => set_.includes(p.own);
const penF = (JA, JB, fa, fb) => Math.max(penetration(JA, JB, (a, b) => fa(a) && fb(b)).depth, penetration(JB, JA, (a, b) => fb(a) && fa(b)).depth);
export const hug = (dT, dS) => {
  const EMBED = 0.006;
  const place = (zo, fbS, spS, fbT, spT, lean) => {
    const S = base(dS, 0, zo * dS.h, PI / 2), T = base(dT, 0.3, -zo * dS.h, -PI / 2);
    hugStand(S, dS, fbS, spS); T.lean = [0, lean]; hugStand(T, dT, fbT, spT);
    let lo = 0, hi = 0.9;                      // 二分 T 的 x，使躯干刚好贴住
    for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2; T.p[0] = m; hugStand(T, dT, fbT, spT); if (torsoGap(T, dT, S, dS) < -EMBED) lo = m; else hi = m; }
    T.p[0] = hi; hugStand(T, dT, fbT, spT);
    handsHang(T, dT); handsHang(S, dS);
    return { T, S };
  };
  // ① 脚：只看腿脚互穿，取收脚最少的
  const LEGS = own(['th', 'sh', 'ft']);
  let best = null, bs = Infinity;
  for (const zo of [0.0]) for (const lean of [0.0]) {
    let fbest = null, fs = Infinity;
    for (const [fbS, fbT] of grid2([0.02, 0.045, 0.07, 0.095], [0.02, 0.045, 0.07, 0.095])) for (const spS of [0.7, 0.9]) for (const spT of [1.0, 1.3]) {
      const r = place(zo, fbS, spS, fbT, spT, lean);
      const JT = fk(r.T, dT), JS = fk(r.S, dS);
      const sc = Math.max(0, penF(JT, JS, LEGS, LEGS) - 0.004) * 20 + 0.15 * (fbS + fbT) + 0.004 * (spT - 1) + 0.004 * (0.9 - spS);
      if (sc < fs) { fs = sc; fbest = r; }
    }
    // ② 头：她仰头+歪向一侧+侧脸，他低头+歪向另一侧；头/耳只许轻贴
    const { T, S } = fbest;
    let hs = Infinity, hb = null;
    for (const [sp, sr, sy] of grid2([-0.1, -0.3, -0.5], [0.0, 0.3, 0.6], [0.0, 0.6])) for (const [tp, tr, ty] of grid2([0.0, 0.25, 0.5], [0.0, 0.3, 0.6], [0.0, -0.5])) {
      S.head = [sp, sy, sr]; T.head = [tp, ty, tr];
      const JT = fk(T, dT), JS = fk(S, dS);
      const pH = penF(JS, JT, own(['head']), own(['head', 'torso'])), pE = penF(JS, JT, own(['ear']), own(['head', 'ear', 'torso']));
      const pE2 = penF(JT, JS, own(['ear']), own(['head', 'ear', 'torso']));
      const gHead = Math.min(...JT.parts.filter((q) => q.own === 'torso' || q.own === 'head').map((q) => sdf(q, JS.headC) - dS.headR));
      const sc = Math.max(0, pH - 0.008) * 20 + Math.max(0, Math.max(pE, pE2) - 0.004) * 30 + Math.max(0, gHead - 0.01) * 0.5
        + 0.012 * (Math.abs(sp) + Math.abs(sr) + 0.3 * Math.abs(sy) + Math.abs(tp) + Math.abs(tr) + 0.3 * Math.abs(ty));
      if (sc < hs) { hs = sc; hb = [S.head.slice(), T.head.slice()]; }
    }
    S.head = hb[0]; T.head = hb[1];
    const tot = fs + hs + 0.3 * zo + 0.05 * lean;
    if (tot < bs) { bs = tot; best = { T, S }; }
  }
  const { T, S } = best;
  // ③ 手臂：他环她后背（偏高，肩胛位置），她环他后腰（偏低，从他手臂下面穿过）；肘朝外下，不朝天
  const wrapNat = (J, side) => { const a = elbowAngleWorld(J, side, 1.5); return a > 75 ? 1 : a > 40 ? (a - 40) * 0.004 : 0; };
  // 手贴在对方后背表面（前臂半径贴住，不扎进去）；肘绕到对方身侧偏后，前臂顺着后背走，不切过躯干后角
  const lxOf = (J, w) => (V(1, 0, 0).applyQuaternion(J.Qc).z > 0 ? w : -w);
  const onBack = (J, d, dO, ky, kx, w) => J.P.clone().addScaledVector(J.upC, ky * d.torso)
    .add(V(lxOf(J, w) * kx * d.bodyW / 2, 0, -(d.bodyD / 2 + dO.armR * 1.05)).applyQuaternion(J.Qc));
  const onCorner = (J, d, dO, ky, w) => J.P.clone().addScaledVector(J.upC, ky * d.torso)
    .add(V(lxOf(J, w) * (d.bodyW / 2 + dO.armR * 0.35), 0, -(d.bodyD / 2 + dO.armR * 0.35)).applyQuaternion(J.Qc));
  const elbowAt = (J, d, dO, ky, w, zb) => J.P.clone().addScaledVector(J.upC, ky * d.torso)
    .add(V(lxOf(J, w) * (d.bodyW / 2 + dO.armR * 1.3 + 0.012), 0, -zb * d.bodyD).applyQuaternion(J.Qc));
  const wOf = (J, side) => Math.sign((side === 'L' ? J.shL : J.shR).z - J.shC.z);
  // 肘位前后（zb）也进候选：逐个试，留分最低的
  const placeArm = (X, dX, O, dO, sd, kys, ends) => {
    const w = wOf(fk(X, dX), sd), JO = fk(O, dO);
    const E = ends.map(([k1, k2]) => (k2 === 'c' ? onCorner(JO, dO, dX, k1, w) : onBack(JO, dO, dX, k1, k2, w)));
    const opt = { allow: 0.012, wMid: 0.25, natFn: wrapNat };
    let bs = Infinity, bz = null;
    setQuick(true);
    for (const [zb, ky] of grid2([0.75, 0.6, 0.45, 0.3, 0.15], kys)) {
      const sc = placeLimb(X, dX, 'arm', sd, JO, elbowAt(JO, dO, dX, ky, w, zb), E, opt);
      if (sc < bs) { bs = sc; bz = [zb, ky]; }
    }
    setQuick(false);
    placeLimb(X, dX, 'arm', sd, JO, elbowAt(JO, dO, dX, bz[1], w, bz[0]), E, opt);
  };
  // 他：环在她肩胛高度（等高时更高，让开她从下面穿过来的胳膊）；她：环他后腰，够不到背中就搭在腰背侧角
  const placeT = () => { for (const sd of ['L', 'R']) placeArm(T, dT, S, dS, sd, [0.8, 0.65, 0.92], [[0.78, 0.45], [0.85, 0.6], [0.7, 0.6], [0.9, 0.35], [0.65, 0.75], [0.8, 0.8], [0.92, 0.5], [0.8, 'c']]); };
  const placeS = () => { for (const sd of ['L', 'R']) placeArm(S, dS, T, dT, sd, [0.4, 0.25, 0.15], [[0.35, 0.5], [0.25, 0.65], [0.45, 0.5], [0.2, 0.8], [0.5, 0.75], [0.3, 0.35], [0.3, 'c'], [0.2, 'c'], [0.4, 'c']]); };
  placeT(); placeS(); placeT(); placeS();
  return { T, S, loose: ['hd', 'fa', 'ua', 'head', 'ear', 'torso'], skipAuto: ['T', 'S'], elbowWorld: ['T', 'S'], wrapArms: ['T', 'S'], hold: ['T.L', 'T.R', 'S.L', 'S.R'] };
};

// ---------- 9 背后环抱：T 在 S 身后，双臂在 S 胸前相扣，脸贴在 S 头侧 ----------
export const backHug = (dT, dS) => {
  // 改身体（v17）：旧版他弯腰去够她的头，骨盆被推后，他胸口和她后背隔 8–16cm。
  // 现在两人基本直立，二分他的前后位置让他胸腹贴住她后背（嵌入约 0.6cm）。
  // 头很大（直径 0.18h），贴身后两颗头会撞：他往一侧挪一点、头歪向另一侧贴她头侧，她略低头往前让；
  // 实在让不开才把他整体往后退到头刚好轻贴。
  const EMBED = 0.006;
  const cpy = (x) => JSON.parse(JSON.stringify(x));
  const tOf = (J) => J.parts.find((q) => q.own === 'torso');
  const selO = (J, o) => ({ parts: J.parts.filter((q) => o.includes(q.own)) });
  const backRows = (T, S) => { const JT = fk(T, dT), JS = fk(S, dS), tb = tOf(JT);
    return [0.12, 0.35, 0.6, 0.85].map((ky) => Math.min(...[-0.6, 0, 0.6].map((kx) => sdf(tb,
      JS.P.clone().addScaledVector(JS.upC, ky * dS.torso).add(V(kx * dS.bodyW / 2, 0, -dS.bodyD / 2).applyQuaternion(JS.Qc)))))); };
  const headPen = (T, S) => { const JT = fk(T, dT), JS = fk(S, dS);
    return Math.max(
      penetration(selO(JT, ['head']), selO(JS, ['head'])).depth,
      penetration(selO(JS, ['head']), selO(JT, ['torso'])).depth,
      penetration(selO(JT, ['head']), selO(JS, ['torso'])).depth,
      penetration(selO(JS, ['ear']), selO(JT, ['head', 'ear', 'torso'])).depth - 0.002,
      penetration(selO(JT, ['ear']), selO(JS, ['head', 'ear'])).depth - 0.002); };
  const LEGS = own(['th', 'sh', 'ft']);
  const torsoBad = (T, S) => Math.min(...backRows(T, S)) < -EMBED;
  const mk = (sLean, tLean, ft, xs = 0) => {
    const S = base(dS, 0, 0); S.lean = [0, sLean]; hugStand(S, dS, ft[0], ft[1]);
    const T = base(dT, xs, -(dS.bodyD + dT.bodyD) / 2); T.lean = [0, tLean]; hugStand(T, dT, ft[2], ft[3]);
    return { T, S };
  };
  const setZ = (c, ft, z) => { c.T.p[2] = z; hugStand(c.T, dT, ft[2], ft[3]); };
  const fitZ = (c, ft, bad, lo0 = -1.0, hi0 = 0.0, it = 20) => {   // lo 一侧不贴，hi 一侧贴太深
    let lo = lo0, hi = hi0;
    for (let i = 0; i < it; i++) { const m = (lo + hi) / 2; setZ(c, ft, m); if (bad(c.T, c.S)) hi = m; else lo = m; }
    setZ(c, ft, lo); return c;
  };
  const gapCost = (g) => g.reduce((acc, x) => acc + Math.max(0, x - 0.005), 0);
  // ① 前倾/后靠
  const FT0 = [-0.02, 0.8, 0.04, 1.25];
  let lb = null, ls = Infinity;
  for (const sLean of [0, -0.04]) for (const tLean of [0, 0.04]) {
    const c = fitZ(mk(sLean, tLean, FT0), FT0, torsoBad);
    const sc = gapCost(backRows(c.T, c.S)) * 10 + 0.3 * Math.abs(sLean) + 0.2 * tLean;
    if (sc < ls) { ls = sc; lb = { sLean, tLean }; }
  }
  // ② 脚：只看腿脚互穿
  let ftB = FT0, fs = Infinity;
  for (const [fbS, fbT] of grid2([-0.01, -0.03, -0.05], [0.03, 0.055, 0.08])) for (const spS of [0.7, 0.9]) for (const spT of [1.1, 1.4]) {
    const ft = [fbS, spS, fbT, spT], c = fitZ(mk(lb.sLean, lb.tLean, ft), ft, torsoBad);
    const sc = Math.max(0, penF(fk(c.T, dT), fk(c.S, dS), LEGS, LEGS) - 0.004) * 20 + gapCost(backRows(c.T, c.S)) * 10 + 0.1 * (Math.abs(fbS) + fbT) + 0.004 * Math.abs(spT - 1.2);
    if (sc < fs) { fs = sc; ftB = ft; }
  }
  // ③ 头：他侧移 xs + 低头/歪头，她低头/歪头；先在贴身位置粗筛，前 12 个再按需往后退到头只轻贴
  const cands = [];
  for (const xk of [0, 0.03, 0.06, 0.09]) {
    const c = fitZ(mk(lb.sLean, lb.tLean, ftB, xk * dS.h), ftB, torsoBad), z0 = c.T.p[2];
    const legP = Math.max(0, penF(fk(c.T, dT), fk(c.S, dS), LEGS, LEGS) - 0.004);
    for (const [tp, tr] of grid2([0, 0.3, 0.6], [-0.5, -0.25, 0, 0.25, 0.5])) for (const [sp, sr] of grid2([0, 0.2, 0.4], [-0.25, 0, 0.25])) {
      c.T.head = [tp, 0, tr]; c.S.head = [sp, 0, sr];
      const hp = headPen(c.T, c.S), ang = 0.02 * (tp + Math.abs(tr) + sp + Math.abs(sr)) + 0.3 * xk + legP * 20;
      cands.push({ pre: Math.max(0, hp - 0.003) * 10 + ang, ang, xk, z0, T: cpy(c.T), S: cpy(c.S) });
    }
  }
  cands.sort((u, v) => u.pre - v.pre);
  let best = null, bsc = Infinity;
  for (const cd of cands.slice(0, 12)) {
    const c = { T: cd.T, S: cd.S };
    setZ(c, ftB, cd.z0);
    if (headPen(c.T, c.S) > 0.003) fitZ(c, ftB, (T, S) => headPen(T, S) > 0.003 || torsoBad(T, S), cd.z0 - 0.4, cd.z0, 14);
    const JT = fk(c.T, dT), JS = fk(c.S, dS);
    const hg = JT.headC.distanceTo(JS.headC) - dT.headR - dS.headR;
    const sc = gapCost(backRows(c.T, c.S)) * 10 + cd.ang + Math.max(0, hg - 0.015) * 0.5;
    if (sc < bsc) { bsc = sc; best = c; }
  }
  handsHang(best.T, dT); handsHang(best.S, dS);
  const r = { T: best.T, S: best.S };
  const JS = fk(r.S, dS);
  // 改她的胳膊（v10）：她小臂比躯干厚度长，手放在小腹前而肘垂直下垂时，肘只能往后顶进他胸口或往外翻。
  // 解法：她大臂允许略往前摆（肘在身侧偏前），小臂斜向内、略向下，手落在小腹前；
  // 只保留「他够得着」的手位，再让他的手扣到她手底下——她的手正好搭在他手背/前臂上。最后贴合一次防悬空。
  const toW = (v) => v.clone().applyQuaternion(JS.Qc).add(JS.P);
  const toS = (v) => v.clone().sub(JS.P).applyQuaternion(JS.Qc.clone().invert());
  const U = dS.upper * 0.99, F = dS.fore * 0.97;
  const JT0 = fk(r.T, dT);
  const reachT = (dT.upper * 0.99 + dT.fore * 0.97) * 0.96;
  const zT = dS.bodyD / 2 + dT.handR * 1.05;                       // 他手心贴她小腹
  const off = V(0, 0.6, 0.8).multiplyScalar(dT.handR + dS.handR * 0.85); // 她手搭在他手背上（偏上偏前）
  const zH = zT + off.z;
  const ownBody = { parts: JS.parts.filter((q) => q.own === 'torso') };
  const plan = {};
  // v12：她小臂尽量平（手只比肘高 -4~+8cm），先定手高再解前后位置；他的手扣在她手正下方。
  // 这样他的小臂从她肘下面过、她的小臂平搭在他小臂上，不再从她大臂中间穿过去。
  for (const [side, sg] of [['L', 1], ['R', -1]]) {
    const shL = toS(side === 'L' ? JS.shL : JS.shR), tSh = side === 'L' ? JT0.shL : JT0.shR;
    const cands = [];
    for (const ox of [0.12, 0.2, 0.3, 0.42]) for (const oz of [-0.15, 0.0, 0.15, 0.3, 0.45]) for (const kx of [0.03, 0.045, 0.06, 0.075]) for (const ky of [-0.025, 0.0, 0.02, 0.04, 0.06]) {
      const E = shL.clone().add(V(sg * ox, -1, oz).normalize().multiplyScalar(U));
      const hx = sg * kx * dS.h, dx = hx - E.x, dy = ky * dS.h;
      const rest = F * F - dx * dx - dy * dy; if (rest <= 0) continue;
      const H = V(hx, E.y + dy, E.z + Math.sqrt(rest));
      if (H.z < dS.bodyD / 2 + dS.handR + dT.handR * 1.5) continue;    // 手得在她小腹前、留出他手的位置
      const zA = Math.max(zT, H.z - off.z);
      const tArm = toW(V(hx, H.y - off.y, zA));
      const float = zA - zT;                                            // 他手离她小腹的空隙
      const short = Math.max(0, tSh.distanceTo(tArm) - reachT);
      armTo(r.S, dS, side, toW(E), toW(H));
      const J = fk(r.S, dS);
      const mine = { parts: J.parts.filter((q) => ['fa' + side, 'hd' + side].includes(q.n)) };
      const sp = penetration(mine, ownBody).depth;
      const low = Math.max(0, 0.2 * dS.torso - H.y);
      const sc = short * 30 + Math.max(0, sp - 0.006) * 10 + low * 3 + elbowPenalty(J, side) + elbowFlare(J, side) * 3
        + Math.max(0, float - 0.02) * 2 + 0.03 * Math.abs(oz) + 0.02 * ox;
      cands.push({ sc, h: r.S['h' + side].slice(), p: r.S['armPole' + side].slice(), tArm });
    }
    cands.sort((u, v) => u.sc - v.sc);
    plan[side] = cands.slice(0, 40);
    r.S['h' + side] = plan[side][0].h; r.S['armPole' + side] = plan[side][0].p;
  }
  // 他：对她每个候选手位，真的把他这一侧的胳膊摆上去；目标含「压低一点」几档，让他小臂从她肘下面过
  const limbOf = (J, sd) => ({ parts: J.parts.filter((q) => ['ua' + sd, 'fa' + sd, 'hd' + sd].includes(q.n)) });
  const allArms = (J) => ({ parts: J.parts.filter((q) => ['ua', 'fa', 'hd'].includes(q.own)) });
  const tgsFor = (tArm, sg) => { const c = toS(tArm);
    return [[0, 0], [0.01, 0], [-0.008, 0], [0, -0.01], [0, -0.02], [0.012, -0.015], [0, -0.03], [0.015, -0.03]].map(([ddx, ddy]) =>
      toW(V(c.x + sg * ddx * dS.h, c.y + ddy * dS.h, c.z))); };
  const handGap = (JSx, JTx, side) => { const hand = JSx.parts.find((q) => q.n === 'hd' + side);
    let g = 1e9; for (const q of JTx.parts) if (['fa', 'hd'].includes(q.own)) g = Math.min(g, sdf(q, hand.c) - hand.r); return g; };
  // v18：贴身以后他的胳膊不再用快速搜索（只试自然肘向，小臂会扎进他自己胸口）。
  // 直接解几何：肘在「他肩球面 ∩ 手球面」交线圆上，取绕在她身侧、不进她身体、不压她胳膊、不扎进他自己胸口的点。
  const UT = dT.upper * 0.99, FT = dT.fore * 0.97;
  const circ = (sh, tg, A, B, n = 32) => {
    const ax = tg.clone().sub(sh), d = ax.length();
    if (d > A + B - 1e-4 || d < Math.abs(A - B) + 1e-4) return [];
    ax.divideScalar(d);
    const x = (d * d + A * A - B * B) / (2 * d), rho = Math.sqrt(Math.max(A * A - x * x, 0));
    const c = sh.clone().addScaledVector(ax, x);
    const v1 = (Math.abs(ax.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0)).cross(ax).normalize(), v2 = ax.clone().cross(v1);
    const out = [];
    for (let i = 0; i < n; i++) { const th = (i / n) * 2 * PI; out.push(c.clone().addScaledVector(v1, rho * Math.cos(th)).addScaledVector(v2, rho * Math.sin(th))); }
    return out;
  };
  const samp = (p0, p1, n) => { const o = []; for (let i = 0; i <= n; i++) o.push(p0.clone().lerp(p1, i / n)); return o; };
  const tTorso = JT0.parts.find((q) => q.own === 'torso');
  const solveT = (side, sg, tgs, JSx) => {
    const shT = side === 'L' ? JT0.shL : JT0.shR;
    const sTorso = JSx.parts.find((q) => q.own === 'torso');
    const herPts = [];
    for (const sd of ['L', 'R']) {
      const p0 = sd === 'L' ? JSx.shL : JSx.shR, p1 = sd === 'L' ? JSx.elbowL : JSx.elbowR, p2 = sd === 'L' ? JSx.wristL : JSx.wristR;
      herPts.push(...samp(p0, p1, 5), ...samp(p1, p2, 5).slice(1, 5));   // 她手腕那头留给「手搭前臂」，不算
    }
    const rr = dT.armR + dS.armR - 0.03;
    let bs = Infinity, best = null;
    tgs.forEach((tg, ti) => {
      const tl = toS(tg);
      const want = toW(V(sg * (dS.bodyW / 2 + dT.armR + 0.012), tl.y + 0.02, -0.15 * dS.bodyD));
      for (const el of circ(shT, tg, UT, FT)) {
        let c = el.distanceTo(want) * 0.5 + Math.max(0, el.y - shT.y + 0.02) * 3 + 0.003 * ti;
        const fore = samp(el, tg, 4), mine = [...samp(shT, el, 4).slice(2), ...fore];
        for (const p of fore) c += Math.max(0, dT.armR - 0.006 - sdf(tTorso, p)) * 8;
        for (const p of mine) {
          c += Math.max(0, dT.armR - 0.006 - sdf(sTorso, p)) * 8;
          let m = 1e9; for (const q of herPts) m = Math.min(m, p.distanceTo(q));
          c += Math.max(0, rr - m) * 6;
        }
        if (c < bs) { bs = c; best = { el, tg }; }
      }
    });
    return best;
  };
  for (const [side, sg] of [['L', 1], ['R', -1]]) {
    let bs = Infinity, bi = 0, bT = null;
    plan[side].slice(0, 20).forEach((cd, i) => {
      r.S['h' + side] = cd.h; r.S['armPole' + side] = cd.p;
      const JSx = fk(r.S, dS);
      const sol = solveT(side, sg, tgsFor(cd.tArm, sg), JSx);
      if (!sol) return;
      armTo(r.T, dT, side, sol.el, sol.tg);
      const JTx = fk(r.T, dT);
      const pa = Math.max(penetration(limbOf(JSx, side), allArms(JTx)).depth, penetration(limbOf(JTx, side), allArms(JSx)).depth);
      const pb = penetration(limbOf(JTx, side), { parts: JSx.parts.filter((q) => q.own === 'torso') }).depth;
      const ts = penetration({ parts: limbOf(JTx, side).parts.filter((q) => q.own !== 'ua') }, { parts: JTx.parts.filter((q) => q.own === 'torso') }).depth;
      const g = handGap(JSx, JTx, side);
      const ea = elbowAngleWorld(JTx, side, 1.5);
      const sc = Math.max(0, pa - 0.02) * 30 + Math.max(0, pb - 0.008) * 20 + Math.max(0, ts - 0.008) * 20 + Math.max(0, g - 0.01) * 6
        + (ea > 75 ? 1 : 0) + cd.sc * 0.3;
      if (sc < bs) { bs = sc; bi = i; bT = { h: r.T['h' + side].slice(), p: r.T['armPole' + side].slice() }; }
    });
    const cd = plan[side][bi];
    r.S['h' + side] = cd.h; r.S['armPole' + side] = cd.p;
    if (bT) { r.T['h' + side] = bT.h; r.T['armPole' + side] = bT.p; }
    plan[side] = cd;
  }
  // 收尾贴合：她的手离他前臂/手 >0.6cm 就贴上去；肘取「肩球面 ∩ 手球面」交线圆上离当前肘最近、不新增穿模的点
  const armsOf = (J, sd) => ({ parts: J.parts.filter((q) => ['ua' + sd, 'fa' + sd, 'hd' + sd].includes(q.n)) });
  const bothArms = (J) => ({ parts: J.parts.filter((q) => ['ua', 'fa', 'hd'].includes(q.own)) });
  const bodyOf = (J) => ({ parts: J.parts.filter((q) => q.own === 'torso' || q.own === 'head') });
  const circle = (sh, tg, n = 48) => {
    const ax = tg.clone().sub(sh), d = ax.length();
    if (d > U + F - 1e-4 || d < Math.abs(U - F) + 1e-4) return [];
    ax.divideScalar(d);
    const x = (d * d + U * U - F * F) / (2 * d), rho = Math.sqrt(Math.max(U * U - x * x, 0));
    const c = sh.clone().addScaledVector(ax, x);
    const v1 = (Math.abs(ax.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0)).cross(ax).normalize(), v2 = ax.clone().cross(v1);
    const out = [];
    for (let i = 0; i < n; i++) { const th = (i / n) * 2 * PI; out.push(c.clone().addScaledVector(v1, rho * Math.cos(th)).addScaledVector(v2, rho * Math.sin(th))); }
    return out;
  };
  const JTf = fk(r.T, dT);
  for (const side of ['L', 'R']) {
    const J = fk(r.S, dS), hand = J.parts.find((q) => q.n === 'hd' + side);
    let near = null, bd = Infinity;
    for (const q of JTf.parts) if (['fa', 'hd'].includes(q.own)) { const g = sdf(q, hand.c) - hand.r; if (g < bd) { bd = g; near = q; } }
    if (!near || bd <= 0.006) continue;
    let c;
    if (near.t === 'sph') c = near.c.clone();
    else { const ab = near.b.clone().sub(near.a); const t = Math.max(0, Math.min(1, hand.c.clone().sub(near.a).dot(ab) / ab.lengthSq())); c = near.a.clone().addScaledVector(ab, t); }
    const n = hand.c.clone().sub(c).normalize();
    const tg = c.addScaledVector(n, near.r + dS.handR * 0.9);
    const sh = side === 'L' ? J.shL : J.shR, el0 = side === 'L' ? J.elbowL : J.elbowR;
    const keep = { h: r.S['h' + side].slice(), p: r.S['armPole' + side].slice() };
    const pa0 = penetration(armsOf(J, side), bothArms(JTf)).depth, pb0 = penetration(armsOf(J, side), bodyOf(JTf)).depth;
    let ok = false;
    for (const el of circle(sh, tg).sort((u, v) => u.distanceTo(el0) - v.distanceTo(el0)).slice(0, 16)) {
      armTo(r.S, dS, side, el, tg);
      const J2 = fk(r.S, dS), mine = armsOf(J2, side);
      const pa = penetration(mine, bothArms(JTf)).depth, pb = penetration(mine, bodyOf(JTf)).depth;
      const ps = penetration({ parts: mine.parts.filter((q) => q.own !== 'ua') }, bodyOf(J2)).depth;
      if (pa <= Math.max(pa0, 0.015) + 0.003 && pb <= Math.max(pb0, 0.008) && ps <= 0.008 && elbowPenalty(J2, side) < 0.3) { ok = true; break; }
    }
    if (!ok) { r.S['h' + side] = keep.h; r.S['armPole' + side] = keep.p; }
  }
  return { ...r, loose: ['hd', 'fa', 'ua', 'head', 'ear'], armOnArm: true, skipAuto: ['T', 'S'], wrapArms: ['T'], hold: ['T.L', 'T.R', 'S.L', 'S.R'] };
};

// ---------- 10 壁咚：墙在左(x=0)，S 背靠墙，T 近侧手臂撑墙把 S 圈在里面 ----------
export const wallPin = (dT, dS) => {
  const S = base(dS, 0.2, 0, PI / 2);
  S.head = [-0.18, 0, 0];
  settleBack(S, dS, 0.004);
  const JS0 = fk(S, dS);
  const sHeadY = JS0.headC.y;
  const D0 = (dT.headR + dS.headR);
  const cands = grid([1.0, 1.1, 1.25, 1.45], [0.30, 0.15, 0.45]);
  const build = ([m, dyr]) => {
    const T = base(dT, 1, 0, -PI / 2);
    const D = D0 * m, dy = dyr * D;
    const b = bendForHeadY(T, dT, sHeadY + dy, 1.1);
    T.lean = [0, b];
    const JT0 = fk(T, dT);
    const dx = Math.sqrt(Math.max(D * D - dy * dy, 1e-4));
    T.p = [JS0.headC.x + dx - (JT0.headC.x - 1), dT.leg, 0];
    feetStand(T, dT); handsHang(T, dT);
    T.head = [Math.asin(dy / D) - b + 0.12, 0, 0];
    return { T, S };
  };
  const r = pick(cands, build, dT, dS);
  const JT = fk(r.T, dT);
  // 近侧(L, +z)手撑墙，高度略高于 S 头顶
  const handY = sHeadY + dS.headR + 0.10 * dT.h;
  const wallTgts = [0.0, 0.03, 0.06].map((k) => V(dT.handR * 0.9, handY - k * dT.h, JT.shL.z + 0.01));
  fitArm(r.T, dT, 'L', wallTgts, fk(r.S, dS), [[0, 0.6, 0.8], [0, 1, 0.3], [0.3, 0.9, 0.6]]);
  // S：双手轻轻抵在他胸口（壁咚里最常见的回应），肘贴着身体两侧往下垂，不往外撇。
  // 之前是双手攥在小腹前，肘被迫向两边翻开，看起来像肚子疼。
  const sc = fk(r.S, dS), JT2 = fk(r.T, dT);
  const fT = V(0, 0, 1).applyQuaternion(JT2.Qc);
  const chest = (k, dz) => JT2.P.clone().addScaledVector(JT2.upC, k * dT.torso).addScaledVector(fT, dT.bodyD / 2 + dS.handR * 0.95).add(V(0, 0, dz));
  for (const [side, sg] of [['L', -1], ['R', 1]]) {          // S 朝 +x：左手在世界 -z
    const shS = side === 'L' ? sc.shL : sc.shR;
    const wantEl = shS.clone().add(V(0.02 * dS.h, -dS.upper * 0.92, sg * 0.01));
    placeLimb(r.S, dS, 'arm', side, JT2, wantEl, [0.62, 0.52, 0.72, 0.42].map((k) => chest(k, sg * 0.055)), { allow: 0.02 });
  }
  return { ...r, props: [{ type: 'wall', x: 0 }], loose: ['hd', 'fa', 'ua', 'head', 'ear', 'torso'], skipAuto: ['S'], hold: ['S.L', 'S.R'] };
};
// 把 s 的所有部件平移，使整体最靠 -x 的点恰好到 wallX+margin（背靠墙）
function settleBack(s, d, margin) {
  const J = fk(s, d); let mn = 1e9;
  for (const p of J.parts) {
    if (p.t === 'sph') mn = Math.min(mn, p.c.x - p.r);
    else if (p.t === 'cap') mn = Math.min(mn, p.a.x - p.r, p.b.x - p.r);
    else for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) mn = Math.min(mn, p.c.clone().add(V(sx * p.hx, sy * p.hy, sz * p.hz).applyQuaternion(p.q)).x);
  }
  shift(s, V(margin - mn, 0, 0));
}

// ---------- 11 背背：T 站立微前倾，S 趴在他背上，双臂越过双肩搭在胸前 ----------
// 按参考实现 onbu 几何重做（piggyback-simulator 的 setupPiggyback）：
//   两人同角度前倾；S 的骨盆沿 T 躯干坐标「抬升 + 贴住后背」；S 大腿外展绕过 T 躯干宽度、
//   向前夹腰、小腿垂下；T 双手兜住 S 大腿外侧；S 双手越过 T 双肩搭在 T 胸前。
// 两处按我们的模型改过（参考实现躯干薄、头小）：
//   ① 我们躯干厚、臂短（臂展 0.34h）→ 托手改成"贴大腿外侧"，肘用 placeLimb 显式外张；
//      fitArm 的肘自然度打分会把肘往内压，逼出十几厘米穿模，不能用。
//   ② 我们头大（半径 0.09h）→ S 必须坐得比参考高才不撞头，所以 yAk 取 0.14~0.20。
//   ③ 选解打分直接对齐 check_try.mjs 的口径（穿模容差/自碰/够不到/手悬空/头间隙），
//      不用 pick2 —— pick2 的口径和验收脚本不一致，会挑出验收不过的解。
// 参数：[lean 前倾角, yAk 骨盆抬升(×T身高), gap 背间隙, fwd 大腿前摆角, abdMin 外展下限,
//        hk 托手沿大腿比例, sideOff S 侧移(×S身高)]
const ARM_OWN = ['ua', 'fa', 'hd'];
const PIGGY_TOL = { hd: 0.02, fa: 0.02, ua: 0.02, head: 0.02, ear: 0.012, th: 0.02, sh: 0.02, torso: 0.02, def: 0.012 };
const PIGGY_LOOSE = ['hd', 'fa', 'ua', 'head', 'ear', 'torso', 'th', 'sh'];

// 与 check_try.mjs 同口径的容差（carry 姿势、无 headTouch）
function piggyTol(oa, ob) {
  const hs = (x, l) => l.includes(x);
  if ((hs(oa, ['hd', 'fa']) && hs(ob, ['th', 'sh'])) || (hs(ob, ['hd', 'fa']) && hs(oa, ['th', 'sh']))) return 0.05;
  if ((hs(oa, ['th', 'sh']) && ob === 'torso') || (hs(ob, ['th', 'sh']) && oa === 'torso')) return 0.058;
  if (oa === 'hd' && ob === 'hd') return 0.06;
  if (oa === 'hd' || ob === 'hd') return 0.035;
  const t = (p) => (PIGGY_LOOSE.includes(p) ? PIGGY_TOL[p] : PIGGY_TOL.def);
  return Math.max(t(oa), t(ob));
}

export function piggyScore(JT, JS, dT, dS, brk = null) {
  const own = (J, n) => J.parts.find((x) => x.n === n)?.own;
  let s = 0, last = 0;
  const mark = (k) => { if (brk) brk[k] = +(s - last).toFixed(3); last = s; };
  for (const [pp, A, B] of [[penetration(JT, JS), JT, JS], [penetration(JS, JT), JS, JT]]) {
    if (pp.depth <= 0) continue;
    const t = piggyTol(own(A, pp.a), own(B, pp.b));
    if (pp.depth > t) s += (pp.depth - t) * 40;
  }
  mark('互穿');
  for (const [J, air] of [[JT, false], [JS, true]]) {
    const sp = selfPen(J); if (sp.depth > 0.02) s += (sp.depth - 0.02) * 40;
    mark(air ? '她自碰' : '他自碰');
    const g = groundMin(J);
    if (g < -0.006) s += (-g - 0.006) * 40;
    if (g > 0.03 && !air) s += (g - 0.03) * 10;
    for (const k of Object.keys(J.miss)) if (J.miss[k] > (k[0] === 'f' ? 0.035 : 0.012)) s += J.miss[k] * 20;
    mark(air ? '她够不到/地面' : '他够不到/地面');
  }
  for (const J0 of [JT, JS]) {
    for (const sd of ['L', 'R']) {
      const ea = elbowAngleWorld(J0, sd, 1.5); if (ea > 80) s += (ea - 80) * 0.08;
      const ka = kneeAngle(J0, sd); if (ka > 85) s += (ka - 85) * 0.08;
    }
  }
  mark('关节方向');
  for (const h of ['T.L', 'T.R', 'S.L', 'S.R']) {
    const [who, sd] = h.split('.'); const J = who === 'T' ? JT : JS, O = who === 'T' ? JS : JT;
    const hand = J.parts.find((q) => q.n === 'hd' + sd); let g = 1e9;
    for (const q of O.parts) if (['torso', 'head', 'ear', 'ua', 'fa', 'hd', 'th', 'sh'].includes(q.own)) g = Math.min(g, sdf(q, hand.c) - hand.r);
    if (g > 0.03) s += (g - 0.03) * 40;
    if (g > 0.01) s += (g - 0.01) * 8;
  }
  mark('手悬空');
  return s;
}

const fibSphere = (n) => Array.from({ length: n }, (_, i) => {
  const y = 1 - 2 * (i + 0.5) / n, r = Math.sqrt(Math.max(0, 1 - y * y)), a = i * 2.39996;
  return [r * Math.cos(a), y, r * Math.sin(a)];
});
const PIGGY_POLES = fibSphere(34);

// 她(S)的双臂：手落在他(T)胸前，肘搭过他肩头。候选 = 胸前落点 x 肘极向量球面采样，
// 打分 = piggyScore（与检测同口径）+ 手臂贴身项（前臂贴胸、上臂贴肩）。
function piggySArms(S, dS, T, dT) {
  const JT = fk(T, dT);
  const tparts = JT.parts.filter((q) => ['torso', 'head', 'ua'].includes(q.own));
  const gBody = (pt) => { let g = 1e9; for (const q of tparts) g = Math.min(g, sdf(q, pt)); return g; };
  for (const [sd, sg] of [['L', 1], ['R', -1], ['L', 1], ['R', -1]]) {   // 摆两轮：第二轮另一侧已就位，本侧的穿模才不会被盖住
    const pk = sd === 'L' ? 'armPoleL' : 'armPoleR';
    const front = [];
    for (const hf of [0.82, 0.72, 0.62]) for (const xf of [0.22, 0.34]) {
      front.push(loc(JT, V(sg * xf * dT.bodyW, hf * dT.torso, dT.bodyD / 2 + dS.handR * 0.85)));
    }
    // 兜底落点：手搭在他肩头上沿（胸太厚 / 她手臂太短，前臂绕不到胸前时用）
    const top = [];
    for (const xf of [0.3, 0.4]) for (const zf of [0.05, 0.3]) {
      top.push(loc(JT, V(sg * xf * dT.bodyW, dT.torso + dS.handR * 0.75, zf * dT.bodyD)));
    }
    // 侧前方落点：手搭在他肩头前侧/上臂前面（宽胸 + 她手臂短时，前臂绕不到胸口中线，硬够会斜切过他的前侧角）
    for (const hf of [0.9, 0.8]) for (const xf of [0.5, 0.62]) {
      top.push(loc(JT, V(sg * xf * dT.bodyW, hf * dT.torso, dT.bodyD / 2 + dS.handR * 0.6)));
    }
    let best = null, bs = Infinity;
    const run = (ends, off) => {
      for (let ei = 0; ei < ends.length; ei++) {
        touch(S, dS, sd, ends[ei]);
        for (const pl of PIGGY_POLES) {
          S[pk] = pl.slice();
          const J = fk(S, dS);
          let sc = piggyScore(JT, J, dT, dS) + 0.02 * (ei + off);
          const fa = J.parts.find((q) => q.n === 'fa' + sd), ua = J.parts.find((q) => q.n === 'ua' + sd);
          sc += 12 * Math.max(0, gBody(fa.a.clone().lerp(fa.b, 0.5)) - fa.r - 0.012);
          sc += 6 * Math.max(0, gBody(ua.a.clone().lerp(ua.b, 0.5)) - ua.r - 0.02);
          // 本侧手臂单独的穿模罚分（容差与检测一致：前臂/上臂 vs 躯干 1.5cm，手 3cm）
          const armPen = (names, thr) => {
            const ps = J.parts.filter((q) => names.includes(q.n));
            return 40 * Math.max(0, penetration({ parts: ps }, { parts: tparts }).depth - thr);
          };
          sc += armPen([`ua${sd}`, `fa${sd}`], 0.015) + armPen([`hd${sd}`], 0.03);
          if (sc < bs) { bs = sc; best = { pl: pl.slice(), end: ends[ei] }; }
        }
      }
    };
    run(front, 0);
    if (bs > 0.3) run(top, front.length);
    S[pk] = best.pl; touch(S, dS, sd, best.end);
  }
}

export const piggybackBuild = (dT, dS, [lean, yAk, gap, fwd, abdMin, hk, sideOff], { arms = true, sPitch = null, headT = null, headS = null, sArms = null, legOut = 0.025 } = {}) => {
  const T = base(dT, 0, 0, -PI / 2);
  T.lean = [0, lean];
  footAt(T, dT, 'L', -0.05 * dT.h, dT.hw * 0.95, dT.footR + 0.002);
  footAt(T, dT, 'R', 0.04 * dT.h, -dT.hw * 0.95, dT.footR + 0.002);
  T.head = headT ? headT.slice() : [-lean + 0.05, 0, 0];
  const JT = fk(T, dT);
  const back = dT.bodyD / 2 + dS.bodyD / 2 + gap;
  const P = loc(JT, V(0, yAk * dT.h, -back));
  const S = base(dS, 0, 0, -PI / 2);
  const side = rotY(-PI / 2, sideOff * dS.h, 0, 0);
  S.p = [P.x + side.x, P.y, P.z + side.z];
  S.lean = [0, lean];
  S.pitch = [sPitch ?? (lean + 0.05)];
  S.head = headS ? headS.slice() : [-lean + 0.1, -sideOff * 0.9, -sideOff * 0.9];
  const JS = fk(S, dS);
  const xT = dT.bodyW / 2 + dS.legR + legOut;
  const abd = Math.asin(Math.max(abdMin, Math.min(0.95, (xT - dS.hw) / dS.thigh)));
  const dirs = {};
  for (const [sd, sg] of [['L', 1], ['R', -1]]) {
    const u = V(sg * Math.sin(abd), -Math.cos(abd) * Math.cos(fwd), Math.cos(abd) * Math.sin(fwd)).normalize();
    const lo = V(-sg * 0.05, -1, -0.25).normalize();
    const uW = rotY(-PI / 2, u.x, u.y, u.z), loW = rotY(-PI / 2, lo.x, lo.y, lo.z);
    const hip = sd === 'L' ? JS.hipL : JS.hipR;
    set(S, sd === 'L' ? 'fL' : 'fR', hip.clone().addScaledVector(uW, dS.thigh).addScaledVector(loW, dS.shin));
    S[sd === 'L' ? 'kneePoleL' : 'kneePoleR'] = sd === 'L' ? [u.x, u.y, u.z] : [-u.x, u.y, u.z];
    dirs[sd] = { hip, uW, sg };
  }
  if (arms) {
    // 他托大腿：每次都带着她「当前」的手臂重摆（她的手臂垂在腿侧会把他的手挤开 3~5cm）
    const placeT = () => {
      const JSn = fk(S, dS);
      for (const [sd, sg] of [['L', 1], ['R', -1]]) {
        const { hip, uW } = dirs[sd];
        const o = rotY(-PI / 2, sg, 0, 0);                       // T 的外侧
        const pk = sd === 'L' ? 'armPoleL' : 'armPoleR';
        const K = [hk - 0.12, hk, hk + 0.12].map((k) => Math.max(0.05, Math.min(0.95, k)));
        const ends = K.map((k) => hip.clone().addScaledVector(uW, dS.thigh * k)
          .addScaledVector(o, dS.legR + dT.handR * 0.95)
          .add(V(0, -dS.legR * 0.1, 0)));
        let best = null, bs = Infinity;
        ends.forEach((end, ei) => {
          touch(T, dT, sd, end);
          for (const pl of PIGGY_POLES) {
            T[pk] = pl.slice();
            const sc = piggyScore(fk(T, dT), JSn, dT, dS) + 0.01 * ei;
            if (sc < bs) { bs = sc; best = { pl: pl.slice(), end }; }
          }
        });
        T[pk] = best.pl; touch(T, dT, sd, best.end);
      }
    };
    placeT();
    if (sArms) { sArms(S, dS, T, dT); placeT(); }
  }
  return { T, S };
};

// 躯干贴合度：只统计 S 躯干正面落在「T 躯干高度范围内」的点（她躯干上半截高过他肩，本来就碰不到他背）。
// 返回 { mn, mx, n, m }：范围内点数 m、其中贴住(-1.2cm~2.5cm)的点数 n、最小/最大有符号间隙
function piggyGap(JT, JS) {
  const tt = JT.parts.find((q) => q.own === 'torso'), st = JS.parts.find((q) => q.own === 'torso');
  const tu = V(0, 1, 0).applyQuaternion(tt.q), tb = tt.c.clone().addScaledVector(tu, -tt.hy);
  let mn = 1e9, mx = -1e9, n = 0, m = 0;
  for (let k = 0; k < 9; k++) {
    const t = -0.9 + 0.225 * k;
    const pt = st.c.clone().add(V(0, t * st.hy, st.hz).applyQuaternion(st.q));
    const h = pt.clone().sub(tb).dot(tu);
    if (h < 0.03 || h > 2 * tt.hy - 0.03) continue;
    const g = sdf(tt, pt); m++; mn = Math.min(mn, g); mx = Math.max(mx, g);
    if (g > -0.012 && g < 0.025) n++;
  }
  return { mn, mx, n, m };
}

// 参考体型下的快速拟合（不摆手臂）：
//   先挑「身体」(骨盆抬升/背间隙/她的前倾角)：躯干与大腿零违规、尽量整面贴背；
//   再对前几名搜「头位」(他低头/偏头、她低头/偏头/歪头)：头类零违规(检测口径 2cm)、头位尽量自然。
function piggyFit(dT, dS, lean) {
  const viol = (JT, JS, keep) => {
    let v = 0;
    for (const [A, B] of [[JT, JS], [JS, JT]]) for (const a of A.parts) {
      if (!keep.includes(a.own)) continue;
      for (const b of B.parts) {
        if (!keep.includes(b.own)) continue;
        const d = penetration({ parts: [a] }, { parts: [b] }).depth, t = piggyTol(a.own, b.own);
        if (d > t) v += d - t;
      }
    }
    return v;
  };
  const scan = (yAks, gaps, fwds, outs) => {
    const list = [];
    for (const fwd of fwds) for (const legOut of outs) for (const yAk of yAks) for (const gap of gaps)
      for (const sPitch of [0, lean * 0.5, lean, lean + 0.05]) {
        const { T, S } = piggybackBuild(dT, dS, [lean, yAk, gap, fwd, 0.15, 0.32, 0], { arms: false, sPitch, legOut });
        T.head = [0.5, 0, 0]; S.head = [-0.3, -0.2, -0.05];
        const JT = fk(T, dT), JS = fk(S, dS);
        const g = piggyGap(JT, JS);
        const v = viol(JT, JS, ['torso', 'th', 'sh']);
        const cost = (v > 1e-9 ? 100 + v * 100 : 0) + (g.m ? (g.m - g.n) * 1.2 + (g.mn < -0.008 ? (-0.008 - g.mn) * 30 : 0) : 20)
          + yAk * 2 + Math.abs(sPitch - lean) * 1.5 + (0.8 - fwd) * 0.8 + (legOut - 0.025) * 6;
        list.push({ cost, yAk, gap, sPitch, fwd, legOut, g, v });
      }
    return list;
  };
  const headSearch = (bodies) => {
    bodies.sort((x, y) => x.cost - y.cost);
    let best = null;
    for (const b of bodies.slice(0, 5)) {
      const { T, S } = piggybackBuild(dT, dS, [lean, b.yAk, b.gap, b.fwd, 0.15, 0.32, 0], { arms: false, sPitch: b.sPitch, legOut: b.legOut });
      for (const tp of [0.2, 0.5, 0.8]) for (const ty of [-0.5, 0, 0.5]) {
        T.head = [tp, ty, 0];
        const JT = fk(T, dT);
        for (const sp of [-0.3, -0.6, -0.95]) for (const sy of [-0.2, -0.7, -1.2, 0.5]) for (const sr of [-0.05, -0.4, 0.4]) {
          S.head = [sp, sy, sr];
          const JS = fk(S, dS);
          const v = viol(JT, JS, ['head', 'ear', 'torso', 'th', 'sh']);
          const cost = b.cost + (v > 1e-9 ? 100 + v * 100 : 0) + tp * 0.3 + Math.abs(ty) * 0.4 + Math.abs(sp) * 0.2 + Math.abs(sy + 0.2) * 0.15 + Math.abs(sr + 0.05) * 0.6;
          if (!best || cost < best.cost) best = { cost, v, yAk: b.yAk, gap: b.gap, sPitch: b.sPitch, fwd: b.fwd, legOut: b.legOut, tp, ty, sp, sy, sr, ...b.g };
        }
      }
    }
    return best;
  };
  // 第一轮：常规候选（快）；仍有违规时第二轮放宽：骨盆可更高、腿更向外、大腿更向下
  let bodies = scan([0.07, 0.09, 0.11, 0.13, 0.15, 0.18, 0.21], [0, 0.01, 0.02, 0.035], [0.8], [0.025]);
  let best = headSearch(bodies);
  if (best.v > 1e-9) {
    bodies = bodies.concat(scan([0.07, 0.11, 0.15, 0.19, 0.24, 0.28], [0.01, 0.02, 0.035], [0.8, 0.5, 0.25], [0.025, 0.06, 0.09]));
    best = headSearch(bodies);
  }
  return best;
}

export const piggyback = (dT0, dS0) => {
  // 参考体型(refDims) + 无脚。先拟合身体与头位(整面贴背、头类零违规)，
  // 再摆手臂：他托她大腿外侧，她双臂越过他肩头、手落在他胸前；两边互相带着对方的手臂重摆。
  const dT = { ...dT0, noFeet: true }, dS = { ...dS0, noFeet: true };   // 与其他姿势同一套标准体型，只去脚
  setQuick(false);   // 托手 placeLimb 必须在 QUICK=false 下解
  const lean = Math.max(0.06, Math.min(0.14, 0.1 * (1.7 / dT.h) ** 0.5));
  const fit = piggyFit(dT, dS, lean);
  const r = piggybackBuild(dT, dS, [lean, fit.yAk, fit.gap, fit.fwd, 0.15, 0.32, 0],
    { arms: true, legOut: fit.legOut, sPitch: fit.sPitch, headT: [fit.tp, fit.ty, 0], headS: [fit.sp, fit.sy, fit.sr], sArms: piggySArms });
  r.fit = fit;
  return { ...r, loose: PIGGY_LOOSE, air: ['S'], skipAuto: ['T', 'S'],
    noNat: true, carry: true, wrapArms: ['T', 'S'], hold: ['T.L', 'T.R', 'S.L', 'S.R'], bodyT: dT, bodyS: dS };
};

// ---------- 12 拦腰抱起：T 双手托住 S 腰侧，S 双脚离地，手搭在 T 肩上 ----------
export const lift = (dT, dS) => {
  const cands = grid([0.36, 0.28, 0.44], [0.0, 0.18, 0.3], [0.04, 0.10, 0.18]);
  const build = ([lf, lb, gx]) => {
    const T = base(dT, 0, 0, -PI / 2);
    T.lean = [0, -lb]; T.head = [lb + 0.15, 0, 0];
    const S = base(dS, 0, 0, PI / 2);
    const gapX = dT.bodyD / 2 + dS.bodyD / 2 + gx;
    const JT0 = fk(T, dT);
    S.p = [JT0.P.x - gapX - (lb > 0 ? 0 : 0), dS.leg + lf * dS.h / 1.63, 0];
    const JS0 = fk(S, dS);
    const hip = JS0.hipL.clone().add(JS0.hipR).multiplyScalar(0.5);
    const foot = (sx) => hip.clone().add(rotY(PI / 2, sx * dS.hw, -0.82 * dS.leg, -0.10 * dS.h));
    set(S, 'fL', foot(1)); set(S, 'fR', foot(-1));
    S.kneePoleL = [0, 0, 1]; S.kneePoleR = [0, 0, 1];
    S.head = [0.12, 0, 0];
    return { T, S };
  };
  const r = pick(cands, build, dT, dS);
  const JS = fk(r.S, dS), JT = fk(r.T, dT);
  // T：双手托在 S 腰两侧（T 左=+z）
  const wy = JS.P.y + 0.10 * dS.torso, wz = dS.bodyW / 2 + dT.handR * 0.7;
  fitArm(r.T, dT, 'L', [V(JS.P.x, wy, wz), V(JS.P.x - 0.03, wy - 0.03, wz + 0.02)], JS);
  fitArm(r.T, dT, 'R', [V(JS.P.x, wy, -wz), V(JS.P.x - 0.03, wy - 0.03, -wz - 0.02)], JS);
  // S：双手搭在 T 颈肩交界处（S 右=+z）
  const nb = (sg, dx, up, dz) => JT.neckTop.clone().addScaledVector(JT.upC, -0.012 * dT.h + up).add(V(dx, 0, sg * (dT.neckR + dS.handR * 0.9 + dz)));
  const tg = (sg) => [[0.0, 0.0, 0.0], [0.03, 0.02, 0.01], [-0.03, 0.02, 0.02], [0.0, 0.04, 0.04]].map(([dx, up, dz]) => nb(sg, dx, up, dz));
  const placeS = (JO, at) => { fitArm(r.S, dS, 'R', tg(1), JO, [[0.3, 0.6, 0.6], [0, 1, 0.3]], at); fitArm(r.S, dS, 'L', tg(-1), JO, [[0.3, 0.6, -0.6], [0, 1, -0.3]], at); };
  placeS(JT, false);
  fitArm(r.T, dT, 'L', [V(JS.P.x, wy, wz), V(JS.P.x - 0.03, wy - 0.03, wz + 0.02), V(JS.P.x - 0.05, wy + 0.03, wz + 0.03)], fk(r.S, dS), [], true);
  fitArm(r.T, dT, 'R', [V(JS.P.x, wy, -wz), V(JS.P.x - 0.03, wy - 0.03, -wz - 0.02), V(JS.P.x - 0.05, wy + 0.03, -wz - 0.03)], fk(r.S, dS), [], true);
  placeS(fk(r.T, dT), true);
  return { ...r, loose: ['hd', 'fa', 'ua', 'head', 'ear', 'torso'], air: ['S'] };
};

// ---------- 13 躺在一起：卧室里并排躺在床上，头枕枕头，近侧手相握，俯拍机位 ----------
const BED_TOP = 0.45;                                          // 床面高度（与床咚一致）
// 仰躺在 floorY 高度的平面上，头朝 -x；头前屈 flex 后枕在枕头上，返回头底离床面的高度（=枕头需要的厚度）
function lieDown(s, d, headX, z, floorY = 0, flex = null) {
  s.yaw = [PI / 2]; s.pitch = [-PI / 2]; s.roll = [0]; s.lean = [0, 0];
  s.p = [headX + 0.55 * d.h, floorY + d.bodyD / 2 + 0.003, z];
  let lift = 0;
  if (flex == null) {                                          // 躺地：头刚好贴地
    let lo = 0, hi = PI / 2 + 0.3;
    const tmp = { ...s, head: [0, 0, 0] };
    for (let i = 0; i < 40; i++) {
      const m = (lo + hi) / 2; tmp.head = [m, 0, 0];
      const J = fk(tmp, d);
      if (J.headC.y - d.headR > floorY + 0.003) hi = m; else lo = m;
    }
    s.head = [(lo + hi) / 2, 0, 0];
  } else {
    s.head = [flex, 0, 0];
    lift = Math.max(fk(s, d).headC.y - d.headR - floorY, 0);
  }
  const J = fk(s, d);
  const y = floorY + d.legR + 0.002, reach = (d.thigh + d.shin) * 0.995;
  set(s, 'fL', V(J.hipL.x + reach, y, J.hipL.z));
  set(s, 'fR', V(J.hipR.x + reach, y, J.hipR.z));
  s.kneePoleL = [0, 0, 1]; s.kneePoleR = [0, 0, 1];
  return lift;
}
export const lying = (dT, dS) => {
  const X0 = -0.2, B = BED_TOP, FLEX = 0.75;
  const sep = dT.sw + dS.sw + dT.armR + dS.armR + 0.11;
  const T = base(dT, 0, 0), S = base(dS, 0, 0);
  const liftT = lieDown(T, dT, X0, -sep / 2, B, FLEX);
  const liftS = lieDown(S, dS, X0, sep / 2, B, FLEX);
  const JT = fk(T, dT), JS = fk(S, dS);
  // 躺着时躯干局部 +x 指向世界 -z。S 躺在 +z 侧、T 躺在 -z 侧：中间两只手（S.L、T.R）相握，外侧两只手放在身侧床面
  // 躺着时手臂几乎伸直、贴着身体放在床面：手腕离肩的距离取 0.93 臂长，肘自然略微外弯（极点朝外侧水平方向）
  const ay = B + Math.max(dT.armR, dS.armR) + 0.004;
  const armEnd = (J, side, zdir, k) => { const sh = side === 'L' ? J.shL : J.shR; return V(sh.x + k * J.d.arm, ay, sh.z + zdir * J.d.armR * 2.2); };
  const hx = Math.min(JS.shL.x + 0.90 * dS.arm, JT.shR.x + 0.90 * dT.arm);   // 牵手位置取两人都够得到的最远处，手臂近乎伸直贴床
  const zm = (JT.shR.z + JS.shL.z) / 2;
  set(S, 'hL', V(hx, ay + 0.012, zm + 0.5 * dS.handR + 0.004));
  set(T, 'hR', V(hx, ay + 0.012, zm - 0.5 * dT.handR - 0.004));
  set(S, 'hR', armEnd(JS, 'R', 1, 0.93));
  set(T, 'hL', armEnd(JT, 'L', -1, 0.93));
  // 躺着时躯干局部 +z 指向世界「上」，+y 指向世界 -x（朝脚的反方向），+x 指向世界 -z。
  // 肘只朝「世界上」微微弓起，手臂贴床伸展：极点 = 局部 +z（略偏外侧）
  S.armPoleR = [-0.25, 0, 1]; S.armPoleL = [0.25, 0, 1];
  T.armPoleL = [-0.25, 0, 1]; T.armPoleR = [0.25, 0, 1];
  // 床：床头板留在耳朵/头顶之后，床尾留 35cm；宽度容得下两人加外侧手臂
  const JT2 = fk(T, dT), JS2 = fk(S, dS);
  const xmin = Math.min(extent(JT2, 'x')[0], extent(JS2, 'x')[0]);
  const xl = xmin - 0.14, len = Math.max(dT.h, dS.h) + (X0 - xl) + 0.4;
  const halfSpan = sep / 2 + Math.max(dT.sw, dS.sw) + 2.2 * Math.max(dT.armR, dS.armR) + Math.max(dT.handR, dS.handR) + 0.14;
  const wid = Math.max(1.5, 2 * halfSpan);
  const bed = { type: 'box', c: [xl + len / 2, B / 2, 0], s: [len / 2, B / 2, wid / 2], color: 0xe9e2f0 };
  const pw = Math.min(0.56, sep - 0.03);
  // 枕头尾端收在肩膀（躯干起点）之前，不压进躯干；头仍整个落在枕头上
  const pillows = [[JT2, dT, -sep / 2, liftT], [JS2, dS, sep / 2, liftS]].map(([J, d, z, lift]) => {
    const tx = Math.min(...J.parts.filter((q) => q.n === 'torso' || q.own === 'ua').map((q) => extent({ parts: [q] }, 'x')[0])), w = 0.42;
    return { w, d: pw, h: Math.max(lift + 0.012, 0.045), at: [Math.min(J.headC.x + 0.02, tx - 0.004 - w / 2), 0, z] };
  });
  return { T, S, props: [bed], pillows, loose: ['hd', 'fa', 'ua', 'head', 'ear', 'torso'], cam: { top: true, topEl: 1.02 }, floorLevel: true, noNat: true, groundOK: true, noAuto: true, air: ['T', 'S'] };
};

// ---------- 14 共戴围巾：并肩站近，头微靠，一条长围巾绕过两人脖颈（手臂自然垂放，不抢戏）----------
export const scarf = (dT, dS) => {
  const sep = dT.sw + dS.sw + 0.13 * Math.min(dT.h, dS.h);       // 与「并排站立」同一间距（已验证无穿模）
  const T = base(dT, sep / 2, 0), S = base(dS, -sep / 2, 0);
  T.head = [0.0, 0.0, 0.12]; S.head = [0.0, 0.0, -0.12];
  const r = { T, S };
  const JT = fk(r.T, dT), JS = fk(r.S, dS);
  // 围巾套在颈根、搭在肩上（不往上顶到下巴）：中心=肩线上方 1/4 颈长
  const cT = JT.shC.clone().addScaledVector(JT.upC, 0.25 * dT.neck);
  const cS = JS.shC.clone().addScaledVector(JS.upC, 0.25 * dS.neck);
  // 围巾参数照 sharing-a-scarf-simulator 的 createMuffler（render.js 的 makeScarf 负责建网格）：
  //  环半径 = 脖半径 + 0.035，z 向拉长 1.25（椭圆）；幅宽 0.14、厚 0.012；喇叭口 0.012/0.14
  //  前拱 front = max(躯干厚)×0.55 + 0.04；桥长 = √(直线距²+高差²)×1.15；下垂 = max(0.20, 桥长×0.55)
  //  总长 2.2，垂尾合计 = max(0.2, 2.2 − (环周长A + 环周长B + 桥长))，按身高比分给两人
  //  幅宽：原作 0.14 对应其颈长 0.05h（h=1.7 时 0.085），即幅宽≈1.65×颈长；我们的颈只有 0.04h，
  //  照搬 0.14 会让带子上沿顶进头球，所以保持「幅宽/颈长」比不变，按较矮者的颈长缩放。
  const wd = 0.14 * Math.min(dT.neck, dS.neck) / 0.085;
  const rT = dT.neckR + 0.035, rS = dS.neckR + 0.035;
  const frontOff = Math.max(dT.bodyD, dS.bodyD) * 0.55 + 0.04;
  const bdx = Math.abs(cT.x - cS.x) - rS - rT, bdy = Math.abs(cT.y - cS.y);       // 内侧接触点之间的水平/竖直距
  const bridgeLen = Math.hypot(bdx, bdy, bdy) * 1.15;                               // 原作：√(directDist²+heightDiff²)×1.15，dy 重复计入
  const remain = Math.max(0.2, 2.2 - (2 * Math.PI * rS + 2 * Math.PI * rT + bridgeLen));
  const props = [{
    type: 'scarf', w: wd, th: 0.012, zs: 1.25, flare: 0.012 / 0.14, front: frontOff, loose: 1.15, sagMin: 0.20, sagK: 0.55,
    necks: [
      { c: [cS.x, cS.y, cS.z], r: rS, h: dS.h, tail: remain * dS.h / (dS.h + dT.h) },
      { c: [cT.x, cT.y, cT.z], r: rT, h: dT.h, tail: remain * dT.h / (dS.h + dT.h) },
    ],
  }];
  return { ...r, props, loose: ['hd', 'fa', 'ua', 'head', 'ear'], armOnArm: true };
};
