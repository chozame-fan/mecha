// 機体の部品と、CPUの戦い方の設定
// 単位: メートル・秒。数字を変えたら tools/balance.mjs（AI同士の総当たり）で強さの偏りを確かめる

export const FRAMES = {
  light: { name: '軽量フレーム', desc: '速くて回避が得意。打たれ弱い', hp: 7600, speed: 17, airSpeed: 25, dash: 46, en: 1150, regen: 400, armor: 1.0, weight: 0 },
  mid:   { name: '中量フレーム', desc: '速さと硬さのバランス型', hp: 9500, speed: 14, airSpeed: 22, dash: 42, en: 1050, regen: 350, armor: 0.95, weight: 0 },
  heavy: { name: '重量フレーム', desc: '遅いがとても硬い。よろけにくい', hp: 12000, speed: 11, airSpeed: 18, dash: 37, en: 950, regen: 320, armor: 0.88, weight: 0, poise: 1.5 },
};

// slot: R=右手 L=左手 S=肩
export const WEAPONS = {
  // ---- 右手 ----
  rifle:   { slot: 'R', name: 'ビームライフル', desc: '弾が速く当てやすい基本の武器', kind: 'beam', dmg: 290, cd: 0.8, speed: 190, en: 70, range: 95, impact: 22, weight: 1, color: 0xff5ab4 },
  mg:      { slot: 'R', name: 'マシンガン', desc: '弾をばらまいて削る。弾切れに注意', kind: 'bullet', dmg: 34, cd: 0.1, speed: 160, spread: 0.022, mag: 60, reload: 3.2, range: 65, impact: 5, weight: 1.2, color: 0xffd060 },
  bazooka: { slot: 'R', name: 'バズーカ', desc: '遅いが一発が重く、爆発で巻きこむ', kind: 'rocket', dmg: 560, cd: 2.2, speed: 80, splash: 5, mag: 6, reload: 4, range: 85, impact: 65, weight: 2, color: 0xffa040 },
  sniper:  { slot: 'R', name: 'スナイパーライフル', desc: '遠くから大ダメージ。連射できない', kind: 'beam', dmg: 680, cd: 3.2, speed: 420, en: 200, range: 160, impact: 55, weight: 2.4, color: 0x7ad8ff },
  // ---- 左手 ----
  shield:  { slot: 'L', name: 'シールド', desc: '押している間、正面からの攻撃を75%減らす', kind: 'shield', block: 0.75, drain: 90, weight: 1.4 },
  saber:   { slot: 'L', name: 'ビームサーベル', desc: '近づいて斬る。当たれば特大ダメージ', kind: 'melee', dmg: 1500, cd: 1.6, range: 22, en: 140, impact: 90, weight: 0.8, color: 0xff70d0 },
  handgun: { slot: 'L', name: 'ハンドガン', desc: '軽くて連射できる補助武器', kind: 'bullet', dmg: 105, cd: 0.33, speed: 170, spread: 0.01, mag: 18, reload: 2.6, range: 60, impact: 10, weight: 0.6, color: 0xffe080 },
  // ---- 肩 ----
  missile: { slot: 'S', name: 'ミサイル', desc: '4発が追いかける。回避で外せる', kind: 'missile', dmg: 140, count: 4, cd: 6, speed: 58, turn: 2.0, range: 115, impact: 18, weight: 1.6, color: 0xffffff },
  cannon:  { slot: 'S', name: 'キャノン', desc: '肩から撃つ重い一発', kind: 'shell', dmg: 650, cd: 4.6, speed: 210, range: 125, impact: 70, weight: 2.8, color: 0xffb070 },
  none:    { slot: 'S', name: 'なし（身軽）', desc: '肩を空にして速さを上げる', kind: 'none', weight: 0 },
};

export const SLOTS = { R: ['rifle', 'mg', 'bazooka', 'sniper'], L: ['shield', 'saber', 'handgun'], S: ['missile', 'cannon', 'none'] };

export const DEFAULT_BUILD = { frame: 'mid', R: 'rifle', L: 'shield', S: 'missile' };

// 重さで速さが落ちる
export function stats(build) {
  const f = FRAMES[build.frame] || FRAMES.mid;
  const w = ['R', 'L', 'S'].reduce((s, k) => s + (WEAPONS[build[k]]?.weight || 0), 0);
  const mul = 1.1 - 0.035 * w;            // 武器の重さ合計 ≈ 3 で 1.0 倍
  return { ...f, weightSum: w, speed: f.speed * mul, airSpeed: f.airSpeed * mul, dash: f.dash * (0.6 + 0.4 * mul) };
}

// CPUの性格。dodgeMin = この威力未満の弾は避けない（動画のClaude製AIの弱点を再現できる）
export const AI_STYLES = {
  balance: { name: 'バランス', range: 1.0, dodge: 0.55, dodgeMin: 80, reaction: 0.28, aimErr: 0.03, strafe: 2.2, jump: 0.25, guard: 0.6, keepEn: 250 },
  rush:    { name: '接近戦', range: 0.45, dodge: 0.45, dodgeMin: 150, reaction: 0.25, aimErr: 0.04, strafe: 1.6, jump: 0.35, guard: 0.4, keepEn: 300 },
  sniper:  { name: '引き撃ち', range: 1.35, dodge: 0.7, dodgeMin: 60, reaction: 0.22, aimErr: 0.02, strafe: 2.8, jump: 0.15, guard: 0.7, keepEn: 350 },
  evade:   { name: '回避重視', range: 0.85, dodge: 0.85, dodgeMin: 40, reaction: 0.18, aimErr: 0.035, strafe: 1.2, jump: 0.4, guard: 0.5, keepEn: 400 },
  rookie:  { name: 'ルーキー', range: 0.9, dodge: 0.15, dodgeMin: 200, reaction: 0.5, aimErr: 0.09, strafe: 3.5, jump: 0.1, guard: 0.2, keepEn: 150 },
};

// CPU機体の見本（用意された対戦相手）
export const CPU_MECHS = [
  { id: 'cpu-zaku', name: 'グリーンホーン', build: { frame: 'mid', R: 'mg', L: 'handgun', S: 'none' }, ai: 'rookie', colors: { main: '#4f7a3e', sub: '#2e4a26', accent: '#c23a2a', visor: '#ff3355' }, head: 'mono' },
  { id: 'cpu-knight', name: 'ブルーナイト', build: { frame: 'light', R: 'rifle', L: 'saber', S: 'none' }, ai: 'rush', colors: { main: '#e9ecef', sub: '#2856b8', accent: '#d8b030', visor: '#55ffcc' }, head: 'v' },
  { id: 'cpu-fort', name: 'アイアンフォート', build: { frame: 'heavy', R: 'bazooka', L: 'shield', S: 'cannon' }, ai: 'balance', colors: { main: '#6d6a5a', sub: '#3a3a36', accent: '#e07b20', visor: '#ffaa33' }, head: 'mono' },
  { id: 'cpu-hawk', name: 'スカイホーク', build: { frame: 'light', R: 'sniper', L: 'handgun', S: 'missile' }, ai: 'sniper', colors: { main: '#ece8dc', sub: '#8a2433', accent: '#222222', visor: '#66ccff' }, head: 'v' },
  { id: 'cpu-ghost', name: 'シャドウ', build: { frame: 'mid', R: 'rifle', L: 'shield', S: 'missile' }, ai: 'evade', colors: { main: '#2a2a33', sub: '#5b2a8a', accent: '#c9a046', visor: '#ff44aa' }, head: 'v' },
];
