// Sincronizzazione con l'app Footprint per smartwatch (Wear OS): impostazioni, icone, waypoint e uscite
import { Capacitor, registerPlugin } from '@capacitor/core';
import { getSettings } from './store.js';
import { bus } from './util.js';
import { toast } from './ui.js';
import { getWaypoints, getWaypoint, addWaypoint, removeWaypoint } from './waypoints.js';
import { saveTrack } from './track.js';
import { buildTrack } from './gpsio.js';

export const WATCH_DEFAULT_ICONS = ['porcino', 'regius', 'galletto', 'ovulo', 'scorzone', 'bianco', 'fungo', 'parcheggio', 'acqua', 'pericolo'];
const IF = () => (Capacitor.Plugins && Capacitor.Plugins.IntentFiles) || registerPlugin('IntentFiles');
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

// Configurazione dell'orologio (si imposta dal telefono, il watch la riceve via Bluetooth)
export function watchCfg() {
  const s = getSettings();
  const icons = Array.isArray(s.watchIcons) && s.watchIcons.length ? s.watchIcons.slice(0, 10) : WATCH_DEFAULT_ICONS;
  return {
    icons,
    keyMode: num(s.watchKeyMode, 0),
    theme: num(s.watchTheme, 0),
    prox: num(s.watchProx, 15),
    offM: num(s.watchOffM, 30),
    rot: num(s.watchRot, 40),
    tscale: num(s.watchTscale, 1.5),
    lock: !!s.watchLock,
  };
}

const wpList = () => getWaypoints().slice(-1500).map((w) => ({ id: w.id, icon: w.icon, title: w.title, lat: w.lat, lon: w.lon, alt: w.alt || 0, acc: w.acc || 0, ts: w.ts || 0, dog: !!w.dog }));

// Invia al watch; ritorna il numero di orologi raggiungibili
export async function sendToWatch({ config = false, wps = true } = {}) {
  if (!Capacitor.isNativePlatform()) return null;
  const payload = {};
  if (config) payload.config = JSON.stringify(watchCfg());
  if (wps) payload.wps = JSON.stringify(wpList());
  const r = await IF().watchSend(payload);
  return r && typeof r.nodes === 'number' ? r.nodes : null;
}

let timer = null, pendingCfg = false;
export function queueSend(cfg = false, delay = 1500) {
  pendingCfg = pendingCfg || cfg;
  clearTimeout(timer);
  timer = setTimeout(() => {
    const c = pendingCfg;
    pendingCfg = false;
    sendToWatch({ config: c, wps: true }).catch(() => {});
  }, delay);
}

// Waypoint e uscite fatti col watch: entrano nel database del telefono
export async function pullWatch() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const r = await IF().watchTake();
    const wps = JSON.parse((r && r.wps) || '[]');
    const trips = JSON.parse((r && r.trips) || '[]');
    const dog = ((getSettings().dogName || '').split(',')[0] || '').trim();
    let n = 0, t = 0;
    for (const w of wps) {
      if (!w || !w.id) continue;
      if (w.del) {
        if (getWaypoint(w.id)) await removeWaypoint(w.id);
        continue;
      }
      if (getWaypoint(w.id)) continue;
      await addWaypoint({ id: w.id, title: w.title || 'Punto watch', desc: '', icon: w.icon || 'fungo', dog: w.dog ? dog : '', lat: w.lat, lon: w.lon, alt: w.alt, acc: w.acc, ts: w.ts });
      n++;
    }
    for (const tr of trips) {
      const pts = String(tr.csv || '')
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          const a = l.split(',');
          return [Number(a[0]), Number(a[1]), Number(a[2]), Number(a[3])];
        })
        .filter((p) => isFinite(p[0]) && isFinite(p[1]));
      if (pts.length > 1) {
        await saveTrack(buildTrack('Uscita col watch · ' + new Date(tr.start).toLocaleDateString('it-IT'), pts));
        t++;
      }
    }
    if (n || t) toast(`Dal watch: ${n ? n + ' waypoint' : ''}${n && t ? ', ' : ''}${t ? t + ' traccia' : ''}`);
  } catch {}
}

export function initWatchSync() {
  if (!Capacitor.isNativePlatform()) return;
  bus.on('wp:changed', () => queueSend(false, 4000));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') pullWatch();
  });
  setInterval(pullWatch, 30000);
  setTimeout(pullWatch, 2500);
  setTimeout(() => queueSend(false, 100), 5000);
}
