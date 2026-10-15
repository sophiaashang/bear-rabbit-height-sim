// 姿势 1-7。build(dT, dS) -> { T: 高个状态, S: 矮个状态, loose?, air?, props?, cam? }
// 画面约定：矮个在左(x<0)，高个在右(x>0)，默认面向镜头(+z)。侧面姿势里 S 朝 +x(yaw=π/2)，T 朝 -x(yaw=-π/2)。
// 角色局部坐标：+x=左手侧，+y=上，+z=正面。
import { V, fk, selfPen, penetration, sdf } from './model.js';
import { PI, set, base, feetStand, handsHang, bendForHeadY, solve, touch, fitArm, pick2, grid2, placeLimb, ELBOW_NAT, elbowAngle, elbowFlare, jointCost, setQuick, jointCostWorldArms, elbowPenaltyWorld } from './poseutil.js';

const sepStand = (dT, dS) => dT.sw + dS.sw + 0.13 * Math.min(dT.h, dS.h);

export const stand = (dT, dS) => {
  const sep = sepStand(dT, dS);
  return { T: base(dT, sep / 2, 0), S: base(dS, -sep / 2, 0) };
};

export const holdHands = (dT, dS) => {
  const sep = sepStand(dT, dS);
  const T = base(dT, sep / 2, 0), S = base(dS, -sep / 2, 0);
  const JT = fk(T, dT), JS = fk(S, dS);
  const dx = JT.shR.x;
  const myT = JT.shR.y - Math.sqrt(Math.max((0.93 * dT.arm) ** 2 - dx * dx, 0));
  const myS = JS.shL.y - 0.93 * dS.arm * 0.85;
  const my = Math.max(myT, myS);
  const gap = 0.9 * Math.max(dT.handR, dS.handR);
  set(T, 'hR', V(gap, my, 0.02 * dT.h));
  set(S, 'hL', V(-gap, my, 0.02 * dT.h));
  T.armPoleR = [0, -1, -1]; S.armPoleL = [0, -1, -1];
  return { T, S, loose: ['hd'] };
};

// 靠肩：两人并肩，她朝他歪头，头靠在他近侧肩/上臂；他近侧手臂绕到她背后搭在她远侧肩；她双手自然垂放
// 三处修正，逐条：
// ① 她的手不再去够他的腰（他在她侧后方，手只能绕到自己背后，像反背着手）
// ② 并肩站，前后差 ≤0.08 身高（旧版她整整站在他身前 21cm）
// ③ 两人收近：躯干间隙只留够她一条胳膊垂下；身体微微转向他，头明显歪过去贴上（约25°，太小正面看不出在靠），身体不倾
export const shoulderLean = (dT, dS) => {
  // [躯干间隙/身高, 转向他, 歪头, 额外前移/身高]。等高时他绕过来的上臂会压在她上臂上，只能让她稍微靠前一点让路
  const cands = grid2([0.08, 0.09, 0.10], [0.2, 0.35], [-0.45, -0.38, -0.30], [0, 0.03, 0.05]);
  const build = ([g, yaw, hr, zx]) => {
    const T = base(dT, 0, 0); T.head = [0.15, -0.4, 0.0];
    const JT0 = fk(T, dT);
    const S = base(dS, -(dT.bodyW / 2 + dS.bodyW / 2 + g * dS.h), 0, yaw);
    S.head = [0, 0, hr];
    const zAt = (z) => { S.p[2] = z; feetStand(S, dS); handsHang(S, dS); };
    const headGap = () => { const J = fk(S, dS); let m = 1e9; for (const q of JT0.parts) if (['ua', 'torso', 'head'].includes(q.own)) m = Math.min(m, sdf(q, J.headC) - dS.headR); return m; };
    // 沿前后方向二分：头刚好贴住他的肩/上臂（嵌入 ≤0.8cm）；往前最多 0.06 身高
    let lo = 0, hi = 0.06 * dS.h;
    zAt(0);
    if (headGap() < -0.008) {
      for (let k = 0; k < 24; k++) { const m = (lo + hi) / 2; zAt(m); if (headGap() < -0.008) lo = m; else hi = m; }
      zAt(hi);
    }
    if (zx) zAt(Math.min(S.p[2] + zx * dS.h, 0.08 * dS.h));
    // 远侧右手：身体转向他后可能擦到自己腰，往外挪到刚好不碰
    for (let k = 0; k < 12 && selfPen(fk(S, dS)).depth > 0.004; k++) {
      const Jk = fk(S, dS);
      touch(S, dS, 'R', V(...S.hR).add(V(-0.006 * dS.h, 0, 0).applyQuaternion(Jk.Qc)));
    }
    const JS = fk(S, dS);
    // 他近侧(R)手臂：绕到她身后，手落在她远侧肩上
    const behind = S.p[2] - dS.bodyD / 2 - 0.03;
    fitArm(T, dT, 'R', [0.0, -0.03, -0.06].map((dy, i) => V(JS.shR.x + 0.02 + 0.02 * i, JS.shR.y + dy, behind)), JS, [[-0.1, -0.2, -1], [-0.4, 0.3, -1]], true);
    // 她近侧左手垂在两人之间：在“正下垂/略前/略后”里挑不碰他身体、大腿和他手臂的
    {
      const JT2 = fk(T, dT), JS2 = fk(S, dS);
      const hl = V(...S.hL), fwd = V(0, 0, 1).applyQuaternion(JS2.Qc), inn = V(-1, 0, 0).applyQuaternion(JS2.Qc);
      const tg = [[0, 0], [0.035, 0], [-0.035, 0], [0.06, 0.02], [-0.06, 0.01], [0.09, 0.03], [-0.09, 0.02]]
        .map(([f, n]) => hl.clone().addScaledVector(fwd, f * dS.h).addScaledVector(inn, n * dS.h));
      const poles = [ELBOW_NAT.L, [0.4, -0.6, -1], [0.1, -0.6, -1]];
      let best = null, bs = 1e9;
      tg.forEach((t, ti) => poles.forEach((pl, pi) => {
        touch(S, dS, 'L', t); S.armPoleL = pl.slice();
        const J = fk(S, dS);
        const sc = penetration(J, JT2).depth + penetration(JT2, J).depth + selfPen(J).depth
          + Math.max(0, elbowAngle(J, 'L') - 70) * 0.002 + Math.max(0, elbowFlare(J, 'L') - 0.03) * 2 + 0.002 * ti + 0.001 * pi;
        if (sc < bs) { bs = sc; best = [S.hL.slice(), pl.slice()]; }
      }));
      S.hL = best[0]; S.armPoleL = best[1];
    }
    return { T, S, headGap: headGap() };
  };
  // 自己挑：穿模 + 自碰 + 关节方向 + 头没贴上的惩罚（pick2 不管头有没有靠上）
  setQuick(true);
  let bi = 0, bs = Infinity;
  cands.forEach((c, i) => {
    const r = build(c), JT = fk(r.T, dT), JS = fk(r.S, dS);
    const pen = Math.max(penetration(JT, JS).depth, penetration(JS, JT).depth);
    const sc = Math.max(0, pen - 0.02) * 2 + Math.max(selfPen(JT).depth, selfPen(JS).depth) * 1.5 + jointCost(JT) + jointCost(JS)
      + Math.max(0, r.headGap - 0.004) * 3 + cands[i][3] * 0.15 + 0.0004 * i;   // 前移有代价：能并肩就并肩
    if (sc < bs) { bs = sc; bi = i; }
  });
  setQuick(false);
  const r = build(cands[bi]);
  return { T: r.T, S: r.S, loose: ['hd', 'fa', 'ua', 'head', 'ear'] };
};

// 摸头杀：T 站在 S 侧后方，近侧手臂从体侧抬起，手掌覆在 S 头顶（避开兔耳），两人转头对视
export const headPat = (dT, dS) => {
  const cands = grid2([0.10, 0.14, 0.18], [0.0, 0.03, 0.06], [-0.1, 0.0, 0.12], [0.55, 0.75], [0.62, 0.45]);
  const build = ([gapK, zT, hz, hy, ry]) => {
    const sep = dT.sw + dS.sw + gapK * Math.min(dT.h, dS.h);
    const T = base(dT, sep / 2, zT * dT.h), S = base(dS, -sep / 2, 0);
    T.head = [0.28, -0.75, 0]; S.head = [-0.12 + hz, 0.75, 0];
    const JS = fk(S, dS);
    const top = JS.headC.clone().add(V(0, dS.headR * 0.97 + 0.45 * dT.handR, ry * dS.headR));
    fitArm(T, dT, 'R', [top, top.clone().add(V(0, 0.02, 0.03)), top.clone().add(V(-0.02, 0.01, -0.03))], JS, [[-0.4, -0.4, -1], [-0.2, 0.2, -1], [-0.8, -0.3, -0.6]], true);
    return { T, S };
  };
  const r = pick2(cands, build, dT, dS, { tol: 0.015 });
  return { ...r, loose: ['hd', 'fa', 'ua', 'ear', 'head'], hold: ['T.R'] };
};

// 额头相抵 / 吻额头：面对面侧视。T 前弯低头，S 抬头。
// 吻额头：T（高个）低头吻 S（矮个）额头，S 闭眼仰头。
// 肘的期望位置：肩→手连线下方（世界坐标朝下、略向外），按大臂/小臂长度反算
function elbowDown(s, d, side, hand, outK = 0.3) {
  const J = fk(s, d), sh = side === 'L' ? J.shL : J.shR;
  const ax = hand.clone().sub(sh); const L = Math.min(ax.length(), (d.upper + d.fore) * 0.97); ax.normalize();
  const a = (d.upper ** 2 - d.fore ** 2 + L * L) / (2 * L);
  const off = Math.sqrt(Math.max(d.upper ** 2 - a * a, 0));
  const n = V(0, -1, 0).addScaledVector(V(side === 'L' ? 1 : -1, 0, 0).applyQuaternion(J.Qc), outK);
  n.addScaledVector(ax, -n.dot(ax)).normalize();
  return sh.clone().addScaledVector(ax, a).addScaledVector(n, off);
}
function faceToFace(dT, dS, { dyRatio, sPitch, closeEyes, kiss, armsDown = false }) {
  const sumR = dT.headR + dS.headR;
  // 额头贴贴：第3维=他肘向外张的程度，第4维=他的手落在她肩头上方(0)还是肩头外侧(1)
  const cands = armsDown ? grid2([0.0], [0.0, 0.015, -0.01], [0.35, 0.6, 0.85], [0, 1])
    : grid2([0.0, 0.02], [0.0, 0.015, -0.01], [0.10, 0.03, 0.18], [0, 1]);
  const build = ([ov, zoff, hw, hm]) => {
    const S = base(dS, 0, 0, PI / 2);
    const JS0 = fk(S, dS);
    const D = sumR * (kiss ? 1.0 : 0.95) - ov;     // 额头贴紧：球心距略小于半径和
    const dy = Math.max(dyRatio * D, kiss ? 0.42 * D : 0);        // 吻额头：T 的头始终比 S 高出至少 0.42 倍球心距（等高时靠 T 踮脚/S 微蹲不可取，改由 T 头抬高、S 仰头）
    const T = base(dT, 1, 0, -PI / 2);
    const theta = Math.asin(dy / D);
    T.head = [theta + sPitch * 0.3, 0, 0];           // 先定头的朝向，再解躯干：转头会移动头心，必须带着它一起解
    S.head = [-(theta + sPitch), 0, 0];
    if (closeEyes) S.eyes = [0];
    const JS1 = fk(S, dS);                              // S 转头之后头心才是最终位置
    // 高个直立时头心能到的最高处；等高/接近等高时头高差只能取这么多，其余靠低头+仰头表达
    const Tup = { ...T, lean: [0, 0], p: [0, dT.leg, 0] };
    const reach = fk(Tup, dT).headC.y - JS1.headC.y;
    const dyUse = Math.max(0, Math.min(dy, reach - 0.004));
    const tx = JS1.headC.x + Math.sqrt(Math.max(D * D - dyUse * dyUse, 1e-4)), ty = JS1.headC.y + dyUse;
    // 一维求解：只解躯干前倾角 b，使头心高度 = ty；头心水平位置靠平移骨盆对齐（躯干前倾时头心向 -x 偏）
    T.p = [0, dT.leg, zoff];
    for (let k = 0; k < 4; k++) {
      T.head = [theta + sPitch * 0.3 - (T.lean[1] || 0), 0, 0];
      let lo = 0, hi = 1.45;
      for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; T.lean = [0, m]; if (fk(T, dT).headC.y > ty) lo = m; else hi = m; }
      T.lean = [0, (lo + hi) / 2];
    }
    T.head = [theta + sPitch * 0.3 - T.lean[1], 0, 0];
    T.p[0] += tx - fk(T, dT).headC.x;
    feetStand(T, dT); handsHang(T, dT, 0.03);
    // 额头贴贴：等高时两人脚尖对顶——照接吻的做法，双方脚往自己身后收一点，她再微内八
    if (armsDown) { feetStand(T, dT, 0.9, -0.035); feetStand(S, dS, 0.7, -0.045); }
    const JS = fk(S, dS), JT = fk(T, dT);
    const shTop = (J, sg, up) => (sg > 0 ? J.shL : J.shR).clone().add(V(0, up * dS.h, 0));
    if (armsDown) {
      // 额头贴贴男生胳膊拐反：他前弯身体，旧解法按躯干坐标「肘朝后」摆，世界里肘尖朝天翘到肩上方近30cm。
      // 改为按世界坐标摆：手扶她肩头（上方或外侧），肘尖朝下、略向外；他的小臂在她手臂外侧
      const outK = hw;
      const tEnds = (J, sg) => {
        const sh = sg > 0 ? J.shL : J.shR, out = V(sg > 0 ? 1 : -1, 0, 0).applyQuaternion(J.Qc);
        if (hm === 0) return [0.055, 0.075, 0.095].map((u) => sh.clone().add(V(0, u * dS.h, 0)));
        return [0.02, 0.0, -0.025].map((u) => sh.clone().addScaledVector(out, dS.armR + dT.handR * 0.9).add(V(0, u * dS.h, 0)));
      };
      const bodyOnly = (J) => ({ parts: J.parts.filter((p) => ['torso', 'head', 'ear'].includes(p.own)) });
      const placeT = (JO) => {
        for (const [sd, sg] of [['L', -1], ['R', 1]]) {
          const ends = tEnds(JS, sg);
          placeLimb(T, dT, 'arm', sd, JO, elbowDown(T, dT, sd, ends[0], outK), ends, { allow: 0.02, natFn: elbowPenaltyWorld });
        }
      };
      placeT(bodyOnly(JS));
      // 她的手：轻搭在他小臂上（自然回应），落点在小臂下侧偏内，她的小臂从他小臂下面过，不和他交叉
      const JTa = fk(T, dT);
      const onFore = (sd, t) => {
        const e = JTa['elbow' + sd], w = JTa['wrist' + sd], c = e.clone().lerp(w, t);
        const inward = JS.shC.clone().sub(c); inward.y = 0; inward.normalize();
        return c.add(V(0, -(dT.armR + dS.handR * 0.85), 0).addScaledVector(inward, 0.3 * dT.armR));
      };
      // 他的右臂在她左手侧（S.L），他的左臂在她右手侧（S.R）
      for (const [sd, his] of [['R', 'L'], ['L', 'R']]) {
        const ends = [0.45, 0.3, 0.6, 0.2].map((t) => onFore(his, t));
        placeLimb(S, dS, 'arm', sd, JTa, ends[0].clone().lerp(fk(S, dS)['sh' + sd], 0.45).add(V(0, -0.12 * dS.h, 0)), ends, { allow: 0.02, natFn: elbowPenaltyWorld });
      }
      placeT(fk(S, dS));                               // 带着她摆好的手臂再放一遍他的手
      return { T, S };
    } else {
      fitArm(T, dT, 'L', [0.055, 0.075, 0.095].map((u) => shTop(JS, -1, u)), JS, [[1, -0.2, 0.2], [0.6, 0.5, 0.3]], true);
      fitArm(T, dT, 'R', [0.055, 0.075, 0.095].map((u) => shTop(JS, 1, u)), JS, [[-1, -0.2, 0.2], [-0.6, 0.5, 0.3]], true);
    }
    const side = (sg, up) => JT.P.clone().addScaledVector(JT.upC, up * dT.torso).add(V(sg * (dT.bodyW / 2 + dS.handR * 1.0 + 0.02), 0, 0).applyQuaternion(JT.Qc));
    fitArm(S, dS, 'R', [0.30, 0.2, 0.4].map((u) => side(1, u)), JT, [[1, -0.3, 0], [0.6, 0, 0.8]], true);
    fitArm(S, dS, 'L', [0.30, 0.2, 0.4].map((u) => side(-1, u)), JT, [[-1, -0.3, 0], [-0.6, 0, 0.8]], true);
    return { T, S };
  };
  const r = pick2(cands, build, dT, dS, armsDown ? { tol: 0.02, jointT: jointCostWorldArms } : { tol: 0.02 });
  const out = { ...r, loose: ['hd', 'fa', 'ua', 'head', 'ear'], headTouch: true };
  if (armsDown) Object.assign(out, { skipAuto: ['T', 'S'], elbowWorld: ['T', 'S'], hold: ['T.L', 'T.R', 'S.L', 'S.R'] });   // 自动选肘按躯干坐标判断，会把肘翻回朝天
  return out;
}
export const foreheadTouch = (dT, dS) => faceToFace(dT, dS, { dyRatio: 0.20, sPitch: 0.0, closeEyes: false, kiss: false, armsDown: true });
export const foreheadKiss = (dT, dS) => faceToFace(dT, dS, { dyRatio: 0.55, sPitch: 0.22, closeEyes: true, kiss: true });
// 接吻：面对面，T 低头、S 仰头，两人都闭眼，头微微错开（避免鼻子相撞）
// 胳膊肘：环腰不环肩（肘还是外翻——环肩时肘被迫翻到背后高处，改用手扶腰侧、肘贴身垂落）
// 照 qwertyaz111 kiss-simulator 的解法重写（旧版保留为 kissOld 备查）：
// ① 高个从腰整体前倾，角度 = asin(身高差 / (高个身高×0.5))，上限 1.2rad；
// ② 两颗头刚好相切（球心距 ≈ 两头半径和），按头高差反算水平距离；
// ③ 两人各自转头，视线沿两头心连线对上（高个的转角要扣掉弯腰角）。
// 手臂不摆造型、自然下垂——参考就是这样，肘不会折出怪角度。
export const kiss = (dT, dS) => {
  const S = base(dS, 0, 0, PI / 2), T = base(dT, 1, 0, -PI / 2);
  const D = (dT.headR + dS.headR) * 0.97;                       // 球心距略小于半径和：嘴贴上
  let b = Math.min(Math.asin(Math.min((dT.h - dS.h) / (dT.h * 0.5), 0.95)), 1.2);
  const headDy = () => fk(T, dT).headC.y - fk(S, dS).headC.y;
  const aim = () => {                                            // 转头会移动头心，迭代几轮收敛
    for (let k = 0; k < 4; k++) {
      T.lean = [0, b];
      const dy = headDy();
      const th = Math.atan2(dy, Math.sqrt(Math.max(D * D - dy * dy, 1e-4)));
      T.head = [th - b, 0, 0]; S.head = [-th, 0, 0];
    }
  };
  aim();
  // 身高差很大时只按公式弯腰头还高出一截（够不着嘴）：继续弯到头高差 ≤ 0.7D，仍不超过 1.2rad
  if (headDy() > 0.7 * D) {
    let lo = b, hi = 1.2;
    for (let i = 0; i < 30; i++) { b = (lo + hi) / 2; aim(); if (headDy() > 0.7 * D) lo = b; else hi = b; }
    b = hi; aim();
  }
  // 水平距离：两头心连线长 = D
  const dy = Math.min(headDy(), 0.95 * D);
  const hx = Math.sqrt(Math.max(D * D - dy * dy, 1e-4));
  T.p[0] += fk(S, dS).headC.x + hx - fk(T, dT).headC.x;
  // 脚：两人脚尖相对会顶在一起（等高时最严重）——双方脚都往自己身后收一点，S 再微微内八并拢
  feetStand(T, dT, 0.9, -0.035); feetStand(S, dS, 0.7, -0.045);
  handsHang(T, dT, 0.03); handsHang(S, dS);
  T.eyes = [0]; S.eyes = [0];
  return { T, S, loose: ['hd', 'fa', 'ua', 'head', 'ear'], headTouch: true, skipAuto: ['T', 'S'] };
};
export const kissOld = (dT, dS) => {
  const r = faceToFace(dT, dS, { dyRatio: 0.08, sPitch: 0.12, closeEyes: true, kiss: false });
  r.T.eyes = [0]; r.S.eyes = [0];
  r.T.head = [r.T.head[0], r.T.head[1], 0.28]; r.S.head = [r.S.head[0], r.S.head[1], 0.2];
  // 等高组合两人脚尖相对打架：把 S 的双脚横错半步（左脚向 +z、右脚向 -z 收），不再前伸对顶
  feetStand(r.S, dS, 0.6, -0.06);
  feetStand(r.T, dT, 0.85, -0.04);
  // 重摆两人的手：按「世界侧」配对（+z 的手摸对方 +z 侧的腰），不会交叉横穿；肘贴身下落
  const T = r.T, S = r.S;
  const JT = fk(T, dT), JS = fk(S, dS);
  const equalH = dT.h - dS.h < 0.15;                          // 等高组合：环腰的手臂会互撞，她改为双手扶他胸口
  for (const [s, d, J, O, side] of [[T, dT, JT, JS, 'L'], [T, dT, JT, JS, 'R'], [S, dS, JS, JT, 'L'], [S, dS, JS, JT, 'R']]) {
    const sh = side === 'L' ? J.shL : J.shR;
    const wz = side === 'L' ? 1 : -1;                        // 该手在世界 +z / -z 侧（两人面朝 ±x，左手都在 +z）
    const dO = O.d;
    let side2;
    if (s === S) {
      // 她的手臂短、他又前倾，够不到他腰侧（会被夹进他躯干）：改为扶他胸前。
      // 胸前法线 = 躯干上轴 upC 在 xy 平面内转 90°，朝向她（-x 一侧）
      const nrm = V(-O.upC.y, O.upC.x, 0).normalize();
      if (nrm.x > 0) nrm.negate();
      side2 = O.P.clone().addScaledVector(O.upC, 0.62 * dO.torso)
        .addScaledVector(nrm, dO.bodyD / 2 + d.handR * 0.85).add(V(0, 0, wz * dO.bodyW * 0.24));
    } else {
      side2 = O.P.clone().addScaledVector(O.upC, 0.42 * dO.torso).add(V(0, 0, wz * (dO.bodyW / 2 + d.handR * 0.9)));
    }
    const wantEl = sh.clone().add(V(0, -d.upper * 0.9, wz * 0.012 * d.h));
    placeLimb(s, d, 'arm', side, O, wantEl, [side2, side2.clone().add(V(0, 0.05 * dO.h, 0)), side2.clone().add(V(0, -0.04 * dO.h, 0))], { allow: 0.02, natural: false });
  }
  return { ...r, loose: ['hd', 'fa', 'ua', 'head', 'ear'], headTouch: true, skipAuto: ['T', 'S'], hold: ['T.L', 'T.R', 'S.L', 'S.R'] };
};
