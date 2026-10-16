// Mappa dei punti senza connessione dati (stima: non misura il segnale telefonico)
import { kvGet, kvSet } from './store.js';
import { bus } from './util.js';
import { lastPos } from './geo.js';

let pts = [], last = 0, loaded = false;
export const getCoverage = async () => {
  if (!loaded) { pts = (await kvGet('cov')) || []; loaded = true; }
  return pts;
};
async function probe() {
  if (!navigator.onLine) return false;
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 4000);
    await fetch('https://www.gstatic.com/generate_204', { mode: 'no-cors', cache: 'no-store', signal: c.signal });
    clearTimeout(t);
    return true;
  } catch {
    return false;
  }
}
export function initCoverage() {
  bus.on('pos', async () => {
    if (Date.now() - last < 60000) return;
    last = Date.now();
    const p = lastPos();
    if (!p) return;
    await getCoverage();
    const on = await probe();
    pts.push([+p.lat.toFixed(5), +p.lon.toFixed(5), on ? 1 : 0, Date.now()]);
    if (pts.length > 4000) pts = pts.slice(-4000);
    await kvSet('cov', pts);
    bus.emit('cov:changed');
  });
}
