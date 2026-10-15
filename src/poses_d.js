// 姿势 25-30：自拍 / 打伞 / 弹钢琴 / 并排坐 / 托膝抱 / 枕大腿。
// 约定同 poses_a/b/c：矮个 S、高个 T。朝向口诀：yaw=π/2 面朝 +x、yaw=-π/2 面朝 -x、yaw=0 面朝镜头(+z)。
// 面朝 ±x 的两人：左手都在世界 +z、右手都在 -z。身体宽 bodyW 沿各自局部 x（面朝+x者=世界-z，面朝-x者=世界+z），厚 bodyD 沿局部 z=朝向轴。
import { V, fk, penetration, selfPen } from './model.js';
import { PI, base, feetStand, handsHang, pick2, grid2, legTo, placeLimb, set, poleThrough } from './poseutil.js';
import { boxProp, orientBody, seatTopOf, sitDown } from './poses_c.js';

const LOOSE = ['hd', 'fa', 'ua', 'head', 'ear', 'torso', 'th', 'sh'];
// 站/坐者身体表面点：k=沿躯干比例(0髋-1肩)，side=局部x偏移，fwd=局部z偏移(正面+)
const surf = (J, d, k, side, fwd) => J.P.clone().addScaledVector(J.upC, k * d.torso)
  .add(V(side * d.bodyW, 0, fwd * d.bodyD).applyQuaternion(J.Qc));

// ---------- 25 自拍：T 从侧面搂住 S，一手横在两人胸前拿手机，头靠过来；S 微靠、一手回搂 ----------
// 参考图（高个 188 / 矮个 163）：高个身体向矮个倾 20-30°、低头靠头，手臂横过胸前单手横握手机；矮个直立微倾、一手回搂腰后。
export const selfie = (dT, dS) => {
  // 身高差大才前倾靠头（倾角要小：前倾 torso*θ 会让头心大幅前移）；等高时直立即可
  const leans = dT.h - dS.h > 0.18 ? [0.10, 0.16, 0.06] : [0.04, 0.0];
  const cands = grid2(leans, [0.10, 0.14, 0.06], [0.03, 0.0]);
  const build = ([lb, gap, zb]) => {
    const S = base(dS, 0, 0.13 + zb, PI / 2);              // S 面朝 +x，偏 +z（两人脚完全错开，靠头由前倾完成）
    S.head = [0.02, 0.25, -0.06];                           // 微抬头靠向他、脸留一点给镜头
    const JS0 = fk(S, dS);
    const T = base(dT, JS0.P.x + dS.bodyD / 2 + dT.bodyD / 2 + gap + (dT.h - dS.h > 0.18 ? 0.05 : 0.02), -0.13 + zb, -PI / 2);  // T 面朝 -x，偏 -z；多留一点给前倾的头
    T.lean = [0, lb];                                       // 向她倾
    T.head = [lb * 0.9 + 0.1, 0, 0.10];                    // 头低下来、微向她歪（两人 z 错开，靠而不叠）
    feetStand(T, dT, 0.78); handsHang(T, dT, 0.03);
    feetStand(S, dS, 0.78); handsHang(S, dS, 0.03);
    const JS = fk(S, dS), JT = fk(T, dT);
    // 手机：两人之间、她胸前、偏镜头侧（+z）——横在他身前但不贴他身体
    // 自拍：手机举到两人脸前（头高之间、靠镜头一侧 +z），屏幕朝向两人
    const phone = V((JS.headC.x + JT.headC.x) / 2, (JS.headC.y + JT.headC.y) / 2 - 0.02, Math.max(JS.headC.z + dS.headR, JT.headC.z + dT.headR) + 0.20);
    // T 的左手（世界 +z，镜头侧）横过来握手机；肘放低、贴着自己身前
    placeLimb(T, dT, 'arm', 'L', JS, JT.shL.clone().add(V(0, -0.13 * dT.h, 0.05 * dT.h)), [phone, phone.clone().add(V(0.02, 0.02, 0))], { allow: 0.022, natural: false });
    // T 的右手（-z 远侧）自然垂下（参考图里高个的另一只手就是垂着的，横穿她身体必穿模）
    const JT2 = fk(T, dT);
    const drT = V(0, -1, 0).multiplyScalar(0.7).add(V(0, -1, 0).applyQuaternion(JT2.Qc).multiplyScalar(0.3)).normalize();
    set(T, 'hR', JT2.shR.clone().addScaledVector(drT, 0.95 * dT.arm));
    // S 的左手（+z 镜头侧）搭在他握手机的前臂上（靠他肘一侧，远离她自己的脸）；够不到就垂下
    const JT3 = fk(T, dT);
    const onArm = JT3.wristL.clone().lerp(JT3.elbowL, 0.62).add(V(0, dT.armR + dS.handR * 0.85, 0.004));
    const okL = placeLimb(S, dS, 'arm', 'L', JT3, JS.shL.clone().add(V(0, -0.09 * dS.h, 0.04 * dS.h)), [onArm, onArm.clone().add(V(0.02, 0.02, 0)), onArm.clone().add(V(0.04, 0, 0))], { allow: 0.025, natural: false });
    if (okL > 0.02) {   // 手够不到前臂就改成扶他的腰侧
      const JT4 = fk(T, dT);
      placeLimb(S, dS, 'arm', 'L', JT4, JS.shL.clone().add(V(0, -0.10 * dS.h, 0.02 * dS.h)), [surf(JT4, dT, 0.38, 0, 0.5), surf(JT4, dT, 0.30, 0, 0.5)], { allow: 0.025, natural: false });
    }
    return { T, S, props: [{ type: 'phone', at: [phone.x, phone.y, phone.z], ry: PI }], hold: ['T.R', 'S.R'] };
  };
  const r = pick2(cands, build, dT, dS, { tol: 0.02, noNat: true });
  return { ...r, loose: LOOSE, skipAuto: ['T', 'S'] };
};

// ---------- 26 打伞（照参考图重做，旧版握点悬空、伞被裁）----------
// 参考：高个拿伞，用靠她那只手；大臂基本下垂略前、肘约 90°、小臂朝她伸，手在他胸口偏下；
// 伞杆竖直、落在她脸正前方；伞沿几乎贴他头顶，伞面罩住两人（他外侧肩刚到伞沿）；
// 两人其余的手自然下垂；两人紧挨并排，他略靠前。
export const umbrella = (dT, dS) => {
  // 候选 = 站距 × 他前后 × 握点前探 × 肘外张：肘张太少小臂擦自己胸口、张太多大臂撞她胳膊，交给 pick2 按穿模挑
  const cands = [];
  for (const hx of [1.0, 0.8, 0.6, 0.45]) for (const sp of [0.0, 0.15, 0.3]) for (const gap of [0.14, 0.10, 0.18, 0.22])
    for (const zT of [0.05, 0.0, 0.10]) for (const zf of [0.05, 0.08, 0.03]) cands.push([gap, zT, zf, sp, hx]);
  const build = ([gap, zT, zf, sp, hx]) => {
    const sep = dT.bodyW / 2 + dS.bodyW / 2 + gap;
    const T = base(dT, sep / 2, zT), S = base(dS, -sep / 2, 0);
    handsHang(S, dS, 0.035);
    const JT = fk(T, dT), JS = fk(S, dS);
    const side = JT.shL.x < JT.shR.x ? 'L' : 'R';                     // 靠她一侧的手（世界 x 更小）
    const sh = side === 'L' ? JT.shL : JT.shR;
    // 手：她脸正前方的竖线上，高度=他肘下垂 0.9 大臂再略抬（胸口偏下）
    const hand = V(sh.x + hx * (JS.headC.x + 0.02 * dS.h - sh.x), sh.y - 0.9 * dT.upper + 0.02 * dT.h, JS.headC.z + dS.headR + zf);
    // 小臂横向朝她伸时要走在他胸前，不能穿进自己躯干：握点 z 至少在他胸口前沿 + 胳膊粗 + 1.5cm
    hand.z = Math.max(hand.z, JT.P.z + dT.bodyD / 2 + dT.armR + dT.handR * 0.5 + 0.015);
    set(T, 'h' + side, hand);
    // 肘：在肩正下方略靠前（大臂下垂略前倾），IK 只取这个方向
    // 肘：肩下方略靠前，朝她那侧外张 sp（候选挑）；不往前探，前探太多会把肘顶成反关节（实测 99°）
    const toHer = Math.sign(JS.headC.x - sh.x) || -1;
    poleThrough(T, dT, 'armPole' + side, sh, sh.clone().add(V(toHer * sp * dT.upper, -0.9 * dT.upper, 0.3 * dT.upper)), hand);
    // 伞：杆过手心竖直向上；半径够到他外侧肩；伞沿高度保证罩住两人的头和耳朵
    const J = fk(T, dT), JS2 = fk(S, dS);
    const g = J.parts.find((q) => q.n === 'hd' + side).c;
    const outer = side === 'L' ? J.shR : J.shL;
    const r = Math.max(0.5, Math.hypot(outer.x - g.x, outer.z - g.z) + dT.armR);
    let bottom = 0;
    for (const P of [J, JS2]) for (const q of P.parts) {
      if (q.own !== 'head' && q.own !== 'ear') continue;
      const c = q.t === 'cap' ? (q.a.y > q.b.y ? q.a : q.b) : q.c;
      const rho = Math.hypot(c.x - g.x, c.z - g.z) + q.r;
      bottom = Math.max(bottom, c.y + q.r + 0.02 - 0.4 * Math.max(0, r - rho));   // 伞面锥高 0.4r：越靠杆越高
    }
    const props = [{ type: 'umbrella', at: [g.x, g.y, g.z], r, len: bottom - g.y }];
    return { T, S, props };
  };
  // 自己挑候选：pick2 跳过 loose 部件（ua/fa/hd），恰好漏掉"胳膊撞胳膊/小臂擦胸口"——这里两种都算。
  // 分数 = 两人互穿深度 + 双方自碰深度；同分取靠前的（候选顺序 = 越像参考越靠前）
  let r = null, bs = Infinity;
  for (const c of cands) {
    const x = build(c), JT = fk(x.T, dT), JS = fk(x.S, dS);
    const pen = penetration(JT, JS), a = selfPen(JT), b2 = selfPen(JS);
    const sc = Math.max(0, pen.depth) + Math.max(0, a.depth || 0) + Math.max(0, b2.depth || 0);
    if (sc < bs - 0.002) { bs = sc; r = x; }
    if (bs <= 0.004) break;
  }
  return { ...r, loose: ['hd', 'fa', 'ua', 'head', 'ear'], skipAuto: ['T'] };
};

// ---------- 27 弹钢琴：四手联弹（侧视）。S 坐琴凳弹近处，T 站她身后俯身、双手越过她头顶够琴键 ----------
// 参考图（高个 188 / 矮个 163）：一人坐姿双臂前伸触键、一人站姿俯身在其身后够键，旁边音符 ♪。
export const piano = (dT, dS) => {
  const keyX = -0.55, keyY = 0.75;                            // 键面：x=-0.55、高 0.75，两人都面朝 -x
  const cands = grid2([0.85, 0.95, 1.05], [0.16, 0.24, 0.10], [0.0, -0.04]);
  const build = ([lb, xT, zb]) => {
    // S 坐琴凳面朝 -x（琴键在 -x），坐姿偏 +z（近镜头），她的键区偏 +z
    const S = base(dS, -0.28, 0.30 + zb, -PI / 2);
    sitDown(S, dS, -0.28, 0.30 + zb, -PI / 2, seatTopOf(dS), 0.62);
    S.head = [-0.18, 0.35, 0];                                // 低头看键、脸留给镜头一点
    const JS = fk(S, dS);
    for (const [side, dz] of [['L', 0.30], ['R', 0.12]]) {    // 她的键：她身前偏 +z
      const key = V(keyX, keyY + dS.handR * 0.8, S.p[2] + dz - 0.10);
      const sh = side === 'L' ? JS.shL : JS.shR;
      placeLimb(S, dS, 'arm', side, null, sh.clone().add(V(-0.02, -0.06 * dS.h, 0.02 * dS.h)), [key, key.clone().add(V(0.02, 0, 0.02))], { allow: 0.02, natural: false });
    }
    // T 站她身后（z 错开偏 -z），俯身、双手越过她头顶够键
    const T = base(dT, xT, -0.12 + zb, -PI / 2);
    T.lean = [0, lb];
    T.head = [-0.15, 0.3, 0];                                 // 低头看键
    feetStand(T, dT, 1.3);
    const JT = fk(T, dT);
    for (const [side, dz] of [['L', -0.02], ['R', -0.22]]) {  // 他的键：中间与偏 -z
      const key = V(keyX, keyY + dT.handR * 0.8, T.p[2] + dz);
      const sh = side === 'L' ? JT.shL : JT.shR;
      placeLimb(T, dT, 'arm', side, fk(S, dS), sh.clone().add(V(-0.03, -0.05 * dT.h, 0.02 * dT.h)), [key, key.clone().add(V(0.02, 0, 0.03))], { allow: 0.02, natural: false });
    }
    const props = [
      { type: 'piano', at: [keyX - 0.30, 0, zb] },
      { kind: 'chair', args: [seatTopOf(dS), true], at: [-0.28, 0, 0.30 + zb], ry: -PI / 2 },
    ];
    return { T, S, props, hold: [] };
  };
  const r = pick2(cands, build, dT, dS, { tol: 0.02, noNat: true });
  return { ...r, loose: LOOSE, skipAuto: ['T', 'S'], cam: { el: 0.22 } };
};

// ---------- 28 并排坐凳：两把椅子并排，两人端坐面向镜头（坐姿身高差），面前一张桌子 ----------
// 参考图（高个 188 / 矮个 163）：浅木色长桌+两把凳，两人并排面向镜头坐姿端正，桌面挡在大腿前。
export const benchSit = (dT, dS) => {
  const seatY = Math.min(seatTopOf(dT), seatTopOf(dS));
  const cands = grid2([0.36, 0.44], [0.0, 0.03]);
  const build = ([gap, zb]) => {
    const x = dT.bodyW / 2 + dS.bodyW / 2 + gap;
    const T = base(dT, x / 2, zb); const S = base(dS, -x / 2, zb);
    sitDown(T, dT, x / 2, zb, 0, seatY, 1.05);
    sitDown(S, dS, -x / 2, zb, 0, seatY, 1.05);
    T.head = [0.0, 0.22, 0]; S.head = [0.0, -0.22, 0];        // 头微微偏向对方
    const props = [
      { kind: 'chair', args: [seatY, true], at: [x / 2, 0, zb], ry: 0 },
      { kind: 'chair', args: [seatY, true], at: [-x / 2, 0, zb], ry: 0 },
      { kind: 'table', args: [1.6, 0.66, 0.72], at: [0, 0, zb + 0.58], ry: 0 },
    ];
    return { T, S, props };
  };
  const r = pick2(cands, build, dT, dS, { tol: 0.02 });
  return { ...r, loose: LOOSE, air: ['T', 'S'] };
};

// ---------- 30 枕大腿：T 坐椅上面朝 -x，S 头枕在他大腿上平躺（脸朝上、微朝镜头），身体向 -x 延伸；T 低头看她、双手抚她的发 ----------
export const lapPillow = (dT, dS) => {
  const seatY = seatTopOf(dT);
  const cands = grid2([0.0, 0.04], [0.10, 0.15, 0.06]);
  const build = ([zb, tilt]) => {
    // T 坐着面朝 -x（她的身体往 -x 延伸），微微俯身低头
    const T = base(dT, 0, zb, -PI / 2);
    sitDown(T, dT, 0, zb, -PI / 2, seatY, 0.72);
    T.lean = [0, 0.28];
    T.head = [0.42, 0.15, 0];                                 // 低头看她
    const JT0 = fk(T, dT);
    // S 平躺：头枕在他膝盖上（膝正上方），身体向 -x 延伸、脚那头略低；脸朝上、微朝镜头
    const lapTop = JT0.hipL.y + dT.legR + 0.002;
    const up = V(Math.cos(tilt), Math.sin(tilt), 0);          // 骨盆->头 方向
    const front = V(-Math.sin(tilt), Math.cos(tilt), 0);      // 脸朝上
    const S = base(dS, 0, 0, 0);
    orientBody(S, up, front);
    const kneeMid = JT0.kneeL.clone().lerp(JT0.kneeR, 0.5);   // 他双膝中点
    const headP = V(kneeMid.x - 0.045, lapTop + dS.headR * 0.92 + 0.004, zb);
    const pelvis = headP.clone().addScaledVector(up, -(dS.torso + dS.neck + dS.headR + 0.02));
    S.p = [pelvis.x, pelvis.y, pelvis.z];                     // 状态里 p 必须是数组（cloneState 会 slice）
    S.head = [0.55, -0.55, -1.8];                            // 侧枕：脸微朝镜头、耳朵垂向镜头侧（避开他的身体），闭眼
    S.eyes = [0];
    const JS0 = fk(S, dS);
    // S 双腿：膝微弯、脚落在地上
    for (const [side, sg] of [['L', 1], ['R', -1]]) {
      const hip = side === 'L' ? JS0.hipL : JS0.hipR;
      const kn = hip.clone().addScaledVector(up, -dS.thigh * 0.96).add(V(0, -0.02, sg * 0.06 * dS.h));
      legTo(S, dS, side, kn, kn.clone().add(V(-dS.shin * 0.72, -dS.shin * 0.6, sg * 0.02 * dS.h)), dS.footR + 0.002);
    }
    // S 双手交叠放在自己小腹上（front 反方向 = 身前）
    const JS = fk(S, dS);
    const belly = JS.P.clone().addScaledVector(JS.upC, 0.30 * dS.torso).addScaledVector(front.clone().negate(), dS.bodyD / 2 + dS.handR * 0.8);
    placeLimb(S, dS, 'arm', 'L', null, JS.shL.clone().addScaledVector(up, -0.04), [belly, belly.clone().add(V(0.02, 0, 0.02))], { allow: 0.03, natural: false });
    placeLimb(S, dS, 'arm', 'R', null, JS.shR.clone().addScaledVector(up, -0.04), [belly.clone().add(V(-0.015, 0.01, -0.02)), belly.clone().add(V(0.015, 0.01, -0.035))], { allow: 0.03, natural: false });
    // T 双手——一手轻抚她脸颊侧（避开垂下的耳朵），一手扶自己的膝盖
    const JT = fk(T, dT);
    const cheek = JS.headC.clone().add(V(dS.headR * 0.92, -dS.headR * 0.28, -dS.headR * 0.30).normalize().multiplyScalar(dS.headR + dT.handR * 0.82));
    const kneeT = JT.kneeL.clone().add(V(0.02, dT.legR + dT.handR * 0.45, 0.03));
    placeLimb(T, dT, 'arm', 'L', JS, JT.shL.clone().add(V(0, -0.10 * dT.h, 0.04 * dT.h)), [cheek, cheek.clone().add(V(0.02, 0.01, -0.02))], { allow: 0.02, natural: false });
    placeLimb(T, dT, 'arm', 'R', JS, JT.shR.clone().add(V(0, -0.11 * dT.h, 0.03 * dT.h)), [kneeT, kneeT.clone().add(V(0.02, 0, 0.02))], { allow: 0.025, natural: false });
    // 她躺的平台（沙发扶手/长榻）：顶面贴着她的背，否则整个人悬在半空
    const JSb = fk(S, dS);
    const deckTop = JSb.P.y - dS.bodyD / 2 - 0.005;
    const dx0 = JSb.P.x - 0.40, dx1 = kneeMid.x - 0.18;      // 从她盆骨后面到他膝盖前面
    const props = [
      { kind: 'chair', args: [seatY, true], at: [T.p[0], 0, zb], ry: -PI / 2 },
      boxProp((dx0 + dx1) / 2, deckTop / 2, zb, (dx1 - dx0) / 2, deckTop / 2, 0.36, 0xe6dccb),
    ];
    return { T, S, props, hold: ['T.L', 'T.R'] };
  };
  const r = pick2(cands, build, dT, dS, { tol: 0.022, noNat: true });
  return { ...r, loose: LOOSE, air: ['S'], skipAuto: ['T', 'S'], noNat: true, cam: { el: 0.3 } };
};
