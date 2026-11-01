// Backup online su Supabase (REST, senza SDK). Account anonimo per installazione, dati leggibili solo dal suo proprietario (RLS).
// Parte solo dopo il consenso esplicito dell'utente.
import { getWaypoints, addWaypoint } from './waypoints.js';
import { getTracks, loadTrackPoints, saveTrack } from './track.js';
import { kvGet, kvSet, lsGet, lsSet } from './store.js';
import { bus } from './util.js';

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

export function initCloud() {
  if (!cloudConfigured()) return;
  const tick = () => { if (consent() === 'yes' && Date.now() - lastBackup() > 6 * 3600e3) backupNow(); };
  setTimeout(tick, 20000);
  setInterval(tick, 30 * 60e3);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(tick, 5000); });
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
