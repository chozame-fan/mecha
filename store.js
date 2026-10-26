// 機体の保存場所
// ・Macのサーバーから開いた時 → サーバー（動画からの3D化もできる）
// ・スマホ版（公開ページ）     → スマホの中（IndexedDB）。3Dモデルのファイルを取りこんで使う

let mode = null;
export async function storeMode() {
  if (mode) return mode;
  try {
    const r = await fetch('api/mechs', { cache: 'no-store' });
    mode = r.ok && (r.headers.get('content-type') || '').includes('json') ? 'server' : 'local';
  } catch { mode = 'local'; }
  return mode;
}

// ---------- スマホの中（IndexedDB） ----------
let dbp = null;
function db() {
  return dbp ||= new Promise((res, rej) => {
    const q = indexedDB.open('mecha-arena', 1);
    q.onupgradeneeded = () => q.result.createObjectStore('mechs', { keyPath: 'id' });
    q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
  });
}
async function tx(kind, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction('mechs', kind), s = t.objectStore('mechs');
    const r = fn(s); t.oncomplete = () => res(r?.result); t.onerror = () => rej(t.error);
  });
}
const lget = id => tx('readonly', s => s.get(id));
const lput = m => tx('readwrite', s => s.put(m));
const lall = () => tx('readonly', s => s.getAll());
const newId = () => Date.now().toString(36) + '-' + Math.random().toString(16).slice(2, 8);
const strip = m => { const { files, ...rest } = m; return rest; };

// ---------- 共通の窓口 ----------
export async function listMechs() {
  if (await storeMode() === 'server') return (await fetch('api/mechs')).json();
  const all = (await lall()) || [];
  return all.sort((a, b) => b.created - a.created).map(m => ({ id: m.id, name: m.name, status: 'done', progress: 1, hasModel: !!m.model, build: m.build || null, version: m.version }));
}
export async function getMech(id) {
  if (await storeMode() === 'server') { const r = await fetch('api/mechs/' + id); return r.ok ? r.json() : null; }
  const m = await lget(id); return m ? strip(m) : null;
}
export async function saveMech(id, fields) {
  if (await storeMode() === 'server') {
    const r = await fetch('api/mechs/' + id, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fields) });
    return r.ok;
  }
  const m = await lget(id); if (!m) return false;
  Object.assign(m, JSON.parse(JSON.stringify(fields)), { updated: Date.now() });
  await lput(m); return true;
}
export async function deleteMech(id) {
  if (await storeMode() === 'server') return false;   // Macの機体はここでは消さない
  await tx('readwrite', s => s.delete(id)); return true;
}

// スマホ版: 3Dモデルのファイル（GLB、または OBJ＋MTL＋色の画像）を取りこむ
export async function importLocal(files, name) {
  const by = {}; for (const f of files) by[f.name] = f;
  const names = Object.keys(by);
  const glb = names.find(n => /\.glb$/i.test(n));
  const obj = names.find(n => /\.obj$/i.test(n));
  if (!glb && !obj) throw new Error('GLB か OBJ のファイルを選んでください（Scaniverseなら「Export → GLB」）');
  let texture = null;
  if (obj) {
    const mtl = names.find(n => /\.mtl$/i.test(n));
    if (mtl) { const t = (await by[mtl].text()).match(/map_Kd\s+(.+)/); if (t) texture = t[1].trim().split(/[\\/]/).pop(); }
    if (!texture || !by[texture]) texture = names.find(n => /\.(png|jpe?g)$/i.test(n) && !/norm|ao|rough|metal/i.test(n)) || null;
  }
  const keep = {};
  for (const n of [glb, obj, texture].filter(Boolean)) keep[n] = by[n];
  const m = { id: newId(), name: name || '自分の機体', created: Date.now(), source: 'phone', model: { glb: glb || null, obj: glb ? null : obj, texture: glb ? null : texture }, files: keep, version: 1, scan: { status: 'done' } };
  await lput(m);
  return m.id;
}

// モデルのファイルの場所（スマホ版は一時的なURLを作る）
const urlCache = new Map();
export async function fileUrl(mech, name) {
  if (await storeMode() === 'server') return `mechfiles/${mech.id}/model/${encodeURIComponent(name)}?v=${mech.version || 0}`;
  const key = mech.id + '/' + name;
  if (!urlCache.has(key)) {
    const m = await lget(mech.id);
    const blob = m?.files?.[name]; if (!blob) throw new Error('ファイルがありません: ' + name);
    urlCache.set(key, URL.createObjectURL(blob));
  }
  return urlCache.get(key);
}

// スマホの保存領域が勝手に消されないようにお願いする
export function askPersist() { try { navigator.storage?.persist?.(); } catch {} }
