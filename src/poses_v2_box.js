// 新增姿势：纸箱。两人一起缩在一只无顶敞口纸箱里（灵感：hakozume-simulator 箱詰めシミュレーター 的「坐在膝间」族，不移植它的 SAT+退火求解器）。
// 约定同其它姿势：矮个 S、高个 T，两人都面朝 +x（侧视构图），左侧在 -z。
//   S：抱膝坐在箱内前侧（+x）：臀贴地、双膝抬到胸前、双臂环着小腿；
//   T：屈膝跪坐在她身后（-x）：双膝落地并向两侧分开、把她的髋夹在两膝之间，上身前倾贴着她的背，双臂从两侧绕到她身前环住她的膝盖。
// 纸箱按两人实际占位自适应：箱内 xz = 人体包围盒 + 余量，宽度（z）不小于两人躯干宽之和+余量；壁高约到矮个胸口。
// 求解方式：解析摆腿（legTo + 解析膝）→ 小网格挑穿模/关节自然度最小 → 整肢放置手臂（placeLimb）。
import { V, fk, penetration, selfPen, sdf } from './model.js';
import { PI, base, legTo, placeLimb, setQuick, approach, extent, shift, elbowPenaltyWorld, kneePenalty, grid2 } from './poseutil.js';

const LOOSE = ['hd', 'fa', 'ua', 'head', 'ear', 'torso', 'th', 'sh'];
export const CARTON_PAD = 0.05;     // 人体到箱内壁的最小余量（m）
export const CARTON_WALL = 0.015;   // 壁厚

// 膝/肘：两段等长，落在「根-末端」连线中点沿 pref 垂偏处
function midJoint(a, b, L, pref) {
  const ax = b.clone().sub(a), D = ax.length();
  ax.normalize();
  const mid = a.clone().addScaledVector(ax, D / 2);
  const hgt = Math.sqrt(Math.max(L * L - (D / 2) ** 2, 0));
  const p = pref.clone().addScaledVector(ax, -pref.dot(ax));
  if (p.lengthSq() < 1e-8) return mid;
  return mid.addScaledVector(p.normalize(), hgt);
}
const SG = { L: -1, R: 1 };                                   // 面朝 +x：左侧在 -z
const own = (...names) => (p) => names.includes(p.own);

// S：坐地抱膝。bS=上身前弯，fS=脚到臀的前伸距离（身高倍数）
function seatS(dS, bS, fS) {
  const S = base(dS, 0, 0, PI / 2);
  S.p = [0, dS.legR + 0.003, 0];
  S.lean = [0, bS];
  S.head = [0.12, 0, 0];
  const J0 = fk(S, dS);
  for (const [side, hip] of [['L', J0.hipL], ['R', J0.hipR]]) {
    const sg = SG[side];
    const foot = V(hip.x + fS * dS.h, dS.footR + 0.002, sg * (dS.legR + 0.01));
    legTo(S, dS, side, midJoint(hip, foot, dS.thigh * 0.995, V(0.1, 1, sg * 0.3)), foot);
  }
  return S;
}

// T：跪坐在 S 身后。膝盖落地：膝在髋前方 kx、侧向 kz（身高倍数），髋高由大腿几何反推；小腿贴地向后、脚略内收。
function seatT(dT, S, dS, c) {
  const T = base(dT, -0.7, 0, PI / 2);
  const kx = c.kx * dT.h, kz = c.kz * dT.h, ky = dT.legR + 0.003;
  const th = dT.thigh * 0.995, dzk = kz - dT.hw;
  const dy = Math.sqrt(Math.max(th * th - kx * kx - dzk * dzk, 0.0004));
  T.p = [-0.7, ky + dy, 0];
  T.lean = [0, c.bT];
  T.head = [0.25, 0, 0];
  // 先把腿摆好再整体后退到「T 的躯干/头/腿」与「S 的躯干/头/腿」刚好不穿（approach 只平移 p/手/脚，腿重算一次）
  const placeLegs = () => {
    const J0 = fk(T, dT);
    for (const [side, hip] of [['L', J0.hipL], ['R', J0.hipR]]) {
      const sg = SG[side];
      const knee = V(hip.x + kx, ky, sg * kz);
      const foot = V(knee.x - dT.shin, ky, sg * kz * c.toe);
      legTo(T, dT, side, knee, foot, ky - 0.01);
    }
  };
  placeLegs();
  const BODYP = ['torso', 'head', 'th', 'sh'];
  approach(T, dT, fk(S, dS), V(1, 0, 0), (a, b) => BODYP.includes(a.own) && BODYP.includes(b.own), 0.006, 0.9);
  const J0 = fk(T, dT);
  for (const [side, hip] of [['L', J0.hipL], ['R', J0.hipR]]) {
    const sg = SG[side];
    const knee = V(hip.x + kx, ky, sg * kz);
    const foot = V(knee.x - dT.shin, ky, sg * kz * c.toe);
    legTo(T, dT, side, knee, foot, ky - 0.01);
  }
  return T;
}

// S 双臂（先放）：手落在自己小腿前侧（抱膝）。障碍=T 的躯干/头/腿（T 手臂此时还没摆，不参与）+ 自己的腿
function armsS(S, dS, T, dT) {
  const JT = fk(T, dT);
  for (const [side, sg] of Object.entries(SG)) {
    const J = fk(S, dS);
    const sh = side === 'L' ? J.shL : J.shR, kn = side === 'L' ? J.kneeL : J.kneeR, an = side === 'L' ? J.ankleL : J.ankleR;
    const dir = an.clone().sub(kn).normalize();
    const nrm = V(1, 0, 0).addScaledVector(dir, -dir.x).normalize();           // 小腿前侧法向
    const ends = [];
    for (const t of [0.35, 0.6]) for (const zk of [0, -0.3, 0.5]) {      // zk<0：手扶小腿外侧（前倾大时肘不绕进躯干）
      const p = kn.clone().lerp(an, t).addScaledVector(nrm, dS.legR + dS.handR * 0.9);
      p.z *= 1 - zk;
      ends.push(p);
    }
    const want = midJoint(sh, ends[0], dS.upper, V(0, -1, sg * 0.4));
    const JO = { parts: [...JT.parts.filter((q) => !['ua', 'fa', 'hd'].includes(q.own)), ...J.parts.filter(own('th', 'sh'))] };
    placeLimb(S, dS, 'arm', side, JO, want, ends, { allow: 0.012, wMid: 0.1, natFn: elbowPenaltyWorld });
  }
}

// T 双臂（后放）：从她身体两侧绕到身前，手落在她膝盖顶 / 前臂外侧 / 上臂外侧 / 肩头（按偏好排序，够得着且不穿的第一个）。
// 障碍=S 全身（含已摆好的手臂）+ 自己的腿
function armsT(T, dT, S, dS) {
  const JS = fk(S, dS);
  for (const [side, sg] of Object.entries(SG)) {
    const J = fk(T, dT);
    const sh = side === 'L' ? J.shL : J.shR;
    const kn = side === 'L' ? JS.kneeL : JS.kneeR, shS = side === 'L' ? JS.shL : JS.shR;
    const elS = side === 'L' ? JS.elbowL : JS.elbowR, wrS = side === 'L' ? JS.wristL : JS.wristR;
    const r = dS.legR + dT.handR * 0.9, ra = dS.armR + dT.handR * 0.9;
    const out = V(0, 0, sg);
    const ends = [
      kn.clone().add(V(0, r, 0)),                                                       // 膝盖顶
      kn.clone().add(V(0.02, 0.5 * r, sg * r)),                                         // 膝盖外侧
      elS.clone().lerp(wrS, 0.5).addScaledVector(out, ra).add(V(0, 0.3 * ra, 0)),       // 前臂外侧
      shS.clone().lerp(elS, 0.5).addScaledVector(out, ra).add(V(0, 0.3 * ra, 0)),       // 上臂外侧
      shS.clone().add(V(0, ra, sg * 0.3 * ra)),                                         // 肩头
    ];
    const want = midJoint(sh, ends[0], dT.upper, V(0, -0.6, sg * 1));
    const JO = { parts: [...JS.parts, ...J.parts.filter(own('th', 'sh'))] };
    placeLimb(T, dT, 'arm', side, JO, want, ends, { allow: 0.012, wMid: 0.1, natFn: elbowPenaltyWorld });
  }
}

// 打分：互穿 + 自碰 + 手臂陷进自己腿 + 肘膝自然度 + 手扶不上 + 占地面积
function score(T, S, dT, dS, withArms) {
  const JT = fk(T, dT), JS = fk(S, dS);
  let sc = Math.max(0, Math.max(penetration(JT, JS).depth, penetration(JS, JT).depth) - 0.012) * 4;
  const sp = Math.max(selfPen(JT).depth, selfPen(JS).depth);
  sc += sp * 1.5 + Math.max(0, sp - 0.012) * 10;       // 前臂/手陷进自己躯干：超过 1.2cm 重罚（check 容差 2cm，留余量）
  for (const sd of ['L', 'R']) sc += kneePenalty(JT, sd) + kneePenalty(JS, sd);
  if (withArms) {
    for (const J of [JT, JS]) {
      const a = penetration(J, J, (p, q) => ['ua', 'fa', 'hd'].includes(p.own) && ['th', 'sh'].includes(q.own)).depth;
      sc += Math.max(0, a - 0.005) * 3;
    }
    for (const sd of ['L', 'R']) {
      sc += elbowPenaltyWorld(JT, sd) + elbowPenaltyWorld(JS, sd);
      const hand = JT.parts.find((q) => q.n === 'hd' + sd);
      let g = 1e9;
      for (const q of JS.parts) if (['torso', 'head', 'ua', 'fa', 'hd', 'th', 'sh'].includes(q.own)) g = Math.min(g, sdf(q, hand.c) - hand.r);
      sc += Math.max(0, g - 0.015) * 2;
      const hs = JS.parts.find((q) => q.n === 'hd' + sd);                  // S 抱膝：手要贴在自己的腿上
      let gl = 1e9;
      for (const q of JS.parts) if (['th', 'sh'].includes(q.own)) gl = Math.min(gl, sdf(q, hs.c) - hs.r);
      sc += Math.max(0, gl - 0.015) * 2;
    }
  }
  const xs = [extent(JT, 'x'), extent(JS, 'x')], zs = [extent(JT, 'z'), extent(JS, 'z')];
  sc += 0.05 * (Math.max(xs[0][1], xs[1][1]) - Math.min(xs[0][0], xs[1][0])) * (Math.max(zs[0][1], zs[1][1]) - Math.min(zs[0][0], zs[1][0]));
  return sc;
}

// 候选：bS/fS=S 前弯与腿前伸；bT=T 前倾；kx/kz=T 膝在髋前/侧的距离（×身高）；toe=脚内收系数
const GRID = grid2([0.15, 0.3, 0.45], [0.12, 0.17], [-0.1, 0.1, 0.25], [0.05, 0.1], [0.13, 0.16, 0.19], [0.6, 1.0])
  .map(([bS, fS, bT, kx, kz, toe]) => ({ bS, fS, bT, kx, kz, toe }));

const buildLower = (dT, dS, c) => { const S = seatS(dS, c.bS, c.fS); return { S, T: seatT(dT, S, dS, c) }; };
const buildFull = (dT, dS, c) => { const r = buildLower(dT, dS, c); armsS(r.S, dS, r.T, dT); armsT(r.T, dT, r.S, dS); return r; };

export const box = (dT, dS) => {
  setQuick(true);
  try {
    // 1) 只摆身体（腿+躯干）粗筛；2) 前 6 名快速摆臂重排；3) 前 3 名用全方向采样细化手臂，按含自碰重罚的总分取最优
    const ranked = GRID.map((c) => { const r = buildLower(dT, dS, c); return { c, sc: score(r.T, r.S, dT, dS, false) }; }).sort((a, b) => a.sc - b.sc);
    const quick = [];
    for (const { c } of ranked.slice(0, 6)) {
      const r = buildFull(dT, dS, c);
      quick.push({ c, sc: score(r.T, r.S, dT, dS, true) });
    }
    quick.sort((a, b) => a.sc - b.sc);
    setQuick(false);
    let best = null, bs = Infinity;
    for (const { c } of quick.slice(0, 5)) {
      const r = buildFull(dT, dS, c);
      const sc = score(r.T, r.S, dT, dS, true);
      if (sc < bs) { bs = sc; best = r; }
    }
    return finish(best.T, best.S, dT, dS);
  } finally { setQuick(false); }
};

// 按两人实际包围盒定箱，并把整体平移到箱中心 (0,0)
function finish(T, S, dT, dS) {
  const JT = fk(T, dT), JS = fk(S, dS);
  const rng = (a) => [Math.min(extent(JT, a)[0], extent(JS, a)[0]), Math.max(extent(JT, a)[1], extent(JS, a)[1])];
  const [x0, x1] = rng('x'), [z0, z1] = rng('z');
  const need = dT.bodyW + dS.bodyW + 0.1;                                // 宽度（z）≥ 两人躯干宽之和 + 余量
  const w = Math.max(x1 - x0 + 2 * CARTON_PAD, 0.3);
  const d = Math.max(z1 - z0 + 2 * CARTON_PAD, need);
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  shift(T, V(-cx, 0, -cz)); shift(S, V(-cx, 0, -cz));
  const JS2 = fk(S, dS);
  const h = Math.max(JS2.shC.y - 0.2 * dS.torso, Math.max(JS2.kneeL.y, JS2.kneeR.y) + 0.06);   // 壁高≈矮个胸口，不低于她的膝
  const props = [{ type: 'carton', at: [0, 0, 0], w, d, h, t: CARTON_WALL }];
  return { T, S, props, hold: ['T.L', 'T.R'], loose: LOOSE, skipAuto: ['T', 'S'], noAuto: true, elbowWorld: ['T', 'S'], cam: { el: 0.32 } };
}
