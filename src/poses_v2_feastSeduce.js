// 宴色诱惑（角色卡构图）：按手工摆好的参数固化。
//   参考身高 T=1.86 / S=1.63（页面默认）时就是参考姿势的样子，不改站位、不改朝向、不修穿模（可能有些穿模）。
//   换身高时：T 以脚下为锚、S 以坐在桌沿的那一点为锚等比缩放；S 左手跟着 T 肩心走、T 右手跟着 S 的脸走、S 右手落回桌面。
//   参考姿势里的桌子和大提琴（含位置/朝向）一并带上。
// 与原始参数相比，唯一改动是画面上完全等价的一处：T 左手目标原本比手臂够得着的位置远 9.4cm，换成实际到达点。
import { fk, groundMin } from './model.js';

const REF = { T: 1.86, S: 1.63 };
const POSE = {
  T: {
    p: [0.0815, 0.8354, 0.7766], yaw: [-1.207], pitch: [0], roll: [0], twist: [0], lean: [-0.051, 0.7028], head: [0.0104, -0.1382, 0],
    hL: [-0.6014, 0.8455, 1.1093], hR: [-0.7231, 1.1203, 0.7974], fL: [0.128, 0.0847, 0.8713], fR: [-0.0538, 0.0974, 0.6542],
    armPoleL: [0.3506, -0.8533, 0.3858], armPoleR: [-0.3506, -0.8533, 0.3858], kneePoleL: [0.3617, -0.0081, 0.9323], kneePoleR: [-0.5827, -0.6592, 0.4754], eyes: [1],
  },
  S: {
    p: [-0.187, 0.8163, 0.7596], yaw: [-0.3112], pitch: [0], roll: [0], twist: [0], lean: [-0.6231, 0.5246], head: [-0.229, 1.0246, 0.6388],
    hL: [-0.2742, 1.2657, 0.9887], hR: [-0.8299, 0.813, 0.7461], fL: [0.1148, 0.5907, 0.9214], fR: [0.1194, 0.6233, 0.9678],
    armPoleL: [-0.4378, -0.5165, 0.7359], armPoleR: [0.6388, -0.7044, 0.3094], kneePoleL: [0.1868, 0.3527, 0.9169], kneePoleR: [0.2291, 0.2483, 0.9412], eyes: [1],
  },
};
// 参考姿势里的桌（世界坐标中心）与大提琴（at 即世界位置）
const TABLE = { c: [-0.5363, 0.375, 0.2227], s: [0.4, 0.375, 0.75] };
const TOP = TABLE.c[1] + TABLE.s[1];
const CELLO = { type: 'cello', at: [1.5466, 0, -0.5667], ry: -0.1936 };
const HAND_DIR = [0.0188, -0.5482, -0.8362];      // T 右手相对 S 头心的方向（单位向量）
const HAND_GAP = 0.0127;                          // 手球与头球表面的间隙
const S_HL_OFF = [0.0251, -0.0373, 0.0979];       // S 左手相对 T 肩心的偏移（按 T 身高比缩放）
const S_HR_LIFT = 0.019;                          // S 右手离桌面的间隙
const LOOSE = ['hd', 'fa', 'ua', 'head', 'ear', 'torso', 'th', 'sh'];

const fresh = (o) => { const s = {}; for (const k of Object.keys(o)) s[k] = o[k].slice(); return s; };
const PLACE = ['p', 'hL', 'hR', 'fL', 'fR'];
function scaleAbout(s, k, ax, ay, az) {
  for (const key of PLACE) s[key] = [ax + k * (s[key][0] - ax), ay + k * (s[key][1] - ay), az + k * (s[key][2] - az)];
}

export const feastSeduce = (dT, dS) => {
  const T = fresh(POSE.T), S = fresh(POSE.S);
  const kT = dT.h / REF.T, kS = dS.h / REF.S;
  const scaled = Math.abs(kT - 1) > 1e-6 || Math.abs(kS - 1) > 1e-6;
  if (Math.abs(kT - 1) > 1e-6) scaleAbout(T, kT, T.p[0], 0, T.p[2]);        // T：以脚下为锚
  if (Math.abs(kS - 1) > 1e-6) scaleAbout(S, kS, S.p[0], TOP, S.p[2]);      // S：以坐在桌沿的那一点为锚
  if (scaled) {
    // T 刚性平移贴地（参考身高下误差 <1mm，不动）
    const lift = -groundMin(fk(T, dT)) + 0.001;
    for (const key of PLACE) T[key][1] += lift;
    // S 左手跟 T 肩心，T 右手跟 S 的脸，S 右手落回桌面
    const sh = fk(T, dT).shC;
    S.hL = [sh.x + S_HL_OFF[0] * kT, sh.y + S_HL_OFF[1] * kT, sh.z + S_HL_OFF[2] * kT];
    S.hR[1] = TOP + dS.handR + S_HR_LIFT;
    const c = fk(S, dS).headC, D = dS.headR + dT.handR + HAND_GAP;
    T.hR = [c.x + HAND_DIR[0] * D, c.y + HAND_DIR[1] * D, c.z + HAND_DIR[2] * D];
  }
  return {
    T, S,
    props: [{ type: 'box', c: TABLE.c.slice(), s: TABLE.s.slice() }, { ...CELLO, at: CELLO.at.slice() }],
    loose: LOOSE, skipAuto: ['T', 'S'], noAuto: true, elbowWorld: ['T', 'S'],
    cam: { el: 0.20, az: -0.5 },
  };
};
