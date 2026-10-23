import zonesRaw from '../data/zones.json';
import { kvGet, kvSet } from './store.js';
import { clamp } from './util.js';

export const PAST = 30;
export const FORECAST = 8;
export const ZONES = zonesRaw.map(([name, lat, lon]) => ({ name, lat, lon }));

export const PROFILES = {
  autunnali: { label: 'Porcini e autunnali', short: 'Porcini', peaks: [{ doy: 275, w: 38, a: 1, alt: true }, { doy: 178, w: 22, a: 0.5 }], tOpt: [9, 19], tZero: [2, 28], lagOpt: 9, lagSig: 4.5, frost: 1, hot: 27, rain: [15, 60] },
  estivi: { label: 'Estivi (galletti, ovuli)', short: 'Estivi', peaks: [{ doy: 200, w: 34, a: 1 }, { doy: 268, w: 26, a: 0.65, alt: true }], tOpt: [14, 24], tZero: [6, 32], lagOpt: 7, lagSig: 4, frost: 1, hot: 32, rain: [12, 50] },
  // Tartufi: un profilo per specie. "window" = periodo tipico di raccolta (L. 752/1985, indicativo: le regioni variano)
  scorzone: { label: 'Scorzone', short: 'Scorzone (T. aestivum)', truffle: true, window: [[5, 1], [11, 30]], peaks: [{ doy: 215, w: 38, a: 1 }], tOpt: [14, 24], tZero: [6, 31], lagOpt: 12, lagSig: 6, frost: 0.5, hot: 32, rain: [15, 60] },
  uncinato: { label: 'Uncinato', short: 'Uncinato (T. uncinatum)', truffle: true, window: [[10, 1], [12, 31]], peaks: [{ doy: 300, w: 28, a: 1, alt: true }], tOpt: [7, 17], tZero: [0, 25], lagOpt: 12, lagSig: 6, frost: 0.8, hot: 26, rain: [20, 70] },
  bianco: { label: 'Tartufo bianco', short: 'Bianco pregiato', truffle: true, window: [[10, 1], [12, 31]], peaks: [{ doy: 312, w: 24, a: 1, alt: true }], tOpt: [6, 15], tZero: [-1, 22], lagOpt: 12, lagSig: 6, frost: 1, hot: 24, rain: [25, 80] },
  nero: { label: 'Nero pregiato', short: 'Nero pregiato', truffle: true, window: [[11, 15], [3, 15]], peaks: [{ doy: 15, w: 28, a: 1 }], tOpt: [3, 12], tZero: [-4, 20], lagOpt: 14, lagSig: 7, frost: 0.4, hot: 26, rain: [15, 60] },
  bianchetto: { label: 'Bianchetto', short: 'Bianchetto (marzuolo)', truffle: true, window: [[1, 15], [4, 30]], peaks: [{ doy: 60, w: 25, a: 1 }], tOpt: [4, 14], tZero: [-3, 22], lagOpt: 12, lagSig: 6, frost: 0.4, hot: 24, rain: [15, 60] },
};

export const LEVELS = [
  { max: 22, key: 'scarsa', label: 'Scarsa', color: '#b9553a' },
  { max: 45, key: 'moderata', label: 'Moderata', color: '#e0a63a' },
  { max: 70, key: 'buona', label: 'Buona', color: '#7fae4a' },
  { max: 101, key: 'eccellente', label: 'Eccellente', color: '#1b7a4a' },
];
export const levelOf = (s) => LEVELS.find((l) => s < l.max) || LEVELS[3];

const ss = (x, a, b) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const trap = (x, o0, o1, z0, z1) => (x >= o0 && x <= o1 ? 1 : x < o0 ? clamp((x - z0) / (o0 - z0), 0, 1) : clamp((z1 - x) / (z1 - o1), 0, 1));
const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
export function windowState(iso, win) {
  if (!win) return { closed: false };
  const m = Number(iso.slice(5, 7)), d = Number(iso.slice(8, 10)), v = m * 100 + d;
  const a = win[0][0] * 100 + win[0][1], z = win[1][0] * 100 + win[1][1];
  const open = a <= z ? v >= a && v <= z : v >= a || v <= z;
  return open ? { closed: false } : { closed: true, opens: `${win[0][1]} ${MESI[win[0][0] - 1]}` };
}

const sum = (arr, a, b) => {
  let s = 0;
  for (let k = Math.max(0, a); k <= b; k++) s += arr[k] || 0;
  return s;
};
const avg = (arr, a, b) => sum(arr, a, b) / (b - Math.max(0, a) + 1);

function dayOfYear(iso) {
  const d = new Date(iso + 'T12:00:00Z');
  return Math.floor((d - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86400000);
}

export function seasonFactor(doy, prof, elev) {
  const shift = clamp(((elev || 0) - 700) / 100 * 2.2, -12, 25);
  let best = 0;
  for (const p of prof.peaks) {
    const peak = p.alt ? p.doy - shift : p.doy;
    let d = Math.abs(doy - peak);
    d = Math.min(d, 365 - d);
    best = Math.max(best, p.a * Math.exp(-(d * d) / (2 * p.w * p.w)));
  }
  return best;
}

// Valuta il giorno i della serie (0..n-1)
export function evaluate(series, i, prof, elev) {
  const { time, p, tmax, tmin, et0 } = series;
  const R7 = sum(p, i - 6, i);
  const R14 = sum(p, i - 13, i);
  const R30 = sum(p, i - 29, i);
  const wb = R14 - 0.8 * sum(et0, i - 13, i);
  const rain = 0.7 * ss(R14, prof.rain[0], prof.rain[1]) + 0.3 * ss(R30, 40, 110);
  let timing = 0, lag = null;
  for (let j = i - 20; j <= i - 2; j++) {
    const ev = (p[j] || 0) + (p[j - 1] || 0);
    if (ev >= 15) {
      const L = i - j;
      const f = Math.exp(-((L - prof.lagOpt) ** 2) / (2 * prof.lagSig ** 2));
      if (f > timing) (timing = f), (lag = L);
    }
  }
  timing = Math.max(timing, ss(R7, 8, 30) * 0.45);
  const tmeans = [];
  for (let k = i - 6; k <= i; k++) if (k >= 0) tmeans.push(((tmax[k] ?? 0) + (tmin[k] ?? 0)) / 2);
  const tmean = tmeans.reduce((a, b) => a + b, 0) / Math.max(1, tmeans.length);
  const K = trap(tmean, prof.tOpt[0], prof.tOpt[1], prof.tZero[0], prof.tZero[1]);
  const W = ss(wb, -10, 40);
  const base = 0.3 * rain + 0.25 * timing + 0.25 * K + 0.2 * W;
  let frostMin = 99;
  for (let k = i - 4; k <= i; k++) if (k >= 0 && tmin[k] != null) frostMin = Math.min(frostMin, tmin[k]);
  let pen = 1;
  if (frostMin < 0) pen *= Math.pow(frostMin < -3 ? 0.15 : 0.45, prof.frost);
  const hotMean = avg(tmax, i - 4, i);
  if (hotMean > prof.hot) pen *= clamp(1 - (hotMean - prof.hot) / 8, 0.25, 1);
  const S = seasonFactor(dayOfYear(time[i]), prof, elev);
  const gate = 0.2 + 0.8 * clamp(2 * Math.max(rain, timing), 0, 1);
  const score = clamp(100 * Math.pow(S, 0.7) * base * pen * gate, 0, 97);
  const ws = windowState(time[i], prof.window);
  return { closed: ws.closed, opens: ws.opens, score: Math.round(score), R7, R14, R30, tmean, frostMin: frostMin === 99 ? null : frostMin, lag, season: S, wb, date: time[i] };
}

export function outlook(series, prof, elev) {
  const out = [];
  for (let i = PAST; i < PAST + FORECAST && i < series.time.length; i++) out.push(evaluate(series, i, prof, elev));
  return out;
}

// ---------- dati Open-Meteo ----------
const DAILY = 'precipitation_sum,temperature_2m_max,temperature_2m_min,et0_fao_evapotranspiration,wind_speed_10m_max,wind_direction_10m_dominant';
function toSeries(loc) {
  const d = loc.daily;
  return { time: d.time, p: d.precipitation_sum, tmax: d.temperature_2m_max, tmin: d.temperature_2m_min, et0: d.et0_fao_evapotranspiration, w: d.wind_speed_10m_max, wd: d.wind_direction_10m_dominant, elev: loc.elevation };
}
export async function fetchSeries(points) {
  const res = [];
  for (let i = 0; i < points.length; i += 40) {
    const part = points.slice(i, i + 40);
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${part.map((p) => p.lat.toFixed(3)).join(',')}&longitude=${part.map((p) => p.lon.toFixed(3)).join(',')}&daily=${DAILY}&past_days=${PAST}&forecast_days=${FORECAST}&timezone=auto`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('Open-Meteo ' + r.status);
    const j = await r.json();
    (Array.isArray(j) ? j : [j]).forEach((l) => res.push(toSeries(l)));
  }
  return res;
}

const TTL = 3 * 3600 * 1000;
export async function getZoneSeries(force = false) {
  const c = await kvGet('fungi:zones');
  if (!force && c && Date.now() - c.t < TTL) return c;
  try {
    const series = await fetchSeries(ZONES);
    const data = { t: Date.now(), series };
    await kvSet('fungi:zones', data);
    return data;
  } catch (e) {
    if (c) return { ...c, stale: true };
    throw e;
  }
}
export async function getPointSeries(lat, lon) {
  const key = `fungi:pt:${lat.toFixed(1)}:${lon.toFixed(1)}`;
  const c = await kvGet(key);
  if (c && Date.now() - c.t < TTL) return c;
  try {
    const [s] = await fetchSeries([{ lat, lon }]);
    const data = { t: Date.now(), series: s };
    await kvSet(key, data);
    return data;
  } catch (e) {
    if (c) return { ...c, stale: true };
    throw e;
  }
}

export function nearestZone(lat, lon) {
  let best = null, bd = 1e9;
  for (const z of ZONES) {
    const d = (z.lat - lat) ** 2 + ((z.lon - lon) * Math.cos((lat * Math.PI) / 180)) ** 2;
    if (d < bd) (bd = d), (best = z);
  }
  return { zone: best, km: Math.sqrt(bd) * 111 };
}

// Riepilogo testuale per l'assistente AI
export async function fungiContext(profKey = 'autunnali') {
  const prof = PROFILES[profKey] || PROFILES.autunnali;
  const data = await getZoneSeries();
  const rows = ZONES.map((z, i) => {
    const s = data.series[i];
    const o = outlook(s, prof, s.elev);
    return `${z.name} (${Math.round(s.elev)} m): ${o[0].closed ? 'fuori periodo tipico di raccolta (verificare regolamento regionale), ' : ''}oggi ${o[0].score} (${levelOf(o[0].score).label}), +3gg ${o[3].score}, +7gg ${o[7].score}, pioggia 14gg ${Math.round(o[0].R14)} mm, T media 7gg ${o[0].tmean.toFixed(0)}°C`;
  });
  return `Indice crescita (${prof.label}), scala 0-100 (Scarsa<22, Moderata<45, Buona<70, Eccellente>=70):\n${rows.join('\n')}`;
}
