// 戦いの中身（画面を使わない）。ブラウザでも Node でも同じ結果になるので、AI同士の総当たりにも使う
import { WEAPONS, stats, AI_STYLES } from './data.js';

export const ARENA_R = 125;
const G = 30;            // 重力
const H = 6;             // 機体の高さ
const R = 1.7;           // 機体の太さ
const MAX_ALT = 34;
const TIME_LIMIT = 180;

export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// 柱（神殿風アリーナ）
export function makeArena() {
  const pillars = [];
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2 + Math.PI / 8; pillars.push({ x: Math.cos(a) * 42, z: Math.sin(a) * 42, r: 3.2, h: 26 }); }
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; pillars.push({ x: Math.cos(a) * 82, z: Math.sin(a) * 82, r: 5.5, h: 14 }); }
  pillars.push({ x: 0, z: 0, r: 7, h: 9 });
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + Math.PI / 6; pillars.push({ x: Math.cos(a) * 100, z: Math.sin(a) * 100, r: 2.6, h: 32 }); }
  return { pillars };
}

const len2 = (x, z) => Math.hypot(x, z);
function norm3(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }

// 線分と柱がぶつかるか（ぶつかる位置 0..1 を返す）
function segPillar(ax, ay, az, bx, by, bz, p) {
  const dx = bx - ax, dz = bz - az;
  const fx = ax - p.x, fz = az - p.z;
  const a = dx * dx + dz * dz, b = 2 * (fx * dx + fz * dz), c = fx * fx + fz * fz - p.r * p.r;
  let t;
  if (c <= 0) t = 0;
  else {
    if (a < 1e-9) return -1;
    const disc = b * b - 4 * a * c; if (disc < 0) return -1;
    t = (-b - Math.sqrt(disc)) / (2 * a);
    if (t < 0 || t > 1) return -1;
  }
  const y = ay + (by - ay) * t;
  return y <= p.h ? t : -1;
}
export function lineBlocked(world, a, b) {
  for (const p of world.pillars) if (segPillar(a[0], a[1], a[2], b[0], b[1], b[2], p) >= 0) return true;
  return false;
}

// 線分 P0P1 と 機体の縦の軸（カプセル）の一番近い距離
function segCapsule(p0, p1, m) {
  const ax = m.x, az = m.z, ay0 = m.y + 0.8, ay1 = m.y + H - 0.6;
  let best = 1e9, bt = 0;
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    const x = p0[0] + (p1[0] - p0[0]) * t, y = p0[1] + (p1[1] - p0[1]) * t, z = p0[2] + (p1[2] - p0[2]) * t;
    const cy = Math.max(ay0, Math.min(ay1, y));
    const d = Math.hypot(x - ax, y - cy, z - az);
    if (d < best) { best = d; bt = t; }
  }
  return { d: best, t: bt };
}

function makeMech(spec, i, total) {
  const st = stats(spec.build);
  const a = i / total * Math.PI * 2 + Math.PI / 2;
  const ammo = {};
  for (const k of ['R', 'L', 'S']) { const w = WEAPONS[spec.build[k]]; ammo[k] = { n: w?.mag || 0, cd: 0, reload: 0 }; }
  return {
    id: spec.id ?? i, name: spec.name || '機体' + (i + 1), team: spec.team ?? i, build: { ...spec.build }, st,
    control: spec.ai ? 'ai' : 'player', aiStyle: AI_STYLES[spec.ai] || AI_STYLES.balance, aiOver: spec.aiParams || null,
    x: Math.cos(a) * 70, y: 0, z: Math.sin(a) * 70, vx: 0, vy: 0, vz: 0, yaw: a + Math.PI, aim: [0, 0, 1],
    hp: st.hp, en: st.en, overheat: 0, dashCd: 0, dashT: 0, dvx: 0, dvz: 0, stagger: 0, impact: 0,
    guarding: false, melee: null, ammo, onGround: true, boosting: false, alive: true, target: null,
    stat: { dmgDealt: 0, shots: 0, hits: 0, dodges: 0 }, brain: null, moveDir: [0, 0],
  };
}

export function createBattle({ mechs, seed = 1 }) {
  const world = makeArena();
  const S = { t: 0, world, mechs: mechs.map((m, i) => makeMech(m, i, mechs.length)), shots: [], events: [], rand: rng(seed), over: false, winner: null };
  for (const m of S.mechs) m.yaw = Math.atan2(-m.x, -m.z);
  return S;
}

const emptyInput = { move: [0, 0], aim: null, jump: false, dash: false, fire: [false, false, false] };

export function step(S, inputs, dt = 1 / 60) {
  if (S.over) return;
  S.t += dt;
  for (const m of S.mechs) {
    if (!m.alive) continue;
    const inp = m.control === 'ai' ? think(S, m, dt) : (inputs?.[m.id] || emptyInput);
    updateMech(S, m, inp, dt);
  }
  // 機体どうしの押し合い
  for (let i = 0; i < S.mechs.length; i++) for (let j = i + 1; j < S.mechs.length; j++) {
    const a = S.mechs[i], b = S.mechs[j]; if (!a.alive || !b.alive) continue;
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
    if (d < R * 2 && Math.abs(a.y - b.y) < H) { const p = (R * 2 - d) / 2 / (d || 1); a.x -= dx * p; a.z -= dz * p; b.x += dx * p; b.z += dz * p; }
  }
  updateShots(S, dt);
  // 決着
  const teams = new Set(S.mechs.filter(m => m.alive).map(m => m.team));
  if (teams.size <= 1) { S.over = true; S.winner = [...teams][0] ?? null; S.events.push({ type: 'end', winner: S.winner }); }
  else if (S.t >= TIME_LIMIT) {
    // 時間切れ: 残り体力の割合が多い方
    const score = {};
    for (const m of S.mechs) score[m.team] = (score[m.team] || 0) + (m.alive ? m.hp / m.st.hp : 0);
    const best = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
    S.over = true; S.winner = Number(best[0]); S.timeout = true; S.events.push({ type: 'end', winner: S.winner, timeout: true });
  }
}

function updateMech(S, m, inp, dt) {
  const st = m.st;
  m.dashCd = Math.max(0, m.dashCd - dt);
  m.stagger = Math.max(0, m.stagger - dt);
  m.impact = Math.max(0, m.impact - 45 * dt);
  for (const k of ['R', 'L', 'S']) {
    const a = m.ammo[k]; a.cd = Math.max(0, a.cd - dt);
    if (a.reload > 0) { a.reload -= dt; if (a.reload <= 0) a.n = WEAPONS[m.build[k]].mag; }
  }
  if (inp.aim) m.aim = norm3(inp.aim);
  const stunned = m.stagger > 0;
  // 向き: 狙っている方へ体を向ける
  if (!stunned) {
    const want = Math.atan2(m.aim[0], m.aim[2]);
    let d = want - m.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    m.yaw += Math.max(-8 * dt, Math.min(8 * dt, d)) * (m.melee ? 0 : 1) + (m.melee ? 0 : 0);
  }
  // 近接攻撃中
  if (m.melee) { meleeUpdate(S, m, dt); }

  // 移動
  let mx = stunned || m.melee ? 0 : inp.move[0], mz = stunned || m.melee ? 0 : inp.move[1];
  const ml = Math.hypot(mx, mz); if (ml > 1) { mx /= ml; mz /= ml; }
  m.moveDir = [mx, mz];
  m.guarding = !stunned && !m.melee && WEAPONS[m.build.L]?.kind === 'shield' && inp.fire[1] && m.en > 0 && m.overheat <= 0;
  const spd = (m.onGround ? st.speed : st.airSpeed) * (m.guarding ? 0.45 : 1);
  const acc = m.onGround ? 10 : 4;
  m.vx += (mx * spd - m.vx) * Math.min(1, acc * dt);
  m.vz += (mz * spd - m.vz) * Math.min(1, acc * dt);
  // クイックブースト（回避）
  if (inp.dash && !stunned && !m.melee && m.dashCd <= 0 && m.en >= 160 && m.overheat <= 0) {
    let dx = mx, dz = mz;
    if (Math.hypot(dx, dz) < 0.2) { dx = -Math.sin(m.yaw); dz = -Math.cos(m.yaw); } // 入力なし → 後ろへ
    const l = Math.hypot(dx, dz); dx /= l; dz /= l;
    m.dvx = dx * st.dash; m.dvz = dz * st.dash; m.dashT = 0.32; m.dashCd = 0.4; m.en -= 160;
    S.events.push({ type: 'dash', id: m.id, dx, dz });
  }
  if (m.dashT > 0) { m.dashT -= dt; const k = Math.exp(-7 * dt); m.dvx *= k; m.dvz *= k; } else { m.dvx = 0; m.dvz = 0; }
  // 上昇（ブースト）
  m.boosting = !stunned && inp.jump && m.en > 0 && m.overheat <= 0 && !m.melee;
  if (m.boosting) { m.vy += (44 - G) * dt; m.vy = Math.min(m.vy, 14); m.en -= 230 * dt; }
  else m.vy -= G * dt;
  if (m.melee) m.vy = Math.max(m.vy, 0) * 0.5;
  m.x += (m.vx + m.dvx) * dt; m.y += m.vy * dt; m.z += (m.vz + m.dvz) * dt;
  if (m.y > MAX_ALT) { m.y = MAX_ALT; m.vy = Math.min(m.vy, 0); }
  // 柱の上に立てる・横からは押し返す
  let ground = 0;
  for (const p of S.world.pillars) {
    const dx = m.x - p.x, dz = m.z - p.z, d = Math.hypot(dx, dz);
    if (d < p.r + R) {
      if (m.y >= p.h - 0.6 && d < p.r + 0.5) { ground = Math.max(ground, p.h); continue; }
      if (m.y < p.h) { const k = (p.r + R - d) / (d || 1); m.x += dx * k; m.z += dz * k; }
    }
  }
  if (m.y <= ground) { m.y = ground; if (m.vy < 0) m.vy = 0; m.onGround = true; } else m.onGround = false;
  const rr = Math.hypot(m.x, m.z);
  if (rr > ARENA_R - R) { m.x *= (ARENA_R - R) / rr; m.z *= (ARENA_R - R) / rr; }
  // エネルギー
  if (m.guarding) m.en -= WEAPONS[m.build.L].drain * dt;
  if (m.en <= 0 && m.overheat <= 0) { m.en = 0; m.overheat = 1.6; S.events.push({ type: 'overheat', id: m.id }); }
  if (m.overheat > 0) { m.overheat -= dt; m.en = Math.min(st.en, m.en + st.regen * 0.25 * dt); }
  else if (!m.boosting && !m.guarding && m.dashT <= 0) m.en = Math.min(st.en, m.en + st.regen * dt * (m.onGround ? 1 : 0.5));

  // 撃つ
  if (!stunned && !m.melee) {
    ['R', 'L', 'S'].forEach((k, i) => { if (inp.fire[i]) fire(S, m, k); });
  }
}

export function enemiesOf(S, m) { return S.mechs.filter(o => o.alive && o.team !== m.team); }
export const center = m => [m.x, m.y + H * 0.55, m.z];

// ロックオン: 狙っている方向に近い敵
export function lockTarget(S, m, cone = 0.5) {
  let best = null, bs = -1;
  for (const o of enemiesOf(S, m)) {
    const c = center(o), d = [c[0] - m.x, c[1] - (m.y + H * 0.7), c[2] - m.z];
    const dist = Math.hypot(...d); if (dist > 170) continue;
    const dot = (d[0] * m.aim[0] + d[1] * m.aim[1] + d[2] * m.aim[2]) / dist;
    if (dot < Math.cos(cone)) continue;
    const s = dot - dist / 1000;
    if (s > bs) { bs = s; best = o; }
  }
  return best;
}

// 弾が当たる位置を先読み
// 先読みはわざと少し不正確（横に動き続ける相手には半分くらい外れる）
function lead(from, tgt, speed, r) {
  const c = center(tgt); let t = Math.hypot(c[0] - from[0], c[1] - from[1], c[2] - from[2]) / speed;
  t = Math.min(t, 1.5) * (0.35 + 0.75 * r);
  return [c[0] + (tgt.vx + tgt.dvx * 0.3) * t, c[1] + tgt.vy * t * 0.5, c[2] + (tgt.vz + tgt.dvz * 0.3) * t];
}

function muzzle(m, k) {
  const s = Math.sin(m.yaw), c = Math.cos(m.yaw);
  const side = k === 'R' ? -1.9 : k === 'L' ? 1.9 : 0.9;   // 右手は機体の右（-x 方向）
  const up = k === 'S' ? H + 0.3 : H * 0.62;
  return [m.x + c * side + s * 1.6, m.y + up, m.z - s * side + c * 1.6];
}

function fire(S, m, k) {
  const w = WEAPONS[m.build[k]]; if (!w || w.kind === 'none' || w.kind === 'shield') return;
  const a = m.ammo[k];
  if (a.cd > 0 || a.reload > 0) return;
  if (w.en && (m.en < w.en || m.overheat > 0)) return;
  const tgt = lockTarget(S, m);
  if (w.kind === 'melee') {
    if (!tgt) return;
    const d = Math.hypot(tgt.x - m.x, tgt.y - m.y, tgt.z - m.z);
    if (d > w.range) return;
    a.cd = w.cd; m.en -= w.en;
    m.melee = { tgt: tgt.id, t: 0, hit: false, w };
    S.events.push({ type: 'melee', id: m.id });
    return;
  }
  if (w.en) m.en -= w.en;
  if (w.mag) { a.n--; if (a.n <= 0) a.reload = w.reload; }
  a.cd = w.cd;
  const p = muzzle(m, k);
  let dir;
  if (tgt && !lineBlocked(S.world, p, center(tgt))) {
    const aimP = w.kind === 'missile' ? center(tgt) : lead(p, tgt, w.speed, S.rand());
    dir = norm3([aimP[0] - p[0], aimP[1] - p[1], aimP[2] - p[2]]);
    // 腕前のぶれ（CPUは性格ごと、プレイヤーは一定）
    const e = m.control === 'ai' ? { ...m.aiStyle, ...(m.aiOver || {}) }.aimErr : 0.025;
    const gn = () => (S.rand() + S.rand() + S.rand() - 1.5) * 1.4 * e;
    if (w.kind !== 'missile') dir = norm3([dir[0] + gn(), dir[1] + gn() * 0.5, dir[2] + gn()]);
    m.stat.lockShots = (m.stat.lockShots || 0) + 1;
  } else dir = m.aim.slice();
  const n = w.count || 1;
  for (let i = 0; i < n; i++) {
    let d = dir.slice();
    if (w.spread) d = norm3([d[0] + (S.rand() - 0.5) * 2 * w.spread, d[1] + (S.rand() - 0.5) * 2 * w.spread, d[2] + (S.rand() - 0.5) * 2 * w.spread]);
    if (w.kind === 'missile') { // 上に開いてから追いかける
      const sx = Math.cos(m.yaw) * (i - (n - 1) / 2) * 0.6;
      d = norm3([d[0] * 0.4 + sx, 0.9, d[2] * 0.4 - Math.sin(m.yaw) * (i - (n - 1) / 2) * 0.6]);
    }
    S.shots.push({ id: (S.shotId = (S.shotId || 0) + 1), owner: m.id, team: m.team, w: m.build[k], kind: w.kind, x: p[0], y: p[1], z: p[2],
      vx: d[0] * w.speed, vy: d[1] * w.speed, vz: d[2] * w.speed, dmg: w.dmg, life: w.range / w.speed * 1.4 + (w.kind === 'missile' ? 1 : 0), age: 0,
      tgt: tgt?.id ?? null, splash: w.splash || 0, impact: w.impact || 0 });
    m.stat.shots++;
  }
  S.events.push({ type: 'fire', id: m.id, slot: k, w: m.build[k], x: p[0], y: p[1], z: p[2] });
}

function meleeUpdate(S, m, dt) {
  const mel = m.melee; mel.t += dt;
  const tgt = S.mechs.find(o => o.id === mel.tgt);
  if (tgt && tgt.alive && !mel.hit && mel.t < 0.42) {
    const dx = tgt.x - m.x, dy = tgt.y - m.y, dz = tgt.z - m.z, d = Math.hypot(dx, dy, dz) || 1;
    m.yaw = Math.atan2(dx, dz);
    const sp = 58;
    if (d > 3.6) { m.x += dx / d * sp * dt; m.y = Math.max(0, m.y + dy / d * sp * dt); m.z += dz / d * sp * dt; m.vx = m.vz = 0; }
    else {
      mel.hit = true;
      damage(S, tgt, mel.w.dmg, mel.w.impact, m, [m.x, m.y + 3, m.z], 'saber');
      S.events.push({ type: 'slash', id: m.id, x: tgt.x, y: tgt.y + 3, z: tgt.z });
    }
  }
  if (mel.t > (mel.hit ? 0.62 : 0.7)) m.melee = null;
}

function damage(S, tgt, dmg, impact, from, src, wname) {
  if (!tgt.alive) return;
  let mult = tgt.st.armor;
  // シールド: 正面（±70°）からの攻撃を減らす
  if (tgt.guarding) {
    const ang = Math.atan2(src[0] - tgt.x, src[2] - tgt.z);
    let d = ang - tgt.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    if (Math.abs(d) < 1.22) { mult *= 1 - WEAPONS[tgt.build.L].block; impact *= 0.3; S.events.push({ type: 'block', id: tgt.id }); }
  }
  const v = Math.round(dmg * mult);
  tgt.hp -= v;
  if (from) { from.stat.dmgDealt += v; from.stat.hits++; }
  tgt.impact += impact / (tgt.st.poise || 1);
  if (tgt.impact >= 100) { tgt.impact = 0; tgt.stagger = 0.55; tgt.melee = null; S.events.push({ type: 'stagger', id: tgt.id }); }
  S.events.push({ type: 'hit', id: tgt.id, dmg: v, w: wname, x: src[0], y: src[1], z: src[2] });
  if (tgt.hp <= 0) { tgt.hp = 0; tgt.alive = false; S.events.push({ type: 'down', id: tgt.id, x: tgt.x, y: tgt.y, z: tgt.z }); }
}

function updateShots(S, dt) {
  const keep = [];
  for (const s of S.shots) {
    s.age += dt;
    if (s.kind === 'missile' && s.age > 0.35 && s.tgt != null) {
      const t = S.mechs.find(o => o.id === s.tgt);
      if (t && t.alive) {
        const c = center(t), sp = Math.hypot(s.vx, s.vy, s.vz);
        const want = norm3([c[0] - s.x, c[1] - s.y, c[2] - s.z]);
        const cur = [s.vx / sp, s.vy / sp, s.vz / sp];
        const tr = WEAPONS.missile.turn * dt;
        const nd = norm3([cur[0] + (want[0] - cur[0]) * tr * 2, cur[1] + (want[1] - cur[1]) * tr * 2, cur[2] + (want[2] - cur[2]) * tr * 2]);
        // 回避で横に大きく動くと追いきれない（真横〜後ろに行ったら追うのをやめる）
        if (cur[0] * want[0] + cur[1] * want[1] + cur[2] * want[2] < 0.25) s.tgt = null;
        s.vx = nd[0] * sp; s.vy = nd[1] * sp; s.vz = nd[2] * sp;
      }
    }
    if (s.kind === 'rocket' || s.kind === 'shell') s.vy -= 3 * dt;
    const p0 = [s.x, s.y, s.z], p1 = [s.x + s.vx * dt, s.y + s.vy * dt, s.z + s.vz * dt];
    let hitT = 2, hitM = null;
    for (const m of S.mechs) {
      if (!m.alive || m.team === s.team) continue;
      const r = segCapsule(p0, p1, m);
      if (r.d < R + (s.kind === 'bullet' ? 0.15 : 0.4) && r.t < hitT) { hitT = r.t; hitM = m; }
    }
    let wallT = 2;
    for (const p of S.world.pillars) { const t = segPillar(...p0, ...p1, p); if (t >= 0 && t < wallT) wallT = t; }
    if (p1[1] <= 0) wallT = Math.min(wallT, p0[1] / Math.max(1e-6, p0[1] - p1[1]));
    const owner = S.mechs.find(o => o.id === s.owner);
    if (hitM && hitT <= wallT) {
      const hp = [p0[0] + (p1[0] - p0[0]) * hitT, p0[1] + (p1[1] - p0[1]) * hitT, p0[2] + (p1[2] - p0[2]) * hitT];
      damage(S, hitM, s.dmg, s.impact, owner, hp, s.w);
      if (s.splash) explode(S, s, hp, hitM);
      continue;
    }
    if (wallT <= 1) {
      const hp = [p0[0] + (p1[0] - p0[0]) * wallT, p0[1] + (p1[1] - p0[1]) * wallT, p0[2] + (p1[2] - p0[2]) * wallT];
      if (s.splash) explode(S, s, hp, null);
      S.events.push({ type: 'impact', kind: s.kind, w: s.w, x: hp[0], y: hp[1], z: hp[2] });
      continue;
    }
    s.x = p1[0]; s.y = p1[1]; s.z = p1[2];
    if (s.age < s.life) keep.push(s);
  }
  S.shots = keep;
}

function explode(S, s, p, direct) {
  S.events.push({ type: 'explode', x: p[0], y: p[1], z: p[2], r: s.splash });
  const owner = S.mechs.find(o => o.id === s.owner);
  for (const m of S.mechs) {
    if (!m.alive || m.team === s.team || m === direct) continue;
    const c = center(m), d = Math.hypot(c[0] - p[0], c[1] - p[1], c[2] - p[2]) - R;
    if (d < s.splash) damage(S, m, s.dmg * 0.6 * (1 - Math.max(0, d) / s.splash), s.impact * 0.5, owner, p, s.w);
  }
}

// ---------------- CPU の頭脳 ----------------
function think(S, m, dt) {
  const st = { ...m.aiStyle, ...(m.aiOver || {}) };
  const b = m.brain || (m.brain = { strafe: S.rand() < 0.5 ? 1 : -1, strafeT: 0, react: 0, seen: new Set(), jumpT: 0, dashWant: false, fireT: 0, guardT: 0 });
  const foes = enemiesOf(S, m);
  const inp = { move: [0, 0], aim: m.aim, jump: false, dash: false, fire: [false, false, false] };
  if (!foes.length) return inp;
  // 一番近い敵
  let tgt = foes[0], bd = 1e9;
  for (const o of foes) { const d = Math.hypot(o.x - m.x, o.z - m.z); if (d < bd) { bd = d; tgt = o; } }
  const c = center(tgt), eye = [m.x, m.y + H * 0.7, m.z];
  const dx = tgt.x - m.x, dz = tgt.z - m.z, dist = Math.hypot(dx, dz) || 1;
  const ux = dx / dist, uz = dz / dist;
  const err = st.aimErr;
  inp.aim = norm3([c[0] - eye[0] + (S.rand() - 0.5) * err * dist, c[1] - eye[1] + (S.rand() - 0.5) * err * dist, c[2] - eye[2] + (S.rand() - 0.5) * err * dist]);
  const los = !lineBlocked(S.world, eye, c);

  // 武器から、ちょうどいい距離
  const ws = ['R', 'L', 'S'].map(k => WEAPONS[m.build[k]]).filter(w => w && w.range);
  const melee = WEAPONS[m.build.L]?.kind === 'melee';
  let pref = ws.length ? ws.reduce((s, w) => s + Math.min(w.range, 130), 0) / ws.length * 0.6 * st.range : 50;
  if (melee && st.range < 0.7) pref = 10;
  pref = Math.max(8, Math.min(110, pref));

  // 横移動（ときどき向きを変える）
  b.strafeT -= dt;
  if (b.strafeT <= 0) { b.strafe = S.rand() < 0.5 ? 1 : -1; b.strafeT = st.strafe * (0.5 + S.rand()); }
  const radial = Math.max(-1, Math.min(1, (dist - pref) / 20));
  const sf = pref < 20 && dist > pref + 10 ? 0.35 : 0.8;   // 接近したい時は横移動を控えめに
  let mx = ux * radial + -uz * b.strafe * sf, mz = uz * radial + ux * b.strafe * sf;
  if (!los) { mx = ux * 0.5 + -uz * b.strafe; mz = uz * 0.5 + ux * b.strafe; } // 柱の陰 → 回りこむ
  inp.move = [mx, mz];

  // 飛んでくる弾を見て避ける（威力が dodgeMin 未満の弾は無視する設計）
  b.react -= dt;
  for (const s of S.shots) {
    if (s.team === m.team || b.seen.has(s.id)) continue;
    const rx = m.x - s.x, ry = m.y + 3 - s.y, rz = m.z - s.z;
    const sp2 = s.vx * s.vx + s.vy * s.vy + s.vz * s.vz;
    const tca = (rx * s.vx + ry * s.vy + rz * s.vz) / sp2;
    if (tca < 0 || tca > 0.6) continue;
    const mxs = rx - s.vx * tca, mys = ry - s.vy * tca, mzs = rz - s.vz * tca;
    if (Math.hypot(mxs, mys, mzs) > 4) continue;
    b.seen.add(s.id);
    if (s.dmg < st.dodgeMin) continue;
    if (S.rand() < st.dodge && m.en > 160 + st.keepEn * 0.3) {
      b.react = st.reaction * (0.6 + S.rand() * 0.8); b.dashDir = S.rand() < 0.5 ? 1 : -1;
      // 弾の進む向きに対して横へ
      const l = Math.hypot(s.vx, s.vz) || 1; b.dashVec = [-s.vz / l * b.dashDir, s.vx / l * b.dashDir]; b.dashWant = true;
    } else if (WEAPONS[m.build.L]?.kind === 'shield' && S.rand() < st.guard) b.guardT = 0.6;
  }
  if (b.seen.size > 400) b.seen = new Set([...b.seen].slice(-200));
  if (b.dashWant && b.react <= 0) { inp.dash = true; inp.move = b.dashVec; b.dashWant = false; m.stat.dodges++; }
  // 接近したいのに遠い → ブーストで詰める
  b.closeT = (b.closeT || 0) - dt;
  if (!inp.dash && pref < 20 && dist > pref + 12 && m.en > 380 && b.closeT <= 0) {
    b.closeT = 0.9 + S.rand() * 0.8; inp.dash = true; inp.move = [ux * 0.85 + -uz * b.strafe * 0.5, uz * 0.85 + ux * b.strafe * 0.5];
  }

  // 上昇
  b.jumpT -= dt;
  if (b.jumpT <= 0) { b.jumpT = 1 + S.rand() * 2; b.jumping = S.rand() < st.jump; }
  if ((b.jumping || tgt.y > m.y + 8) && m.en > st.keepEn) inp.jump = true;

  // 攻撃
  if (los) {
    ['R', 'L', 'S'].forEach((k, i) => {
      const w = WEAPONS[m.build[k]]; if (!w || !w.range) return;
      if (w.kind === 'melee') { inp.fire[i] = dist < w.range * 0.9 && Math.abs(tgt.y - m.y) < 8; return; }
      if (dist > w.range) return;
      if (w.en && m.en < w.en + st.keepEn * 0.5 + (melee && pref < 20 ? 300 : 0)) return;
      inp.fire[i] = true;
    });
  }
  b.guardT -= dt;
  if (b.guardT > 0 && WEAPONS[m.build.L]?.kind === 'shield') inp.fire[1] = true;
  return inp;
}

// 画面なしで1戦（総当たり用）
export function runHeadless(specs, seed, maxT = TIME_LIMIT) {
  const S = createBattle({ mechs: specs, seed });
  while (!S.over && S.t < maxT + 1) { step(S, null, 1 / 30); S.events.length = 0; }
  return { winner: S.winner, t: S.t, timeout: !!S.timeout, mechs: S.mechs.map(m => ({ id: m.id, hp: m.hp, alive: m.alive, ...m.stat })) };
}
