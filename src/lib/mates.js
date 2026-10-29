// Radar compagni offline (Nearby Connections): gruppo con chiave segreta, visibilità on/off, ricerca su richiesta
import { registerPlugin, Capacitor } from '@capacitor/core';
import { lsGet, lsSet } from './store.js';
import { bus } from './util.js';

const IF = () => (Capacitor.Plugins && Capacitor.Plugins.IntentFiles) || registerPlugin('IntentFiles');
const native = () => Capacitor.isNativePlatform();
const AL = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const getGroup = () => lsGet('fp.mategroup', null);
export const isVisible = () => lsGet('fp.mateVisible', true);

export function createGroup(name) {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  const key = Array.from(a, (x) => AL[x % AL.length]).join('');
  lsSet('fp.mategroup', { key, name: name || 'Io' });
  return key;
}
export function joinGroup(code, name) {
  const key = String(code).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (key.length < 6) return false;
  lsSet('fp.mategroup', { key, name: name || 'Io' });
  return true;
}
export async function leaveGroup() {
  lsSet('fp.mategroup', null);
  try { await IF().mateStop(); } catch {}
}

async function ensurePerms() {
  const st = await IF().mateRead();
  if (st.perms) return true;
  await IF().mateAskPerms();
  for (let i = 0; i < 45; i++) {
    await new Promise((r) => setTimeout(r, 700));
    if ((await IF().mateRead()).perms) return true;
  }
  return false;
}

// avvio silenzioso all'apertura (senza chiedere permessi)
export async function startIfNeeded(ask = false) {
  if (!native()) return false;
  const g = getGroup();
  if (!g || !isVisible()) return false;
  try {
    const st = await IF().mateRead();
    if (!st.perms && !(ask && (await ensurePerms()))) return false;
    if (!st.running) await IF().mateStart({ key: g.key, name: g.name });
    return true;
  } catch { return false; }
}
export async function setVisible(v) {
  lsSet('fp.mateVisible', !!v);
  if (!native()) return true;
  if (v) return startIfNeeded(true);
  try { await IF().mateStop(); } catch {}
  return true;
}
export async function search(seconds = 90) {
  if (!native()) return 'web';
  const g = getGroup();
  if (!g) return 'nogroup';
  if (!(await startIfNeeded(true))) return 'perms';
  // il servizio parte in modo asincrono: aspetto che sia attivo
  for (let i = 0; i < 10; i++) {
    if ((await IF().mateRead()).running) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  try { await IF().mateSearch({ seconds }); return 'ok'; } catch { return 'off'; }
}

function store(m) {
  const list = lsGet('fp.mates', []).filter((x) => x.name !== m.name);
  list.push({ name: m.name, lat: m.lat, lon: m.lon, ts: m.t || Date.now(), src: 'nearby' });
  lsSet('fp.mates', list);
}
export async function syncFromNative() {
  if (!native()) return;
  try {
    const st = await IF().mateRead();
    for (const m of Object.values(st.mates || {})) {
      const cur = lsGet('fp.mates', []).find((x) => x.name === m.name);
      if (!cur || (m.t || 0) > cur.ts) store(m);
    }
    bus.emit('mates:changed');
  } catch {}
}
let inited = false;
export function initMates() {
  if (inited || !native()) return;
  inited = true;
  try {
    IF().addListener('mate', (ev) => { store(ev); bus.emit('mates:changed', { fresh: true }); });
    IF().addListener('searching', (ev) => bus.emit('mates:search', !!ev.searching));
  } catch {}
  startIfNeeded(false);
  syncFromNative();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { syncFromNative(); startIfNeeded(false); } });
}
