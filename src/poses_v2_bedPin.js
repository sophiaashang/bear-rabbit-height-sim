// 床咚（bedPin）：按手工摆好的参数固化（取代旧的自动搜索版）。
//   queen 床（台面高 0.55）+ 两个枕头；S（兔）仰躺头枕枕头，T（熊）跪在床上俯身、双手撑在她头两侧。
//   参考身高 T=1.86 / S=1.65（摆姿势时的身高，页面可拖）：与原始参数逐部件位移只在下面「最小清洗」几处。
//   最小清洗：S 左手落回床面、T 右手落回枕面（原来各陷 2.1cm / 1.1cm）；S 左右臂弯向搜索一次（原来左臂陷床 4.8cm）。站位、朝向不动。
//   换身高：床面高度固定。S 以「盆骨正下方的床面点」为锚按 kS 缩放；T 以 S 头心 x、床面、S 中线为锚按 kT 缩放；
//   S 右手相对 T 盆骨按 kT 落点（始终够着 T 的身下）；T 的手落点若陷进枕头/床就沿 y 抬到不陷；枕头跟 S 头走，床长随最高者加长。
import { dims, fk } from './model.js';
import { boxProp } from './poses_c.js';

const REF = { T: 1.86, S: 1.65 };
const B = 0.55, PW = 0.4, PH = 0.14, PD = 0.6, ZS = 0.33, BED_HZ = 0.8;   // 床面高、枕头 x/高/z 尺寸、S 中线 z、床半宽
const POSE = {
  T: {
    p: [-0.022, 0.986, 0.33], yaw: [-1.5708], pitch: [1.2451], roll: [0],
    twist: [0], lean: [0, 0], head: [0, 0, 0], hL: [-0.8264, 0.6538, 0.6999],
    hR: [-0.8857, 0.7542, -0.0609], fL: [0.3332, 0.6358, 0.6155], fR: [0.3332, 0.6358, 0.0445], armPoleL: [-0.156, -0.9824, 0.1031],
    armPoleR: [0.176, -0.9432, 0.2819], kneePoleL: [0.316, 0.5191, 0.7942], kneePoleR: [0.316, 0.5191, 0.7942], eyes: [1],
  },
  S: {
    p: [-0.2, 0.6339, 0.33], yaw: [1.5708], pitch: [-1.5708], roll: [0],
    twist: [0], lean: [0, 0.13], head: [0.74, 0, 0], hL: [-0.3545, 0.5966, 0.1026],
    hR: [-0.4188, 0.8578, 0.4998], fL: [0.479, 0.6114, 0.2376], fR: [0.479, 0.6114, 0.4224], armPoleL: [0.8732, 0.4063, -0.2692],
    armPoleR: [-0.8678, -0.4312, -0.2469], kneePoleL: [0, 0, 1], kneePoleR: [0, 0, 1], eyes: [1],
  },
};
const LOOSE = ['hd', 'fa', 'ua', 'head', 'ear', 'torso', 'th', 'sh'];
const fresh = (o) => { const s = {}; for (const k of Object.keys(o)) s[k] = o[k].slice(); return s; };
// 点 q 以 a 为锚缩放 k 后平移到 b
const map = (q, a, b, k) => [b[0] + k * (q[0] - a[0]), b[1] + k * (q[1] - a[1]), b[2] + k * (q[2] - a[2])];
// 目标超出臂长 96% 时收回
const clampReach = (t, sh, reach) => {
  const dx = t[0] - sh.x, dy = t[1] - sh.y, dz = t[2] - sh.z, L = Math.hypot(dx, dy, dz);
  return L > reach ? [sh.x + (dx * reach) / L, sh.y + (dy * reach) / L, sh.z + (dz * reach) / L] : t;
};
// 球(半径 r)陷进 box 家具的深度
const spherePen = (pt, r, bx) => {
  const dx = Math.abs(pt[0] - bx.c[0]) - bx.s[0], dy = Math.abs(pt[1] - bx.c[1]) - bx.s[1], dz = Math.abs(pt[2] - bx.c[2]) - bx.s[2];
  return r - (Math.hypot(Math.max(dx, 0), Math.max(dy, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dy, dz), 0));
};
// 手球陷进床/枕头时沿 y 抬到不陷（只抬，不横挪）
const liftOut = (pt, r, boxes) => {
  const t = pt.slice();
  for (let i = 0; i < 300 && boxes.some((bx) => spherePen(t, r, bx) > 0.002); i++) t[1] += 0.001;
  return t;
};

const dRef = dims(REF.S, 'f', 'rabbit');
const HX_REF = fk(POSE.S, dRef).headC.x;              // 参考身高下 S 头心 x
const PCX_OFF = -0.9979 - HX_REF;                      // 参考姿势里枕头中心相对 S 头心的 x 偏移

export const bedPin = (dT, dS) => {
  const kT = dT.h / REF.T, kS = dS.h / REF.S;
  const T = fresh(POSE.T), S = fresh(POSE.S);
  // S：躺在床上，锚 = 盆骨正下方的床面点；盆骨高按身体厚度贴着床面
  const aS = [POSE.S.p[0], B, ZS];
  if (Math.abs(kS - 1) > 1e-6) {
    for (const key of ['p', 'hL', 'hR', 'fL', 'fR']) S[key] = map(POSE.S[key], aS, aS, kS);
    S.p[1] = B + dS.bodyD / 2 + 0.003;
  }
  // 枕头高度不变、人体按比例缩放：小个子的头会陷得更深、大个子会悬空。只调 S 躯干后仰 lean[1]，让后脑落回枕面（陷 1.2cm，与参考姿势一致），头角不动
  if (Math.abs(kS - 1) > 1e-6) {
    const want = B + PH - 0.012, th0 = POSE.S.lean[1];
    let best = th0, bs = Infinity;
    for (let th = 0; th <= 0.6; th += 0.005) {
      S.lean = [POSE.S.lean[0], th];
      const hb = fk(S, dS).headC.y - dS.headR;
      const sc = Math.abs(hb - want) * 10 + Math.abs(th - th0) * 0.05;
      if (sc < bs) { bs = sc; best = th; }
    }
    S.lean = [POSE.S.lean[0], best];
  }
  const JS0 = fk(S, dS), hx = JS0.headC.x;
  // 枕头/床：枕头跟着 S 的头，床头端比枕头外 3cm，床长随最高者加长（与旧版同口径）
  const pcx = hx + kS * PCX_OFF, x0 = pcx - PW / 2 - 0.03, L = Math.max(2.0, Math.max(dT.h, dS.h) + 0.35), zc = [ZS, -ZS];
  const props = [
    boxProp(x0 + L / 2, B / 2, 0, L / 2, B / 2, BED_HZ, 0xe9e2f0),
    ...zc.map((z) => boxProp(pcx, B + PH / 2, z, PW / 2, PH / 2, PD / 2, 0xf4f0fa)),
  ];
  const pillows = zc.map((z) => ({ w: PW, d: PD, h: PH, at: [pcx, 0, z] }));
  // T：锚 = (S 头心 x, 床面, S 中线)，整体按 kT 缩放；手落点若陷床/枕就抬到不陷
  if (Math.abs(kT - 1) > 1e-6 || Math.abs(hx - HX_REF) > 1e-6) {
    const aT = [HX_REF, B, ZS], bT = [hx, B, ZS];
    for (const key of ['p', 'hL', 'hR', 'fL', 'fR']) T[key] = map(POSE.T[key], aT, bT, kT);
  }
  for (const key of ['hL', 'hR']) T[key] = liftOut(T[key], dT.handR, props);
  const JT = fk(T, dT);
  for (const [key, sh] of [['hL', JT.shL], ['hR', JT.shR]]) T[key] = clampReach(T[key], sh, (dT.upper + dT.fore) * 0.96);
  // S：左手在身侧床面上（随 kS 缩放，不陷床）；右手伸向 T 身下，相对 T 盆骨按 kT 落点
  S.hL = liftOut(S.hL, dS.handR, props);
  if (Math.abs(kT - 1) > 1e-6 || Math.abs(hx - HX_REF) > 1e-6) S.hR = map(POSE.S.hR, POSE.T.p, T.p, kT);
  const JS = fk(S, dS);
  for (const [key, sh] of [['hL', JS.shL], ['hR', JS.shR]]) S[key] = clampReach(S[key], sh, (dS.upper + dS.fore) * 0.96);
  return {
    T, S, props, pillows,
    loose: LOOSE, air: ['T', 'S'], noNat: true, noAuto: true, skipAuto: ['T', 'S'], cam: { el: 0.42 }, hold: [],
  };
};
