// Diagnostica temporanea di avvio/riapertura: tempi dei passaggi e blocchi del thread principale (da rimuovere)
const KEY = 'fp.perf';
const boot = { at: Date.now(), cold: true, marks: [] };
let t = 0;
function save() {
  clearTimeout(t);
  t = setTimeout(() => {
    try {
      const all = JSON.parse(localStorage.getItem(KEY) || '[]').filter((b) => b.at !== boot.at);
      all.push(boot);
      localStorage.setItem(KEY, JSON.stringify(all.slice(-6)));
    } catch {}
  }, 400);
}
export function mark(label) {
  boot.marks.push([Math.round(performance.now()), label]);
  if (boot.marks.length > 160) boot.marks.splice(1, 20);
  save();
}
export const perfBoots = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
export const clearPerf = () => { try { localStorage.removeItem(KEY); } catch {} };

mark('JS caricato (tempo dall\'avvio)');
try {
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.duration >= 200) mark(`BLOCCO ${Math.round(e.duration)} ms`); }).observe({ entryTypes: ['longtask'] });
} catch {}
let last = performance.now();
setInterval(() => { const n = performance.now(); if (n - last > 2500) mark(`thread fermo ${Math.round((n - last) / 100) / 10} s`); last = n; }, 500);
let hid = 0;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { hid = performance.now(); mark('app in background'); return; }
  const t0 = performance.now();
  mark(`app riaperta (era in background da ${Math.round((t0 - hid) / 1000)} s)`);
  requestAnimationFrame(() => requestAnimationFrame(() => mark(`riapertura: primo frame dopo ${Math.round(performance.now() - t0)} ms`)));
});
