// 塗装（配色ラボと同じ考え方）: 3Dモデルの色の画像を色ごとのグループに分けて、グループ単位で塗り替える
// 影やツヤは元の明るさの差として残すので、塗っても立体感は消えない

const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
const GAM = new Uint8ClampedArray(4097);
for (let i = 0; i <= 4096; i++) { const c = i / 4096; GAM[i] = Math.round((c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255); }
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const fLab = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
export function rgb2lab(r, g, b) {
  const R = LIN[r], G = LIN[g], B = LIN[b];
  const x = fLab((0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047);
  const y = fLab(0.2126729 * R + 0.7151522 * G + 0.0721750 * B);
  const z = fLab((0.0193339 * R + 0.1191920 * G + 0.9503041 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
export function lab2rgb(L, a, b, out, o) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const fx3 = fx * fx * fx, fy3 = fy * fy * fy, fz3 = fz * fz * fz;
  const X = 0.95047 * (fx3 > 0.008856 ? fx3 : (fx - 16 / 116) / 7.787);
  const Y = fy3 > 0.008856 ? fy3 : (fy - 16 / 116) / 7.787;
  const Z = 1.08883 * (fz3 > 0.008856 ? fz3 : (fz - 16 / 116) / 7.787);
  const R = 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z, G = -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z, B = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z;
  out[o] = GAM[clamp(R * 4096 | 0, 0, 4096)]; out[o + 1] = GAM[clamp(G * 4096 | 0, 0, 4096)]; out[o + 2] = GAM[clamp(B * 4096 | 0, 0, 4096)];
}
export const hex2rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
export const rgb2hex = (r, g, b) => '#' + [r, g, b].map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
export function labHex(L, a, b) { const t = [0, 0, 0]; lab2rgb(L, a, b, t, 0); return rgb2hex(...t); }
function mulberry(s) { return () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

const WL = 0.35;   // 明るさの重みを下げる → 影も同じ塗料の仲間になる

function nameOf(L, a, b) {
  const C = Math.hypot(a, b);
  if (C < 10) return L > 80 ? '白' : L > 55 ? '明るい灰' : L > 30 ? '灰' : '黒';
  const h = (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
  // Lab の色相角（HSVとは少しずれる）: 赤≈30° 橙≈60° 黄≈90° 緑≈140° 水色≈210° 青≈290° 紫≈320°
  const n = h < 15 || h >= 350 ? 'ピンク' : h < 45 ? '赤' : h < 70 ? (L < 55 ? '茶' : '橙') : h < 105 ? (L < 55 ? '金/茶' : '黄') : h < 175 ? '緑' : h < 240 ? '水色' : h < 300 ? '青' : '紫';
  return (L < 35 ? '暗い' : '') + n;
}

// 使われている所だけを調べる（UVの三角形を塗った印）
function uvMask(geoms, w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.fillStyle = '#fff';
  for (const geo of geoms) {
    const uv = geo.attributes.uv; if (!uv) continue;
    const idx = geo.index;
    const n = idx ? idx.count : uv.count;
    g.beginPath();
    for (let i = 0; i < n; i += 3) {
      for (let k = 0; k < 3; k++) {
        const v = idx ? idx.getX(i + k) : i + k;
        const x = uv.getX(v) * w, y = (1 - uv.getY(v)) * h;
        k ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.closePath();
    }
    g.fill(); g.lineWidth = 2; g.strokeStyle = '#fff'; g.stroke();
  }
  const d = g.getImageData(0, 0, w, h).data, m = new Uint8Array(w * h);
  for (let i = 0; i < m.length; i++) m[i] = d[i * 4] > 127 ? 1 : 0;
  return m;
}

// 画像 → 色グループ。size は作業する大きさ（最大1024）
export function analyze(img, geoms, size = 1024) {
  const s = Math.min(1, size / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * s)), h = Math.max(1, Math.round(img.height * s));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, w, h);
  const src = g.getImageData(0, 0, w, h);
  const N = w * h, L = new Float32Array(N), A = new Float32Array(N), B = new Float32Array(N);
  const mask = geoms?.length ? uvMask(geoms, w, h) : new Uint8Array(N).fill(1);
  let used = 0;
  for (let i = 0; i < N; i++) {
    const [l, a, b] = rgb2lab(src.data[i * 4], src.data[i * 4 + 1], src.data[i * 4 + 2]);
    L[i] = l; A[i] = a; B[i] = b; used += mask[i];
  }
  if (used < N * 0.02) mask.fill(1);   // UVが読めない時は全部
  // k-means（配色ラボと同じやり方）
  const idx = []; for (let i = 0; i < N; i++) if (mask[i]) idx.push(i);
  const step = Math.max(1, Math.floor(idx.length / 30000));
  const S = []; for (let k = 0; k < idx.length; k += step) { const i = idx[k]; S.push([L[i] * WL, A[i], B[i]]); }
  const rnd = mulberry(42), K = Math.min(8, S.length);
  const dist = (p, q) => { const a = p[0] - q[0], b = p[1] - q[1], c = p[2] - q[2]; return a * a + b * b + c * c; };
  let C = [S[Math.floor(rnd() * S.length)].slice()];
  const D = new Float32Array(S.length).fill(1e9);
  while (C.length < K) {
    let sum = 0; for (let i = 0; i < S.length; i++) { D[i] = Math.min(D[i], dist(S[i], C[C.length - 1])); sum += D[i]; }
    let r = rnd() * sum, i = 0; for (; i < S.length - 1; i++) { r -= D[i]; if (r <= 0) break; } C.push(S[i].slice());
  }
  for (let it = 0; it < 14; it++) {
    const acc = C.map(() => [0, 0, 0, 0]);
    for (const p of S) { let b = 0, bd = 1e18; for (let k = 0; k < C.length; k++) { const dd = dist(p, C[k]); if (dd < bd) { bd = dd; b = k; } } const a = acc[b]; a[0] += p[0]; a[1] += p[1]; a[2] += p[2]; a[3]++; }
    C = C.map((c, k) => acc[k][3] ? [acc[k][0] / acc[k][3], acc[k][1] / acc[k][3], acc[k][2] / acc[k][3], acc[k][3]] : [...c.slice(0, 3), 0]);
  }
  const sameHue = (p, q) => { const c1 = Math.hypot(p[1], p[2]), c2 = Math.hypot(q[1], q[2]); if (c1 < 12 || c2 < 12) return false;
    let dh = Math.abs(Math.atan2(p[2], p[1]) - Math.atan2(q[2], q[1])) * 180 / Math.PI; if (dh > 180) dh = 360 - dh; return dh < 16; };
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < C.length && !merged; i++) for (let j = i + 1; j < C.length && !merged; j++) {
      if (dist(C[i], C[j]) < 100 || sameHue(C[i], C[j])) {
        const n = C[i][3] + C[j][3] || 1; C[i] = [0, 1, 2].map(q => (C[i][q] * C[i][3] + C[j][q] * C[j][3]) / n).concat(C[i][3] + C[j][3]); C.splice(j, 1); merged = true;
      }
    }
  }
  const total = C.reduce((s, c) => s + c[3], 0);
  C = C.filter(c => c[3] > total * 0.003).sort((a, b) => b[3] - a[3]);
  const used2 = {};
  const groups = C.map(c => { const l = c[0] / WL; let nm = nameOf(l, c[1], c[2]); used2[nm] = (used2[nm] || 0) + 1; if (used2[nm] > 1) nm += used2[nm];
    return { center: [l, c[1], c[2]], hex: labHex(l, c[1], c[2]), name: nm, share: c[3] / total }; });
  // 1ピクセルずつグループ分け（境目はなめらかに混ぜる）
  const G = groups.length, cs = groups.map(g => [g.center[0] * WL, g.center[1], g.center[2]]);
  const g1 = new Uint8Array(N), g2 = new Uint8Array(N), mix = new Float32Array(N);
  const sum = new Float64Array(G), sq = new Float64Array(G), cnt = new Float64Array(G), dk = new Float32Array(G);
  for (let i = 0; i < N; i++) {
    const l = L[i] * WL; let best = 0;
    for (let k = 0; k < G; k++) { const x = l - cs[k][0], y = A[i] - cs[k][1], z = B[i] - cs[k][2]; dk[k] = x * x + y * y + z * z; if (dk[k] < dk[best]) best = k; }
    let sec = best, d2 = 1e18; for (let k = 0; k < G; k++) if (k !== best && dk[k] < d2) { d2 = dk[k]; sec = k; }
    const w1 = clamp(0.5 + (Math.sqrt(d2) - Math.sqrt(dk[best])) / 16, 0.5, 1);
    g1[i] = best; g2[i] = sec; mix[i] = w1;
    if (mask[i] && w1 > 0.75) { sum[best] += L[i]; sq[best] += L[i] * L[i]; cnt[best]++; }
  }
  const st = groups.map((g, k) => { const n = cnt[k]; if (!n) return { mean: g.center[0], std: 6 }; const m = sum[k] / n; return { mean: m, std: Math.sqrt(Math.max(0, sq[k] / n - m * m)) }; });
  return { w, h, src, L, A, B, g1, g2, mix, groups, st };
}

// 保存してある塗装を、今のグループに合わせる（中心の色が一番近いものを使う）
export function matchSettings(an, saved) {
  if (!saved?.groups) return an.groups.map(() => null);
  return an.groups.map(g => {
    let best = null, bd = 1e9;
    for (const s of saved.groups) { if (!s.center) continue; const d = Math.hypot(s.center[0] - g.center[0], s.center[1] - g.center[1], s.center[2] - g.center[2]); if (d < bd) { bd = d; best = s; } }
    return bd < 12 ? best : null;
  });
}

// 塗った結果の画像（色）と、ツヤ/金属感の画像（G=ざらざら B=金属）を作る
export function render(an, sets, outColor, outRM) {
  const { w, h, src, L, A, B, g1, g2, mix, st } = an, N = w * h;
  outColor.width = w; outColor.height = h; outRM.width = w; outRM.height = h;
  const cg = outColor.getContext('2d'), rg = outRM.getContext('2d');
  const out = cg.createImageData(w, h), rm = rg.createImageData(w, h);
  const P = sets.map((s, k) => {
    const base = { rough: 0.62, metal: 0.05 };
    if (!s) return { keep: true, ...base };
    let tl = st[k].mean, ta = 0, tb = 0, keep = true;
    if (s.hex) { [tl, ta, tb] = rgb2lab(...hex2rgb(s.hex)); keep = false; }
    const std = Math.max(st[k].std, 3);
    return { keep, tl, ta, tb, mean: st[k].mean, std, amp: keep ? std : clamp(st[k].std * 1.4, 8, 18), rough: 1 - 0.85 * (s.gloss ?? 0.35), metal: s.metal ?? 0 };
  });
  const t = [0, 0, 0], t2 = [0, 0, 0];
  const one = (p, i, o) => {
    if (p.keep) { o[0] = src.data[i * 4]; o[1] = src.data[i * 4 + 1]; o[2] = src.data[i * 4 + 2]; return; }
    const z = (L[i] - p.mean) / p.std;
    let l = p.tl + z * p.amp * (1 - p.metal * 0.2);
    if (p.metal > 0) l += Math.max(0, z) * 10 * p.metal;
    lab2rgb(clamp(l, 0, 100), p.ta, p.tb, o, 0);
  };
  for (let i = 0; i < N; i++) {
    const a = P[g1[i]], b = P[g2[i]], m = mix[i];
    one(a, i, t);
    let r = t[0], g = t[1], bb = t[2], ro = a.rough, me = a.metal;
    if (m < 0.999 && b !== a) { one(b, i, t2); r = r * m + t2[0] * (1 - m); g = g * m + t2[1] * (1 - m); bb = bb * m + t2[2] * (1 - m); ro = ro * m + b.rough * (1 - m); me = me * m + b.metal * (1 - m); }
    const o = i * 4;
    out.data[o] = r; out.data[o + 1] = g; out.data[o + 2] = bb; out.data[o + 3] = 255;
    rm.data[o] = 255; rm.data[o + 1] = ro * 255; rm.data[o + 2] = me * 255; rm.data[o + 3] = 255;
  }
  cg.putImageData(out, 0, 0); rg.putImageData(rm, 0, 0);
}
