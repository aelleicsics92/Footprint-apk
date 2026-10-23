// Calibrazione del modello sui ritrovamenti reali del diario: per ogni waypoint di fungo/tartufo scarica il meteo
// dei 36 giorni precedenti, misura giorni dalla pioggia utile, pioggia 14/30 giorni e temperatura, e sposta i parametri
// del profilo verso quanto osservato (media pesata: più ritrovamenti, più peso ai dati).
import { PROFILES, BASE, evaluate, applyCal } from './fungi.js';
import { getWaypoints } from './waypoints.js';
import { getSettings, setSetting } from './store.js';

const MAP = { porcino: 'autunnali', regius: 'autunnali', pinaiolo: 'autunnali', leccino: 'autunnali', galletto: 'estivi', ovulo: 'estivi', scorzone: 'scorzone', uncinato: 'uncinato', bianco: 'bianco', bianchetto: 'bianchetto', nero: 'nero' };
const DAILY = 'precipitation_sum,temperature_2m_max,temperature_2m_min,et0_fao_evapotranspiration,wind_speed_10m_max,wind_direction_10m_dominant';
const iso = (ts) => new Date(ts).toLocaleDateString('sv-SE');
const PRIOR_N = 8;

async function seriesFor(lat, lon, ts) {
  const end = iso(ts), days = (Date.now() - ts) / 86400000;
  let url;
  if (days < 85) url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&daily=${DAILY}&past_days=92&forecast_days=1&timezone=auto`;
  else {
    const s = iso(ts - 40 * 86400000);
    url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&start_date=${s}&end_date=${end}&daily=${DAILY}&timezone=auto`;
  }
  const r = await fetch(url);
  if (!r.ok) throw new Error('meteo ' + r.status);
  const j = await r.json(), d = j.daily;
  const i = d.time.indexOf(end);
  if (i < 30) throw new Error('storico incompleto');
  const cut = (a) => a.slice(0, i + 1);
  return { i, series: { time: cut(d.time), p: cut(d.precipitation_sum), tmax: cut(d.temperature_2m_max), tmin: cut(d.temperature_2m_min), et0: cut(d.et0_fao_evapotranspiration), w: cut(d.wind_speed_10m_max), elev: j.elevation } };
}
const sum = (a, x, y) => { let s = 0; for (let k = Math.max(0, x); k <= y; k++) s += a[k] || 0; return s; };
function feats(s, i) {
  let lag = null, best = 0;
  for (let j = i - 30; j <= i - 2; j++) {
    const ev = (s.p[j] || 0) + (s.p[j - 1] || 0);
    if (ev >= 12 && ev > best) (best = ev), (lag = i - j);
  }
  let t = 0, n = 0;
  for (let k = i - 6; k <= i; k++) if (s.tmax[k] != null) (t += (s.tmax[k] + s.tmin[k]) / 2), n++;
  return { lag, R14: sum(s.p, i - 13, i), R30: sum(s.p, i - 29, i), tmean: n ? t / n : null };
}
const q = (arr, f) => {
  const a = [...arr].sort((x, y) => x - y);
  if (!a.length) return null;
  const k = (a.length - 1) * f, lo = Math.floor(k), hi = Math.ceil(k);
  return a[lo] + (a[hi] - a[lo]) * (k - lo);
};
const med = (a) => q(a, 0.5);
const mix = (prior, emp, n) => (emp == null ? prior : (prior * PRIOR_N + emp * n) / (PRIOR_N + n));

export function findings() {
  const seen = new Set(), out = [];
  for (const w of getWaypoints()) {
    const key = MAP[w.icon];
    if (!key || w.lat == null) continue;
    const id = `${key}|${iso(w.ts)}|${w.lat.toFixed(2)}|${w.lon.toFixed(2)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ key, ts: w.ts, lat: w.lat, lon: w.lon, alt: w.alt, icon: w.icon, title: w.title });
  }
  return out.sort((a, b) => b.ts - a.ts).slice(0, 80);
}

export async function calibrate(onProgress) {
  const list = findings();
  const rows = [];
  let done = 0;
  const queue = [...list];
  const worker = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      try {
        const { i, series } = await seriesFor(f.lat, f.lon, f.ts);
        rows.push({ ...f, i, series, ...feats(series, i) });
      } catch (e) {
        rows.push({ ...f, err: e.message });
      }
      onProgress && onProgress(++done, list.length);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  const out = {};
  for (const key of Object.keys(PROFILES)) {
    const r = rows.filter((x) => x.key === key && !x.err);
    if (!r.length) continue;
    const prof = BASE[key];
    const before = r.map((x) => evaluate(x.series, x.i, prof, x.series.elev).score);
    const n = r.length, lags = r.filter((x) => x.lag != null).map((x) => x.lag);
    const cal = {};
    if (n >= 4) {
      if (lags.length >= 4) {
        cal.lagOpt = Math.round(mix(prof.lagOpt, med(lags), lags.length) * 10) / 10;
        cal.lagSig = Math.round(mix(prof.lagSig, Math.max(3.5, (q(lags, 0.75) - q(lags, 0.25)) / 1.35), lags.length) * 10) / 10;
      }
      const r14 = r.map((x) => x.R14), r30 = r.map((x) => x.R30), tm = r.filter((x) => x.tmean != null).map((x) => x.tmean);
      const lo = mix(prof.rain[0], q(r14, 0.1), n), hi = mix(prof.rain[1], Math.max(q(r14, 0.7), q(r14, 0.1) + 15), n);
      cal.rain = [Math.round(lo), Math.round(Math.max(hi, lo + 15))];
      if (tm.length >= 4) {
        const a = mix(prof.tOpt[0], q(tm, 0.15), tm.length), b = mix(prof.tOpt[1], q(tm, 0.85), tm.length);
        cal.tOpt = [Math.round(a * 10) / 10, Math.round(Math.max(b, a + 4) * 10) / 10];
        cal.tZero = [Math.round(Math.min(prof.tZero[0], cal.tOpt[0] - 6) * 10) / 10, Math.round(Math.max(prof.tZero[1], cal.tOpt[1] + 6) * 10) / 10];
      }
    }
    const tmp = { ...prof, ...cal };
    const after = r.map((x) => evaluate(x.series, x.i, tmp, x.series.elev).score);
    out[key] = { n, cal, before: Math.round(med(before)), after: Math.round(med(after)), lagMed: lags.length ? Math.round(med(lags)) : null, r14: [Math.round(q(r.map((x) => x.R14), 0.1)), Math.round(q(r.map((x) => x.R14), 0.9))], r30: Math.round(med(r.map((x) => x.R30))), t: r.filter((x) => x.tmean != null).length ? Math.round(med(r.filter((x) => x.tmean != null).map((x) => x.tmean))) : null, okBefore: before.filter((s) => s >= 45).length, okAfter: after.filter((s) => s >= 45).length };
  }
  return { out, total: list.length, failed: rows.filter((x) => x.err).length };
}

export function applyResult(res) {
  const cal = { ...(getSettings().fungiCal || {}) };
  for (const [k, v] of Object.entries(res.out)) if (Object.keys(v.cal).length) cal[k] = v.cal;
  setSetting('fungiCal', cal);
  applyCal(cal);
}
export function resetCal() {
  setSetting('fungiCal', {});
  applyCal({});
}
