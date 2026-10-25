import { registerPlugin, Capacitor } from '@capacitor/core';
import { ico, wpIcon, orderedIcons } from '../lib/icons.js';
import { esc, bus, fmtDist, fmtDur, fmtDate, uid } from '../lib/util.js';
import { openPage, openSheet, toast, confirmBox } from '../lib/ui.js';
import { getSettings, setSetting, apiKey } from '../lib/store.js';
import { openWeather } from './weather.js';
import { getWaypoints, openWaypoint, mergeWaypoints } from '../lib/waypoints.js';
import { getTracks, loadTrackPoints, renameTrack, deleteTrack, saveTrack, startRecording, stopRecording, getRec } from '../lib/track.js';
import { toGPX, shareFile, safeName, parseGpsText } from '../lib/gpsio.js';
import { listAreas, deleteArea, fmtMB, getQueue, cancelDownload } from '../lib/offline.js';
import { setWakeLock } from '../lib/wake.js';
import { askNotifPermission } from '../lib/notify.js';
import { openDiary } from './diary.js';
import { openPrices } from './prices.js';
import { openRadar } from './extras.js';
import { importTexts } from '../lib/importer.js';

function openDog() {
  openPage('Profilo cane', (pg) => {
    const s = getSettings();
    const f = (k, l, type = 'text', ph = '') => `<div class="set-row"><div class="ti"><b>${l}</b></div><input type="${type}" data-k="${k}" value="${esc(s[k] || '')}" placeholder="${ph}" onfocus="this.select&&this.select()"></div>`;
    pg.body.innerHTML = `<div class="list" style="margin-top:12px">${f('dogName', 'Nome (più cani: separati da virgola)')}${f('dogChip', 'Numero microchip')}${f('dogVaccine', 'Scadenza vaccini', 'date')}${f('dogParasite', 'Scadenza antiparassitario', 'date')}${f('dogVet', 'Veterinario di fiducia (telefono)', 'tel')}</div>
      <p class="muted" style="margin:10px 18px;font-size:.82rem">Ti avviso 30 giorni prima delle scadenze. Dati salvati solo sul telefono.</p>
      ${s.dogVet ? `<div style="padding:0 16px"><a class="btn primary big" href="tel:${esc(s.dogVet)}">Chiama il veterinario</a></div>` : ''}`;
    pg.body.querySelectorAll('[data-k]').forEach((i) => i.addEventListener('change', () => { setSetting(i.dataset.k, i.value.trim()); bus.emit('settings:changed', i.dataset.k); toast('Salvato', 1200); }));
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
      ['sparkle', 'Prezzi tartufo', 'Quotazioni aggiornate al cavatore', openPrices],
      ['paw', 'Profilo cane', 'Microchip, vaccini, antiparassitario', openDog],
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
  const refreshBadge = () => {
    const s = getSettings(), now = Date.now();
    const due = [s.dogVaccine, s.dogParasite].some((d) => d && new Date(d + 'T23:59:59').getTime() - now < 30 * 86400000);
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
  openPage('Le mie tracce', (pg) => {
    const draw = () => {
      const t = getTracks();
      pg.body.innerHTML = t.length
        ? `<div class="list">${t
            .map(
              (x) =>
                `<button class="item" data-id="${x.id}"><span class="lead">${ico('route', 22)}</span><div class="ti"><b>${esc(x.name)}</b><small>${fmtDate(x.start)} · ${fmtDist(x.dist)} · ${fmtDur(x.dur)} · +${Math.round(x.up)} m</small></div></button>`
            )
            .join('')}</div>`
        : `<div class="empty">${ico('route', 40)}<p>Nessuna traccia salvata.<br>Attiva la registrazione in Impostazioni oppure importa un file GPX.</p></div>`;
      pg.body.querySelectorAll('[data-id]').forEach((b) => (b.onclick = () => trackSheet(t.find((x) => x.id === b.dataset.id), pg)));
    };
    draw();
    const off = bus.on('tracks:changed', draw);
    pg.onClose = off;
  });
}

function trackSheet(t, pg) {
  const s = openSheet({
    title: t.name,
    body: `<div data-enter-scope>
      <div class="stat-row"><div><b>${fmtDist(t.dist)}</b><span>Distanza</span></div><div><b>${fmtDur(t.dur)}</b><span>Durata</span></div><div><b>+${Math.round(t.up)} m</b><span>Salita</span></div><div><b>-${Math.round(t.down)} m</b><span>Discesa</span></div></div>
      <div id="t-prof"></div>
      <p class="muted" style="margin:4px 0 8px;font-size:.88rem">${fmtDate(t.start)}${t.maxAlt != null ? ` · quota ${Math.round(t.minAlt)}–${Math.round(t.maxAlt)} m` : ''}</p>
      <div class="row gap wrap"><button class="btn primary grow" id="t-show">${ico('map', 18)} Mostra sulla mappa</button><button class="btn ghost grow" id="t-share">${ico('share', 18)} Condividi GPX</button></div>
      <div class="row gap wrap" style="margin-top:8px"><button class="btn ghost grow" id="t-follow">${ico('route', 18)} Segui con avviso fuori traccia</button></div>
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
    pg && pg.close();
    bus.emit('track:show', { id: t.id, name: t.name });
  };
  q('#t-follow').onclick = () => {
    s.close();
    pg && pg.close();
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
      let q = '';
      const draw = () => {
        const s = q.trim().toLowerCase();
        const list = getWaypoints().filter((w) => !s || w.title.toLowerCase().includes(s) || (w.desc || '').toLowerCase().includes(s) || wpIcon(w.icon).label.toLowerCase().includes(s) || (w.tags || []).some((t) => t.toLowerCase().includes(s))).sort((a, b) => b.ts - a.ts);
        pg.body.querySelector('#wl').innerHTML = list.length
          ? list
              .map((w) => `<button class="item" data-id="${w.id}"><span class="lead"><span class="ic">${wpIcon(w.icon).svg}</span></span><div class="ti"><b>${esc(w.title)}</b><small>${fmtDate(w.ts)}${w.desc ? ' · ' + esc(w.desc) : ''}</small></div></button>`)
              .join('')
          : `<div class="empty">${ico('pinplus', 40)}<p>Nessun waypoint.<br>Usa il pulsante sulla mappa per salvarne uno.</p></div>`;
        pg.body.querySelectorAll('[data-id]').forEach((b) => (b.onclick = () => openWaypoint(getWaypoints().find((w) => w.id === b.dataset.id))));
      };
      pg.body.innerHTML = `<div style="margin:12px 14px 0"><input id="wq" type="search" placeholder="Cerca per nome, specie (es. Porcino) o habitat…"></div><div class="list" id="wl"></div>`;
      pg.body.querySelector('#wq').oninput = (e) => ((q = e.target.value), draw());
      draw();
      const off = bus.on('wp:changed', draw);
      pg.onClose = off;
    },
    {
      actions: `<button class="icon-btn" id="wl-share" aria-label="Esporta waypoint">${ico('share', 22)}</button>`,
    }
  );
  setTimeout(() => {
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
function openOffline() {
  openPage('Mappe offline', async (pg) => {
    const draw = async () => {
      const areas = await listAreas();
      let usage = '';
      try {
        const e = await navigator.storage.estimate();
        usage = `Spazio usato dall'app: ${fmtMB(e.usage || 0)}`;
      } catch {}
      const qq = getQueue();
      const qHTML = qq.length ? `<div class="sec-title" style="font-size:1.05rem">Coda download</div><div class="list">${qq.map((j) => { const pc = Math.round(((j.done || 0) / (j.total || 1)) * 100); return `<div class="item" style="cursor:default;flex-wrap:wrap"><span class="lead">${ico('download', 22)}</span><div class="ti"><b>${esc(j.name)}</b><small>${j.status === 'running' ? `Scarico… ${pc}% · ${fmtMB(j.bytes || 0)}` : 'In attesa'}</small></div><button class="icon-btn" data-cancel="${j.id}" aria-label="Annulla" style="color:var(--danger)">${ico('close', 20)}</button>${j.status === 'running' ? `<div class="progress" style="flex-basis:100%;margin-top:6px"><i style="width:${pc}%"></i></div>` : ''}</div>`; }).join('')}</div>` : '';
      pg.body.innerHTML = `<div class="infobox" style="margin:14px">Per scaricare una zona: apri la mappa, inquadra l'area e tocca ${ico('download', 16)}: finisce in coda e scarica in background, puoi aggiungerne altre. ${usage}</div>${qHTML}
        ${
          areas.length
            ? `<div class="list">${areas
                .map(
                  (a) =>
                    `<div class="item" style="cursor:default"><span class="lead">${ico('map', 22)}</span><div class="ti"><b>${esc(a.name)}</b><small>${fmtMB(a.bytes)} · zoom ${a.zmin}-${a.zmax} · ${a.sources.map((s) => ({ sat: 'Satellite', topo: 'Topo', trails: 'Sentieri' }[s])).join(', ')}</small></div><button class="icon-btn" data-go="${a.id}" aria-label="Vai">${ico('nav', 20)}</button><button class="icon-btn" data-del="${a.id}" aria-label="Elimina" style="color:var(--danger)">${ico('trash', 20)}</button></div>`
                )
                .join('')}</div>`
            : `<div class="empty">${ico('download', 40)}<p>Nessuna area scaricata.</p></div>`
        }`;
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
      pg.body.querySelectorAll('[data-go]').forEach(
        (b) =>
          (b.onclick = () => {
            const a = areas.find((x) => x.id === b.dataset.go);
            pg.close();
            bus.emit('nav:tab', 'map');
            bus.emit('map:fit', a.bounds);
          })
      );
    };
    draw();
    const o1 = bus.on('dl:update', () => draw());
    const o2 = bus.on('dl:done', () => draw());
    pg.onClose = () => (o1 && o1(), o2 && o2());
  });
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
    tracks.map((t) => `<Placemark><name>${x(t.name)}</name><LineString><tessellate>1</tessellate><coordinates>${t.points.map((q) => `${q[1]},${q[0]},${q[2] || 0}`).join(' ')}</coordinates></LineString></Placemark>`).join('') +
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
      <div class="row gap" style="align-items:end"><label class="field grow"><span>Dal</span><input type="date" id="ex-d1" onfocus="this.select&&this.select()"></label><label class="field grow"><span>Al</span><input type="date" id="ex-d2" onfocus="this.select&&this.select()"></label><button type="button" class="btn ghost" id="ex-today" style="margin-bottom:12px">Oggi</button></div>
      <label class="field"><span>Contenuto</span><select id="ex-w"><option value="all">Waypoint e tracce</option><option value="wp">Solo waypoint</option><option value="tr">Solo tracce</option></select></label>
      <p class="muted" id="ex-n" style="margin:0;font-size:.85rem"></p>
      <div class="row gap"><button class="btn primary grow" id="ex-gpx">${ico('share', 18)} GPX</button><button class="btn ghost grow" id="ex-kml">${ico('share', 18)} KML</button><select id="ex-more" class="grow"><option value="">Altri formati</option><option value="geojson">GeoJSON</option><option value="tcx">TCX</option><option value="loc">LOC</option></select></div></div>`,
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
      <div class="list"><div class="set-row"><div class="ti"><b>Schermo sempre acceso</b><small>Utile per consultare la mappa (consuma batteria)</small></div><label class="switch"><input type="checkbox" data-k="keepAwake" ${s.keepAwake ? 'checked' : ''}><i></i></label></div></div>
      <div class="list"><div class="set-row"><div class="ti"><b>Avviso fuori traccia (m)</b><small>Vibrazione quando segui una traccia e ti allontani oltre questa distanza</small></div><input type="number" data-k="offTrackM" value="${s.offTrackM || 80}"></div>
      <div class="set-row"><div class="ti"><b>Avvisi giorni buoni per funghi</b><small>Notifica al mattino quando l'indice previsto è alto nella tua zona</small></div><label class="switch"><input type="checkbox" data-k="notifFungi" ${s.notifFungi ? 'checked' : ''}><i></i></label></div></div>
      <div class="list"><div class="set-row"><div class="ti"><b>Modalità notte</b><small>Interfaccia scura (la mappa non cambia mai)</small></div><label class="switch"><input type="checkbox" data-k="nightMode" ${s.nightMode ? 'checked' : ''}><i></i></label></div>
      <div class="set-row"><div class="ti"><b>Sole diretto (alto contrasto)</b><small>Testi più neri e più spessi, per leggere con la luce forte</small></div><label class="switch"><input type="checkbox" data-k="hiContrast" ${s.hiContrast ? 'checked' : ''}><i></i></label></div>
      <div class="set-row"><div class="ti"><b>Tasto volume giù = waypoint rapido</b><small>Con l'app aperta, senza toccare lo schermo (mani sporche)</small></div><label class="switch"><input type="checkbox" data-k="volumeWp" ${s.volumeWp ? 'checked' : ''}><i></i></label></div>
      <div class="set-row"><div class="ti"><b>Uomo a terra</b><small>Durante la registrazione, se resti fermo 15 minuti parte un conto alla rovescia e poi un allarme sonoro. Funziona con l'app aperta e lo schermo acceso.</small></div><label class="switch"><input type="checkbox" data-k="manDown" ${s.manDown ? 'checked' : ''}><i></i></label></div>
      <div class="set-row"><div class="ti"><b>Scadenza tesserino / permesso</b><small>Ti avviso 30 giorni prima</small></div><input type="date" data-k="permitExpiry" value="${esc(s.permitExpiry)}" onfocus="this.select&&this.select()"></div>
      <div class="set-row"><div class="ti"><b>Avviso tramonto</b><small>Notifica 45 minuti prima del buio, con distanza dall'auto</small></div><label class="switch"><input type="checkbox" data-k="sunsetAlert" ${s.sunsetAlert ? 'checked' : ''}><i></i></label></div>
      <div class="set-row"><div class="ti"><b>Notifica fissa di stato</b><small>Coordinate, quota, distanza dall'auto e tempo di registrazione, visibili anche a schermo bloccato</small></div><label class="switch"><input type="checkbox" data-k="statusNotif" ${s.statusNotif ? 'checked' : ''}><i></i></label></div>
      <div class="set-row col"><div class="ti"><b>Nomi dei cani</b><small>Separati da virgola. Nel waypoint scegli quale cane ha trovato (statistiche nel Diario)</small></div><input type="text" data-k="dogName" value="${esc(s.dogName)}" maxlength="30" onfocus="this.select()"></div></div>
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
    pg.body.querySelectorAll('[data-k]').forEach((inp) => {
      inp.addEventListener('change', async () => {
        const k = inp.dataset.k;
        let v = inp.type === 'checkbox' ? inp.checked : inp.type === 'number' ? Number(inp.value) || 0 : inp.value.trim();
        setSetting(k, v);
        if (k === 'keepAwake') setWakeLock(v);
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
