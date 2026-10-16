import { kvGet, kvSet, getSettings, setSetting } from './store.js';
import { bus, esc, pad, uid, fmtCoord, fmtDate, fmtDist, haversine, bearing, cardinal } from './util.js';
import { openSheet, toast, confirmBox } from './ui.js';
import { WP_ICONS, wpIcon, ico } from './icons.js';
import { lastPos, getOnce } from './geo.js';
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
export async function mergeWaypoints(arr) {
  let n = 0;
  for (const w of arr) {
    if (list.some((x) => Math.abs(x.lat - w.lat) < 1e-6 && Math.abs(x.lon - w.lon) < 1e-6 && x.title === w.title)) continue;
    list.push(w);
    n++;
  }
  if (n) await persist();
  return n;
}

const nextTitle = (iconId) => `${wpIcon(iconId).label} ${pad((getSettings().wpCounter || 0) + 1)}`;

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
  const w = { id: uid(), title, desc: '', icon, lat: p.lat, lon: p.lon, alt: p.alt, acc: p.acc, ts: Date.now() };
  await addWaypoint(w);
  setSetting('wpCounter', (getSettings().wpCounter || 0) + 1);
  toast(`Salvato: ${title}`);
}

function formHTML({ wp, pos, title, icon }) {
  const grid = WP_ICONS.map(
    (i) => `<button type="button" class="icon-opt ${i.id === icon ? 'sel' : ''}" data-icon="${i.id}" title="${esc(i.label)}"><span class="ic">${i.svg}</span><small>${esc(i.label)}</small></button>`
  ).join('');
  const alt = pos && pos.alt != null ? `quota ${Math.round(pos.alt)} m` : '';
  const acc = pos && pos.acc != null ? `±${Math.round(pos.acc)} m` : '';
  return `<div class="wp-form" data-enter-scope>
    <div class="icon-grid">${grid}</div>
    <label class="field"><span>Titolo</span><input id="wp-title" type="text" value="${esc(title)}" maxlength="80" autocomplete="off"></label>
    <label class="field"><span>Descrizione</span><textarea id="wp-desc" rows="2" maxlength="400" placeholder="Note, zona, quantità…">${esc(wp ? wp.desc : '')}</textarea></label>
    <div class="coords-box"><span class="lbl">Coordinate GPS</span><b>${pos ? fmtCoord(pos.lat, pos.lon) : 'in attesa del GPS…'}</b><small>${[alt, acc].filter(Boolean).join(' · ')}</small></div>
    <button class="btn primary big" data-primary id="wp-save" ${pos ? '' : 'disabled'}>${ico('check', 20)} Salva waypoint</button>
  </div>`;
}

function wireForm(s, { wp, pos, onSave }) {
  let icon = wp ? wp.icon : 'fungo';
  let titleEdited = !!wp;
  const titleEl = s.body.querySelector('#wp-title');
  titleEl.addEventListener('input', () => (titleEdited = true));
  s.body.querySelector('.icon-grid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-icon]');
    if (!b) return;
    icon = b.dataset.icon;
    s.body.querySelectorAll('.icon-opt').forEach((x) => x.classList.toggle('sel', x === b));
    if (!titleEdited) titleEl.value = nextTitle(icon);
  });
  s.body.querySelector('#wp-save').addEventListener('click', async () => {
    const title = titleEl.value.trim() || nextTitle(icon);
    const desc = s.body.querySelector('#wp-desc').value.trim();
    await onSave({ title, desc, icon });
    s.close();
  });
}

export async function openNewWaypoint() {
  const pos = await currentFix();
  const title = nextTitle('fungo');
  const s = openSheet({ title: 'Nuovo waypoint', body: formHTML({ pos, title, icon: 'fungo' }), full: true });
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
    onSave: async ({ title, desc, icon }) => {
      if (!fix) return;
      const w = { id: uid(), title, desc, icon, lat: fix.lat, lon: fix.lon, alt: fix.alt, acc: fix.acc, ts: Date.now() };
      await addWaypoint(w);
      setSetting('wpCounter', (getSettings().wpCounter || 0) + 1);
      toast(`Salvato: ${title}`);
    },
  });
  setTimeout(() => s.body.querySelector('#wp-title')?.focus(), 250);
}

export function openEditWaypoint(w) {
  const s = openSheet({ title: 'Modifica waypoint', body: formHTML({ wp: w, pos: w, title: w.title, icon: w.icon }), full: true });
  wireForm(s, {
    wp: w,
    pos: w,
    onSave: async ({ title, desc, icon }) => {
      await updateWaypoint(w.id, { title, desc, icon });
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
      <div class="coords-box"><span class="lbl">Coordinate GPS</span><b>${fmtCoord(w.lat, w.lon)}</b><small>${[w.alt != null ? `quota ${Math.round(w.alt)} m` : '', info].filter(Boolean).join(' · ')}</small></div>
      <div class="row gap wrap">
        <button class="btn primary grow" data-a="go">${ico('nav', 18)} Vai</button>
        <button class="btn ghost grow" data-a="share">${ico('share', 18)} Condividi</button>
      </div>
      <div class="row gap wrap">
        <button class="btn ghost grow" data-a="edit">${ico('edit', 18)} Modifica</button>
        <button class="btn ghost grow danger-t" data-a="del">${ico('trash', 18)} Elimina</button>
      </div></div>`,
  });
  s.body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const a = b.dataset.a;
    if (a === 'go') {
      s.close();
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
