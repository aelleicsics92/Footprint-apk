// Backup online su Supabase (REST, senza SDK). Account anonimo per installazione, dati leggibili solo dal suo proprietario (RLS).
// Parte solo dopo il consenso esplicito dell'utente.
import { getWaypoints, addWaypoint } from './waypoints.js';
import { getTracks, loadTrackPoints, saveTrack } from './track.js';
import { kvGet, kvSet, lsGet, lsSet } from './store.js';
import { bus } from './util.js';
import { Capacitor, registerPlugin } from '@capacitor/core';

const IF = () => (Capacitor.Plugins && Capacitor.Plugins.IntentFiles) || registerPlugin('IntentFiles');
const native = () => Capacitor.isNativePlatform && Capacitor.isNativePlatform();

const URL_ = ((import.meta.env && import.meta.env.VITE_SUPABASE_URL) || '').replace(/\/$/, '');
const KEY = (import.meta.env && import.meta.env.VITE_SUPABASE_ANON_KEY) || '';
export const cloudConfigured = () => !!(URL_ && KEY);
export const consent = () => lsGet('fp.cloud.consent', null); // 'yes' | 'no' | null
export const setConsent = (v) => lsSet('fp.cloud.consent', v);
export const lastBackup = () => lsGet('fp.cloud.last', 0);

const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return String(h) + ':' + s.length; };

async function auth() {
  let a = lsGet('fp.cloud.auth', null);
  const now = Math.floor(Date.now() / 1000);
  if (a && a.expires_at - 60 > now) return a;
  if (a && a.refresh_token) {
    const r = await fetch(`${URL_}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: a.refresh_token }) });
    if (r.ok) { const j = await r.json(); a = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at, uid: j.user.id }; lsSet('fp.cloud.auth', a); return a; }
  }
  const r = await fetch(`${URL_}/auth/v1/signup`, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: '{}' });
  if (!r.ok) throw new Error('accesso ' + r.status);
  const j = await r.json();
  a = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at, uid: j.user.id };
  lsSet('fp.cloud.auth', a);
  return a;
}
const H = (a, extra = {}) => ({ apikey: KEY, Authorization: 'Bearer ' + a.access_token, ...extra });

async function upsert(a, rows) {
  if (!rows.length) return;
  const r = await fetch(`${URL_}/rest/v1/backups?on_conflict=user_id,kind,item_id`, { method: 'POST', headers: H(a, { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }), body: JSON.stringify(rows) });
  if (!r.ok) throw new Error('scrittura ' + r.status);
}
async function putMedia(a, name, body, type) {
  const r = await fetch(`${URL_}/storage/v1/object/media/${a.uid}/${name}`, { method: 'POST', headers: H(a, { 'Content-Type': type, 'x-upsert': 'true' }), body });
  if (!r.ok) throw new Error('media ' + r.status);
}

export const cloudEmail = () => lsGet('fp.cloud.email', '');
// collega email e password all'account anonimo attuale (i dati restano gli stessi)
export async function linkEmail(email, password) {
  try {
    const a = await auth();
    const r = await fetch(`${URL_}/auth/v1/user`, { method: 'PUT', headers: H(a, { 'Content-Type': 'application/json' }), body: JSON.stringify({ email, password }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { error: j.msg || j.message || j.error_description || 'errore ' + r.status };
    lsSet('fp.cloud.email', email);
    return { ok: true, confirm: !j.email_confirmed_at && !j.confirmed_at };
  } catch (e) { return { error: String(e.message || e) }; }
}
// accesso con email (nuovo telefono): sostituisce l'identità anonima, poi si può ripristinare
export async function loginEmail(email, password) {
  try {
    const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { error: j.msg || j.error_description || j.message || 'credenziali non valide' };
    lsSet('fp.cloud.auth', { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at, uid: j.user.id });
    lsSet('fp.cloud.email', email);
    lsSet('fp.cloud.sent', {});
    return { ok: true };
  } catch (e) { return { error: String(e.message || e) }; }
}
export async function resetPassword(email) {
  try {
    const to = 'https://aelleicsics92.github.io/Footprint-apk/reset.html?k=' + encodeURIComponent(KEY);
    const r = await fetch(`${URL_}/auth/v1/recover?redirect_to=${encodeURIComponent(to)}`, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); return { error: j.msg || j.message || 'errore ' + r.status }; }
    return { ok: true };
  } catch (e) { return { error: String(e.message || e) }; }
}
export function logoutCloud() {
  lsSet('fp.cloud.auth', null); lsSet('fp.cloud.email', ''); lsSet('fp.cloud.sent', {}); lsSet('fp.cloud.last', 0);
}
// cancellazione di tutti i dati online di questo account
export async function deleteCloudData() {
  try {
    const a = await auth();
    let r = await fetch(`${URL_}/rest/v1/backups?user_id=eq.${a.uid}`, { method: 'DELETE', headers: H(a) });
    if (!r.ok) throw new Error('cancellazione ' + r.status);
    r = await fetch(`${URL_}/storage/v1/object/list/media`, { method: 'POST', headers: H(a, { 'Content-Type': 'application/json' }), body: JSON.stringify({ prefix: a.uid, limit: 1000 }) });
    const files = r.ok ? await r.json() : [];
    if (files.length) await fetch(`${URL_}/storage/v1/object/media`, { method: 'DELETE', headers: H(a, { 'Content-Type': 'application/json' }), body: JSON.stringify({ prefixes: files.map((f) => `${a.uid}/${f.name}`) }) });
    lsSet('fp.cloud.sent', {}); lsSet('fp.cloud.last', 0);
    return { ok: true };
  } catch (e) { return { error: String(e.message || e) }; }
}

let busy = false;
export async function backupNow() {
  if (busy || !cloudConfigured() || consent() !== 'yes' || !navigator.onLine) return { skipped: true };
  busy = true;
  const sent = lsGet('fp.cloud.sent', {});
  let n = 0;
  try {
    const a = await auth();
    // waypoint (a gruppi)
    let rows = [];
    for (const w of getWaypoints()) {
      const sig = hash(JSON.stringify(w));
      if (sent['w:' + w.id] === sig) continue;
      if (w.photo) { const p = await kvGet('photo:' + w.id); if (p && sent['p:' + w.id] !== String(p.length)) { await putMedia(a, `photo-${w.id}.txt`, p, 'text/plain'); sent['p:' + w.id] = String(p.length); } }
      if (w.memo) { const m = await kvGet('memo:' + w.id); if (m && sent['m:' + w.id] !== String(m.size)) { await putMedia(a, `memo-${w.id}.bin`, m, m.type || 'application/octet-stream'); sent['m:' + w.id] = String(m.size); } }
      rows.push({ kind: 'waypoint', item_id: w.id, data: w, updated_at: new Date().toISOString() });
      sent['w:' + w.id] = sig;
      if (rows.length >= 20) { await upsert(a, rows); n += rows.length; rows = []; lsSet('fp.cloud.sent', sent); }
    }
    await upsert(a, rows); n += rows.length;
    // tracce, una per volta (i punti possono essere tanti)
    for (const t of getTracks()) {
      const sig = hash(JSON.stringify(t));
      if (sent['t:' + t.id] === sig) continue;
      const points = await loadTrackPoints(t.id);
      await upsert(a, [{ kind: 'track', item_id: t.id, data: { meta: t, points }, updated_at: new Date().toISOString() }]);
      sent['t:' + t.id] = sig; n++;
      lsSet('fp.cloud.sent', sent);
    }
    lsSet('fp.cloud.sent', sent);
    lsSet('fp.cloud.last', Date.now());
    bus.emit('cloud:done', { n });
    return { n };
  } catch (e) {
    lsSet('fp.cloud.sent', sent);
    bus.emit('cloud:error', String(e.message || e));
    return { error: String(e.message || e) };
  } finally { busy = false; }
}

// Ripristino: aggiunge ciò che manca sul telefono (non sovrascrive nulla)
export async function restoreNow() {
  if (!cloudConfigured() || !navigator.onLine) return { error: 'offline' };
  try {
    const a = await auth();
    const r = await fetch(`${URL_}/rest/v1/backups?select=kind,item_id,data`, { headers: H(a) });
    if (!r.ok) throw new Error('lettura ' + r.status);
    const rows = await r.json();
    const haveW = new Set(getWaypoints().map((w) => w.id)), haveT = new Set(getTracks().map((t) => t.id));
    let nw = 0, nt = 0;
    for (const x of rows) {
      if (x.kind === 'waypoint' && !haveW.has(x.item_id)) {
        const w = x.data;
        if (w.photo) { try { const pr = await fetch(`${URL_}/storage/v1/object/authenticated/media/${a.uid}/photo-${w.id}.txt`, { headers: H(a) }); if (pr.ok) await kvSet('photo:' + w.id, await pr.text()); else w.photo = false; } catch { w.photo = false; } }
        if (w.memo) { try { const mr = await fetch(`${URL_}/storage/v1/object/authenticated/media/${a.uid}/memo-${w.id}.bin`, { headers: H(a) }); if (mr.ok) await kvSet('memo:' + w.id, await mr.blob()); else w.memo = false; } catch { w.memo = false; } }
        await addWaypoint(w); nw++;
      } else if (x.kind === 'track' && !haveT.has(x.item_id)) {
        await saveTrack({ ...x.data.meta, points: x.data.points }); nt++;
      }
    }
    return { nw, nt };
  } catch (e) { return { error: String(e.message || e) }; }
}

// ultimo passaggio delle 02:00 (oggi se già passate, altrimenti ieri)
function lastBoundary() { const d = new Date(); d.setHours(2, 0, 0, 0); if (d.getTime() > Date.now()) d.setDate(d.getDate() - 1); return d.getTime(); }

// Coda per il backup notturno nativo (app chiusa): solo ciò che è cambiato
let outboxT = 0;
export async function prepareOutbox() {
  if (!native() || !cloudConfigured() || consent() !== 'yes') return;
  const a = lsGet('fp.cloud.auth', null);
  if (!a) return;
  const sent = lsGet('fp.cloud.sent', {});
  const rows = [], photos = [];
  for (const w of getWaypoints()) {
    const sig = hash(JSON.stringify(w));
    if (sent['w:' + w.id] === sig) continue;
    if (w.photo) { const ph = await kvGet('photo:' + w.id); if (ph && sent['p:' + w.id] !== String(ph.length)) photos.push({ k: 'p:' + w.id, s: String(ph.length), name: `photo-${w.id}.txt`, text: ph }); }
    rows.push({ k: 'w:' + w.id, s: sig, kind: 'waypoint', item_id: w.id, data: w });
  }
  for (const t of getTracks()) {
    const sig = hash(JSON.stringify(t));
    if (sent['t:' + t.id] === sig) continue;
    rows.push({ k: 't:' + t.id, s: sig, kind: 'track', item_id: t.id, data: { meta: t, points: await loadTrackPoints(t.id) } });
  }
  try { await IF().outboxWrite({ json: JSON.stringify({ url: URL_, key: KEY, auth: a, rows, photos }) }); } catch {}
}
export function queueOutbox() { clearTimeout(outboxT); outboxT = setTimeout(() => { prepareOutbox(); }, 4000); }

// applica il risultato del backup notturno fatto dal sistema
async function applyNightly() {
  if (!native()) return;
  try {
    const r = await IF().outboxResult();
    if (!r || !r.has) return;
    const j = JSON.parse(r.json);
    const sent = lsGet('fp.cloud.sent', {});
    for (const x of j.ok || []) sent[x.k] = x.s;
    lsSet('fp.cloud.sent', sent);
    if (j.auth && j.auth.access_token) lsSet('fp.cloud.auth', { ...lsGet('fp.cloud.auth', {}), ...j.auth });
    if ((j.ok || []).length) lsSet('fp.cloud.last', j.t || Date.now());
  } catch {}
}

// Dati degli altri utenti (visibili solo se il database lo consente, cioè al gestore)
export const showOthers = () => lsGet('fp.cloud.others', false);
export const setShowOthers = (v) => { lsSet('fp.cloud.others', !!v); bus.emit('others:toggle', !!v); };
export async function cachedOthers() { return (await kvGet('others:cache')) || { t: 0, rows: [] }; }
export async function fetchOthers() {
  if (!cloudConfigured() || !navigator.onLine) return { error: 'offline' };
  try {
    const a = await auth();
    const since = new Date(Date.now() - 90 * 864e5).toISOString();
    const q = `select=user_id,kind,item_id,data&user_id=neq.${a.uid}&kind=in.(waypoint,track)&updated_at=gte.${since}&order=updated_at.desc&limit=300`;
    const r = await fetch(`${URL_}/rest/v1/backups?${q}`, { headers: H(a) });
    if (!r.ok) throw new Error('lettura ' + r.status);
    const rows = await r.json();
    await kvSet('others:cache', { t: Date.now(), rows });
    bus.emit('others:update', rows);
    return { n: rows.length };
  } catch (e) { return { error: String(e.message || e) }; }
}

export function initCloud() {
  if (!cloudConfigured()) return;
  const tick = async () => {
    await applyNightly();
    if (consent() !== 'yes') { if (native()) IF().nightlySchedule({ enabled: false }).catch(() => {}); return; }
    if (native()) IF().nightlySchedule({ enabled: true }).catch(() => {});
    if (lastBackup() < lastBoundary()) await backupNow();
    prepareOutbox();
    if (showOthers() && Date.now() - (await cachedOthers()).t > 3600e3) fetchOthers();
  };
  setTimeout(tick, 15000);
  setInterval(tick, 30 * 60e3);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(tick, 3000); else queueOutbox(); });
  bus.on && bus.on('cloud:done', queueOutbox);
  setInterval(queueOutbox, 10 * 60e3);
}

// consenso al primo avvio: dice chiaramente cosa viene salvato
export function askConsent(openSheet) {
  if (!cloudConfigured() || consent() !== null) return;
  const s = openSheet({
    title: 'Backup online dei tuoi dati',
    body: `<p style="margin:0 0 10px">Footprint può salvare online una copia di sicurezza di:</p>
      <ul style="margin:0 0 10px;padding-left:20px;line-height:1.5"><li><b>posizioni dei tuoi waypoint</b></li><li><b>tracce GPS</b> registrate</li><li><b>foto e memo vocali</b> dei waypoint</li></ul>
      <p style="margin:0 0 10px;font-size:.9rem" class="muted">Non servono nome né email: i dati sono legati a un codice anonimo creato sul tuo telefono e gli altri utenti non possono vederli. Il gestore dell'app può consultarli. Puoi disattivare il backup in ogni momento da Altro, Impostazioni. <a href="https://aelleicsics92.github.io/Footprint-apk/privacy.html" target="_blank" rel="noopener">Informativa privacy</a></p>
      <div class="row gap"><button class="btn ghost grow" id="cl-no">No grazie</button><button class="btn primary grow" id="cl-yes">Accetto</button></div>`,
  });
  s.body.querySelector('#cl-yes').onclick = () => { setConsent('yes'); s.close(); backupNow(); };
  s.body.querySelector('#cl-no').onclick = () => { setConsent('no'); s.close(); };
  s.onClose = () => { if (consent() === null) setConsent('no'); };
}
