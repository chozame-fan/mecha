// マイ機体アリーナ 本体（メニュー・3D表示・操作・画面表示）
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createBattle, step, lockTarget, center, ARENA_R, lineBlocked } from './sim.js';
import { WEAPONS, CPU_MECHS, DEFAULT_BUILD, FRAMES, stats } from './data.js';
import { buildProcedural, loadScanMech, buildScanRig, paintedMaterial, equip, animateRig, DEFAULT_JOINTS } from './mech.js';
import { initAudio, sfx, bgm, boostHum } from './audio.js';
import { listMechs, getMech, storeMode } from './store.js';

const $ = id => document.getElementById(id);
const isTouch = matchMedia('(pointer: coarse)').matches;
if (isTouch) document.body.classList.add('touchmode');

// ---------------- 3D の土台 ----------------
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, isTouch ? 1.25 : 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.82;
const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.4;
const camera = new THREE.PerspectiveCamera(62, 1, 0.2, 1200);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.42, 0.45, 1.05);
composer.addPass(bloom);
composer.addPass(new OutputPass());
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); composer.setSize(w, h); camera.aspect = w / h;
  // 縦長のスマホは広めに映す
  camera.fov = w < h ? 80 : 62; cam.dist = w < h ? 14 : 11; camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

// 空・光
scene.fog = new THREE.Fog(0x9aa9bd, 120, 420);
{
  const sky = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 v; void main(){ v = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: `varying vec3 v; void main(){ float h = v.y;
      vec3 top = vec3(0.16,0.34,0.62), mid = vec3(0.62,0.70,0.80), low = vec3(0.86,0.78,0.66);
      vec3 c = h > 0. ? mix(mid, top, pow(h, 0.6)) : mix(mid, low, min(1., -h*4.));
      vec3 sd = normalize(vec3(-0.5,0.45,-0.7)); float s = max(0., dot(v, sd)); c += vec3(1.,.85,.6) * (pow(s, 400.)*3. + pow(s, 8.)*.25);
      gl_FragColor = vec4(c,1.); }`,
  }));
  scene.add(sky);
}
scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x5a4a3a, 0.55));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.1);
sun.castShadow = true; sun.shadow.mapSize.set(isTouch ? 1024 : 2048, isTouch ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 400 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);

// 神殿風のアリーナ
function canvasTex(w, h, draw, repeat = 1) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
function buildArena(world) {
  const g = new THREE.Group();
  const floorTex = canvasTex(512, 512, (x, w, h) => {
    x.fillStyle = '#a79c86'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 4000; i++) { x.fillStyle = `rgba(${Math.random() < .5 ? '0,0,0' : '255,255,255'},${Math.random() * 0.05})`; x.fillRect(Math.random() * w, Math.random() * h, 3, 3); }
    x.strokeStyle = 'rgba(60,50,40,.55)'; x.lineWidth = 3;
    for (let i = 0; i <= 4; i++) { x.beginPath(); x.moveTo(0, i * h / 4); x.lineTo(w, i * h / 4); x.stroke(); }
    for (let r = 0; r < 4; r++) for (let i = 0; i <= 2; i++) { const xx = (i + (r % 2) * 0.5) * w / 2; x.beginPath(); x.moveTo(xx, r * h / 4); x.lineTo(xx, (r + 1) * h / 4); x.stroke(); }
  }, 40);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(ARENA_R + 40, 96), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; g.add(floor);
  // 光る円の模様
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x66d9ff, transparent: true, opacity: 0.55 });
  for (const r of [20, 60, 108]) { const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.25, r + 0.25, 128), ringMat); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; g.add(ring); }
  const stone = new THREE.MeshStandardMaterial({ color: 0xb9ae9a, roughness: 0.8 });
  const stoneDark = new THREE.MeshStandardMaterial({ color: 0x9c907c, roughness: 0.8 });
  const glow = new THREE.MeshStandardMaterial({ color: 0x66d9ff, emissive: 0x66d9ff, emissiveIntensity: 2.2 });
  for (const p of world.pillars) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(p.r * 0.92, p.r, p.h, 20), stone);
    col.position.set(p.x, p.h / 2, p.z); col.castShadow = col.receiveShadow = true; g.add(col);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(p.r * 2.5, 1.2, p.r * 2.5), stoneDark); cap.position.set(p.x, p.h - 0.6, p.z); cap.castShadow = true; cap.receiveShadow = true; g.add(cap);
    const base = new THREE.Mesh(new THREE.BoxGeometry(p.r * 2.4, 1, p.r * 2.4), stoneDark); base.position.set(p.x, 0.5, p.z); base.receiveShadow = true; g.add(base);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(p.r * 0.95, p.r * 0.95, 0.35, 20), glow); band.position.set(p.x, p.h * 0.62, p.z); g.add(band);
  }
  // 外壁
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(ARENA_R + 3, ARENA_R + 3, 22, 96, 1, true), new THREE.MeshStandardMaterial({ color: 0xb8ad97, roughness: 0.85, side: THREE.BackSide }));
  wall.position.y = 11; wall.receiveShadow = true; g.add(wall);
  const wl = new THREE.Mesh(new THREE.CylinderGeometry(ARENA_R + 2.8, ARENA_R + 2.8, 0.5, 96, 1, true), new THREE.MeshBasicMaterial({ color: 0x66d9ff, side: THREE.BackSide }));
  wl.position.y = 6; g.add(wl);
  for (let i = 0; i < 24; i++) {
    const a = i / 24 * Math.PI * 2, t = new THREE.Mesh(new THREE.BoxGeometry(6, 30, 6), stoneDark);
    t.position.set(Math.cos(a) * (ARENA_R + 6), 15, Math.sin(a) * (ARENA_R + 6)); t.rotation.y = -a; g.add(t);
  }
  // 遠くの山
  const mtn = new THREE.MeshStandardMaterial({ color: 0x6f7f95, roughness: 1, flatShading: true });
  for (let i = 0; i < 18; i++) {
    const a = i / 18 * Math.PI * 2 + Math.random() * 0.2, r = 330 + Math.random() * 60, h = 50 + Math.random() * 90;
    const m = new THREE.Mesh(new THREE.ConeGeometry(60 + Math.random() * 50, h, 6), mtn); m.position.set(Math.cos(a) * r, h / 2 - 5, Math.sin(a) * r); g.add(m);
  }
  return g;
}

// ---------------- 光の粒（爆発・火花・噴射） ----------------
const dotTex = canvasTex(64, 64, (x, w) => { const gr = x.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, w, w); });
dotTex.wrapS = dotTex.wrapT = THREE.ClampToEdgeWrapping; dotTex.repeat.set(1, 1);
const smokeTex = canvasTex(64, 64, (x, w) => { const gr = x.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); gr.addColorStop(0, 'rgba(255,255,255,.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, w, w); });
smokeTex.wrapS = smokeTex.wrapT = THREE.ClampToEdgeWrapping; smokeTex.repeat.set(1, 1);
const parts = [];
const partGroup = new THREE.Group(); scene.add(partGroup);
function spawn(x, y, z, o) {
  let p = parts.find(p => !p.alive);
  if (!p) {
    if (parts.length > 500) return;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    p = { s }; parts.push(p); partGroup.add(s);
  }
  p.alive = true; p.s.visible = true;
  p.s.position.set(x, y, z); p.v = new THREE.Vector3(o.vx || 0, o.vy || 0, o.vz || 0);
  p.life = p.max = o.life || 0.5; p.size0 = o.size || 1; p.size1 = o.size1 ?? p.size0 * 2; p.drag = o.drag ?? 2; p.grav = o.grav || 0;
  const m = p.s.material; m.color.set(o.color ?? 0xffffff); m.map = o.smoke ? smokeTex : dotTex;
  m.blending = o.smoke ? THREE.NormalBlending : THREE.AdditiveBlending; p.op = o.opacity ?? 1;
}
function updateParts(dt) {
  for (const p of parts) {
    if (!p.alive) continue;
    p.life -= dt; if (p.life <= 0) { p.alive = false; p.s.visible = false; continue; }
    const k = 1 - p.life / p.max;
    p.v.multiplyScalar(Math.exp(-p.drag * dt)); p.v.y -= p.grav * dt;
    p.s.position.addScaledVector(p.v, dt);
    const sz = p.size0 + (p.size1 - p.size0) * k; p.s.scale.set(sz, sz, 1);
    p.s.material.opacity = p.op * (1 - k);
  }
}
function burst(x, y, z, n, o) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, b = Math.random() * 2 - 1, sp = (o.speed || 10) * (0.3 + Math.random() * 0.7);
    const r = Math.sqrt(1 - b * b);
    spawn(x, y, z, { ...o, vx: Math.cos(a) * r * sp, vy: b * sp + (o.up || 0), vz: Math.sin(a) * r * sp, life: (o.life || 0.5) * (0.6 + Math.random() * 0.6) });
  }
}
function explosion(x, y, z, r = 4) {
  burst(x, y, z, 18, { color: 0xc8641e, size: r * 0.6, size1: r * 1.5, speed: r * 5, life: 0.5, drag: 3, opacity: 0.7 });
  burst(x, y, z, 6, { color: 0x806040, size: r * 0.5, size1: r * 0.9, speed: r * 2, life: 0.22, opacity: 0.8 });
  burst(x, y, z, 14, { color: 0x6b6460, size: r * 1.2, size1: r * 3.2, speed: r * 2.5, life: 1.6, drag: 1.5, smoke: true, opacity: 0.55, up: 3 });
  flash(x, y, z, 0xffa040, r * 6, 0.25);
}
const flashes = [];
function flash(x, y, z, color, dist, dur) {
  let f = flashes.find(f => !f.alive);
  if (!f) { if (flashes.length >= 6) return; f = { l: new THREE.PointLight(color, 0, dist, 2) }; scene.add(f.l); flashes.push(f); }
  f.alive = true; f.l.color.set(color); f.l.distance = dist; f.l.position.set(x, y, z); f.t = f.max = dur; f.peak = 400;
}
function updateFlashes(dt) { for (const f of flashes) if (f.alive) { f.t -= dt; f.l.intensity = Math.max(0, f.t / f.max) * f.peak; if (f.t <= 0) { f.alive = false; f.l.intensity = 0; } } }

// ---------------- 弾の見た目 ----------------
const shotGeo = { beam: new THREE.CylinderGeometry(0.22, 0.22, 7, 8), bullet: new THREE.CylinderGeometry(0.08, 0.08, 2.4, 5), body: new THREE.CylinderGeometry(0.18, 0.18, 1.2, 8) };
for (const g of Object.values(shotGeo)) g.rotateX(Math.PI / 2);
const shotMeshes = new Map();
const shotGroup = new THREE.Group(); scene.add(shotGroup);
function shotMesh(s) {
  const w = WEAPONS[s.w];
  let m;
  if (s.kind === 'beam') m = new THREE.Mesh(shotGeo.beam, new THREE.MeshBasicMaterial({ color: new THREE.Color(w.color).multiplyScalar(2.2) }));
  else if (s.kind === 'bullet') m = new THREE.Mesh(shotGeo.bullet, new THREE.MeshBasicMaterial({ color: new THREE.Color(w.color).multiplyScalar(2) }));
  else m = new THREE.Mesh(shotGeo.body, new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.5, roughness: 0.4 }));
  if (s.w === 'sniper') m.scale.set(0.7, 0.7, 2.2);
  shotGroup.add(m); return m;
}
function syncShots(S, dt) {
  const seen = new Set();
  for (const s of S.shots) {
    seen.add(s.id);
    let m = shotMeshes.get(s.id); if (!m) { m = shotMesh(s); shotMeshes.set(s.id, m); }
    m.position.set(s.x, s.y, s.z);
    m.lookAt(s.x + s.vx, s.y + s.vy, s.z + s.vz);
    if (s.kind === 'rocket' || s.kind === 'missile' || s.kind === 'shell') {
      spawn(s.x, s.y, s.z, { color: 0xffb060, size: 0.9, size1: 0.3, life: 0.12 });
      if (Math.random() < 0.6) spawn(s.x, s.y, s.z, { smoke: true, color: 0xcfcac4, size: 0.7, size1: 2.6, life: 0.9, opacity: 0.4, drag: 1 });
    }
  }
  for (const [id, m] of shotMeshes) if (!seen.has(id)) { m.removeFromParent(); m.material.dispose(); shotMeshes.delete(id); }
}

// ---------------- 機体の読みこみ ----------------
const mechCache = new Map();   // スキャン機体の形と塗装（作り直しを省く）
async function makeRig(entry) {
  if (entry.scan) {
    let c = mechCache.get(entry.scan.id + ':' + (entry.scan.updated || entry.scan.version));
    if (!c) {
      const { prep, tex, geoms } = await loadScanMech(entry.scan);
      const pm = paintedMaterial(tex, geoms, entry.scan.paint);
      c = { prep, mat: pm.mat }; mechCache.set(entry.scan.id + ':' + (entry.scan.updated || entry.scan.version), c);
    }
    const rig = buildScanRig({ geo: c.prep.geo.clone() }, c.mat, { ...DEFAULT_JOINTS, ...(entry.scan.joints || {}) });
    if (entry.scan.joints?.hideWeapons) rig.hideWeapons = true;
    return rig;
  }
  return buildProcedural(entry.colors, entry.head);
}

// ---------------- メニュー ----------------
let myMechs = [];   // スキャン機体
let mySel = null, foeSel = CPU_MECHS[0].id;
const SAMPLE = { id: 'sample', name: 'サンプル機', build: { ...DEFAULT_BUILD }, colors: { main: '#e9ecef', sub: '#2856b8', accent: '#d8b030', visor: '#55ffcc' }, head: 'v' };
const buildText = b => `${FRAMES[b.frame]?.name || ''}<br>${WEAPONS[b.R]?.name} / ${WEAPONS[b.L]?.name} / ${WEAPONS[b.S]?.name}`;
function card(m, sel, extra = '') {
  const c = m.colors ? Object.values(m.colors).map(h => `<i style="background:${h}"></i>`).join('') : '';
  return `<div class="card ${sel ? 'sel' : ''}" data-id="${m.id}"><div class="nm">${m.name}</div>${extra}<div class="sub">${buildText(m.build)}</div>${c ? `<div class="sw">${c}</div>` : ''}</div>`;
}
async function loadMenu() {
  try {
    const list = await listMechs();
    myMechs = list.filter(m => m.hasModel).map(m => ({ id: m.id, name: m.name, build: m.build || { ...DEFAULT_BUILD }, scanId: m.id }));
  } catch { myMechs = []; }
  if (!mySel) mySel = localStorage.getItem('arena-my') || myMechs[0]?.id || 'sample';
  if (![...myMechs, SAMPLE].some(m => m.id === mySel)) mySel = myMechs[0]?.id || 'sample';
  foeSel = localStorage.getItem('arena-foe') || foeSel;
  renderMenu();
}
function renderMenu() {
  $('myList').innerHTML = myMechs.map(m => card(m, m.id === mySel, '<span class="tag">スキャン</span>')).join('') + card(SAMPLE, mySel === 'sample', '<span class="tag">見本</span>') +
    (myMechs.length ? '' : `<div class="card" onclick="location.href='hangar.html'"><div class="nm">＋ 自分のガンプラを取り込む</div><div class="sub">スマホで周りをぐるっと撮った動画から3Dにします（無料）</div></div>`);
  $('foeList').innerHTML = [...CPU_MECHS.map(m => card(m, m.id === foeSel, `<span class="tag">CPU: ${aiName(m.ai)}</span>`)),
    ...myMechs.filter(m => m.id !== mySel).map(m => card(m, m.id === foeSel, '<span class="tag">自分の機体（CPU操作）</span>'))].join('');
  for (const el of $('myList').querySelectorAll('.card[data-id]')) el.onclick = () => { mySel = el.dataset.id; localStorage.setItem('arena-my', mySel); sfx('click'); renderMenu(); };
  for (const el of $('foeList').querySelectorAll('.card[data-id]')) el.onclick = () => { foeSel = el.dataset.id; localStorage.setItem('arena-foe', foeSel); sfx('click'); renderMenu(); };
}
const aiName = k => ({ balance: 'バランス', rush: '接近戦', sniper: '引き撃ち', evade: '回避重視', rookie: 'ルーキー' })[k] || k;
async function entryOf(id, asCpu) {
  const cpu = CPU_MECHS.find(m => m.id === id);
  if (cpu) return { ...cpu };
  if (id === 'sample') return { ...SAMPLE, ai: asCpu ? 'balance' : undefined };
  const scan = await getMech(id);
  return { id, name: scan.name, build: scan.build || { ...DEFAULT_BUILD }, scan, ai: asCpu ? (scan.ai || 'balance') : undefined };
}

// ---------------- 戦闘 ----------------
let S = null, arena = null, rigs = [], meId = null, spectate = false, running = false, paused = false, lastSpec = null, followIdx = 0;
const cam = { yaw: 0, pitch: -0.08, dist: 11 };
resize();

async function startBattle(watch = false) {
  initAudio(); sfx('click');
  $('menu').classList.add('hidden'); $('loading').classList.remove('hidden');
  $('loadMsg').textContent = 'スキャン機体は初回の読みこみ・塗装に数秒かかります';
  try {
    const me = await entryOf(mySel, watch);
    const foe = await entryOf(foeSel, true);
    if (watch) me.ai = me.ai || 'balance';
    lastSpec = { me, foe, watch };
    await setupBattle(lastSpec);
  } catch (e) {
    console.error(e); alert('機体の読みこみに失敗しました: ' + e.message);
    $('loading').classList.add('hidden'); $('menu').classList.remove('hidden'); return;
  }
  $('loading').classList.add('hidden');
}
async function setupBattle({ me, foe, watch }) {
  // 片付け
  for (const r of rigs) r.root.removeFromParent();
  rigs = [];
  for (const [, m] of shotMeshes) m.removeFromParent(); shotMeshes.clear();
  if (!arena) { S = createBattle({ mechs: [{ build: DEFAULT_BUILD }, { build: DEFAULT_BUILD }] }); arena = buildArena(S.world); scene.add(arena); }
  spectate = watch;
  const specs = [
    { id: 0, team: 0, name: me.name, build: me.build, ai: watch ? me.ai : undefined },
    { id: 1, team: 1, name: foe.name, build: foe.build, ai: foe.ai || 'balance' },
  ];
  S = createBattle({ mechs: specs, seed: (Math.random() * 1e9) | 0 });
  meId = 0;
  for (const [i, e] of [me, foe].entries()) {
    const rig = await makeRig(e);
    if (!rig.hideWeapons) equip(rig, e.build);
    scene.add(rig.root); rigs[i] = rig;
  }
  const m = S.mechs[0];
  cam.yaw = m.yaw; cam.pitch = -0.05;
  $('meName').textContent = me.name + (watch ? '（AI）' : '');
  $('foeBars').innerHTML = S.mechs.filter(x => x.team !== 0).map(x => `<div class="foe"><div class="lbl"><span>${x.name}</span><span id="fhp${x.id}"></span></div><div class="bar"><i id="fbar${x.id}"></i></div></div>`).join('');
  $('weapons').innerHTML = ['R', 'L', 'S'].map(k => `<div class="wp"><span class="k">${{ R: isTouch ? '撃' : '左ク', L: isTouch ? '左' : '右ク', S: isTouch ? '肩' : 'Q' }[k]}</span><span>${WEAPONS[m.build[k]].name}</span><span id="wa${k}"></span><div class="cd"><i id="wc${k}"></i></div></div>`).join('');
  $('hud').classList.remove('hidden'); $('result').classList.add('hidden');
  $('spect').classList.toggle('hidden', !watch);
  $('touch').classList.toggle('hidden', !isTouch || watch);
  $('reticle').classList.toggle('hidden', watch);
  running = true; paused = false; acc = 0;
  bgm(true, 'battle');
  if (!watch && !isTouch) lockPointer();
}

function endBattle() {
  running = false; boostHum(false); bgm(false);
  document.exitPointerLock?.();
  const me = S.mechs[0], foe = S.mechs[1];
  const won = S.winner === 0;
  const title = spectate ? `${(won ? me : foe).name} の勝ち` : won ? '勝利！' : '敗北…';
  sfx(won || spectate ? 'win' : 'lose');
  const acc = m => m.stat.shots ? Math.round(m.stat.hits / m.stat.shots * 100) + '%' : '-';
  $('resTitle').textContent = title + (S.timeout ? '（時間切れ・残り体力で判定）' : '');
  $('resBody').innerHTML = `<table class="bal"><tr><th></th><th>${me.name}</th><th>${foe.name}</th></tr>
    <tr><td>与えたダメージ</td><td>${me.stat.dmgDealt}</td><td>${foe.stat.dmgDealt}</td></tr>
    <tr><td>命中率</td><td>${acc(me)}</td><td>${acc(foe)}</td></tr>
    <tr><td>回避ブースト</td><td>${me.stat.dodges}</td><td>${foe.stat.dodges}</td></tr>
    <tr><td>残り体力</td><td>${Math.max(0, me.hp)}</td><td>${Math.max(0, foe.hp)}</td></tr></table>
    <p class="note">時間 ${Math.floor(S.t / 60)}:${String(Math.floor(S.t % 60)).padStart(2, '0')}</p>`;
  setTimeout(() => $('result').classList.remove('hidden'), 1200);
}
function toMenu() {
  running = false; paused = false; boostHum(false); bgm(false);
  for (const id of ['hud', 'result', 'pause', 'touch', 'balance']) $(id).classList.add('hidden');
  $('menu').classList.remove('hidden'); document.exitPointerLock?.();
  loadMenu();
}

// ---------------- 操作 ----------------
function lockPointer() { try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch {} }
const keys = new Set(); let mouseL = false, mouseR = false, dashEdge = false;
addEventListener('keydown', e => {
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') dashEdge = true;
  if (e.code === 'Escape' && running) setPause(!paused);
  if (spectate && (e.code === 'Digit1' || e.code === 'Digit2')) followIdx = e.code === 'Digit1' ? 0 : 1;
  if (running && ['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', e => keys.delete(e.code));
canvas.addEventListener('mousedown', e => {
  if (!running || paused) return;
  if (!document.pointerLockElement && !spectate && !isTouch) { lockPointer(); return; }
  if (e.button === 0) mouseL = true; if (e.button === 2) mouseR = true;
});
addEventListener('mouseup', e => { if (e.button === 0) mouseL = false; if (e.button === 2) mouseR = false; });
addEventListener('contextmenu', e => { if (running) e.preventDefault(); });
addEventListener('mousemove', e => {
  if (!running || paused) return;
  if (document.pointerLockElement === canvas || (spectate && e.buttons)) { cam.yaw -= e.movementX * 0.0022; cam.pitch = THREE.MathUtils.clamp(cam.pitch - e.movementY * 0.0022, -1.0, 0.7); }
});
document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && running && !spectate && !isTouch && !paused && !S.over) setPause(true); });
function setPause(p) {
  paused = p; $('pause').classList.toggle('hidden', !p);
  if (p) { document.exitPointerLock?.(); boostHum(false); } else if (!isTouch && !spectate) lockPointer();
}

// スマホ
const touch = { mx: 0, mz: 0, btn: {}, stickId: null, lookId: null, lx: 0, ly: 0 };
{
  const stick = $('stick'), knob = stick.querySelector('i');
  stick.addEventListener('pointerdown', e => { touch.stickId = e.pointerId; stick.setPointerCapture(e.pointerId); moveStick(e); });
  stick.addEventListener('pointermove', e => { if (e.pointerId === touch.stickId) moveStick(e); });
  const endStick = e => { if (e.pointerId !== touch.stickId) return; touch.stickId = null; touch.mx = touch.mz = 0; knob.style.transform = ''; };
  stick.addEventListener('pointerup', endStick); stick.addEventListener('pointercancel', endStick);
  function moveStick(e) {
    const r = stick.getBoundingClientRect(); let x = (e.clientX - r.left - r.width / 2) / (r.width / 2), y = (e.clientY - r.top - r.height / 2) / (r.height / 2);
    const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
    touch.mx = x; touch.mz = -y; knob.style.transform = `translate(${x * 40}px, ${y * 40}px)`;
  }
  for (const b of document.querySelectorAll('#tbtns button')) {
    const k = b.dataset.k;
    b.addEventListener('pointerdown', e => { e.preventDefault(); touch.btn[k] = true; if (k === 'dash') dashEdge = true; b.classList.add('on'); });
    const up = () => { touch.btn[k] = false; b.classList.remove('on'); };
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
  }
  canvas.addEventListener('pointerdown', e => { if (e.pointerType !== 'touch' || !running) return; touch.lookId = e.pointerId; touch.lx = e.clientX; touch.ly = e.clientY; });
  canvas.addEventListener('pointermove', e => {
    if (e.pointerId !== touch.lookId) return;
    cam.yaw -= (e.clientX - touch.lx) * 0.006; cam.pitch = THREE.MathUtils.clamp(cam.pitch - (e.clientY - touch.ly) * 0.005, -1.0, 0.7);
    touch.lx = e.clientX; touch.ly = e.clientY;
  });
  const endLook = e => { if (e.pointerId === touch.lookId) touch.lookId = null; };
  canvas.addEventListener('pointerup', endLook); canvas.addEventListener('pointercancel', endLook);
  $('tpause').onclick = () => running && setPause(true);
}

function readGamepad() {
  const gp = [...(navigator.getGamepads?.() || [])].find(g => g && g.connected);
  if (!gp) return null;
  const dz = v => Math.abs(v) < 0.15 ? 0 : v;
  const b = i => !!gp.buttons[i]?.pressed;
  return { lx: dz(gp.axes[0]), ly: dz(gp.axes[1]), rx: dz(gp.axes[2]), ry: dz(gp.axes[3]), a: b(0), b: b(1), rt: b(7), lt: b(6), rb: b(5), start: b(9) };
}
let gpDashPrev = false, gpStartPrev = false;

function playerInput(m, dt) {
  const gp = readGamepad();
  let fx = 0, fz = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) fz += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) fz -= 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) fx -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) fx += 1;
  fx += touch.mx; fz += touch.mz;
  let jump = keys.has('Space') || touch.btn.jump, dash = dashEdge;
  let fire = [mouseL || touch.btn.fireR, mouseR || touch.btn.fireL, keys.has('KeyQ') || keys.has('KeyE') || touch.btn.fireS];
  if (gp) {
    fx += gp.lx; fz -= gp.ly;
    cam.yaw -= gp.rx * 2.6 * dt; cam.pitch = THREE.MathUtils.clamp(cam.pitch - gp.ry * 1.8 * dt, -1.0, 0.7);
    jump = jump || gp.a; if (gp.b && !gpDashPrev) dash = true; gpDashPrev = gp.b;
    fire = [fire[0] || gp.rt, fire[1] || gp.lt, fire[2] || gp.rb];
    if (gp.start && !gpStartPrev) setPause(!paused); gpStartPrev = gp.start;
  }
  dashEdge = false;
  // カメラの向き基準で動く（正面 = (sin yaw, cos yaw)、右 = (-cos yaw, sin yaw)）
  const sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw);
  const move = [sy * fz - cy * fx, cy * fz + sy * fx];
  // 狙い: 画面の真ん中（少し上）の先の点へ
  const aimPt = aimPoint();
  const eye = [m.x, m.y + 4.2, m.z];
  const aim = [aimPt.x - eye[0], aimPt.y - eye[1], aimPt.z - eye[2]];
  return { move, aim, jump, dash, fire };
}
const ray = new THREE.Raycaster();
function aimPoint() {
  ray.setFromCamera(new THREE.Vector2(0, 0.1), camera);
  return ray.ray.at(160, new THREE.Vector3());
}

// ---------------- 毎フレーム ----------------
const clock = new THREE.Clock();
let acc = 0, lastLock = null, lastWarn = 0;
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
function frame() {
  requestAnimationFrame(frame);
  tick(Math.min(0.05, clock.getDelta()));
}
function tick(dt) {
  if (running && !paused) {
    const me = S.mechs[meId];
    const inputs = {};
    if (!spectate) inputs[meId] = playerInput(me, dt);
    acc += dt;
    while (acc >= 1 / 60) {
      step(S, inputs, 1 / 60); acc -= 1 / 60;
      handleEvents(); inputs[meId] && (inputs[meId].dash = false);
      if (S.over) break;
    }
    if (S.over && running) endBattle();
  }
  if (S && rigs.length) {
    for (const [i, m] of S.mechs.entries()) {
      const r = rigs[i]; if (!r) continue;
      r.root.position.set(m.x, m.y, m.z); r.root.rotation.y = m.yaw;
      const pitch = Math.asin(THREE.MathUtils.clamp(m.aim[1], -1, 1));
      if (m.alive) animateRig(r, m, dt, pitch);
      else { r.root.rotation.x = THREE.MathUtils.lerp(r.root.rotation.x, -1.3, dt * 2); r.root.position.y = Math.max(0, m.y - 1.5); if (Math.random() < 0.3) spawn(m.x + (Math.random() - .5) * 3, m.y + 2, m.z + (Math.random() - .5) * 3, { smoke: true, color: 0x333333, size: 2, size1: 6, life: 2, opacity: 0.5, vy: 4 }); }
      if (m.alive && (m.boosting || m.dashT > 0)) {
        for (const t of r.thrusters) { const p = t.getWorldPosition(new THREE.Vector3()); spawn(p.x, p.y - 0.6, p.z, { color: 0x7fd0ff, size: 1.0, size1: 0.2, life: 0.15, vy: -8 }); }
      }
      if (m.alive && m.onGround && Math.hypot(m.vx + m.dvx, m.vz + m.dvz) > 20 && Math.random() < 0.5) spawn(m.x, 0.3, m.z, { smoke: true, color: 0xcbbfa8, size: 1.5, size1: 4, life: 0.8, opacity: 0.35 });
    }
    syncShots(S, dt);
    updateCamera(dt);
    if (running) updateHud();
  } else {
    // メニューの背景: ゆっくり回る
    const t = performance.now() / 1000 * 0.05;
    camera.position.set(Math.cos(t) * 90, 26, Math.sin(t) * 90); camera.lookAt(0, 8, 0);
  }
  updateParts(dt); updateFlashes(dt);
  sun.position.copy(camLook).add(new THREE.Vector3(60, 90, 70)); sun.target.position.copy(camLook);
  composer.render();
}

function updateCamera(dt) {
  const idx = spectate ? followIdx : meId;
  const m = S.mechs[idx];
  if (spectate) {
    // 相手の方を向くように少しずつ回す（マウスで動かした時はそちら優先）
    const o = S.mechs[1 - idx];
    const want = Math.atan2(o.x - m.x, o.z - m.z);
    let d = want - cam.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); cam.yaw += d * Math.min(1, dt * 1.5);
  }
  const sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw);
  const target = new THREE.Vector3(m.x, m.y + 4.6, m.z);
  const right = new THREE.Vector3(-cy, 0, sy);
  const back = new THREE.Vector3(-sy * Math.cos(cam.pitch), -Math.sin(cam.pitch), -cy * Math.cos(cam.pitch));
  // 柱にさえぎられる時はカメラを機体に寄せる
  let dist = cam.dist + (spectate ? 6 : 0);
  const side = spectate ? 0 : 2.2;
  while (dist > 3) {
    const p = target.clone().addScaledVector(back, dist + 1.5).addScaledVector(right, side);
    if (Math.hypot(p.x, p.z) < ARENA_R - 1 && !lineBlocked(S.world, [target.x, target.y, target.z], [p.x, p.y, p.z])) break;
    dist -= 1;
  }
  const want = target.clone().addScaledVector(back, dist).addScaledVector(right, side);
  want.y = Math.max(1.2, want.y);
  camPos.lerp(want, 1 - Math.exp(-14 * dt));
  if (camPos.distanceTo(want) > 30) camPos.copy(want);
  camera.position.copy(camPos);
  camLook.copy(target).addScaledVector(back, -30).addScaledVector(right, spectate ? 0 : 2.2);
  camera.lookAt(camLook);
  if (shake > 0) { camera.position.x += (Math.random() - .5) * shake; camera.position.y += (Math.random() - .5) * shake; shake = Math.max(0, shake - dt * 3); }
}
let shake = 0;

function handleEvents() {
  const me = S.mechs[meId];
  const vol = e => { const d = Math.hypot((e.x ?? me.x) - camera.position.x, (e.y ?? me.y) - camera.position.y, (e.z ?? me.z) - camera.position.z); return Math.min(1, 40 / (d + 10)); };
  for (const e of S.events) {
    switch (e.type) {
      case 'fire': {
        const w = WEAPONS[e.w];
        const snd = { rifle: 'beam', sniper: 'sniper', mg: 'mg', handgun: 'handgun', bazooka: 'bazooka', cannon: 'cannon', missile: 'missile' }[e.w];
        sfx(snd, vol(e) * (e.id === meId ? 0.8 : 1));
        spawn(e.x, e.y, e.z, { color: w.color ?? 0xffffff, size: e.w === 'mg' ? 1.0 : 2.4, size1: 0.3, life: 0.08 });
        if (w.kind === 'beam') flash(e.x, e.y, e.z, w.color, 18, 0.1);
        if (e.id === meId && (e.w === 'cannon' || e.w === 'sniper' || e.w === 'bazooka')) shake = Math.max(shake, 0.25);
        break;
      }
      case 'hit': {
        const big = e.dmg >= 300;
        sfx(big ? 'hitHeavy' : 'hit', vol(e));
        burst(e.x, e.y, e.z, big ? 18 : 6, { color: e.w === 'rifle' || e.w === 'sniper' || e.w === 'saber' ? 0xff8ae0 : 0xffd27a, size: big ? 1.4 : 0.7, size1: 0.1, speed: big ? 22 : 12, life: 0.35, grav: 20 });
        if (big) flash(e.x, e.y, e.z, 0xffb070, 22, 0.15);
        if (e.id === meId) { shake = Math.max(shake, big ? 0.5 : 0.12); }
        else if (!spectate) popup(e, e.dmg, big);
        break;
      }
      case 'block': sfx('block', vol(e)); { const m = S.mechs[e.id]; burst(m.x, m.y + 3.5, m.z, 8, { color: 0x8fdcff, size: 1, size1: 0.1, speed: 14, life: 0.3 }); } break;
      case 'impact': burst(e.x, e.y, e.z, e.kind === 'bullet' ? 3 : 8, { color: 0xffd27a, size: 0.6, size1: 0.1, speed: 10, life: 0.3, grav: 20 }); if (e.kind !== 'bullet') spawn(e.x, e.y, e.z, { smoke: true, color: 0xbbb2a2, size: 1.5, size1: 4, life: 1, opacity: 0.4 }); break;
      case 'explode': explosion(e.x, e.y, e.z, e.r * 0.8); sfx('explode', vol(e)); if (Math.hypot(e.x - me.x, e.z - me.z) < 30) shake = Math.max(shake, 0.4); break;
      case 'dash': sfx('dash', vol(S.mechs[e.id]) * 0.8); break;
      case 'melee': sfx('saber', vol(S.mechs[e.id])); break;
      case 'slash': sfx('slash', vol(e)); burst(e.x, e.y, e.z, 30, { color: 0xff8ae0, size: 1.6, size1: 0.1, speed: 26, life: 0.4 }); flash(e.x, e.y, e.z, 0xff70d0, 30, 0.2); break;
      case 'stagger': if (e.id === meId) shake = 0.6; break;
      case 'overheat': if (e.id === meId) sfx('overheat'); break;
      case 'down': explosion(e.x, e.y + 3, e.z, 9); sfx('down', 1); shake = 1; setTimeout(() => S && explosion(e.x, e.y + 2, e.z, 6), 300); break;
    }
  }
  S.events.length = 0;
}
function popup(e, v, big) {
  const p = new THREE.Vector3(e.x, e.y + 1, e.z).project(camera);
  if (p.z > 1) return;
  const el = document.createElement('div'); el.className = 'pop' + (big ? ' big' : '');
  el.textContent = v; el.style.left = (p.x * 0.5 + 0.5) * innerWidth + (Math.random() - .5) * 30 + 'px'; el.style.top = (-p.y * 0.5 + 0.5) * innerHeight + 'px';
  $('pops').appendChild(el); setTimeout(() => el.remove(), 800);
}

function updateHud() {
  const m = S.mechs[spectate ? followIdx : meId];
  $('meHp').style.width = (m.hp / m.st.hp * 100) + '%'; $('meHpN').textContent = Math.max(0, Math.round(m.hp));
  $('meEn').style.width = (m.en / m.st.en * 100) + '%';
  $('meEn').parentElement.classList.toggle('heat', m.overheat > 0);
  for (const o of S.mechs) if (o.team !== 0) { const b = $('fbar' + o.id); if (b) { b.style.width = (o.hp / o.st.hp * 100) + '%'; $('fhp' + o.id).textContent = Math.max(0, Math.round(o.hp)); } }
  const left = Math.max(0, 180 - S.t); $('timer').textContent = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
  for (const k of ['R', 'L', 'S']) {
    const w = WEAPONS[m.build[k]], a = m.ammo[k];
    let txt = '', frac = 1;
    if (w.mag) { txt = a.reload > 0 ? 'リロード' : `${a.n}/${w.mag}`; frac = a.reload > 0 ? 1 - a.reload / w.reload : 1 - a.cd / w.cd; }
    else if (w.cd) { txt = w.en ? `EN${w.en}` : ''; frac = 1 - a.cd / w.cd; }
    else if (w.kind === 'shield') txt = m.guarding ? '防御中' : '';
    $('wa' + k).textContent = txt; $('wc' + k).style.width = Math.max(0, Math.min(1, frac)) * 100 + '%';
  }
  if (spectate) { $('lockBox').classList.add('hidden'); $('warn').classList.add('hidden'); return; }
  const lk = m.alive ? lockTarget(S, m) : null;
  if (lk) {
    const p = new THREE.Vector3(...center(lk)).project(camera);
    const lb = $('lockBox'); lb.classList.remove('hidden');
    lb.style.left = (p.x * 0.5 + 0.5) * innerWidth + 'px'; lb.style.top = (-p.y * 0.5 + 0.5) * innerHeight + 'px';
    if (lastLock !== lk.id) sfx('lock', 0.5);
  } else $('lockBox').classList.add('hidden');
  lastLock = lk?.id ?? null;
  // 警告
  const incoming = S.shots.some(s => s.team !== m.team && s.kind === 'missile' && s.tgt === m.id);
  const warn = m.overheat > 0 ? 'オーバーヒート' : incoming ? 'ミサイル接近' : m.hp < m.st.hp * 0.25 ? '機体損傷・危険' : '';
  $('warn').textContent = warn; $('warn').classList.toggle('hidden', !warn);
  if (incoming && performance.now() - lastWarn > 700) { lastWarn = performance.now(); sfx('alert', 0.5); }
  boostHum(m.alive && (m.boosting));
}

// ---------------- AI総当たり ----------------
function openBalance() {
  $('menu').classList.add('hidden'); $('balance').classList.remove('hidden'); $('balOut').innerHTML = '';
}
async function runBalance() {
  const N = Number($('balN').value);
  const list = [...CPU_MECHS.map(m => ({ id: m.id, name: m.name, build: m.build, ai: m.ai })),
    ...myMechs.map(m => ({ id: m.id, name: m.name + '（自分）', build: m.build, ai: 'balance' }))];
  $('balRun').disabled = true;
  $('balOut').innerHTML = '<div class="prog"><i id="balProg"></i></div><p class="note" id="balTxt">計算中…</p>';
  const worker = new Worker('balance-worker.js', { type: 'module' });
  worker.postMessage({ list, N });
  worker.onmessage = e => {
    const d = e.data;
    if (d.progress != null) { $('balProg').style.width = d.progress * 100 + '%'; $('balTxt').textContent = `${d.done}戦 終了…`; return; }
    $('balRun').disabled = false; worker.terminate();
    const { win, total, pair, avgT } = d;
    let h = `<p>合計 ${total}戦 ／ 1戦の平均 ${avgT.toFixed(0)}秒</p><table class="bal"><tr><th>機体（行）が勝った割合</th>${list.map(m => `<th>${m.name}</th>`).join('')}<th>全体</th></tr>`;
    for (const a of list) {
      h += `<tr><th>${a.name}<br><small>${WEAPONS[a.build.R].name}/${WEAPONS[a.build.L].name}/${WEAPONS[a.build.S].name}</small></th>`;
      for (const b of list) {
        if (a.id === b.id) { h += '<td>-</td>'; continue; }
        const r = pair[a.id + '|' + b.id]; const p = r ? r[0] / r[1] : 0;
        h += `<td class="${p >= 0.7 ? 'hi' : p <= 0.3 ? 'lo' : ''}">${Math.round(p * 100)}%</td>`;
      }
      const p = win[a.id] / Math.max(1, (list.length - 1) * N);
      h += `<td class="${p >= 0.65 ? 'hi' : p <= 0.35 ? 'lo' : ''}"><b>${Math.round(p * 100)}%</b></td></tr>`;
    }
    h += '</table><p class="note">緑＝7割以上勝つ（強すぎるかも）、赤＝3割以下。ルーキーはわざと弱くしてあります。</p>';
    $('balOut').innerHTML = h;
  };
}

// ---------------- ボタン ----------------
$('btnStart').onclick = () => startBattle(false);
$('btnWatch').onclick = () => startBattle(true);
$('btnBalance').onclick = openBalance;
$('balRun').onclick = runBalance;
$('balClose').onclick = toMenu;
$('btnResume').onclick = () => setPause(false);
$('btnQuit').onclick = toMenu;
$('btnAgain').onclick = async () => { $('result').classList.add('hidden'); $('loading').classList.remove('hidden'); await setupBattle(lastSpec); $('loading').classList.add('hidden'); };
$('btnMenu').onclick = toMenu;
document.addEventListener('click', () => initAudio(), { once: true });

// 見た目確認用（開発者向け）
window.__arena = { tick, get S() { return S; }, rigs: () => rigs, step: (n = 60) => { for (let i = 0; i < n; i++) { step(S, {}, 1 / 60); handleEvents(); } }, cam };

if (isTouch) $('rotHint').classList.remove('hidden');
if ('serviceWorker' in navigator && location.hostname !== 'localhost') navigator.serviceWorker.register('sw.js').catch(() => {});
loadMenu();
{ // メニューの背景にアリーナを出しておく
  const w = createBattle({ mechs: [{ build: DEFAULT_BUILD }, { build: DEFAULT_BUILD }] }).world;
  arena = buildArena(w); scene.add(arena);
}
frame();
