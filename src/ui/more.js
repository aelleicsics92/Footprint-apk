import { ico, wpIcon } from '../lib/icons.js';
import { esc, bus, fmtDist, fmtDur, fmtDate, uid } from '../lib/util.js';
import { openPage, openSheet, toast, confirmBox } from '../lib/ui.js';
import { getSettings, setSetting, apiKey } from '../lib/store.js';
import { openWeather } from './weather.js';
import { getWaypoints, openWaypoint, mergeWaypoints } from '../lib/waypoints.js';
import { getTracks, loadTrackPoints, renameTrack, deleteTrack, saveTrack, startRecording, stopRecording, getRec } from '../lib/track.js';
import { toGPX, shareFile, safeName, parseGpsText } from '../lib/gpsio.js';
import { listAreas, deleteArea, fmtMB } from '../lib/offline.js';
import { setWakeLock } from '../lib/wake.js';
import { askNotifPermission } from '../lib/notify.js';

export function mountMore(el) {
  const items = [
    ['cloud', 'Meteo', 'Previsioni dove ti trovi', () => openWeather()],
    ['route', 'Le mie tracce', 'Percorsi registrati', openTracks],
    ['pinplus', 'I miei waypoint', 'Punti salvati', openWaypointList],
    ['download', 'Mappe offline', 'Aree scaricate sul telefono', openOffline],
    ['upload', 'Importa file GPS', 'GPX, KML, GeoJSON, TCX, LOC (Garmin e altri)', importFiles],
    ['share', 'Esporta', 'Tutto o per periodo (es. Ottobre 2026), GPX o KML', exportAll],
    ['sliders', 'Impostazioni', 'Traccia, emergenza, AI, bussola', openSettings],
    ['info', 'Info su Footprint', 'Versione e crediti', openAbout],
  ];
  el.innerHTML = `<div class="hero"><h1>Footprint</h1><p>Traccia il cammino, rispetta il bosco.</p></div>
    <div class="list" style="margin-top:16px">${items
      .map(([i, t, s], n) => `<button class="item" data-n="${n}"><span class="lead">${ico(i, 22)}</span><div class="ti"><b>${t}</b><small>${s}</small></div><span class="chev">${ico('back', 18).replace('<svg ', '<svg style="transform:rotate(180deg)" ')}</span></button>`)
      .join('')}</div>`;
  el.querySelectorAll('[data-n]').forEach((b) => (b.onclick = () => items[Number(b.dataset.n)][3]()));
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
      <p class="muted" style="margin:4px 0 8px;font-size:.88rem">${fmtDate(t.start)}${t.maxAlt != null ? ` · quota ${Math.round(t.minAlt)}–${Math.round(t.maxAlt)} m` : ''}</p>
      <div class="row gap wrap"><button class="btn primary grow" id="t-show">${ico('map', 18)} Mostra sulla mappa</button><button class="btn ghost grow" id="t-share">${ico('share', 18)} Condividi GPX</button></div>
      <div class="row gap wrap" style="margin-top:8px"><button class="btn ghost grow" id="t-follow">${ico('route', 18)} Segui con avviso fuori traccia</button></div>
      <label class="field"><span>Rinomina</span><input id="t-name" type="text" value="${esc(t.name)}" maxlength="80"></label>
      <div class="row gap"><button class="btn ghost grow danger-t" id="t-del">${ico('trash', 18)} Elimina</button><button class="btn primary grow" data-primary id="t-save">${ico('check', 18)} Salva nome</button></div></div>`,
  });
  const q = (x) => s.body.querySelector(x);
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
        const list = getWaypoints().filter((w) => !s || w.title.toLowerCase().includes(s) || (w.desc || '').toLowerCase().includes(s)).sort((a, b) => b.ts - a.ts);
        pg.body.querySelector('#wl').innerHTML = list.length
          ? list
              .map((w) => `<button class="item" data-id="${w.id}"><span class="lead"><span class="ic">${wpIcon(w.icon).svg}</span></span><div class="ti"><b>${esc(w.title)}</b><small>${fmtDate(w.ts)}${w.desc ? ' · ' + esc(w.desc) : ''}</small></div></button>`)
              .join('')
          : `<div class="empty">${ico('pinplus', 40)}<p>Nessun waypoint.<br>Usa il pulsante sulla mappa per salvarne uno.</p></div>`;
        pg.body.querySelectorAll('[data-id]').forEach((b) => (b.onclick = () => openWaypoint(getWaypoints().find((w) => w.id === b.dataset.id))));
      };
      pg.body.innerHTML = `<div style="margin:12px 14px 0"><input id="wq" type="search" placeholder="Cerca waypoint…"></div><div class="list" id="wl"></div>`;
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
      pg.body.innerHTML = `<div class="infobox" style="margin:14px">Per scaricare una zona: apri la mappa, inquadra l'area e tocca il pulsante ${ico('download', 16)}. ${usage}</div>
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
  });
}

// ---------- import / export ----------
function importFiles() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.multiple = true;
  inp.accept = '*/*';
  inp.onchange = async () => {
    let w = 0, t = 0, err = 0;
    for (const f of Array.from(inp.files || [])) {
      try {
        if (/\.kmz$/i.test(f.name)) throw new Error('KMZ non supportato: esporta in KML');
        const r = parseGpsText(await f.text(), f.name);
        w += await mergeWaypoints(r.waypoints);
        for (const tr of r.tracks) {
          await saveTrack(tr);
          t++;
        }
      } catch (e) {
        err++;
        console.warn(f.name, e);
      }
    }
    toast(err && !w && !t ? 'Formato non riconosciuto' : `Importati ${w} waypoint e ${t} tracce${err ? ` (${err} file non letti)` : ''}`, 3800);
  };
  inp.click();
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
      <label class="field"><span>Contenuto</span><select id="ex-w"><option value="all">Waypoint e tracce</option><option value="wp">Solo waypoint</option><option value="tr">Solo tracce</option></select></label>
      <p class="muted" id="ex-n" style="margin:0;font-size:.85rem"></p>
      <div class="row gap"><button class="btn primary grow" id="ex-gpx">${ico('share', 18)} GPX</button><button class="btn ghost grow" id="ex-kml">${ico('share', 18)} KML</button></div></div>`,
  });
  const q = (i) => sh.body.querySelector(i);
  const pick = () => {
    const y = q('#ex-y').value, m = Number(q('#ex-m').value) || 0, w = q('#ex-w').value;
    const ok = (ts) => {
      const d = new Date(ts);
      return (!y || String(d.getFullYear()) === y) && (!m || d.getMonth() + 1 === m);
    };
    const wps = w === 'tr' ? [] : wps0.filter((x) => ok(x.ts));
    const metas = w === 'wp' ? [] : metas0.filter((t) => ok(t.start));
    const label = `Uscite ${m ? MESI[m - 1] + ' ' : ''}${y || (m ? '' : 'tutte')}`.trim();
    return { wps, metas, label };
  };
  const upd = () => {
    const { wps, metas } = pick();
    q('#ex-n').textContent = `${wps.length} waypoint · ${metas.length} tracce`;
  };
  ['#ex-y', '#ex-m', '#ex-w'].forEach((i) => (q(i).onchange = upd));
  upd();
  const go = async (kml) => {
    const { wps, metas, label } = pick();
    if (!wps.length && !metas.length) return toast('Nessun dato nel periodo');
    const tracks = [];
    for (const m of metas) tracks.push({ ...m, points: await loadTrackPoints(m.id) });
    sh.close();
    try {
      const base = safeName(label) || 'footprint';
      if (kml) await shareFile(`${base}.kml`, toKML(wps, tracks, label), { title: label, mime: 'application/vnd.google-earth.kml+xml' });
      else await shareFile(`${base}.gpx`, toGPX({ waypoints: wps, tracks, name: label }), { title: label });
    } catch {}
  };
  q('#ex-gpx').onclick = () => go(false);
  q('#ex-kml').onclick = () => go(true);
}

// ---------- impostazioni ----------
function openSettings() {
  openPage('Impostazioni', (pg) => {
    const s = getSettings();
    const keyHint = (n) => {
      const k = apiKey(n);
      if (!k) return 'Incolla la chiave API';
      return s[n + 'Key'] ? 'Chiave personale in uso' : `Chiave integrata attiva (${k.slice(0, 4)}…${k.slice(-3)})`;
    };
    pg.body.innerHTML = `
      <div class="sec-title" style="font-size:1.1rem">Traccia GPS</div>
      <div class="list"><div class="set-row"><div class="ti"><b>Registra traccia</b><small>Registra il percorso anche a schermo spento</small></div><label class="switch"><input type="checkbox" data-k="recordTrack" ${s.recordTrack ? 'checked' : ''}><i></i></label></div>
      <div class="set-row"><div class="ti"><b>Schermo sempre acceso</b><small>Utile per consultare la mappa (consuma batteria)</small></div><label class="switch"><input type="checkbox" data-k="keepAwake" ${s.keepAwake ? 'checked' : ''}><i></i></label></div></div>
      <div class="list"><div class="set-row"><div class="ti"><b>Avviso fuori traccia (m)</b><small>Vibrazione quando segui una traccia e ti allontani oltre questa distanza</small></div><input type="number" data-k="offTrackM" value="${s.offTrackM || 80}"></div>
      <div class="set-row"><div class="ti"><b>Avvisi giorni buoni per funghi</b><small>Notifica al mattino quando l'indice previsto è alto nella tua zona</small></div><label class="switch"><input type="checkbox" data-k="notifFungi" ${s.notifFungi ? 'checked' : ''}><i></i></label></div></div>
      <div class="sec-title" style="font-size:1.1rem">Emergenza</div>
      <div class="list"><div class="set-row"><div class="ti"><b>Nome contatto</b></div><input type="text" data-k="sosName" value="${esc(s.sosName)}" maxlength="30"></div>
      <div class="set-row"><div class="ti"><b>Numero da chiamare</b><small>Pulsante SOS sulla mappa</small></div><input type="tel" data-k="sosNumber" value="${esc(s.sosNumber)}" maxlength="20"></div></div>
      <div class="sec-title" style="font-size:1.1rem">Bussola</div>
      <div class="list"><div class="set-row"><div class="ti"><b>Declinazione magnetica (°)</b><small>Italia circa +3,5 (Est)</small></div><input type="number" step="0.1" data-k="declination" value="${s.declination}"></div></div>
      <div class="sec-title" style="font-size:1.1rem">Intelligenza artificiale</div>
      <div class="list">
        <div class="set-row"><div class="ti"><b>Gemini</b><small>${keyHint('gemini')}</small></div><input type="password" data-k="geminiKey" value="${esc(s.geminiKey)}" autocomplete="off"></div>
        <div class="set-row"><div class="ti"><b>OpenRouter</b><small>${keyHint('openrouter')} (riserva)</small></div><input type="password" data-k="openrouterKey" value="${esc(s.openrouterKey)}" autocomplete="off"></div>
        <div class="set-row"><div class="ti"><b>Groq</b><small>${keyHint('groq')} (riserva)</small></div><input type="password" data-k="groqKey" value="${esc(s.groqKey)}" autocomplete="off"></div>
      </div>
      <div style="padding:6px 16px 0"><button class="btn ghost big" id="ai-test">${ico('sparkle', 18)} Prova connessione AI</button><div id="ai-test-out" style="margin-top:8px;font-size:.82rem;line-height:1.45"></div></div>
      <div class="sec-title" style="font-size:1.1rem">Modelli (avanzate)</div>
      <div class="list">
        <div class="set-row"><div class="ti"><b>Gemini</b></div><input type="text" data-k="geminiModel" value="${esc(s.geminiModel)}"></div>
        <div class="set-row"><div class="ti"><b>OpenRouter</b></div><input type="text" data-k="openrouterModel" value="${esc(s.openrouterModel)}"></div>
        <div class="set-row"><div class="ti"><b>Groq</b></div><input type="text" data-k="groqModel" value="${esc(s.groqModel)}"></div>
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
    pg.body.querySelectorAll('[data-k]').forEach((inp) => {
      inp.addEventListener('change', async () => {
        const k = inp.dataset.k;
        let v = inp.type === 'checkbox' ? inp.checked : inp.type === 'number' ? Number(inp.value) || 0 : inp.value.trim();
        setSetting(k, v);
        if (k === 'recordTrack') {
          if (v && getRec().status === 'idle') startRecording();
          else if (!v && getRec().status !== 'idle') {
            const t = await stopRecording();
            toast(t ? `Traccia salvata: ${fmtDist(t.dist)}` : 'Traccia troppo corta: non salvata');
          }
        }
        if (k === 'keepAwake') setWakeLock(v);
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
