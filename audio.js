// 効果音とBGMはすべてその場で合成（素材ファイルなし・無料）
let ctx = null, master = null, sfxBus = null, bgmBus = null, noiseBuf = null, bgmTimer = null;
export function initAudio() {
  if (ctx) { ctx.resume(); return; }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain(); master.gain.value = 0.7;
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
  master.connect(comp).connect(ctx.destination);
  sfxBus = ctx.createGain(); sfxBus.connect(master);
  bgmBus = ctx.createGain(); bgmBus.gain.value = 0.32; bgmBus.connect(master);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}
export const audioReady = () => !!ctx;
export function setVolume(v) { if (master) master.gain.value = v; }

function env(g, t, a, peak, dec) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec); }
function noise(t, dur, f0, f1, peak, type = 'lowpass', q = 0.8, vol = 1) {
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ctx.createGain(); env(g, t, 0.005, peak * vol, dur);
  s.connect(f).connect(g).connect(sfxBus); s.start(t, Math.random()); s.stop(t + dur + 0.05);
}
function tone(t, type, f0, f1, dur, peak, vol = 1) {
  const o = ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ctx.createGain(); env(g, t, 0.004, peak * vol, dur);
  o.connect(g).connect(sfxBus); o.start(t); o.stop(t + dur + 0.05);
}

// vol: 距離で小さくする（0..1）
export function sfx(name, vol = 1) {
  if (!ctx || vol < 0.03) return;
  const t = ctx.currentTime;
  switch (name) {
    case 'beam': tone(t, 'sawtooth', 1800, 180, 0.22, 0.25, vol); tone(t, 'sine', 900, 120, 0.3, 0.3, vol); noise(t, 0.12, 6000, 1500, 0.15, 'bandpass', 1, vol); break;
    case 'mg': noise(t, 0.07, 3200, 600, 0.35, 'bandpass', 0.7, vol); tone(t, 'square', 140, 60, 0.05, 0.18, vol); break;
    case 'handgun': noise(t, 0.1, 2600, 400, 0.4, 'bandpass', 0.8, vol); tone(t, 'square', 180, 60, 0.07, 0.2, vol); break;
    case 'bazooka': noise(t, 0.35, 900, 120, 0.5, 'lowpass', 0.7, vol); tone(t, 'sine', 120, 40, 0.3, 0.5, vol); break;
    case 'sniper': tone(t, 'sawtooth', 3000, 90, 0.45, 0.28, vol); noise(t, 0.4, 8000, 300, 0.3, 'bandpass', 2, vol); tone(t, 'sine', 70, 30, 0.4, 0.5, vol); break;
    case 'cannon': noise(t, 0.5, 700, 60, 0.6, 'lowpass', 0.7, vol); tone(t, 'sine', 90, 30, 0.45, 0.6, vol); break;
    case 'missile': noise(t, 0.4, 1500, 4000, 0.18, 'bandpass', 3, vol); break;
    case 'explode': noise(t, 0.9, 1200, 40, 0.8, 'lowpass', 0.6, vol); tone(t, 'sine', 80, 25, 0.7, 0.6, vol); break;
    case 'hit': noise(t, 0.12, 4000, 1200, 0.35, 'highpass', 1, vol); tone(t, 'square', 600, 200, 0.06, 0.12, vol); break;
    case 'hitHeavy': noise(t, 0.3, 2500, 200, 0.6, 'lowpass', 1, vol); tone(t, 'triangle', 220, 50, 0.25, 0.4, vol); break;
    case 'block': tone(t, 'triangle', 1400, 900, 0.15, 0.3, vol); tone(t, 'sine', 2100, 1800, 0.25, 0.15, vol); break;
    case 'dash': noise(t, 0.35, 600, 3500, 0.35, 'bandpass', 1.5, vol); break;
    case 'saber': tone(t, 'sawtooth', 220, 440, 0.35, 0.18, vol); noise(t, 0.3, 1000, 5000, 0.25, 'bandpass', 3, vol); break;
    case 'slash': noise(t, 0.25, 7000, 900, 0.5, 'bandpass', 1.2, vol); tone(t, 'sawtooth', 500, 80, 0.3, 0.3, vol); break;
    case 'down': noise(t, 1.6, 900, 30, 1.0, 'lowpass', 0.5, vol); tone(t, 'sine', 60, 20, 1.4, 0.7, vol); break;
    case 'lock': tone(t, 'square', 1500, 1500, 0.05, 0.08, vol); tone(t + 0.07, 'square', 2000, 2000, 0.05, 0.08, vol); break;
    case 'alert': tone(t, 'square', 900, 900, 0.08, 0.1, vol); tone(t + 0.12, 'square', 900, 900, 0.08, 0.1, vol); break;
    case 'overheat': tone(t, 'sawtooth', 300, 100, 0.5, 0.2, vol); break;
    case 'click': tone(t, 'square', 1200, 900, 0.04, 0.08, vol); break;
    case 'win': [523, 659, 784, 1047].forEach((f, i) => tone(t + i * 0.12, 'square', f, f, 0.25, 0.15)); break;
    case 'lose': [392, 330, 262, 196].forEach((f, i) => tone(t + i * 0.18, 'triangle', f, f * 0.98, 0.35, 0.2)); break;
  }
}

// ブーストのうなり（押している間だけ鳴る）
let hum = null;
export function boostHum(on) {
  if (!ctx) return;
  if (on && !hum) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.8;
    const g = ctx.createGain(); g.gain.value = 0; g.gain.linearRampToValueAtTime(0.12, ctx.currentTime + 0.08);
    s.connect(f).connect(g).connect(sfxBus); s.start(); hum = { s, g };
  } else if (!on && hum) {
    const h = hum; hum = null; h.g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.12); h.s.stop(ctx.currentTime + 0.15);
  }
}

// BGM: 簡単な戦闘曲を延々と作り続ける（4小節ごとにコードが変わる）
export function bgm(on, style = 'battle') {
  if (!ctx) return;
  if (bgmTimer) { clearInterval(bgmTimer); bgmTimer = null; }
  if (!on) return;
  const bpm = style === 'battle' ? 148 : 96, beat = 60 / bpm, step16 = beat / 4;
  const prog = style === 'battle' ? [[45, 52, 57], [41, 48, 53], [43, 50, 55], [40, 47, 52]] : [[45, 52, 57], [41, 48, 57], [48, 52, 55], [43, 47, 50]];
  let next = ctx.currentTime + 0.1, n = 0;
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
  const note = (t, type, m, dur, vol, cut = 3000) => {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = mtof(m);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cut;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(bgmBus); o.start(t); o.stop(t + dur + 0.02);
  };
  const drum = (t, kind) => {
    if (kind === 'k') { const o = ctx.createOscillator(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2); o.connect(g).connect(bgmBus); o.start(t); o.stop(t + 0.22); }
    else { const s = ctx.createBufferSource(); s.buffer = noiseBuf; const f = ctx.createBiquadFilter(); f.type = kind === 's' ? 'bandpass' : 'highpass'; f.frequency.value = kind === 's' ? 1800 : 7000;
      const g = ctx.createGain(); const v = kind === 's' ? 0.5 : 0.12, d = kind === 's' ? 0.16 : 0.04;
      g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + d); s.connect(f).connect(g).connect(bgmBus); s.start(t, Math.random()); s.stop(t + d + 0.02); }
  };
  const arp = [0, 1, 2, 1, 2, 0, 2, 1];
  bgmTimer = setInterval(() => {
    while (next < ctx.currentTime + 0.25) {
      const bar = Math.floor(n / 16), s = n % 16, ch = prog[Math.floor(bar / 1) % 4];
      if (style === 'battle') {
        if (s % 4 === 0 || s === 10) drum(next, 'k');
        if (s === 4 || s === 12) drum(next, 's');
        if (s % 2 === 0) drum(next, 'h');
        if (s % 2 === 0) note(next, 'sawtooth', ch[0] - 12 + (s % 8 === 6 ? 12 : 0), step16 * 1.8, 0.16, 900);
        note(next, 'square', ch[arp[s % 8]] + 12 + (bar % 8 >= 4 ? 12 : 0), step16 * 0.9, 0.05, 2500);
        if (s === 0) for (const m of ch) note(next, 'sawtooth', m, beat * 3.8, 0.035, 1400);
      } else {
        if (s === 0 || s === 8) drum(next, 'k');
        if (s % 4 === 2) drum(next, 'h');
        if (s === 0) for (const m of ch) note(next, 'triangle', m + 12, beat * 3.9, 0.06, 2000);
        if (s % 4 === 0) note(next, 'sine', ch[arp[(s / 4 + bar) % 8]] + 24, beat * 0.9, 0.05);
        if (s === 0) note(next, 'triangle', ch[0] - 12, beat * 3.5, 0.15, 600);
      }
      next += step16; n++;
    }
  }, 60);
}
