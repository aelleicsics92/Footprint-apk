// Sincronizzazione con l'app Footprint per smartwatch (Wear OS): impostazioni, icone, waypoint e uscite
import { Capacitor, registerPlugin } from '@capacitor/core';
import { getSettings } from './store.js';
import { bus } from './util.js';
import { toast } from './ui.js';
import { getWaypoints, getWaypoint, addWaypoint, removeWaypoint } from './waypoints.js';
import { saveTrack, getTracks, loadTrackPoints } from './track.js';
import { buildTrack } from './gpsio.js';

export const WATCH_MAX_ICONS = 12;
export const WATCH_DEFAULT_ICONS = ['porcino', 'regius', 'galletto', 'ovulo', 'scorzone', 'bianco', 'fungo', 'parcheggio', 'acqua', 'pericolo'];
const IF = () => (Capacitor.Plugins && Capacitor.Plugins.IntentFiles) || registerPlugin('IntentFiles');
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

// Configurazione dell'orologio (si imposta dal telefono, il watch la riceve via Bluetooth)
export function watchCfg() {
  const s = getSettings();
  const icons = Array.isArray(s.watchIcons) && s.watchIcons.length ? s.watchIcons.slice(0, WATCH_MAX_ICONS) : WATCH_DEFAULT_ICONS;
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

// Comando per il watch (es. elimina una mappa)
export async function sendCmd(cmd) {
  if (!Capacitor.isNativePlatform()) return null;
  const r = await IF().watchSend({ cmd: JSON.stringify({ ...cmd, ts: Date.now() }) });
  return r && typeof r.nodes === 'number' ? r.nodes : null;
}

// Tracce salvate (le ultime 30, semplificate) da mostrare sulla mappa del watch
export async function sendTracks() {
  if (!Capacitor.isNativePlatform()) return null;
  const out = [];
  for (const t of getTracks().slice(0, 30)) {
    const pts = (await loadTrackPoints(t.id)).filter((q) => q && isFinite(q[0]) && isFinite(q[1]));
    if (pts.length < 2) continue;
    const step = Math.ceil(pts.length / 250);
    const p = [];
    for (let i = 0; i < pts.length; i += step) p.push(+pts[i][0].toFixed(5), +pts[i][1].toFixed(5));
    const l = pts[pts.length - 1];
    if ((pts.length - 1) % step) p.push(+l[0].toFixed(5), +l[1].toFixed(5));
    out.push({ p });
  }
  const r = await IF().watchSend({ tracks: JSON.stringify(out) });
  return r && typeof r.nodes === 'number' ? r.nodes : null;
}

// Traccia in tempo reale dal watch (null se non sta registrando)
export async function watchLive() {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const r = await IF().watchLive();
    const j = r && r.json ? JSON.parse(r.json) : null;
    if (!j || !j.on || Date.now() - j.ts > 150000) return null;
    const pts = String(r.csv || '').split('\n').filter(Boolean).map((l) => l.split(',').map(Number)).filter((a) => isFinite(a[0]) && isFinite(a[1]));
    return { ...j, pts };
  } catch { return null; }
}

let liveLayer = null, liveTimer = null;
export function startLiveLayer(map, L) {
  if (!Capacitor.isNativePlatform() || liveTimer) return;
  const tick = async () => {
    if (document.visibilityState !== 'visible') return;
    const d = await watchLive();
    if (!d) {
      if (liveLayer) { map.removeLayer(liveLayer); liveLayer = null; }
      return;
    }
    if (!liveLayer) liveLayer = L.layerGroup().addTo(map);
    liveLayer.clearLayers();
    if (d.pts.length > 1) L.polyline(d.pts, { color: '#ff7a00', weight: 5, opacity: 0.9 }).addTo(liveLayer);
    if (isFinite(d.lat)) {
      L.circleMarker([d.lat, d.lon], { radius: 9, color: '#fff', weight: 3, fillColor: '#ff7a00', fillOpacity: 1 })
        .bindTooltip('Watch ' + ((d.dist || 0) / 1000).toFixed(2) + ' km', { permanent: true, direction: 'top', offset: [0, -8] })
        .addTo(liveLayer);
    }
  };
  tick();
  liveTimer = setInterval(tick, 10000);
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

// Orologi collegati e stato pubblicato dal watch (batteria, memoria, mappe presenti)
export async function watchInfo() {
  if (!Capacitor.isNativePlatform()) return { nodes: [], status: null };
  const r = await IF().watchInfo();
  let nodes = [], status = null;
  try { nodes = JSON.parse((r && r.nodes) || '[]'); } catch {}
  try {
    status = r && r.status ? JSON.parse(r.status) : null;
    if (status && typeof status.maps === 'string') status.maps = JSON.parse(status.maps || '{}');
  } catch { status = null; }
  return { nodes, status };
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
  let tt = null;
  bus.on('tracks:changed', () => { clearTimeout(tt); tt = setTimeout(() => sendTracks().catch(() => {}), 5000); });
  setTimeout(() => sendTracks().catch(() => {}), 9000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') pullWatch();
  });
  setInterval(pullWatch, 30000);
  setTimeout(pullWatch, 2500);
  setTimeout(() => queueSend(false, 100), 5000);
}
