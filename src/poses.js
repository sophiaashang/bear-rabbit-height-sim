// 姿势注册表：把 poses_a/poses_b 的构造函数包上「自动选肘/膝朝向」
import * as A from './poses_a.js';
import * as B from './poses_b.js';
import * as C from './poses_c.js';
import * as D from './poses_compare.js';
import * as E from './poses_d.js';
import * as V2a from './poses_v2_bedPin.js';
import * as V2b from './poses_v2_selfie.js';
import * as V2c from './poses_v2_piano.js';
import * as V2d from './poses_v2_kneeLift.js';
import * as V2e from './poses_v2_lapPillow.js';
import * as V2f from './poses_v2_shirt.js';
import * as V2g from './poses_v2_propose.js';
import * as V2h from './poses_v2_box.js';
import * as V2i from './poses_v2_feastSeduce.js';
import * as V2j from './poses_v2_chenhun.js';
import * as V2k from './poses_v2_twilight.js';
import * as V2l from './poses_v2_princess.js';
import { autoPoles } from './poseutil.js';

// cradleCarry=旧版托膝抱（改名「兜腿抱」保留）；V2* 覆盖同名旧姿势
const raw = { ...A, ...B, ...C, ...D, ...E, cradleCarry: C.kneeLift, ...V2a, ...V2b, ...V2c, ...V2d, ...V2e, ...V2f, ...V2g, box: V2h.box, feastSeduce: V2i.feastSeduce, chenhun: V2j.chenhun, twilight: V2k.twilight, princess: V2l.princess };
const NO_AUTO = { princess: 1, koala: 1, lapSit: 1, lapHug: 1, straddle: 1, bedPin: 1, selfie: 1, umbrella: 1, piano: 1, benchSit: 1, kneeLift: 1, lapPillow: 1, cradleCarry: 1, propose: 1, box: 1, feastSeduce: 1, chenhun: 1, twilight: 1 };   // 新姿势已整肢放置   // 个别姿势要跳过自动朝向时在这里登记
export const builders = {};
for (const [k, f] of Object.entries(raw)) {
  if (typeof f !== 'function' || !/^[a-z]/.test(k) || k === 'orientBody') continue;
  builders[k] = (dT, dS) => {
    const r = f(dT, dS);
    if (!NO_AUTO[k]) autoPoles(r, dT, dS, { skip: r.noAuto ? ['T', 'S'] : r.skipAuto, ground: !!(r.floorLevel || r.groundPoles), noNat: !!r.noNat });
    return dressScene(k, r, dT);
  };
}
export const ORDER = ['stand', 'holdHands', 'shoulderLean', 'headPat', 'foreheadTouch', 'foreheadKiss', 'kiss', 'kneelEye', 'hug', 'backHug', 'wallPin', 'piggyback', 'lift', 'lying', 'scarf', 'princess', 'koala', 'lapSit', 'lapHug', 'straddle', 'bedPin', 'shirt', 'compareHand', 'compareFoot', 'comparePawF', 'comparePawH', 'selfie', 'umbrella', 'piano', 'benchSit', 'kneeLift', 'lapPillow', 'cradleCarry', 'propose', 'box', 'twilight'];

// ---------- 场景家具（照参考 qwertyaz111 系列：书架、桌椅、沙发、床）----------
// 只放在两人身后/身下，不参与姿势求解；坐姿里的「长凳」碰撞盒保留给检测脚本，但画面上换成沙发/椅子。
const BACK_Z = -1.05;                                   // 背景家具贴在两人身后（镜头在 +z）
const livingRoom = (x = 0) => [
  { kind: 'rug', args: [2.6, 1.6], at: [x, 0, 0] },
  { kind: 'bookshelf', args: [1.6, 2.0, 0.32, 7], at: [x - 0.2, 0, BACK_Z] },
  { kind: 'plant', at: [x - 1.35, 0, BACK_Z + 0.1] },
  { kind: 'lamp', at: [x + 1.15, 0, BACK_Z + 0.12] },
];
const study = (x = 0) => [
  { kind: 'bookshelf', args: [1.4, 2.0, 0.32, 3], at: [x - 0.85, 0, BACK_Z] },
  { kind: 'bookshelf', args: [1.4, 2.0, 0.32, 11], at: [x + 0.6, 0, BACK_Z] },
  { kind: 'plant', at: [x + 1.6, 0, BACK_Z + 0.1] },
];
// 求婚：花园场景——两侧多株绿植+暖灯，不摆书架家具
const garden = (x = 0) => [
  { kind: 'rug', args: [2.4, 1.8], at: [x, 0, 0] },
  { kind: 'plant', at: [x - 1.5, 0, BACK_Z + 0.15] },
  { kind: 'plant', at: [x + 1.5, 0, BACK_Z + 0.15] },
  { kind: 'plant', at: [x - 0.9, 0, BACK_Z - 0.1] },
  { kind: 'plant', at: [x + 0.9, 0, BACK_Z - 0.1] },
  { kind: 'lamp', at: [x + 1.9, 0, BACK_Z + 0.3] },
  { kind: 'lamp', at: [x - 1.9, 0, BACK_Z + 0.3] },
];
// 打伞：户外街景——人行道砖 + 路沿石 + 行道树 + 长椅 + 路灯 + 消防栓，两人站在砖面上
const street = (x = 0) => [
  { kind: 'sidewalk', args: [], at: [x, 0, 0] },
  { kind: 'sidewalk', args: [], at: [x - 0.62, 0, 0] }, { kind: 'sidewalk', args: [], at: [x + 0.62, 0, 0] },
  { kind: 'sidewalk', args: [], at: [x - 1.24, 0, 0] }, { kind: 'sidewalk', args: [], at: [x + 1.24, 0, 0] },
  { kind: 'sidewalk', args: [], at: [x - 1.24, 0, -0.62] }, { kind: 'sidewalk', args: [], at: [x - 0.62, 0, -0.62] },
  { kind: 'sidewalk', args: [], at: [x, 0, -0.62] }, { kind: 'sidewalk', args: [], at: [x + 0.62, 0, -0.62] },
  { kind: 'sidewalk', args: [], at: [x + 1.24, 0, -0.62] }, { kind: 'sidewalk', args: [], at: [x + 1.86, 0, -0.62] },
  { kind: 'sidewalk', args: [], at: [x - 1.24, 0, 0.62] }, { kind: 'sidewalk', args: [], at: [x - 0.62, 0, 0.62] },
  { kind: 'sidewalk', args: [], at: [x, 0, 0.62] }, { kind: 'sidewalk', args: [], at: [x + 0.62, 0, 0.62] },
  { kind: 'sidewalk', args: [], at: [x + 1.24, 0, 0.62] },
  { kind: 'curbstone', args: [4.6], at: [x, 0, -1.35] },
  { kind: 'tree', args: [3], at: [x - 1.5, 0, -1.95] }, { kind: 'tree', args: [11], at: [x + 1.3, 0, -2.0] },
  { kind: 'parkBench', args: [], at: [x + 2.05, 0, -1.15] },
  { kind: 'streetLamp', args: [], at: [x - 2.1, 0, -1.1] },
  { kind: 'hydrant', args: [], at: [x + 0.85, 0, -1.15] },
];
// 宴色诱惑：夜色办公室——落地窗幕墙在背后，桌上的酒杯/文件由场景层补
const officeNight = (x = 0) => [
  { kind: 'windowWall', args: [4.2, 2.6], at: [x + 0.6, 0, BACK_Z - 0.35] },
  { kind: 'rug', args: [2.6, 1.8], at: [x - 0.2, 0, 0.2] },
  { kind: 'plant', at: [x - 1.7, 0, BACK_Z + 0.2] },
  { kind: 'lamp', at: [x - 1.4, 0, BACK_Z + 0.35] },
];
const SCENE = {
  stand: livingRoom, holdHands: livingRoom, shoulderLean: livingRoom, headPat: study, scarf: livingRoom, shirt: livingRoom,
  foreheadTouch: study, foreheadKiss: study, kiss: study, kneelEye: livingRoom, hug: livingRoom, backHug: study,
  lift: livingRoom, princess: livingRoom, koala: study, piggyback: livingRoom,
  selfie: livingRoom, kneeLift: livingRoom, cradleCarry: livingRoom, lapPillow: study,
  propose: garden, feastSeduce: officeNight, umbrella: street,
};
function dressScene(k, r, dT) {
  const items = [];
  const boxes = (r.props || []).filter((p) => p.type === 'box');
  if (SCENE[k]) items.push(...SCENE[k](0));
  if (k === 'lying' && boxes[0]) {                      // 卧室：床 + 枕头 + 床头柜 + 窗 + 衣柜
    const b = boxes[0], top = b.c[1] + b.s[1], len = b.s[0] * 2, wid = b.s[2] * 2, cx = b.c[0], xl = cx - b.s[0], xr = cx + b.s[0], wz = -(wid / 2 + 0.9);
    items.push({ kind: 'windowWall', args: [Math.max(4.6, len + 1.6), 2.6], at: [cx, 0, wz] },
      { kind: 'rug', args: [len + 1.2, wid + 1.1], at: [cx + 0.1, 0, 0] },
      { kind: 'bed', args: [len, wid, top, false], at: [cx, 0, 0] },
      ...(r.pillows || []).map((p) => ({ kind: 'pillow', args: [p.w, p.d, p.h], at: [p.at[0], top, p.at[2]] })),
      { kind: 'nightstand', args: [true], at: [xl + 0.22, 0, -(wid / 2 + 0.25)], ry: Math.PI / 2 },
      { kind: 'wardrobe', args: [1.1, 2.0, 0.55], at: [xr - 0.1, 0, wz + 0.33] },
      { kind: 'plant', at: [xl - 0.45, 0, wz + 0.4] });
    b.hidden = true;
  }
  if (k === 'wallPin') items.push({ kind: 'plant', at: [0.25, 0, -0.75] }, { kind: 'lamp', at: [1.5, 0, -0.7] });
  if ((k === 'lapSit' || k === 'lapHug' || k === 'twilight') && boxes[0]) {
    const b = boxes[0], top = b.c[1] + b.s[1], d = 0.66;
    const zc = b.c[2] + b.s[2] - d / 2;                              // 坐垫前沿 = 原长凳前沿（膝窝后）
    const x0 = k === 'twilight' ? b.c[0] : 0.1;                      // 暮光之境：沙发跟着姿势自带的座位盒走
    items.push({ kind: 'sofa', args: [2.0, top, d], at: [x0, 0, zc] }, { kind: 'rug', args: [2.4, 1.4], at: [x0, 0, 0.75] },
      { kind: 'table', args: [1.0, 0.5, 0.42], at: [x0, 0, 1.15] }, { kind: 'bookshelf', args: [1.4, 2.0, 0.32, 9], at: [x0 - 1.85, 0, zc - 0.1], ry: 0 }, { kind: 'lamp', at: [x0 + 1.35, 0, zc - 0.05] });
    b.hidden = true;
  }
  if (k === 'straddle' && boxes[0]) {
    const b = boxes[0], top = b.c[1] + b.s[1];
    items.push({ kind: 'chair', args: [top - 0.015, true], at: [b.c[0], 0, 0], ry: -Math.PI / 2 }, { kind: 'table', args: [1.2, 0.65, 0.72], at: [b.c[0] + 0.75, 0, 0], ry: Math.PI / 2 },
      { kind: 'bookshelf', args: [1.6, 2.0, 0.32, 13], at: [0.1, 0, BACK_Z] }, { kind: 'plant', at: [-1.1, 0, BACK_Z + 0.1] });
    b.hidden = true;
  }
  if (k === 'bedPin' && boxes.length) {
    const b = boxes[0], top = b.c[1] + b.s[1];
    items.push({ kind: 'bed', args: [b.s[0] * 2, b.s[2] * 2, top, false], at: [b.c[0], 0, b.c[2]] },
      ...(r.pillows || []).map((q) => ({ kind: 'pillow', args: [q.w, q.d, q.h], at: [q.at[0], top, q.at[2]] })), { kind: 'lamp', at: [b.c[0] - b.s[0] - 0.05, 0, -b.s[2] - 0.35] },
      { kind: 'plant', at: [b.c[0] + b.s[0] + 0.3, 0, -b.s[2] - 0.1] }, { kind: 'rug', args: [1.0, 2.2], at: [b.c[0] + b.s[0] + 0.55, 0, 0] });
    boxes.forEach((q) => { q.hidden = true; });
  }
  if (items.length) r.props = [...(r.props || []), { type: 'furniture', items }];
  return r;
}
