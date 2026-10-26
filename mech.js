// 機体の見た目: 用意された機体（箱を組んで作る）と、スキャンした自分の機体（関節で切り分けて動かす）
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { analyze, matchSettings, render } from './paint.js';
import { fileUrl } from './store.js';

export const MECH_H = 6;

const geoCache = new Map();
function rbox(w, h, d, r = 0.08) {
  const k = [w, h, d, r].join();
  if (!geoCache.has(k)) geoCache.set(k, new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.2, h / 2.2, d / 2.2)));
  return geoCache.get(k);
}
function mats(colors) {
  const m = (hex, o = {}) => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.45, metalness: 0.15, ...o });
  return {
    main: m(colors.main), sub: m(colors.sub), accent: m(colors.accent, { metalness: 0.35, roughness: 0.35 }),
    frame: m('#2b2d33', { roughness: 0.6, metalness: 0.5 }),
    visor: new THREE.MeshStandardMaterial({ color: colors.visor, emissive: colors.visor, emissiveIntensity: 2.2 }),
    glow: new THREE.MeshBasicMaterial({ color: '#9fdcff' }),
  };
}
function box(parent, mat, w, h, d, x, y, z, r) {
  const mesh = new THREE.Mesh(rbox(w, h, d, r), mat);
  mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true;
  parent.add(mesh); return mesh;
}
const pivot = (parent, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };

// ---------------- 用意された機体 ----------------
// 正面は +z、機体の右手は -x 側
export function buildProcedural(colors, headType = 'v') {
  const M = mats(colors);
  const root = new THREE.Group();
  const hips = pivot(root, 0, 2.95, 0);
  box(hips, M.sub, 1.5, 0.6, 1.0, 0, 0.1, 0);
  box(hips, M.accent, 0.5, 0.45, 0.25, 0, 0.05, 0.52, 0.05);
  const legs = {};
  for (const s of [-1, 1]) {
    const hip = pivot(hips, s * 0.55, -0.1, 0);
    box(hip, M.frame, 0.7, 1.4, 0.8, 0, -0.7, 0);
    box(hip, M.main, 0.85, 1.0, 0.95, 0, -0.75, 0.05);
    const knee = pivot(hip, 0, -1.45, 0);
    box(knee, M.main, 1.0, 1.55, 1.15, 0, -0.75, 0);
    box(knee, M.sub, 0.7, 0.55, 0.3, 0, -0.25, 0.6, 0.06);
    box(knee, M.accent, 0.35, 0.35, 0.3, 0, 0.02, 0.55, 0.06);
    const ankle = pivot(knee, 0, -1.45, 0);
    box(ankle, M.sub, 1.0, 0.38, 1.7, 0, -0.08, 0.15);
    legs[s < 0 ? 'R' : 'L'] = { hip, knee, ankle };
  }
  const body = pivot(hips, 0, 0.35, 0);    // 上半身（狙う向きに回る）
  box(body, M.frame, 1.2, 0.7, 0.85, 0, 0.3, 0);
  const chest = box(body, M.main, 2.2, 1.35, 1.45, 0, 1.2, 0.05, 0.15);
  box(body, M.sub, 1.4, 0.55, 0.35, 0, 1.45, 0.7, 0.06);
  for (const s of [-1, 1]) box(body, M.accent, 0.5, 0.32, 0.2, s * 0.62, 1.48, 0.8, 0.05);
  box(body, M.sub, 1.6, 1.3, 0.8, 0, 1.3, -0.9, 0.12);          // 背中
  const thrusters = [];
  for (const s of [-1, 1]) {
    const t = box(body, M.frame, 0.45, 1.0, 0.45, s * 0.55, 0.9, -1.35, 0.1);
    const f = pivot(body, s * 0.55, 0.35, -1.4); thrusters.push(f);
    void t;
  }
  const neck = pivot(body, 0, 1.95, 0.1);
  const head = new THREE.Group(); neck.add(head);
  box(head, M.main, 0.75, 0.68, 0.8, 0, 0.32, 0, 0.12);
  if (headType === 'mono') {
    box(head, M.frame, 0.66, 0.16, 0.12, 0, 0.32, 0.38, 0.03);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 8), M.visor); eye.position.set(0, 0.32, 0.45); head.add(eye);
    box(head, M.sub, 0.1, 0.3, 0.6, 0, 0.72, -0.05, 0.03);
  } else {
    for (const s of [-1, 1]) {
      const e = box(head, M.visor, 0.2, 0.07, 0.06, s * 0.15, 0.36, 0.41, 0.02); e.rotation.z = s * -0.18;
      const fin = box(head, M.accent, 0.62, 0.07, 0.05, s * 0.3, 0.78, 0.36, 0.02); fin.rotation.z = s * 0.55;
    }
    box(head, M.accent, 0.16, 0.16, 0.08, 0, 0.62, 0.4, 0.03);
    box(head, M.sub, 0.18, 0.12, 0.1, 0, 0.12, 0.42, 0.03);
  }
  const arms = {};
  for (const s of [-1, 1]) {
    const sh = pivot(body, s * 1.45, 1.55, 0);
    box(sh, M.main, 1.0, 0.85, 1.15, s * 0.15, 0.05, 0, 0.14);
    box(sh, M.accent, 0.12, 0.5, 0.9, s * 0.67, 0.05, 0, 0.04);
    box(sh, M.frame, 0.5, 1.0, 0.55, s * 0.1, -0.75, 0);
    const el = pivot(sh, s * 0.1, -1.25, 0);
    box(el, M.main, 0.72, 1.1, 0.78, 0, -0.5, 0.02);
    const hand = pivot(el, 0, -1.2, 0.15);
    box(hand, M.frame, 0.42, 0.42, 0.45, 0, 0.05, -0.1, 0.08);
    arms[s < 0 ? 'R' : 'L'] = { sh, el, hand };
  }
  root.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return finishRig({ root, hips, body, neck, head, legs, arms, thrusters, kind: 'proc', chest });
}

// ---------------- スキャンした機体 ----------------
export async function loadScanMech(mech) {
  const raw = await loadRaw(mech);
  const prep = prepareGeometry(raw.geoms, mech.orient || {});
  return { prep, tex: raw.tex, geoms: [prep.geo] };
}
// 読みこんだまま（向きなどを直す前）の形と色の画像
export async function loadRaw(mech) {
  let geoms = [], tex = null;
  if (mech.model.glb) {
    const g = await new GLTFLoader().loadAsync(await fileUrl(mech, mech.model.glb));
    g.scene.updateMatrixWorld(true);
    g.scene.traverse(o => {
      if (!o.isMesh) return;
      const gg = o.geometry.clone(); gg.applyMatrix4(o.matrixWorld);
      // GLB は画像の上下の扱いがOBJと逆なので、OBJと同じ向きにそろえる
      const uv = gg.attributes.uv; if (uv) for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
      geoms.push(gg); if (!tex && o.material?.map) tex = o.material.map.image;
    });
  } else {
    const obj = await new OBJLoader().loadAsync(await fileUrl(mech, mech.model.obj));
    obj.traverse(o => { if (o.isMesh) geoms.push(o.geometry); });
  }
  if (!tex && mech.model.texture) tex = await loadImage(await fileUrl(mech, mech.model.texture));
  return { geoms, tex };
}
function loadImage(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }

// 向きをそろえ、床を消して、高さ6mに合わせる
export function prepareGeometry(geoms, orient) {
  let parts = geoms.map(g => {
    let x = g.index ? g.toNonIndexed() : g.clone();
    for (const k of Object.keys(x.attributes)) if (!['position', 'normal', 'uv'].includes(k)) x.deleteAttribute(k);
    if (!x.attributes.uv) x.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(x.attributes.position.count * 2), 2));
    if (!x.attributes.normal) x.computeVertexNormals();
    return x;
  });
  let geo = parts.length > 1 ? BufferGeometryUtils.mergeGeometries(parts) : parts[0];
  const e = new THREE.Euler((orient.x || 0) * Math.PI / 2, 0, (orient.z || 0) * Math.PI / 2, 'XYZ');
  geo.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(e));
  geo.applyMatrix4(new THREE.Matrix4().makeRotationY(((orient.y || 0) * 90 + (orient.yaw || 0)) * Math.PI / 180));
  geo.computeBoundingBox();
  let bb = geo.boundingBox;
  // 床（台）を消す
  const cut = orient.cut || 0;
  if (cut > 0) geo = filterTris(geo, (ay, by, cy) => Math.min(ay, by, cy) > bb.min.y + (bb.max.y - bb.min.y) * cut);
  if (orient.keepMain !== false) geo = largestPiece(geo);
  geo.computeBoundingBox(); bb = geo.boundingBox;
  const s = MECH_H / Math.max(1e-6, bb.max.y - bb.min.y);
  const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
  geo.applyMatrix4(new THREE.Matrix4().makeScale(s, s, s).multiply(new THREE.Matrix4().makeTranslation(-cx, -bb.min.y, -cz)));
  geo.computeBoundingBox();
  return { geo, triCount: geo.attributes.position.count / 3 };
}
function filterTris(geo, keep) {
  const p = geo.attributes.position, n = p.count / 3, sel = [];
  for (let t = 0; t < n; t++) if (keep(p.getY(t * 3), p.getY(t * 3 + 1), p.getY(t * 3 + 2), t)) sel.push(t);
  return subset(geo, sel);
}
function subset(geo, tris) {
  const out = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(geo.attributes)) {
    const sz = a.itemSize, arr = new Float32Array(tris.length * 3 * sz);
    tris.forEach((t, i) => arr.set(a.array.subarray(t * 3 * sz, t * 3 * sz + 3 * sz), i * 3 * sz));
    out.setAttribute(k, new THREE.BufferAttribute(arr, sz));
  }
  return out;
}
// つながっている一番大きなかたまりだけ残す（スキャンのゴミ取り）
function largestPiece(geo) {
  const p = geo.attributes.position, n = p.count / 3;
  if (!n) return geo;
  geo.computeBoundingBox();
  const sz = geo.boundingBox.getSize(new THREE.Vector3()).length() * 1e-4;
  const key = i => `${Math.round(p.getX(i) / sz)},${Math.round(p.getY(i) / sz)},${Math.round(p.getZ(i) / sz)}`;
  const id = new Map(), parent = [];
  const find = a => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const vid = new Int32Array(p.count);
  for (let i = 0; i < p.count; i++) { const k = key(i); let v = id.get(k); if (v === undefined) { v = parent.length; parent.push(v); id.set(k, v); } vid[i] = v; }
  for (let t = 0; t < n; t++) { const a = find(vid[t * 3]); for (let k = 1; k < 3; k++) { const b = find(vid[t * 3 + k]); if (a !== b) parent[b] = a; } }
  const size = new Map();
  for (let t = 0; t < n; t++) { const r = find(vid[t * 3]); size.set(r, (size.get(r) || 0) + 1); }
  let best = -1, bs = 0; for (const [r, c] of size) if (c > bs) { bs = c; best = r; }
  if (bs > n * 0.97) return geo;
  // ある程度大きなかたまり（全体の1.5%以上）は残す（武器や盾が別パーツの場合）
  const keepSet = new Set([...size].filter(([, c]) => c >= n * 0.015 || c === bs).map(([r]) => r));
  const sel = []; for (let t = 0; t < n; t++) if (keepSet.has(find(vid[t * 3]))) sel.push(t);
  return subset(geo, sel);
}

export const DEFAULT_JOINTS = { neck: 0.8, waist: 0.5, shoulder: 0.55, armTop: 0.86, armBottom: 0.3 };

// 関節の高さで三角形を5つ（胴・右腕・左腕・右脚・左脚）に分ける
export function segment(geo, J) {
  const p = geo.attributes.position, n = p.count / 3;
  const bb = geo.boundingBox, halfW = Math.max(-bb.min.x, bb.max.x) || 1;
  const lab = new Uint8Array(n);   // 0胴 1右腕 2左腕 3右脚 4左脚
  for (let t = 0; t < n; t++) {
    const x = (p.getX(t * 3) + p.getX(t * 3 + 1) + p.getX(t * 3 + 2)) / 3;
    const y = (p.getY(t * 3) + p.getY(t * 3 + 1) + p.getY(t * 3 + 2)) / 3 / MECH_H;
    const xn = x / halfW;
    // 腕は体の外側（手は腰より下まで下がるので、脚より先に判定する）
    if (Math.abs(xn) > J.shoulder && y < J.armTop && y > (J.armBottom ?? 0.3)) lab[t] = x < 0 ? 1 : 2;
    else if (y < J.waist) lab[t] = x < 0 ? 3 : 4;
    else lab[t] = 0;
  }
  return { lab, halfW };
}

export function buildScanRig(prep, material, J = DEFAULT_JOINTS) {
  const { geo } = prep;
  const { lab, halfW } = segment(geo, J);
  const n = lab.length, lists = [[], [], [], [], []];
  for (let t = 0; t < n; t++) lists[lab[t]].push(t);
  const parts = lists.map(l => subset(geo, l));
  const root = new THREE.Group();
  const H = MECH_H;
  const hips = pivot(root, 0, J.waist * H, 0);
  const body = pivot(hips, 0, 0, 0);
  // パーツの頂点は全体の座標のまま。関節(piv)の中では「関節の位置だけ戻す」ことで元の場所に表示され、関節まわりで回る
  let partNo = 0;
  const add = (parent, g, px, py, pz) => {
    const piv = pivot(parent, px, py, pz);
    root.updateMatrixWorld(true);
    const wp = piv.getWorldPosition(new THREE.Vector3());
    const m = new THREE.Mesh(g, Array.isArray(material) ? material[partNo] : material); m.castShadow = true; m.receiveShadow = true;
    m.position.copy(wp).negate(); piv.add(m); return piv;
  };
  // 胴
  partNo = 0; const torso = add(body, parts[0], 0, 0, 0);
  // 腕: 肩の関節 = 腕パーツの内側上あたり
  const arms = {}, legs = {};
  for (const [i, side] of [[1, 'R'], [2, 'L']]) {
    const g = parts[i]; g.computeBoundingBox(); const b = g.boundingBox;
    const s = side === 'R' ? -1 : 1;
    if (g.attributes.position.count === 0) { arms[side] = { sh: pivot(body, s * halfW * 0.8, (J.armTop - J.waist) * H * 0.9, 0) }; arms[side].hand = pivot(arms[side].sh, 0, -2, 0.3); continue; }
    const px = s * Math.max(halfW * J.shoulder, Math.min(Math.abs(b.min.x), Math.abs(b.max.x)) + 0.15);
    const py = b.max.y - Math.min(0.6, (b.max.y - b.min.y) * 0.18) - J.waist * H;
    partNo = i; const sh = add(body, g, px, py, (b.min.z + b.max.z) / 2);
    // 手 = 腕の一番下の中心
    const hand = pivot(sh, (b.min.x + b.max.x) / 2 - px, b.min.y - J.waist * H - py + 0.35, b.max.z - (b.min.z + b.max.z) / 2);
    arms[side] = { sh, hand };
  }
  for (const [i, side] of [[3, 'R'], [4, 'L']]) {
    const g = parts[i]; g.computeBoundingBox(); const b = g.boundingBox;
    const s = side === 'R' ? -1 : 1;
    const px = g.attributes.position.count ? (b.min.x + b.max.x) / 2 : s * halfW * 0.3;
    partNo = i; const hip = add(hips, g, px, -0.15, 0);
    legs[side] = { hip };
  }
  const head = pivot(body, 0, (J.neck - J.waist) * H, 0);
  const thrusters = [pivot(body, -0.5, (J.neck - J.waist) * H * 0.5, -halfW * 0.35), pivot(body, 0.5, (J.neck - J.waist) * H * 0.5, -halfW * 0.35)];
  void torso;
  return finishRig({ root, hips, body, neck: head, head, legs, arms, thrusters, kind: 'scan', lab });
}

// 塗装をあてた材質
export function paintedMaterial(tex, geoms, paint) {
  if (!tex) return { mat: new THREE.MeshStandardMaterial({ color: '#cccccc', roughness: 0.5 }), an: null };
  const an = analyze(tex, geoms, 1024);
  const sets = matchSettings(an, paint);
  const cc = document.createElement('canvas'), rc = document.createElement('canvas');
  render(an, sets, cc, rc);
  const map = new THREE.CanvasTexture(cc); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
  const rm = new THREE.CanvasTexture(rc);
  const mat = new THREE.MeshStandardMaterial({ map, roughnessMap: rm, metalnessMap: rm, roughness: 1, metalness: 1, envMapIntensity: 1 });
  return { mat, an, sets, cc, rc, map, rm };
}

// ---------------- 武器 ----------------
const WMAT = {
  dark: new THREE.MeshStandardMaterial({ color: '#33363d', roughness: 0.5, metalness: 0.6 }),
  gray: new THREE.MeshStandardMaterial({ color: '#7b808a', roughness: 0.45, metalness: 0.4 }),
  white: new THREE.MeshStandardMaterial({ color: '#d9dce0', roughness: 0.4, metalness: 0.1 }),
  red: new THREE.MeshStandardMaterial({ color: '#b83a32', roughness: 0.4 }),
  lens: new THREE.MeshStandardMaterial({ color: '#30d0ff', emissive: '#30d0ff', emissiveIntensity: 1.5 }),
};
export function buildWeapon(id) {
  const g = new THREE.Group();
  const B = (m, w, h, d, x, y, z) => box(g, m, w, h, d, x, y, z, 0.04);
  const cyl = (m, r, l, x, y, z) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, l, 12), m); c.rotation.x = Math.PI / 2; c.position.set(x, y, z); c.castShadow = true; g.add(c); return c; };
  switch (id) {
    case 'rifle': B(WMAT.white, 0.32, 0.45, 1.6, 0, 0, 0.5); B(WMAT.dark, 0.2, 0.5, 0.25, 0, -0.35, 0.1); cyl(WMAT.dark, 0.09, 1.0, 0, 0.05, 1.7); B(WMAT.gray, 0.12, 0.18, 0.6, 0, 0.32, 0.6); g.userData.muzzle = 2.2; break;
    case 'mg': B(WMAT.dark, 0.38, 0.5, 1.3, 0, 0, 0.4); cyl(WMAT.gray, 0.28, 0.4, 0, -0.35, 0.5); cyl(WMAT.dark, 0.08, 0.8, 0, 0.06, 1.4); g.userData.muzzle = 1.8; break;
    case 'bazooka': cyl(WMAT.gray, 0.3, 2.6, 0, 0.15, 0.6); cyl(WMAT.dark, 0.36, 0.3, 0, 0.15, 1.9); B(WMAT.dark, 0.2, 0.45, 0.3, 0, -0.3, 0.2); g.userData.muzzle = 2.0; break;
    case 'sniper': B(WMAT.dark, 0.3, 0.42, 1.8, 0, 0, 0.5); cyl(WMAT.gray, 0.07, 1.8, 0, 0.05, 2.2); cyl(WMAT.lens, 0.1, 0.6, 0, 0.36, 0.5); g.userData.muzzle = 3.1; break;
    case 'handgun': B(WMAT.gray, 0.25, 0.32, 0.9, 0, 0, 0.35); B(WMAT.dark, 0.18, 0.4, 0.2, 0, -0.3, 0.05); g.userData.muzzle = 0.9; break;
    case 'shield': { const s = B(WMAT.white, 0.18, 2.2, 1.4, 0.35, -0.3, 0.1); s.rotation.x = 0.1; B(WMAT.red, 0.2, 1.4, 0.7, 0.42, -0.2, 0.12); g.userData.shield = s; break; }
    case 'saber': {
      B(WMAT.white, 0.2, 0.2, 0.55, 0, 0, 0.1);
      const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 3.2, 10), new THREE.MeshBasicMaterial({ color: '#ff8ae0' }));
      blade.rotation.x = Math.PI / 2; blade.position.z = 1.9; blade.visible = false; g.add(blade); g.userData.blade = blade; break;
    }
    case 'missile': B(WMAT.white, 1.0, 0.75, 1.1, 0, 0, 0); for (let i = 0; i < 4; i++) cyl(WMAT.dark, 0.12, 0.1, -0.25 + (i % 2) * 0.5, 0.18 - (i >> 1) * 0.36, 0.56); break;
    case 'cannon': B(WMAT.gray, 0.6, 0.6, 1.0, 0, 0, -0.2); cyl(WMAT.dark, 0.16, 2.6, 0, 0.05, 1.4); g.userData.muzzle = 2.7; break;
  }
  return g;
}

function finishRig(r) {
  r.t = 0; r.walk = 0; r.weapons = {};
  r.flames = r.thrusters.map(t => {
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.6, 10, 1, true), new THREE.MeshBasicMaterial({ color: '#7fd0ff', transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    f.rotation.x = Math.PI; f.position.y = -0.8; t.add(f); f.visible = false; return f;
  });
  return r;
}

// 武器を手と肩につける
export function equip(rig, build) {
  for (const w of Object.values(rig.weapons)) w.removeFromParent();
  rig.weapons = {};
  // 手の武器は「腕を下ろした時に下向き」に持たせる → 腕を前に上げると前を向く
  const inHand = (w, hand) => { hand.add(w); w.rotation.x = Math.PI / 2; w.position.set(0, -0.1, 0); };
  if (build.R) { const w = buildWeapon(build.R); inHand(w, rig.arms.R.hand); rig.weapons.R = w; }
  if (build.L) {
    const w = buildWeapon(build.L);
    if (build.L === 'shield') { (rig.arms.L.el || rig.arms.L.hand).add(w); w.position.set(0.2, build.L === 'shield' && rig.arms.L.el ? -0.4 : 0.3, 0); }
    else inHand(w, rig.arms.L.hand);
    rig.weapons.L = w;
  }
  if (build.S && build.S !== 'none') {
    const w = buildWeapon(build.S);
    rig.body.add(w);
    const top = rig.kind === 'proc' ? 2.3 : rig.neck.position.y + 0.2;
    w.position.set(0.9, top, -0.6);
    rig.weapons.S = w;
  }
}

// 毎フレームの動き（m はシミュレーションの機体）
export function animateRig(rig, m, dt, aimPitch = 0) {
  rig.t += dt;
  const c = Math.cos(m.yaw), s = Math.sin(m.yaw);
  const fwd = (m.vx + m.dvx) * s + (m.vz + m.dvz) * c;          // 前後の速さ
  const side = (m.vx + m.dvx) * c - (m.vz + m.dvz) * s;         // 左右
  const sp = Math.hypot(m.vx, m.vz);
  const ground = m.onGround && m.dashT <= 0;
  if (ground) rig.walk += dt * sp * 0.45;
  const sw = ground ? Math.sin(rig.walk) * Math.min(1, sp / 10) * 0.55 : 0;
  const air = !m.onGround || m.dashT > 0;
  const lean = Math.max(-0.35, Math.min(0.35, fwd * 0.012 * (air ? 1.5 : 1)));
  const roll = Math.max(-0.3, Math.min(0.3, -side * 0.01));
  rig.root.rotation.x = THREE.MathUtils.lerp(rig.root.rotation.x, lean, 1 - Math.exp(-10 * dt));
  rig.root.rotation.z = THREE.MathUtils.lerp(rig.root.rotation.z, roll, 1 - Math.exp(-10 * dt));
  const L = rig.legs;
  const airLeg = air ? 0.35 : 0;
  if (L.R.hip) { L.R.hip.rotation.x = -sw * Math.sign(fwd || 1) - airLeg * 0.6; L.L.hip.rotation.x = sw * Math.sign(fwd || 1) - airLeg; }
  if (L.R.knee) { L.R.knee.rotation.x = Math.max(0, sw) * 0.9 + airLeg * 1.4; L.L.knee.rotation.x = Math.max(0, -sw) * 0.9 + airLeg * 0.8; }
  rig.hips.position.y = (rig.baseHipY ??= rig.hips.position.y) - Math.abs(Math.sin(rig.walk)) * 0.08 * Math.min(1, sp / 10);
  // 上半身: 上下に狙う
  rig.body.rotation.x = THREE.MathUtils.lerp(rig.body.rotation.x, -aimPitch * 0.35, 1 - Math.exp(-12 * dt));
  // 右腕は銃を構える
  const A = rig.arms;
  const melee = m.melee;
  if (A.R.sh) { A.R.sh.rotation.x = THREE.MathUtils.lerp(A.R.sh.rotation.x, -Math.PI / 2 + 0.15 - aimPitch * 0.65, 1 - Math.exp(-14 * dt)); A.R.sh.rotation.z = 0; }
  if (A.R.el) A.R.el.rotation.x = 0;
  if (A.L.sh) {
    let want = m.guarding ? -1.25 : -0.25 + sw * 0.4;
    if (melee) want = melee.t < 0.3 ? -2.6 : -0.3 + Math.min(1, (melee.t - 0.3) * 4) * 1.2;
    A.L.sh.rotation.x = THREE.MathUtils.lerp(A.L.sh.rotation.x, want, 1 - Math.exp(-(melee ? 30 : 12) * dt));
    A.L.sh.rotation.z = m.guarding ? -0.5 : 0;
    if (A.L.el) A.L.el.rotation.x = m.guarding ? -0.9 : melee ? -0.2 : -0.3;
  }
  if (rig.weapons.L?.userData.blade) rig.weapons.L.userData.blade.visible = !!melee;
  // ブーストの炎
  const boost = m.boosting || m.dashT > 0;
  for (const f of rig.flames) { f.visible = boost; f.scale.set(1, m.dashT > 0 ? 2.2 : 1 + Math.random() * 0.3, 1); }
  // よろけ
  rig.hips.position.x = m.stagger > 0 ? (Math.random() - 0.5) * 0.15 : 0;
}

// 毎回同じ部品番号で関節の分け方を色で見せる（格納庫用）
export const SEG_COLORS = ['#c9ccd3', '#ff5a5a', '#5a9bff', '#ffb43a', '#4fd18b'];
