// Istantanea meteo di un ritrovamento e confronto con oggi (pioggia 14 gg, giorni dalla pioggia utile, temperatura).
import { seriesFor, feats } from './calib.js';
import { updateWaypoint } from './waypoints.js';
import { lastPos } from './geo.js';

const FUNGI = ['porcino', 'regius', 'pinaiolo', 'leccino', 'galletto', 'ovulo', 'scorzone', 'uncinato', 'bianco', 'bianchetto', 'nero'];
export const isFind = (w) => FUNGI.includes(w.icon);
const round = (f) => ({ lag: f.lag, R14: Math.round(f.R14), R30: Math.round(f.R30), t: f.tmean == null ? null : Math.round(f.tmean * 10) / 10 });

export async function ensureSnap(w) {
  if (w.snap || !isFind(w) || !navigator.onLine) return w.snap || null;
  try {
    const { i, series } = await seriesFor(w.lat, w.lon, w.ts);
    const snap = round(feats(series, i));
    await updateWaypoint(w.id, { snap });
    return snap;
  } catch { return null; }
}
export async function todayFeats(w) {
  const me = lastPos() || w;
  const { i, series } = await seriesFor(me.lat, me.lon, Date.now());
  return round(feats(series, i));
}
export function compare(a, b) {
  const ok = [];
  const nr = a.R14 > 0 ? Math.abs(b.R14 - a.R14) / a.R14 : (b.R14 < 10 ? 0 : 1);
  ok.push(nr <= 0.35);
  ok.push(a.lag == null || b.lag == null ? a.lag == b.lag : Math.abs(a.lag - b.lag) <= 4);
  ok.push(a.t == null || b.t == null || Math.abs(a.t - b.t) <= 3);
  const n = ok.filter(Boolean).length;
  return n === 3 ? 'simile' : n === 2 ? 'in parte simile' : 'diverso';
}
export function snapText(s) {
  return `Meteo al ritrovamento: ${s.R14} mm negli ultimi 14 gg, ${s.lag != null ? `pioggia utile ${s.lag} gg prima` : 'nessuna pioggia utile'}, ${s.t != null ? s.t + ' °C medi' : ''}`;
}
