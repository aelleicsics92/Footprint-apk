import L from 'leaflet';
import { ITALY } from '../data/italy.js';
import { CITIES, LAKES, RIVERS, TOWNS, RIVERS2 } from '../data/italyfeat.js';
import { registerPlugin, Capacitor } from '@capacitor/core';
import { ico, wpIcon, orderedIcons } from '../lib/icons.js';
import { esc, bus, fmtDist, fmtDur, fmtDate, uid, haversine } from '../lib/util.js';
import { lastPos } from '../lib/geo.js';
import { openPage, openSheet, toast, confirmBox, leavePages, pushBack, closeTopSheet } from '../lib/ui.js';
import { getSettings, setSetting, apiKey, kvGet, kvSet, getDogs, setDogs } from '../lib/store.js';
import { openWeather } from './weather.js';
import { getWaypoints, openWaypoint, mergeWaypoints, bulkUpdate, bulkRemove } from '../lib/waypoints.js';
import { getTracks, loadTrackPoints, renameTrack, deleteTrack, saveTrack, startRecording, stopRecording, getRec } from '../lib/track.js';
import { toGPX, shareFile, safeName, parseGpsText, segments } from '../lib/gpsio.js';
import { listAreas, deleteArea, fmtMB, getQueue, cancelDownload } from '../lib/offline.js';
import { setWakeLock } from '../lib/wake.js';
import { askNotifPermission } from '../lib/notify.js';
import { openDiary } from './diary.js';
const wrappedAvailable = () => [11, 0].includes(new Date().getMonth());
import { openPrices } from './prices.js';
import { openRadar } from './extras.js';
import { perfBoots, clearPerf } from '../lib/perf.js';
import { importTexts } from '../lib/importer.js';

function openPerf() {
  openPage('Diagnostica avvio', (pg) => {
    const draw = () => {
      const b = perfBoots().slice().reverse();
      const txt = b.map((x) => `== ${new Date(x.at).toLocaleString('it-IT')} ==\n` + x.marks.map((m) => `${String(m[0]).padStart(6)} ms  ${m[1]}`).join('\n')).join('\n\n');
      pg.body.innerHTML = `<div style="padding:12px 14px"><div class="row gap" style="margin-bottom:10px"><button class="btn primary grow" id="pf-copy">Copia</button><button class="btn ghost grow" id="pf-clr">Azzera</button></div><p class="muted" style="font-size:.8rem;margin:0 0 8px">Tempi in ms dall'avvio dell'app. Dopo una riapertura lenta apri qui e mandami uno screenshot (tocca "Copia" per il testo).</p><pre style="white-space:pre-wrap;font-size:.7rem;line-height:1.35;margin:0">${esc(txt || 'Nessun dato ancora')}</pre></div>`;
      pg.body.querySelector('#pf-copy').onclick = async () => { try { await navigator.clipboard.writeText(txt); toast('Copiato'); } catch { toast('Copia non riuscita'); } };
      pg.body.querySelector('#pf-clr').onclick = () => { clearPerf(); draw(); };
    };
    draw();
  });
}

function openDog() {
  openPage('Profilo cane', (pg) => {
    let sel = 0;
    const draw = () => {
      const dogs = getDogs();
      if (sel >= dogs.length) sel = Math.max(0, dogs.length - 1);
      const d = dogs[sel];
      const f = (k, l, type = 'text') => `<div class="set-row"><div class="ti"><b>${l}</b></div><input type="${type}" data-k="${k}" value="${esc(d[k] || '')}" onfocus="this.select&&this.select()"></div>`;
      pg.body.innerHTML = `<div style="display:flex;gap:8px;overflow-x:auto;padding:12px 14px 4px;white-space:nowrap">${dogs.map((x, i) => `<button class="chip ${i === sel ? 'sel' : ''}" data-i="${i}">${esc(x.name || 'Senza nome')}</button>`).join('')}<button class="chip" id="dg-add">+ Aggiungi cane</button></div>
        ${d ? `<div class="list" style="margin-top:10px">${f('name', 'Nome')}${f('chip', 'Numero microchip')}${f('vax', 'Scadenza vaccini', 'date')}${f('par', 'Scadenza antiparassitario', 'date')}${f('vet', 'Veterinario di fiducia (telefono)', 'tel')}</div>
        <p class="muted" style="margin:10px 18px;font-size:.82rem">Ti avviso 30 giorni prima delle scadenze. Dati salvati solo sul telefono.</p>
        <div style="padding:0 16px;display:flex;flex-direction:column;gap:10px">${d.vet ? `<a class="btn primary big" href="tel:${esc(d.vet)}">Chiama il veterinario</a>` : ''}<button class="btn ghost big" id="dg-del" style="color:#c0392b">Elimina ${esc(d.name || 'questo cane')}</button></div>` : `<div class="empty">${ico('paw', 40)}<p>Nessun cane registrato.<br>Tocca "+ Aggiungi cane".</p></div>`}`;
      pg.body.querySelectorAll('[data-i]').forEach((b) => (b.onclick = () => { sel = Number(b.dataset.i); draw(); }));
      pg.body.querySelector('#dg-add').onclick = () => { const l = getDogs(); l.push({ id: uid(), name: '', chip: '', vax: '', par: '', vet: '' }); setDogs(l); sel = l.length - 1; draw(); setTimeout(() => { const i = pg.body.querySelector('[data-k="name"]'); if (i) i.focus(); }, 60); };
      const del = pg.body.querySelector('#dg-del');
      if (del) del.onclick = async () => { if (await confirmBox(`Eliminare il profilo di <b>${esc(d.name || 'questo cane')}</b>?`, { ok: 'Elimina', danger: true })) { const l = getDogs(); l.splice(sel, 1); setDogs(l); draw(); } };
      const inputs = [...pg.body.querySelectorAll('[data-k]')];
      inputs.forEach((i, n) => {
        i.addEventListener('change', () => { const l = getDogs(); l[sel][i.dataset.k] = i.value.trim(); setDogs(l); toast('Salvato', 1200); if (i.dataset.k === 'name') { const t = pg.body.querySelector(`[data-i="${sel}"]`); if (t) t.textContent = i.value.trim() || 'Senza nome'; } });
        i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); i.dispatchEvent(new Event('change')); const nx = inputs[n + 1]; nx ? nx.focus() : i.blur(); } });
      });
    };
    draw();
  });
}


export function mountMore(el) {
  const gpsHub = () =>
    openPage('Strumenti GPS e Garmin', (pg) => {
      const sub = [
        ['nav', 'Garmin GPSMAP', 'Importa ed esporta waypoint e tracce', openGarmin],
        ['upload', 'Importa file GPS', 'GPX, KML, GeoJSON, TCX, LOC (Garmin e altri)', importFiles],
        ['share', 'Esporta', 'Tutto o per periodo, GPX, KML, GeoJSON, TCX, LOC', exportAll],
      ];
      pg.body.innerHTML = `<div class="list" style="margin-top:12px">${sub.map(([i, t, d], n) => `<button class="item" data-s="${n}"><span class="lead">${ico(i, 22)}</span><div class="ti"><b>${t}</b><small>${d}</small></div></button>`).join('')}</div>`;
      pg.body.querySelectorAll('[data-s]').forEach((b) => (b.onclick = () => sub[Number(b.dataset.s)][3]()));
    });
  const sections = [
    ['ATTIVITÀ E RACCOLTA', [
      ['mushroom', 'Previsione raccolta', 'Indice funghi e tartufi, pioggia', () => bus.emit('nav:tab', 'fungi')],
      ['book', 'Diario raccolti', 'Statistiche, stagioni e record', () => openDiary()],
      ['sparkle', 'Footprint Wrapped', wrappedAvailable() ? 'Il riepilogo della tua stagione è pronto' : 'Riepilogo della stagione a storie', () => import('./wrapped.js').then((m) => m.openWrapped(new Date().getFullYear()))],
      ['euro', 'Prezzi tartufo', 'Quotazioni aggiornate al cavatore', openPrices],
      ['paw', 'Profilo cane', 'Microchip, vaccini, antiparassitario', openDog],
      ['gauge', 'Diagnostica avvio', 'Tempi di avvio e riapertura (temporanea)', openPerf],
    ]],
    ['I MIEI DATI E MAPPE', [
      ['pinplus', 'I miei waypoint', 'Punti e fungaie salvate', openWaypointList],
      ['route', 'Le mie tracce', 'Percorsi registrati', openTracks],
      ['download', 'Mappe offline', 'Aree scaricate sulla memoria', openOffline],
    ]],
    ['STRUMENTI E SICUREZZA', [
      ['cloud', 'Meteo', 'Previsioni locali dettagliate', () => openWeather()],
      ['compass', 'Radar compagni', 'Direzione e distanza da chi è con te', () => openRadar()],
    ]],
    ['SINCRO, IMPORT E IMPOSTAZIONI', [
      ['nav', 'Strumenti GPS e Garmin', 'Garmin GPSMAP, importa, esporta', gpsHub],
      ['sliders', 'Impostazioni', 'Traccia, emergenza SOS, AI, bussola', openSettings],
      ['info', 'Info su Footprint', 'Versione e crediti', openAbout],
    ]],
  ];
  const items = sections.flatMap((x) => x[1]);
  let cnt = 0;
  el.innerHTML = `<div class="hero"><h1>Footprint</h1><p>Traccia il cammino, rispetta il bosco.</p></div>
    ${sections
      .map(([h, list]) => `<div class="sec-h">${h}</div><div class="list">${list
        .map(([i, t, s]) => `<button class="item" data-n="${cnt++}"><span class="lead">${ico(i, 22)}</span><div class="ti"><b>${t}</b><small>${s}</small></div><span class="chev">${ico('back', 18).replace('<svg ', '<svg style="transform:rotate(180deg)" ')}</span></button>`)
        .join('')}</div>`)
      .join('')}`;
  el.querySelectorAll('[data-n]').forEach((b) => (b.onclick = () => items[Number(b.dataset.n)][3]()));
  window.addEventListener('fp:dogs', () => bus.emit('settings:changed', 'dogs'));
  const refreshBadge = () => {
    const s = getSettings(), now = Date.now();
    const due = getDogs().some((g) => [g.vax, g.par].some((d) => d && new Date(d + 'T23:59:59').getTime() - now < 30 * 86400000));
    const idx = items.findIndex((i) => i[1] === 'Profilo cane');
    const b = el.querySelector(`[data-n="${idx}"] .lead`);
    if (b) { b.querySelector('.dot-b')?.remove(); if (due) b.insertAdjacentHTML('beforeend', '<i class="dot-b"></i>'); }
  };
  refreshBadge();
  bus.on('settings:changed', refreshBadge);
  bus.on('nav:tab', (t) => t === 'more' && refreshBadge());
}

// ---------- tracce ----------
function openTracks() {
  let tSel = false; const tIds = new Set(); let popB = null;
  openPage('Le mie tracce', (pg) => {
    const setSel = (on) => {
      tSel = on; if (!on) tIds.clear();
      if (on && !popB) popB = pushBack(() => { popB = null; tSel = false; tIds.clear(); draw(); });
      if (!on && popB) { popB(); popB = null; }
    };
    const draw = () => {
      const t = getTracks();
      for (const id of [...tIds]) if (!t.find((x) => x.id === id)) tIds.delete(id);
      pg.body.innerHTML = t.length
        ? `<div class="list">${t
            .map(
              (x) =>
                `<button class="item" data-id="${x.id}">${tSel ? `<span style="flex:none;width:24px;height:24px;margin:0 12px 0 2px;border-radius:7px;border:2px solid #2e7a4d;display:inline-flex;align-items:center;justify-content:center;background:${tIds.has(x.id) ? '#2e7a4d' : 'transparent'};color:#fff">${tIds.has(x.id) ? ico('check', 16) : ''}</span>` : ''}<span class="lead trk-th" data-th="${x.id}" style="width:54px;height:54px;border-radius:12px;background:#f6f2e6;display:flex;align-items:center;justify-content:center;overflow:hidden">${ico('route', 22)}</span><div class="ti"><b>${esc(x.name)}</b><small>${fmtDate(x.start)} · ${fmtDist(x.dist)} · ${fmtDur(x.dur)} · +${Math.round(x.up)} m</small></div></button>`
            )
            .join('')}</div>`
        : `<div class="empty">${ico('route', 40)}<p>Nessuna traccia salvata.<br>Attiva la registrazione in Impostazioni oppure importa un file GPX.</p></div>`;
      pg.body.querySelectorAll('[data-id]').forEach((b) => {
        let lp = null, fired = false;
        const id = b.dataset.id;
        b.onclick = () => {
          if (fired) { fired = false; return; }
          if (tSel) { tIds.has(id) ? tIds.delete(id) : tIds.add(id); draw(); return; }
          trackSheet(t.find((x) => x.id === id), pg);
        };
        b.addEventListener('touchstart', () => { fired = false; lp = setTimeout(() => { fired = true; try { navigator.vibrate && navigator.vibrate(30); } catch {} if (!tSel) setSel(true); tIds.add(id); draw(); }, 500); }, { passive: true });
        ['touchend', 'touchmove', 'touchcancel'].forEach((ev) => b.addEventListener(ev, () => clearTimeout(lp), { passive: true }));
        b.oncontextmenu = (e) => { e.preventDefault(); };
      });
      if (tSel) {
        pg.body.insertAdjacentHTML('beforeend', '<div style="height:calc(var(--sab,0px) + 150px)"></div>');
        const bar = document.createElement('div');
        bar.style.cssText = 'position:fixed;left:10px;right:10px;bottom:calc(var(--sab,0px) + 28px);z-index:30;display:flex;align-items:center;gap:8px;padding:12px 18px 12px 22px;background:#12372a;color:#fff;border-radius:22px;box-shadow:0 6px 22px rgba(0,0,0,.35)';
        bar.innerHTML = `<b style="flex:1;font-size:.95rem;white-space:nowrap">${tIds.size} ${tIds.size === 1 ? 'selezionata' : 'selezionate'}</b>${[['tb-all', 'check', 'Tutte'], ['tb-none', 'close', 'Nessuna'], ['tb-del', 'trash', 'Elimina']].map(([id, ic, l]) => `<button id="${id}" style="all:unset;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:1px;min-width:62px;padding:4px 6px;font-size:.66rem;color:${id === 'tb-del' ? '#ff8a7a' : '#fff'}">${ico(ic, 22)}<span>${l}</span></button>`).join('')}`;
        pg.body.appendChild(bar);
        bar.querySelector('#tb-all').onclick = () => { t.forEach((x) => tIds.add(x.id)); draw(); };
        bar.querySelector('#tb-none').onclick = () => { setSel(false); draw(); };
        bar.querySelector('#tb-del').onclick = async () => {
          if (!tIds.size) return toast('Nessuna traccia selezionata');
          if (await confirmBox(`Eliminare <b>${tIds.size}</b> tracce? Non si può annullare.`, { ok: 'Elimina', danger: true })) { const ids = [...tIds]; setSel(false); for (const id of ids) await deleteTrack(id); toast('Eliminate'); }
        };
      }
      thumbs(pg, t);
    };
    draw();
    const off = bus.on('tracks:changed', draw);
    pg.onClose = () => { off(); if (popB) popB(); };
    setTimeout(() => {
      const eb = document.querySelector('#tr-all-del');
      if (eb) eb.onclick = async () => {
        const all = getTracks();
        if (!all.length) return toast('Nessuna traccia da eliminare');
        if (await confirmBox(`Eliminare <b>tutte le ${all.length}</b> tracce? Non si può annullare.`, { ok: 'Elimina tutto', danger: true })) { setSel(false); for (const x of all.slice()) await deleteTrack(x.id); toast('Tracce eliminate'); }
      };
    }, 50);
  }, { actions: `<button class="chip" id="tr-all-del" style="color:#ff8a7a">Elimina tutto</button>` });
}

// miniature: tracciato semplificato in verde scuro su crema, calcolate una volta e salvate
function thumbSvg(pts) {
  const segs = [];
  for (const p of pts) { if (!segs.length || p[4] === 1) segs.push([]); segs[segs.length - 1].push(p); }
  const all = pts, la = all.map((p) => p[0]), lo = all.map((p) => p[1]);
  const mnLa = Math.min(...la), mxLa = Math.max(...la), mnLo = Math.min(...lo), mxLo = Math.max(...lo);
  const k = Math.cos(((mnLa + mxLa) / 2) * Math.PI / 180);
  const w = Math.max((mxLo - mnLo) * k, 1e-6), h = Math.max(mxLa - mnLa, 1e-6), sc = 40 / Math.max(w, h);
  const ox = (48 - w * sc) / 2, oy = (48 - h * sc) / 2;
  const step = Math.max(1, Math.ceil(all.length / 70));
  const d = segs.map((sg) => sg.filter((_, i) => i % step === 0 || i === sg.length - 1).map((p, i) => `${i ? 'L' : 'M'}${(ox + (p[1] - mnLo) * k * sc).toFixed(1)},${(oy + (mxLa - p[0]) * sc).toFixed(1)}`).join('')).join('');
  return `<svg viewBox="0 0 48 48" width="54" height="54"><path d="${d}" fill="none" stroke="#12372a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
async function thumbs(pg, list) {
  for (const x of list) {
    const el = pg.body.querySelector(`[data-th="${x.id}"]`);
    if (!el) continue;
    try {
      let sv = await kvGet('thumb:' + x.id);
      if (!sv) {
        const pts = await loadTrackPoints(x.id);
        if (pts.length < 2) continue;
        sv = thumbSvg(pts);
        kvSet('thumb:' + x.id, sv);
      }
      const e2 = pg.body.querySelector(`[data-th="${x.id}"]`);
      if (e2) e2.innerHTML = sv;
    } catch {}
    await new Promise((r) => setTimeout(r, 0));
  }
}
function renameSheet(t) {
  if (!t) return;
  const s = openSheet({ title: 'Modifica nome', body: `<label class="field"><span>Nome della traccia</span><input id="rn-n" type="text" maxlength="80" value="${esc(t.name)}" onfocus="this.select()"></label><button class="btn primary big" id="rn-s">${ico('check', 18)} Salva nome</button>` });
  const go = async () => { await renameTrack(t.id, s.body.querySelector('#rn-n').value.trim() || t.name); s.close(); toast('Salvato'); };
  s.body.querySelector('#rn-s').onclick = go;
  s.body.querySelector('#rn-n').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } };
}

function trackSheet(t, pg) {
  const s = openSheet({
    title: t.name,
    body: `<div data-enter-scope>
      <div class="stat-row"><div><b>${fmtDist(t.dist)}</b><span>Distanza</span></div><div><b>${fmtDur(t.dur)}</b><span>Durata</span></div><div><b>+${Math.round(t.up)} m</b><span>Salita</span></div><div><b>-${Math.round(t.down)} m</b><span>Discesa</span></div></div>
      <div id="t-prof"></div>
      <p class="muted" style="margin:4px 0 8px;font-size:.88rem">${fmtDate(t.start)}${t.maxAlt != null ? ` · quota ${Math.round(t.minAlt)}–${Math.round(t.maxAlt)} m` : ''}</p>
      <div class="row gap wrap"><button class="btn primary grow" id="t-show">${ico('map', 18)} Mostra sulla mappa</button><button class="btn ghost grow" id="t-share">${ico('share', 18)} Condividi GPX</button></div>
      <button class="btn big" id="t-follow" style="width:100%;margin-top:10px;background:#eef6ee;color:#12372a;border:2px solid #2e7d4f;justify-content:flex-start;gap:12px;padding:14px 16px;text-align:left"><span style="color:#2e7d4f;display:inline-flex">${ico('route', 26)}</span><span style="display:flex;flex-direction:column;align-items:flex-start;line-height:1.25"><b>Segui con avviso fuori traccia</b><small style="font-weight:500;opacity:.8">Ti avviso se ti allontani dal percorso</small></span></button>
      <label class="field"><span>Rinomina</span><input id="t-name" type="text" value="${esc(t.name)}" maxlength="80"></label>
      <div class="row gap"><button class="btn ghost grow danger-t" id="t-del">${ico('trash', 18)} Elimina</button><button class="btn primary grow" data-primary id="t-save">${ico('check', 18)} Salva nome</button></div></div>`,
  });
  const q = (x) => s.body.querySelector(x);
  loadTrackPoints(t.id).then((pts) => {
    const al = pts.map((x) => x[2]).filter((v) => v != null && !isNaN(v));
    const el = q('#t-prof');
    if (!el || al.length < 5) return;
    const mn = Math.min(...al), mx = Math.max(...al), W = 300, H = 70, rg = Math.max(mx - mn, 10);
    const path = al.map((v, i) => `${i ? 'L' : 'M'}${(i / (al.length - 1) * W).toFixed(1)},${(H - ((v - mn) / rg) * (H - 8) - 4).toFixed(1)}`).join('');
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:80px;background:var(--paper2);border-radius:10px"><path d="${path}L${W},${H}L0,${H}Z" fill="rgba(63,122,74,.25)"/><path d="${path}" fill="none" stroke="#3f7a4a" stroke-width="2"/></svg><div class="row" style="justify-content:space-between;font-size:.75rem;color:var(--muted)"><span>Profilo altimetrico</span><span>${Math.round(mn)}–${Math.round(mx)} m</span></div>`;
  });
  q('#t-show').onclick = () => {
    s.close();
    leavePages();
    bus.emit('track:show', { id: t.id, name: t.name });
  };
  q('#t-follow').onclick = () => {
    s.close();
    leavePages();
    bus.emit('track:follow', { id: t.id, name: t.name });
  };
  q('#t-share').onclick = async () => {
    const pts = await loadTrackPoints(t.id);
    s.close();
    try {
      await shareFile(`${safeName(t.name)}.gpx`, toGPX({ tracks: [{ ...t, points: pts }], name: t.name }), { title: t.name });
    } catch {}
  };
  q('#t-save').onclick = async () => {
    await renameTrack(t.id, q('#t-name').value.trim() || t.name);
    s.close();
    toast('Salvato');
  };
  q('#t-del').onclick = async () => {
    if (await confirmBox(`Eliminare la traccia <b>${esc(t.name)}</b>?`, { ok: 'Elimina', danger: true })) {
      await deleteTrack(t.id);
      s.close();
    }
  };
}

// ---------- waypoint ----------
function openWaypointList() {
  openPage(
    'I miei waypoint',
    (pg) => {
      let q = '', cat = 'all', sortD = false, near = false, selMode = false, imp = false, shown = [], limit = 300;
      const sel = new Set();
      const CATS = { porcini: ['porcino', 'regius', 'pinaiolo', 'pinarolo'], tartufi: ['scorzone', 'uncinato', 'bianco', 'bianchetto', 'nero'], utility: ['parcheggio', 'acqua', 'pericolo', 'panorama', 'orma'] };
      const isImp = (w) => !!w.imp || w.dog === undefined;
      const inCat = (w) => (imp && !isImp(w)) ? false : cat === 'all' || (cat === 'altri' ? ![...CATS.porcini, ...CATS.tartufi, ...CATS.utility].includes(w.icon) : CATS[cat].includes(w.icon));
      const draw = () => {
        const s = q.trim().toLowerCase();
        pg.body.querySelectorAll('[data-cat]').forEach((c) => c.classList.toggle('sel', c.dataset.cat === cat));
        const list = getWaypoints().filter(inCat).filter((w) => !s || w.title.toLowerCase().includes(s) || (w.desc || '').toLowerCase().includes(s) || wpIcon(w.icon).label.toLowerCase().includes(s) || (w.tags || []).some((t) => t.toLowerCase().includes(s)));
        const me = lastPos();
        const dm = new Map();
        if (me) for (const w of list) dm.set(w.id, haversine(me, w));
        if (near && me) { for (let i = list.length - 1; i >= 0; i--) if (dm.get(list[i].id) > 2000) list.splice(i, 1); }
        list.sort(sortD && me ? (a, b) => dm.get(a.id) - dm.get(b.id) : (a, b) => b.ts - a.ts);
        pg.body.querySelectorAll('[data-sort]').forEach((c) => c.classList.toggle('sel', (c.dataset.sort === 'near' ? near : c.dataset.sort === 'dist' ? sortD : !sortD && !near)));
        shown = list;
        const bar = pg.body.querySelector('#wl-bar');
        bar.style.display = selMode ? 'flex' : 'none';
        bar.querySelector('#sb-n').textContent = sel.size + (sel.size === 1 ? ' selezionato' : ' selezionati');
        pg.body.querySelector('#wl').style.paddingBottom = selMode ? 'calc(var(--sab,0px) + 140px)' : '';
        bus.emit('wl:draw');
        bus.selActive = selMode;
        const sb = document.querySelector('#wl-sel'); if (sb) sb.classList.toggle('sel', selMode);
        pg.body.querySelector('#wl-imp').classList.toggle('sel', imp);
        pg.body.querySelector('#wl').innerHTML = list.length
          ? list.slice(0, limit)
              .map((w) => `<button class="item" data-id="${w.id}">${selMode ? `<span style="flex:none;width:24px;height:24px;margin:0 12px 0 2px;border-radius:7px;border:2px solid #2e7a4d;display:inline-flex;align-items:center;justify-content:center;background:${sel.has(w.id) ? '#2e7a4d' : 'transparent'};color:#fff">${sel.has(w.id) ? ico('check', 16) : ''}</span>` : ''}<span class="lead"><span class="ic">${wpIcon(w.icon).svg}</span></span><div class="ti"><b>${esc(w.title)}</b><small>${fmtDate(w.ts)}${dm.has(w.id) ? ' · ' + fmtDist(dm.get(w.id)) : ''}${w.desc ? ' · ' + esc(w.desc) : ''}</small></div></button>`)
              .join('') + (list.length > limit ? `<button class="chip" id="wl-more" style="margin:12px auto;display:block">Mostra altri (${list.length - limit})</button>` : '')
          : `<div class="empty">${ico('pinplus', 40)}<p>Nessun waypoint.<br>Usa il pulsante sulla mappa per salvarne uno.</p></div>`;
        const mo = pg.body.querySelector('#wl-more');
        if (mo) mo.onclick = () => { limit += 300; draw(); };
        pg.body.querySelectorAll('[data-id]').forEach((b) => {
          let t = 0, lp = false;
          const clr = () => clearTimeout(t);
          b.addEventListener('touchstart', () => { lp = false; t = setTimeout(() => { lp = true; selMode = true; sel.add(b.dataset.id); if (navigator.vibrate) navigator.vibrate(30); draw(); }, 500); }, { passive: true });
          b.addEventListener('touchend', clr); b.addEventListener('touchmove', clr); b.addEventListener('touchcancel', clr);
          b.addEventListener('contextmenu', (e) => e.preventDefault());
          b.addEventListener('click', (e) => { if (lp) { e.stopImmediatePropagation(); e.preventDefault(); lp = false; } }, true);
        });
        pg.body.querySelectorAll('[data-id]').forEach((b) => (b.onclick = () => {
          if (selMode) { sel.has(b.dataset.id) ? sel.delete(b.dataset.id) : sel.add(b.dataset.id); draw(); return; }
          openWaypoint(getWaypoints().find((w) => w.id === b.dataset.id));
        }));
      };
      pg.body.innerHTML = `<div style="margin:12px 14px 0"><input id="wq" type="search" placeholder="Cerca per nome, specie (es. Porcino) o habitat…"></div>
        <div class="chips" style="padding:10px 14px 0;overflow-x:auto;flex-wrap:nowrap;white-space:nowrap">${[['all', 'Tutti'], ['porcini', 'Porcini'], ['tartufi', 'Tartufi'], ['utility', 'Utility/Auto'], ['altri', 'Altri funghi']].map(([k, l]) => `<button class="chip ${k === 'all' ? 'sel' : ''}" data-cat="${k}">${l}</button>`).join('')}</div><div class="chips" style="padding:8px 14px 0;overflow-x:auto;flex-wrap:nowrap;white-space:nowrap">${[['date', 'Recenti'], ['dist', 'Più vicini'], ['near', 'Entro 2 km']].map(([k, l]) => `<button class="chip ${k === 'date' ? 'sel' : ''}" data-sort="${k}">${l}</button>`).join('')}<button class="chip" id="wl-imp">Importati</button></div><div class="list" id="wl"></div>
        <div id="wl-bar" style="display:none;position:fixed;left:10px;right:10px;bottom:calc(var(--sab,0px) + 28px);z-index:30;align-items:center;gap:2px;padding:8px 8px 8px 16px;background:#12372a;color:#fff;border-radius:20px;box-shadow:0 6px 22px rgba(0,0,0,.35)"><b id="sb-n" style="flex:1;font-size:.95rem;white-space:nowrap"></b>${[['sb-all', 'check', 'Tutti'], ['sb-none', 'close', 'Nessuno'], ['sb-type', 'edit', 'Tipo'], ['sb-del', 'trash', 'Elimina']].map(([id, ic, l]) => `<button id="${id}" aria-label="${l}" style="all:unset;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:1px;min-width:50px;padding:4px 2px;font-size:.62rem;color:${id === 'sb-del' ? '#ff8a7a' : '#fff'}">${ico(ic, 22)}<span>${l}</span></button>`).join('')}</div>`;
      const bar = pg.body.querySelector('#wl-bar');
      pg.body.querySelector('#wl-imp').onclick = () => { imp = !imp; limit = 300; draw(); };
      bar.querySelector('#sb-all').onclick = () => { shown.forEach((w) => sel.add(w.id)); draw(); };
      bar.querySelector('#sb-none').onclick = () => { sel.clear(); draw(); };
      bar.querySelector('#sb-del').onclick = async () => {
        if (!sel.size) return toast('Nessun waypoint selezionato');
        if (await confirmBox(`Eliminare <b>${sel.size}</b> waypoint? Non si può annullare.`, { ok: 'Elimina', danger: true })) { const n = sel.size; await bulkRemove([...sel]); sel.clear(); selMode = false; toast(n + ' eliminati'); draw(); }
      };
      bar.querySelector('#sb-type').onclick = () => {
        if (!sel.size) return toast('Nessun waypoint selezionato');
        const sh = openSheet({ title: `Cambia tipo a ${sel.size} waypoint`, body: `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">${orderedIcons(getSettings().wpOrder).map((i) => `<button class="chip" data-ic="${i.id}" style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 2px"><span style="width:34px;height:34px">${i.svg}</span><small>${esc(i.label)}</small></button>`).join('')}</div>` });
        sh.body.querySelectorAll('[data-ic]').forEach((b) => (b.onclick = async () => { const id = b.dataset.ic; await bulkUpdate([...sel], (w) => { w.icon = id; }); sh.close(); sel.clear(); selMode = false; toast('Tipo aggiornato'); draw(); }));
      };
      pg.body.querySelectorAll('[data-sort]').forEach((c) => (c.onclick = () => {
        if (c.dataset.sort === 'near') { near = !near; if (near) sortD = true; }
        else if (c.dataset.sort === 'dist') { sortD = true; }
        else { sortD = false; near = false; }
        if (!lastPos() && (sortD || near)) toast('Attendo il GPS per le distanze');
        draw();
      }));
      pg.body.querySelectorAll('[data-cat]').forEach((c) => (c.onclick = () => { cat = c.dataset.cat; draw(); }));
      pg.body.querySelector('#wq').oninput = (e) => ((q = e.target.value), draw());
      draw();
      let popBack = null;
      const exitSel = () => { selMode = false; sel.clear(); draw(); };
      const selBack = () => { popBack = null; if (!selMode) return; if (closeTopSheet()) { popBack = pushBack(selBack); return; } exitSel(); };
      const syncBack = () => { if (selMode && !popBack) popBack = pushBack(selBack); else if (!selMode && popBack) { popBack(); popBack = null; } };
      const off0 = bus.on('wl:draw', syncBack);
      const off = bus.on('wp:changed', draw);
      const off3 = bus.on('wl:exit', exitSel);
      const off2 = bus.on('wl:sel', () => { selMode = !selMode; if (!selMode) sel.clear(); draw(); });
      pg.onClose = () => { off(); off2(); off0(); off3(); bus.selActive = false; if (popBack) popBack(); };
    },
    {
      actions: `<button class="chip" id="wl-sel">Seleziona</button><button class="icon-btn" id="wl-map" aria-label="Vedi sulla mappa">${ico('map', 22)}</button><button class="icon-btn" id="wl-share" aria-label="Esporta waypoint">${ico('share', 22)}</button>`,
    }
  );
  setTimeout(() => {
    const sbtn = document.querySelector('#wl-sel');
    const hb = sbtn && sbtn.closest('.page-head') && sbtn.closest('.page-head').querySelector('[data-back]');
    if (hb) hb.addEventListener('click', (e) => { if (bus.selActive) { e.stopImmediatePropagation(); bus.emit('wl:exit'); } }, true);
    if (sbtn) sbtn.onclick = () => { bus.emit('wl:sel'); };
    const mb = document.querySelector('#wl-map');
    if (mb) mb.onclick = () => {
      const w = getWaypoints().filter((x) => x.lat != null);
      if (!w.length) return toast('Nessun waypoint da mostrare');
      setSetting('showWaypoints', true);
      leavePages();
      bus.emit('nav:tab', 'map');
      bus.emit('settings:changed', 'showWaypoints');
      const la = w.map((x) => x.lat), lo = w.map((x) => x.lon);
      bus.emit('map:fit', { north: Math.max(...la) + 0.002, south: Math.min(...la) - 0.002, east: Math.max(...lo) + 0.002, west: Math.min(...lo) - 0.002 });
    };
    const b = document.querySelector('#wl-share');
    if (b)
      b.onclick = async () => {
        const w = getWaypoints();
        if (!w.length) return toast('Nessun waypoint da esportare');
        try {
          await shareFile('footprint-waypoint.gpx', toGPX({ waypoints: w, name: 'Footprint waypoint' }), { title: 'Waypoint Footprint' });
        } catch {}
      };
  }, 50);
}

// ---------- mappe offline ----------
let covMap = null, covRects = {}, covHl = null, covView = null; const covSel = new Set();
function covHighlight(ids, fit = true) {
  const set = ids instanceof Set ? ids : new Set(ids ? [ids] : []);
  for (const [k, r] of Object.entries(covRects)) r.setStyle(set.has(k) ? { color: '#0b4d2a', weight: 3, fillColor: '#1f8a4c', fillOpacity: 0.6 } : { color: '#12372a', weight: 1.2, fillColor: '#3f7a4a', fillOpacity: set.size ? 0.3 : 0.7 });
  for (const k of set) if (covRects[k]) covRects[k].bringToFront();
  if (fit && set.size === 1) { const r = covRects[[...set][0]]; if (r) try { covMap.fitBounds(r.getBounds(), { padding: [50, 50], maxZoom: 11 }); } catch {} }
}
function drawCoverage(el, areas) {
  if (!el) return;
  covRects = {};
  covMap = L.map(el, { attributionControl: false, zoomSnap: 0.25, minZoom: 4, maxZoom: 12, zoomControl: false });
  const ll = ITALY.flatMap((poly) => poly.map((ring) => { const o = []; for (let i = 0; i < ring.length; i += 2) o.push([ring[i + 1], ring[i]]); return o; }));
  const it = L.polygon(ll, { color: '#a89f86', weight: 1.2, fillColor: '#f6f2e6', fillOpacity: 1, interactive: false }).addTo(covMap);
  if (covView) covMap.setView(covView.c, covView.z, { animate: false }); else covMap.fitBounds(it.getBounds(), { padding: [6, 6] });
  const rivLbl = [];
  for (const [nm, pts] of [...RIVERS, ...RIVERS2]) {
    L.polyline(pts, { color: '#7fb0d6', weight: 1.6, opacity: 0.9, interactive: false }).addTo(covMap);
    const mid = pts[Math.floor(pts.length / 2)];
    const mk = L.circleMarker(mid, { radius: 1, opacity: 0, fillOpacity: 0, interactive: false }).addTo(covMap);
    rivLbl.push([mk, () => mk.bindTooltip(nm, { permanent: true, direction: 'top', offset: [0, -2], className: 'it-lbl it-riv' })]);
  }
  const towns = [];
  for (const [nm, la, lo] of TOWNS) {
    const mk = L.circleMarker([la, lo], { radius: 1.8, color: '#fff', weight: 0.8, fillColor: '#6b6a64', fillOpacity: 1, interactive: false }).addTo(covMap);
    towns.push([mk, () => mk.bindTooltip(nm, { permanent: true, direction: 'right', offset: [2, 0], className: 'it-lbl it-town' })]);
  }
  for (const [nm, la, lo, a, b, rot] of LAKES) {
    const r = (rot * Math.PI) / 180, pts = [];
    for (let k = 0; k < 24; k++) { const t = (k / 24) * 2 * Math.PI, y = a * Math.cos(t), x = b * Math.sin(t); pts.push([la + y * Math.cos(r) - x * Math.sin(r), lo + y * Math.sin(r) + x * Math.cos(r)]); }
    L.polygon(pts, { color: '#5f9ccb', weight: 0.8, fillColor: '#a9cde8', fillOpacity: 1 }).bindTooltip(nm, { sticky: true }).addTo(covMap);
  }
  const MAJOR = ['Torino', 'Milano', 'Venezia', 'Bologna', 'Firenze', 'Roma', 'Napoli', 'Bari', 'Palermo', 'Cagliari'];
  const minors = [];
  for (const [nm, la, lo] of CITIES) {
    const mk = L.circleMarker([la, lo], { radius: 2.6, color: '#fff', weight: 1, fillColor: '#3b3a36', fillOpacity: 1, interactive: false }).addTo(covMap);
    const lab = () => mk.bindTooltip(nm, { permanent: true, direction: 'right', offset: [3, 0], className: 'it-lbl' });
    if (MAJOR.includes(nm)) lab(); else minors.push([mk, lab]);
  }
  const upd = () => {
    const z = covMap.getZoom();
    const sw = (arr, on) => { for (const [mk, lab] of arr) { if (on) { if (!mk.getTooltip()) lab(); } else mk.unbindTooltip(); } };
    sw(minors, z >= 6.5); sw(towns, z >= 7.5); sw(rivLbl, z >= 7);
    for (const [mk] of towns) mk.setStyle({ opacity: z >= 7.5 ? 1 : 0, fillOpacity: z >= 7.5 ? 1 : 0 });
  };
  covMap.on('zoomend', upd);
  for (const a of areas) {
    const b = a.bounds, mn = 0.12;
    let n = b.north, s = b.south, e = b.east, w = b.west;
    if (n - s < mn) { const c = (n + s) / 2; n = c + mn / 2; s = c - mn / 2; }
    if (e - w < mn) { const c = (e + w) / 2; e = c + mn / 2; w = c - mn / 2; }
    covRects[a.id] = L.rectangle([[s, w], [n, e]], { color: '#12372a', weight: 1.2, fillColor: '#3f7a4a', fillOpacity: 0.7 }).bindTooltip(esc(a.name), { sticky: true }).addTo(covMap);
  }
  setTimeout(() => { if (covMap) { covMap.invalidateSize(); if (covView) covMap.setView(covView.c, covView.z, { animate: false }); else if (covHl && covRects[covHl]) covHighlight(covHl); else covMap.fitBounds(it.getBounds(), { padding: [4, 4] }); if (covSel.size) covHighlight(covSel, false); upd(); } }, 320);
}
function openOffline() {
  let oSel = false; const oIds = covSel; let popB = null;
  openPage('Mappe offline', async (pg) => {
    const draw = async () => {
      const areas = await listAreas();
      for (const id of [...oIds]) if (!areas.find((a) => a.id === id)) oIds.delete(id);
      let usage = '';
      try {
        const e = await navigator.storage.estimate();
        usage = `Spazio usato dall'app: ${fmtMB(e.usage || 0)}`;
      } catch {}
      const qq = getQueue();
      const qHTML = qq.length ? `<div class="sec-title" style="font-size:1.05rem">Coda download</div><div class="list">${qq.map((j) => { const pc = Math.round(((j.done || 0) / (j.total || 1)) * 100); return `<div class="item" style="cursor:default;flex-wrap:wrap"><span class="lead">${ico('download', 22)}</span><div class="ti"><b>${esc(j.name)}</b><small>${j.status === 'running' ? `Scarico… ${pc}% · ${fmtMB(j.bytes || 0)}` : 'In attesa'}</small></div><button class="icon-btn" data-cancel="${j.id}" aria-label="Annulla" style="color:var(--danger)">${ico('close', 20)}</button>${j.status === 'running' ? `<div class="progress" style="flex-basis:100%;margin-top:6px"><i style="width:${pc}%"></i></div>` : ''}</div>`; }).join('')}</div>` : '';
      if (covMap) { try { covView = { c: covMap.getCenter(), z: covMap.getZoom() }; covMap.remove(); } catch {} covMap = null; }
      pg.body.innerHTML = `<div id="cov-it" style="height:360px;margin:14px 14px 4px;border-radius:16px;overflow:hidden;background:#e9e4d4"></div><small class="muted" style="display:block;margin:0 16px 8px">${areas.length ? `Verde = zone già scaricate (${areas.length}). Tocca un'area per il nome.` : 'Qui compariranno le zone che scarichi.'}</small><div class="infobox" style="margin:14px">Per scaricare una zona: apri la mappa, inquadra l'area e tocca ${ico('download', 16)}: finisce in coda e scarica in background, puoi aggiungerne altre. ${usage}</div>${qHTML}
        ${
          areas.length
            ? `<div class="list">${areas
                .map(
                  (a) =>
                    `<div class="item" data-row="${a.id}" style="cursor:pointer;${covHl === a.id ? 'background:#fff1cf;' : ''}">${oSel ? `<span style="flex:none;width:24px;height:24px;margin:0 12px 0 2px;border-radius:7px;border:2px solid #2e7a4d;display:inline-flex;align-items:center;justify-content:center;background:${oIds.has(a.id) ? '#2e7a4d' : 'transparent'};color:#fff">${oIds.has(a.id) ? ico('check', 16) : ''}</span>` : ''}<span class="lead">${ico('map', 22)}</span><div class="ti"><b>${esc(a.name)}</b><small>${fmtMB(a.bytes)} · zoom ${a.zmin}-${a.zmax} · ${a.sources.map((s) => ({ sat: 'Satellite', topo: 'Topo', trails: 'Sentieri' }[s])).join(', ')}</small></div><div style="display:flex;gap:26px;align-items:center;margin-left:8px"><button class="icon-btn" data-go="${a.id}" aria-label="Vai">${ico('nav', 20)}</button><button class="icon-btn" data-del="${a.id}" aria-label="Elimina" style="color:var(--danger)">${ico('trash', 20)}</button></div></div>`
                )
                .join('')}</div>`
            : `<div class="empty">${ico('download', 40)}<p>Nessuna area scaricata.</p></div>`
        }`;
      pg.body.insertAdjacentHTML('beforeend', `<div style="padding:16px 14px 24px"><button class="btn primary big" id="off-new">${ico('download', 20)} Scarica nuova zona dalla mappa</button></div>`);
      pg.body.querySelector('#off-new').onclick = () => { leavePages(); bus.emit('nav:tab', 'map'); setTimeout(() => bus.emit('map:download'), 250); };
      drawCoverage(pg.body.querySelector('#cov-it'), areas);
      if (oSel) covHighlight(oIds, false);
      const bar = document.createElement('div');
      bar.id = 'of-bar';
      bar.style.cssText = 'display:' + (oSel ? 'flex' : 'none') + ';position:fixed;left:10px;right:10px;bottom:calc(var(--sab,0px) + 28px);z-index:30;align-items:center;gap:2px;padding:12px 18px 12px 22px;gap:8px;background:#12372a;color:#fff;border-radius:22px;box-shadow:0 6px 22px rgba(0,0,0,.35)';
      bar.innerHTML = `<b style="flex:1;font-size:.95rem;white-space:nowrap">${oIds.size} ${oIds.size === 1 ? 'selezionata' : 'selezionate'}</b>${[['of-all', 'check', 'Tutte'], ['of-none', 'close', 'Nessuna'], ['of-del', 'trash', 'Elimina']].map(([id, ic, l]) => `<button id="${id}" style="all:unset;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:1px;min-width:62px;padding:4px 6px;font-size:.66rem;color:${id === 'of-del' ? '#ff8a7a' : '#fff'}">${ico(ic, 22)}<span>${l}</span></button>`).join('')}`;
      pg.body.appendChild(bar);
      if (oSel) pg.body.insertAdjacentHTML('beforeend', '<div style="height:calc(var(--sab,0px) + 150px)"></div>');
      const setSel = (on) => { oSel = on; if (!on) oIds.clear(); if (on && !popB) popB = pushBack(() => { popB = null; oSel = false; oIds.clear(); draw(); }); if (!on && popB) { popB(); popB = null; } };
      bar.querySelector('#of-all').onclick = () => { areas.forEach((a) => oIds.add(a.id)); draw(); };
      bar.querySelector('#of-none').onclick = () => { setSel(false); draw(); };
      bar.querySelector('#of-del').onclick = async () => {
        if (!oIds.size) return toast('Nessuna mappa selezionata');
        if (await confirmBox(`Eliminare <b>${oIds.size}</b> mappe offline?`, { ok: 'Elimina', danger: true })) { for (const id of [...oIds]) await deleteArea(id); toast('Eliminate'); covHl = null; setSel(false); draw(); }
      };
      pg.body.querySelectorAll('[data-row]').forEach((row) => {
        let t = 0, lp = false;
        const clr = () => clearTimeout(t);
        row.addEventListener('touchstart', () => { lp = false; t = setTimeout(() => { lp = true; if (!oSel) setSel(true); oIds.add(row.dataset.row); if (navigator.vibrate) navigator.vibrate(30); draw(); }, 500); }, { passive: true });
        row.addEventListener('touchend', clr); row.addEventListener('touchmove', clr); row.addEventListener('touchcancel', clr);
        row.addEventListener('contextmenu', (e) => e.preventDefault());
        row.addEventListener('click', (e) => {
          if (lp) { lp = false; return; }
          if (e.target.closest('[data-go],[data-del]')) return;
          const id = row.dataset.row;
          if (oSel) { oIds.has(id) ? oIds.delete(id) : oIds.add(id); draw(); return; }
          covHl = covHl === id ? null : id;
          pg.body.querySelectorAll('[data-row]').forEach((r) => (r.style.background = r.dataset.row === covHl ? '#fff1cf' : ''));
          covHighlight(covHl);
          if (covHl) pg.body.scrollTo ? pg.body.scrollTo({ top: 0, behavior: 'smooth' }) : 0;
        });
      });
      pg.body.querySelectorAll('[data-cancel]').forEach((b) => (b.onclick = () => cancelDownload(b.dataset.cancel)));
      pg.body.querySelectorAll('[data-del]').forEach(
        (b) =>
          (b.onclick = async () => {
            if (await confirmBox('Eliminare questa mappa offline?', { ok: 'Elimina', danger: true })) {
              await deleteArea(b.dataset.del);
              draw();
            }
          })
      );
      const eb = document.querySelector('#of-all-del');
      if (eb) eb.onclick = async () => {
        if (!areas.length) return toast('Nessuna mappa da eliminare');
        if (await confirmBox(`Eliminare <b>tutte le ${areas.length}</b> mappe offline? Non si può annullare.`, { ok: 'Elimina tutto', danger: true })) { for (const a of areas) await deleteArea(a.id); covHl = null; setSel(false); toast('Mappe eliminate'); draw(); }
      };
      pg.body.querySelectorAll('[data-go]').forEach(
        (b) =>
          (b.onclick = () => {
            const a = areas.find((x) => x.id === b.dataset.go);
            leavePages();
            bus.emit('nav:tab', 'map');
            bus.emit('map:fit', a.bounds);
          })
      );
    };
    draw();
    const o1 = bus.on('dl:update', () => draw());
    const o2 = bus.on('dl:done', () => draw());
    pg.onClose = () => { covHl = null; covView = null; covSel.clear(); if (popB) popB(); o1 && o1(); o2 && o2(); if (covMap) { try { covMap.remove(); } catch {} covMap = null; } };
  }, { actions: `<button class="chip" id="of-all-del" style="color:#ff8a7a">Elimina tutto</button>` });
}

// ---------- import / export ----------
function importFiles() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.multiple = true;
  inp.accept = '*/*';
  inp.onchange = async () => {
    const files = [];
    for (const f of Array.from(inp.files || [])) files.push({ name: f.name, text: await f.text() });
    await importTexts(files);
  };
  inp.click();
}

// ---------- Garmin ----------
function openGarmin() {
  openPage('Garmin GPSMAP', (pg) => {
    pg.body.innerHTML = `<div style="padding:14px" class="stack">
      <div class="card"><h3>Dal Garmin a Footprint</h3><p style="margin:0 0 10px;line-height:1.5;font-size:.9rem"><b>Con cavo USB (OTG):</b> collega il GPSMAP al telefono, premi "Importa" e scegli i file nella memoria del Garmin: <i>Garmin/GPX</i> per i waypoint e <i>Garmin/GPX/Current/Current.gpx</i> per la traccia corrente (le registrate stanno in <i>Archive</i>).<br><b>Con Garmin Explore:</b> esporta un file GPX e scegli Footprint dal menu Condividi, si importa da solo.</p><button class="btn primary big" id="g-imp">${ico('upload', 18)} Importa dal Garmin</button></div>
      <div class="card"><h3>Da Footprint al Garmin</h3><p style="margin:0 0 10px;line-height:1.5;font-size:.9rem">Crea un unico file GPX con i tuoi waypoint (con i simboli Garmin) e le tracce. Salvalo con USB nella cartella <i>Garmin/GPX</i> del GPSMAP: i punti compaiono nell'elenco waypoint dell'apparecchio.</p><button class="btn ghost big" id="g-exp">${ico('share', 18)} Prepara il file per il Garmin</button></div>
      <div class="infobox">Il collegamento Bluetooth in tempo reale non è disponibile: il Bluetooth del GPSMAP 65s parla solo con le app Garmin. Servirebbe un'app Connect IQ sul Garmin.</div></div>`;
    pg.body.querySelector('#g-imp').onclick = importFiles;
    pg.body.querySelector('#g-exp').onclick = () => exportAll();
  });
}

const MESI = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
function toKML(wps, tracks, name) {
  const x = (t) => String(t).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  return `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${x(name)}</name>` +
    wps.map((w) => `<Placemark><name>${x(w.title || 'Waypoint')}</name><description>${x(w.note || '')}</description><Point><coordinates>${w.lon},${w.lat},${w.alt || 0}</coordinates></Point></Placemark>`).join('') +
    tracks.map((t) => `<Placemark><name>${x(t.name)}</name><MultiGeometry>${segments(t.points).map((sg) => `<LineString><tessellate>1</tessellate><coordinates>${sg.map((q) => `${q[1]},${q[0]},${q[2] || 0}`).join(' ')}</coordinates></LineString>`).join('')}</MultiGeometry></Placemark>`).join('') +
    `</Document></kml>`;
}
function exportAll() {
  const wps0 = getWaypoints(), metas0 = getTracks();
  if (!wps0.length && !metas0.length) return toast('Niente da esportare');
  const stamps = [...wps0.map((w) => w.ts), ...metas0.map((t) => t.start)].filter(Boolean).map((t) => new Date(t));
  const years = [...new Set(stamps.map((d) => d.getFullYear()))].sort((a, b) => b - a);
  const sh = openSheet({
    title: 'Esporta',
    body: `<div class="stack">
      <div class="row gap"><select id="ex-y" class="grow"><option value="">Tutti gli anni</option>${years.map((y) => `<option>${y}</option>`).join('')}</select><select id="ex-m" class="grow"><option value="0">Tutti i mesi</option>${MESI.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('')}</select></div>
      <div class="ex-dates"><label class="field"><span>Dal</span><input type="date" id="ex-d1" onfocus="this.select&&this.select()"></label><label class="field"><span>Al</span><input type="date" id="ex-d2" onfocus="this.select&&this.select()"></label><button type="button" class="btn" id="ex-today">Oggi</button></div>
      <label class="field"><span>Contenuto</span><select id="ex-w"><option value="all">Waypoint e tracce</option><option value="wp">Solo waypoint</option><option value="tr">Solo tracce</option></select></label>
      <p class="muted" id="ex-n" style="margin:0;font-size:.85rem"></p>
      <div class="ex-fmt"><button class="btn primary" id="ex-gpx">${ico('share', 18)} GPX</button><button class="btn" id="ex-kml">${ico('share', 18)} KML</button><select id="ex-more"><option value="">Altri ▾</option><option value="geojson">GeoJSON</option><option value="tcx">TCX</option><option value="loc">LOC</option></select></div></div>`,
  });
  const q = (i) => sh.body.querySelector(i);
  const pick = () => {
    const y = q('#ex-y').value, m = Number(q('#ex-m').value) || 0, w = q('#ex-w').value;
    const d1 = q('#ex-d1').value, d2 = q('#ex-d2').value;
    const t1 = d1 ? new Date(d1 + 'T00:00:00').getTime() : 0, t2 = d2 ? new Date(d2 + 'T23:59:59').getTime() : Infinity;
    const range = !!(d1 || d2);
    const ok = (ts) => {
      if (range) return ts >= t1 && ts <= t2;
      const d = new Date(ts);
      return (!y || String(d.getFullYear()) === y) && (!m || d.getMonth() + 1 === m);
    };
    const wps = w === 'tr' ? [] : wps0.filter((x) => ok(x.ts));
    const metas = w === 'wp' ? [] : metas0.filter((t) => ok(t.start));
    const fd = (x) => x.split('-').reverse().join('-');
    const label = range ? `Uscite ${d1 && d2 && d1 !== d2 ? fd(d1) + ' al ' + fd(d2) : fd(d1 || d2)}` : `Uscite ${m ? MESI[m - 1] + ' ' : ''}${y || (m ? '' : 'tutte')}`.trim();
    return { wps, metas, label };
  };
  const upd = () => {
    const { wps, metas } = pick();
    q('#ex-n').textContent = `${wps.length} waypoint · ${metas.length} tracce`;
  };
  ['#ex-y', '#ex-m', '#ex-w', '#ex-d1', '#ex-d2'].forEach((i) => (q(i).onchange = upd));
  q('#ex-today').onclick = () => {
    const t = new Date().toLocaleDateString('sv-SE');
    q('#ex-d1').value = t;
    q('#ex-d2').value = t;
    upd();
  };
  upd();
  const go = async (fmt) => {
    const { wps, metas, label } = pick();
    if (!wps.length && !metas.length) return toast('Nessun dato nel periodo');
    const tracks = [];
    for (const m of metas) tracks.push({ ...m, points: await loadTrackPoints(m.id) });
    sh.close();
    try {
      const base = safeName(label) || 'footprint';
      if (fmt === 'kml') await shareFile(`${base}.kml`, toKML(wps, tracks, label), { title: label, mime: 'application/vnd.google-earth.kml+xml' });
      else if (fmt === 'geojson') await shareFile(`${base}.geojson`, JSON.stringify({ type: 'FeatureCollection', features: [...wps.map((w) => ({ type: 'Feature', properties: { name: w.title, desc: w.desc || '', icon: w.icon }, geometry: { type: 'Point', coordinates: [w.lon, w.lat, w.alt || 0] } })), ...tracks.map((t) => ({ type: 'Feature', properties: { name: t.name }, geometry: { type: 'LineString', coordinates: t.points.map((p) => [p[1], p[0], p[2] || 0]) } }))] }), { title: label, mime: 'application/geo+json' });
      else if (fmt === 'loc') await shareFile(`${base}.loc`, `<?xml version="1.0" encoding="UTF-8"?><loc version="1.0" src="Footprint">${wps.map((w, i) => `<waypoint><name id="FP${i + 1}"><![CDATA[${w.title || 'Waypoint'}]]></name><coord lat="${w.lat}" lon="${w.lon}"/><type>Geocache</type></waypoint>`).join('')}</loc>`, { title: label, mime: 'application/xml' });
      else if (fmt === 'tcx') await shareFile(`${base}.tcx`, `<?xml version="1.0" encoding="UTF-8"?><TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"><Activities>${tracks.map((t) => `<Activity Sport="Other"><Id>${new Date(t.start || Date.now()).toISOString()}</Id><Lap StartTime="${new Date(t.start || Date.now()).toISOString()}"><Track>${t.points.map((p) => `<Trackpoint><Time>${new Date(p[3] || t.start || Date.now()).toISOString()}</Time><Position><LatitudeDegrees>${p[0]}</LatitudeDegrees><LongitudeDegrees>${p[1]}</LongitudeDegrees></Position>${p[2] != null ? `<AltitudeMeters>${p[2]}</AltitudeMeters>` : ''}</Trackpoint>`).join('')}</Track></Lap></Activity>`).join('')}</Activities></TrainingCenterDatabase>`, { title: label, mime: 'application/vnd.garmin.tcx+xml' });
      else await shareFile(`${base}.gpx`, toGPX({ waypoints: wps, tracks, name: label }), { title: label });
    } catch {}
  };
  q('#ex-gpx').onclick = () => go('gpx');
  q('#ex-kml').onclick = () => go('kml');
  q('#ex-more').onchange = (e) => { if (e.target.value) go(e.target.value); };
}

// ---------- impostazioni ----------
function openSettings() {
  openPage('Impostazioni', (pg) => {
    const s = getSettings();
    const keyHint = (n) => {
      const k = apiKey(n);
      if (!k) return 'Incolla la chiave API';
      return s[n + 'Key'] ? 'Chiave personale in uso' : 'Chiave integrata attiva';
    };
    pg.body.innerHTML = `
      <div class="sec-title" style="font-size:1.1rem">Traccia GPS</div>
      <div class="list"><div class="set-row"><div class="ti"><b>Schermo sempre acceso</b><small>Utile per consultare la mappa (consuma batteria)</small></div><label class="switch"><input type="checkbox" data-k="keepAwake" ${s.keepAwake ? 'checked' : ''}><i></i></label></div>
      <div class="set-row"><div class="ti"><b>Barra rapida e avvio istantaneo</b><small>Notifica fissa che tiene l'app viva per riaprirla subito. Nessun GPS acceso, consumo minimo</small></div><label class="switch"><input type="checkbox" data-k="keepAlive" ${s.keepAlive !== false ? 'checked' : ''}><i></i></label></div></div>
      <div class="sec-title" style="font-size:1.1rem">Backup online</div>
      <div class="list"><div class="set-row"><div class="ti"><b>Salva una copia online</b><small id="cl-st">Waypoint, tracce, foto e memo, ogni notte alle 02:00, o alla riapertura</small></div><label class="switch"><input type="checkbox" id="cl-sw"><i></i></label></div>
      <div class="set-row"><div class="ti"><b>Mostra sulla mappa i dati degli altri</b><small id="cl-ost">Sempre usati anche dalla previsione; qui li mostri sulla mappa</small></div><label class="switch"><input type="checkbox" id="cl-osw"><i></i></label></div>
      <div class="set-row"><div class="ti"><b>Posizione auto al bot Telegram</b><small id="cl-pst">Quando salvi il parcheggio, l'ultima posizione dell'auto viene inviata al tuo server: solo i contatti autorizzati possono chiedere dove si trova</small></div><label class="switch"><input type="checkbox" id="cl-psw"><i></i></label></div>
      <div class="set-row"><div class="ti"><button class="chip" id="cl-now">Esegui backup ora</button> <button class="chip" id="cl-res">Ripristina dal cloud</button></div></div>
      <div class="set-row" id="cl-acc" style="display:block"></div>
      <div class="set-row"><div class="ti"><button class="chip" id="cl-priv">Informativa privacy</button></div></div></div>
      <div class="list" style="margin-top:22px;border-color:#e6b9b3"><div class="set-row"><div class="ti"><b style="color:#c0392b">Zona pericolosa</b><small>Cancella tutto ciò che hai salvato online. I dati sul telefono restano.</small><div style="margin-top:8px"><button class="chip" id="cl-del" style="color:#c0392b;border-color:#c0392b">Elimina i miei dati dal cloud</button></div></div></div></div>
      <div class="list"><div class="set-row"><div class="ti"><b>Avviso fuori traccia (m)</b><small>Vibrazione quando segui una traccia e ti allontani oltre questa distanza</small></div><input type="number" data-k="offTrackM" value="${s.offTrackM || 80}"></div>
      <div class="set-row"><div class="ti"><b>Avvisi giorni buoni per funghi</b><small>Notifica al mattino quando l'indice previsto è alto nella tua zona</small></div><label class="switch"><input type="checkbox" data-k="notifFungi" ${s.notifFungi ? 'checked' : ''}><i></i></label></div></div>
      <div class="list"><div class="set-row"><div class="ti"><b>Modalità notte</b><small>Interfaccia scura (la mappa non cambia mai)</small></div><label class="switch"><input type="checkbox" data-k="nightMode" ${s.nightMode ? 'checked' : ''}><i></i></label></div>
      <div class="set-row"><div class="ti"><b>Sole diretto (alto contrasto)</b><small>Testi più neri e più spessi, per leggere con la luce forte</small></div><label class="switch"><input type="checkbox" data-k="hiContrast" ${s.hiContrast ? 'checked' : ''}><i></i></label></div>
      <div class="set-row"><div class="ti"><b>Tasto volume giù = waypoint rapido</b><small>Con l'app aperta, senza toccare lo schermo (mani sporche)</small></div><label class="switch"><input type="checkbox" data-k="volumeWp" ${s.volumeWp ? 'checked' : ''}><i></i></label></div>
      <div class="set-row"><div class="ti"><b>Uomo a terra</b><small>Durante la registrazione, se resti fermo 15 minuti parte un conto alla rovescia e poi un allarme sonoro. Funziona con l'app aperta e lo schermo acceso.</small></div><label class="switch"><input type="checkbox" data-k="manDown" ${s.manDown ? 'checked' : ''}><i></i></label></div>
      <div class="set-row"><div class="ti"><b>Scadenza tesserino / permesso</b><small>Ti avviso 30 giorni prima</small></div><input type="date" data-k="permitExpiry" value="${esc(s.permitExpiry)}" onfocus="this.select&&this.select()"></div>
      <div class="set-row"><div class="ti"><b>Avviso tramonto</b><small>Notifica 45 minuti prima del buio, con distanza dall'auto</small></div><label class="switch"><input type="checkbox" data-k="sunsetAlert" ${s.sunsetAlert ? 'checked' : ''}><i></i></label></div>
      <div class="set-row"><div class="ti"><b>Notifica fissa di stato</b><small>Coordinate, quota, distanza dall'auto e tempo di registrazione, visibili anche a schermo bloccato</small></div><label class="switch"><input type="checkbox" data-k="statusNotif" ${s.statusNotif ? 'checked' : ''}><i></i></label></div></div>

      <div class="list"><button class="item" id="bat-ex"><span class="lead">${ico('sliders', 22)}</span><div class="ti"><b>Registrazione in background</b><small>La traccia si avvia solo dal Computer di viaggio.</small><small id="bat-s">Controllo…</small></div></button></div>
      <div class="list"><button class="item" id="wp-order"><span class="lead">${ico('sliders', 22)}</span><div class="ti"><b>Icone waypoint</b><small>Ordine (trascina) e icone da nascondere</small></div></button></div>
      <div class="sec-title" style="font-size:1.1rem">Scheda sanitaria (SOS)</div>
      <div class="list"><div class="set-row col"><div class="ti"><b>Gruppo sanguigno</b></div><input type="text" data-k="iceBlood" value="${esc(s.iceBlood)}" maxlength="8" onfocus="this.select()"></div>
      <div class="set-row col"><div class="ti"><b>Allergie</b></div><input type="text" data-k="iceAllergies" value="${esc(s.iceAllergies)}" maxlength="80" onfocus="this.select()"></div>
      <div class="set-row col"><div class="ti"><b>Contatto ICE</b><small>Salvati solo sul telefono, mostrati e inviati nel messaggio SOS</small></div><input type="tel" data-k="icePhone" value="${esc(s.icePhone)}" maxlength="20" onfocus="this.select()"></div></div>
      <div class="sec-title" style="font-size:1.1rem">Emergenza</div>
      <div class="list"><div class="set-row col"><div class="ti"><b>Nome contatto</b></div><input type="text" data-k="sosName" value="${esc(s.sosName)}" maxlength="30"></div>
      <div class="set-row col"><div class="ti"><b>Numero da chiamare</b><small>Pulsante SOS sulla mappa</small></div><input type="tel" data-k="sosNumber" value="${esc(s.sosNumber)}" maxlength="20"></div></div>
      <div class="sec-title" style="font-size:1.1rem">Bussola</div>
      <div class="list"><div class="set-row"><div class="ti"><b>Declinazione magnetica (°)</b><small>Italia circa +3,5 (Est)</small></div><input type="number" step="0.1" data-k="declination" value="${s.declination}"></div></div>
      <div class="sec-title" style="font-size:1.1rem">Intelligenza artificiale</div>
      <div class="list">
        <div class="set-row col"><div class="ti"><b>Gemini</b><small>${keyHint('gemini')}</small></div><input type="password" data-k="geminiKey" value="${esc(s.geminiKey)}" autocomplete="off"></div>
        <div class="set-row col"><div class="ti"><b>OpenRouter</b><small>${keyHint('openrouter')} (riserva)</small></div><input type="password" data-k="openrouterKey" value="${esc(s.openrouterKey)}" autocomplete="off"></div>
        <div class="set-row col"><div class="ti"><b>Groq</b><small>${keyHint('groq')} (riserva)</small></div><input type="password" data-k="groqKey" value="${esc(s.groqKey)}" autocomplete="off"></div>
      </div>
      <div style="padding:6px 16px 0"><button class="btn ghost big" id="ai-test">${ico('sparkle', 18)} Prova connessione AI</button><div id="ai-test-out" style="margin-top:8px;font-size:.82rem;line-height:1.45"></div></div>
      <div class="sec-title" style="font-size:1.1rem">Modelli (avanzate)</div>
      <div class="list">
        <div class="set-row col"><div class="ti"><b>Gemini</b></div><input type="text" data-k="geminiModel" value="${esc(s.geminiModel)}"></div>
        <div class="set-row col"><div class="ti"><b>OpenRouter</b></div><input type="text" data-k="openrouterModel" value="${esc(s.openrouterModel)}"></div>
        <div class="set-row col"><div class="ti"><b>Groq</b></div><input type="text" data-k="groqModel" value="${esc(s.groqModel)}"></div>
      </div>
      <p class="muted" style="margin:10px 18px;font-size:.8rem">Se Gemini non risponde o ha esaurito la quota, l'app prova automaticamente OpenRouter e poi Groq. Il riconoscimento dei suoni usa solo Gemini.</p>`;
    pg.body.querySelector('#ai-test').onclick = async (e) => {
      const b = e.currentTarget, o = pg.body.querySelector('#ai-test-out');
      b.disabled = true;
      o.textContent = 'Provo…';
      try {
        const { testProviders, providers } = await import('../lib/ai.js');
        const r = await testProviders();
        o.innerHTML = r.length ? r.map((x) => `<div><b>${x.name}</b>: <span style="color:${x.ok ? 'var(--ok)' : 'var(--danger)'}">${esc(x.msg)}</span></div>`).join('') : 'Nessuna chiave configurata.';
      } catch (err) {
        o.textContent = String(err.message);
      }
      b.disabled = false;
    };
    pg.body.querySelector('#wp-order').onclick = openWpOrder;
    (async () => {
      const bs = pg.body.querySelector('#bat-s');
      try {
        const IF = (Capacitor.Plugins && Capacitor.Plugins.IntentFiles) || registerPlugin('IntentFiles');
        const st = await IF.batteryStatus();
        bs.textContent = st.ignoring ? 'Ottimizzazione batteria disattivata: la traccia continua a schermo bloccato.' : `Tocca per permettere a Footprint di lavorare a schermo spento.${/xiaomi|redmi|poco/i.test(st.maker || '') ? ' Su Xiaomi: Impostazioni > App > Footprint > Risparmio energetico: "Nessuna restrizione", e blocca l\'app nei recenti.' : ''}`;
        pg.body.querySelector('#bat-ex').onclick = async () => { await IF.requestBatteryExemption(); };
      } catch { bs.textContent = 'Disponibile solo nell\'app Android.'; }
    })();
    pg.body.querySelectorAll('input[type=password]').forEach((i) => {
      const w = document.createElement('div');
      w.className = 'pwrap';
      i.parentNode.insertBefore(w, i);
      w.appendChild(i);
      const e = document.createElement('button');
      e.type = 'button';
      e.className = 'eye';
      e.textContent = 'Mostra';
      e.onclick = () => { const h = i.type === 'password'; i.type = h ? 'text' : 'password'; e.textContent = h ? 'Nascondi' : 'Mostra'; };
      w.appendChild(e);
    });
    (async () => {
      const cl = await import('../lib/cloud.js');
      const sw = pg.body.querySelector('#cl-sw'), st = pg.body.querySelector('#cl-st');
      if (!sw) return;
      const show = () => { sw.checked = cl.consent() === 'yes'; st.textContent = !cl.cloudConfigured() ? 'Non configurato in questa versione' : cl.consent() === 'yes' ? (cl.lastBackup() ? 'Ultimo backup: ' + new Date(cl.lastBackup()).toLocaleString('it-IT') : 'Nessun backup ancora') : 'Disattivato'; };
      show();
      sw.onchange = () => { cl.setConsent(sw.checked ? 'yes' : 'no'); show(); if (sw.checked) cl.backupNow().then(show); };
      pg.body.querySelector('#cl-now').onclick = async () => { if (cl.consent() !== 'yes') return toast('Attiva prima il backup'); toast('Backup in corso…'); const r = await cl.backupNow(); show(); toast(r.error ? 'Backup non riuscito: ' + r.error : r.skipped ? 'Serve internet' : `Backup fatto (${r.n} elementi nuovi)`); };
      const psw = pg.body.querySelector('#cl-psw');
      psw.checked = cl.parkShare();
      psw.onchange = async () => {
        if (psw.checked && cl.consent() !== 'yes') { psw.checked = false; return toast('Attiva prima il backup online'); }
        cl.setParkShare(psw.checked);
        toast(psw.checked ? 'Posizione auto condivisa con il bot' : 'Condivisione disattivata e dati rimossi');
      };
      const osw = pg.body.querySelector('#cl-osw'), ost = pg.body.querySelector('#cl-ost');
      osw.checked = cl.showOthers();
      osw.onchange = async () => {
        cl.setShowOthers(osw.checked);
        if (osw.checked) { ost.textContent = 'Aggiorno…'; const r = await cl.fetchOthers(); ost.textContent = r.error ? 'Errore: ' + r.error : r.n ? r.n + ' elementi di altri utenti' : 'Nessun dato (account non autorizzato o nessun altro utente)'; }
      };
      const emShow = () => {
        const acc = pg.body.querySelector('#cl-acc'), em = cl.cloudEmail();
        acc.innerHTML = em
          ? `<div style="display:flex;align-items:center;gap:10px"><span style="width:34px;height:34px;border-radius:50%;background:#2e9b5c;color:#fff;display:inline-flex;align-items:center;justify-content:center;flex:none">${ico('check', 20)}</span><div style="min-width:0"><b>Loggato come</b><div style="overflow:hidden;text-overflow:ellipsis;font-size:.92rem">${esc(em)}</div><small class="muted" style="color:#2e7a4d">Sincronizzazione attiva</small></div></div><button class="chip" id="cl-out" style="margin-top:10px">Disconnetti</button>`
          : `<b>Account non collegato</b><div class="muted" style="font-size:.85rem;margin:2px 0 10px">Collega un'email per ritrovare i dati se cambi telefono o reinstalli l'app.</div><div class="row gap"><button class="btn grow" id="cl-login" style="background:#e3eee5;color:#12372a">Accedi</button><button class="btn primary grow" id="cl-link">Registrati</button></div>`;
        const q = (x) => acc.querySelector(x);
        if (q('#cl-link')) q('#cl-link').onclick = () => mailSheet('Registrati', false);
        if (q('#cl-login')) q('#cl-login').onclick = () => mailSheet('Accedi con email', true);
        if (q('#cl-out')) q('#cl-out').onclick = async () => { if (await confirmBox('Disconnettere l\'account? I dati sul telefono restano e potrai riaccedere con email e password.', { ok: 'Disconnetti' })) { cl.logoutCloud(); emShow(); show(); toast('Disconnesso'); } };
      };
      const mailSheet = (title, login) => {
        const sh = openSheet({ title, body: `<div data-enter-scope><label class="field"><span>Email</span><input id="ml-e" type="text" inputmode="email" autocapitalize="off" autocomplete="email" value="${esc(cl.cloudEmail())}" onfocus="this.select()"></label><label class="field" style="position:relative"><span>Password (almeno 8 caratteri)</span><input id="ml-p" type="password" autocomplete="${login ? 'current-password' : 'new-password'}" onfocus="this.select()" style="padding-right:52px"><button type="button" id="ml-eye" aria-label="Mostra password" style="position:absolute;right:6px;bottom:6px;width:42px;height:42px;border:0;background:none;color:#4b5f55;display:inline-flex;align-items:center;justify-content:center"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/><path id="ml-slash" d="M3 3l18 18"/></svg></button></label><button class="btn primary big" data-primary id="ml-go">${login ? 'Accedi' : 'Collega'}</button>${login ? '<button class="chip" id="ml-forgot" style="margin-top:12px">Password dimenticata?</button>' : ''}</div>` });
        const pw = sh.body.querySelector('#ml-p'), slash = sh.body.querySelector('#ml-slash');
        sh.body.querySelector('#ml-eye').onclick = () => { const h = pw.type === 'password'; pw.type = h ? 'text' : 'password'; slash.style.display = h ? 'none' : ''; };
        const fg = sh.body.querySelector('#ml-forgot');
        if (fg) fg.onclick = async () => { const e = sh.body.querySelector('#ml-e').value.trim(); if (!e.includes('@')) return toast('Scrivi prima la tua email'); toast('Un attimo…'); const r = await cl.resetPassword(e); toast(r.error ? r.error : 'Ti ho inviato una email con il link per scegliere una nuova password', 5000); };
        sh.body.querySelector('#ml-go').onclick = async () => {
          const e = sh.body.querySelector('#ml-e').value.trim(), pw = sh.body.querySelector('#ml-p').value;
          if (!e.includes('@') || pw.length < 8) return toast('Email o password non validi (minimo 8 caratteri)');
          toast('Un attimo…');
          const r = login ? await cl.loginEmail(e, pw) : await cl.linkEmail(e, pw);
          if (r.error) return toast(r.error, 4000);
          sh.close(); emShow(); show();
          toast(login ? 'Accesso fatto. Ora puoi toccare Ripristina dal cloud' : r.confirm ? 'Collegata. Conferma l\'email dal messaggio che ti arriva' : 'Email collegata', 4500);
        };
      };
      emShow();
      pg.body.querySelector('#cl-priv').onclick = () => window.open('https://aelleicsics92.github.io/Footprint-apk/privacy.html', '_blank');
      pg.body.querySelector('#cl-del').onclick = async () => { if (!(await confirmBox('Eliminare tutti i tuoi dati salvati online? I dati sul telefono restano.', { ok: 'Elimina', danger: true }))) return; const r = await cl.deleteCloudData(); toast(r.error ? 'Non riuscito: ' + r.error : 'Dati online eliminati', 3500); show(); };
      pg.body.querySelector('#cl-res').onclick = async () => { toast('Ripristino in corso…'); const r = await cl.restoreNow(); toast(r.error ? 'Ripristino non riuscito: ' + r.error : `Ripristinati ${r.nw} waypoint e ${r.nt} tracce`, 3500); };
    })();
    pg.body.querySelectorAll('[data-k]').forEach((inp) => {
      inp.addEventListener('change', async () => {
        const k = inp.dataset.k;
        let v = inp.type === 'checkbox' ? inp.checked : inp.type === 'number' ? Number(inp.value) || 0 : inp.value.trim();
        setSetting(k, v);
        if (k === 'keepAwake') setWakeLock(v);
        if (k === 'keepAlive') { try { const IFk = (Capacitor.Plugins && Capacitor.Plugins.IntentFiles) || registerPlugin('IntentFiles'); v ? (getRec().status === 'idle' && IFk.keepStart()) : IFk.keepStop(); } catch {} }
        if (k === 'hiContrast') document.documentElement.classList.toggle('hc', !!v);
        if (k === 'volumeWp') { try { const IF = (Capacitor.Plugins && Capacitor.Plugins.IntentFiles) || registerPlugin('IntentFiles'); IF.setVolumeKey({ enabled: !!v }); } catch {} }
        if (k === 'nightMode') document.documentElement.classList.toggle('night', !!v);
        if (k === 'statusNotif' && v && !(await askNotifPermission())) {
          setSetting(k, false);
          inp.checked = false;
          toast('Permesso notifiche negato');
        }
        if (k === 'notifFungi' && v && !(await askNotifPermission())) {
          setSetting(k, false);
          inp.checked = false;
          toast('Permesso notifiche negato');
        }
        bus.emit('settings:changed', k);
        if (inp.type !== 'checkbox') toast('Salvato', 1200);
      });
    });
  });
}

function openAbout() {
  openPage('Info', (pg) => {
    pg.body.innerHTML = `<div class="hero" style="border-radius:0"><h1>Footprint</h1><p>Traccia il cammino, rispetta il bosco.</p></div>
      <div class="card"><h3>Come funziona</h3><p style="margin:0;line-height:1.5;font-size:.9rem">Mappe, tracce, waypoint, guide e schede funzionano <b>offline</b>. Servono internet solo per scaricare mappe, meteo e riconoscimento AI. SOS: se non c'è campo, prova un punto aperto o invia un SMS (parte appena torna il segnale).</p></div>
      <div class="card"><h3>Avvertenza sul riconoscimento</h3><p style="margin:0;line-height:1.5;font-size:.9rem">Il riconoscimento tramite intelligenza artificiale (funghi, erbe, tartufi, tracce) e l'indice di crescita funghi sono <b>stime</b> a scopo informativo e <b>non sostituiscono</b> il parere di un micologo o di un esperto (es. ispettorato micologico dell'ASL). <b>Non consumare mai</b> funghi, erbe o altro in base a questa app. Gli autori declinano ogni responsabilità per danni a persone o cose derivanti dall'uso dell'app. In montagna porta una mappa di riserva e avvisa qualcuno del percorso. Rispetta le norme locali su raccolta funghi e tartufi (permessi, limiti, periodi).</p></div>
      <div class="card"><h3>Privacy</h3><p style="margin:0;line-height:1.5;font-size:.9rem">Posizione, tracce, waypoint e foto restano <b>sul tuo telefono</b>. Per il riconoscimento, la foto (o l'audio) e una posizione approssimativa vengono inviati al servizio AI (Google Gemini, OpenRouter o Groq) solo quando premi "Analizza". Evita di inquadrare persone o dati personali. Non c'è alcun account né tracciamento pubblicitario. Puoi cancellare i tuoi dati dalle impostazioni di Android (Gestisci spazio, Cancella dati).</p></div>
      <div class="card"><h3>Crediti dati</h3><p style="margin:0;line-height:1.5;font-size:.9rem">Mappe: Esri World Imagery, © OpenStreetMap contributors, OpenTopoMap (CC-BY-SA), sentieri waymarkedtrails.org (CC-BY-SA). Meteo: Open-Meteo.com. Foto delle specie: Wikipedia / Wikimedia Commons (licenze libere). Schede naturalistiche indicative.</p></div>
      <p class="muted" style="text-align:center;font-size:.8rem">Versione 1.0</p>`;
  });
}

function openWpOrder() {
  const sh = openSheet({ title: 'Icone waypoint', body: '<div id="wo" class="list"></div><button class="btn ghost" id="wo-reset" style="margin-top:10px">Ripristina ordine</button>', full: true });
  const draw = () => {
    const l = orderedIcons(getSettings().wpOrder);
    sh.body.querySelector('#wo').innerHTML = l.map((i, n) => `<div class="set-row wo-row ${(getSettings().wpHidden || []).includes(i.id) ? 'off' : ''}" data-n="${n}"><span class="wo-grip" data-grip>☰</span><span class="ic">${i.svg}</span><div class="ti"><b>${esc(i.label)}</b></div><button class="btn ghost" data-h="${i.id}" aria-label="Mostra o nascondi">${(getSettings().wpHidden || []).includes(i.id) ? '🚫' : '👁'}</button><button class="btn ghost" data-u="${n}" ${n ? '' : 'disabled'}>▲</button><button class="btn ghost" data-d="${n}" ${n < l.length - 1 ? '' : 'disabled'}>▼</button></div>`).join('');
  };
  const move = (n, dlt) => {
    const ids = orderedIcons(getSettings().wpOrder).map((i) => i.id);
    const [x] = ids.splice(n, 1);
    ids.splice(n + dlt, 0, x);
    setSetting('wpOrder', ids);
    draw();
  };
  sh.body.addEventListener('click', (e) => {
    const u = e.target.closest('[data-u]'), d = e.target.closest('[data-d]'), h = e.target.closest('[data-h]');
    if (h) {
      const cur = getSettings().wpHidden || [];
      setSetting('wpHidden', cur.includes(h.dataset.h) ? cur.filter((x) => x !== h.dataset.h) : [...cur, h.dataset.h]);
      draw();
    } else if (u) move(Number(u.dataset.u), -1);
    else if (d) move(Number(d.dataset.d), 1);
    else if (e.target.closest('#wo-reset')) (setSetting('wpOrder', []), setSetting('wpHidden', []), draw());
  });
  sh.body.style.padding = '6px 34px 24px';
  let drag = null;
  sh.body.addEventListener('pointerdown', (e) => {
    const g = e.target.closest('[data-grip]');
    if (!g) return;
    const row = g.closest('.wo-row');
    drag = { row, n: Number(row.dataset.n), y0: e.clientY, cy: e.clientY, s0: sh.body.scrollTop };
    drag.raf = requestAnimationFrame(tick);
    row.classList.add('drag');
    g.setPointerCapture && g.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  const upd = () => (drag.row.style.transform = `translateY(${drag.cy - drag.y0 + (sh.body.scrollTop - drag.s0)}px)`);
  const tick = () => {
    if (!drag) return;
    const r = sh.body.getBoundingClientRect(), edge = 90;
    let v = 0;
    if (drag.cy < r.top + edge) v = -Math.ceil(((r.top + edge - drag.cy) / edge) * 16);
    else if (drag.cy > r.bottom - edge) v = Math.ceil(((drag.cy - (r.bottom - edge)) / edge) * 16);
    if (v) (sh.body.scrollTop += v), upd();
    drag.raf = requestAnimationFrame(tick);
  };
  sh.body.addEventListener('pointermove', (e) => {
    if (!drag) return;
    drag.cy = e.clientY;
    upd();
  });
  const end = (e) => {
    if (!drag) return;
    cancelAnimationFrame(drag.raf);
    const rows = [...sh.body.querySelectorAll('.wo-row')];
    const rr = drag.row.getBoundingClientRect(), cy = rr.top + rr.height / 2;
    drag.row.style.transform = '';
    drag.row.classList.remove('drag');
    let to = rows.filter((r) => r !== drag.row && r.getBoundingClientRect().top + r.getBoundingClientRect().height / 2 < cy).length;
    const from = drag.n;
    drag = null;
    if (to !== from) move(from, to - from);
  };
  sh.body.addEventListener('pointerup', end);
  sh.body.addEventListener('pointercancel', end);
  draw();
}
