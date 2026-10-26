// AI総当たりを裏で計算する
import { runHeadless } from './sim.js';
onmessage = e => {
  const { list, N } = e.data;
  const win = Object.fromEntries(list.map(m => [m.id, 0])), pair = {};
  let done = 0, sumT = 0;
  const total = list.length * (list.length - 1) / 2 * N;
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    pair[a.id + '|' + b.id] = [0, 0]; pair[b.id + '|' + a.id] = [0, 0];
    for (let k = 0; k < N; k++) {
      const r = runHeadless([{ ...a, id: 0, team: 0 }, { ...b, id: 1, team: 1 }], 7 + k * 31 + i * 1009 + j * 97);
      const w = r.winner === 0 ? a : b, l = w === a ? b : a;
      win[w.id]++; pair[w.id + '|' + l.id][0]++; pair[a.id + '|' + b.id][1]++; pair[b.id + '|' + a.id][1]++;
      done++; sumT += r.t;
      if (done % 10 === 0) postMessage({ progress: done / total, done });
    }
  }
  postMessage({ win, pair, total: done, avgT: sumT / Math.max(1, done) });
};
