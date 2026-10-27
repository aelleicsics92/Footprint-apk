// Miglior zona entro 10 km (meteo x habitat): stessa funzione per scheda Previsione e widget, così i numeri coincidono
import { getSettings } from './store.js';
import { analyze, bestNear, soilAt, dayOfYear, probFrom } from './habitat.js';

const An = new Map(), Best = new Map();
const T0 = Date.now();
export async function areaBest(lat, lon, key, radius = 10000, lowPrio = false) {
  if (lowPrio) await new Promise((r) => setTimeout(r, Math.max(0, 45000 - (Date.now() - T0))));
  const ck = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  let A = An.get(ck);
  if (!A) {
    const d = 0.095, cl = Math.cos((lat * Math.PI) / 180);
    A = await analyze({ n: lat + d, s: lat - d, e: lon + d / cl, w: lon - d / cl }, 11);
    if (!A.L) return null;
    An.set(ck, A);
    if (An.size > 4) An.delete(An.keys().next().value);
  }
  const ph = await soilAt(lat, lon, false), doy = dayOfYear();
  const hk = `${ck}|${key}|${doy}|${ph || 0}|${radius}|${JSON.stringify(A.src)}|${JSON.stringify(getSettings().fungiHab || {})}`;
  let b = Best.get(hk);
  if (!b) {
    b = bestNear(A, key, ph, doy, lat, lon, 50, radius);
    if (b) Best.set(hk, b);
    if (Best.size > 20) Best.delete(Best.keys().next().value);
  }
  return b;
}
export const areaProb = (W, b) => (b ? Math.min(97, probFrom(W, b.H)) : null);
