// Percorso calpestato nelle ultime 24 ore (anche senza registrare una traccia), per la foschia "zone battute"
import { kvGet, kvSet } from './store.js';
import { bus, haversine } from './util.js';

const DAY = 24 * 3600 * 1000;
let pts = [], loaded = false, dirty = 0;
export async function getWalked() {
  if (!loaded) {
    pts = ((await kvGet('walked')) || []).filter((q) => q[2] > Date.now() - DAY);
    loaded = true;
  }
  return pts;
}
export function initWalked() {
  bus.on('pos', async (p) => {
    await getWalked();
    const l = pts[pts.length - 1];
    if (l && haversine({ lat: l[0], lon: l[1] }, p) < 6) return;
    if (p.acc != null && p.acc > 60) return;
    pts.push([+p.lat.toFixed(6), +p.lon.toFixed(6), Date.now()]);
    if (++dirty >= 8) {
      dirty = 0;
      const cut = Date.now() - DAY;
      while (pts.length && pts[0][2] < cut) pts.shift();
      kvSet('walked', pts);
    }
    bus.emit('walked:changed');
  });
}
