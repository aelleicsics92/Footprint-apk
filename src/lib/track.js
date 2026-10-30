import { registerPlugin, Capacitor } from '@capacitor/core';
import { kvGet, kvSet, kvDel, getSettings } from './store.js';
import { bus, haversine, uid, fmtDate } from './util.js';
import { isNative, lastPos, ensurePermission, getOnce } from './geo.js';
import { buildTrack } from './gpsio.js';

const BG = registerPlugin('BackgroundGeolocation');
const IF = () => (typeof Capacitor !== 'undefined' && Capacitor.Plugins && Capacitor.Plugins.IntentFiles) || registerPlugin('IntentFiles');

// Punti scritti dal servizio nativo (continua anche se l'app viene chiusa dal sistema)
export async function mergeNative() {
  if (!isNative() || rec.status !== 'rec') return 0;
  try {
    const r = await IF().recRead();
    let n = 0;
    for (const q of r.points || []) {
      const ts = q[3];
      const last = rec.points[rec.points.length - 1];
      if (last && ts <= last[3]) continue;
      if ((rec.gaps || []).some((g) => ts >= g[0] && ts <= g[1])) continue;
      if (pushPoint([q[0], q[1], q[2], ts])) n++;
    }
    if (n) { persistCurrent(); bus.emit('rec:point', rec.points[rec.points.length - 1]); }
    return n;
  } catch { return 0; }
}
export async function nativeActive() {
  try { return !!(isNative() && (await IF().recRead()).active); } catch { return false; }
}

const rec = { status: 'idle', id: null, name: '', start: 0, points: [], dist: 0, up: 0, down: 0, paused: 0, pauseAt: 0, lastAlt: null, brk: false, gaps: [] };
let watcherId = null;
let unsubPos = null;
let tickT = null;
let tracks = [];

export const getRec = () => rec;
export const getTracks = () => tracks;

export async function loadTracks() {
  tracks = (await kvGet('tracks:index')) || [];
}
const meta = (t) => ({ id: t.id, name: t.name, start: t.start, end: t.end, dur: t.dur, dist: t.dist, up: t.up, down: t.down, maxAlt: t.maxAlt, minAlt: t.minAlt, n: t.points.length });
export async function saveTrack(t) {
  await kvSet('track:' + t.id, t.points);
  tracks.unshift(meta(t));
  await kvSet('tracks:index', tracks);
  bus.emit('tracks:changed');
}
export async function loadTrackPoints(id) {
  return (await kvGet('track:' + id)) || [];
}
export async function renameTrack(id, name) {
  const t = tracks.find((x) => x.id === id);
  if (t) t.name = name;
  await kvSet('tracks:index', tracks);
  bus.emit('tracks:changed');
}
export async function deleteTrack(id) {
  tracks = tracks.filter((t) => t.id !== id);
  await kvSet('tracks:index', tracks);
  await kvDel('track:' + id);
  try { await kvDel('thumb:' + id); } catch {}
  bus.emit('tracks:changed');
}

// aggiunge un punto: dopo pausa o buco lungo apre un nuovo segmento (5° elemento = 1), senza distanza di collegamento
function pushPoint(cur) {
  const last = rec.points[rec.points.length - 1];
  let brk = false;
  if (last) {
    const d = haversine({ lat: last[0], lon: last[1] }, { lat: cur[0], lon: cur[1] });
    if (!rec.brk && d < 4) return false;
    if (rec.brk || (cur[3] - last[3] > 10 * 60000 && d > 150)) brk = true;
    if (!brk) {
      rec.dist += d;
      if (cur[2] != null) {
        if (rec.lastAlt == null) rec.lastAlt = cur[2];
        else if (Math.abs(cur[2] - rec.lastAlt) >= 4) {
          if (cur[2] > rec.lastAlt) rec.up += cur[2] - rec.lastAlt;
          else rec.down += rec.lastAlt - cur[2];
          rec.lastAlt = cur[2];
        }
      }
    } else rec.lastAlt = cur[2];
  } else if (cur[2] != null) rec.lastAlt = cur[2];
  if (brk) cur = [cur[0], cur[1], cur[2], cur[3], 1];
  rec.brk = false;
  rec.points.push(cur);
  bus.emit('rec:point', cur);
  if (rec.points.length % 3 === 0) persistCurrent();
  return true;
}

function accept(p) {
  if (rec.status !== 'rec') return;
  if (p.acc != null && p.acc > 45) return;
  pushPoint([p.lat, p.lon, p.alt != null ? p.alt : null, p.ts || Date.now()]);
}

const persistCurrent = () => kvSet('rec:current', { ...rec, live: rec.status === 'rec', savedAt: Date.now() });

export function elapsed() {
  if (rec.status === 'idle') return 0;
  const now = rec.status === 'pause' ? rec.pauseAt : Date.now();
  return Math.max(0, (now - rec.start - rec.paused) / 1000);
}

export async function startRecording(resume = null) {
  if (rec.status !== 'idle') return;
  await ensurePermission();
  Object.assign(rec, resume || { id: uid(), name: '', start: Date.now(), points: [], dist: 0, up: 0, down: 0, paused: 0, lastAlt: null, brk: false, gaps: [] });
  rec.status = 'rec';
  if (!rec.name) rec.name = `Traccia ${fmtDate(rec.start).replace(',', '')}`;
  const p = lastPos();
  if (p) accept(p);
  if (isNative()) {
    try {
      if (!resume) await IF().recClear();
      await IF().recStart();
      try { await IF().keepStop(); } catch {}
      try {
        if (!localStorage.getItem('fp.batAsked')) {
          const b = await IF().batteryStatus();
          if (!b.ignoring) { localStorage.setItem('fp.batAsked', '1'); IF().requestBatteryExemption(); }
        }
      } catch {}
      if (resume) await mergeNative();
    } catch (e) { console.warn('recService', e); }
    try {
      watcherId = await BG.addWatcher(
        { requestPermissions: true, stale: false, distanceFilter: 3 },
        (loc, err) => {
          if (err || !loc) return;
          accept({ lat: loc.latitude, lon: loc.longitude, alt: loc.altitude, acc: loc.accuracy, ts: loc.time || Date.now() });
        }
      );
    } catch (e) {
      console.warn('bg watcher', e);
      unsubPos = bus.on('pos', accept);
    }
  } else {
    unsubPos = bus.on('pos', accept);
  }
  clearInterval(tickT);
  let tk = 0;
  tickT = setInterval(() => { bus.emit('rec:tick'); if (++tk % 20 === 0 && rec.status === 'rec') mergeNative(); }, 1000);
  persistCurrent();
  bus.emit('rec:state');
}

async function stopWatching() {
  clearInterval(tickT);
  if (isNative()) { try { await mergeNative(); await IF().recStop(); await IF().recClear(); try { if (getSettings().keepAlive !== false) await IF().keepStart(); } catch {} } catch {} }
  if (unsubPos) unsubPos(), (unsubPos = null);
  if (watcherId != null) {
    try {
      await BG.removeWatcher({ id: watcherId });
    } catch {}
    watcherId = null;
  }
}

export function pauseRecording() {
  if (rec.status !== 'rec') return;
  mergeNative();
  rec.status = 'pause';
  rec.pauseAt = Date.now();
  persistCurrent();
  bus.emit('rec:state');
}
export function resumeRecording() {
  if (rec.status !== 'pause') return;
  rec.paused += Date.now() - rec.pauseAt;
  (rec.gaps = rec.gaps || []).push([rec.pauseAt, Date.now()]);
  rec.brk = true;
  rec.status = 'rec';
  bus.emit('rec:state');
}

// Ferma e salva (restituisce la traccia salvata, o null se troppo corta)
export async function stopRecording({ save = true } = {}) {
  if (rec.status === 'idle') return null;
  const end = rec.status === 'pause' ? rec.pauseAt : Date.now();
  await stopWatching();
  const pts = rec.points.slice();
  const name = rec.name;
  const dur = Math.max(0, (end - rec.start - rec.paused) / 1000);
  Object.assign(rec, { status: 'idle', id: null, points: [], dist: 0, up: 0, down: 0, paused: 0, lastAlt: null, brk: false, gaps: [] });
  await kvDel('rec:current');
  bus.emit('rec:state');
  if (!save || pts.length < 2) return null;
  const t = buildTrack(name, pts);
  t.dur = dur;
  await saveTrack(t);
  return t;
}

export async function pendingRecovery() {
  let cur = await kvGet('rec:current');
  return cur && cur.points && cur.points.length > 1 && rec.status === 'idle' ? cur : null;
}
export async function recoverSave(cur) {
  const t = buildTrack(cur.name || 'Traccia recuperata', cur.points);
  await saveTrack(t);
  await kvDel('rec:current');
}
export async function discardRecovery() {
  await kvDel('rec:current');
}

// Salva subito quando l'app va in secondo piano; al ritorno aggancia la posizione attuale (riempie eventuali buchi)
try {
  document.addEventListener('visibilitychange', async () => {
    if (rec.status === 'idle') return;
    if (document.hidden) persistCurrent();
    else if (rec.status === 'rec') {
      await mergeNative();
      try { accept(await getOnce(8000)); } catch {}
    }
  });
  window.addEventListener('pagehide', () => rec.status !== 'idle' && persistCurrent());
} catch {}
