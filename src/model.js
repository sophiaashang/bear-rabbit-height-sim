// 骨架模型：尺寸、状态向量、正向运动学 + 两段式 IK、碰撞检测。纯数学，不依赖 DOM。
import * as THREE from 'three';

export const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const Y_AXIS = V(0, 1, 0);

// 人体比例（占身高的比例）。头顶 = 1.0h。
export const EAR_RABBIT = 1.4;   // 兔耳长度（倍头半径）
// 男生壮度：w=躯干宽与肩宽，d=躯干厚，arm=胳膊粗，leg=腿粗。1 = 原体型。
export const MALE_BULK = { w: 1, d: 1, arm: 1, leg: 1 };
// 所有姿势都不要脚（参考图的人偶没有脚）。false = 恢复脚。
export const NO_FEET_ALL = true;
export function dims(h, gender = 'm', ears = 'none') {
  const f = gender === 'f';
  const k = f ? { w: 1, d: 1, arm: 1, leg: 1 } : MALE_BULK;
  const legR0 = (f ? 0.036 : 0.045) * h * k.leg;
  const fr = NO_FEET_ALL ? legR0 : 0.045 * h * k.leg;      // 无脚时腿末端圆头直接着地：脚球半径 = 腿半径
  return {
    h, gender, ears, noFeet: NO_FEET_ALL,
    // 髋高0.45 + 躯干0.33 + 颈0.04 + 头直径0.18 = 1.0h，头顶即身高。
    // 脚球心离地 footR，所以 大腿+小腿 = 髋高 - footR。
    footR: fr, footL: 0.072 * h, thigh: (0.45 * h - fr) / 2, shin: (0.45 * h - fr) / 2, leg: 0.45 * h,   // 腿变粗 -> 脚球同步变粗（否则腿比脚球粗会陷地）；大腿小腿相应缩短，髋高与头顶高度不变
    torso: 0.33 * h, neck: 0.04 * h, headR: 0.09 * h,
    // 体型差（参考 qwertyaz111 系列：男 0.26 / 女 0.21 的躯干宽，四肢粗细随之缩放）：
    // 男：宽肩、厚胸、粗胳膊粗腿；女：窄肩、细腰、细胳膊细腿，胯相对宽一点。
    sw: (f ? 0.105 : 0.138) * h * k.w, hw: (f ? 0.056 : 0.052) * h,
    bodyW: (f ? 0.175 : 0.235) * h * k.w, bodyD: (f ? 0.098 : 0.122) * h * k.d,
    upper: 0.17 * h, fore: 0.17 * h, arm: 0.34 * h,
    armR: (f ? 0.023 : 0.031) * h * k.arm, legR: (f ? 0.036 : 0.045) * h * k.leg, handR: (f ? 0.027 : 0.034) * h * k.arm, neckR: (f ? 0.029 : 0.038) * h * (f ? 1 : (k.w + 1) / 2),
  };
}

// 参考体型（piggyback-simulator 的 createMannequin）：躯干宽 0.26/0.21×(h/1.7)、厚=宽×0.5、
// 臂厚=宽×0.3、腿厚=宽×0.4、臂总长 0.38h、腿长 0.45h、躯干高 0.37h，肩关节在躯干顶下方，没有脚。
// 头顶仍对齐 h（参考实现的头顶实际是 1.04h，这里不跟，否则身高标尺对不上）。只在姿势返回 bodyT/bodyS 时使用。
export function refDims(b) {
  const h = b.h, f = b.gender === 'f';
  const tw = (f ? 0.21 : 0.26) * (h / 1.7);
  const armR = tw * 0.15, legR = tw * 0.2;
  const neck = 0.012 * h, headR = (0.18 * h - neck) / 2;
  const seg = (0.38 * h - armR) / 2;                 // 参考臂长 0.38h 从肩轴算到指尖：2 段关节距 + 手球半径
  const leg = 0.45 * h, thigh = (leg - legR) / 2;     // 腿末端是圆头，脚球半径=腿半径才恰好着地
  return {
    ...b, ref: true, noFeet: true,
    torso: 0.37 * h, neck, headR, bodyW: tw, bodyD: tw * 0.5, sw: tw * 0.65, shDrop: tw * 0.15, hw: tw * 0.25,
    upper: seg, fore: seg, arm: 2 * seg, armR, handR: armR, legR, footR: legR, thigh, shin: thigh, leg, neckR: 0.03 * h,
  };
}

// ---- 状态向量：全是数字数组，过渡动画直接逐项插值 ----
const SCHEMA = { p: 3, yaw: 1, pitch: 1, roll: 1, twist: 1, lean: 2, head: 3, hL: 3, hR: 3, fL: 3, fR: 3, armPoleL: 3, armPoleR: 3, kneePoleL: 3, kneePoleR: 3, eyes: 1 };
export const KEYS = Object.keys(SCHEMA);
export function blank() {
  const s = {};
  for (const k of KEYS) s[k] = new Array(SCHEMA[k]).fill(0);
  s.armPoleL = [0.1, -0.6, -1];
  s.armPoleR = [-0.1, -0.6, -1];
  s.kneePoleL = [0, 0, 1];
  s.kneePoleR = [0, 0, 1];
  s.eyes = [1];
  return s;
}
export const cloneState = (s) => { const o = {}; for (const k of KEYS) o[k] = s[k].slice(); return o; };
export function lerpState(a, b, t, out) {
  for (const k of KEYS) {
    for (let i = 0; i < a[k].length; i++) out[k][i] = a[k][i] + (b[k][i] - a[k][i]) * t;
  }
  // yaw 取最短路径
  let dy = b.yaw[0] - a.yaw[0];
  dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  out.yaw[0] = a.yaw[0] + dy * t;
  return out;
}

// ---- 两段式 IK：返回中间关节与（被夹紧后的）末端 ----
export function ik(a, target, l1, l2, pole, slack = 0.9995) {
  const v = target.clone().sub(a);
  const dist = v.length();
  const maxR = (l1 + l2) * slack, minR = Math.abs(l1 - l2) + 1e-4;
  const dd = Math.min(Math.max(dist, minR), maxR);
  const dir = dist > 1e-9 ? v.clone().divideScalar(dist) : V(0, -1, 0);
  const end = a.clone().addScaledVector(dir, dd);
  const x = (dd * dd + l1 * l1 - l2 * l2) / (2 * dd);
  const hgt = Math.sqrt(Math.max(l1 * l1 - x * x, 0));
  const pp = pole.clone().addScaledVector(dir, -pole.dot(dir));
  if (pp.lengthSq() < 1e-8) pp.copy(Math.abs(dir.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0)).addScaledVector(dir, -0).cross(dir);
  pp.normalize();
  const mid = a.clone().addScaledVector(dir, x).addScaledVector(pp, hgt);
  return { mid, end, miss: Math.max(0, dist - dd) };
}

const eul = (p, y, r) => new THREE.Quaternion().setFromEuler(new THREE.Euler(p, y, r, 'YXZ'));

// ---- 正向运动学 ----
export function fk(s, d) {
  const Qp = eul(s.pitch[0], s.yaw[0], s.roll[0]);
  const bx = s.lean[0], bz = s.lean[1], ang = Math.hypot(bx, bz);
  const Qb = ang > 1e-6 ? new THREE.Quaternion().setFromAxisAngle(V(bz, 0, -bx).normalize(), ang) : new THREE.Quaternion();
  // twist：躯干绕自身竖轴相对骨盆扭转（侧坐/侧身时上半身转向对方）
  const Qt = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, s.twist ? s.twist[0] : 0);
  const Qc = Qp.clone().multiply(Qt).multiply(Qb);
  const Qh = Qc.clone().multiply(eul(s.head[0], s.head[1], s.head[2]));
  const P = V(...s.p);
  const upC = V(0, 1, 0).applyQuaternion(Qc);
  const shC = P.clone().addScaledVector(upC, d.torso);
  const shDrop = d.shDrop || 0;   // 参考体型：肩关节在躯干顶下方
  const shL = shC.clone().add(V(d.sw, 0, 0).applyQuaternion(Qc)).addScaledVector(upC, -shDrop);
  const shR = shC.clone().add(V(-d.sw, 0, 0).applyQuaternion(Qc)).addScaledVector(upC, -shDrop);
  const neckTop = shC.clone().addScaledVector(upC, d.neck);
  const headC = neckTop.clone().add(V(0, d.headR, 0).applyQuaternion(Qh));
  const hipL = P.clone().add(V(d.hw, 0, 0).applyQuaternion(Qp));
  const hipR = P.clone().add(V(-d.hw, 0, 0).applyQuaternion(Qp));
  const apL = s.armPoleL, apR = s.armPoleR, kpL = s.kneePoleL, kpR = s.kneePoleR;
  const aL = ik(shL, V(...s.hL), d.upper, d.fore, V(apL[0], apL[1], apL[2]).applyQuaternion(Qc), 0.965);
  const aR = ik(shR, V(...s.hR), d.upper, d.fore, V(apR[0], apR[1], apR[2]).applyQuaternion(Qc), 0.965);
  const lL = ik(hipL, V(...s.fL), d.thigh, d.shin, V(kpL[0], kpL[1], kpL[2]).applyQuaternion(Qp));
  const lR = ik(hipR, V(...s.fR), d.thigh, d.shin, V(-kpR[0], kpR[1], kpR[2]).applyQuaternion(Qp));

  // 耳朵：熊耳=头顶两个半嵌入的小球；兔耳=向后微倾、略向外的长胶囊
  const hr = d.headR;
  const earPts = [];
  if (d.ears === 'bear') {
    for (const sx of [1, -1]) earPts.push({ t: 'sph', c: headC.clone().add(V(sx * 0.66 * hr, 0.80 * hr, -0.10 * hr).applyQuaternion(Qh)), r: 0.36 * hr, own: 'ear', n: 'ear' + (sx > 0 ? 'L' : 'R') });
  } else if (d.ears === 'rabbit') {
    for (const sx of [1, -1]) {
      const a = headC.clone().add(V(sx * 0.42 * hr, 0.80 * hr, -0.12 * hr).applyQuaternion(Qh));
      const dir = V(sx * Math.sin(0.2), Math.cos(0.14), -Math.sin(0.14)).normalize().applyQuaternion(Qh);
      earPts.push({ t: 'cap', a, b: a.clone().addScaledVector(dir, EAR_RABBIT * hr), r: 0.26 * hr, own: 'ear', n: 'ear' + (sx > 0 ? 'L' : 'R') });
    }
  }
  const torsoC = P.clone().addScaledVector(upC, d.torso / 2);
  const parts = [
    { n: 'torso', t: 'box', c: torsoC, q: Qc, hx: d.bodyW / 2, hy: d.torso / 2, hz: d.bodyD / 2, own: 'torso' },
    { n: 'head', t: 'sph', c: headC, r: d.headR, own: 'head' },
    { n: 'uaL', t: 'cap', a: shL, b: aL.mid, r: d.armR, own: 'ua' },
    { n: 'faL', t: 'cap', a: aL.mid, b: aL.end, r: d.armR, own: 'fa' },
    { n: 'hdL', t: 'sph', c: aL.end, r: d.handR, own: 'hd' },
    { n: 'uaR', t: 'cap', a: shR, b: aR.mid, r: d.armR, own: 'ua' },
    { n: 'faR', t: 'cap', a: aR.mid, b: aR.end, r: d.armR, own: 'fa' },
    { n: 'hdR', t: 'sph', c: aR.end, r: d.handR, own: 'hd' },
    { n: 'thL', t: 'cap', a: hipL, b: lL.mid, r: d.legR, own: 'th' },
    { n: 'shL', t: 'cap', a: lL.mid, b: lL.end, r: d.legR, own: 'sh' },
    ...(d.noFeet ? [] : [
      { n: 'ftL', t: 'sph', c: lL.end, r: d.footR, own: 'ft' },
      { n: 'toeL', t: 'sph', c: lL.end.clone().add(V(0, d.footR * 0.25, d.footR * 1.7).applyQuaternion(Qp)), r: d.footR * 0.78, own: 'ft' },
    ]),
    { n: 'thR', t: 'cap', a: hipR, b: lR.mid, r: d.legR, own: 'th' },
    { n: 'shR', t: 'cap', a: lR.mid, b: lR.end, r: d.legR, own: 'sh' },
    ...(d.noFeet ? [] : [
      { n: 'ftR', t: 'sph', c: lR.end, r: d.footR, own: 'ft' },
      { n: 'toeR', t: 'sph', c: lR.end.clone().add(V(0, d.footR * 0.25, d.footR * 1.7).applyQuaternion(Qp)), r: d.footR * 0.78, own: 'ft' },
    ]),
    ...earPts,
  ];
  for (const q of parts) {
    if (q.t === 'sph') { q.bc = q.c; q.br = q.r; }
    else if (q.t === 'cap') { q.bc = q.a.clone().add(q.b).multiplyScalar(0.5); q.br = q.a.distanceTo(q.b) / 2 + q.r; }
    else { q.bc = q.c; q.br = Math.hypot(q.hx, q.hy, q.hz); }
  }
  return {
    P, Qp, Qc, Qh, upC, shC, shL, shR, neckTop, headC, hipL, hipR,
    elbowL: aL.mid, elbowR: aR.mid, wristL: aL.end, wristR: aR.end,
    kneeL: lL.mid, kneeR: lR.mid, ankleL: lL.end, ankleR: lR.end,
    miss: { hL: aL.miss, hR: aR.miss, fL: lL.miss, fR: lR.miss },
    parts, d,
  };
}

// ---- 碰撞：有符号距离 ----
const _v = V(), _q = new THREE.Quaternion();
function segDist(p, a, b) {
  const ab = _v.copy(b).sub(a);
  const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / Math.max(ab.lengthSq(), 1e-12)));
  return p.distanceTo(a.clone().addScaledVector(ab, t));
}
export function sdf(part, p) {
  if (part.t === 'sph') return p.distanceTo(part.c) - part.r;
  if (part.t === 'cap') return segDist(p, part.a, part.b) - part.r;
  const l = p.clone().sub(part.c).applyQuaternion(_q.copy(part.q).invert());
  const q = V(Math.abs(l.x) - part.hx, Math.abs(l.y) - part.hy, Math.abs(l.z) - part.hz);
  return V(Math.max(q.x, 0), Math.max(q.y, 0), Math.max(q.z, 0)).length() + Math.min(Math.max(q.x, q.y, q.z), 0);
}
function samples(part) {
  if (part.t === 'sph') return [[part.c, part.r]];
  if (part.t === 'cap') return [0, 0.25, 0.5, 0.75, 1].map((t) => [part.a.clone().lerp(part.b, t), part.r]);
  const ax = V(0, 1, 0).applyQuaternion(part.q);
  return [-0.9, -0.45, 0, 0.45, 0.9].map((t) => [part.c.clone().addScaledVector(ax, t * part.hy), part.hz * 0.9]);
}
// X 的各部件插进 Y 的最大深度（米）
export function penetration(X, Y, filter) {
  let worst = { depth: 0, a: '', b: '' };
  for (const a of X.parts) {
    const near = Y.parts.filter((b) => a.bc.distanceTo(b.bc) < a.br + b.br && (!filter || filter(a, b)));
    if (!near.length) continue;
    for (const [pt, ra] of samples(a)) for (const b of near) {
      const dep = -(sdf(b, pt) - ra);
      if (dep > worst.depth) worst = { depth: dep, a: a.n, b: b.n };
    }
  }
  return worst;
}
// 自碰：前臂/手 与 自己的躯干/头；小腿/脚 与 躯干
export function selfPen(J) {
  let worst = { depth: 0, a: '', b: '' };
  const A = J.parts.filter((p) => ['fa', 'hd'].includes(p.own)), B = J.parts.filter((p) => ['torso', 'head'].includes(p.own));
  for (const a of A) for (const [pt, ra] of samples(a)) for (const b of B) {
    const dep = -(sdf(b, pt) - ra);
    if (dep > worst.depth) worst = { depth: dep, a: a.n, b: b.n };
  }
  return worst;
}
export function groundMin(J) {
  let m = 1e9;
  for (const p of J.parts) {
    if (p.t === 'sph') m = Math.min(m, p.c.y - p.r);
    else if (p.t === 'cap') m = Math.min(m, Math.min(p.a.y, p.b.y) - p.r);
    else for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1])
      m = Math.min(m, p.c.clone().add(V(sx * p.hx, sy * p.hy, sz * p.hz).applyQuaternion(p.q)).y);
  }
  return m;
}
