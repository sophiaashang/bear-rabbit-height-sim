// 枕大腿 v2：T 在地面正坐(seiza：小腿折在大腿下、坐在脚跟上)，S 仰面平躺在地上、后脑枕在 T 大腿上。
// 照 lap-pillow 参考实现：S 头心高度 = 大腿上表面 + 头半径(沉进大腿一点点软肉)，躯干仰角由头高反解(相当于 asin((targetHeadY-躯干中心高)/脊柱长))，
// 骨盆和双腿平贴地面；S 头后仰 -0.35，T 头低下、上身直立。
// 朝向：T yaw=-π/2 面朝 -x，大腿朝 -x，左手侧 = 世界 +z；S 沿 ±z 横躺(带斜角)，头→脚方向 = (sin a, 0, ±cos a)。
import { V, fk, groundMin, sdf, selfPen } from './model.js';
import { PI, base, legTo, placeLimb, penAll, jointCost, elbowPenalty, setQuick } from './poseutil.js';
import { orientBody } from './poses_c.js';

const LOOSE = ['hd', 'fa', 'ua', 'head', 'ear', 'torso', 'th', 'sh'];
const SINK = 0.014;                        // 头沉进大腿的深度(米)，检测容差 2cm 以内

// 头球(半径 r)放在 (x,z) 上方，沉进 T 大腿/小腿 sink 米时的头心高度
function headYOnLap(JT, x, z, r, sink) {
  const pen = (y) => {
    const p = V(x, y, z); let m = 1e9;
    for (const q of JT.parts) if (q.own === 'th' || q.own === 'sh') m = Math.min(m, sdf(q, p));
    return r - m;
  };
  let lo = 0, hi = 2;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (pen(mid) > sink) lo = mid; else hi = mid; }
  return hi;
}
// 手臂/小臂陷地惩罚
const floorPen = (J, side) => {
  let w = 0;
  for (const p of J.parts) if (p.n === 'ua' + side || p.n === 'fa' + side || p.n === 'hd' + side) {
    const lo = p.t === 'sph' ? p.c.y - p.r : Math.min(p.a.y, p.b.y) - p.r; w = Math.max(w, -lo);
  }
  return w * 20;
};
function holdGap(r, JT, JS) {
  let t = 0;
  for (const h of r.hold || []) {
    const [who, side] = h.split('.'); const J = who === 'T' ? JT : JS, O = who === 'T' ? JS : JT;
    const hand = J.parts.find((q) => q.n === 'hd' + side); let g = 1e9;
    for (const q of O.parts) if (['torso', 'head', 'ear', 'ua', 'fa', 'hd', 'th', 'sh'].includes(q.own)) g = Math.min(g, sdf(q, hand.c) - hand.r);
    t += Math.max(0, g - 0.012) * 3;
  }
  return t;
}

export const lapPillow = (dT, dS) => {
  const build = (c) => {
    const { a, sg, zc, tf, hf, yw, xo, tl, ks, rh } = c;
    // ---------------- T：地面正坐 ----------------
    const T = base(dT, 0, 0, -PI / 2);
    const hipY = hf * dT.legR;
    T.p = [0, hipY, 0]; T.lean = [0, tl]; T.head = [0.55, 0, 0];
    const JT0 = fk(T, dT);
    const ky = dT.legR + 0.002;
    for (const [side, hip, k] of [['L', JT0.hipL, 1], ['R', JT0.hipR, -1]]) {
      const rise = hip.y - ky, sp = ks * dT.h, hl = Math.sqrt(Math.max((dT.thigh * 0.995) ** 2 - rise * rise - sp * sp, 0.01));
      const kn = V(hip.x - hl, ky, hip.z + k * sp);
      legTo(T, dT, side, kn, V(kn.x + dT.shin, ky, hip.z + k * sp * 0.3), ky);   // 小腿折回、贴地、踝在臀下
    }
    const JT = fk(T, dT);
    // ---------------- S：仰躺 ----------------
    const dir = V(Math.sin(a), 0, sg * Math.cos(a)).normalize();     // 头 -> 脚
    const S = base(dS, 0, 0, 0);
    orientBody(S, dir.clone().negate(), V(0, 1, 0));
    S.head = [-0.35, yw, 0];
    const mHip = JT.hipL.clone().lerp(JT.hipR, 0.5), mKnee = JT.kneeL.clone().lerp(JT.kneeR, 0.5);
    const ref = mHip.clone().lerp(mKnee, tf);                        // 大腿上「膝顶参考点」
    const tx = ref.x + xo, tz = zc;
    const ty = headYOnLap(JT, tx, tz, dS.headR, SINK);
    const hzS = dS.bodyD / 2;
    const place = (th) => { S.lean = [0, th]; S.p = [0, hzS * Math.cos(th) + 0.001, 0]; return fk(S, dS); };
    let lo = 0, hi = 1.3;
    if (place(0).headC.y >= ty) hi = 0;
    else for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (place(m).headC.y > ty) hi = m; else lo = m; }
    const th = hi, J1 = place(th);
    S.p = [tx - J1.headC.x, S.p[1], tz - J1.headC.z];
    const J2 = fk(S, dS);
    const perp = J2.hipL.clone().sub(J2.hipR); perp.y = 0; perp.normalize();
    for (const [side, hip, k] of [['L', J2.hipL, 1], ['R', J2.hipR, -1]]) {
      const d2 = dir.clone().addScaledVector(perp, k * Math.tan(0.087)).normalize();
      const kn = hip.clone().addScaledVector(d2, dS.thigh);
      legTo(S, dS, side, kn, kn.clone().addScaledVector(d2, dS.shin), dS.legR + 0.002);
    }
    // 腿贴地：整体微调使最低点 = 0
    const g0 = groundMin(fk(S, dS)); S.p[1] -= g0; for (const k of ['fL', 'fR']) S[k][1] -= g0;
    // S 的手：贴着身侧放在地上
    const JS = fk(S, dS);
    for (const [side, sh, k] of [['L', JS.shL, 1], ['R', JS.shR, -1]]) {
      const out = perp.clone().multiplyScalar(k);
      const mk = (len, o) => { const p = sh.clone().addScaledVector(dir, len * dS.arm).addScaledVector(out, o * dS.h); p.y = dS.handR + 0.004; return p; };
      placeLimb(S, dS, 'arm', side, JT, sh.clone().addScaledVector(dir, 0.3 * dS.arm).addScaledVector(out, 0.03 * dS.h).add(V(0, -0.2, 0)),
        [mk(0.84, 0.045), mk(0.76, 0.05), mk(0.9, 0.04), mk(0.7, 0.07)], { allow: 0.02, natFn: (J, sd) => elbowPenalty(J, sd) + floorPen(J, sd) });
    }
    const JSf = fk(S, dS);
    // T 低头看她
    const v = JSf.headC.clone().sub(fk(T, dT).headC);
    T.head = [0.55, Math.max(-0.6, Math.min(0.6, Math.atan2(v.z, -v.x) * 0.8)), 0];
    // T 的手：左手轻放在她头侧/额头，右手放自己大腿上
    const JT2 = fk(T, dT);
    const Hq = JSf.Qh;
    const face = V(0, 0, 1).applyQuaternion(Hq), top = V(0, 1, 0).applyQuaternion(Hq), sd = V(1, 0, 0).applyQuaternion(Hq);
    const hr = dS.headR + dT.handR * 0.7;
    const onHead = [
      top.clone().multiplyScalar(0.6).addScaledVector(face, 0.8),
      top.clone().multiplyScalar(0.8).addScaledVector(face, 0.5),
      sd.clone().multiplyScalar(0.9).addScaledVector(face, 0.4),
      sd.clone().multiplyScalar(-0.9).addScaledVector(face, 0.4),
      top.clone().multiplyScalar(0.3).addScaledVector(face, 0.95),
      face.clone(),
    ].map((u) => JSf.headC.clone().addScaledVector(u.normalize(), hr));
    const onChest = [0.88, 0.74, 0.96, 0.6].map((k) => JSf.P.clone().addScaledVector(JSf.upC, k * dS.torso).add(V(0, dS.bodyD / 2 + dT.handR * 0.85, 0)));
    const tgtL = c.hand === 'chest' ? onChest : onHead;
    placeLimb(T, dT, 'arm', 'L', JSf, JT2.shL.clone().add(V(-0.04 * dT.h, -0.17 * dT.h, 0.03 * dT.h)), tgtL, { allow: 0.02 });
    const thighTop = (f, lat) => { const p = JT.hipR.clone().lerp(JT.kneeR, f); p.y += dT.legR * 0.95 + dT.handR * 0.85; p.z -= lat * dT.legR; return p; };
    const RH = [[[0.5, 0.5], [0.62, 0.5], [0.4, 0.5], [0.72, 0.4]], [[0.8, 0.3], [0.9, 0.3], [1.0, 0.3]], [[0.35, 0.9], [0.45, 0.9], [0.55, 0.9]], [[0.85, 1.0], [0.95, 1.0], [0.75, 1.0]], [[0.9, -0.6], [0.8, -0.6], [1.0, -0.6]]][rh];
    placeLimb(T, dT, 'arm', 'R', JSf, JT2.shR.clone().add(V(0, -0.15 * dT.h, -0.09 * dT.h)), RH.map(([f, l]) => thighTop(f, l)), { allow: 0.025 });
    return { T, S, props: [], hold: ['T.L'] };
  };

  const cands = [];
  for (const hand of ['chest', 'head']) for (const tl of [-0.04, 0.04]) for (const ks of [0.04, 0.08]) for (const rh of [1, 2, 3, 4]) for (const a of [0, -0.3])
    for (const xo of [-0.06, -0.09]) for (const yw of [0.35]) cands.push({ a, sg: 1, zc: 0.04, tf: 0.75, hf: 2.8, yw, xo, tl, hand, ks, rh });

  setQuick(true);
  let best = cands[0], bs = Infinity;
  for (const c of cands) {
    const r = build(c); const JT = fk(r.T, dT), JS = fk(r.S, dS);
    let miss = 0; for (const J of [JT, JS]) for (const k of Object.keys(J.miss)) miss += Math.max(0, J.miss[k] - 0.008);
    const gS = groundMin(JS);
    const sc = Math.max(0, penAll(JT, JS) - 0.01) * 3 + Math.max(selfPen(JT).depth, selfPen(JS).depth) * 1.5
      + jointCost(JT) + jointCost(JS) + holdGap(r, JT, JS) + miss * 3 + Math.max(0, -gS - 0.003) * 5 + Math.max(0, gS - 0.02) * 5
      + 0.0006 * Math.abs(c.a + 0.5) + (c.sg < 0 ? 0.02 : 0) + 0.0004 * Math.abs(c.zc) + 0.002 * c.ks / 0.04 + 0.0015 * Math.abs(c.yw) + 0.0004 * Math.abs(c.xo) * 10;
    if (sc < bs) { bs = sc; best = c; }
  }
  setQuick(false);
  const r = build(best);
  return { ...r, loose: LOOSE, noNat: true, cam: { el: 0.32 }, _pick: best };
};
