// Notifiche locali: avviso nei giorni buoni per funghi/tartufi (calcolato dall'indice previsionale)
import { LocalNotifications } from '@capacitor/local-notifications';
import { getSettings } from './store.js';
import { bus } from './util.js';
import { lastPos } from './geo.js';
import { PROFILES, levelOf, outlook, getPointSeries, nearestZone } from './fungi.js';

const BASE = 7100;
const ids = () => Array.from({ length: 8 }, (_, i) => ({ id: BASE + i }));

export async function askNotifPermission() {
  try {
    const c = await LocalNotifications.checkPermissions();
    if (c.display === 'granted') return true;
    const r = await LocalNotifications.requestPermissions();
    return r.display === 'granted';
  } catch {
    return false;
  }
}

export async function scheduleFungiAlerts(lat, lon) {
  try {
    const s = getSettings();
    await LocalNotifications.cancel({ notifications: ids() });
    if (!s.notifFungi) return;
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display !== 'granted') return;
    const { series } = await getPointSeries(lat, lon);
    const prof = PROFILES[s.fungiProfile] || PROFILES.autunnali;
    const zone = nearestZone(lat, lon).zone.name;
    const notes = [];
    outlook(series, prof, series.elev).forEach((o, i) => {
      if (o.score < 45) return;
      const at = new Date(o.date + 'T07:30:00');
      if (at.getTime() < Date.now() + 60000) return;
      const lvl = levelOf(o.score);
      notes.push({
        id: BASE + i,
        title: `Giornata ${lvl.label.toLowerCase()} per i funghi`,
        body: `Indice ${o.score}/100 (${prof.short}) a ${zone}. Pioggia dei giorni scorsi e temperature sono favorevoli: buona uscita!`,
        schedule: { at },
        smallIcon: 'ic_stat_footprint',
      });
    });
    if (notes.length) await LocalNotifications.schedule({ notifications: notes.slice(0, 3) });
  } catch (e) {
    console.warn('notifiche', e);
  }
}

export function initNotifications() {
  let done = false;
  const run = () => {
    const p = lastPos();
    if (p) scheduleFungiAlerts(p.lat, p.lon);
  };
  bus.on('pos', () => {
    if (!done) {
      done = true;
      run();
    }
  });
  bus.on('settings:changed', (k) => {
    if (k === 'notifFungi' || k === 'fungiProfile') run();
  });
}

export async function notifyNow(title, body) {
  try {
    const c = await LocalNotifications.checkPermissions();
    if (c.display !== 'granted' && !(await askNotifPermission())) return false;
    await LocalNotifications.schedule({ notifications: [{ id: 7200 + Math.floor(Math.random() * 90), title, body, schedule: { at: new Date(Date.now() + 500) }, smallIcon: 'ic_stat_footprint' }] });
    return true;
  } catch {
    return false;
  }
}

// Notifica fissa con stato uscita (visibile anche a schermo bloccato)
import { haversine, fmtDist, fmtDur } from './util.js';
import { getWaypoints } from './waypoints.js';
import { getRec, elapsed } from './track.js';
let pinAt = 0;
export function initPinned() {
  bus.on('pos', async (p) => {
    if (!getSettings().statusNotif || Date.now() - pinAt < 30000) return;
    pinAt = Date.now();
    try {
      const perm = await LocalNotifications.checkPermissions();
      if (perm.display !== 'granted') return;
      await LocalNotifications.createChannel({ id: 'live', name: 'Stato uscita', importance: 2, vibration: false, sound: undefined });
      const car = getWaypoints().filter((w) => w.icon === 'parcheggio').sort((a, b) => b.ts - a.ts)[0];
      const rec = getRec();
      const parts = [`${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`];
      if (p.alt != null) parts.push(`${Math.round(p.alt)} m`);
      if (car) parts.push(`auto ${fmtDist(haversine(p, car))}`);
      if (rec && rec.status !== 'idle') parts.push(`REC ${fmtDur(elapsed())}`);
      await LocalNotifications.schedule({ notifications: [{ id: 7300, title: 'Footprint', body: parts.join(' · '), ongoing: true, autoCancel: false, channelId: 'live', schedule: { at: new Date(Date.now() + 400) }, smallIcon: 'ic_stat_footprint' }] });
    } catch {}
  });
  bus.on('settings:changed', async (k) => {
    if (k === 'statusNotif' && !getSettings().statusNotif) {
      try { await LocalNotifications.cancel({ notifications: [{ id: 7300 }] }); } catch {}
    }
  });
}
