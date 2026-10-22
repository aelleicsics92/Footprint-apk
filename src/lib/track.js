import { registerPlugin } from '@capacitor/core';
import { kvGet, kvSet, kvDel } from './store.js';
import { bus, haversine, uid, fmtDate } from './util.js';
import { isNative, lastPos, ensurePermission, getOnce } from './geo.js';
import { buildTrack } from './gpsio.js';

const BG = registerPlugin('BackgroundGeolocation');

const rec = { status: 'idle', id: null, name: '', start: 0, points: [], dist: 0, up: 0, down: 0, paused: 0, pauseAt: 0, lastAlt: null };
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
  bus.emit('tracks:changed');
}

function accept(p) {
  if (rec.status !== 'rec') return;
  if (p.acc != null && p.acc > 45) return;
  const last = rec.points[rec.points.length - 1];
  const cur = [p.lat, p.lon, p.alt != null ? p.alt : null, p.ts || Date.now()];
  if (last) {
    const d = haversine({ lat: last[0], lon: last[1] }, p);
    if (d < 4) return;
    rec.dist += d;
    if (cur[2] != null) {
      if (rec.lastAlt == null) rec.lastAlt = cur[2];
      else if (Math.abs(cur[2] - rec.lastAlt) >= 4) {
        if (cur[2] > rec.lastAlt) rec.up += cur[2] - rec.lastAlt;
        else rec.down += rec.lastAlt - cur[2];
        rec.lastAlt = cur[2];
      }
    }
  } else if (cur[2] != null) rec.lastAlt = cur[2];
  rec.points.push(cur);
  bus.emit('rec:point', cur);
  if (rec.points.length % 3 === 0) persistCurrent();
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
  Object.assign(rec, resume || { id: uid(), name: '', start: Date.now(), points: [], dist: 0, up: 0, down: 0, paused: 0, lastAlt: null });
  rec.status = 'rec';
  if (!rec.name) rec.name = `Traccia ${fmtDate(rec.start).replace(',', '')}`;
  const p = lastPos();
  if (p) accept(p);
  if (isNative()) {
    try {
      watcherId = await BG.addWatcher(
        { backgroundTitle: 'Footprint: registrazione traccia', backgroundMessage: 'La traccia GPS è in registrazione', requestPermissions: true, stale: false, distanceFilter: 3 },
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
  tickT = setInterval(() => bus.emit('rec:tick'), 1000);
  persistCurrent();
  bus.emit('rec:state');
}

async function stopWatching() {
  clearInterval(tickT);
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
  rec.status = 'pause';
  rec.pauseAt = Date.now();
  persistCurrent();
  bus.emit('rec:state');
}
export function resumeRecording() {
  if (rec.status !== 'pause') return;
  rec.paused += Date.now() - rec.pauseAt;
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
  Object.assign(rec, { status: 'idle', id: null, points: [], dist: 0, up: 0, down: 0, paused: 0, lastAlt: null });
  await kvDel('rec:current');
  bus.emit('rec:state');
  if (!save || pts.length < 2) return null;
  const t = buildTrack(name, pts);
  t.dur = dur;
  await saveTrack(t);
  return t;
}

export async function pendingRecovery() {
  const cur = await kvGet('rec:current');
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
      try { accept(await getOnce(8000)); } catch {}
    }
  });
  window.addEventListener('pagehide', () => rec.status !== 'idle' && persistCurrent());
} catch {}
