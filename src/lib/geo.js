import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { bus } from './util.js';

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

export async function startWatch() {
  if (watchId != null) return;
  const ok = await ensurePermission();
  if (!ok) bus.emit('gps:denied');
  try {
    watchId = await Geolocation.watchPosition({ enableHighAccuracy: true, timeout: 25000, maximumAge: 1500 }, (pos, err) => {
      if (err || !pos) {
        bus.emit('gps:error', err);
        return;
      }
      last = norm(pos);
      bus.emit('pos', last);
    });
  } catch (e) {
    bus.emit('gps:error', e);
  }
}

export async function getOnce(timeout = 15000) {
  if (last && Date.now() - last.ts < 20000) return last;
  await ensurePermission();
  const p = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout });
  last = norm(p);
  return last;
}
