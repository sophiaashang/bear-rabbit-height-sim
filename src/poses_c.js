// 姿势 15-18：抱起 / 坐腿上。约定同 poses_a/b：矮个 S、高个 T。
// 道具 {type:'box', c, s:[半宽], color}；检测脚本据此查人是否陷进家具。
import * as THREE from 'three';
import { V, fk, groundMin, sdf } from './model.js';
import { PI, base, feetStand, handsHang, fitArm, pick2, grid2, rotY, legTo, armTo, placeLimb, shift } from './poseutil.js';
import { headPat } from './poses_a.js';

// 用「躯干向上方向 + 正面方向」直接定朝向（横抱、躺、俯身时比手调欧拉角可靠）
export function orientBody(s, up, front) {
  const y = up.clone().normalize();
  const z = front.clone().addScaledVector(y, -front.dot(y)).normalize();
  const x = y.clone().cross(z);
  const e = new THREE.Euler().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z), 'YXZ');
  s.pitch = [e.x]; s.yaw = [e.y]; s.roll = [e.z];
}
export const boxProp = (cx, cy, cz, hx, hy, hz, color = 0xd9dce3) => ({ type: 'box', c: [cx, cy, cz], s: [hx, hy, hz], color });
export const seatTopOf = (d) => d.footR + d.shin - d.legR;          // 坐下时大腿水平、小腿垂直、脚刚好落地
// 坐下：大腿下沿贴座面，沿正面水平伸出，小腿垂直落地
export function sitDown(s, d, x, z, yaw, seatY, spread = 1.1) {
  s.p = [x, seatY + d.legR, z]; s.yaw = [yaw]; s.lean = [0, 0.04];
  const J = fk(s, d), f = rotY(yaw, 0, 0, 1), sx = rotY(yaw, 1, 0, 0);
  for (const [side, hip, sg] of [['L', J.hipL, 1], ['R', J.hipR, -1]]) {
    const kn = hip.clone().addScaledVector(f, d.thigh).addScaledVector(sx, sg * d.hw * (spread - 1));
    legTo(s, d, side, kn, kn.clone().add(V(0, -d.shin, 0)).addScaledVector(f, 0.02 * d.h));
  }
  handsHang(s, d, 0.03);
}
// 长凳（坐者面朝 +z）：前沿收在膝窝后面，不顶小腿
export function benchZ(JT, dT, seatY, x0, x1) {
  const zf = Math.min(JT.kneeL.z, JT.kneeR.z) - dT.legR - 0.012, zb = JT.P.z - 0.13 * dT.h;
  return boxProp((x0 + x1) / 2, seatY / 2, (zf + zb) / 2, (x1 - x0) / 2, seatY / 2, (zf - zb) / 2);
}
// 两人躯干+头之间的最小距离
function sdfGap(JA, JB) {
  let g = 1e9;
  for (const a of JA.parts.filter((p) => p.own === 'torso' || p.own === 'head')) for (const b of JB.parts.filter((p) => p.own === 'torso' || p.own === 'head')) {
    const pts = a.t === 'box' ? [-0.8, -0.3, 0.2, 0.7].map((t) => a.c.clone().addScaledVector(V(0, 1, 0).applyQuaternion(a.q), t * a.hy)) : [a.c];
    const ra = a.t === 'box' ? a.hz : a.r;
    for (const p of pts) g = Math.min(g, sdf(b, p) - ra);
  }
  return g;
}
const LOOSE = ['hd', 'fa', 'ua', 'head', 'ear', 'torso', 'th', 'sh'];

const neckRing = (JT, dT, r, k = 0.45) => {     // T 颈部一圈的候选点（世界坐标），用于「环住脖子」
  const c = JT.neckTop.clone().addScaledVector(JT.upC, -k * dT.neck);
  const ax = V(1, 0, 0).applyQuaternion(JT.Qc), az = V(0, 0, 1).applyQuaternion(JT.Qc);
  return (a) => c.clone().addScaledVector(ax, Math.cos(a) * (dT.neckR + r)).addScaledVector(az, Math.sin(a) * (dT.neckR + r));
};
const angs = (...a) => a.map((x) => x * PI / 180);

// 近侧手臂要从他肩膀「上方」过去：手臂折线穿过他肩所在 z 平面时，高度低于肩顶就是从腋下过，罚分
const overShoulder = (JT, dT) => (J, sd) => {
  const top = JT.shL.y + dT.armR, z0 = JT.shL.z, pts = [J['sh' + sd], J['elbow' + sd], J['wrist' + sd]];
  let worst = 0;
  for (let i = 0; i < 2; i++) {
    const a = pts[i], b = pts[i + 1];
    if ((a.z - z0) * (b.z - z0) < 0) {
      const k = (z0 - a.z) / (b.z - a.z), y = a.y + k * (b.y - a.y), x = a.x + k * (b.x - a.x);
      if (x > -0.05 && x < JT.shL.x + dT.armR) worst = Math.max(worst, top - y);
    }
  }
  return Math.max(0, worst) * 8;
};

// ---------- 15 公主抱（参数照参考实现 princess-carry-simulator）：T 正对镜头站着、微后仰；S 躯干与水平约 60° 半靠在 T 左臂上（头在 T 左肩前方），
//   大腿抬约 26°、膝处折下小腿垂向斜下；T 左手托上背，右前臂从她「两个膝关节正下面」托过去（不是两腿之间，也不是从上面抱）；
//   S 近侧手臂从 T 肩膀上方搭过去、手放在他肩背上（不必绕到颈后拉住），远侧手臂横在他颈前 ----------
export const princess = (dT, dS) => {
  const cands = grid2([1.0, 1.05, 1.1], [0.2, 0.3, 0.42, 0.54], [0.0, 0.04], [0.0, 0.03, 0.06]);
  const build = ([inc, hk, px, gap]) => {
    const T = base(dT, 0, 0, 0); T.lean = [0, -0.08]; feetStand(T, dT, 1.25); T.head = [0.5, 0.25, 0];
    const JT0 = fk(T, dT);
    const S = base(dS, 0, 0, 0);
    orientBody(S, V(Math.cos(inc), Math.sin(inc), 0), V(-Math.sin(inc), Math.cos(inc), 0));
    S.p = [-px * dT.h, JT0.P.y + hk * dT.torso, JT0.P.z + dT.bodyD / 2 + dS.bodyW / 2 + gap];
    S.head = [0, 0.1, 0];
    const JS0 = fk(S, dS);
    for (const [side, hip] of [['L', JS0.hipL], ['R', JS0.hipR]]) {
      const kn = hip.clone().add(V(-Math.cos(0.45) * dS.thigh, Math.sin(0.45) * dS.thigh, 0));
      legTo(S, dS, side, kn, kn.clone().add(V(-0.66 * dS.shin, -0.75 * dS.shin, 0)), -1);
    }
    const JS = fk(S, dS);
    const dn = V(0, 0, -1).applyQuaternion(JS.Qc);
    const backPt = (k) => JS.P.clone().addScaledVector(JS.upC, k * dS.torso).addScaledVector(dn, dS.bodyD / 2 + dT.handR * 0.95);
    const JTs = fk(T, dT);
    placeLimb(T, dT, 'arm', 'L', JS, JTs.shL.clone().add(V(0.11 * dT.h, -0.154 * dT.h, -0.02 * dT.h)), [0.7, 0.6, 0.8, 0.5, 0.9].map(backPt), { allow: 0.02, natFn: () => 0 });
    // 右前臂托膝：手落在远侧膝盖正下方（再往前一点点），近侧膝盖自然也压在前臂上
    const kL = JS.kneeL, kR = JS.kneeR, farK = kL.z > kR.z ? kL : kR;
    const needY = dS.legR + dT.armR, kx = (kL.x + kR.x) / 2;
    // 托点沿大腿往髋侧挪 0~7cm：小腿从膝盖往斜下垂，手正好在膝盖正下方会撞到小腿
    const underEnds = [0.04, 0.02, 0.07, 0.0].flatMap((dz) => [0.03, 0.05, 0.0, 0.07].map((dx) => V(kx + dx, farK.y - needY * 0.95, farK.z + dz)));
    placeLimb(T, dT, 'arm', 'R', JS, JTs.shR.clone().add(V(-0.03 * dT.h, -0.15 * dT.h, 0.02 * dT.h)), underEnds, { allow: 0.02, natFn: () => 0 });
    const JT = fk(T, dT);
    // S 两臂：近(离 T 身体近、z 小)的那只搭在他肩背上，远的那只横过他颈前
    const near = JS.shL.z < JS.shR.z ? 'L' : 'R', far = near === 'L' ? 'R' : 'L';
    const ring = neckRing(JT, dT, dS.handR * 0.9);
    const nc = JT.neckTop.clone().addScaledVector(JT.upC, -0.45 * dT.neck);
    const u = dT.h / 1.88, sl = JT.shL;
    const restEnds = [[-0.10, 0.075, -0.06], [-0.15, 0.07, -0.04], [-0.06, 0.085, -0.09], [-0.12, 0.06, -0.12]].map(([dx, dy, dz]) => sl.clone().add(V(dx * u, dy * u, dz * u)));
    placeLimb(S, dS, 'arm', near, JT, sl.clone().add(V(0.03 * u, 0.2 * u, -0.12 * u)), [...restEnds, ...angs(250, 262, 238).map(ring)], { allow: 0.02, natFn: overShoulder(JT, dT) });
    const belly = JS.P.clone().addScaledVector(JS.upC, 0.35 * dS.torso).addScaledVector(dn, -(dS.bodyD / 2 + dS.handR * 0.9));
    placeLimb(S, dS, 'arm', far, JT, nc.clone().add(V(-0.009 * dT.h, -0.03 * dT.h, 0.14 * dT.h)), [...angs(186, 175, 198, 160, 212).map(ring), belly, belly.clone().addScaledVector(JS.upC, 0.08)], { allow: 0.02, natural: false });
    return { T, S, hold: ['T.L', 'T.R'], cradle: ['R'] };
  };
  const r = pick2(cands, build, dT, dS, { tol: 0.02, noNat: true });
  return { T: r.T, S: r.S, loose: LOOSE, air: ['S'], carry: true, noNat: true, wrapArms: ['T', 'S'], hold: ['T.L', 'T.R'], cradle: ['R'], overShoulder: true };
};

// ---------- 16 树袋熊抱：S 面对面挂在 T 身上，大腿夹住 T 腰两侧、小腿垂在他身后，双臂环颈；T 双手托住她 ----------
export const koala = (dT, dS) => {
  const cands = grid2([0.34, 0.42, 0.5], [0.04, 0.07], [0.0, -0.08], [0.1, 0.16]);
  const build = ([hk, gap, bS, lb]) => {
    const T = base(dT, 0.4, 0, -PI / 2); T.lean = [0, -lb]; feetStand(T, dT, 1.3);
    const JT0 = fk(T, dT);
    const yS = JT0.P.y + hk * dT.torso;
    const frontX = JT0.P.x + JT0.upC.x * (yS - JT0.P.y) - dT.bodyD / 2;
    const S = base(dS, frontX - dS.bodyD / 2 - gap, 0, PI / 2);
    S.p[1] = yS; S.lean = [0, bS];
    T.head = [-0.45 + lb, 0, 0]; S.head = [0.45, 0, 0];
    // 他更厚实了：两人躯干之间至少留出她大腿/手臂的厚度，不够就把她往外推
    for (let it = 0; it < 3; it++) { const g0 = sdfGap(fk(S, dS), fk(T, dT)); if (g0 < gap) S.p[0] -= gap - g0; }
    const JS0 = fk(S, dS);
    const zk = dT.bodyW / 2 + dS.legR + 0.012;
    for (const [side, hip, sg] of [['L', JS0.hipL, -1], ['R', JS0.hipR, 1]]) {   // S 朝 +x：左腿在 -z
      const kn = V(JT0.P.x - 0.02 * dT.h, hip.y - 0.03 * dS.h, sg * zk);
      // 小腿绕到他身后、往中间收（脚踝在他后腰处交叠）
      legTo(S, dS, side, kn, V(JT0.P.x + dT.bodyD / 2 + dS.legR + 0.07, kn.y - 0.1 * dS.h, sg * 0.09), -1);
    }
    const JS = fk(S, dS);
    // T 双臂环住她，双手托在她后腰到臀部（她背后 = -x）
    const backS = (k, sg) => JS.P.clone().addScaledVector(JS.upC, k * dS.torso).add(V(-(dS.bodyD / 2 + dT.handR * 0.95), 0, sg * dS.bodyW * 0.22));
    // 托在她身后靠两侧（前臂贴着她腰侧绕过去，不从她身体里穿）
    const backSide = (k, sg) => JS.P.clone().addScaledVector(JS.upC, k * dS.torso).add(V(-(dS.bodyD * 0.3), 0, sg * (dS.bodyW / 2 + dT.handR * 0.95)));
    for (const [side, sg] of [['L', 1], ['R', -1]]) {
      const JTs = fk(T, dT), sh = side === 'L' ? JTs.shL : JTs.shR;
      placeLimb(T, dT, 'arm', side, JS, sh.clone().add(V(-0.06 * dT.h, -0.13 * dT.h, sg * 0.07 * dT.h)), [...[0.12, 0.25, 0.04, 0.38].map((k) => backS(k, sg)), ...[0.15, 0.3, 0.0].map((k) => backSide(k, sg))], { allow: 0.02 });
    }
    const JT = fk(T, dT);
    const ring = neckRing(JT, dT, dS.handR * 0.9 + 0.025, 0.0);   // 他肩更宽：手臂要从肩膀上方绕到颈后，环的位置贴近颈顶
    for (const [side, a0] of [['R', 250], ['L', 290]]) {
      const sh = side === 'L' ? JS.shL : JS.shR;
      placeLimb(S, dS, 'arm', side, JT, sh.clone().add(V(0.1 * dS.h, 0.05 * dS.h, (side === 'L' ? -1 : 1) * 0.06 * dS.h)), angs(a0, a0 + (side === 'L' ? 20 : -20), a0 + (side === 'L' ? -25 : 25), side === 'L' ? 330 : 210).map(ring), { allow: 0.02 });
    }
    return { T, S, hold: ['T.L', 'T.R', 'S.L', 'S.R'] };
  };
  const r = pick2(cands, build, dT, dS, { tol: 0.02, noNat: true });
  return { T: r.T, S: r.S, loose: LOOSE, air: ['S'], carry: true, hold: ['T.L', 'T.R', 'S.L', 'S.R'] };
};

// ---------- 17 坐腿上：T 坐长凳，S 侧身坐在 T 大腿上、上身转向他；内侧手搂 T 脖子，外侧手搭在自己腿上；T 揽腰、扶膝 ----------
export const lapSit = (dT, dS) => {
  const seatY = seatTopOf(dT);
  const cands = grid2([0.7, 0.82], [0.15, 0.3], [0.45, 0.65], [0.0, 0.04], [0.08, 0.16]);
  const build = ([zk, ya, tw, xo, tb]) => {
    const T = base(dT, 0, 0, 0); sitDown(T, dT, 0, 0, 0, seatY, 1.12);
    T.lean = [0, -tb]; T.head = [0.35, 0.65, 0.15];
    const JT0 = fk(T, dT);
    const yaw = PI / 2 - ya;
    const S = base(dS, xo * dT.h, JT0.P.z + zk * dT.thigh, yaw);
    S.p[1] = JT0.hipL.y + dT.legR + dS.legR + 0.004;
    S.lean = [0, 0.03]; S.twist = [tw]; S.head = [-0.1, 0.35, 0];
    const JS0 = fk(S, dS), f = rotY(yaw, 0, 0, 1);
    for (const [side, hip] of [['L', JS0.hipL], ['R', JS0.hipR]]) {
      const kn = hip.clone().addScaledVector(f, dS.thigh).add(V(0, -0.02 * dS.h, 0));
      legTo(S, dS, side, kn, kn.clone().add(V(0, -dS.shin, 0)).addScaledVector(f, 0.03 * dS.h));
    }
    const JS = fk(S, dS);
    const bk = V(0, 0, -1).applyQuaternion(JS.Qc), lf = V(-1, 0, 0).applyQuaternion(JS.Qc);   // 她的背后 / 右侧
    const waist = (k, o) => JS.P.clone().addScaledVector(JS.upC, k * dS.torso).addScaledVector(lf, dS.bodyW / 2 + dT.handR * 0.9).addScaledVector(bk, o);
    const JTs = fk(T, dT);
    placeLimb(T, dT, 'arm', 'R', JS, JTs.shR.clone().add(V(-0.03, -0.16 * dT.h, 0.06 * dT.h)), [waist(0.35, 0), waist(0.45, -0.02), waist(0.25, 0.02)], { allow: 0.02 });
    const kn = JS.kneeL.clone().lerp(JS.kneeR, 0.5);
    placeLimb(T, dT, 'arm', 'L', JS, JTs.shL.clone().add(V(0.04, -0.16 * dT.h, 0.05 * dT.h)), [0, -0.05, 0.05].map((dz) => kn.clone().add(V(-0.03, dS.legR + dT.handR * 0.9, dz))), { allow: 0.02 });
    const JT = fk(T, dT);
    const near = JS.shL.z < JS.shR.z ? 'L' : 'R', far = near === 'L' ? 'R' : 'L';
    const ring = neckRing(JT, dT, dS.handR * 0.9);
    const shN = near === 'L' ? JS.shL : JS.shR;
    placeLimb(S, dS, 'arm', near, JT, shN.clone().add(V(0, -0.05, -0.03)), angs(180, 200, 160, 220, 240).map(ring), { allow: 0.02 });
    const thighF = (far === 'L' ? JS.hipL.clone().lerp(JS.kneeL, 0.6) : JS.hipR.clone().lerp(JS.kneeR, 0.6)).add(V(0, dS.legR + dS.handR * 0.9, 0));
    const shF = far === 'L' ? JS.shL : JS.shR;
    placeLimb(S, dS, 'arm', far, JT, shF.clone().add(V(0, -0.15 * dS.h, 0)).addScaledVector(bk, -0.03), [thighF, thighF.clone().addScaledVector(f, -0.04)], { allow: 0.02 });
    return { T, S, hold: ['T.R', 'T.L', 'S.' + near] };
  };
  const r = pick2(cands, build, dT, dS, { tol: 0.02, noNat: true });
  const JTf = fk(r.T, dT);
  return { T: r.T, S: r.S, props: [benchZ(JTf, dT, seatY, -0.4 * dT.h, JTf.hipL.x + dT.legR + 0.015)], loose: LOOSE, air: ['S'], hold: ['T.R', 'T.L'] };
};

// ---------- 18 坐他怀里：T 坐长凳，S 背靠 T 坐在他腿上；T 从后面环住 S 小腹、头搁在她肩侧；S 手搭在他手臂上 ----------
export const lapHug = (dT, dS) => {
  const seatY = seatTopOf(dT);
  const cands = grid2([0.07, 0.11, 0.15], [0.3, 0.38], [0.06, 0.14], [0.0, 0.03]);
  const build = ([gap, lx, fw, sx]) => {
    const T = base(dT, 0, 0, 0); sitDown(T, dT, 0, 0, 0, seatY, 1.3);
    T.lean = [lx, fw]; T.head = [0.15, 0.25, -0.3];
    const JT0 = fk(T, dT);
    const S = base(dS, 0, 0, 0);
    sitDown(S, dS, -0.02 * dS.h - sx * dS.h, JT0.P.z + dT.bodyD / 2 + dS.bodyD / 2 + gap, 0, JT0.hipL.y + dT.legR, 1.0);
    S.lean = [0, -0.03]; S.head = [0.05, -0.25, 0.12];
    const JS = fk(S, dS);
    const fz = JS.P.z + dS.bodyD / 2 + dT.handR * 0.95 + 0.025, hy = JS.P.y + 0.38 * dS.torso;
    for (const [side, sg] of [['L', 1], ['R', -1]]) {
      const JTs = fk(T, dT), sh = side === 'L' ? JTs.shL : JTs.shR;
      placeLimb(T, dT, 'arm', side, JS, V(sg * (dS.bodyW / 2 + dT.armR + 0.03), hy + 0.05, JS.P.z - 0.01), [0.05, 0.08, 0.03].map((k) => V(sg * k * dS.h, hy + (sg < 0 ? 0.03 : 0), fz + 0.01)), { allow: 0.015 });
    }
    const JT = fk(T, dT);
    const onArm = (side) => { const w = side === 'L' ? JT.wristL : JT.wristR, e = side === 'L' ? JT.elbowL : JT.elbowR; return [0.45, 0.6, 0.3].map((k) => w.clone().lerp(e, k).add(V(0, dT.armR + dS.handR * 0.9, 0))); };
    for (const side of ['L', 'R']) {
      const sh = side === 'L' ? JS.shL : JS.shR;
      placeLimb(S, dS, 'arm', side, JT, sh.clone().add(V(0, -0.16 * dS.h, 0.04 * dS.h)), onArm(side), { allow: 0.03 });
    }
    return { T, S, hold: ['T.L', 'T.R'] };
  };
  const r = pick2(cands, build, dT, dS, { tol: 0.02 });
  return { T: r.T, S: r.S, props: [benchZ(fk(r.T, dT), dT, seatY, -0.3 * dT.h, 0.3 * dT.h)], loose: LOOSE, air: ['S'], armOnArm: true, hold: ['T.L', 'T.R'] };
};

// ---------- 19 面对面跨坐：T 坐长凳，S 面对他坐在他大腿上，双腿分开跨在他大腿外侧、小腿垂在凳子两边；双臂环颈；T 扶她后腰 ----------
export const straddle = (dT, dS) => {
  const seatY = seatTopOf(dT);
  const benchHZ = dT.hw + dT.legR + 0.012;                      // 凳子窄一点，她的小腿垂在凳子外面
  const cands = grid2([0.55, 0.65, 0.75], [-0.12, -0.05], [0.0, 0.08], [0.0, 0.04]);
  const build = ([hk, tb, sb, kd]) => {
    const T = base(dT, 0.3, 0, -PI / 2); sitDown(T, dT, 0.3, 0, -PI / 2, seatY, 1.0);
    T.lean = [0, tb]; T.head = [0.1 - tb, 0, 0];
    const JT0 = fk(T, dT);
    const S = base(dS, 0, 0, PI / 2);
    S.p[1] = JT0.hipL.y + dT.legR + dS.legR + 0.006;
    S.lean = [0, sb]; S.head = [0.1, 0, 0];
    // 两人躯干之间留出前臂的厚度：先按大腿位置放，再按胸口间距往外推
    let hipX = JT0.P.x - hk * dT.thigh; S.p[0] = hipX;
    const need = 2 * dT.armR + 0.02;
    for (let it = 0; it < 3; it++) {
      const g = sdfGap(fk(S, dS), JT0);
      if (g < need) { hipX -= need - g; S.p[0] = hipX; }
    }
    const JS0 = fk(S, dS);
    const kz = Math.max(dT.bodyW / 2, benchHZ) + dS.legR + 0.015;
    for (const [side, hip, sg] of [['L', JS0.hipL, -1], ['R', JS0.hipR, 1]]) {   // S 朝 +x：左腿在 -z
      const horz = Math.sqrt(Math.max((dS.thigh * 0.97) ** 2 - (kz - Math.abs(hip.z)) ** 2 - (kd * dS.h) ** 2, 0.01));
      const kn = V(hip.x + horz, hip.y - kd * dS.h, sg * kz);
      legTo(S, dS, side, kn, kn.clone().add(V(-0.08 * dS.h, -dS.shin, sg * 0.01)));
    }
    const JS = fk(S, dS);
    const backS = (k, sg) => JS.P.clone().addScaledVector(JS.upC, k * dS.torso).add(V(-dS.bodyD * 0.15, 0, sg * (dS.bodyW / 2 + dT.handR * 0.95)));
    for (const [side, sg] of [['L', 1], ['R', -1]]) {          // T 朝 -x：左手 = +z
      const JTs = fk(T, dT), sh = side === 'L' ? JTs.shL : JTs.shR;
      placeLimb(T, dT, 'arm', side, JS, sh.clone().add(V(-0.06 * dT.h, -0.14 * dT.h, sg * 0.06 * dT.h)), [0.25, 0.35, 0.15, 0.45].map((k) => backS(k, sg)), { allow: 0.02 });
    }
    const JT = fk(T, dT);
    const ring = neckRing(JT, dT, dS.handR * 0.9);
    for (const [side, a0] of [['R', 305], ['L', 235]]) {   // 环上 270°=他颈后；她右手在 +z 侧
      const sh = side === 'L' ? JS.shL : JS.shR;
      placeLimb(S, dS, 'arm', side, JT, sh.clone().add(V(0.1 * dS.h, 0.02 * dS.h, (side === 'L' ? -1 : 1) * 0.04 * dS.h)), angs(a0, a0 + (side === 'L' ? 20 : -20), a0 + (side === 'L' ? -20 : 20), a0 + (side === 'L' ? -45 : 45)).map(ring), { allow: 0.02 });
    }
    return { T, S, hold: ['T.L', 'T.R', 'S.L', 'S.R'] };
  };
  const r = pick2(cands, build, dT, dS, { tol: 0.02, noNat: true });
  const JT = fk(r.T, dT);
  const x0 = Math.min(JT.kneeL.x, JT.kneeR.x) + dT.legR + 0.012, x1 = JT.P.x + 0.12 * dT.h;
  return { T: r.T, S: r.S, props: [boxProp((x0 + x1) / 2, seatY / 2, 0, (x1 - x0) / 2, seatY / 2, benchHZ)], loose: LOOSE, air: ['S'], carry: true, hold: ['T.L', 'T.R'] };
};

// 平躺在 floorY 高度的平面上（头朝 -x，脸朝上）
function lieOn(s, d, headX, z, floorY) {
  s.yaw = [PI / 2]; s.pitch = [-PI / 2]; s.roll = [0]; s.lean = [0, 0]; s.twist = [0];
  s.p = [headX + 0.55 * d.h, floorY + d.bodyD / 2 + 0.003, z];
  let lo = 0, hi = PI / 2 + 0.3;
  const tmp = { ...s, head: [0, 0, 0] };
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; tmp.head = [m, 0, 0]; if (fk(tmp, d).headC.y - d.headR > floorY + 0.003) hi = m; else lo = m; }
  s.head = [(lo + hi) / 2, 0, 0];
  const J = fk(s, d), y = floorY + d.legR + 0.002, reach = (d.thigh + d.shin) * 0.99;
  legTo(s, d, 'L', V(J.hipL.x + d.thigh, y, J.hipL.z), V(J.hipL.x + reach, y, J.hipL.z), y);
  legTo(s, d, 'R', V(J.hipR.x + d.thigh, y, J.hipR.z), V(J.hipR.x + reach, y, J.hipR.z), y);
  const g = groundMin(fk(s, d)) - floorY - 0.002;               // 整体抬到最低点刚好贴床面
  shift(s, V(0, -g, 0));
}

// ---------- 20 床咚：S 仰躺在床上，T 双手撑在她头两侧、双膝跪在她腿外侧，俯身看她；S 双手抵在他胸口 ----------
export const bedPin = (dT, dS) => {
  const B = 0.45;                                              // 床面高度
  const cands = grid2([0.06, 0.1, 0.14, 0.18], [0.02, 0.05], [0.0, 0.25]);
  const build = ([sxk, hzk, hp]) => {
    const S = base(dS, 0, 0, 0); lieOn(S, dS, -0.75, 0, B);
    const JS0 = fk(S, dS);
    const T = base(dT, 0, 0, 0);
    const earW = dS.ears === 'rabbit' ? 0.5 : dS.ears === 'bear' ? 0.3 : 0;
    const hz = dS.headR * (1 + earW) + dT.handR + 0.03 + hzk * dT.h;
    const handX = JS0.headC.x + 0.02 * dT.h, handY = B + dT.handR;
    const shY = handY + dT.arm * 0.9, shX = handX + sxk * dT.h;
    const kneeY = B + dT.legR + 0.002, hipY = kneeY + dT.thigh * 0.93;
    const dyT = shY - hipY, dxT = Math.sqrt(Math.max(dT.torso ** 2 - dyT * dyT, 1e-4));
    const hipX = shX + dxT;
    orientBody(T, V(-dxT, dyT, 0), V(0, -1, 0));               // 胸口朝下
    T.p = [hipX, hipY, 0]; T.head = [-hp, 0, 0];
    const JT1 = fk(T, dT);
    for (const [side, sg] of [['L', 1], ['R', -1]]) {           // 俯身朝 -x、胸口朝下：左手侧 = 世界 +z（已用 fk 核对）
      const sh = side === 'L' ? JT1.shL : JT1.shR;
      armTo(T, dT, side, sh.clone().add(V(-0.02, -dT.upper * 0.95, sg * 0.04)), V(handX, handY, sg * hz));
    }
    const kz = dS.hw + dS.legR + dT.legR + 0.05;
    for (const [side, sg] of [['L', 1], ['R', -1]]) {
      const kn = V(hipX - 0.02, kneeY, sg * kz);
      legTo(T, dT, side, kn, kn.clone().add(V(dT.shin, 0, 0)), B + dT.footR * 0.8);
    }
    const JT = fk(T, dT);
    const chest = (k, dz) => JT.P.clone().addScaledVector(JT.upC, k * dT.torso).add(V(0, -(dT.bodyD / 2 + dS.handR * 0.95), dz));
    for (const [side, sg] of [['L', -1], ['R', 1]]) {           // S 仰躺头朝 -x：左手 = 世界 -z
      const sh = side === 'L' ? JS0.shL : JS0.shR;
      placeLimb(S, dS, 'arm', side, JT, sh.clone().add(V(0.06, 0.12, sg * 0.03)), [0.7, 0.6, 0.8].map((k) => chest(k, sg * 0.05)), { allow: 0.02, natural: false });
    }
    return { T, S, hold: ['S.L', 'S.R'] };
  };
  const r = pick2(cands, build, dT, dS, { tol: 0.015, noNat: true });
  const L = Math.max(dT.h, dS.h) + 0.35, x0 = -0.75 - 0.18;
  return {
    T: r.T, S: r.S,
    props: [boxProp(x0 + L / 2, B / 2, 0, L / 2, B / 2, 0.62, 0xe9e2f0), boxProp(x0 + 0.02, B + 0.14, 0, 0.02, 0.14, 0.6, 0xd8cfe4)],
    loose: LOOSE, air: ['T', 'S'], noNat: true, cam: { el: 0.42 }, hold: ['S.L', 'S.R'],
  };
};

// ---------- 21 穿他的衬衫：S 穿着 T 的大号衬衫（下摆盖到大腿、袖子盖过手），T 摸摸她的头 ----------
// 衬衫是 S 身上的「换装」，由渲染层每帧按她的骨架生成，颜色取 T 的颜色
export const shirt = (dT, dS) => ({ ...headPat(dT, dS), outfit: { S: 'shirt' } });

// ---------- 托膝抱：面对面，T 双臂从下面兜住 S 的膝弯把她抱起；S 大腿在他腰侧、小腿自然垂下，双臂环他的脖子 ----------
// 参考图（高个 188 / 矮个 163）：他站直，她被抱在身前、头与他齐平，他的前臂托在她膝弯/大腿下方。
export const kneeLift = (dT, dS) => {
  const cands = grid2([0.34, 0.42, 0.5], [0.05, 0.08], [0.0, -0.06], [0.08, 0.14]);
  const build = ([hk, gap, bS, lb]) => {
    const T = base(dT, 0.4, 0, -PI / 2); T.lean = [0, -lb]; feetStand(T, dT, 1.3);
    const JT0 = fk(T, dT);
    const yS = JT0.P.y + hk * dT.torso;
    const frontX = JT0.P.x + JT0.upC.x * (yS - JT0.P.y) - dT.bodyD / 2;
    const S = base(dS, frontX - dS.bodyD / 2 - gap, 0, PI / 2);
    S.p[1] = yS; S.lean = [0, bS];
    T.head = [-0.45 + lb, 0, 0]; S.head = [0.45, 0, 0];
    for (let it = 0; it < 3; it++) { const g0 = sdfGap(fk(S, dS), fk(T, dT)); if (g0 < gap) S.p[0] -= gap - g0; }
    const JS0 = fk(S, dS);
    const zk = dT.bodyW / 2 + dS.legR + 0.10;       // 膝盖分得比他身宽再开一点：小腿垂在他前臂外侧，不穿臂
    // 大腿在他腰侧水平向后，膝盖落在他体侧；小腿自然垂下（不盘腰）
    for (const [side, hip, sg] of [['L', JS0.hipL, -1], ['R', JS0.hipR, 1]]) {
      const kn = V(JT0.P.x - 0.02 * dT.h, hip.y - 0.03 * dS.h, sg * zk);
      legTo(S, dS, side, kn, V(kn.x - 0.02, kn.y - dS.shin, sg * (zk + 0.07)), -1);
    }
    const JS = fk(S, dS);
    // T 双手从下面兜住膝弯：他面朝 -x，他的左手在 +z，对应她的右膝（z>0）
    for (const [side, sg] of [['L', 1], ['R', -1]]) {
      const JTs = fk(T, dT), sh = side === 'L' ? JTs.shL : JTs.shR;
      const kn = sg > 0 ? JS.kneeR : JS.kneeL, hp = sg > 0 ? JS.hipR : JS.hipL;
      const under = (t) => hp.clone().lerp(kn, t).add(V(0, -(dS.legR + dT.handR * 0.95), 0));
      placeLimb(T, dT, 'arm', side, JS, sh.clone().add(V(0.06 * dT.h, -0.24 * dT.h, sg * 0.03 * dT.h)), [under(0.55), under(0.47), under(0.63)], { allow: 0.02, natural: false });
    }
    // S 双手搭在他两侧肩头（她的头比他高，绕脖会穿他肩膀；参考图里就是搭肩）
    const JT = fk(T, dT);
    for (const [side, sg] of [['R', 1], ['L', -1]]) {            // S 朝 +x：右手在 +z，对应他的左肩（+z）
      const shT = sg > 0 ? JT.shL : JT.shR, shS = side === 'L' ? JS.shL : JS.shR;
      const top = shT.clone().add(V(-0.015, dT.armR * 1.15 + dS.handR * 0.75, sg * -0.01));
      placeLimb(S, dS, 'arm', side, JT, shS.clone().add(V(0.02 * dS.h, -0.12 * dS.h, sg * 0.12 * dS.h)), [top, top.clone().add(V(-0.02, 0.01, 0))], { allow: 0.025, natural: false });
    }
    return { T, S, hold: ['T.L', 'T.R', 'S.L', 'S.R'] };
  };
  const r = pick2(cands, build, dT, dS, { tol: 0.02, noNat: true });
  return { T: r.T, S: r.S, loose: LOOSE, air: ['S'], carry: true, hold: ['T.L', 'T.R', 'S.L', 'S.R'] };
};
