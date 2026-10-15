// 熊兔模拟器（原身高差模拟器）：界面 + 相机 + 状态 + 导出。纯前端。
import * as THREE from 'three';
import { dims, fk, cloneState, lerpState, blank, EAR_RABBIT } from './model.js';
import { extent } from './poseutil.js';
import { builders } from './poses.js';
import { makeRig, updateRig, setRigColor, setRigFirstPerson, makeProp, makeShirt, updateShirt, makeRuler, makePrints } from './render.js';

// ---------------- 配置 ----------------
const H_MIN = 145, H_MAX = 200, DIFF_MAX = 35;
const POSES = [
  ['stand', '并排站立'], ['holdHands', '牵手'], ['shoulderLean', '靠肩'], ['headPat', '摸头杀'],
  ['foreheadTouch', '额头贴贴'], ['foreheadKiss', '吻额头'], ['kneelEye', '蹲下平视'], ['hug', '面对面拥抱'],
  ['backHug', '背后环抱'], ['wallPin', '壁咚'], ['piggyback', '背背'], ['lift', '拦腰抱起'],
  ['lying', '躺在一起'], ['scarf', '共戴围巾'],
  ['princess', '公主抱'], ['koala', '树袋熊抱'], ['lapSit', '坐腿上'], ['lapHug', '坐他怀里'],
  ['straddle', '面对面跨坐'], ['bedPin', '床咚'], ['shirt', '穿他的衬衫'], ['kiss', '接吻'],
  ['compareHand', '比手大小'], ['compareFoot', '比脚大小'],
  ['selfie', '自拍'], ['umbrella', '打伞'], ['piano', '弹钢琴'], ['benchSit', '并排坐'], ['kneeLift', '托膝抱'], ['lapPillow', '枕大腿'],
  ['cradleCarry', '兜腿抱'], ['propose', '求婚'], ['feastSeduce', '宴色诱惑'], ['chenhun', '阅尽晨昏'], ['twilight', '暮光之境'], ['comparePawF', '比前掌印'], ['comparePawH', '比后掌印'],
  // box（纸箱）已从列表撤下：src/poses_v2_box.js 保留，加回只需在 POSES 里补 ['box','纸箱']
];
// 分组（手机上 22 个姿势一条滑太长）：只影响列表显示，链接里的姿势编号不变
const GROUPS = [
  ['all', '全部', null],
  ['daily', '日常', ['stand', 'holdHands', 'shoulderLean', 'headPat', 'scarf', 'shirt', 'kneelEye', 'compareHand', 'compareFoot', 'comparePawF', 'comparePawH', 'selfie', 'umbrella']],
  ['close', '贴贴', ['foreheadTouch', 'foreheadKiss', 'kiss', 'hug', 'backHug', 'wallPin', 'propose', 'feastSeduce', 'chenhun', 'twilight']],
  ['carry', '抱起', ['piggyback', 'lift', 'princess', 'koala', 'kneeLift', 'cradleCarry']],
  ['sit', '坐·躺', ['lapSit', 'lapHug', 'straddle', 'lying', 'bedPin', 'piano', 'benchSit', 'lapPillow']],
];
let groupSel = 'all';
// 姿势卡片图标（emoji，零资源）：只用于列表显示
const POSE_ICON = {
  stand: '🧍', holdHands: '🤝', shoulderLean: '💞', headPat: '🫳', foreheadTouch: '🥺', foreheadKiss: '😚', kneelEye: '🧎',
  hug: '🫂', backHug: '🤗', wallPin: '🧱', piggyback: '🎒', lift: '🙌', lying: '🛏️', scarf: '🧣', princess: '👸', koala: '🐨',
  lapSit: '🪑', lapHug: '🛋️', straddle: '💺', bedPin: '🌙', shirt: '👔', kiss: '💋', compareHand: '✋', compareFoot: '🦶', comparePawF: '🐾', comparePawH: '👣',
  selfie: '🤳', umbrella: '☂️', piano: '🎹', benchSit: '🪑', kneeLift: '🎈', lapPillow: '😴', cradleCarry: '🧸', propose: '💍', feastSeduce: '🍷', chenhun: '📖', twilight: '🌆', box: '📦',
};
const PALETTE = [
  ['咖啡', '#a77b5a'], ['粉白', '#f9dde5'], ['粉', '#f6a5c0'], ['蓝', '#8ec5ff'], ['紫', '#c3a6ff'], ['奶白', '#f3ecdf'], ['灰', '#b8bcc4'],
  ['黑', '#3a3a40'], ['薄荷', '#9fe0c8'], ['黄', '#ffe08a'], ['橙', '#ffb27a'], ['红', '#ee7a86'],
];
const EARS = [['none', '无'], ['bear', '熊耳'], ['rabbit', '兔耳']];
const VIEWS = [['3rd', '第三人称'], ['A', 'A 视角'], ['B', 'B 视角']];
// 身高差文案：[上限(含), 文案]，{d} 代入实际差值
const QUOTES = [
  [10, '只差一点，牵手的距离刚好。'],
  [20, '低头刚好看见你的发旋。'],
  [30, '身高差 {d}cm，正好是我低头看你的距离。'],
  [Infinity, '再高一点也没关系，你踮脚我弯腰。'],
];
const DEFAULTS = {
  A: { name: '小熊', h: 186, g: 'm', c: '#a77b5a', e: 'bear', hand: 19, foot: 28.3 },      // 熊：咖啡色；手/脚长 cm（可改）
  B: { name: '小兔', h: 163, g: 'f', c: '#f9dde5', e: 'rabbit', hand: 17, foot: 23.5 }, // 兔：粉白；女生默认：手17、脚23.5
  pose: 0, view: '3rd',
};
const LS_KEY = 'height-sim:v1';

// ---------------- 状态 + 持久化 ----------------
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const HEX = /^#?[0-9a-fA-F]{6}$/;
function sanitizePerson(p, def) {
  const h = Number(p.h);
  const hand = Number(p.hand), foot = Number(p.foot);
  return {
    name: String(p.name ?? def.name).slice(0, 12) || def.name,
    h: Number.isFinite(h) ? clamp(Math.round(h * 10) / 10, H_MIN, H_MAX) : def.h,
    g: p.g === 'f' || p.g === 'm' ? p.g : def.g,
    c: HEX.test(p.c || '') ? '#' + String(p.c).replace('#', '').toLowerCase() : def.c,
    e: ['none', 'bear', 'rabbit'].includes(p.e) ? p.e : def.e,
    hand: Number.isFinite(hand) ? clamp(Math.round(hand * 10) / 10, 5, 30) : def.hand,   // 手长 5~30cm
    foot: Number.isFinite(foot) ? clamp(Math.round(foot * 10) / 10, 8, 45) : def.foot,   // 脚长 8~45cm
  };
}
function limitDiff(st, editedKey) {
  const o = editedKey === 'A' ? 'B' : 'A';
  const diff = st[editedKey].h - st[o].h;
  if (Math.abs(diff) <= DIFF_MAX) return false;
  st[editedKey].h = Math.round((st[o].h + Math.sign(diff) * DIFF_MAX) * 10) / 10;
  return true;
}
function encode(st) {
  const q = new URLSearchParams();
  for (const k of ['A', 'B']) {
    const p = st[k], x = k.toLowerCase();
    q.set(x + 'n', p.name); q.set(x + 'h', String(p.h)); q.set(x + 'g', p.g); q.set(x + 'c', p.c.slice(1)); q.set(x + 'e', p.e);
    q.set(x + 'hd', String(p.hand)); q.set(x + 'fd', String(p.foot));   // 手/脚长一并存进链接
  }
  q.set('p', String(st.pose)); q.set('v', st.view);
  return q.toString();
}
function decode(str) {
  const q = new URLSearchParams(str);
  if (![...q.keys()].length) return null;
  const st = { A: {}, B: {} };
  for (const k of ['A', 'B']) {
    const x = k.toLowerCase();
    st[k] = sanitizePerson({ name: q.get(x + 'n') ?? undefined, h: q.get(x + 'h'), g: q.get(x + 'g'), c: q.get(x + 'c'), e: q.get(x + 'e'), hand: q.get(x + 'hd'), foot: q.get(x + 'fd') }, DEFAULTS[k]);
  }
  const p = parseInt(q.get('p'), 10);
  st.pose = Number.isInteger(p) && p >= 0 && p < POSES.length ? p : 0;
  st.view = ['3rd', 'A', 'B'].includes(q.get('v')) ? q.get('v') : '3rd';
  limitDiff(st, 'A');
  return st;
}
function loadState() {
  try { const h = decode(location.hash.slice(1)); if (h) return h; } catch (e) { /* 忽略损坏的链接 */ }
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const s = decode(raw);
      if (s) {
        // 旧版默认色（蓝/粉）自动换成新默认（咖啡/粉白）；用户自己挑过的颜色不动
        const OLD = { A: '#8ec5ff', B: '#f6a5c0' };
        for (const k of ['A', 'B']) if (s[k].c === OLD[k]) s[k].c = DEFAULTS[k].c;
        return s;
      }
    }
  } catch (e) { /* 隐私模式 */ }
  return JSON.parse(JSON.stringify(DEFAULTS));
}
const state = loadState();
function persist() {
  const s = encode(state);
  try { localStorage.setItem(LS_KEY, s); } catch (e) { /* ignore */ }
  try { history.replaceState(null, '', '#' + s); } catch (e) { /* file:// 某些环境 */ }
}

// ---------------- DOM ----------------
const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v);
  }
  kids.forEach((c) => n.append(c));
  return n;
};
const stage = $('#stage');
const labelEls = { A: $('#labelA'), B: $('#labelB') };
let toastTimer = 0;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------------- three 场景 ----------------
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff);
const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 200);
scene.add(new THREE.HemisphereLight(0xffffff, 0xb8bcc8, 1.9));
const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(2.2, 4.5, 3.2); sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.5, far: 12 });
sun.shadow.bias = -0.0008;
scene.add(sun);
const grid = new THREE.GridHelper(40, 160, 0xdcdfe5, 0xebedf1);
grid.position.y = 0.0006;
scene.add(grid);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.16 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
// ---- 户外雨天（打伞姿势）：灰蓝天光、雾、雨丝。伞下无雨由雨滴着色器跳过伞罩圆柱内的水滴实现 ----
const WEATHER = { group: null, on: false };
function weatherFor(poseName) {
  const want = poseName === 'umbrella';
  if (want === WEATHER.on) return;
  WEATHER.on = want;
  if (!want) {
    if (WEATHER.group) { scene.remove(WEATHER.group); WEATHER.group = null; }
    scene.background = new THREE.Color(0xffffff); scene.fog = null;
    return;
  }
  scene.background = new THREE.Color(0x8fa0b4);
  scene.fog = new THREE.Fog(0x8fa0b4, 6, 18);
  const g = new THREE.Group();
  const N = 800, span = 9, top = 6.5;
  // 每滴两个端点共享同一基点（position 相同），aEnd=0 下端 / 1 上端，上端由着色器沿雨向偏移——回绕取模时两端同步，不会拉出贯穿屏的长线
  const pos = new Float32Array(N * 2 * 3), seed = new Float32Array(N * 2), end = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    const x = (Math.random() - 0.5) * span, y = Math.random() * top, z = (Math.random() - 0.5) * span * 0.8 - 0.6, s = Math.random();
    for (const e of [0, 1]) {
      const k = i * 2 + e;
      pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
      seed[k] = s; end[k] = e;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: { value: 0 }, uUmb: { value: new THREE.Vector3(0, -10, 0) }, uUmbR: { value: 0 } },
    vertexShader: `
      attribute float aSeed; attribute float aEnd;
      uniform float uTime; uniform vec3 uUmb; uniform float uUmbR;
      varying float vAlpha;
      void main() {
        vec3 p = position;
        float speed = 5.5 + aSeed * 2.5;
        p.y = mod(p.y - uTime * speed, 6.5);
        p += vec3(-0.05, 0.17, 0.0) * aEnd;                  // 上端沿风向斜着偏移 → 雨线带一点斜度
        vAlpha = mix(0.35, 0.75, aSeed);
        vAlpha *= smoothstep(0.0, 0.3, p.y) * smoothstep(6.5, 5.8, p.y);   // 近地/顶上淡出，回绕不突兀
        if (uUmbR > 0.0) {
          vec2 d = p.xz - uUmb.xz;
          float inUmb = 1.0 - step(uUmbR, length(d));
          vAlpha *= (1.0 - inUmb * step(uUmb.y, p.y) * 0.9);              // 伞罩圆柱内、伞面高度以上：雨基本隐去
        }
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      varying float vAlpha;
      void main() {
        gl_FragColor = vec4(0.90, 0.94, 1.0, vAlpha * 0.8);   // 亮白偏蓝的雨线，压暗的天上看得清
      }`,
  });
  const pts = new THREE.LineSegments(geo, mat);
  pts.frustumCulled = false;
  g.add(pts);
  WEATHER.group = g; scene.add(g);
}
const propsGroup = new THREE.Group();
const rulerGroup = makeRuler(); scene.add(rulerGroup); scene.add(propsGroup);

// ---------------- 小人与姿势 ----------------
const rigs = { A: null, B: null };
const cur = { A: blank(), B: blank() };      // 当前（显示中）状态
const from = { A: blank(), B: blank() };
const to = { A: blank(), B: blank() };
let tAnim = 1;                                // 0..1，1=已到位
const ANIM_SEC = 0.5;
let curProps = [];
let propExt = null;     // 道具（伞）占的范围：取景要算进去，否则伞面被裁
let printsFit = null;   // 比手/比脚的取景框（有值时隐藏小人）
let shirtOn = null;   // { who: 'A'|'B', obj } 换装：S 穿 T 的衬衫
let selfieRT = null;  // 自拍画中画（照 couple-pic 的 RTT 方案）：{ rt, cam, screen:{anchor,mesh} }
let propMats = [];
let roleOf = { A: 'T', B: 'S' };
let dimsOf = {};
let stdDims = {};      // 标准体型（求姿势用）
let bodyOv = null;     // 当前姿势自带的体型 { T, S }（背背=参考体型、无脚）
let centerSm = new THREE.Vector3(0, 0.9, 0), distSm = 3.2, fitSm = null;
const cache = new Map();

function currentDims() {
  const hA = state.A.h, hB = state.B.h;
  const aTall = hA >= hB;
  roleOf = { A: aTall ? 'T' : 'S', B: aTall ? 'S' : 'T' };
  stdDims = {
    A: dims(hA / 100, state.A.g, state.A.e),
    B: dims(hB / 100, state.B.g, state.B.e),
  };
  dimsOf = bodyOv
    ? { A: roleOf.A === 'T' ? bodyOv.T : bodyOv.S, B: roleOf.B === 'T' ? bodyOv.T : bodyOv.S }
    : stdDims;
  return { dT: aTall ? stdDims.A : stdDims.B, dS: aTall ? stdDims.B : stdDims.A };
}
function poseKey(idx) {
  const { dT, dS } = currentDims();
  return [POSES[idx][0], dT.h, dT.gender, dT.ears, dS.h, dS.gender, dS.ears].join('|');
}
function computePose(idx) {
  const { dT, dS } = currentDims();
  const key = poseKey(idx);
  if (!cache.has(key)) {
    if (cache.size > 40) cache.delete(cache.keys().next().value);
    cache.set(key, builders[POSES[idx][0]](dT, dS));
  }
  return cache.get(key);
}
function rebuildRigs() {
  for (const k of ['A', 'B']) {
    if (rigs[k]) { scene.remove(rigs[k].group); rigs[k].mat.dispose(); }
    rigs[k] = makeRig(dimsOf[k], state[k].c);
    scene.add(rigs[k].group);
  }
}
// 重建道具与掌印（不碰人物姿势）
function rebuildProps(r) {
  propsGroup.clear(); propMats = []; propExt = null;
  if (selfieRT) selfieRT.screen = null;
  for (const spec of r.props || []) {
    if (spec.type === 'umbrella') { const [x, y, z] = spec.at, top = y + spec.len + spec.r * 0.4 + 0.08; propExt = { lo: [x - spec.r, y - 0.1, z - spec.r], hi: [x + spec.r, top, z + spec.r] }; }
    const g = makeProp(spec); g.userData.spec = spec; propsGroup.add(g);
    let pg = g.userData.camAnchor ? g : null;           // phoneProp 被包了一层外壳，向下扫一层找镜头锚点
    if (!pg) for (const c of g.children) if (c.userData && c.userData.camAnchor) { pg = c; break; }
    if (pg) {
      // 自拍手机：把屏幕换成 RTT 画中画贴图（镜像=自拍预览惯例，照 couple-pic）
      if (!selfieRT) {
        const rt = new THREE.WebGLRenderTarget(768, 432); rt.texture.colorSpace = THREE.SRGBColorSpace;
        rt.texture.wrapS = THREE.RepeatWrapping; rt.texture.repeat.x = -1; rt.texture.offset.x = 1;
        selfieRT = { rt, cam: new THREE.PerspectiveCamera(65, 768 / 432, 0.02, 30), screen: null };
      }
      selfieRT.screen = { anchor: pg.userData.camAnchor, mesh: pg.userData.screenMesh };
      pg.userData.screenMesh.material = new THREE.MeshBasicMaterial({ map: selfieRT.rt.texture });
    }
    for (const m of g.userData.fadeMats || []) { propMats.push([m, m.opacity]); }
  }
  // 比手 / 比脚：只画掌印、脚印，隐藏两个小人和头顶标签
  printsFit = null;
  if (r.prints) {
    // 手长/脚长用每个人自己的数值（面板可改；默认女生手17/脚23.5），不再按身高比例推
    const isFoot = r.prints === 'foot' || r.prints === 'pawH', isPaw = r.prints === 'pawF' || r.prints === 'pawH';
    const items = ['A', 'B'].map((k) => ({ k, len: (isFoot ? state[k].foot : state[k].hand) / 100, cm: isFoot ? state[k].foot : state[k].hand, sp: state[k].e === 'rabbit' ? 'rabbit' : 'bear' }))
      .sort((a, b) => b.len - a.len)
      .map((it) => ({ k: it.k, len: it.len, species: it.sp, color: it.k === 'B' ? '#f0a9bd' : '#a77b5a', textColor: it.k === 'B' ? '#d6457a' : '#7a5236',   // 颜色跟人走：兔固定粉、熊固定棕（不再按谁更长换色）
        label: `${state[it.k].name}  ${isPaw ? (it.sp === 'rabbit' ? '兔' : '熊') + (r.prints === 'pawF' ? '前' : '后') + (it.sp === 'rabbit' ? '爪' : '掌') : (isFoot ? '脚长' : '手长')} ${it.cm.toFixed(1)}cm` }));
    const pr = makePrints(r.prints, items); propsGroup.add(pr.group); printsFit = pr.fit;
    for (const m of pr.fadeMats) propMats.push([m, m.opacity]);
  }
  for (const k of ['A', 'B']) if (rigs[k]) rigs[k].group.visible = !printsFit;
  rulerGroup.visible = !printsFit;
  grid.visible = !printsFit;                         // 同时藏掉地面网格线，背景保持干净                  // 掌印/脚印背景保持干净，不画身高刻度线
}
function applyTargets({ snap }) {
  const r = computePose(state.pose);
  // 姿势自带体型：渲染与 FK 都换成它的尺寸，必要时重建小人（有脚 <-> 无脚）
  bodyOv = r.bodyT ? { T: r.bodyT, S: r.bodyS } : null;
  currentDims();
  if (['A', 'B'].some((k) => rigs[k] && !!rigs[k].d.noFeet !== !!dimsOf[k].noFeet)) { rebuildRigs(); updateColors(); updateFirstPerson(); }
  for (const k of ['A', 'B']) {
    from[k] = cloneState(cur[k]);
    to[k] = cloneState(roleOf[k] === 'T' ? r.T : r.S);
    if (snap) cur[k] = cloneState(to[k]);
  }
  tAnim = snap ? 1 : 0;
  rebuildProps(r);
  // 换装
  if (shirtOn) { scene.remove(shirtOn.obj.group); shirtOn.obj.mat.dispose(); shirtOn = null; }
  if (r.outfit && r.outfit.S === 'shirt') {
    const who = roleOf.A === 'S' ? 'A' : 'B', owner = who === 'A' ? 'B' : 'A';
    shirtOn = { who, owner, obj: makeShirt(state[owner].c) }; scene.add(shirtOn.obj.group);   // 颜色跟熊（衬衫主人）保持一致
    propMats.push([shirtOn.obj.mat, shirtOn.obj.mat.opacity]);
  }
  camPreset.top = !!(r.cam && r.cam.top);
  camPreset.el = r.cam && r.cam.el != null ? r.cam.el : null;
  camPreset.topEl = r.cam && r.cam.topEl != null ? r.cam.topEl : null;
  fitSm = null;
}
function setPose(idx, { snap = false } = {}) {
  state.pose = idx; renderPoseChips(); renderInfo(); weatherFor(POSES[idx][0]);
  try { if (navigator.vibrate) navigator.vibrate(8); } catch (e) { /* 不支持就算了 */ }
  const go = () => { applyTargets({ snap }); persist(); $('#busy').classList.remove('show'); warmNeighbors(); };
  if (snap || cache.has(poseKey(idx))) { go(); return; }
  $('#busy').classList.add('show');
  requestAnimationFrame(() => setTimeout(go, 0));
}
// 空闲时预先算好相邻姿势，下次点就是瞬切
function warmNeighbors() {
  const idle = window.requestIdleCallback || ((f) => setTimeout(f, 200));
  const order = [state.pose + 1, state.pose - 1, state.pose + 2].filter((i) => i >= 0 && i < POSES.length);
  const step = () => { const i = order.shift(); if (i == null) return; if (!cache.has(poseKey(i))) computePose(i); idle(step); };
  idle(step);
}
function onDimsChanged() {
  bodyOv = null;   // 身高/性别变了，旧的姿势体型作废，applyTargets 会按新结果重设
  currentDims(); rebuildRigs();
  applyTargets({ snap: true });
  updateColors(); updateFirstPerson(); renderInfo(); persist();
}

// ---------------- 相机 ----------------
const cam = { az: 0, el: 0.16, zoom: 1, fpYaw: 0, fpPitch: 0 };
const camPreset = { top: false, el: null, topEl: null };
const elTarget = () => (camPreset.top ? (camPreset.topEl ?? 1.32) : camPreset.el != null ? Math.max(cam.el, camPreset.el) : cam.el);
let elSm = cam.el;
function fitPair(JA, JB) {
  let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  [JA, JB].forEach((J) => ['x', 'y', 'z'].forEach((ax, i) => { const [a, b] = extent(J, ax); lo[i] = Math.min(lo[i], a); hi[i] = Math.max(hi[i], b); }));
  return { c: new THREE.Vector3((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2), w: hi[0] - lo[0], h: hi[1] - lo[1], d: hi[2] - lo[2] };
}
function withProps(f) {
  if (!propExt) return f;
  const lo = [f.c.x - f.w / 2, f.c.y - f.h / 2, f.c.z - f.d / 2], hi = [f.c.x + f.w / 2, f.c.y + f.h / 2, f.c.z + f.d / 2];
  for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], propExt.lo[i]); hi[i] = Math.max(hi[i], propExt.hi[i]); }
  return { c: new THREE.Vector3((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2), w: hi[0] - lo[0], h: hi[1] - lo[1], d: hi[2] - lo[2] };
}
function frameCamera(dt) {
  const JA = fk(cur.A, dimsOf.A), JB = fk(cur.B, dimsOf.B);
  const view = state.view;
  const aspect = camera.aspect;
  if (view === '3rd') {
    camera.fov = 38; camera.near = 0.05; camera.updateProjectionMatrix();
    const f = printsFit || withProps(fitPair(JA, JB));
    const tanV = Math.tan((camera.fov * Math.PI) / 360), tanH = tanV * aspect;
    const top = camPreset.top;
    const pad = printsFit ? 0.05 : 0.28, padH = printsFit ? 0.06 : 0.34;
    const halfW = Math.max(f.w, top ? f.d : 0) * 0.5 + pad, halfH = (top ? Math.max(f.d, f.w * 0.3) : f.h) * 0.5 + padH;
    const dist = Math.max(halfH / tanV, halfW / tanH, printsFit ? 0.4 : 1.6) * (top ? 1.05 : 1.12);
    const tgt = f.c.clone(); if (!top) tgt.y = f.c.y + 0.03;
    if (!fitSm) { fitSm = true; centerSm.copy(tgt); distSm = dist; }
    const k = 1 - Math.exp(-dt * 7);
    centerSm.lerp(tgt, k); distSm += (dist - distSm) * k;
    elSm += (elTarget() - elSm) * (1 - Math.exp(-dt * 8));
    const d = distSm * cam.zoom;
    camera.position.set(
      centerSm.x + Math.sin(cam.az) * Math.cos(elSm) * d,
      Math.max(centerSm.y * (top ? 0 : 1) + Math.sin(elSm) * d + (top ? 0 : centerSm.y * 0), 0.12),
      centerSm.z + Math.cos(cam.az) * Math.cos(elSm) * d,
    );
    if (!top) camera.position.y = Math.max(centerSm.y + Math.sin(elSm) * d, 0.12);
    camera.up.set(0, 1, 0);
    camera.lookAt(centerSm);
  } else {
    camera.fov = 72; camera.updateProjectionMatrix();
    const self = view === 'A' ? JA : JB, other = view === 'A' ? JB : JA;
    const eye = self.headC.clone().add(new THREE.Vector3(0, 0, 0.7 * self.d.headR).applyQuaternion(self.Qh));
    // 贴脸姿势（壁咚/吻额头等）：镜头后撤并略抬，视线落在对方脸上，避免整屏被对方的头塞满
    const gap = eye.distanceTo(other.headC), rr = other.d.headR;
    const close = clamp((2.3 * rr - gap) / (1.3 * rr), 0, 1);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(self.Qh);
    eye.addScaledVector(fwd, -close * 1.15 * self.d.headR).y += close * 0.55 * self.d.headR;
    camera.near = 0.02; camera.updateProjectionMatrix();
    camera.position.copy(eye);
    camera.up.set(0, 1, 0);
    camera.lookAt(other.headC.clone().add(new THREE.Vector3(0, -close * 0.25 * rr, 0)));
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), cam.fpYaw);
    const q2 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), cam.fpPitch);
    camera.quaternion.premultiply(q).multiply(q2);
  }
}
function updateFirstPerson() {
  for (const k of ['A', 'B']) setRigFirstPerson(rigs[k], state.view === k);
  labelEls.A.style.visibility = state.view === 'A' ? 'hidden' : 'visible';
  labelEls.B.style.visibility = state.view === 'B' ? 'hidden' : 'visible';
}

// 拖拽 / 双指 / 滚轮
(() => {
  const ptrs = new Map(); let pinch0 = 0, zoom0 = 1;
  const cv = renderer.domElement;
  cv.style.touchAction = 'none';
  cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); zoom0 = cam.zoom; } });
  cv.addEventListener('pointermove', (e) => {
    const p = ptrs.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p[0], dy = e.clientY - p[1];
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 1) {
      if (state.view === '3rd') {
        cam.az -= dx * 0.008; cam.el = clamp(cam.el + dy * 0.006, -0.05, 1.4); if (!camPreset.top) elSm = cam.el;
      }
      else { cam.fpYaw = clamp(cam.fpYaw - dx * 0.006, -1.4, 1.4); cam.fpPitch = clamp(cam.fpPitch - dy * 0.006, -1.0, 1.0); }
    } else if (ptrs.size === 2 && state.view === '3rd') {
      const [a, b] = [...ptrs.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch0 > 0) cam.zoom = clamp(zoom0 * (pinch0 / d), 0.45, 2.2);
    }
  });
  const up = (e) => { ptrs.delete(e.pointerId); };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  let lastTap = 0;
  cv.addEventListener('pointerup', (e) => { const t = performance.now(); if (t - lastTap < 300 && ptrs.size === 0) { cam.az = 0; cam.el = 0.16; cam.zoom = 1; cam.fpYaw = 0; cam.fpPitch = 0; } lastTap = t; });
  cv.addEventListener('wheel', (e) => { if (state.view !== '3rd') return; e.preventDefault(); cam.zoom = clamp(cam.zoom * (1 + Math.sign(e.deltaY) * 0.08), 0.45, 2.2); }, { passive: false });
})();

// ---------------- 标签 / 信息 ----------------
const tmpV = new THREE.Vector3();
function labelText(k) { const p = state[k]; return `${p.name} (${p.h.toFixed(p.h % 1 ? 1 : 0)}cm)`; }
function labelScreen(k, J) {
  tmpV.copy(J.headC); tmpV.y += J.d.headR * 1.0 + (J.d.ears === 'rabbit' ? EAR_RABBIT * J.d.headR * 0.95 : J.d.ears === 'bear' ? 0.6 * J.d.headR : 0) + 0.06;
  tmpV.project(camera);
  return { x: (tmpV.x * 0.5 + 0.5) * renderer.domElement.clientWidth, y: (-tmpV.y * 0.5 + 0.5) * renderer.domElement.clientHeight, behind: tmpV.z > 1 };
}
function updateLabels() {
  if (printsFit) { labelEls.A.style.opacity = '0'; labelEls.B.style.opacity = '0'; return; }
  const JA = fk(cur.A, dimsOf.A), JB = fk(cur.B, dimsOf.B);
  for (const [k, J] of [['A', JA], ['B', JB]]) {
    const s = labelScreen(k, J), e = labelEls[k];
    e.textContent = labelText(k);
    e.style.transform = `translate(-50%,-100%) translate(${s.x.toFixed(1)}px,${s.y.toFixed(1)}px)`;
    e.style.opacity = s.behind ? '0' : '1';
    labelPos[k] = s;
  }
  const a = labelPos.A, c = labelPos.B;
  if (a && c && Math.abs(a.x - c.x) < 120 && Math.abs(a.y - c.y) < 28) {
    const low = a.y > c.y ? 'A' : 'B', p = labelPos[low];
    labelEls[low].style.transform = `translate(-50%,-100%) translate(${p.x.toFixed(1)}px,${(Math.max(a.y, c.y) + 30).toFixed(1)}px)`;
  }
}
const labelPos = {};
function diffCm() { return Math.abs(state.A.h - state.B.h); }
function quoteFor(d) { const r = Math.round(d); return QUOTES.find(([max]) => r <= max)[1].replace('{d}', String(Number.isInteger(d) ? d : d.toFixed(1))); }

// CAPTION-BEGIN（分享文案：每个姿势一句；占位 {a}{b}=两人名字，{ha}{hb}=两人身高；话题标签由 captionFor 统一补在末尾）
const CAPTION_TAG = '#熊兔身高差模拟器';
const CAPTION_FALLBACK = '{a}({ha}cm)和{b}({hb}cm)的身高差刚刚好';
const CAPTION = {
  stand: '{a}({ha}cm)和{b}({hb}cm)并排站好啦',
  holdHands: '{a}({ha}cm)和{b}({hb}cm)牵着手走啦',
  shoulderLean: '{a}({ha}cm)和{b}({hb}cm)靠肩歇一会',
  headPat: '{a}({ha}cm)和{b}({hb}cm)摸头杀成功',
  foreheadTouch: '{a}({ha}cm)和{b}({hb}cm)额头贴贴',
  foreheadKiss: '{a}({ha}cm)和{b}({hb}cm)亲了下额头',
  kneelEye: '{a}({ha}cm)和{b}({hb}cm)蹲下来平视',
  hug: '{a}({ha}cm)和{b}({hb}cm)面对面抱抱',
  backHug: '{a}({ha}cm)和{b}({hb}cm)被背后环抱',
  wallPin: '{a}({ha}cm)和{b}({hb}cm)来了个壁咚',
  piggyback: '{a}({ha}cm)和{b}({hb}cm)背着走啦',
  lift: '{a}({ha}cm)和{b}({hb}cm)一把抱起来',
  lying: '{a}({ha}cm)和{b}({hb}cm)躺在一起',
  scarf: '{a}({ha}cm)和{b}({hb}cm)共戴一条围巾',
  princess: '{a}({ha}cm)和{b}({hb}cm)公主抱走起',
  koala: '{a}({ha}cm)和{b}({hb}cm)抱成树袋熊',
  lapSit: '{a}({ha}cm)和{b}({hb}cm)坐在腿上啦',
  lapHug: '{a}({ha}cm)和{b}({hb}cm)窝进怀里啦',
  straddle: '{a}({ha}cm)和{b}({hb}cm)面对面坐好',
  bedPin: '{a}({ha}cm)和{b}({hb}cm)床上咚一下',
  shirt: '{a}({ha}cm)和{b}({hb}cm)穿上了大衬衫',
  kiss: '{a}({ha}cm)和{b}({hb}cm)亲亲',
  compareHand: '{a}({ha}cm)和{b}({hb}cm)比比手大小',
  compareFoot: '{a}({ha}cm)和{b}({hb}cm)比比脚大小',
  comparePawF: '{a}({ha}cm)和{b}({hb}cm)比比前掌印',
  comparePawH: '{a}({ha}cm)和{b}({hb}cm)比比后掌印',
  selfie: '{a}({ha}cm)和{b}({hb}cm)一起自拍',
  umbrella: '{a}({ha}cm)和{b}({hb}cm)共撑一把伞',
  piano: '{a}({ha}cm)和{b}({hb}cm)四手联弹',
  benchSit: '{a}({ha}cm)和{b}({hb}cm)并排坐长椅',
  kneeLift: '{a}({ha}cm)和{b}({hb}cm)托着膝弯抱起',
  lapPillow: '{a}({ha}cm)和{b}({hb}cm)枕着大腿午睡',
  cradleCarry: '{a}({ha}cm)和{b}({hb}cm)兜着腿抱起',
  propose: '{a}({ha}cm)和{b}({hb}cm)单膝求婚啦',
};
const fmtH = (h) => (Number.isFinite(h) ? h.toFixed(h % 1 ? 1 : 0) : '?');
function captionFor(poseId, A, B) {
  const tpl = Object.prototype.hasOwnProperty.call(CAPTION, poseId) ? CAPTION[poseId] : CAPTION_FALLBACK;
  const vals = { a: A.name, b: B.name, ha: fmtH(A.h), hb: fmtH(B.h) };
  // 单次扫描替换：名字里即便含 {b} 或 $& 也不会被二次替换
  return tpl.replace(/\{(a|b|ha|hb)\}/g, (_, k) => vals[k]) + '\n' + CAPTION_TAG;
}
const shareCaption = () => captionFor((POSES[state.pose] || [])[0], state.A, state.B);
// CAPTION-END
function renderInfo() {
  const d = diffCm();
  $('#diffNum').textContent = Number.isInteger(d) ? String(d) : d.toFixed(1);
  // 比手/比脚和"低头看你"无关，不显示身高差文案
  $('#quote').textContent = /^compare/.test(POSES[state.pose][0]) ? '' : quoteFor(d);
  const tall = state.A.h >= state.B.h ? 'A' : 'B', short = tall === 'A' ? 'B' : 'A';
  const HINTS = { foreheadKiss: `${state[tall].name}低头，吻${state[short].name}的额头`, kneelEye: `${state[tall].name}单膝蹲下，扶着${state[short].name}的肩`, piggyback: `${state[tall].name}背着${state[short].name}`, lift: `${state[tall].name}抱起${state[short].name}`, headPat: `${state[tall].name}摸${state[short].name}的头`, wallPin: `${state[tall].name}撑墙，圈住${state[short].name}`, backHug: `${state[tall].name}从身后抱住${state[short].name}`,
    princess: `${state[tall].name}公主抱起${state[short].name}`, koala: `${state[short].name}挂在${state[tall].name}身上`,
    lapSit: `${state[short].name}坐在${state[tall].name}腿上`, lapHug: `${state[tall].name}从后面抱着${state[short].name}`,
    straddle: `${state[short].name}面对面坐在${state[tall].name}腿上`, bedPin: `${state[tall].name}把${state[short].name}困在床上`,
    shirt: `${state[short].name}偷穿了${state[tall].name}的衬衫`, kiss: `${state[tall].name}低头吻住${state[short].name}`,
    compareHand: `手掌叠手掌，${state[tall].name}的手比${state[short].name}大一圈`, compareFoot: `脚印叠脚印，${state[tall].name}的脚比${state[short].name}长一截`,
    comparePawF: '前掌印叠前掌印，比比谁的大一圈', comparePawH: '后掌印叠后掌印，比比谁的长一截' };
  const hint = HINTS[POSES[state.pose][0]];
  $('#poseName').textContent = `${state.pose + 1}/${POSES.length}  ${POSES[state.pose][1]}${hint ? '：' + hint : ''}`;
}

// ---------------- 控件 ----------------
const swatchOwners = { A: [], B: [] };
function updateColors() {
  for (const k of ['A', 'B']) {
    if (rigs[k]) setRigColor(rigs[k], state[k].c);
    swatchOwners[k].forEach(([btn, hex]) => btn.setAttribute('aria-pressed', String(hex.toLowerCase() === state[k].c.toLowerCase())));
    const ci = $(`#color-${k}`); if (ci) ci.value = state[k].c;
  }
}
let dimsTimer = 0;
function scheduleDims() { clearTimeout(dimsTimer); dimsTimer = setTimeout(onDimsChanged, 90); }
function seg(items, value, onPick, label) {
  const wrap = el('div', { class: 'seg', role: 'group', 'aria-label': label });
  const btns = items.map(([v, t]) => {
    const b = el('button', { type: 'button', class: 'segbtn', text: t, 'data-v': v, 'aria-pressed': String(v === value) });
    b.addEventListener('click', () => { onPick(v); btns.forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.v === v))); });
    wrap.append(b); return b;
  });
  return wrap;
}
function personCard(k) {
  const p = state[k];
  const card = el('section', { class: 'card', 'aria-label': `${k} 的设置` });
  card.append(el('h3', { text: k === 'A' ? 'A' : 'B' }));
  const nameIn = el('input', { id: `name-${k}`, type: 'text', maxlength: '12', value: p.name, autocomplete: 'off' });
  nameIn.addEventListener('input', () => { state[k].name = nameIn.value.slice(0, 12) || DEFAULTS[k].name; persist(); });
  card.append(el('label', { for: `name-${k}`, text: '姓名' }), nameIn);
  card.append(el('div', { class: 'lbl', text: '性别' }), seg([['m', '男'], ['f', '女']], p.g, (v) => { state[k].g = v; scheduleDims(); }, `${k} 性别`));
  const hIn = el('input', { id: `h-${k}`, type: 'number', min: String(H_MIN), max: String(H_MAX), step: '0.1', inputmode: 'decimal', value: String(p.h) });
  const hRange = el('input', { id: `hr-${k}`, type: 'range', min: String(H_MIN), max: String(H_MAX), step: '0.5', value: String(p.h), 'aria-label': `${k} 身高滑块` });
  const setH = (raw, fromRange) => {
    const v = Number(raw); if (!Number.isFinite(v)) return;
    state[k].h = clamp(Math.round(v * 10) / 10, H_MIN, H_MAX);
    if (limitDiff(state, k)) toast(`身高差最大支持 ${DIFF_MAX}cm，已帮你调到上限`);
    hRange.value = String(state[k].h);
    if (!(fromRange === false)) { /* keep */ }
    syncHeights(); scheduleDims();
  };
  hIn.addEventListener('input', () => setH(hIn.value, false));
  hIn.addEventListener('change', () => { hIn.value = String(state[k].h); });
  hRange.addEventListener('input', () => { setH(hRange.value, true); hIn.value = String(state[k].h); });
  card.append(el('label', { for: `h-${k}`, text: '身高 (cm)' }), el('div', { class: 'hrow' }, hIn, hRange));
  // 手长 / 脚长（比手/比脚用，默认女生手17cm、脚23.5cm；男生按身高比例）
  const mkDim = (key, label, lo, hi) => {
    const inp = el('input', { id: `dim-${key}-${k}`, type: 'number', min: String(lo), max: String(hi), step: '0.1', inputmode: 'decimal', value: String(p[key]) });
    inp.addEventListener('input', () => {
      const v = Number(inp.value); if (!Number.isFinite(v)) return;
      state[k][key] = clamp(Math.round(v * 10) / 10, lo, hi); persist();
      if (/^compare/.test(POSES[state.pose][0])) scheduleDims();   // 正看着比手/比脚就实时刷新
    });
    inp.addEventListener('change', () => { inp.value = String(state[k][key]); });
    return el('label', { for: `dim-${key}-${k}`, text: label }, inp);
  };
  card.append(el('div', { class: 'lbl', text: '手长/脚长 (cm)，前/后掌印同用' }), el('div', { class: 'hrow two' }, mkDim('hand', '手长', 5, 30), mkDim('foot', '脚长', 8, 45)));
  card.append(el('div', { class: 'lbl', text: '颜色' }));
  const sw = el('div', { class: 'swatches', role: 'group', 'aria-label': `${k} 颜色` });
  PALETTE.forEach(([n, hex]) => {
    const b = el('button', { type: 'button', class: 'sw', 'aria-label': n, title: n, 'aria-pressed': 'false' });
    b.style.background = hex;
    b.addEventListener('click', () => { state[k].c = hex; updateColors(); persist(); });
    swatchOwners[k].push([b, hex]); sw.append(b);
  });
  const ci = el('input', { id: `color-${k}`, type: 'color', class: 'colorpick', value: p.c, 'aria-label': `${k} 自定义颜色` });
  ci.addEventListener('input', () => { state[k].c = ci.value; updateColors(); persist(); });
  sw.append(ci);
  card.append(sw);
  card.append(el('div', { class: 'lbl', text: '耳朵' }), seg(EARS, p.e, (v) => { state[k].e = v; scheduleDims(); }, `${k} 耳朵`));
  return card;
}
function syncHeights() {
  for (const k of ['A', 'B']) {
    const i = $(`#h-${k}`), r = $(`#hr-${k}`);
    if (i && document.activeElement !== i) i.value = String(state[k].h);
    if (r) r.value = String(state[k].h);
  }
  renderInfo();
}
function renderPoseChips() {
  const bar = $('#poses');
  if (!bar.childElementCount) {
    POSES.forEach(([id, name], i) => {
      const b = el('button', { type: 'button', class: 'pitem', 'data-i': String(i), title: name }, el('span', { class: 'ic', 'aria-hidden': 'true', text: POSE_ICON[id] || '•' }), el('span', { class: 'nm', text: name }));
      b.addEventListener('click', () => { if (state.pose !== i) setPose(i); });
      bar.append(b);
    });
  }
  const g = GROUPS.find((x) => x[0] === groupSel)[2];
  bar.querySelectorAll('.pitem').forEach((b) => { b.hidden = !!g && !g.includes(POSES[Number(b.dataset.i)][0]); });
  document.querySelectorAll('#groups .gbtn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.g === groupSel)));
  bar.querySelectorAll('.pitem').forEach((b) => {
    const on = Number(b.dataset.i) === state.pose;
    b.setAttribute('aria-pressed', String(on));
    if (on) { const r = b.getBoundingClientRect(), pr = bar.getBoundingClientRect(); if (r.top < pr.top || r.bottom > pr.bottom) b.scrollIntoView({ block: 'nearest' }); }
  });
  $('#poseCnt').textContent = `${state.pose + 1}/${POSES.length}`;
}
function initPoseBar() {
  const bar = $('#poses'), panel = $('#posePanel'), tg = $('#poseToggle');
  const setCollapse = (c) => { panel.classList.toggle('collapsed', c); tg.textContent = c ? '›' : '‹'; tg.setAttribute('aria-label', c ? '展开' : '收起'); localStorage.setItem('height-sim:posePanel', c ? '1' : '0'); };
  $('#poseHead').addEventListener('click', () => setCollapse(!panel.classList.contains('collapsed')));
  $('#poseHead').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCollapse(!panel.classList.contains('collapsed')); } });
  bar.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setPose(clamp(state.pose + (e.key === 'ArrowDown' ? 1 : -1), 0, POSES.length - 1)); }
  });
  // 手机上默认收起，不挡人；用户手动展开/收起过就按上次的选择
  const pc = localStorage.getItem('height-sim:posePanel');
  setCollapse(pc === null ? window.innerWidth < 600 : pc === '1');
}
function setView(v) {
  state.view = v; cam.fpYaw = 0; cam.fpPitch = 0;
  $('#viewBtn').textContent = VIEWS.find((x) => x[0] === v)[1].replace('第三人称', '视角：全景').replace(/^(A|B) 视角$/, '视角：$1');
  updateFirstPerson(); persist();
}

// ---------------- 导出 / 分享 ----------------
function wrapText(ctx, text, maxW) {
  const lines = []; let line = '';
  for (const ch of text) { const t = line + ch; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = ch; } else line = t; }
  if (line) lines.push(line); return lines;
}
function exportPng() {
  renderFrame(0);                                   // 同一任务内渲染并读取，避免缓冲被清空
  const src = renderer.domElement, W = src.width, H = src.height, s = W / src.clientWidth;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.drawImage(src, 0, 0);
  const JA = fk(cur.A, dimsOf.A), JB = fk(cur.B, dimsOf.B);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (state.view !== 'A' || true) {
    for (const [k, J] of [['A', JA], ['B', JB]]) {
      if (state.view === k) continue;
      const p = labelScreen(k, J); if (p.behind) continue;
      ctx.font = `600 ${15 * s}px "PingFang SC","Microsoft YaHei",sans-serif`;
      const t = labelText(k), w = ctx.measureText(t).width + 18 * s;
      ctx.fillStyle = 'rgba(255,255,255,.82)';
      ctx.beginPath(); ctx.roundRect(p.x * s - w / 2, p.y * s - 30 * s, w, 26 * s, 13 * s); ctx.fill();
      ctx.fillStyle = '#4b5060'; ctx.fillText(t, p.x * s, p.y * s - 17 * s);
    }
  }
  const d = diffCm(), dText = `身高差 ${Number.isInteger(d) ? d : d.toFixed(1)}cm`;
  ctx.fillStyle = '#3a3f4f'; ctx.font = `700 ${22 * s}px "PingFang SC","Microsoft YaHei",sans-serif`;
  ctx.fillText(dText, W / 2, H - 78 * s);
  ctx.fillStyle = '#7a8090'; ctx.font = `400 ${14 * s}px "PingFang SC","Microsoft YaHei",sans-serif`;
  wrapText(ctx, quoteFor(d), W - 48 * s).slice(0, 2).forEach((ln, i) => ctx.fillText(ln, W / 2, H - 46 * s + i * 20 * s));
  c.toBlob(async (blob) => {
    if (!blob) { toast('导出失败，换个浏览器试试'); return; }
    const file = new File([blob], `身高差-${state.A.h}-${state.B.h}.png`, { type: 'image/png' });
    try {
      if (/Mobi|Android/i.test(navigator.userAgent) && navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text: shareCaption() }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000); toast('已保存截图');
  }, 'image/png');
}
async function copyLink() {
  persist(); const text = `${shareCaption()}\n${location.href}`;   // 当前姿势的文案 + 话题标签 + 链接
  try { await navigator.clipboard.writeText(text); toast('文案和链接已复制'); return; } catch (e) { /* 回退 */ }
  const ta = el('textarea', { readonly: '', style: 'position:fixed;opacity:0' }); ta.value = text; document.body.append(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch (e) { /* ignore */ }
  ta.remove(); toast(ok ? '文案和链接已复制' : '复制失败，请手动复制地址栏');
}

// ---------------- 主循环 ----------------
function resize() {
  const w = stage.clientWidth || window.innerWidth, h = stage.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false); renderer.domElement.style.width = w + 'px'; renderer.domElement.style.height = h + 'px';
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
function renderFrame(dt) {
  if (tAnim < 1) {
    tAnim = Math.min(1, tAnim + dt / ANIM_SEC);
    const e = ease(tAnim);
    for (const k of ['A', 'B']) lerpState(from[k], to[k], e, cur[k]);
    propMats.forEach(([m, o]) => { m.opacity = o * e; });
    if (tAnim >= 1) for (const k of ['A', 'B']) cur[k] = cloneState(to[k]);
  } else propMats.forEach(([m, o]) => { m.opacity = o; });
  propsGroup.visible = true;
  const J = { A: fk(cur.A, dimsOf.A), B: fk(cur.B, dimsOf.B) };
  updateRig(rigs.A, J.A, cur.A.eyes[0]); updateRig(rigs.B, J.B, cur.B.eyes[0]);
  if (shirtOn) { shirtOn.obj.mat.color.set(state[shirtOn.owner].c); updateShirt(shirtOn.obj, J[shirtOn.who], Math.min(1.35, Math.max(1.08, state[shirtOn.owner].h / state[shirtOn.who].h))); }
  frameCamera(dt);
  if (WEATHER.group && WEATHER.group.children[0]) {
    WEATHER.group.children[0].material.uniforms.uTime.value += dt;
    if (propExt) {
      const cx = (propExt.lo[0] + propExt.hi[0]) / 2, cz = (propExt.lo[2] + propExt.hi[2]) / 2;
      WEATHER.group.children[0].material.uniforms.uUmb.value.set(cx, propExt.lo[1], cz);
      WEATHER.group.children[0].material.uniforms.uUmbR.value = (propExt.hi[0] - propExt.lo[0]) / 2;
    }
  }
  if (selfieRT && selfieRT.screen) {                    // 画中画：先把手机镜头视角渲进 RTT（手机自己临时隐身防自遮）
    selfieRT.cam.position.setFromMatrixPosition(selfieRT.screen.anchor.matrixWorld);
    selfieRT.cam.quaternion.setFromRotationMatrix(selfieRT.screen.anchor.matrixWorld)
      .multiply(_qFlipY);                               // 锚点+z=镜头指向（朝两人），相机却沿-z看 → 掉头
    selfieRT.screen.mesh.visible = false;
    renderer.setRenderTarget(selfieRT.rt);              // 不 setRenderTarget 会把 RTT 画到主画布上（rt 全黑）
    renderer.render(scene, selfieRT.cam);
    renderer.setRenderTarget(null);
    selfieRT.screen.mesh.visible = true;
  }
  renderer.render(scene, camera);
  updateLabels();
}

let last = performance.now();
const _qFlipY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);   // RTT 相机掉头用
function loop(now) {
  const dt = Math.min((now - last) / 1000, 0.05); last = now;
  renderFrame(dt); requestAnimationFrame(loop);
}

// ---------------- 启动 ----------------
function init() {
  const cards = $('#cards'); cards.append(personCard('A'), personCard('B'));
  $('#settingsBtn').addEventListener('click', () => { const open = !$('#panel').classList.contains('open'); $('#panel').classList.toggle('open', open); $('#settingsBtn').setAttribute('aria-expanded', String(open)); });
  $('#panelClose').addEventListener('click', () => { $('#panel').classList.remove('open'); $('#settingsBtn').setAttribute('aria-expanded', 'false'); });
  $('#shotBtn').addEventListener('click', exportPng);
  $('#linkBtn').addEventListener('click', copyLink);
  $('#viewBtn').addEventListener('click', () => setView(VIEWS[(VIEWS.findIndex((v) => v[0] === state.view) + 1) % 3][0]));
  $('#resetBtn').addEventListener('click', () => { fitSm = null; cam.az = 0; cam.el = 0.16; cam.zoom = 1; cam.fpYaw = 0; cam.fpPitch = 0; });
  window.addEventListener('resize', resize);
  const gw = $('#groups');
  GROUPS.forEach(([id, name]) => gw.append(el('button', { type: 'button', class: 'gbtn', 'data-g': id, text: name, 'aria-pressed': 'false', onclick: () => { groupSel = id; renderPoseChips(); $('#poses').scrollTop = 0; } })));
  renderPoseChips(); initPoseBar();
  currentDims(); rebuildRigs(); resize();
  applyTargets({ snap: true });
  updateColors(); renderPoseChips(); setView(state.view); renderInfo(); persist();
  requestAnimationFrame((t) => { last = t; loop(t); });
}
init();

// 测试钩子（不影响正常使用）
window.__app = {
  state, POSES,
  selfie: () => selfieRT,
  renderer: () => renderer,
  setPose: (i, snap) => setPose(i, { snap: !!snap }),
  step: (sec) => { for (let t = 0; t < sec; t += 1 / 30) renderFrame(1 / 30); },
  frame: () => renderFrame(0),
  info: () => ({ A: fk(cur.A, dimsOf.A).headC.toArray(), B: fk(cur.B, dimsOf.B).headC.toArray(), tAnim, role: roleOf }),
  view: setView, cam,
  shirt: () => !!(shirtOn && shirtOn.obj.group.parent),
};
