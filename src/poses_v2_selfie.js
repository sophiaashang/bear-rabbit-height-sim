// v4：解析摆肘。肘位 = (sh.x+ox, el_y, sh.z+dz)：
//   dz 从小到大试 [0.15,0.18,0.21,0.24,0.27,0.30]，ox∈{-0.03,-0.015,0,0.015}（贴身侧）；
//   el_y = max(grab.y - sqrt(fore99²-(grab.z-el.z)²-ox²),  grab.y - tan(48°)*(grab.z-el.z))
//          且 ≤ sh.y-0.026（A1 留 6mm 余量）；前者=可达下限，后者=A3≤48° 下限。
//   腕 = 肘->grab 方向 0.99fore；armTo 过。评分：A3 小、肘低、|ox| 小优先；
//   自碰(uaL/faL~躯干)与对 S 穿模超容差直接判废。
// 全都不行才退回旧 placeLimb（_pa 记 need，纯诊断）。
import * as THREE from 'three';
import { V, fk, penetration, selfPen, sdf, groundMin } from './model.js';
import { PI, base, solve, footAt, placeLimb, setQuick, grid2, loc, handsHang, elbowAngle, elbowFlare, kneeAngle, armTo } from './poseutil.js';

function aimHead(s, d, target, roll = 0) {
  s.head = [0, 0, 0];
  const J = fk(s, d);
  const f = target.clone().sub(J.headC).normalize();
  const up = V(Math.sin(roll), Math.cos(roll), 0);
  up.addScaledVector(f, -up.dot(f)).normalize();
  const x = up.clone().cross(f).normalize();
  const y = f.clone().cross(x);
  const qw = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, f));
  const e = new THREE.Euler().setFromQuaternion(J.Qc.clone().invert().multiply(qw), 'YXZ');
  s.head = [e.x, e.y, e.z];
}

const DZ = 0.26, PY = -0.02;                // 手机中心：脸前 26cm、两头连线中点略下
const PYMIN = 0.004;                        // 但不得低于两头中较低的头心 + PYMIN（A5: 手机 y 在两头之间）
const PHONE_OFF = V(0, 0.06, -0.045);       // 手机中心相对握点(手心)：略高、在手前(朝脸)一点
const ARMS = ['ua', 'fa', 'hd'];
const NOARM = (a, b) => !ARMS.includes(a.own) && !ARMS.includes(b.own);
const pcOf = (JT, JS) => {
  const midY = (JT.headC.y + JS.headC.y) / 2 + PY;
  const y = Math.max(midY, Math.min(JT.headC.y, JS.headC.y) + PYMIN);
  return V((JT.headC.x + JS.headC.x) / 2, y,
    Math.max(JT.headC.z + JT.d.headR, JS.headC.z + JS.d.headR) + DZ);
};

function bodyCost(r, dT, dS) {
  const JT = fk(r.T, dT), JS = fk(r.S, dS);
  let c = 0;
  const p = Math.max(penetration(JT, JS, NOARM).depth, penetration(JS, JT, NOARM).depth);
  c += Math.max(0, p - 0.006) * 10 + p * 0.5;
  // 持机大臂走线：T 持机肩(靠 S 侧)与 S 躯干 x 带重叠时，大臂前伸必横穿 S 躯干——身体分直接罚，
  // 让 search 偏向「T 肩在 S 躯干外侧」的站位（Arms 阶段救不回这个构图）。
  {
    const shx = JT.shL.x > JT.shR.x ? JT.shL.x : JT.shR.x;
    const sxL = JS.P.x - JS.d.bodyW / 2, sxR = JS.P.x + JS.d.bodyW / 2;
    const syT = JS.P.y + JS.d.torso + JS.d.leg;
    if (JT.shL.y < syT + dT.armR && shx + dT.armR > sxL && shx - dT.armR < sxR) c += 0.2 + Math.min(sxR - sxL, dT.armR) * 4;
  }
  for (const J of [JT, JS]) {
    const g = groundMin(J);
    c += Math.max(0, -0.003 - g) * 8 + Math.max(0, g - 0.02) * 8;
    for (const sd of ['L', 'R']) c += Math.max(0, kneeAngle(J, sd) - 65) * 0.02;
  }
  const gap = JT.headC.distanceTo(JS.headC) - dT.headR - dS.headR;
  c += Math.max(0, gap - 0.004) * 10 + Math.max(0, -0.02 - gap) * 10;
  return c;
}

const TOLP = { hd: 0.02, fa: 0.02, ua: 0.02, head: 0.02, ear: 0.012, th: 0.02, sh: 0.02, torso: 0.02 };
const MARGIN = 0.8;
function cost(r, dT, dS) {
  const JT = fk(r.T, dT), JS = fk(r.S, dS);
  const own = (J, n) => J.parts.find((x) => x.n === n)?.own;
  let hard = 0, soft = 0;
  for (const [pp, A, B] of [[penetration(JT, JS), JT, JS], [penetration(JS, JT), JS, JT]]) {
    if (pp.depth <= 0) continue;
    const oa = own(A, pp.a), ob = own(B, pp.b);
    const t = (oa === 'head' && ob === 'head') ? 0.032 : (oa === 'hd' && ob === 'hd') ? 0.06 : (oa === 'hd' || ob === 'hd') ? 0.035 : Math.max(TOLP[oa] ?? 0.012, TOLP[ob] ?? 0.012);
    hard += Math.max(0, pp.depth - t * MARGIN);
    soft += pp.depth * 0.2;
  }
  for (const J of [JT, JS]) {
    hard += Math.max(0, selfPen(J).depth - 0.02 * MARGIN);
    const g = groundMin(J);
    hard += Math.max(0, -g - 0.005) + Math.max(0, g - 0.025);
    for (const k of Object.keys(J.miss)) hard += Math.max(0, J.miss[k] - (k[0] === 'f' ? 0.035 : 0.012) * MARGIN);
    for (const sd of ['L', 'R']) {
      const ea = elbowAngle(J, sd), ka = kneeAngle(J, sd), fl = elbowFlare(J, sd);
      hard += Math.max(0, ea - 70) * 0.01 + Math.max(0, ka - 75) * 0.01 + Math.max(0, fl - 0.035 * MARGIN);
      soft += Math.max(0, ea - 40) * 0.0004 + Math.max(0, ka - 55) * 0.0004 + fl * 0.5;
    }
  }
  const gap = JT.headC.distanceTo(JS.headC) - dT.headR - dS.headR;
  hard += Math.max(0, gap - 0.009) + Math.max(0, -0.024 - gap);
  soft += Math.abs(gap - 0.0) * 0.1;
  for (const h of r.hold || []) {
    const [who, side] = h.split('.'); const J = who === 'T' ? JT : JS, O = who === 'T' ? JS : JT;
    const hand = J.parts.find((q) => q.n === 'hd' + side); let g = 1e9;
    for (const q of O.parts) if (['torso', 'head', 'ear', 'ua', 'fa', 'hd', 'th', 'sh'].includes(q.own)) g = Math.min(g, sdf(q, hand.c) - hand.r);
    hard += Math.max(0, g - 0.022);
  }
  return hard * 50 + soft;
}

export const selfie = (dT, dS) => {
  const hrSum = dT.headR + dS.headR;
  const zOff = -0.04, yOff = 0.03;
  // sq = S 屈膝下蹲档：S 蹲 → S 头/躯干顶一起降 → T 直立高肩(大臂从 S 躯干顶上方越过) + 前弯贴头两全
  const candsA = grid2([0.28, 0.16, 0.38, 0.44], [0.09], [0.18, -0.13], [0.8], [0.15], [0.15], [0.3], [0.15], [0, 0.35]);
  const candsB = grid2([0.45], [0.03, 0.09, 0.15], [0.22, 0.05, -0.05], [0.6, 1.0], [0, 0.3], [0.15], [0.3, 0.45], [-0.05, 0.15], [0.25]);

  const body = ([tilt, sLean, zs, spr, htT, htS, gap, sF, sq]) => {
    const sep = (dT.bodyW + dS.bodyW) / 2 + gap;
    const S = base(dS, sep / 2, -zs, 0);
    S.lean = [-sLean, sF];
    if (sq > 0) {                                   // ★ S 屈膝下蹲：骨盆降 sq×leg，双脚原地收回落地
      S.p[1] = dS.leg * (1 - sq);
      const JS0 = fk(S, dS);
      footAt(S, dS, 'L', JS0.hipL.x + 0.03 * dS.h, JS0.hipL.z + 0.04);
      footAt(S, dS, 'R', JS0.hipR.x - 0.03 * dS.h, JS0.hipR.z + 0.04);
    }
    handsHang(S, dS, 0.03);
    const T = base(dT, -sep / 2, zs, 0);
    T.kneePoleL = [0.25, 0, 1]; T.kneePoleR = [0.25, 0, 1];
    T.lean = [Math.min(tilt, 0.34), 0.08];   // 侧倾封顶：持机肩别塌（0.28→0.34：高差组头贴不住的余量）
    const D = hrSum - 0.01;
    const dx = -Math.sqrt(Math.max(D * D - zOff * zOff - yOff * yOff, 0));
    let JS = fk(S, dS);
    let pc = V(JS.headC.x - 0.16, JS.headC.y + PY, JS.headC.z + dS.headR + DZ);
    const adj = V(0, 0, 0);
    for (let k = 0; k < 5; k++) {
      aimHead(S, dS, pc, -htS);
      JS = fk(S, dS);
      const tg = JS.headC.clone().add(V(dx, yOff, zOff)).add(adj);
      solve(T, dT, [['p', 0, -1.5, 1.5], ['p', 1, dT.leg * 0.74, dT.leg * 1.03], ['lean', 1, -0.2, 0.9]],
        (J) => [J.headC.x - tg.x, J.headC.y - tg.y, J.headC.z - tg.z], 56);
      aimHead(T, dT, pc, htT);
      const JT = fk(T, dT);
      adj.sub(JT.headC.clone().sub(JS.headC).sub(V(dx, yOff, zOff)));
      pc = pcOf(JT, JS);
    }
    const J = fk(T, dT);
    footAt(T, dT, 'L', J.hipL.x + 0.15 * spr * dT.h, J.hipL.z + 0.02);
    footAt(T, dT, 'R', J.hipR.x - spr * dT.h * 0.12, J.hipR.z + 0.05);
    return { T, S, pc, htS };
  };

  // —— T 持机左臂：解析摆肘（见文件头注释）。返回 {ok, dz, a3, need} 纯诊断。
  const TAN50 = Math.tan(50 * Math.PI / 180);
  const phoneArm = (T, dT, grab, JO) => {
    const J0 = fk(T, dT), sh = J0.shL;
    const fore = dT.fore * 0.99, fore2 = fore * fore;
    const names = ['uaL', 'faL', 'hdL'], otherL = ['uaR', 'faR', 'hdR'];
    let best = null, bs = 1e9, need = 0;
    const why = { reach: 0, a1: 0, penS: 0, penO: 0, ang: 0, n: 0 };
    let near = null, nv = 1e9;                                   // 无解时用「最接近达标」的组合固化手臂
    const trial = (dz, ox, zNudge) => {
      why.n++;
      const ez = sh.z + dz + zNudge, ex = sh.x + ox;
      const hoz = grab.z - ez;
      if (hoz <= 0.02) { why.reach++; return; }
      const mf = fore2 - hoz * hoz - ox * ox;
      if (mf <= 0.0004) { need = Math.max(need, Math.hypot(hoz, ox) - fore); why.reach++; return; }
      const yReach = grab.y - Math.sqrt(mf);              // 可达下限（肘再低腕就够不着）
      const yA3 = grab.y - TAN50 * hoz;                   // A3≤50° 下限（肘再低前臂更陡）
      const ey = Math.max(yReach, yA3);
      const e = V(ex, ey, ez);
      const v = grab.clone().sub(e);
      const w = e.clone().addScaledVector(v.clone().normalize(), Math.min(v.length(), fore));
      armTo(T, dT, 'L', e, w);
      const J = fk(T, dT);
      // 先摆好再按序查：A1 → 自碰(≤0.021) → 对方穿模(≤0.015) → 角度；每种违规都进 near 候选池
      const dyE = J.elbowL.y - J.shL.y;
      const a1gap = Math.max(0, dyE + 0.022);             // A1: 肘要低于肩 2.2cm 以上
      const lim = J.parts.filter((p) => names.includes(p.n));
      const pS = penetration({ parts: lim }, J, (a, b) => b.own === 'torso' || b.own === 'head' || otherL.includes(b.n)).depth;
      const pO = JO ? penetration({ parts: lim }, JO).depth : 0;
      const fa = Math.atan2(Math.abs(J.wristL.y - J.elbowL.y), Math.hypot(J.wristL.x - J.elbowL.x, J.wristL.z - J.elbowL.z)) * 180 / Math.PI;
      const worst = a1gap + Math.max(0, pS - 0.021) * 2 + Math.max(0, pO - 0.015) * 10 + Math.max(0, fa - 60) / 100;
      if (worst > 0) {
        if (worst < nv) { nv = worst; near = [e, w]; }
        if (a1gap > 0) { why.a1++; need = Math.max(need, ey - (sh.y - 0.024)); }
        else if (pS > 0.021) why.penS = Math.max(why.penS, pS);
        else if (pO > 0.015) why.penO = Math.max(why.penO, pO);
        else why.ang++;
        return;
      }
      const sc = fa + 20 * (dyE + 0.03) + 30 * Math.abs(ox) + 4 * dz + 400 * pS + 400 * pO;
      if (sc < bs) { bs = sc; best = [e, w, dz, fa, dyE]; }
    };
    for (const dz of [0.10, 0.13, 0.16, 0.19, 0.22, 0.25, 0.28, 0.31, 0.34]) for (const ox of [-0.03, -0.015, 0, 0.015]) trial(dz, ox, 0);
    if (!best) for (const zNudge of [0.005, 0.01]) {           // ① 前臂擦自己躯干时肘再外挪 5~10mm
      for (const dz of [0.19, 0.22, 0.25, 0.28]) for (const ox of [-0.03, -0.015, 0, 0.015]) trial(dz, ox, zNudge);
      if (best) break;
    }
    if (!best) {
      if (near && near[1]) armTo(T, dT, 'L', near[0], near[1]);  // 固化最接近的摆臂（确定性，不留循环残留）
      return { ok: false, need, dz: null, a3: null, why, nv };
    }
    armTo(T, dT, 'L', best[0], best[1]);
    return { ok: true, need: 0, dz: best[2], a3: best[3], dy: best[4] };
  };

  const arms = (b, mode, ev = 0) => {
    const T = { ...b.T }, S = { ...b.S };
    for (const k of Object.keys(T)) T[k] = T[k].slice();
    for (const k of Object.keys(S)) S[k] = S[k].slice();
    const { pc, htS } = b;
    const JT0 = fk(T, dT), JS0 = fk(S, dS);
    {   // T 远侧(R)手：向外下方甩开
      const ends = [0.35, 0.5, 0.7, 0.9, 1.1].map((th) => JT0.shR.clone().add(V(-Math.sin(th), -Math.cos(th), 0).multiplyScalar(0.93 * dT.arm)));
      const want = JT0.shR.clone().add(V(-0.5, -0.85, 0).normalize().multiplyScalar(dT.upper));
      placeLimb(T, dT, 'arm', 'R', JS0, want, ends, { allow: 0.01 });
    }
    const grab = pc.clone().sub(PHONE_OFF);
    let pa = phoneArm(T, dT, grab, fk(S, dS));
    if (!pa.ok) {   // 够不到（miss>0）时握点向肩收近重试一次：手机随 hL 移，仍保持在 S 脸前
      const shv = fk(T, dT).shL;
      const grab2 = shv.clone().add(grab.clone().sub(shv).setLength(Math.max(grab.distanceTo(shv) - 0.035, dT.arm * 0.92)));
      const pa2 = phoneArm(T, dT, grab2, fk(S, dS));
      if (pa2.ok) { pa = pa2; }
    }
    // 持机臂摆不进「肘贴身略前+肘低于肩」时：这个 body 候选直接判废（大罚分），
    // 让 search 换站位/倾角组合——不再退回旧 placeLimb（那正是「肘被 IK 抬到肩上」的来源）。
    const dead = !pa.ok;
    const phone = V(...T.hL).add(PHONE_OFF);
    aimHead(S, dS, phone, -htS);
    const hold = [];
    if (mode === 'hug') {
      const JT = fk(T, dT), JS = fk(S, dS), hr = dS.handR, ends = [];
      for (const k of [0.1, 0.2, 0.3]) {
        ends.push(loc(JT, V(dT.bodyW / 2 + hr * 0.2, k * dT.torso, -dT.bodyD * 0.15)));
        ends.push(loc(JT, V(dT.bodyW * 0.3, k * dT.torso, dT.bodyD / 2 + hr * 0.2)));
        ends.push(loc(JT, V(dT.bodyW * 0.3, k * dT.torso, -dT.bodyD / 2 - hr * 0.4)));
      }
      const wantS = JS.shR.clone().add(V(-0.05, -0.17 * dS.h, -0.03));
      placeLimb(S, dS, 'arm', 'R', JT, wantS, ends, { allow: 0.022 });
      hold.push('S.R');
    }
    return { T, S, props: [{ type: 'phone', at: [phone.x, phone.y, phone.z], ry: PI }], hold, headTouch: true,
      loose: ["hd", "fa", "ua", "head", "ear", "torso", "th", "sh"], _pa: pa, _dead: dead ? 10 + (pa.nv ?? pa.need) : 0 };
  };

  const search = (cands, topN = 3) => {
    const scored = cands.map((c, i) => ({ c, i, b: body(c), sc: 0 }));
    for (const s of scored) s.sc = bodyCost(s.b, dT, dS) + 0.0004 * s.i;
    scored.sort((a, b) => a.sc - b.sc);
    const all = [];
    for (const { c, b } of scored.slice(0, topN)) {
      for (const mode of ['hug', 'hang']) {
        const rr = arms(b, mode, 0);
        all.push({ args: [c, mode, 0], b, rr, sc: cost(rr, dT, dS) + (mode === "hang" ? 0.01 : 0) + (rr._dead || 0) });
      }
    }
    all.sort((a, b) => a.sc - b.sc);
    return all;
  };
  setQuick(true);
  let pool = search(candsA);
  // 首搜分高但「持机臂摆成功」（_dead=0）时不补搜：sq 蹲档等构型 bodyCost 因头差/蹲姿天然偏高，
  // 补搜只会烧时间且找不回更好的；只有 dead（肘位失败）才值得换构型重搜。
  if (false) {   // 首搜分高不再触发补搜（sq 构型 bodyCost 天然偏高，dead 判据才补）
    pool = pool.concat(search(candsB)).sort((a, b) => a.sc - b.sc);
    if (pool[0].sc > 0.05) pool = pool.concat(search(candsA, 16), search(candsB, 16)).sort((a, b) => a.sc - b.sc);
  }
  if ((pool[0].rr?._dead ?? 0) > 0) {   // 仅 top3 全 dead 时在 candsA 内深挖一次（candsB 实测无更好构型）
    pool = pool.concat(search(candsB)).sort((a, b) => a.sc - b.sc);
    if ((pool[0].rr?._dead ?? 0) > 0) pool = pool.concat(search(candsA, 16)).sort((a, b) => a.sc - b.sc);
  }
  const [c, mode, ev] = pool[0].args;
  const out = arms(pool[0].b, mode, ev);
  setQuick(false);
  return out;
};
