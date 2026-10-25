import { kvGet, kvSet, getSettings, setSetting } from './store.js';
import { getTerrain, terrainText } from './terrain.js';
import { bus, esc, pad, uid, fmtCoord, fmtDate, fmtDist, haversine, bearing, cardinal } from './util.js';
import { openSheet, toast, confirmBox, closeTopPage } from './ui.js';
import { orderedIcons, wpIcon, ico, TRUFFLE_ICONS } from './icons.js';
import { lastPos, getOnce } from './geo.js';
import { apiKey } from './store.js';
import { toGPX, shareFile, shareText, safeName, mapsLink } from './gpsio.js';

let list = [];
export const getWaypoints = () => list;
export const getWaypoint = (id) => list.find((w) => w.id === id);

async function persist() {
  await kvSet('waypoints', list);
  bus.emit('wp:changed');
}
export async function loadWaypoints() {
  list = (await kvGet('waypoints')) || [];
  bus.emit('wp:changed');
}
export async function addWaypoint(w) {
  list.push(w);
  await persist();
}
export async function updateWaypoint(id, patch) {
  const w = getWaypoint(id);
  if (w) Object.assign(w, patch);
  await persist();
}
export async function removeWaypoint(id) {
  list = list.filter((w) => w.id !== id);
  await persist();
  bus.emit('wp:removed', id);
}
export let lastDup = 0;
export async function mergeWaypoints(arr) {
  let n = 0;
  lastDup = 0;
  for (const w of arr) {
    if (list.some((x) => Math.abs(x.lat - w.lat) < 1e-6 && Math.abs(x.lon - w.lon) < 1e-6 && x.title === w.title)) { lastDup++; continue; }
    list.push(w);
    n++;
  }
  if (n) await persist();
  return n;
}

const nextTitle = (iconId) => {
  const label = wpIcon(iconId).label;
  const re = new RegExp('^' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' (\\d+)$');
  let max = 0;
  for (const w of list) if (w.icon === iconId) { const m = re.exec(w.title || ''); if (m) max = Math.max(max, Number(m[1])); }
  return `${label} ${pad(max + 1)}`;
};

async function currentFix() {
  let p = lastPos();
  if (!p) {
    try {
      p = await getOnce(8000);
    } catch {}
  }
  return p;
}

// Salvataggio rapido (pressione lunga sul pulsante)
export async function quickWaypoint() {
  const p = await currentFix();
  if (!p) return toast('GPS non ancora pronto');
  const icon = 'fungo';
  const title = nextTitle(icon);
  const w = { id: uid(), title, desc: '', icon, dog: '', lat: p.lat, lon: p.lon, alt: p.alt, acc: p.acc, ts: Date.now() };
  await addWaypoint(w);
  toast(`Salvato: ${title}`);
}

// Salva la posizione attuale come parcheggio dell'auto
export async function saveParking() {
  const p = await currentFix();
  if (!p) return toast('GPS non ancora pronto');
  const w = { id: uid(), title: 'Auto parcheggiata', desc: 'Parcheggio', icon: 'parcheggio', lat: p.lat, lon: p.lon, alt: p.alt, acc: p.acc, ts: Date.now() };
  await addWaypoint(w);
  navigator.vibrate && navigator.vibrate([90, 50, 90]);
  toast('Parcheggio salvato: ora puoi farti guidare all\'auto');
  return w;
}

// Punti salvati da tile Quick Settings o widget mentre l'app era chiusa
export async function importQuick(items) {
  let n = 0;
  for (const it of items) {
    let p = it;
    if (it.needFix || it.lat == null) p = await currentFix();
    if (!p) continue;
    const car = it.type === 'car';
    const icon = car ? 'parcheggio' : 'fungo';
    await addWaypoint({ id: uid(), title: car ? 'Auto parcheggiata' : nextTitle(icon), desc: car ? 'Parcheggio' : '', icon, lat: p.lat, lon: p.lon, alt: p.alt, acc: p.acc, ts: it.ts || Date.now() });
    n++;
  }
  if (n) toast(n === 1 ? 'Punto rapido aggiunto' : `${n} punti rapidi aggiunti`);
}

const dogs = () => [...new Set([...(getSettings().dogName || '').split(',').map((x) => x.trim()), ...list.map((w) => w.dog)].filter(Boolean))];

const TAGS = [
  ['Albero', ['Castagno', 'Faggio', 'Quercia', 'Abete', 'Pino', 'Pioppo', 'Nocciolo']],
  ['Sottobosco', ['Felci', 'Muschio', 'Mirtillo', 'Aghi di pino', 'Erba']],
  ['Terreno', ['Umido', 'Secco', 'Sotto roccia']],
];
const STATI = [['verde', '🟢 In cacciata'], ['giallo', '🟡 A fine cacciata'], ['rosso', '🔴 Finito / secco']];

function formHTML({ wp, pos, title, icon }) {
  const hid = getSettings().wpHidden || [];
  const grid = orderedIcons(getSettings().wpOrder).filter((i) => !hid.includes(i.id) || i.id === icon).map(
    (i) => `<button type="button" class="icon-opt ${i.id === icon ? 'sel' : ''}" data-icon="${i.id}" title="${esc(i.label)}"><span class="ic">${i.svg}</span><small>${esc(i.label)}</small></button>`
  ).join('');
  const alt = pos && pos.alt != null ? `quota ${Math.round(pos.alt)} m` : '';
  const acc = pos && pos.acc != null ? `±${Math.round(pos.acc)} m` : '';
  return `<div class="wp-form" data-enter-scope>
    <div class="icon-grid">${grid}</div>
    <label class="field"><span>Titolo</span><input id="wp-title" data-noselect type="text" value="${esc(title)}" maxlength="80" autocomplete="off"></label>
    <label class="field"><span>Descrizione</span><textarea id="wp-desc" rows="2" maxlength="400" placeholder="Note, zona, quantità…">${esc(wp ? wp.desc : '')}</textarea></label>
    <div class="field"><span>Stato della fungaia</span><div class="tagrow" id="wp-stato">${STATI.map(([k, l]) => `<button type="button" class="tagc ${wp && wp.stato === k ? 'sel' : ''}" data-st="${k}">${l}</button>`).join('')}</div></div>
    <div class="field"><span>Habitat</span>${TAGS.map(([g, a]) => `<div class="tagrow"><small>${g}</small>${a.map((t) => `<button type="button" class="tagc ${wp && (wp.tags || []).includes(t) ? 'sel' : ''}" data-tag="${t}">${t}</button>`).join('')}</div>`).join('')}</div>
    <div class="row gap"><label class="field grow"><span>Quantità (pz)</span><input id="wp-qty" type="number" min="0" inputmode="numeric" value="${wp && wp.qty ? wp.qty : ''}" onfocus="this.select()"></label><label class="field grow"><span>Peso (kg)</span><input id="wp-kg" type="number" min="0" step="0.1" inputmode="decimal" value="${wp && wp.kg ? wp.kg : ''}" onfocus="this.select()"></label></div>
    <label class="field" id="wp-dog-row" ${TRUFFLE_ICONS.includes(icon) ? '' : 'hidden'}><span>Cane (chi ha trovato)</span><input id="wp-dog" type="text" list="wp-dogs" value="${esc(wp ? wp.dog || '' : dogs()[0] || '')}" maxlength="30" autocomplete="off" placeholder="Nome del cane" onfocus="this.select()"><datalist id="wp-dogs">${dogs().map((d) => `<option value="${esc(d)}">`).join('')}</datalist></label>
    <button type="button" class="btn ghost" id="wp-voice">${ico('mic', 18)} Memo vocale (trascrive)</button><div id="wp-voice-out" class="muted" style="font-size:.82rem;margin:4px 0"></div>
    <div class="coords-box"><span class="lbl">Coordinate GPS</span><b>${pos ? fmtCoord(pos.lat, pos.lon) : 'in attesa del GPS…'}</b><small>${[alt, acc].filter(Boolean).join(' · ')}</small>${wp ? `<div class="row gap" style="margin-top:8px"><button type="button" class="btn ghost grow" id="wp-here">Posizione attuale</button><button type="button" class="btn ghost grow" id="wp-pick">Sposta sulla mappa</button></div>` : ''}<button type="button" class="btn ghost" id="wp-exif" style="margin-top:8px">Posizione da una foto (GPS)</button><input type="file" accept="image/*" id="wp-exif-f" hidden></div>
    <div class="save-bar"><button class="btn primary big" data-primary id="wp-save" ${pos ? '' : 'disabled'}>${ico('check', 20)} Salva waypoint</button></div>
  </div>`;
}

function wireForm(s, { wp, pos, onSave }) {
  let icon = wp ? wp.icon : 'fungo';
  let np = null;
  let stato = wp ? wp.stato || '' : '';
  const tags = new Set(wp ? wp.tags || [] : []);
  s.body.querySelector('#wp-stato').addEventListener('click', (e) => {
    const b = e.target.closest('[data-st]');
    if (!b) return;
    stato = stato === b.dataset.st ? '' : b.dataset.st;
    s.body.querySelectorAll('[data-st]').forEach((x) => x.classList.toggle('sel', x.dataset.st === stato));
  });
  s.body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tag]');
    if (!b) return;
    const t = b.dataset.tag;
    tags.has(t) ? tags.delete(t) : tags.add(t);
    b.classList.toggle('sel', tags.has(t));
  });
  let titleEdited = false;
  const titleEl = s.body.querySelector('#wp-title');
  titleEl.addEventListener('input', () => (titleEdited = true));
  s.body.querySelector('.icon-grid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-icon]');
    if (!b) return;
    icon = b.dataset.icon;
    s.body.querySelectorAll('.icon-opt').forEach((x) => x.classList.toggle('sel', x === b));
    if (!titleEdited) titleEl.value = wp && icon === wp.icon ? wp.title : nextTitle(icon);
    s.body.querySelector('#wp-dog-row').hidden = !TRUFFLE_ICONS.includes(icon);
  });
  const cb = s.body.querySelector('.coords-box b'), cs = s.body.querySelector('.coords-box small');
  const showNp = () => { cb.textContent = fmtCoord(np.lat, np.lon); cs.textContent = 'nuova posizione (salva per applicare)'; };
  const draft = () => ({ stato, tags: [...tags], title: titleEl.value, desc: s.body.querySelector('#wp-desc').value, icon, qty: Number(s.body.querySelector('#wp-qty').value) || 0, kg: Number(s.body.querySelector('#wp-kg').value) || 0, dog: s.body.querySelector('#wp-dog').value, ...(np || {}) });
  const hereB = s.body.querySelector('#wp-here'), pickB = s.body.querySelector('#wp-pick');
  if (hereB) hereB.addEventListener('click', async () => {
    const p = await currentFix();
    if (!p) return toast('GPS non ancora pronto');
    np = { lat: p.lat, lon: p.lon, alt: p.alt, acc: p.acc };
    showNp();
  });
  if (pickB) pickB.addEventListener('click', () => {
    const d = draft(), at = np || wp;
    s.close();
    bus.emit('wp:pick', { lat: at.lat, lon: at.lon, done: (pt) => openEditWaypoint(wp, pt ? { ...d, lat: pt.lat, lon: pt.lon, alt: null, acc: null } : d) });
  });
  const exB = s.body.querySelector('#wp-exif'), exF = s.body.querySelector('#wp-exif-f');
  exB.addEventListener('click', () => exF.click());
  exF.addEventListener('change', async () => {
    const f = exF.files && exF.files[0];
    if (!f) return;
    try {
      const { gps } = await import('exifr');
      const g = await gps(f);
      if (!g || g.latitude == null) return toast('La foto non contiene la posizione GPS');
      np = { lat: g.latitude, lon: g.longitude, alt: null, acc: null };
      showNp();
      const sv = s.body.querySelector('#wp-save');
      if (sv) sv.disabled = false;
    } catch {
      toast('Impossibile leggere la foto');
    }
  });
  let memo = null, rec = null;
  const vb = s.body.querySelector('#wp-voice'), vo = s.body.querySelector('#wp-voice-out');
  vb.addEventListener('click', async () => {
    if (rec) return rec.stop();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks = [];
      rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        rec = null;
        vb.innerHTML = `${ico('mic', 18)} Memo vocale (trascrive)`;
        memo = new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' });
        vo.textContent = 'Memo salvato. Trascrivo…';
        try {
          const key = apiKey('groq');
          if (!key || !navigator.onLine) throw new Error('offline');
          const fd = new FormData();
          fd.append('file', memo, 'memo.webm');
          fd.append('model', 'whisper-large-v3-turbo');
          fd.append('language', 'it');
          const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd });
          if (!r.ok) throw new Error('http ' + r.status);
          const t = ((await r.json()).text || '').trim();
          const d = s.body.querySelector('#wp-desc');
          d.value = (d.value ? d.value + ' ' : '') + t;
          vo.textContent = 'Memo salvato e trascritto.';
        } catch {
          vo.textContent = 'Memo salvato (trascrizione non disponibile: serve internet).';
        }
      };
      rec.start();
      vb.innerHTML = `${ico('stop', 18)} Stop registrazione`;
      vo.textContent = 'Parla ora (max 60 s)…';
      setTimeout(() => rec && rec.stop(), 60000);
    } catch {
      rec = null;
      toast('Microfono non disponibile');
    }
  });
  s.body.querySelector('#wp-save').addEventListener('click', async () => {
    const title = titleEl.value.trim() || nextTitle(icon);
    const desc = s.body.querySelector('#wp-desc').value.trim();
    const qty = Number(s.body.querySelector('#wp-qty').value) || 0;
    const kg = Number(s.body.querySelector('#wp-kg').value) || 0;
    const dog = TRUFFLE_ICONS.includes(icon) ? s.body.querySelector('#wp-dog').value.trim() : '';
    await onSave({ title, desc, icon, qty, kg, memo, dog, np, stato, tags: [...tags] });
    s.close();
  });
}

export async function openNewWaypoint() {
  const pos = await currentFix();
  const title = nextTitle('fungo');
  const s = openSheet({ title: 'Nuovo waypoint', body: formHTML({ pos, title, icon: 'fungo' }), full: true });
  setTimeout(() => { try { document.activeElement && document.activeElement.blur(); } catch {} }, 50);
  // aggiorna le coordinate se il fix arriva dopo
  let fix = pos;
  const off = bus.on('pos', (p) => {
    if (!fix) {
      fix = p;
      s.close();
      openNewWaypoint();
    }
  });
  const prevClose = s.close;
  s.onClose = off;
  wireForm(s, {
    pos,
    onSave: async ({ title, desc, icon, qty, kg, memo, dog, np, stato, tags }) => {
      const at = np || fix;
      if (!at) return;
      const w = { id: uid(), title, desc, icon, qty, kg, dog, stato, tags, memo: !!memo, lat: at.lat, lon: at.lon, alt: at.alt, acc: at.acc, ts: Date.now() };
      if (memo) await kvSet('memo:' + w.id, memo);
      await addWaypoint(w);
      toast(`Salvato: ${title}`);
    },
  });
}

export function openEditWaypoint(w, draft) {
  const v = draft ? { ...w, ...draft } : w;
  const s = openSheet({ title: 'Modifica waypoint', body: formHTML({ wp: v, pos: v, title: v.title, icon: v.icon }), full: true });
  if (draft && draft.lat !== w.lat) {
    const cb = s.body.querySelector('.coords-box b'), cs = s.body.querySelector('.coords-box small');
    cb.textContent = fmtCoord(draft.lat, draft.lon); cs.textContent = 'nuova posizione (salva per applicare)';
  }
  wireForm(s, {
    wp: v,
    pos: v,
    onSave: async ({ title, desc, icon, qty, kg, memo, dog, np, stato, tags }) => {
      if (memo) await kvSet('memo:' + w.id, memo);
      const moved = np || (draft && draft.lat !== w.lat ? { lat: draft.lat, lon: draft.lon, alt: draft.alt, acc: draft.acc } : null);
      await updateWaypoint(w.id, { title, desc, icon, qty, kg, dog, stato, tags, ...(moved || {}), ...(memo ? { memo: true } : {}) });
      toast('Modificato');
    },
  });
}

export function shareWaypoint(w) {
  const s = openSheet({
    title: 'Condividi waypoint',
    body: `<div class="stack">
      <button class="btn primary big" data-k="text">${ico('chat', 20)} Messaggio (WhatsApp, Telegram…)</button>
      <button class="btn ghost big" data-k="gpx">${ico('download', 20)} File GPX (Garmin e altri GPS)</button></div>`,
  });
  s.body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-k]');
    if (!b) return;
    s.close();
    try {
      if (b.dataset.k === 'text') {
        await shareText(`📍 ${w.title}\n${w.desc ? w.desc + '\n' : ''}${fmtCoord(w.lat, w.lon)}\n${mapsLink(w.lat, w.lon)}\n— Footprint`, w.title);
      } else {
        await shareFile(`${safeName(w.title)}.gpx`, toGPX({ waypoints: [w], name: w.title }), { title: w.title, text: `Waypoint ${w.title}` });
      }
    } catch (err) {
      if (!String(err).toLowerCase().includes('cancel')) toast('Condivisione non riuscita');
    }
  });
}

export function openWaypoint(w) {
  const me = lastPos();
  const info = me ? `${fmtDist(haversine(me, w))} · ${Math.round(bearing(me, w))}° ${cardinal(bearing(me, w))}` : '';
  const ic = wpIcon(w.icon);
  const s = openSheet({
    body: `<div class="wp-detail">
      <div class="wp-head"><span class="ic big">${ic.svg}</span><div><h3>${esc(w.title)}</h3><small>${esc(ic.label)} · ${fmtDate(w.ts)}</small></div></div>
      ${w.desc ? `<p class="wp-desc">${esc(w.desc)}</p>` : ''}
      ${w.qty || w.kg || w.dog ? `<p class="muted" style="margin:4px 0">${[w.qty ? w.qty + ' pz' : '', w.kg ? w.kg + ' kg' : '', w.dog ? '🐕 ' + esc(w.dog) : ''].filter(Boolean).join(' · ')}</p>` : ''}
      ${w.stato || (w.tags || []).length ? `<p class="muted" style="margin:4px 0">${[w.stato ? STATI.find((x) => x[0] === w.stato)[1] : '', ...(w.tags || [])].filter(Boolean).join(' · ')}</p>` : ''}
      <p class="muted" id="wp-terr" style="margin:4px 0"></p>
      ${w.memo ? '<div id="wp-memo"></div>' : ''}
      <div class="coords-box"><span class="lbl">Coordinate GPS</span><b>${fmtCoord(w.lat, w.lon)}</b><small>${[w.alt != null ? `quota ${Math.round(w.alt)} m` : '', info].filter(Boolean).join(' · ')}</small><button type="button" class="cb-view" data-a="view">${ico('map', 16)} Visualizza</button></div>
      <div class="row gap wrap">
        <button class="btn primary grow" data-a="go">${ico('nav', 18)} Vai</button>
        <button class="btn ghost grow" data-a="share">${ico('share', 18)} Condividi</button>
      </div>
      <div class="row gap wrap">
        <button class="btn ghost grow" data-a="edit">${ico('edit', 18)} Modifica</button>
        <button class="btn ghost grow danger-t" data-a="del">${ico('trash', 18)} Elimina</button>
      </div></div>`,
  });
  if (navigator.onLine) getTerrain(w.lat, w.lon).then((t) => { const el = s.body.querySelector('#wp-terr'); if (el) el.textContent = terrainText(t); }).catch(() => {});
  if (w.memo) kvGet('memo:' + w.id).then((b) => {
    const el = s.body.querySelector('#wp-memo');
    if (b && el) el.innerHTML = `<audio controls style="width:100%" src="${URL.createObjectURL(b)}"></audio>`;
  });
  s.body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const a = b.dataset.a;
    if (a === 'view') {
      s.close();
      while (closeTopPage()) {}
      bus.emit('nav:tab', 'map');
      bus.emit('wp:goto', w.id);
    } else if (a === 'go') {
      s.close();
      while (closeTopPage()) {}
      bus.emit('wp:target', w.id);
    } else if (a === 'share') {
      s.close();
      shareWaypoint(w);
    } else if (a === 'edit') {
      s.close();
      openEditWaypoint(w);
    } else if (a === 'del') {
      if (await confirmBox(`Eliminare <b>${esc(w.title)}</b>?`, { ok: 'Elimina', danger: true })) {
        await removeWaypoint(w.id);
        s.close();
        toast('Eliminato');
      }
    }
  });
}
