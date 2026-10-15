// 把 fk 结果画成半透明低模小人。每个 rig 的 mesh 与 J.parts 一一对应，每帧只更新位姿。
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { blank, fk, V } from './model.js';

const UP = new THREE.Vector3(0, 1, 0);
const sphereGeo = new THREE.SphereGeometry(1, 16, 12);
const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 14, 1, false);
const boxGeo = new RoundedBoxGeometry(1, 1, 1, 3, 0.16);
const eyeGeo = new THREE.SphereGeometry(1, 10, 8);

export function makeRig(d, color) {
  const group = new THREE.Group();
  const mat = new THREE.MeshPhongMaterial({ color, transparent: true, opacity: 0.86, shininess: 28, specular: 0x222222 });
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
  const J0 = fk(blank(), d);
  const items = J0.parts.map((p) => {
    const it = { own: p.own, t: p.t, meshes: [] };
    const add = (geo, m = mat) => { const me = new THREE.Mesh(geo, m); me.castShadow = true; me.userData.own = p.own; group.add(me); it.meshes.push(me); return me; };
    if (p.t === 'sph') add(sphereGeo);
    else if (p.t === 'cap') { add(cylGeo); add(sphereGeo); add(sphereGeo); }
    else add(boxGeo);
    return it;
  });
  const neck = new THREE.Mesh(cylGeo, mat); neck.userData.own = 'neck'; neck.castShadow = true; group.add(neck);
  // 脚（脚跟球在脚踝处；脚掌沿自身前方伸出）与手（手套状）各自独立
  const limbTip = (own) => {
    const cap = new THREE.Mesh(cylGeo, mat); cap.userData.own = own; cap.castShadow = true; group.add(cap);
    const tip = new THREE.Mesh(sphereGeo, mat); tip.userData.own = own; tip.castShadow = true; group.add(tip);
    return { cap, tip };
  };
  const feet = d.noFeet ? [] : [0, 1].map(() => limbTip('ft'));
  const hands = [0, 1].map(() => limbTip('hd'));
  const eyes = [0, 1].map(() => { const e = new THREE.Mesh(eyeGeo, eyeMat); e.userData.own = 'eye'; group.add(e); return e; });
  return { group, mat, eyeMat, items, neck, eyes, feet, hands, d };
}

export function setRigColor(rig, color) { rig.mat.color.set(color); }

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Vector3();
function orient(mesh, a, b, r) {
  _m.copy(b).sub(a);
  const len = _m.length();
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  if (len > 1e-6) mesh.quaternion.setFromUnitVectors(UP, _m.divideScalar(len));
  mesh.scale.set(r, Math.max(len, 1e-4), r);
}

export function updateRig(rig, J, eyesOpen = 1) {
  const dHand = J.d;
  J.parts.forEach((p, i) => {
    const it = rig.items[i], m = it.meshes;
    if (p.t === 'sph') { m[0].position.copy(p.c); m[0].scale.setScalar(p.r); }
    else if (p.t === 'cap') {
      orient(m[0], p.a, p.b, p.r);
      m[1].position.copy(p.a); m[1].scale.setScalar(p.r);
      m[2].position.copy(p.b); m[2].scale.setScalar(p.r);
    } else {
      m[0].position.copy(p.c); m[0].quaternion.copy(p.q); m[0].scale.set(p.hx * 2, p.hy * 2, p.hz * 2);
    }
  });
  const d = J.d;
  // 脚：从脚踝沿躯干前方伸出（脚尖翘一点）；脚尖球夹扁成脚掌
  if (!d.noFeet) [['ftL', 'toeL', 0], ['ftR', 'toeR', 1]].forEach(([fn, tn, i]) => {
    const pA = J.parts.find((q) => q.n === fn), pT = J.parts.find((q) => q.n === tn);
    const f = rig.feet[i];
    orient(f.cap, pA.c, pT.c, pA.r * 0.82);
    f.tip.position.copy(pT.c);
    f.tip.quaternion.copy(J.Qp);   // 与 model.js 脚尖方向一致：跟骨盆
    f.tip.scale.set(pT.r * 0.94, pT.r * 0.7, pT.r * 1.25);
  });
  orient(rig.neck, J.shC, J.neckTop.clone().addScaledVector(J.upC, 0.01), d.neckR);
  const hr = J.d.headR;
  // 手：手跟球 + 指尖胶囊（沿小臂延长），像小手套
  [['wristL', 'hdL', 0], ['wristR', 'hdR', 1]].forEach(([wn, hn, i]) => {
    const w = J[wn], h = J.parts.find((q) => q.n === hn);
    const f = rig.hands[i];
    const dir = h.c.clone().sub(w).normalize();
    const tip = h.c.clone().addScaledVector(dir, h.r * 0.55);
    orient(f.cap, h.c, tip, h.r * 0.66);
    f.tip.userData.own = 'hd';
    f.tip.position.copy(tip);
    f.tip.quaternion.setFromUnitVectors(UP, dir);
    f.tip.scale.set(h.r * 0.72, h.r * 1.05, h.r * 0.5);
  });
  rig.eyes.forEach((e, k) => {
    const sx = k ? -1 : 1;
    _a.set(sx * 0.40 * hr, 0.08 * hr, 0.93 * hr).applyQuaternion(J.Qh).add(J.headC);
    e.position.copy(_a);
    e.quaternion.copy(J.Qh);
    const r = 0.13 * hr;
    if (eyesOpen > 0.5) e.scale.set(r, r, r * 0.5);
    else e.scale.set(r * 1.5, r * 0.28, r * 0.4);
  });
}

export function setRigFirstPerson(rig, hidden) {
  rig.group.traverse((o) => { if (o.userData && ['head', 'ear', 'eye', 'neck'].includes(o.userData.own)) o.visible = !hidden; });
}

// ---- 换装：他的大号衬衫（S 穿）。每帧按骨架更新；scale 由对方/自己身高比决定 ----
export function makeShirt(color) {
  // 照彼シャツシミュレーター：宽宽的垂坠衣身（下摆微喇）+ 固定筒袖 + 小翻领
  const mat = new THREE.MeshPhongMaterial({ color, transparent: true, opacity: 0.93, shininess: 10, side: THREE.DoubleSide });
  const btnMat = new THREE.MeshBasicMaterial({ color: 0xfdfdfd });
  const g = new THREE.Group();
  const lathePts = [];
  for (let i = 0; i <= 20; i++) {          // t=0 顶(肩) -> 1 底(下摆)，下摆微喇
    const t = i / 20;
    lathePts.push(new THREE.Vector2(1 + 0.16 * Math.pow(t, 2.2), 0.5 - t));
  }
  const body = new THREE.Mesh(new THREE.LatheGeometry(lathePts, 28), mat);
  const yoke = new THREE.Mesh(new RoundedBoxGeometry(1, 1, 1, 3, 0.3), mat);        // 肩部
  const sleeves = [0, 1, 2, 3].map(() => new THREE.Mesh(new THREE.CylinderGeometry(1, 1.18, 1, 12, 1, true), mat));
  const collar = [0, 1].map(() => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat));
  const buttons = [0, 1, 2].map(() => new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), btnMat));
  const hem = new THREE.Mesh(new THREE.TorusGeometry(1, 0.05, 8, 28), mat);          // 下摆收边
  g.add(body, yoke, hem, ...sleeves, ...collar, ...buttons);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { group: g, mat, body, yoke, sleeves, collar, buttons, hem };
}
const _y = new THREE.Vector3(0, 1, 0), _z = new THREE.Vector3(0, 0, 1);
// 参考图核对：原版是长袖盖住整只手（袖口吞手），双臂在水平线下约 23° 斜向下伸出，衣摆在大腿上段。
// true = 筒袖款（与截图一致，默认）；false = 无袖敞开款（备选，之前误读截图时做的）
export const SHIRT_SLEEVES = true;
export function updateShirt(sh, J, k = 1.15) {
  const d = J.d;
  // 衣身：肩线下垂到膝上（他的衬衫长 0.41*h，垂在她身上）
  const top = J.shC.clone().addScaledVector(J.upC, -0.01 * d.h);
  const drop = Math.min(d.h * 0.4, d.torso + d.thigh * 0.62);
  const bot = J.P.clone().addScaledVector(J.upC, d.torso * 0.5 - drop);
  const len = top.distanceTo(bot);
  sh.body.position.copy(top.clone().add(bot).multiplyScalar(0.5));
  sh.body.quaternion.copy(J.Qc);
  sh.body.scale.set(d.bodyW * 0.62 * k, len, d.bodyD * 0.72 * k);
  sh.hem.visible = false;                                              // 下摆那圈收边不显示
  sh.yoke.position.copy(J.shC.clone().addScaledVector(J.upC, -0.02 * d.h)); sh.yoke.quaternion.copy(J.Qc);
  sh.yoke.scale.set(SHIRT_SLEEVES ? (d.sw * 2 + d.armR * 3) * 1.04 : d.sw * 2 * 0.9, 0.075 * d.h, d.bodyD * 1.2 * k);   // 无袖款肩部收窄，不盖住上臂根
  // 固定筒袖（照彼シャツの「袖口吞手」）：袖子从肩点直指指尖方向，长度=她的臂全长−手半径×0.55（差多少补多少），
  // 袖宽=借出者肩宽×0.85——不跟肘弯，她肘弯了袖子也是直筒，手腕以下被平端袖口盖住
  const segs = [[J.shL, J.wristL, J.elbowL], [J.shR, J.wristR, J.elbowR]];
  if (!SHIRT_SLEEVES) sh.sleeves.forEach((m) => { m.visible = false; });
  else segs.forEach(([a, b, el], i) => {
    const m = sh.sleeves[i * 2]; m.visible = true;
    const dir = b.clone().sub(a);
    const full = Math.max(dir.length(), d.upper + d.fore * 0.9);            // 臂长下限：候选姿势肘弯大时也保证够长
    const sl = full - d.handR * 0.55;
    dir.normalize();
    m.position.copy(a).addScaledVector(dir, sl / 2);
    m.quaternion.setFromUnitVectors(_y, dir);
    const r = d.sw * k * 0.85 * 0.5;                                        // 袖宽=借出者肩宽×0.85（k=他/她身高比，借出者肩宽近似）
    m.scale.set(r, sl, r);
    sh.sleeves[i * 2 + 1].visible = false;                                  // 旧下臂袖段弃用
  });
  // 领口：参考图是平领口，无翻领（两片都隐藏，保留对象便于回退）
  sh.collar.forEach((c) => { c.visible = false; });
  if (!SHIRT_SLEEVES) {
    const c = sh.collar[0]; c.visible = true;
    c.position.copy(top.clone().add(bot).multiplyScalar(0.5)).addScaledVector(front, d.bodyD * 0.72 * k * 1.012);
    c.quaternion.copy(J.Qc);
    c.scale.set(0.010 * d.h, len * 0.98, 0.004 * d.h);
  }
  // 前襟纽扣：参考图的衬衫没有扣子，隐藏（保留对象便于回退）
  sh.buttons.forEach((b) => { b.visible = false; });
}
// ---- 比手 / 比脚：只画掌印、脚印（半透明剪影叠放，不放人物）。items[0] 高个在后，items[1] 矮个在前 ----
// 轮廓路径取自 qwertyaz111 的 hand/foot-size-comparison 工具的 SVG path（其条款：可截图/加工/描摹，禁止营利商用）
import { HAND_D, FOOT_D } from './printsPaths.js';
const _p2d = (d, m) => { const q = new Path2D(); q.addPath(new Path2D(d), m); return q; };
let _handPath = null, _footPath = null;
function _shade(c, k) {                                // 颜色明暗：k<1 变深，k>1 变亮；解析不了就原样返回
  const mm = /^#?([0-9a-f]{6})$/i.exec(String(c).trim());
  if (!mm) return c;
  const n = parseInt(mm[1], 16), f = (v) => Math.max(0, Math.min(255, Math.round(k > 1 ? v + (255 - v) * (k - 1) : v * k)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
function drawHandShape(ctx, u, noFill) {                       // u = 指尖到手腕的像素长；手腕在 (0,0)，向 -y 生长（指朝上）
  if (!_handPath) {                                    // viewBox 25.922²：y=0 指尖、y=25.922 腕底，bbox x∈[2.328,23.593]
    const s = u / 25.922;
    _handPath = _p2d(HAND_D, new DOMMatrix([s, 0, 0, s, 0.14 * u - s * 12.96, -u]));
  }
  if (!noFill) ctx.fill(_handPath);
}
function drawFootShape(ctx, u, noFill) {                       // 脚后跟在 (0,0)，向 -y 生长（脚尖朝上）
  if (!_footPath) {                                    // 字体轮廓 y 轴朝上：脚跟在 y≈0、脚尖 y≈12798 → 翻转到画布 y 向下
    const s = u / 1280;
    _footPath = _p2d(FOOT_D, new DOMMatrix([0.1 * s, 0, 0, -0.1 * s, -s * 64, 0.14 * s]));
  }
  if (!noFill) ctx.fill(_footPath);
}
// ---- 熊掌 / 兔爪印：自写的贝塞尔轮廓（掌垫 + 分开的趾垫；熊带细长爪痕，兔被毛、边缘毛糙、无爪）----
// 比例/形状参考（只读了 web_search 返回的摘要，没精读整页；轮廓全部是本文件自写的 Catmull-Rom→三次贝塞尔，未使用任何第三方矢量路径）：
//  熊：5 趾、平足行走、长爪痕、宽大的足跟/掌垫 https://robbiegeorgephotography.com/bear-tracks ；https://arkfoundationus.org/bear-track-identification-guide
//      前掌掌垫宽大于长 https://scicentric.org/identify-bear-tracks-field-guide ；灰熊前掌印更方 https://www.umt.edu/grizzly-bear-recovery/grizzly-bears/identification.php
//      黑熊爪较短、趾更分开更弯 https://westernwildlife.org/wp-content/uploads/2010/05/beartracks3.pdf
//      趾短而并列在掌垫前方 https://www.taiwanbear.org.tw/assets/images/questionnairePDF.pdf ；前掌偏四方、后掌偏三角（台灣黑熊保育協會 Facebook 貼文 TBBCA/posts/924531264276422）
//  兔：每脚 4 趾、印子偏椭圆、爪痕几乎看不见 https://www.lcfpd.org/assets/1/7/Track_Identification_and_Walking_Gaits.pdf
//      前脚约 1 英寸、后脚约 4 英寸（后脚又长又窄） https://aldoleopoldnaturecenter.org/wp-content/uploads/Rabbit-Tracks.pdf
//  风格化（不是上述页面原话）：爪痕画成趾垫正前方分开的细长小痕；熊后掌画成人脚式长条而非三角；兔前掌边缘加毛糙起伏；熊前掌不单画足跟垫
// 设计坐标 y 向上、x 左右对称；_pawPath 再按纵向包围盒归一：掌根(脚跟)在 (0,0)、向 -y 生长，总长 = u，和手/脚印同一套约定
const _pawCache = {};
function _pawSmooth(pts) {                                           // 闭合点列 → Catmull-Rom → 三次贝塞尔段 [x0,y0,c1x,c1y,c2x,c2y,x1,y1]
  const n = pts.length, seg = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i + n - 1) % n], b = pts[i], c = pts[(i + 1) % n], d = pts[(i + 2) % n];
    seg.push([b[0], b[1], b[0] + (c[0] - a[0]) / 6, b[1] + (c[1] - a[1]) / 6, c[0] - (d[0] - b[0]) / 6, c[1] - (d[1] - b[1]) / 6, c[0], c[1]]);
  }
  return seg;
}
function _pawSym(top, right, bottom) {                               // 右半边（自上而下）+ 镜像，拼成顺时针闭合点列
  return [top, ...right, bottom, ...right.slice().reverse().map((p) => [-p[0], p[1]])];
}
function _pawBlob(cx, cy, rx, ry, rot, n, bump, k, ex) {             // 超椭圆（ex>2 更方）；bump/k：边缘 k 瓣毛糙起伏（k 取整数，保持左右对称）
  const pts = [], c = Math.cos(rot), s = Math.sin(rot);
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2, r = 1 + bump * Math.cos(k * t), st = Math.sin(t), ct = Math.cos(t);
    const x = rx * r * Math.sign(st) * Math.abs(st) ** (2 / ex), y = ry * r * Math.sign(ct) * Math.abs(ct) ** (2 / ex);
    pts.push([cx + x * c - y * s, cy + x * s + y * c]);
  }
  return _pawSmooth(pts);
}
function _pawClaw(x, yb, w, h, off) {                                // 细长爪痕：圆底、尖端，整体向外偏 off
  const tx = x + off, ty = yb + h;
  return [
    [x - w, yb, x - w * 0.8 + off * 0.1, yb + h * 0.5, tx - w * 0.2, yb + h * 0.82, tx, ty],
    [tx, ty, tx + w * 0.3, yb + h * 0.7, x + w * 0.9 + off * 0.2, yb + h * 0.35, x + w, yb],
    [x + w, yb, x + w, yb - h * 0.07, x - w, yb - h * 0.07, x - w, yb],
  ];
}
function _pawParts(species, hind) {                                  // 返回若干闭合轮廓（每个是一组三次贝塞尔段）
  const parts = [];
  const toes = (xs, cys, rx, ry, lean) => xs.forEach((x, i) => parts.push(_pawBlob(x, cys[i], rx, ry, -x * lean, 16, 0, 0, 2.3)));   // 趾垫外倾
  const claws = (xs, cys, ry, gap, w, h, lean) => xs.forEach((x, i) => parts.push(_pawClaw(x + ry * x * lean, cys[i] + ry + gap, w, h, h * x * lean * 1.3)));
  if (species === 'rabbit') {
    if (hind) {                                                      // 兔后脚：又窄又长的足印（脚跟→脚掌一条），前方 4 个小趾
      parts.push(_pawSmooth(_pawSym([0, 0.775], [[0.07, 0.78], [0.135, 0.755], [0.165, 0.69], [0.158, 0.57], [0.132, 0.43], [0.12, 0.30], [0.125, 0.18], [0.10, 0.07], [0.05, 0.015]], [0, 0])));
      toes([-0.16, -0.056, 0.056, 0.16], [0.86, 0.90, 0.90, 0.86], 0.04, 0.075, 1.4);
    } else {                                                         // 兔前脚：近圆的毛糙掌垫（边缘起伏）+ 4 个扇形散开的趾
      parts.push(_pawBlob(0, 0.27, 0.255, 0.27, 0, 32, 0.035, 9, 2.4));
      toes([-0.23, -0.085, 0.085, 0.23], [0.60, 0.69, 0.69, 0.60], 0.062, 0.11, 1.3);
    }
  } else if (hind) {                                                 // 熊后掌：像人脚的长条（掌垫与足跟连成一片）+ 5 小趾 + 爪痕
    parts.push(_pawSmooth(_pawSym([0, 0.625], [[0.12, 0.635], [0.215, 0.605], [0.258, 0.53], [0.245, 0.42], [0.205, 0.315], [0.19, 0.22], [0.185, 0.13], [0.15, 0.06], [0.085, 0.012]], [0, 0])));
    const xs = [-0.215, -0.11, 0, 0.11, 0.215], cys = [0.70, 0.732, 0.742, 0.732, 0.70];
    toes(xs, cys, 0.043, 0.058, 0.45); claws(xs, cys, 0.058, 0.025, 0.02, 0.10, 0.45);
  } else {                                                           // 熊前掌：宽大的圆角掌垫(足跟垫很少留印，故不单画) + 5 趾弧排 + 爪痕
    parts.push(_pawSmooth(_pawSym([0, 0.54], [[0.14, 0.545], [0.25, 0.52], [0.30, 0.45], [0.31, 0.35], [0.27, 0.25], [0.17, 0.175]], [0, 0.15])));
    const xs = [-0.28, -0.14, 0, 0.14, 0.28], cys = [0.645, 0.69, 0.695, 0.69, 0.645];
    toes(xs, cys, 0.062, 0.095, 0.5); claws(xs, cys, 0.095, 0.03, 0.026, 0.165, 0.5);
  }
  return parts;
}
function _pawPath(species, hind, u) {
  const key = `${species}${hind ? 'H' : 'F'}${u}`;
  if (_pawCache[key]) return _pawCache[key];
  const parts = _pawParts(species, hind);
  let lo = Infinity, hi = -Infinity;                                 // 纵向包围盒：逐段采样三次贝塞尔
  for (const segs of parts) for (const q of segs) for (let i = 0; i <= 48; i++) {
    const t = i / 48, m = 1 - t, y = m * m * m * q[1] + 3 * m * m * t * q[3] + 3 * m * t * t * q[5] + t * t * t * q[7];
    lo = Math.min(lo, y); hi = Math.max(hi, y);
  }
  const s = u / (hi - lo), P = new Path2D();
  const X = (x) => x * s, Y = (y) => -(y - lo) * s;
  for (const segs of parts) {
    P.moveTo(X(segs[0][0]), Y(segs[0][1]));
    for (const q of segs) P.bezierCurveTo(X(q[2]), Y(q[3]), X(q[4]), Y(q[5]), X(q[6]), Y(q[7]));
    P.closePath();
  }
  return (_pawCache[key] = P);
}
export function makePrints(kind, items) {
  // items: [{ len(m), color, label }]；返回 { group, fadeMats, fit:{c,w,h} }
  const g = new THREE.Group(), mats = [];
  const baseY = 0.30;
  // 手掌路径映射后 x∈[-225.5, 418.9]（宽 644px），y∈[-760,0]。画布原点 X0 必须 ≥225.5+描边富余，CW 要 ≥ X0+418.9+富余
  // 实测：旧 CW=560/X0=190 时左缘 -35px 切掉小指。取 X0=260、CW=760：左余 34.5、右余 81
  const HB_X0 = 260;
  const CW = 760, CH = 960, U = 760, Y0 = 880;                      // 画布加宽到 760，1.0 长度=760px
  const paw = kind === 'pawF' || kind === 'pawH';                  // 掌印左右对称，画布原点放正中
  const X0 = paw ? CW / 2 : (kind === 'foot' ? 190 : HB_X0);                         // 脚沿用旧值（脚 bbox 未超画布）
  const maxLen = Math.max(...items.map((it) => it.len));
  items.forEach((it) => {
    const front = it.k === 'B';                                      // 兔永远在前层，调数字也不会被盖住
    const SS = 1;                                                    // 不做 2× 超采样：1520×1920 贴图 + mipmap 在 Intel 核显（ANGLE/D3D11）上整张画不出来
    const cv = document.createElement('canvas'); cv.width = CW * SS; cv.height = CH * SS;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.scale(SS, SS); ctx.translate(X0, Y0);
    const shape = kind === 'foot' ? drawFootShape : drawHandShape;
    if (!paw) shape(ctx, U, true);                                             // 仅确保路径已缓存
    const P = paw ? _pawPath(it.species, kind === 'pawH', U) : (kind === 'foot' ? _footPath : _handPath);
    const dark = _shade(it.color, 0.55), light = _shade(it.color, 1.25);
    // 1) 柔和投影（只投一层，避免描边/渐变重复叠影）
    ctx.save(); ctx.shadowColor = 'rgba(30,34,50,.35)'; ctx.shadowBlur = 22; ctx.shadowOffsetY = 8; ctx.fillStyle = it.color; ctx.globalAlpha = 0.5; ctx.fill(P); ctx.restore();
    // 2) 渐变填充：指尖/脚尖偏亮、腕/跟偏深，有一点体积感；高个（后）更透，矮个（前）更实
    const grd = ctx.createLinearGradient(0, -U, 0, 0); grd.addColorStop(0, light); grd.addColorStop(1, it.color);
    ctx.save(); ctx.globalAlpha = 0.6; ctx.fillStyle = grd; ctx.fill(P); ctx.restore();
    // 3) 描边勾轮廓：深色实线，圆角连接；高个描边更粗，叠放时外圈一眼可见
    ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.lineWidth = 7; ctx.strokeStyle = dark; ctx.globalAlpha = 0.95; ctx.stroke(P); ctx.restore();
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
    const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 1, depthWrite: false, side: THREE.DoubleSide });   // 透明度已烘进画布
    mats.push(m);
    const mpp = it.len / U, pw = CW * mpp, ph = CH * mpp;           // 米/像素：指尖到手腕（脚跟到脚尖）长 = it.len
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), m);
    // 让画布原点像素 (X0,Y0) 落在 (0, baseY)：平面中心相对原点偏移 = ((CW/2-X0), (Y0-CH/2)) 像素
    plane.position.set((CW / 2 - X0) * mpp - (paw ? 0 : (kind === 'foot' ? 0.20 : 0.15) * it.len + (front ? 0.05 * it.len : 0)), baseY + (Y0 - CH / 2) * mpp - (front && !paw ? 0.03 * it.len : 0), front ? 0.012 : 0);   // 前面（矮个）的那只错开一点，露出后面大一圈的边
    plane.renderOrder = 10 + (front ? 1 : 0); g.add(plane);
  });
  // 文字（名字 + 长度），高个在上、矮个在下
  const mkText = (t, color, size) => {
    const cv = document.createElement('canvas'); cv.width = 720; cv.height = 120;
    const c = cv.getContext('2d'); c.font = `700 56px "PingFang SC","Microsoft YaHei",sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = 'rgba(255,255,255,.88)'; const w = c.measureText(t).width + 56; c.beginPath(); c.roundRect(360 - w / 2, 14, w, 92, 46); c.fill();
    c.fillStyle = color; c.fillText(t, 360, 62);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }); mats.push(m);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size / 6), m); mesh.renderOrder = 20; return mesh;
  };
  const tw = Math.max(0.30, maxLen * 1.75);
  items.forEach((it, i) => {
    const t = mkText(it.label, it.textColor || '#4b5060', tw);
    t.position.set(0, baseY - 0.09 - i * tw / 6 * 1.05, 0.02); g.add(t);
  });
  const top = baseY + maxLen * 1.0 + 0.12, bot = baseY - 0.09 - tw / 6 * 2.2;
  return { group: g, fadeMats: mats, fit: { c: new THREE.Vector3(0, (top + bot) / 2, 0), w: Math.max(tw, maxLen * 0.9), h: top - bot, d: 0.1 } };
}

export function disposeRig(rig) { rig.mat.dispose(); rig.eyeMat.dispose(); }

// ---- 共戴围巾 ----
// 照 sharing-a-scarf-simulator 的 createMuffler：每人一圈椭圆颈环（半径=脖半径+松量，前后拉长 zs 倍，口沿微喇叭），
// 两环之间一段「前拱 + 悬链下垂」的桥，外侧各一条垂尾。截面是扁矩形（宽 w、厚 th），ExtrudeGeometry 沿曲线扫掠。
// 几何参数全部由 spec 给出（姿势 scarf 里按原作公式算），这里只建网格，并把算出的数放进 userData.info 供检测脚本读。
const _P = (q) => new THREE.Vector3(q[0], q[1], q[2]);

// 悬链线：过 (0,0)、(H,V) 两点，跨中比弦低 sag。返回 { a, y(s) }，s∈[0,H]，y 相对起点。
export function catenary(H, V, sag) {
  const make = (a) => {
    const s0 = H / 2 - a * Math.asinh(V / (2 * a * Math.sinh(H / (2 * a))));
    const c = -a * Math.cosh(s0 / a);
    return { a, y: (s) => a * Math.cosh((s - s0) / a) + c };
  };
  const depth = (a) => V / 2 - make(a).y(H / 2);          // a 越大越平，depth 单调减
  let lo = H * 0.02, hi = H * 1e3;
  for (let i = 0; i < 100; i++) { const mid = Math.sqrt(lo * hi); if (depth(mid) > sag) lo = mid; else hi = mid; }
  return make(Math.sqrt(lo * hi));
}

export function makeScarf(spec) {
  const g = new THREE.Group();
  const mk = (color, rough, metal) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, side: THREE.DoubleSide, transparent: true, opacity: 1 });
  const m = mk(spec.color ?? 0xd63031, 0.85, 0.05), stripe = mk(0xf4e9d8, 0.9, 0);
  const W = spec.w, TH = spec.th, ZS = spec.zs, phi = Math.atan(spec.flare);
  const shape = new THREE.Shape();
  shape.moveTo(-TH / 2, -W / 2); shape.lineTo(TH / 2, -W / 2); shape.lineTo(TH / 2, W / 2); shape.lineTo(-TH / 2, W / 2); shape.closePath();
  const info = { rings: [], bridge: null, tails: [] };
  // 沿 pts 扫出带状网格。nref(t,p) 给「厚度方向」参考向量，投影到切平面后当法线，宽度方向 = 切向 × 法线，
  // 这样带面不会拧成麻花（环：厚度沿径向并带喇叭倾角；桥与垂尾：厚度朝前 +z，宽度横跨 x 或竖直）。
  const band = (pts, steps, nref, mat = m, closed = false) => {
    const curve = new THREE.CatmullRomCurve3(pts.map(_P), closed, 'centripetal');
    curve.computeFrenetFrames = (segs) => {
      const tangents = [], normals = [], binormals = [];
      for (let i = 0; i <= segs; i++) {
        const u = Math.min(i / segs, 1);
        const t = curve.getTangentAt(u).normalize();
        const n = nref(t, curve.getPointAt(u)); n.addScaledVector(t, -n.dot(t));
        if (n.lengthSq() < 1e-8) n.set(1, 0, 0).addScaledVector(t, -t.x);
        n.normalize();
        tangents.push(t); normals.push(n); binormals.push(new THREE.Vector3().crossVectors(t, n).normalize());
      }
      return { tangents, normals, binormals };
    };
    const me = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { steps, bevelEnabled: false, extrudePath: curve }), mat);
    me.castShadow = true; g.add(me); return curve;
  };
  const front = () => new THREE.Vector3(0, 0, 1);

  // 1) 颈环：椭圆，x 半轴 a=r（脖半径+松量），z 半轴 b=zs·a（颈前让位，颈后贴紧）
  for (const n of spec.necks) {
    const a = n.r, b = n.r * ZS, [cx, cy, cz] = n.c, pts = [];
    for (let i = 0; i < 32; i++) { const t = (i / 32) * Math.PI * 2; pts.push([cx + Math.cos(t) * a, cy, cz + Math.sin(t) * b]); }
    const radial = (t, p) => {
      const dx = (p.x - cx) / (a * a), dz = (p.z - cz) / (b * b), l = Math.hypot(dx, dz) || 1;
      return new THREE.Vector3((dx / l) * Math.cos(phi), -Math.sin(phi), (dz / l) * Math.cos(phi));
    };
    const curve = band(pts, 64, radial, m, true);
    info.rings.push({ c: n.c, a, b, circ: Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b))), len: curve.getLength() });
  }

  // 2) 桥：从两环相对的一侧出发（落在环的前弧上），前拱 + 悬链下垂
  const [nA, nB] = spec.necks;
  const contact = (n, o) => {
    const dir = Math.sign(o.c[0] - n.c[0]) || 1, b = n.r * ZS;
    const dz = Math.min(spec.front * 0.5, 0.85 * b);
    return [n.c[0] + dir * n.r * Math.sqrt(1 - (dz / b) ** 2), n.c[1], n.c[2] + dz];
  };
  const P0 = contact(nA, nB), P1 = contact(nB, nA);
  const dx = P1[0] - P0[0], dy = P1[1] - P0[1], dz = P1[2] - P0[2];
  const H = Math.hypot(dx, dz), direct = Math.hypot(dx, dy, dz);
  const Lb = Math.hypot(direct, Math.abs(dy)) * spec.loose;      // 原作：√(directDist²+heightDiff²)×1.15（dy 被重复计入）
  const sag = Math.max(spec.sagMin, spec.sagK * Lb);             // 原作 dynamicSlack
  const cat = catenary(H, dy, sag);
  const br = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    br.push([P0[0] + dx * t, P0[1] + cat.y(H * t), P0[2] + dz * t + Math.sin(t * Math.PI) * spec.front]);
  }
  const bc = band(br, 80, front);
  let low = br[0]; for (const q of br) if (q[1] < low[1]) low = q;
  info.bridge = { P0, P1, direct, ropeL: Lb, sag, arch: spec.front, catA: cat.a, pts: br, lowest: low, len: bc.getLength() };

  // 3) 垂尾：起点在环的外侧半点（前弧），微 S 向前飘；末端两道奶白条纹
  spec.necks.forEach((n, i) => {
    const o = spec.necks[1 - i], dir = Math.sign(n.c[0] - o.c[0]) || 1, b = n.r * ZS, s = n.h / 1.7, L = n.tail;
    const x0 = n.c[0] + dir * 0.5 * n.r, y0 = n.c[1], z0 = n.c[2] + b * Math.sqrt(0.75);
    // 原作：中点 (x∓0.03, y-0.5L, z+0.08)、终点 (x∓0.05, y-L, z+0.12)，x、z 相对起点，A 尾向左前、B 尾向右前
    const tail = [[x0, y0, z0], [x0 + dir * 0.03 * s, y0 - 0.5 * L, z0 + 0.08 * s], [x0 + dir * 0.05 * s, y0 - L, z0 + 0.12 * s]];
    const curve = band(tail, 24, front);
    for (const f of [0.8, 0.88]) {
      const seg = [f, f + 0.02, f + 0.04].map((u) => { const v = curve.getPointAt(u); return [v.x, v.y, v.z + TH * 0.2]; });
      band(seg, 4, front, stripe);
    }
    info.tails.push({ len: curve.getLength(), nominal: L, start: tail[0], end: tail[2] });
  });
  info.total = info.rings.reduce((s, r) => s + r.len, 0) + info.bridge.len + info.tails.reduce((s, t) => s + t.len, 0);
  g.userData.fadeMats = [m, stripe];
  g.userData.info = info;
  return g;
}

// ---- 道具 ----
export function makeProp(spec) {
  const g = new THREE.Group();
  if (spec.type === 'wall') {
    const m = new THREE.MeshPhongMaterial({ color: 0xe4e6ea, transparent: true, opacity: 0.55 });
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.5, 3.2), m);
    w.position.set(spec.x - 0.03, 1.25, 0);
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(w.geometry), new THREE.LineBasicMaterial({ color: 0xb9bec7 }));
    e.position.copy(w.position);
    g.add(w, e);
    g.userData.fadeMats = [m];
  } else if (spec.type === 'box' && spec.hidden) {
    g.userData.fadeMats = [];          // 画面上由家具代替，只给检测脚本用
  } else if (spec.type === 'box') {
    // 家具：圆角盒（长凳/沙发/床），半透明浅色，带细描边
    const m = new THREE.MeshPhongMaterial({ color: spec.color ?? 0xd9dce3, transparent: true, opacity: 0.78, shininess: 10 });
    const [hx, hy, hz] = spec.s;
    const geo = new RoundedBoxGeometry(hx * 2, hy * 2, hz * 2, 2, Math.min(0.03, hx, hy, hz) * 0.9);
    const b = new THREE.Mesh(geo, m); b.position.set(...spec.c); b.castShadow = true; b.receiveShadow = true;
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2)), new THREE.LineBasicMaterial({ color: 0xc3c7d0, transparent: true, opacity: 0.6 }));
    e.position.copy(b.position);
    g.add(b, e);
    g.userData.fadeMats = [m];
  } else if (spec.type === 'scarf') {
    return makeScarf(spec);          // 椭圆颈环 + 悬链桥 + 按身高比的垂尾，见上面 makeScarf
  } else if (spec.type === 'phone') {
    g.add(phoneProp());
    g.position.set(...(spec.at || [0, 0, 0])); g.rotation.y = spec.ry || 0;   // 按姿势给的位置摆放
    g.userData.fadeMats = [];
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.material.transparent = true; g.userData.fadeMats.push(o.material); } });
  } else if (spec.type === 'ringBox') {
    g.add(ringBoxProp());
    g.position.set(...(spec.at || [0, 0, 0])); g.rotation.y = spec.ry || 0;
    g.userData.fadeMats = [];
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.material.transparent = true; g.userData.fadeMats.push(o.material); } });
  } else if (spec.type === 'umbrella') {
    g.add(umbrellaProp(spec.r, spec.len));
    g.position.set(...(spec.at || [0, 0, 0])); g.rotation.y = spec.ry || 0;   // 按姿势给的位置摆放
    g.userData.fadeMats = [];
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.material.transparent = true; g.userData.fadeMats.push(o.material); } });
  } else if (spec.type === 'carton') {
    g.add(cartonProp(spec));
    g.position.set(...(spec.at || [0, 0, 0])); g.rotation.y = spec.ry || 0;
    g.userData.fadeMats = [];
    const seen = new Set();   // 壁/折边/胶带共用材质：只登记一次，淡出时才不会重复乘
    // 纸箱不投影：壁面本来就略透明，投影会把箱内两人整个压暗
    g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; o.material.transparent = true; if (!seen.has(o.material)) { seen.add(o.material); g.userData.fadeMats.push(o.material); } } });
  } else if (spec.type === 'cello') {
    g.add(celloProp());
    g.position.set(...(spec.at || [0, 0, 0])); g.rotation.y = spec.ry || 0;   // 琴面朝本地 +z，endpin 落在 y=0
    g.userData.fadeMats = [];
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.material.transparent = true; if (!g.userData.fadeMats.includes(o.material)) g.userData.fadeMats.push(o.material); } });
  } else if (spec.type === 'bouquet') {
    g.add(bouquetProp());
    g.position.set(...(spec.at || [0, 0, 0])); g.rotation.y = spec.ry || 0;   // 原点在花茎底端，花朝本地 +y
    g.userData.fadeMats = [];
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.material.transparent = true; if (!g.userData.fadeMats.includes(o.material)) g.userData.fadeMats.push(o.material); } });
  } else if (spec.type === 'book' || spec.type === 'coffee') {
    const it = spec.type === 'book' ? bookProp() : coffeeCupProp();
    if (spec.type === 'book' && spec.upright) { it.rotation.x = Math.PI / 2; it.position.z = -0.02; }   // 立着拿：封面朝 +z、书脊在左、书签垂在下沿；此时原点在书的几何中心（平放时在底面中心）
    g.add(it);
    g.position.set(...(spec.at || [0, 0, 0])); g.rotation.y = spec.ry || 0;   // 原点在底面中心
    g.userData.fadeMats = [];
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.material.transparent = true; if (!g.userData.fadeMats.includes(o.material)) g.userData.fadeMats.push(o.material); } });
  } else if (spec.type === 'piano') {
    g.add(pianoProp(...(spec.args || [])));
    g.position.set(...(spec.at || [0, 0, 0])); g.rotation.y = spec.ry || 0;   // 按姿势给的位置摆放
    g.userData.fadeMats = [];
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.material.transparent = true; g.userData.fadeMats.push(o.material); } });
  } else if (spec.kind && FURN[spec.kind]) {
    // 姿势里直接给的单个家具（{ kind:'chair', args, at, ry }）：与 furniture 同样处理
    const o = FURN[spec.kind](...(spec.args || []));
    o.position.set(...(spec.at || [0, 0, 0])); o.rotation.y = spec.ry || 0;
    g.add(o);
    g.userData.fadeMats = [];
    g.traverse((q) => { if (q.isMesh) { q.castShadow = true; q.receiveShadow = true; q.material.transparent = true; g.userData.fadeMats.push(q.material); } });
  } else if (spec.type === 'furniture') {
    g.add(buildFurniture(spec));
    g.userData.fadeMats = [];
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.material.transparent = true; g.userData.fadeMats.push(o.material); } });
  }
  return g;
}
export const vec = V;


// ---- 身高刻度背景（照 MIT height-compare 的 mugshot 刻度线思路，换成 3D 版：贴地细线 + 数字牌）----
export function makeRuler(maxCm = 210) {
  const g = new THREE.Group();
  const lineMat = new THREE.LineBasicMaterial({ color: 0xc9cdd6, transparent: true, opacity: 0.55 });
  const majorMat = new THREE.LineBasicMaterial({ color: 0xaab0bd, transparent: true, opacity: 0.8 });
  for (let cm = 10; cm <= maxCm; cm += 10) {
    const y = cm / 100, major = cm % 50 === 0;
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-6, y, -2.2), new THREE.Vector3(6, y, -2.2)]);
    g.add(new THREE.Line(geo, major ? majorMat : lineMat));
    if (major) {
      const cv = document.createElement('canvas'); cv.width = 128; cv.height = 48;
      const x = cv.getContext('2d'); x.font = 'bold 30px system-ui,sans-serif'; x.fillStyle = '#8d94a3'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(cm + '', 64, 24);
      const tex = new THREE.CanvasTexture(cv);
      const sm = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.85 });
      const sp = new THREE.Sprite(sm); sp.scale.set(0.22, 0.082, 1); sp.position.set(-6.12, y, -2.2);
      g.add(sp);
    }
  }
  g.userData.rulerMats = [lineMat, majorMat];
  return g;
}

// ---- 家具（尺寸、配色照 qwertyaz111 系列：木色 0xddcbbb、灰管 0x777777、深木书架 0x5c3a21、沙发 0x9fabba） ----
const MAT = {
  wood: () => new THREE.MeshPhongMaterial({ color: 0xddcbbb, shininess: 18 }),
  darkWood: () => new THREE.MeshPhongMaterial({ color: 0x5c3a21, shininess: 12 }),
  pipe: () => new THREE.MeshPhongMaterial({ color: 0x777777, shininess: 40 }),
  sofa: () => new THREE.MeshPhongMaterial({ color: 0x9fabba, shininess: 6 }),
  cushion: () => new THREE.MeshPhongMaterial({ color: 0x8a99a8, shininess: 6 }),
  sheet: () => new THREE.MeshPhongMaterial({ color: 0xf0f4f8, shininess: 6 }),
  pillow: () => new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 6 }),
  blanket: () => new THREE.MeshPhongMaterial({ color: 0xc9d6e8, shininess: 6 }),
  rug: () => new THREE.MeshPhongMaterial({ color: 0xe9e1d6, shininess: 2 }),
};
const fbox = (w, h, d, mat, x, y, z, r = 0) => { const me = new THREE.Mesh(r ? new RoundedBoxGeometry(w, h, d, 2, r) : new THREE.BoxGeometry(w, h, d), mat); me.position.set(x, y, z); return me; };
function rng(seed) { let t = seed >>> 0; return () => { t += 0x6d2b79f5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; }; }
// 书架：正面朝 +z，背板在 -z
function bookshelf(w = 1.6, h = 2.0, d = 0.32, seed = 7) {
  const g = new THREE.Group(), wd = MAT.darkWood(), th = 0.025, n = 5;
  g.add(fbox(th, h, d, wd, -w / 2 + th / 2, h / 2, 0), fbox(th, h, d, wd, w / 2 - th / 2, h / 2, 0), fbox(w, th, d, wd, 0, h - th / 2, 0), fbox(w, 0.08, d, wd, 0, 0.04, 0), fbox(w, h, 0.01, wd, 0, h / 2, -d / 2 + 0.005));
  const mats = [0x2266aa, 0xaa3333, 0x338833, 0xddaa33, 0x663399, 0x444444, 0xcc6622, 0xe8d9c0].map((c) => new THREE.MeshPhongMaterial({ color: c, shininess: 10 }));
  const r = rng(seed), step = (h - 0.08 - th) / n;
  for (let i = 0; i < n; i++) {
    const y0 = 0.08 + i * step;
    if (i) g.add(fbox(w - 2 * th, th, d - 0.01, wd, 0, y0, 0));
    let x = -w / 2 + th + 0.02;
    while (x < w / 2 - th - 0.06) {
      if (r() < 0.07) { x += 0.06 + r() * 0.08; continue; }        // 留几处空位
      const bw = 0.025 + r() * 0.025, bh = step * (0.6 + r() * 0.25), bd = d * (0.62 + r() * 0.2);
      const b = fbox(bw, bh, bd, mats[Math.floor(r() * mats.length)], x + bw / 2, y0 + th / 2 + bh / 2, -d / 2 + 0.01 + bd / 2);
      g.add(b); x += bw + 0.004;
    }
  }
  return g;
}
// 椅子：正面朝 +z，靠背在 -z
function chair(seatY = 0.42, back = true) {
  const g = new THREE.Group(), wd = MAT.wood(), pp = MAT.pipe();
  g.add(fbox(0.42, 0.03, 0.42, wd, 0, seatY, 0, 0.01));
  if (back) g.add(fbox(0.42, 0.4, 0.03, wd, 0, seatY + 0.22, -0.195, 0.01));
  const legG = new THREE.CylinderGeometry(0.014, 0.014, seatY);
  for (const [x, z] of [[-0.19, -0.18], [0.19, -0.18], [-0.19, 0.18], [0.19, 0.18]]) { const l = new THREE.Mesh(legG, pp); l.position.set(x, seatY / 2, z); g.add(l); }
  return g;
}
function table(w = 1.4, d = 0.7, h = 0.72) {
  const g = new THREE.Group(), wd = MAT.wood(), pp = MAT.pipe();
  g.add(fbox(w, 0.04, d, wd, 0, h - 0.02, 0, 0.012));
  for (const x of [-w / 2 + 0.05, w / 2 - 0.05]) g.add(fbox(0.04, h - 0.04, d - 0.1, pp, x, (h - 0.04) / 2, 0));
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.034, 0.09, 16), new THREE.MeshPhongMaterial({ color: 0xffffff }));
  cup.position.set(w * 0.3, h + 0.045, 0.1); g.add(cup);
  g.add(fbox(0.2, 0.03, 0.15, new THREE.MeshPhongMaterial({ color: 0xaa3333 }), -w * 0.3, h + 0.015, 0.08));
  return g;
}
// 沙发：正面朝 +z
function sofa(w = 2.0, seatY = 0.42, d = 0.8) {
  const g = new THREE.Group(), sf = MAT.sofa(), cs = MAT.cushion(), st = 0.16;
  g.add(fbox(w, seatY - st, d - 0.05, sf, 0, (seatY - st) / 2, 0, 0.02));
  const cw = (w - 0.3) / 2;
  for (const x of [-cw / 2 - 0.005, cw / 2 + 0.005]) g.add(fbox(cw, st, d - 0.18, cs, x, seatY - st / 2, 0.05, 0.05));
  g.add(fbox(w, 0.5, 0.18, sf, 0, seatY + 0.17, -d / 2 + 0.09, 0.06));
  for (const s of [-1, 1]) g.add(fbox(0.15, 0.27, d, sf, s * (w / 2 - 0.075), seatY, 0, 0.05));
  const pl = fbox(0.34, 0.32, 0.12, new THREE.MeshPhongMaterial({ color: 0xf2c4ce }), w / 2 - 0.36, seatY + 0.15, -d / 2 + 0.25, 0.05); pl.rotation.z = -0.25; pl.rotation.x = -0.2; g.add(pl);
  return g;
}
// 床：长边沿 x，床头在 -x
function bed(len = 2.1, wid = 1.4, topY = 0.5, runner = true) {
  const g = new THREE.Group(), fr = MAT.wood();
  g.add(fbox(len, topY - 0.18, wid, fr, 0, (topY - 0.18) / 2, 0, 0.02));
  g.add(fbox(len - 0.04, 0.18, wid - 0.04, MAT.sheet(), 0, topY - 0.09, 0, 0.05));
  g.add(fbox(0.06, 0.95, wid, fr, -len / 2 - 0.03, 0.475, 0, 0.02));
  if (runner) g.add(fbox(len * 0.3, 0.022, wid + 0.02, MAT.blanket(), len * 0.33, topY - 0.004, 0, 0.008));
  return g;
}
function pillow(w = 0.5, d = 0.32, h = 0.09) { const g = new THREE.Group(); g.add(fbox(w, h, d, MAT.pillow(), 0, h / 2, 0, Math.min(0.04, h * 0.45))); return g; }
function rug(w, d) { const g = new THREE.Group(); const r = new THREE.Mesh(new THREE.BoxGeometry(w, 0.004, d), MAT.rug()); r.position.y = 0.0015; r.receiveShadow = true; g.add(r); return g; }
function lamp() {
  const g = new THREE.Group(), pp = MAT.pipe();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.45), pp); pole.position.y = 0.725; g.add(pole);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.03, 20), pp); base.position.y = 0.015; g.add(base);
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.2, 0.24, 20, 1, true), new THREE.MeshPhongMaterial({ color: 0xfff3dc, side: THREE.DoubleSide, emissive: 0x332a18 }));
  shade.position.y = 1.5; g.add(shade);
  return g;
}
function plant() {
  const g = new THREE.Group();
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.1, 0.24, 18), new THREE.MeshPhongMaterial({ color: 0xc98a62 })); pot.position.y = 0.12; g.add(pot);
  const st = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.015, 0.3), new THREE.MeshPhongMaterial({ color: 0x6b4d36 })); st.position.y = 0.36; g.add(st);
  const lm = new THREE.MeshPhongMaterial({ color: 0x6fae6b, shininess: 8 });
  [[0, 0.5, 0, 0.17], [0.08, 0.66, 0.03, 0.12], [-0.07, 0.62, -0.04, 0.13], [0.02, 0.8, 0, 0.09]].forEach(([x, y, z, r]) => { const s = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), lm); s.position.set(x, y, z); g.add(s); });
  return g;
}
// 手机（自拍用）：横握薄板——磨砂机身 + 微亮屏幕 + 前置镜头珠（朝 +z，即拍摄方向）。
// userData.camAnchor 挂在镜头珠上：RTT 画中画相机每帧 copy 它的世界位姿（照 couple-pic 的做法）
function phoneProp() {
  const g = new THREE.Group();
  const body = new THREE.MeshPhongMaterial({ color: 0x2b2f3a, shininess: 60 });
  const screen = new THREE.MeshPhongMaterial({ color: 0xa9cdec, emissive: 0x33465c, shininess: 90 });
  g.add(fbox(0.155, 0.080, 0.011, body, 0, 0, 0, 0.013));                       // 横过来的机身
  const scr = fbox(0.138, 0.068, 0.003, screen, 0, -0.004, 0.007, 0.009);       // 屏幕（朝 +z 镜头同侧）
  g.add(scr); g.userData.screenMesh = scr;
  const cam = new THREE.Mesh(new THREE.CylinderGeometry(0.010, 0.010, 0.008, 16), new THREE.MeshPhongMaterial({ color: 0x101218 }));
  cam.rotation.x = Math.PI / 2; cam.position.set(0.023, -0.055, -0.008); g.add(cam);
  const anchor = new THREE.Object3D(); anchor.position.set(0.023, -0.055, 0.012); g.add(anchor);   // 镜头前方一点
  g.userData.camAnchor = anchor;
  return g;
}
// 求婚戒指盒：掌心托着的小盒子，开盖露出一颗圆钻；at=盒子中心
function ringBoxProp() {
  const g = new THREE.Group();
  const velvet = new THREE.MeshPhongMaterial({ color: 0x7a2233, shininess: 20 });
  const gold = new THREE.MeshPhongMaterial({ color: 0xd4af37, shininess: 90 });
  const gem = new THREE.MeshPhongMaterial({ color: 0xeaf6ff, shininess: 120, emissive: 0x335566 });
  g.add(fbox(0.075, 0.028, 0.06, velvet, 0, 0.014, 0, 0.006));                 // 盒底
  const lid = fbox(0.075, 0.012, 0.06, velvet, 0, 0.034, -0.028, 0.006);
  lid.rotation.x = -0.9; lid.position.y = 0.052; lid.position.z = -0.052;      // 开盖立起
  g.add(lid);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.013, 0.0028, 8, 20), gold);
  band.rotation.x = Math.PI / 2; band.position.set(0, 0.030, 0.006); g.add(band);
  const stone = new THREE.Mesh(new THREE.OctahedronGeometry(0.0075, 0), gem);
  stone.position.set(0, 0.040, 0.006); g.add(stone);
  return g;
}
// 伞：at=手握点（原点）。杆从握点下方弯把一直通到伞面下沿 len 处；伞面为开口向下的锥，高 0.4r
function umbrellaProp(r = 0.9, len = 0.44) {
  const g = new THREE.Group();
  const pole = new THREE.MeshPhongMaterial({ color: 0x3a3d45, shininess: 55 });
  const cloth = new THREE.MeshPhongMaterial({ color: 0x23252c, shininess: 26, side: THREE.DoubleSide });
  const lo = -0.07;                                                   // 杆底（弯把起点）在手下方 7cm
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, len + r * 0.4 - lo), pole);
  shaft.position.y = (len + r * 0.4 + lo) / 2; g.add(shaft);
  const canopy = new THREE.Mesh(new THREE.ConeGeometry(r, r * 0.40, 16, 1, true), cloth);
  canopy.position.y = len + r * 0.2; g.add(canopy);
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.011, 0.08), pole); tip.position.y = len + r * 0.4 + 0.04; g.add(tip);
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.011, 8, 16, Math.PI), pole);   // J 形弯把，下半圆接在杆底
  hook.position.set(0.035, lo, 0); hook.rotation.z = Math.PI; g.add(hook);
  return g;
}
// 纸箱：无顶敞口。w×d = 箱内 x/z 尺寸，h = 壁高，t = 壁厚；箱底在 y=0，箱心在原点（位置由 at 给）。
// 牛皮纸色、壁面略透明（不挡人）、箱口四边向外折边、+z 外壁（镜头侧）贴一条胶带。
function cartonProp({ w = 0.9, d = 0.9, h = 0.45, t = 0.015 } = {}) {
  const g = new THREE.Group();
  const kraft = new THREE.MeshPhongMaterial({ color: 0xc9a06a, transparent: true, opacity: 0.82, shininess: 6, depthWrite: false });
  const flapMat = new THREE.MeshPhongMaterial({ color: 0xd3ae79, transparent: true, opacity: 0.88, shininess: 6, depthWrite: false });
  const floorMat = new THREE.MeshPhongMaterial({ color: 0xb98f58, transparent: true, opacity: 0.9, shininess: 4 });
  const tapeMat = new THREE.MeshPhongMaterial({ color: 0xe6d6a0, transparent: true, opacity: 0.92, shininess: 40, depthWrite: false });
  g.add(fbox(w, 0.004, d, floorMat, 0, 0.002, 0));                                   // 箱底（极薄，不吞人体最低点）
  g.add(fbox(t, h, d + 2 * t, kraft, -(w / 2 + t / 2), h / 2, 0));                   // -x 壁
  g.add(fbox(t, h, d + 2 * t, kraft, w / 2 + t / 2, h / 2, 0));                      // +x 壁
  g.add(fbox(w, h, t, kraft, 0, h / 2, -(d / 2 + t / 2)));                           // -z 壁
  g.add(fbox(w, h, t, kraft, 0, h / 2, d / 2 + t / 2));                              // +z 壁
  const fl = Math.min(0.12, h * 0.3), tilt = 0.55;                                   // 折边：绕箱口外沿向外翻 ~31°
  for (const sx of [-1, 1]) {
    const p = new THREE.Group(); p.position.set(sx * (w / 2 + t / 2), h, 0); p.rotation.z = -sx * tilt;
    p.add(fbox(t * 0.8, fl, d + 2 * t, flapMat, 0, fl / 2, 0)); g.add(p);
  }
  for (const sz of [-1, 1]) {
    const p = new THREE.Group(); p.position.set(0, h, sz * (d / 2 + t / 2)); p.rotation.x = sz * tilt;
    p.add(fbox(w + 2 * t, fl, t * 0.8, flapMat, 0, fl / 2, 0)); g.add(p);
  }
  const tl = h * 0.62;                                                               // 胶带：+z 外壁上一条竖带，从箱口垂下
  g.add(fbox(0.05, tl, 0.004, tapeMat, 0.12 * w, h - tl / 2, d / 2 + t + 0.002));
  return g;
}
// 立式钢琴：键面朝 +x（与 piano 姿势里 keyX=-0.55 对齐：箱体中心在 at，宽 0.60，+x 面即键面）
// 花束：低模积木风。原点在花茎底端（握在手里的位置），花朝 +y，总高约 0.5m
function bouquetProp() {
  const g = new THREE.Group();
  const Y = new THREE.Vector3(0, 1, 0);
  const stemM = new THREE.MeshPhongMaterial({ color: 0x4f9a52, shininess: 20 });
  const leafM = new THREE.MeshPhongMaterial({ color: 0x3f8a48, shininess: 25 });
  const paperM = new THREE.MeshPhongMaterial({ color: 0xf3e7d3, shininess: 15, side: THREE.DoubleSide });
  const paperIn = new THREE.MeshPhongMaterial({ color: 0xf6c9d6, shininess: 15, side: THREE.DoubleSide });
  const ribM = new THREE.MeshPhongMaterial({ color: 0xd6457a, shininess: 60 });
  const heart = new THREE.MeshPhongMaterial({ color: 0xf2c23a, shininess: 40 });
  const petalMats = [0xff7aa2, 0xe8465f, 0xffffff, 0xffb48a, 0xd98cf0].map((c) => new THREE.MeshPhongMaterial({ color: c, shininess: 35 }));
  const cyl = (a, b, r, m) => {                                   // 两点之间的细圆柱
    const len = a.distanceTo(b), me = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), m);
    me.position.copy(a).add(b).multiplyScalar(0.5);
    me.quaternion.setFromUnitVectors(Y, b.clone().sub(a).normalize());
    return me;
  };
  // 包装纸：外层米色 + 内层粉色，漏斗形，口朝上
  const outer = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.02, 0.30, 20, 1, true), paperM); outer.position.set(0, 0.20, 0.004); g.add(outer);
  const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.104, 0.018, 0.29, 20, 1, true), paperIn); inner.position.set(0, 0.205, 0); g.add(inner);
  // 丝带 + 蝴蝶结
  const rib = new THREE.Mesh(new THREE.TorusGeometry(0.044, 0.008, 8, 20), ribM); rib.rotation.x = Math.PI / 2; rib.position.y = 0.12; g.add(rib);
  for (const sx of [-1, 1]) { const w = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), ribM); w.scale.set(0.024, 0.014, 0.010); w.position.set(sx * 0.024, 0.12, 0.046); w.rotation.z = sx * 0.5; g.add(w); }
  const knot = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), ribM); knot.position.set(0, 0.12, 0.047); g.add(knot);
  // 花：中心一朵 + 一圈六朵，向外微倾
  const heads = [{ p: new THREE.Vector3(0, 0.45, 0), d: new THREE.Vector3(0, 1, 0), c: 0 }];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3, R = 0.078;
    const p = new THREE.Vector3(Math.cos(a) * R, 0.405 + (i % 2) * 0.03, Math.sin(a) * R);
    const d = new THREE.Vector3(Math.cos(a) * 0.55, 1, Math.sin(a) * 0.55).normalize();
    heads.push({ p, d, c: (i + 1) % petalMats.length });
  }
  heads.forEach((h, idx) => {
    g.add(cyl(new THREE.Vector3(0, 0.05, 0), h.p.clone().addScaledVector(h.d, -0.012), 0.0042, stemM));   // 花茎
    const f = new THREE.Group(); f.position.copy(h.p); f.quaternion.setFromUnitVectors(Y, h.d);
    const pm = petalMats[h.c];
    for (let k = 0; k < 6; k++) {                                                                          // 六片花瓣
      const a = (k / 6) * Math.PI * 2, pt = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), pm);
      pt.scale.set(0.030, 0.010, 0.020); pt.position.set(Math.cos(a) * 0.026, 0, Math.sin(a) * 0.026); pt.rotation.y = -a; f.add(pt);
    }
    const c = new THREE.Mesh(new THREE.SphereGeometry(0.0155, 10, 8), heart); c.position.y = 0.008; f.add(c);   // 花心
    g.add(f);
  });
  // 叶子：花束口沿几片
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.9, lf = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), leafM);
    lf.scale.set(0.016, 0.052, 0.006); lf.position.set(Math.cos(a) * 0.106, 0.375, Math.sin(a) * 0.106);
    lf.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5); g.add(lf);
  }
  return g;
}

// 书：精装书平放。原点在书底面中心，书脊朝 -x，封面朝上；深酒红封面 + 烫金边框和菱形花饰 + 书脊金带 + 一条红书签垂在下沿（+z 端）。总尺寸约 17×24×4cm
function bookProp() {
  const g = new THREE.Group();
  const W = 0.17, D = 0.24, H = 0.04, cv = 0.004, sp = 0.007;
  const cover = new THREE.MeshPhongMaterial({ color: 0x7a1f2b, shininess: 35 });
  const pages = new THREE.MeshPhongMaterial({ color: 0xf3ead6, shininess: 8 });
  const gold = new THREE.MeshPhongMaterial({ color: 0xd8b04a, shininess: 90 });
  const ribbon = new THREE.MeshPhongMaterial({ color: 0xc83a4d, shininess: 25 });
  g.add(fbox(W, cv, D, cover, 0, cv / 2, 0, 0.001));                                   // 封底
  g.add(fbox(W, cv, D, cover, 0, H - cv / 2, 0, 0.001));                               // 封面
  g.add(fbox(sp, H, D, cover, -W / 2 + sp / 2, H / 2, 0, 0.002));                      // 书脊
  g.add(fbox(W - sp - 0.006, H - 2 * cv, D - 0.012, pages, (sp - 0.006) / 2, H / 2, 0));   // 书页（比封面缩进，露出一圈封面边）
  for (const z of [-0.06, 0.06]) g.add(fbox(sp + 0.0012, H * 0.9, 0.004, gold, -W / 2 + sp / 2, H / 2, z));   // 书脊金带
  const cx = 0.004, y = H + 0.0006;                                                     // 封面烫金：边框 + 菱形（外金内红）
  for (const z of [-0.0885, 0.0885]) g.add(fbox(0.12, 0.0012, 0.003, gold, cx, y, z));
  for (const x of [-0.0585, 0.0585]) g.add(fbox(0.003, 0.0012, 0.18, gold, cx + x, y, 0));
  const d1 = fbox(0.036, 0.0012, 0.036, gold, cx, y, 0); d1.rotation.y = Math.PI / 4; g.add(d1);
  const d2 = fbox(0.024, 0.0012, 0.024, cover, cx, y + 0.0003, 0); d2.rotation.y = Math.PI / 4; g.add(d2);
  g.add(fbox(0.008, 0.0016, 0.045, ribbon, 0.03, H / 2, D / 2 + 0.0225));              // 书签
  return g;
}

// 咖啡杯：带杯碟的白瓷杯，杯里有咖啡（深褐液面 + 中间一圈浅色咖啡沫）。原点在碟底中心，杯把朝 +x，放大 1.5 倍后总高约 13cm
function coffeeCupProp() {
  const g = new THREE.Group();
  const ceramic = new THREE.MeshPhongMaterial({ color: 0xfaf6f0, shininess: 70, side: THREE.DoubleSide });
  const coffee = new THREE.MeshBasicMaterial({ color: 0x5b3318 });   // 不受光照影响，免得被场景灰白光洗淡
  const crema = new THREE.MeshBasicMaterial({ color: 0xa56f3e });
  const saucer = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.044, 0.012, 32), ceramic); saucer.position.y = 0.006; g.add(saucer);
  // 杯身：车削出的空心杯（外壁→杯口→内壁→杯底），不是实心柱，液面才能陷在杯里
  const prof = [[0, 0.012], [0.026, 0.012], [0.033, 0.02], [0.039, 0.045], [0.0425, 0.085], [0.043, 0.0885],
    [0.0395, 0.0885], [0.0385, 0.085], [0.034, 0.045], [0.028, 0.03], [0, 0.027]].map(([r, y]) => new THREE.Vector2(r, y));
  g.add(new THREE.Mesh(new THREE.LatheGeometry(prof, 32), ceramic));
  const surf = new THREE.Mesh(new THREE.CircleGeometry(0.0378, 32), coffee); surf.rotation.x = -Math.PI / 2; surf.position.y = 0.0845; g.add(surf);   // 液面低于杯口约 0.6cm（放大后），矮视角也能看到咖啡
  const cr = new THREE.Mesh(new THREE.CircleGeometry(0.026, 32), crema); cr.rotation.x = -Math.PI / 2; cr.position.y = 0.0847; g.add(cr);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.017, 0.0055, 8, 20, Math.PI * 1.5), ceramic);   // 270° 的环，缺口朝杯壁
  handle.position.set(0.053, 0.055, 0); handle.rotation.z = -Math.PI * 0.75; g.add(handle);
  g.scale.setScalar(1.5);
  return g;
}

// 大提琴：低模积木风。琴面朝本地 +z，尾钉落在 y=0，总高约 1.35m（含琴头）
function celloProp() {
  const g = new THREE.Group();
  const wood = new THREE.MeshPhongMaterial({ color: 0x9a5a2c, shininess: 60 });
  const dark = new THREE.MeshPhongMaterial({ color: 0x2a1c14, shininess: 40 });
  const str = new THREE.MeshPhongMaterial({ color: 0xd9d6cc, shininess: 80 });
  const ell = (rx, ry, rz, x, y, z) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), wood);
    m.scale.set(rx, ry, rz); m.position.set(x, y, z); return m;
  };
  g.add(ell(0.215, 0.20, 0.062, 0, 0.33, 0));     // 下琴肩
  g.add(ell(0.125, 0.10, 0.058, 0, 0.53, 0));     // C 腰
  g.add(ell(0.170, 0.15, 0.060, 0, 0.67, 0));     // 上琴肩
  g.add(fbox(0.035, 0.42, 0.040, wood, 0, 0.99, 0, 0.01));          // 琴颈
  g.add(fbox(0.050, 0.66, 0.018, dark, 0, 0.85, 0.052, 0.005));     // 指板
  g.add(fbox(0.052, 0.12, 0.040, wood, 0, 1.24, -0.004, 0.01));     // 琴头
  const scroll = new THREE.Mesh(new THREE.SphereGeometry(0.036, 14, 10), wood); scroll.position.set(0, 1.325, -0.01); g.add(scroll);
  for (const sx of [-1, 1]) g.add(fbox(0.034, 0.014, 0.014, dark, sx * 0.04, 1.25, 0, 0.004));   // 弦轴
  g.add(fbox(0.085, 0.02, 0.012, dark, 0, 0.42, 0.070, 0.003));     // 琴马
  g.add(fbox(0.050, 0.14, 0.010, dark, 0, 0.24, 0.066, 0.004));     // 系弦板
  for (let i = 0; i < 4; i++) g.add(fbox(0.002, 0.90, 0.002, str, (i - 1.5) * 0.011, 0.74, 0.082, 0.0005));   // 四根弦
  const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.004, 0.16, 8), dark); pin.position.set(0, 0.08, 0); g.add(pin);   // 尾钉
  return g;
}

function pianoProp(D = 0.38) {
  const g = new THREE.Group();
  const blk = new THREE.MeshPhongMaterial({ color: 0x1b1d22, shininess: 75 });
  const white = new THREE.MeshPhongMaterial({ color: 0xf7f6f2, shininess: 45 });
  const keyBk = new THREE.MeshPhongMaterial({ color: 0x141519, shininess: 60 });
  const W = 0.60, H = 1.12, keyY = 0.75;
  const oct = Math.max(1, Math.round(D / 0.38));
  g.add(fbox(W, H - keyY, D, blk, 0, keyY + (H - keyY) / 2, 0, 0.02));         // 键面以上箱体
  g.add(fbox(W, keyY, D * 0.95, blk, 0, keyY / 2, 0, 0.02));                     // 键面以下箱体（原 keyY-0.07 在键面下留 7cm 缝，看着上下分体）
  g.add(fbox(0.10, 0.024, D * 0.88, white, W / 2 + 0.038, keyY + 0.012, 0, 0.007));  // 白键条
  for (let i = 0; i < 7 * oct + 1; i++) {                                                // 黑键
    if (i % 7 === 2 || i % 7 === 6) continue;
    g.add(fbox(0.055, 0.016, 0.013, keyBk, W / 2 + 0.022, keyY + 0.032, -D * 0.34 + i * (D * 0.68 / (7 * oct)), 0.003));
  }
  g.add(fbox(W + 0.03, 0.03, D + 0.03, blk, 0, H + 0.015, 0, 0.012));          // 顶盖
  const stand = fbox(0.028, 0.30, D * 0.68, blk, -0.10, H + 0.17, 0, 0.01);    // 谱架
  stand.rotation.z = 0.24; g.add(stand);
  return g;
}

// 床头柜：两层抽屉；lamp=true 时顶上放一盏暖光台灯。正面朝 +z
function nightstand(lamp = true) {
  const g = new THREE.Group(), wd = MAT.wood(), dr = new THREE.MeshPhongMaterial({ color: 0xcdb9a4, shininess: 14 }), pp = MAT.pipe();
  g.add(fbox(0.42, 0.5, 0.38, wd, 0, 0.25, 0, 0.02));
  for (const y of [0.15, 0.36]) {
    g.add(fbox(0.35, 0.17, 0.012, dr, 0, y, 0.19, 0.006));
    const k = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), pp); k.position.set(0, y, 0.2); g.add(k);
  }
  if (lamp) {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.025, 18), pp); base.position.y = 0.5125; g.add(base);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.2), pp); stem.position.y = 0.625; g.add(stem);
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.12, 0.15, 20, 1, true), new THREE.MeshPhongMaterial({ color: 0xfff1d6, side: THREE.DoubleSide, emissive: 0x4a3a1c }));
    shade.position.y = 0.76; g.add(shade);
  }
  return g;
}
// 衣柜：两扇门 + 把手。正面朝 +z
function wardrobe(w = 1.1, h = 2.0, d = 0.55) {
  const g = new THREE.Group(), wd = new THREE.MeshPhongMaterial({ color: 0xd9c7b2, shininess: 14 }), dk = new THREE.MeshPhongMaterial({ color: 0xa88f76, shininess: 10 }), pp = MAT.pipe();
  g.add(fbox(w, h, d, wd, 0, h / 2, 0, 0.02));
  g.add(fbox(0.012, h - 0.12, 0.012, dk, 0, h / 2, d / 2 + 0.002));
  for (const s of [-1, 1]) { g.add(fbox(0.02, 0.2, 0.02, pp, s * 0.05, h * 0.5, d / 2 + 0.012)); g.add(fbox(w / 2 - 0.08, h - 0.16, 0.006, dk, s * (w / 4), h / 2, d / 2 + 0.001)); }
  return g;
}
// 带窗的墙：浅暖色墙面 + 白窗框 + 发亮玻璃 + 两侧窗帘。正面朝 +z，窗在墙中央
function windowWall(w = 4.6, h = 2.6) {
  const g = new THREE.Group();
  const wall = new THREE.MeshPhongMaterial({ color: 0xf3ede4, shininess: 4 }), frame = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 20 });
  const glass = new THREE.MeshPhongMaterial({ color: 0xdcecf8, emissive: 0x5c7a92, shininess: 60 }), cur = new THREE.MeshPhongMaterial({ color: 0xf2c4ce, shininess: 4 });
  g.add(fbox(w, h, 0.06, wall, 0, h / 2, 0));
  const fw = 1.5, fh = 1.3, fy = 1.45;
  g.add(fbox(fw, fh, 0.075, frame, 0, fy, 0.012, 0.01));
  g.add(fbox(fw - 0.12, fh - 0.12, 0.08, glass, 0, fy, 0.016));
  g.add(fbox(0.035, fh - 0.12, 0.09, frame, 0, fy, 0.02), fbox(fw - 0.12, 0.035, 0.09, frame, 0, fy, 0.02));
  g.add(fbox(fw + 0.2, 0.05, 0.1, frame, 0, fy + fh / 2 + 0.07, 0.05));
  for (const s of [-1, 1]) g.add(fbox(0.34, 1.65, 0.1, cur, s * (fw / 2 + 0.13), fy + 0.02, 0.07, 0.03));
  return g;
}
// ---- 户外街景（打伞姿势改户外用）：路沿石、行道树、长椅、消防栓、路灯、人行道砖。原点在物件底部中心。 ----
function curbstone(w = 1.1) {
  const g = new THREE.Group(), mat = new THREE.MeshPhongMaterial({ color: 0xcfc9c0, shininess: 8 });
  g.add(fbox(w, 0.15, 0.3, mat, 0, 0.075, 0, 0.012));            // 竖面
  g.add(fbox(w + 0.06, 0.04, 0.34, mat, 0, 0.155, 0, 0.008));     // 顶面收边
  return g;
}
function tree(seed = 3) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 1.1, 10), new THREE.MeshPhongMaterial({ color: 0x7d6248, shininess: 5 }));
  trunk.position.y = 0.55; g.add(trunk);
  const leaf = new THREE.MeshPhongMaterial({ color: 0x4e7d4e, shininess: 6 });
  const r = rng(seed);
  [[0, 1.75, 0, 0.42], [0.24, 1.5, 0.12, 0.26], [-0.22, 1.56, -0.1, 0.28], [0.05, 1.95, -0.05, 0.22], [-0.12, 1.4, 0.2, 0.2]].forEach(([x, y, z, rad]) => {
    const s = new THREE.Mesh(new THREE.SphereGeometry(rad * (0.9 + r() * 0.2), 12, 9), leaf);
    s.position.set(x, y, z); s.scale.y = 0.92; g.add(s);
  });
  return g;
}
function parkBench() {
  const g = new THREE.Group(), wd = MAT.wood(), pp = MAT.pipe();
  for (const s of [-0.62, 0.62]) g.add(fbox(0.06, 0.44, 0.5, pp, s, 0.22, 0, 0.012));       // 两侧铸铁腿板
  for (let i = 0; i < 5; i++) g.add(fbox(1.4, 0.035, 0.11, wd, 0, 0.45, -0.17 + i * 0.085, 0.01));   // 座板
  for (let i = 0; i < 3; i++) g.add(fbox(1.4, 0.11, 0.035, wd, 0, 0.56 + i * 0.14, 0.21, 0.01));     // 靠背板
  return g;
}
function hydrant() {
  const g = new THREE.Group(), red = new THREE.MeshPhongMaterial({ color: 0xb8432f, shininess: 30 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.5, 14), red); body.position.y = 0.25; g.add(body);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 8), red); cap.position.y = 0.5; cap.scale.y = 0.55; g.add(cap);
  g.add(fbox(0.05, 0.05, 0.55, red, 0, 0.26, 0, 0.01));                                     // 侧接口横杆
  g.add(fbox(0.05, 0.24, 0.05, red, -0.09, 0.3, 0, 0.01), fbox(0.05, 0.24, 0.05, red, 0.09, 0.3, 0, 0.01));  // 左右阀帽
  return g;
}
function streetLamp() {
  const g = new THREE.Group(), pp = MAT.pipe();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, 3.1, 12), pp); pole.position.y = 1.55; g.add(pole);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.5, 10), pp); arm.rotation.z = Math.PI / 2; arm.position.set(0.18, 3.1, 0); g.add(arm);
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 0.1, 14), new THREE.MeshPhongMaterial({ color: 0x8d939c, shininess: 60, emissive: 0x2a2e38 }));
  head.position.set(0.42, 3.04, 0); g.add(head);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.08, 12), pp); base.position.y = 0.04; g.add(base);
  return g;
}
function sidewalk() {
  const g = new THREE.Group();
  const mat = new THREE.MeshPhongMaterial({ color: 0xc4c2bd, shininess: 3 });
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.06, 0.55), mat); pad.receiveShadow = true; g.add(pad);
  g.add(fbox(0.6, 0.05, 0.62, mat, 0, -0.026, 0.035, 0.006));       // 基座垫底，砖面只留上露
  return g;
}
const FURN = { bookshelf, chair, table, sofa, bed, pillow, rug, lamp, plant, nightstand, wardrobe, windowWall, curbstone, tree, parkBench, hydrant, streetLamp, sidewalk };
export function buildFurniture(spec) {
  const g = new THREE.Group();
  for (const it of spec.items) {
    const o = FURN[it.kind](...(it.args || []));
    o.position.set(...(it.at || [0, 0, 0])); o.rotation.y = it.ry || 0;
    g.add(o);
  }
  return g;
}

