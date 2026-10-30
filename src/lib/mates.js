// Radar compagni offline (Nearby Connections): più gruppi, ognuno con etichetta, nome tuo e interruttore on/off
import { registerPlugin, Capacitor } from '@capacitor/core';
import { lsGet, lsSet } from './store.js';
import { bus } from './util.js';

const IF = () => (Capacitor.Plugins && Capacitor.Plugins.IntentFiles) || registerPlugin('IntentFiles');
const native = () => Capacitor.isNativePlatform();
const AL = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// gruppi: [{ key, label, name, on }]; migrazione dal vecchio gruppo singolo
export function getGroups() {
  let g = lsGet('fp.mategroups', null);
  if (g) return g;
  g = [];
  const old = lsGet('fp.mategroup', null);
  if (old && old.key) g.push({ key: old.key, label: old.label || '', name: old.name || 'Io', on: lsGet('fp.mateVisible', true) !== false });
  lsSet('fp.mategroups', g);
  return g;
}
const save = (g) => lsSet('fp.mategroups', g);

export function createGroup(name, label = '') {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  const key = Array.from(a, (x) => AL[x % AL.length]).join('');
  save([...getGroups(), { key, label, name: name || 'Io', on: true }]);
  return key;
}
export function joinGroup(code, name, label = '') {
  const key = String(code).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (key.length < 6) return false;
  const g = getGroups();
  if (g.some((x) => x.key === key)) return 'dup';
  save([...g, { key, label, name: name || 'Io', on: true }]);
  return true;
}
export function updateGroup(key, patch) {
  save(getGroups().map((g) => (g.key === key ? { ...g, ...patch } : g)));
}
export function removeGroup(key) {
  save(getGroups().filter((g) => g.key !== key));
  lsSet('fp.mates', lsGet('fp.mates', []).filter((m) => m.gkey !== key));
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

// allinea il servizio nativo ai gruppi accesi (nessuno acceso = servizio spento, niente batteria)
export async function syncService(ask = false) {
  if (!native()) return false;
  const on = getGroups().filter((g) => g.on);
  try {
    if (!on.length) { await IF().mateStop(); return true; }
    const st = await IF().mateRead();
    if (!st.perms && !(ask && (await ensurePerms()))) return false;
    await IF().mateStart({ groups: JSON.stringify(on.map((g) => ({ key: g.key, name: g.name }))) });
    return true;
  } catch { return false; }
}
export async function search(seconds = 90) {
  if (!native()) return 'web';
  if (!getGroups().some((g) => g.on)) return 'nogroup';
  if (!(await syncService(true))) return 'perms';
  for (let i = 0; i < 10; i++) {
    if ((await IF().mateRead()).running) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  try { await IF().mateSearch({ seconds }); return 'ok'; } catch { return 'off'; }
}

function store(m) {
  const list = lsGet('fp.mates', []).filter((x) => !(x.name === m.name && x.gkey === m.gkey));
  list.push({ name: m.name, gkey: m.gkey, lat: m.lat, lon: m.lon, ts: m.t || Date.now(), src: 'nearby', bat: m.bat >= 0 ? m.bat : undefined, acc: m.acc > 0 ? m.acc : undefined });
  lsSet('fp.mates', list);
}
export async function syncFromNative() {
  if (!native()) return;
  try {
    const st = await IF().mateRead();
    const keys = new Set(getGroups().map((g) => g.key));
    for (const m of Object.values(st.mates || {})) {
      if (!m.gkey || !keys.has(m.gkey)) continue;
      const cur = lsGet('fp.mates', []).find((x) => x.name === m.name && x.gkey === m.gkey);
      if (!cur || (m.t || 0) > cur.ts) store(m);
    }
    for (const p of st.pings || []) { if (Date.now() - (p.t || 0) < 3600e3) onPing(p); }
    bus.emit('mates:changed');
  } catch {}
}
export async function sendPing(gkey, msg = '') {
  if (!native()) return 'web';
  if (!(await syncService(true))) return 'perms';
  for (let i = 0; i < 10; i++) {
    if ((await IF().mateRead()).running) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  try { await IF().matePing({ gkey, msg, seconds: 120 }); return 'ok'; } catch { return 'off'; }
}
function onPing(ev) {
  if (!getGroups().some((g) => g.key === ev.gkey)) return;
  const seen = lsGet('fp.pingseen', []);
  const id = ev.name + ev.t;
  if (seen.includes(id)) return;
  lsSet('fp.pingseen', seen.concat(id).slice(-30));
  store(ev);
  const l = lsGet('fp.mates', []);
  const m = l.find((x) => x.name === ev.name && x.gkey === ev.gkey);
  if (m) { m.ping = ev.t || Date.now(); lsSet('fp.mates', l); }
  bus.emit('mates:changed', { fresh: false });
  bus.emit('mates:ping', ev);
  import('./ui.js').then((u) => {
    const sh = u.openSheet({ title: `${ev.name} ti chiama`, body: `<p style="font-size:1.1rem;margin:4px 0 14px"><b>${String(ev.msg || 'Vienimi a prendere qui').replace(/[<>&]/g, '')}</b></p><button class="btn primary big" id="pg-go">Apri radar</button>` });
    sh.body.querySelector('#pg-go').onclick = () => { sh.close && sh.close(); import('../ui/radar.js').then((r) => r.openRadar()); };
    try { navigator.vibrate && navigator.vibrate([300, 150, 300, 150, 300]); } catch {}
  }).catch(() => {});
}
let inited = false;
export function initMates() {
  if (inited || !native()) return;
  inited = true;
  try {
    IF().addListener('mate', (ev) => { if (getGroups().some((g) => g.key === ev.gkey)) { store(ev); bus.emit('mates:changed', { fresh: true }); } });
    IF().addListener('ping', onPing);
    IF().addListener('searching', (ev) => bus.emit('mates:search', !!ev.searching));
  } catch {}
  syncService(false);
  syncFromNative();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { syncFromNative(); syncService(false); } });
}

// occhio per compagno: nascondi o mostra sulla mappa
export const matesHidden = () => lsGet('fp.matehide', []);
export const isMateHidden = (m) => matesHidden().includes((m.gkey || '') + '|' + m.name);
export function toggleMateHidden(m) {
  const k = (m.gkey || '') + '|' + m.name, l = matesHidden();
  lsSet('fp.matehide', l.includes(k) ? l.filter((x) => x !== k) : [...l, k]);
  bus.emit('mates:changed');
}
