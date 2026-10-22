// Invia al widget 4x2 i dati da mostrare: luogo, indice cacciata, tramonto, stato registrazione
import { Capacitor, registerPlugin } from '@capacitor/core';
import { getSettings } from './store.js';
import { lastPos } from './geo.js';
import { getRec } from './track.js';
import { bus } from './util.js';
import { sunTimes } from './sun.js';
import { PROFILES, levelOf, outlook, getPointSeries } from './fungi.js';
import { placeName } from '../ui/weather.js';

const ICON = { autunnali: 'porcino', estivi: 'galletto', scorzone: 'scorzone', uncinato: 'uncinato', bianco: 'bianco', nero: 'nero', bianchetto: 'bianchetto' };
let cache = { place: '', at: null, score: null }, lastPush = 0;

async function push(force) {
  if (!Capacitor.isNativePlatform()) return;
  if (!force && Date.now() - lastPush < 60000) return;
  lastPush = Date.now();
  const p = lastPos();
  const d = { rec: getRec().status !== 'idle', ts: Date.now() };
  if (p) {
    d.alt = p.alt;
    if (!cache.at || Math.hypot(cache.at.lat - p.lat, cache.at.lon - p.lon) > 0.02) {
      cache.at = { lat: p.lat, lon: p.lon };
      cache.place = (await placeName(p.lat, p.lon)) || cache.place || '';
      cache.score = null;
    }
    d.place = cache.place;
    const st = sunTimes(new Date(), p.lat, p.lon);
    if (st) d.sunset = st.sunset.getTime();
    try {
      if (!cache.score || Date.now() - cache.score.t > 20 * 60000) {
        const key = getSettings().fungiProfile || 'autunnali';
        const prof = PROFILES[key] || PROFILES.autunnali;
        const { series } = await getPointSeries(p.lat, p.lon);
        const o = outlook(series, prof, series.elev)[0];
        cache.score = { t: Date.now(), score: o.score, label: levelOf(o.score).label.toUpperCase(), profile: prof.short, icon: ICON[key] || 'porcino' };
      }
      Object.assign(d, cache.score);
    } catch {
      if (cache.score) Object.assign(d, cache.score);
    }
  }
  try {
    await ((Capacitor.Plugins && Capacitor.Plugins.IntentFiles) || registerPlugin('IntentFiles')).setWidgetData({ json: JSON.stringify(d) });
  } catch {}
}

export function initWidgetSync() {
  let first = false;
  bus.on('pos', () => { if (!first) { first = true; push(true); } else push(false); });
  bus.on('rec:state', () => push(true));
  bus.on('settings:changed', (k) => { if (k === 'fungiProfile') { cache.score = null; push(true); } });
  setInterval(() => push(true), 20 * 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') push(true); });
}
