// 阅尽晨昏（角色卡构图）：按手工摆好的参数固化。
//   T（熊）面朝 -x，左手高举；S（兔）站在他身后(+x 侧)，头靠他的背、双臂从两侧环过去，右手朝他右手伸。
//   参考身高 T=1.86 / S=1.63（页面默认）时就是参考姿势的样子，不改站位、不改朝向、不修穿模。
//   场景：只加一个书架，立在两人身后（书脊朝镜头）。
//   熊高举的左手里拿着一本书：立着、封面朝镜头、手握在书的右下角，像刚从书架上抽出来；书的位置由手心算出，所以换身高也在手里。
//   换身高时：T 以脚下为锚等比缩放；S 站位随 T 走（按两人缩放均值），S 双手仍落在 T 身体上（相对 T 盆骨按 T 的比例），
//   够不到时收到臂长 96% 处。
// 与原始参数相比，唯一改动是画面上完全等价的一处：4 个脚目标原本比腿够得着的位置远 1.4~2.3cm，换成实际到达点。
import { fk } from './model.js';

const REF = { T: 1.86, S: 1.63 };
const POSE = {
  T: {
    p: [-0.7389, 0.819, 0.679], yaw: [-1.207], pitch: [0], roll: [0], twist: [0], lean: [0.1406, 0.0291], head: [-0.0932, 0.4436, 0],
    hL: [-1.0964, 1.601, 0.9458], hR: [-0.8176, 0.8899, 0.3525], fL: [-0.7058, 0.067, 0.8068], fR: [-0.7283, 0.0674, 0.583],
    armPoleL: [0.3506, -0.8533, 0.3858], armPoleR: [-0.3179, -0.4126, -0.8537], kneePoleL: [0.4977, 0.1387, 0.8562], kneePoleR: [-0.2566, 0.0325, 0.966], eyes: [1],
  },
  S: {
    p: [-0.3716, 0.7164, 0.6639], yaw: [-1.075], pitch: [0], roll: [0], twist: [0], lean: [0.0333, 0.0817], head: [0.11, 1.2, 0.6388],
    hL: [-0.7631, 0.9789, 0.9875], hR: [-0.8975, 1.0499, 0.5009], fL: [-0.4249, 0.0491, 0.7622], fR: [-0.5088, 0.05, 0.5381],
    armPoleL: [0.2713, -0.9304, -0.2464], armPoleR: [-0.8141, -0.2487, -0.5247], kneePoleL: [0.1868, 0.3527, 0.9169], kneePoleR: [0.2291, 0.2483, 0.9412], eyes: [1],
  },
};
// 书架：立在两人身后（相机在 +z，书脊朝 +z）。参数照其他场景的书架：宽 1.6 高 2.0 深 0.32。
// 中心 x = 两人所在位置；前沿离两人最靠后的点（T/S 的右肘 z≈0.38）约 40cm。
const SHELF = { kind: 'bookshelf', args: [1.6, 2.0, 0.32, 7], at: [-0.7, 0, -0.2], ry: 0 };
const LOOSE = ['hd', 'fa', 'ua', 'head', 'ear', 'torso', 'th', 'sh'];
const BOOK_OFF = [-0.055, 0.09, -0.005];   // 书的中心相对熊左手心：手在书右边缘内 3cm、底边上 3cm，书厚方向让手球盖住
const r4 = (v) => Math.round(v * 10000) / 10000;

const fresh = (o) => { const s = {}; for (const k of Object.keys(o)) s[k] = o[k].slice(); return s; };
const PLACE = ['p', 'hL', 'hR', 'fL', 'fR'];
// 以 (ax, 0, az) 为锚，水平方向按 kx、竖直方向按 ky 缩放，再把锚平移到 (bx, bz)
const remap = (s, ax, az, bx, bz, kh, kv) => {
  for (const key of PLACE) s[key] = [bx + kh * (s[key][0] - ax), kv * s[key][1], bz + kh * (s[key][2] - az)];
};

export const chenhun = (dT, dS) => {
  const T = fresh(POSE.T), S = fresh(POSE.S);
  const kT = dT.h / REF.T, kS = dS.h / REF.S;
  if (Math.abs(kT - 1) > 1e-6 || Math.abs(kS - 1) > 1e-6) {
    const aT = [POSE.T.p[0], POSE.T.p[2]], aS = [POSE.S.p[0], POSE.S.p[2]], kM = (kT + kS) / 2;
    // T：以脚下为锚等比缩放
    remap(T, aT[0], aT[1], aT[0], aT[1], kT, kT);
    // S：站位跟着 T 走（相对 T 的水平偏移按两人缩放均值），自身按 kS 缩放
    const bx = aT[0] + kM * (aS[0] - aT[0]), bz = aT[1] + kM * (aS[1] - aT[1]);
    remap(S, aS[0], aS[1], bx, bz, kS, kS);
    // S 双手：仍落在 T 身体上（相对 T 盆骨，按 T 的比例），再按臂长收一下
    const pT = POSE.T.p;
    for (const key of ['hL', 'hR']) {
      const h = POSE.S[key];
      S[key] = [T.p[0] + kT * (h[0] - pT[0]), T.p[1] + kT * (h[1] - pT[1]), T.p[2] + kT * (h[2] - pT[2])];
    }
    const J = fk(S, dS), reach = (dS.upper + dS.fore) * 0.96;
    for (const [key, sh] of [['hL', J.shL], ['hR', J.shR]]) {
      const t = S[key], dx = t[0] - sh.x, dy = t[1] - sh.y, dz = t[2] - sh.z, L = Math.hypot(dx, dy, dz);
      if (L > reach) S[key] = [sh.x + (dx * reach) / L, sh.y + (dy * reach) / L, sh.z + (dz * reach) / L];
    }
  }
  const w = fk(T, dT).wristL;   // 熊高举的左手心
  return {
    T, S,
    props: [
      { ...SHELF, args: SHELF.args.slice(), at: SHELF.at.slice() },
      { type: 'book', upright: true, at: [r4(w.x + BOOK_OFF[0]), r4(w.y + BOOK_OFF[1]), r4(w.z + BOOK_OFF[2])], ry: 0 },
    ],
    loose: LOOSE, skipAuto: ['T', 'S'], noAuto: true, elbowWorld: ['T', 'S'],
  };
};
