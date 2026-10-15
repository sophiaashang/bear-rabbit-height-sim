// 穿他的衬衫（彼シャツ風）：S 面朝镜头直立，双臂从肩对称外展 ~0.4rad、微前，肘腕伸直；
// T 站她左后偏侧，右手从上方落到她头顶，左手自然垂。两人都不摆手部细节。
// 袖子/下摆网格由渲染层按 outfit:{S:'shirt'} 每帧生成——本文件只管骨架姿势。
// 摸头硬约束（基线 headPat 版 faR~head 穿 2.7~4.2cm，本版修掉）：
//   ① T 前臂/腕所有采样球心到 S 头颅球表面距离 ≥0，前臂表面穿深 ≤0.018（check 容差-2mm）；
//   ② 前臂/手不许插进她的兔耳（耳在头顶两侧向后掠、比头球高，正上/正后落手必扫耳）；
//   ③ 手球贴住头顶（贴合 6~18mm，hd~head ≤0.033 且 hold 不悬空），腕压在头顶点 5cm 内。
// 几何事实（已验证）：等高（T 肩 ≈ 她头顶）时「腕贴头顶点」+「前臂不碰头球」不可兼得——
// 腕贴头顶需要肘在 1.98m 高的径向 47cm 处，超过他肩+上臂上限（肘最高 ~肩+0.93*upper）。
// 因此分两档：ΔH≥0.1 走「后上方压头顶」（前臂走高处，不掠头）；ΔH<0.1 走「侧前方落头顶侧沿」
// （站位外移，前臂从她耳前窄缝下来，不碰头球，腕贴头顶侧沿）。
import { V, fk, penetration, selfPen, sdf } from './model.js';
import { base, set, poleThrough, elbowFlare, elbowAngle } from './poseutil.js';

const LOOSE = ['hd', 'fa', 'ua', 'head', 'ear'];
// 照他的代码（shared-shirt-simulator）：armAngle=0.4 是「水平线以下 0.4rad」，即双臂几乎平伸、略下垂 → 与竖直向下的夹角 = π/2-0.4
const ABD = Math.PI / 2 - 0.40;   // S 双臂外展角（rad，自竖直向下起算）
// 等高档（身高差<0.1m）退回旧版臂形（外展 0.40、前倾 0.12）：他贴在她身侧，近水平的臂会压进他躯干（实测 5.8cm），旧形只剩 ~2cm 残余
const ABD_EQ = 0.40;
const FWD_EQ = 0.12;
const FWD = 0.05;   // S 双臂微前倾（rad）
// 均匀球面方向（poseutil._dirs 的同款分布，自备一份）
const _dirs = (() => {
  const out = [], n = 56;
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - y * y), a = i * 2.399963;
    out.push([r * Math.cos(a), y, r * Math.sin(a)]);
  }
  return out;
})();

// S 双臂：从肩对称外展、伸直。手距肩 = 0.965*arm（fk 里臂 IK 的 slack）：刚好满伸展 => 肘腕在一条线上
function armsAbducted(S, dS, abd, fwd) {
  const J = fk(S, dS);
  const L = 0.965 * dS.arm;
  for (const [side, sg] of [['L', 1], ['R', -1]]) {
    const sh = side === 'L' ? J.shL : J.shR;
    const dir = V(sg * Math.sin(abd), -Math.cos(abd) * Math.cos(fwd), Math.cos(abd) * Math.sin(fwd)).normalize();
    set(S, 'h' + side, sh.clone().addScaledVector(dir, L));
  }
}

export const shirt = (dT, dS) => {
  const S = base(dS, 0, 0, 0);
  const tall = dT.h - dS.h >= 0.1;
  armsAbducted(S, dS, tall ? ABD : ABD_EQ, tall ? FWD : FWD_EQ);
  const JS = fk(S, dS);
  const spS = selfPen(JS).depth;
  const headC = JS.headC, headR = dS.headR;
  const topPt = headC.clone().add(V(0, headR, 0).applyQuaternion(JS.Qh));   // 她头顶点
  const ears = JS.parts.filter((q) => q.own === 'ear');

  // 手落点族：手心 = 她头心 + dir × (headR + 手半径 - sink)。
  // 高差大：头顶偏前缘（dz 0.15~0.45）；等高：头顶侧沿（dx 0.5~0.8，他那一侧），前臂走耳前窄缝。
  // sink 上限受限：腕球=手球心，腕处前臂重叠 = sink-(handR-armR)，大了 check 的 fa~head(容差2cm) 必挂
  const handCands = [];
  for (const [dx, dz] of [[0, 0.15], [0, 0.28], [0, 0.45], [0.15, 0.25], [-0.12, 0.3], [0.3, 0.2], [0.55, 0.1], [0.8, 0.05]]) {
    for (const sink of [0.006, 0.012, 0.018]) handCands.push({ dir: V(dx, 1, dz).normalize(), sink });
  }

  // 候选：他站方位（她的左后：x 0.18~0.68、z -0.10~-0.22、yaw 略转）× 他的低头角
  // （0.60/0.68 外移档：等高组前臂要从她耳前过，站太近必擦头 2cm）
  const posC = [];
  for (const ax of [0.18, 0.24, 0.30, 0.36, 0.44, 0.52, 0.60, 0.68]) for (const az of [0.10, 0.16, 0.22]) for (const yw of [0, -0.4, 0.3]) posC.push([ax * dS.h, -az * dS.h, yw]);
  const headPT = [0.14, 0.3, 0.46, 0.62];
  // 肘相对「肩->手」连线的垂直方向：优先从她耳前上空、他一侧绕下来
  const elDirs = [[0, 1, 0.5], [0.2, 1, 0.55], [0.45, 0.9, 0.35], [0.7, 0.8, 0.2], [0.12, 1, 0.35], [-0.12, 1, 0.45], [0.35, 1, -0.1], [0.6, 0.9, -0.25], [0, 1, 0.15], [-0.3, 1, 0.1]];

  // 穿模口径与检测脚本一致、各收 2mm 余量：hd~head 0.033、碰耳 0.010、hd~hd 0.058、hd~其它 0.033、其余 0.018
  const ownOf = (J, n) => J.parts.find((q) => q.n === n)?.own;
  const tolOf = (oa, ob) => ((oa === 'hd' && ob === 'head') || (oa === 'head' && ob === 'hd')) ? 0.033
    : (oa === 'ear' || ob === 'ear') ? 0.010
    : (oa === 'hd' && ob === 'hd') ? 0.058
    : (oa === 'hd' || ob === 'hd') ? 0.033 : 0.018;
  const penScore = (pp, A, B) => pp.depth <= 0 ? 0 : Math.max(0, pp.depth - tolOf(ownOf(A, pp.a), ownOf(B, pp.b))) * 4;

  // T 右臂各球段（前臂 5 采样 + 腕点 + 手球心）到 S 头颅球表面（球心距-头半径）与双耳表面的间隙。
  // faSurf = 头面深度+前臂半径（穿模口径）；headAx = 采样点球心到头球面（子代理验收口径）。
  const armClearance = (JT) => {
    const ua = JT.parts.find((q) => q.n === 'uaR'), fa = JT.parts.find((q) => q.n === 'faR'), hd = JT.parts.find((q) => q.n === 'hdR');
    const pts = [0, 0.25, 0.5, 0.75, 1].map((t) => fa.a.clone().lerp(fa.b, t));
    let headAx = 1e9, faSurf = -1e9, earSurf = 1e9;
    for (const [pt, r] of [...pts.map((p) => [p, dT.armR]), [hd.c, dT.handR]]) {
      headAx = Math.min(headAx, pt.distanceTo(headC) - headR);
      faSurf = Math.max(faSurf, dT.armR - (pt.distanceTo(headC) - headR));
      for (const e of ears) earSurf = Math.min(earSurf, sdf(e, pt) - r);
    }
    return { headAx, faSurf, earSurf, shTop: ua.a.y - headC.y };
  };
  // 他的肘别怼到自己头上（低头时他的头在前上方，软罚把肘挤开一点）
  const selfHeadPen = (T0, JT) => Math.max(0, dT.headR + 0.05 - JT.elbowR.distanceTo(JT.headC)) * 6;

  // 候选评分（穿模口径同 check.mjs-2mm；前臂表面穿深/插耳/腕偏头顶为硬罚）
  const scoreArm = (T0, JT) => {
    const { headAx, faSurf, earSurf, shTop } = armClearance(JT);
    return penScore(penetration(JT, JS), JT, JS) + penScore(penetration(JS, JT), JS, JT)
      + Math.max(0, selfPen(JT).depth - 0.018) * 4 + Math.max(0, spS - 0.018) * 4
      + Math.max(0, faSurf - 0.018) * 30                            // 前臂表面压进她头 = 硬罚（含 bulge/腕搭接）
      + Math.max(0, -headAx) * 20                                   // 前臂/腕球心压进头球 = 次级罚
      + Math.max(0, 0.010 - earSurf) * 8                            // 插进兔耳 = 硬罚
      + Math.max(0, JT.wristR.distanceTo(topPt) - 0.048) * 20       // 腕要压在头顶附近（她头顶点）
      + Math.max(0, elbowFlare(JT, 'R') - 0.03) * 6 + Math.max(0, elbowAngle(JT, 'R') - 100) * 0.003
      + (shTop > 0 ? shTop * 2.0 : 0)                               // 肩比她头心高：前臂横在头顶正上方，压向低位优先
      + selfHeadPen(T0, JT)
      + Math.max(0, JT.miss.hR - 0.004) * 10;
  };

  // 落点/站位/低头角给定时的一轮臂形
  const armAt = (T0, sh, target, elDir, k = 1.0) => {
    const u = target.clone().sub(sh).normalize();
    const a = target.distanceTo(sh) / 2, offE = Math.sqrt(Math.max(dT.upper ** 2 - a * a, 0));   // l1=l2：肘在垂直平分面上
    set(T0, 'hR', target);                                        // 手先落到目标，再只动肘向
    const p = V(...elDir); p.addScaledVector(u, -p.dot(u));
    if (p.lengthSq() < 1e-6) return null;
    p.normalize().multiplyScalar(offE * k);
    if (p.lengthSq() < 1e-8) return null;
    const el = sh.clone().addScaledVector(u, a).add(p);
    poleThrough(T0, dT, 'armPoleR', sh, el, target);
    return fk(T0, dT);
  };
  // 全球肘向细化（含下垂系数 k：肘贴臂线 → 前臂从低位斜插她耳前窄缝）
  const refineElbow = (T0, sh, target, base) => {
    let r = base;
    for (const g of _dirs) for (const k of [1.0, 0.65, 0.3]) {
      const JT = armAt(T0, sh, target, g, k);
      if (!JT) continue;
      const sc = scoreArm(T0, JT);
      if (sc < r.sc) { r = { sc, pole: T0.armPoleR.slice() }; }
    }
    return r;
  };

  // ---- 两段搜索：粗搜 (站位 × 落点 × 低头角 × 肘向先验) → 最优处 56 向肘向细化 ----
  let bs = Infinity, bArg = null;
  for (const [tx, tz, yw] of posC) {
    for (const hc of handCands) {
      for (const hp of headPT) {
        const T0 = base(dT, tx, tz, yw);
        T0.head = [hp, 0, 0];
        const JT0 = fk(T0, dT);
        const sh = JT0.shR;
        let target = headC.clone().addScaledVector(hc.dir, headR + dT.handR - hc.sink);
        const dd0 = target.distanceTo(sh), mx = 0.955 * dT.arm;
        if (dd0 > mx) target = sh.clone().addScaledVector(target.clone().sub(sh).normalize(), mx);   // 够不到就夹到最长
        let bLoc = Infinity, pLoc = null;
        for (const ed of elDirs) {
          const JT = armAt(T0, sh, target, ed);
          if (!JT) continue;
          const sc = scoreArm(T0, JT);
          if (sc < bLoc) { bLoc = sc; pLoc = T0.armPoleR.slice(); }
        }
        if (bLoc < bs) { bs = bLoc; bArg = [tx, tz, yw, hc, hp, pLoc]; }
        if (bs < 0.002) break;
      }
      if (bs < 0.002) break;
    }
    if (bs < 0.002) break;
  }
  // 细化：固定最优 (站位, 落点, 低头角)，肘向 56 向 × 3 个下垂系数
  {
    const [tx, tz, yw, hc, hp, pole0] = bArg;
    const T0 = base(dT, tx, tz, yw);
    T0.head = [hp, 0, 0];
    const JT0 = fk(T0, dT);
    const sh = JT0.shR;
    let target = headC.clone().addScaledVector(hc.dir, headR + dT.handR - hc.sink);
    const dd0 = target.distanceTo(sh), mx = 0.955 * dT.arm;
    if (dd0 > mx) target = sh.clone().addScaledVector(target.clone().sub(sh).normalize(), mx);
    const ref = refineElbow(T0, sh, target, { sc: bs, pole: pole0 });
    bArg = [tx, tz, yw, hc, hp, ref.pole];
  }

  // 用最优参数重建（循环里 T0 是复用改写的，避免别名）
  const [tx, tz, yw, hc, hp, pole] = bArg;
  const T = base(dT, tx, tz, yw);
  T.head = [hp, 0, 0];
  T.armPoleR = pole.slice();
  const JT0 = fk(T, dT);
  const sh = JT0.shR;
  const target = headC.clone().addScaledVector(hc.dir, headR + dT.handR - hc.sink);
  const dd0 = target.distanceTo(sh), mx = 0.955 * dT.arm;
  if (dd0 > mx) set(T, 'hR', sh.clone().addScaledVector(target.clone().sub(sh).normalize(), mx));
  else set(T, 'hR', target);
  return { T, S, loose: LOOSE, noNat: true, skipAuto: ['T', 'S'], hold: ['T.R'], outfit: { S: 'shirt' } };
};
