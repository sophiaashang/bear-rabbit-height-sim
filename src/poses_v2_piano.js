// 弹钢琴（四手联弹）：两人并排坐在同一条长琴凳上，都面朝钢琴，各弹自己身前的键。
// 参数照 sitting-simulator 的「ピアノ連弾」：凳面高 0.42、凳宽 1.2；肩高 = 凳高 + 躯干高 - 躯干宽*0.15；
// 上臂下摆角 = -acos(clamp((肩高-键高)/臂长))，算不出（NaN）时兜底 -60°；头 rotation.x ≈ 0.35 低头看键；
// 两人间距 = max(两人体宽和, 0.35)，体宽和过大时钳制到坐得进 1.2m 的凳。
// 坐标：键面朝 +x（箱体中心 at=[keyX-0.30,0,z]）；两人坐在 x>keyX 一侧、面朝 -x（yaw=-π/2）；
// 面朝 -x 时左手在世界 +z。矮个 S 坐 +z（近镜头），高个 T 坐 -z，镜头看到两人侧面和手。
import { V, fk, selfPen } from './model.js';
import { PI, base, placeLimb, legTo, setQuick, elbowPenalty } from './poseutil.js';
import { boxProp, sitDown } from './poses_c.js';

const LOOSE = ['hd', 'fa', 'ua', 'head', 'ear', 'torso', 'th', 'sh'];
const KEY_X = -0.20, KEY_Y = 0.75;            // 键面 x；键高（旧代码 0.75，参考值 0.73-0.75）
const SEAT = 0.42, BENCH_W = 1.2, BENCH_D = 0.36;   // 凳面高 / 凳长(沿 z) / 凳深(沿 x)
const KEY_TOP = KEY_Y + 0.024;                // 白键条上表面
const FRONT = 0.02;                           // 凳前沿在髋前方多远（小个子大腿斜着下压，凳沿必须收近）
const KEY_BACK = KEY_X + 0.076;                // 键条靠人一侧的边缘(再收 1.2cm 余量)：手腕越过它就是悬空
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// 参考公式：直臂够到键所需的水平距离（身高不同 -> 手落键的位置不同）
export function reachDx(d) {
  const shY = SEAT + d.torso - d.bodyW * 0.15;
  let ang = -Math.acos(clamp((shY - KEY_Y) / d.arm, -1, 1));
  if (Number.isNaN(ang)) ang = -PI / 3;
  return d.arm * Math.sin(-ang);
}

// 大腿斜度：髋到膝盖下压到小腿垂直、脚刚好踩地
function thighSlope(d, hipY) {
  const drop = hipY - (d.footR + 0.002) - 0.995 * d.shin;
  const sinA = clamp(drop / (0.995 * d.thigh), 0, 0.9);
  return { sinA, cosA: Math.sqrt(1 - sinA * sinA) };
}

// 一个人坐好
function seatOne(d, hipX, z, lean, hsK = 0.55) {
  const s = base(d, hipX, z, -PI / 2);
  sitDown(s, d, hipX, z, -PI / 2, SEAT, 1.2);
  s.lean = [0, lean];
  s.head = [0.35, 0, 0];                                  // 低头看键
  const J0 = fk(s, d);
  const { sinA, cosA } = thighSlope(d, J0.P.y);
  for (const [side, hip, sg] of [['L', J0.hipL, 1], ['R', J0.hipR, -1]]) {
    const kn = hip.clone().add(V(-cosA * d.thigh, -sinA * d.thigh, sg * 0.05 * d.thigh));
    legTo(s, d, side, kn, kn.clone().add(V(0, -d.shin, 0)));
  }
  const J = fk(s, d);
  const hs = d.sw * hsK;
  for (const [side, sg, sh] of [['L', 1, J.shL], ['R', -1, J.shR]]) {
    const key = V(KEY_X + d.handR + 0.005, KEY_TOP + d.handR * 0.8, z + sg * hs);
    const mid = sh.clone().add(V(-0.3, -0.9, 0).normalize().multiplyScalar(d.upper));
    placeLimb(s, d, 'arm', side, null, mid, [key, key.clone().add(V(0.02, 0, 0)), key.clone().add(V(0.04, 0.01, 0))], { allow: 0.02 });
  }
  const F = fk(s, d);
  let gap = 0;
  for (const [k, w] of [['hL', F.wristL], ['hR', F.wristR]]) gap += V(...s[k]).distanceTo(w);
  const dxWant = 0.88 * reachDx(d);
  const dxNow = ((F.shL.x + F.shR.x) / 2) - ((F.wristL.x + F.wristR.x) / 2);
  const score = 3 * Math.max(0, F.miss.hL, F.miss.hR) + elbowPenalty(F, 'L') + elbowPenalty(F, 'R')
    + selfPen(F).depth * 12 + Math.abs(dxNow - dxWant) + lean * 0.05
    + 10 * (Math.max(0, F.wristL.x - KEY_BACK) + Math.max(0, F.wristR.x - KEY_BACK));
  return { s, score, gap };
}

export const piano = (dT, dS) => {
  const wMax = Math.max(dT.bodyW, dS.bodyW);
  const c = Math.min(Math.max(dT.bodyW + dS.bodyW, 0.35), BENCH_W - 0.04 - wMax);
  const zS = c / 2, zT = -c / 2;                           // S 在 +z（近镜头），T 在 -z
  const hmin = (d) => KEY_X + thighSlope(d, SEAT + d.legR).cosA * d.thigh + d.legR + 0.03;
  const hipBase = Math.max(hmin(dT), hmin(dS));            // 同坐一条凳：髋位共用，膝盖不顶钢琴；矮个靠前倾够键
  const leans = [0.04, 0.10, 0.16, 0.22, 0.28, 0.34, 0.40, 0.46, 0.52];
  setQuick(true);
  let best = null;
  for (const ext of [0, 0.03, 0.06, 0.10]) {
    const hipX = hipBase + ext;
    let tot = ext * 0.3; const pick = [];
    for (const [d, z] of [[dT, zT], [dS, zS]]) {
      let b = null;
      for (const l of leans) for (const k of [0.55, 0.75, 0.35]) { const r = seatOne(d, hipX, z, l, k); const sc = r.score + 2 * r.gap; if (!b || sc < b.sc) b = { ...r, sc }; }
      tot += b.sc; pick.push(b);
    }
    if (!best || tot < best.tot) best = { tot, hipX, pick };
  }
  setQuick(false);
  const [pT, pS] = best.pick;
  const hipX = best.hipX;
  const props = [
    // 一架宽键盘（1.3m，无缝），两人各占一段
    { type: 'piano', args: [1.3], at: [KEY_X - 0.30, 0, 0] },
    // 长琴凳：实心矮凳，凳面 0.42、长 1.2、深 0.36
    boxProp(hipX - FRONT + BENCH_D / 2, SEAT / 2, 0, BENCH_D / 2, SEAT / 2, BENCH_W / 2, 0xd9b98c),
  ];
  return { T: pT.s, S: pS.s, props, loose: LOOSE, skipAuto: ['T', 'S'], cam: { el: 0.22 } };
};
