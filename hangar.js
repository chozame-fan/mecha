// 格納庫: 取り込み・向き・関節・塗装・装備
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadRaw, prepareGeometry, buildScanRig, equip, animateRig, DEFAULT_JOINTS, SEG_COLORS, MECH_H } from './mech.js';
import { analyze, matchSettings, render, rgb2lab, hex2rgb } from './paint.js';
import { FRAMES, WEAPONS, SLOTS, DEFAULT_BUILD, AI_STYLES, stats } from './data.js';
import { storeMode, listMechs, getMech, saveMech, deleteMech, importLocal, askPersist } from './store.js';

const $ = id => document.getElementById(id);

// ---------- 3D表示 ----------
const canvas = $('hv');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.9;
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x141b26);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.5;
scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x30281f, 0.8));
const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(6, 12, 9); key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
Object.assign(key.shadow.camera, { left: -6, right: 6, top: 10, bottom: -2 }); scene.add(key);
const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 200);
camera.position.set(6, 5, 11);
const controls = new OrbitControls(camera, canvas); controls.target.set(0, 3, 0); controls.enableDamping = true;
const floor = new THREE.Mesh(new THREE.CircleGeometry(8, 64), new THREE.MeshStandardMaterial({ color: 0x232c3a, roughness: 0.9 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const grid = new THREE.GridHelper(16, 16, 0x3c4a60, 0x2a3446); grid.position.y = 0.01; scene.add(grid);
// 正面の矢印（+z）
const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0.05, 1.5), 3, 0x4fc3ff, 0.8, 0.5); scene.add(arrow);
function resize() { const r = canvas.parentElement.getBoundingClientRect(); renderer.setSize(r.width, r.height, false); camera.aspect = r.width / r.height; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); new ResizeObserver(resize).observe(canvas.parentElement);

// ---------- 状態 ----------
let mechs = [], cur = null, raw = null, prep = null, an = null, sets = [], rig = null, walking = false, tab = 'orient', selGroup = -1;
let paintMat = null, colorCanvas = null, rmCanvas = null;
const segMats = SEG_COLORS.map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 }));
const fake = { x: 0, y: 0, z: 0, vx: 0, vz: 0, dvx: 0, dvz: 0, vy: 0, yaw: 0, onGround: true, dashT: 0, boosting: false, guarding: false, melee: null, stagger: 0, aim: [0, 0, 1] };

// ---------- 一覧 ----------
async function loadList(selectId) {
  mechs = await listMechs();
  const L = $('list');
  L.innerHTML = mechs.length ? '' : '<p class="note">まだありません。下から取り込みましょう。</p>';
  for (const m of mechs) {
    const d = document.createElement('div'); d.className = 'mi' + (cur?.id === m.id ? ' sel' : '');
    const st = m.hasModel ? (m.build ? '装備済み' : '取り込み済み') : m.status === 'error' ? 'エラー: ' + (m.error || '') : (m.stage || '待機中') + ` ${Math.round((m.progress || 0) * 100)}%`;
    d.innerHTML = `<div>${m.name}</div><div class="s">${st}</div>` + (!m.hasModel && m.status !== 'error' ? `<div class="prog"><i style="width:${(m.progress || 0) * 100}%"></i></div>` : '');
    d.onclick = () => m.hasModel ? open(m.id) : null;
    L.appendChild(d);
  }
  document.body.classList.toggle('nomech', !cur && !selectId);
  if (selectId) open(selectId);
  // 3D化中のものがあれば見張る
  if (mechs.some(m => !m.hasModel && ['queued', 'processing', 'new'].includes(m.status))) setTimeout(() => loadList(), 2000);
}

async function open(id) {
  const m = await getMech(id);
  if (!m?.model) { if (!cur) document.body.classList.add('nomech'); return; }
  cur = m; document.body.classList.remove('nomech');
  cur.orient ||= { x: 0, y: 0, z: 0, yaw: 0, cut: 0, keepMain: true };
  cur.joints = { ...DEFAULT_JOINTS, ...(cur.joints || {}) };
  cur.build ||= { ...DEFAULT_BUILD };
  cur.paint ||= { groups: [] };
  cur.ai ||= 'balance';
  localStorage.setItem('hangar-last', id);
  for (const el of document.querySelectorAll('.mi')) el.classList.remove('sel');
  [...$('list').children][mechs.findIndex(x => x.id === id)]?.classList.add('sel');
  $('mName').value = m.name; $('empty').classList.add('hidden');
  busy('3Dモデルを読みこみ中…');
  raw = await loadRaw(m);
  busy('色を調べています…');
  await new Promise(r => setTimeout(r, 30));
  rebuildGeometry(true);
  busy(null);
  fillPanel();
}
function busy(msg) { $('busy').classList.toggle('hidden', !msg); $('busy').textContent = msg || ''; }

// 向き・床などが変わったら形を作り直す
function rebuildGeometry(repaint) {
  prep = prepareGeometry(raw.geoms, cur.orient);
  $('triInfo').textContent = `三角形 ${prep.triCount.toLocaleString()} 個` + (prep.triCount > 150000 ? '（多め。ゲームが重い時は精細さを下げて取り込み直し）' : '');
  if (repaint || !an) {
    if (raw.tex) {
      an = analyze(raw.tex, [prep.geo], 1024);
      sets = matchSettings(an, cur.paint);
      colorCanvas = document.createElement('canvas'); rmCanvas = document.createElement('canvas');
      render(an, sets, colorCanvas, rmCanvas);
      const map = new THREE.CanvasTexture(colorCanvas); map.colorSpace = THREE.SRGBColorSpace;
      const rm = new THREE.CanvasTexture(rmCanvas);
      paintMat = new THREE.MeshStandardMaterial({ map, roughnessMap: rm, metalnessMap: rm, roughness: 1, metalness: 1 });
    } else { an = null; sets = []; paintMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.5 }); }
  }
  rebuildRig();
}
function rebuildRig() {
  if (rig) rig.root.removeFromParent();
  const seg = tab === 'joint' && !$('jPaintView').checked;
  rig = buildScanRig({ geo: prep.geo.clone() }, seg ? segMats : paintMat, cur.joints);
  if (!cur.joints.hideWeapons && tab === 'equip') equip(rig, cur.build);
  scene.add(rig.root);
}
function repaint() {
  render(an, sets, colorCanvas, rmCanvas);
  paintMat.map.needsUpdate = true; paintMat.roughnessMap.needsUpdate = true;
}

// ---------- パネル ----------
function fillPanel() {
  const o = cur.orient, j = cur.joints;
  $('oYaw').value = o.yaw || 0; $('oCut').value = o.cut || 0; $('oKeep').checked = o.keepMain !== false;
  $('jWaist').value = j.waist; $('jShoulder').value = j.shoulder; $('jArmTop').value = j.armTop; $('jArmBottom').value = j.armBottom; $('jNeck').value = j.neck; $('jHide').checked = !!j.hideWeapons;
  showVals(); renderGroups(); fillEquip();
}
function showVals() {
  $('oYawV').textContent = $('oYaw').value + '°'; $('oCutV').textContent = Math.round($('oCut').value * 100) + '%';
  for (const k of ['Waist', 'Shoulder', 'ArmTop', 'ArmBottom', 'Neck']) $('j' + k + 'V').textContent = Math.round($('j' + k).value * 100) + '%';
}
for (const b of document.querySelectorAll('.tabs button')) b.onclick = () => {
  tab = b.dataset.t;
  for (const x of document.querySelectorAll('.tabs button')) x.classList.toggle('on', x === b);
  for (const t of ['orient', 'joint', 'paint', 'equip']) $('t-' + t).classList.toggle('hidden', t !== tab);
  if (cur && prep) rebuildRig();
};
// 向き
for (const b of document.querySelectorAll('[data-o]')) b.onclick = () => {
  if (!cur) return;
  const o = cur.orient, k = b.dataset.o;
  if (k === 'reset') Object.assign(o, { x: 0, y: 0, z: 0, yaw: 0, cut: 0 });
  else { const ax = k[0], d = k[1] === '+' ? 1 : -1; o[ax] = ((o[ax] || 0) + d + 4) % 4; }
  fillPanel(); rebuildGeometry(false);
};
let slideT = null;
const later = fn => { clearTimeout(slideT); slideT = setTimeout(fn, 120); };
$('oYaw').oninput = () => { showVals(); cur.orient.yaw = Number($('oYaw').value); later(() => rebuildGeometry(false)); };
$('oCut').oninput = () => { showVals(); cur.orient.cut = Number($('oCut').value); later(() => rebuildGeometry(false)); };
$('oKeep').onchange = () => { cur.orient.keepMain = $('oKeep').checked; rebuildGeometry(false); };
// 関節
for (const k of ['Waist', 'Shoulder', 'ArmTop', 'ArmBottom', 'Neck']) $('j' + k).oninput = () => {
  showVals(); cur.joints[k[0].toLowerCase() + k.slice(1)] = Number($('j' + k).value); later(rebuildRig);
};
$('jHide').onchange = () => { cur.joints.hideWeapons = $('jHide').checked; rebuildRig(); };
$('jPaintView').onchange = rebuildRig;

// 塗装
const PRESETS = ['#ecebe6', '#8a8e94', '#3e434b', '#1c1c1f', '#c4232b', '#e0661c', '#f0c419', '#2e8b3e', '#23452c', '#5b5a35', '#5aa8de', '#2456b8', '#1c2a52', '#6b3fa0', '#c9a046', '#c4c7cc'];
function renderGroups() {
  const G = $('groups');
  if (!an) { G.innerHTML = '<p class="note">このモデルには色の画像がないので塗装できません。</p>'; return; }
  G.innerHTML = an.groups.map((g, k) => {
    const s = sets[k];
    return `<div class="grp ${k === selGroup ? 'sel' : ''}" data-k="${k}"><i style="background:${g.hex}"></i><i style="background:${s?.hex || g.hex}"></i><span>${g.name}<br><small class="note">${Math.round(g.share * 100)}%${s?.paintName ? '・' + s.paintName : ''}</small></span><span class="arrow">${s ? '塗装' : ''}</span></div>`;
  }).join('');
  for (const el of G.querySelectorAll('.grp')) el.onclick = () => { selGroup = Number(el.dataset.k); renderGroups(); editGroup(); };
  $('presets').innerHTML = PRESETS.map(h => `<button style="background:${h}" data-h="${h}"></button>`).join('');
  for (const b of $('presets').children) b.onclick = () => setColor(b.dataset.h);
}
function editGroup() {
  const g = an.groups[selGroup], s = sets[selGroup];
  $('gEdit').classList.remove('hidden');
  $('gName').textContent = g.name;
  $('gColor').value = s?.hex || g.hex;
  $('gGloss').value = s?.gloss ?? 0.35; $('gMetal').value = s?.metal ?? 0;
  $('gGlossV').textContent = Math.round($('gGloss').value * 100) + '%'; $('gMetalV').textContent = Math.round($('gMetal').value * 100) + '%';
}
function ensureSet() { if (!sets[selGroup]) sets[selGroup] = { center: an.groups[selGroup].center, hex: null, gloss: 0.35, metal: 0 }; return sets[selGroup]; }
function setColor(hex, paintName = null) { if (selGroup < 0) return; const s = ensureSet(); s.hex = hex; s.paintName = paintName; $('gColor').value = hex; repaint(); renderGroups(); }
$('gColor').oninput = () => setColor($('gColor').value);
$('gGloss').oninput = () => { if (selGroup < 0) return; ensureSet().gloss = Number($('gGloss').value); editGroup(); later(repaint); };
$('gMetal').oninput = () => { if (selGroup < 0) return; ensureSet().metal = Number($('gMetal').value); editGroup(); later(repaint); };
$('gReset').onclick = () => { if (selGroup < 0) return; sets[selGroup] = null; editGroup(); repaint(); renderGroups(); };
$('pAllReset').onclick = () => { if (!an || !confirm('塗装を全部元に戻しますか？')) return; sets = an.groups.map(() => null); repaint(); renderGroups(); };
// 市販の塗料（配色ラボの一覧を借りる）
const PDB = (window.PAINT_DB || []).map(([b, line, code, name, hex, fin]) => ({ label: `${line} ${code} ${name}`, hex, metal: /メタ|シルバー|ゴールド|メッキ|鉄|銅/.test(name + fin) }));
$('pSearch').oninput = () => {
  const q = $('pSearch').value.trim().toLowerCase();
  const hit = q ? PDB.filter(p => p.label.toLowerCase().includes(q)).slice(0, 60) : [];
  $('pList').innerHTML = hit.map((p, i) => `<div data-i="${PDB.indexOf(p)}"><i style="background:${p.hex}"></i>${p.label}</div>`).join('') || (q ? '<span class="note">見つかりません</span>' : '');
  for (const d of $('pList').querySelectorAll('[data-i]')) d.onclick = () => {
    const p = PDB[d.dataset.i]; setColor(p.hex, p.label);
    if (p.metal) { ensureSet().metal = 0.8; ensureSet().gloss = 0.7; editGroup(); repaint(); }
  };
};
if (!PDB.length) $('pSearch').closest('details').classList.add('hidden');

// 装備
function fillEquip() {
  const opt = (obj, keys, v) => keys.map(k => `<option value="${k}" ${k === v ? 'selected' : ''}>${obj[k].name}</option>`).join('');
  $('eFrame').innerHTML = opt(FRAMES, Object.keys(FRAMES), cur.build.frame);
  for (const s of ['R', 'L', 'S']) $('e' + s).innerHTML = opt(WEAPONS, SLOTS[s], cur.build[s]);
  $('eAi').innerHTML = opt(AI_STYLES, Object.keys(AI_STYLES), cur.ai);
  showStats();
}
function showStats() {
  const b = cur.build, st = stats(b);
  $('eDesc').innerHTML = [FRAMES[b.frame].desc, ...['R', 'L', 'S'].map(k => `${WEAPONS[b[k]].name}: ${WEAPONS[b[k]].desc}`)].join('<br>');
  const bar = (v, max) => `<span class="b"><i style="width:${Math.min(100, v / max * 100)}%"></i></span>`;
  $('eStats').innerHTML = `<span>体力 ${st.hp}</span>${bar(st.hp, 12000)}<span>地上の速さ ${st.speed.toFixed(1)}</span>${bar(st.speed, 20)}<span>回避の速さ ${st.dash.toFixed(0)}</span>${bar(st.dash, 50)}<span>エネルギー ${st.en}</span>${bar(st.en, 1200)}<span>武器の重さ ${st.weightSum.toFixed(1)}</span>${bar(st.weightSum, 7)}`;
}
for (const s of ['Frame', 'R', 'L', 'S']) $('e' + s).onchange = () => { cur.build[s === 'Frame' ? 'frame' : s] = $('e' + s).value; showStats(); rebuildRig(); };
$('eAi').onchange = () => { cur.ai = $('eAi').value; };

// 保存
async function save() {
  if (!cur) return;
  const paint = { groups: an ? sets.map((s, k) => s && (s.hex || s.gloss !== 0.35 || s.metal) ? { center: an.groups[k].center, hex: s.hex, gloss: s.gloss, metal: s.metal, paintName: s.paintName || null } : null).filter(Boolean) : [] };
  const body = { name: $('mName').value.trim() || cur.name, orient: cur.orient, joints: cur.joints, paint, build: cur.build, ai: cur.ai };
  const ok = await saveMech(cur.id, body);
  $('saveMsg').textContent = ok ? `保存しました（${new Date().toLocaleTimeString('ja-JP')}）` : '保存に失敗しました';
  if (ok) { cur.paint = paint; cur.name = body.name; loadList(); }
  return ok;
}
$('save').onclick = save;
$('sortie').onclick = async () => { if (!cur) return; if (await save()) { localStorage.setItem('arena-my', cur.id); location.href = './'; } };

// 表示ボタン
$('vFront').onclick = () => { camera.position.set(0, 3.5, 13); controls.target.set(0, 3, 0); };
$('vSide').onclick = () => { camera.position.set(13, 3.5, 0); controls.target.set(0, 3, 0); };
$('vWalk').onclick = () => { walking = !walking; $('vWalk').classList.toggle('on', walking); };

// ---------- 取り込み ----------
$('files').onchange = () => {
  const files = [...$('files').files]; if (!files.length) return;
  const fd = new FormData(); for (const f of files) fd.append('files', f, f.name);
  const name = $('newName').value.trim() || '自分の機体';
  const xhr = new XMLHttpRequest();
  xhr.open('POST', 'api/scan?name=' + encodeURIComponent(name));
  const pg = $('upProg'); pg.classList.remove('hidden');
  xhr.upload.onprogress = e => { pg.firstElementChild.style.width = (e.loaded / e.total * 100) + '%'; };
  xhr.onload = () => {
    pg.classList.add('hidden'); $('files').value = '';
    let r = {}; try { r = JSON.parse(xhr.responseText); } catch {}
    if (xhr.status >= 400) return alert('取り込みに失敗: ' + (r.error || xhr.status));
    loadList(/\.(obj|glb)$/i.test(files.map(f => f.name).join(' ')) ? r.id : null);
  };
  xhr.onerror = () => { pg.classList.add('hidden'); alert('送信に失敗しました'); };
  xhr.send(fd);
};
async function loadExtras() {
  try {
    const info = await (await fetch('api/info')).json();
    if (info.qr) $('qr').innerHTML = `<img src="${info.qr}" alt=""><br>スマホで読むと、スマホの動画をそのまま送れます（同じWi-Fi）<br>${info.urls[0]}`;
    if (!info.engine) $('qr').insertAdjacentHTML('beforeend', '<p class="note" style="color:#ff8a8a">3D化エンジンが見つかりません（スキャン工房の engine/build.sh を実行）</p>');
  } catch {}
  try {
    const l = await (await fetch('api/scan3d')).json();
    $('s3list').innerHTML = l.length ? l.map(x => `<div class="row"><span style="flex:1">${x.name}</span><button class="btn ghost" data-p="${x.id}">取り込む</button></div>`).join('') : 'スキャン工房で作ったモデルはまだありません';
    for (const b of $('s3list').querySelectorAll('[data-p]')) b.onclick = async () => {
      b.disabled = true; const r = await (await fetch('api/scan3d/' + b.dataset.p, { method: 'POST' })).json();
      if (r.id) loadList(r.id); else alert(r.error || '失敗しました');
      b.disabled = false;
    };
  } catch { $('s3list').textContent = '読みこめませんでした'; }
}

// ---------- 毎フレーム ----------
const clock = new THREE.Clock();
function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(0.05, clock.getDelta());
  controls.update();
  if (rig && tab !== 'orient') {
    fake.vz = walking ? 10 : 0; fake.aim = [0, 0, 1];
    animateRig(rig, fake, dt, 0);
    rig.root.position.set(0, 0, 0); rig.root.rotation.set(rig.root.rotation.x, 0, rig.root.rotation.z);
  }
  renderer.render(scene, camera);
}
window.__hangar = { get cur() { return cur; }, get an() { return an; }, get sets() { return sets; }, open, save, scene, camera };
// スマホ版: ファイルを取りこむ・機体を消す
$('files2').onchange = async () => {
  const files = [...$('files2').files]; if (!files.length) return;
  try {
    askPersist();
    const id = await importLocal(files, $('newName').value.trim() || '自分の機体');
    $('files2').value = ''; $('newName').value = '';
    await loadList(id);
  } catch (e) { alert(e.message); }
};
$('del').onclick = async () => {
  if (!cur || !confirm(`「${cur.name}」をこのスマホから消しますか？（元に戻せません）`)) return;
  await deleteMech(cur.id); cur = null; if (rig) rig.root.removeFromParent(); rig = null;
  $('empty').classList.remove('hidden'); localStorage.removeItem('hangar-last'); loadList();
};

if ('serviceWorker' in navigator && location.hostname !== 'localhost') navigator.serviceWorker.register('sw.js').catch(() => {});
resize(); tick();
storeMode().then(m => {
  const phone = m === 'local';
  $('srvOnly').classList.toggle('hidden', phone); $('phoneOnly').classList.toggle('hidden', !phone);
  $('del').classList.toggle('hidden', !phone);
  for (const id of ['qr', 's3box']) $(id).classList.toggle('hidden', phone);
  if (!phone) loadExtras();
});
loadList(new URLSearchParams(location.search).get('id') || localStorage.getItem('hangar-last'));
