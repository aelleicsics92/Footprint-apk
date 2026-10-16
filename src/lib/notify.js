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
