import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { bus } from './util.js';
import { App } from '@capacitor/app';

let watchId = null;
let last = null;
export const lastPos = () => last;
export const isNative = () => Capacitor.isNativePlatform();

const norm = (p) => ({
  lat: p.coords.latitude,
  lon: p.coords.longitude,
  alt: p.coords.altitude,
  acc: p.coords.accuracy,
  heading: p.coords.heading,
  speed: p.coords.speed,
  ts: p.timestamp || Date.now(),
});

export async function ensurePermission() {
  try {
    if (isNative()) {
      const p = await Geolocation.checkPermissions();
      if (p.location !== 'granted' && p.coarseLocation !== 'granted') {
        const r = await Geolocation.requestPermissions({ permissions: ['location'] });
        return r.location === 'granted' || r.coarseLocation === 'granted';
      }
    }
    return true;
  } catch {
    return false;
  }
}

let status = { state: 'init', msg: 'In attesa del GPS…' };
export const gpsStatus = () => status;
function setStatus(state, msg) {
  if (status.state === state && status.msg === msg) return;
  status = { state, msg };
  bus.emit('gps:status', status);
}
let lastFixAt = 0, dog = null, poll = null, starting = false;

function onFix(pos) {
  last = norm(pos);
  lastFixAt = Date.now();
  setStatus('ok', '');
  bus.emit('pos', last);
}
function onErr(err) {
  const m = String((err && (err.message || err)) || '').toLowerCase();
  if (/denied|permission/.test(m)) setStatus('denied', 'Permesso posizione negato. Tocca qui, oppure abilitalo in Impostazioni > App > Footprint > Autorizzazioni.');
  else if (/not enabled|disabled|location services|settings/.test(m)) setStatus('off', 'Posizione del telefono spenta: attivala dal pannello rapido.');
  else if (status.state !== 'ok') setStatus('searching', 'Cerco il segnale GPS… esci all\'aperto.');
  bus.emit('gps:error', err);
}

async function begin() {
  if (starting) return;
  starting = true;
  try {
    const ok = await ensurePermission();
    if (!ok) {
      setStatus('denied', 'Permesso posizione negato. Tocca qui, oppure abilitalo in Impostazioni > App > Footprint > Autorizzazioni.');
      bus.emit('gps:denied');
      return;
    }
    if (status.state === 'init' || status.state === 'denied') setStatus('searching', 'Cerco il segnale GPS… esci all\'aperto.');
    if (watchId != null) {
      try { await Geolocation.clearWatch({ id: watchId }); } catch {}
      watchId = null;
    }
    watchId = await Geolocation.watchPosition({ enableHighAccuracy: true, timeout: 25000, maximumAge: 0, interval: 1000, minimumUpdateInterval: 1000 }, (pos, err) => (err || !pos ? onErr(err) : onFix(pos)));
    // fix rapido da rete/ultima posizione nota, mentre il GPS si aggancia
    if (!last) Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }).then(onFix, onErr);
  } catch (e) {
    onErr(e);
  } finally {
    starting = false;
  }
}

export async function restartWatch() {
  watchId = null; // forza un nuovo watch
  await begin();
}

export async function startWatch() {
  await begin();
  // cane da guardia: se per 40 s non arrivano fix, riavvia il servizio di posizione
  if (!poll) {
    // rete di sicurezza: se per 6 s non arriva un fix dal watch, ne chiede uno diretto
    poll = setInterval(async () => {
      if (document.hidden || Date.now() - lastFixAt < 6000) return;
      try {
        onFix(await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }));
      } catch {}
    }, 4000);
  }
  if (!dog) {
    dog = setInterval(() => {
      if (Date.now() - lastFixAt > 40000) restartWatch();
    }, 20000);
    try {
      App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) restartWatch();
      });
    } catch {}
  }
}

export async function getOnce(timeout = 15000) {
  if (last && Date.now() - last.ts < 20000) return last;
  await ensurePermission();
  const p = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout });
  last = norm(p);
  return last;
}
