import { CITIES } from '../data/cities.js';
import { ITALY } from '../data/italy.js';
import L from 'leaflet';
import 'leaflet-rotate';
import { addRefLayer } from '../lib/reflayer.js';
import { getSettings, setSetting } from '../lib/store.js';
import { bus, esc, clamp } from '../lib/util.js';
import { ico } from '../lib/icons.js';
import { toast } from '../lib/ui.js';
import { lastPos } from '../lib/geo.js';
import { PAST, PROFILES, LEVELS, levelOf, ZONES, getZoneSeries, getPointSeries, outlook, nearestZone } from '../lib/fungi.js';
import { placeName } from './weather.js';
import { SPECIES } from '../data/species.js';
import { analyze, applyProfile, explain, bestNear, confirmField, weatherField, soilField, soilAt, fillSoil, waterNear, probFrom, dayOfYear, LC_NAME } from '../lib/habitat.js';
import { hasAI, askModel } from '../lib/ai.js';
import { calibrate, applyResult, resetCal, findings, spotsFor } from '../lib/calib.js';
import { openPage } from '../lib/ui.js';

let root, fmap, zoneLayer, youMarker, selMarker, heat, hab;
let state = { day: 0, point: null, ptData: null, habAt: null, zones: null, loading: false };
let nameCache = {};

function rainChart(series, prof) {
  const p = (series.p || []).slice(0, PAST + 1).map((v) => v || 0);
  if (p.length < 5) return '';
  const thr = (prof && prof.rain && prof.rain[0]) || 15;
  const mx = Math.max(10, thr * 1.25, ...p);
  const d0 = new Date(series.time[0] + 'T12:00:00'), d1 = new Date(series.time[p.length - 1] + 'T12:00:00');
  const f = (d) => d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
  return `<div class="rainh"><div class="rh-t"><span>Pioggia giorno per giorno (30 giorni)</span><span>max ${Math.round(Math.max(...p))} mm</span></div><div class="rh-b"><u class="rh-thr" style="bottom:${(thr / mx) * 100}%"><em>soglia ${thr} mm</em></u>${p.map((v, i) => `<i title="${series.time[i]}: ${v.toFixed(1)} mm" style="height:${v > 0 ? Math.max(4, (v / mx) * 100) : 2}%;background:${v >= thr ? '#9be3c0' : v > 0 ? '#5f9c86' : 'rgba(255,255,255,.2)'}"></i>`).join('')}</div><div class="rh-l"><span>${f(d0)}</span><span>${f(d1)}</span></div></div>`;
}

export function mountFungi(el) {
  root = el;
  el.innerHTML = `
    <div class="sec-title">Previsione raccolta</div>
    <div class="chips" id="f-prof"></div>
    <div class="f-search"><input id="f-q" type="text" placeholder="Cerca paese o città…" autocomplete="off" enterkeyhint="search" onfocus="this.select()"><button class="chip" id="f-gps">${ico('locate', 16)} Qui</button></div>
    <div id="f-sug" class="f-sug"></div>
    <div id="f-card"></div>
    <div class="sec-title" style="font-size:1.15rem;padding-top:10px">Italia <span class="muted" id="f-daylabel" style="font-size:.85rem;font-family:var(--sans)"></span></div>
    <div class="fmap-wrap"><div id="fungi-map"></div><div id="f-banner" class="f-banner" hidden></div><button id="f-north" class="f-north" hidden aria-label="Nord"><i>▲</i><b>N</b></button></div>
    <div class="hstat" id="f-hstat"></div>
    <div class="legend">${LEVELS.map((l) => `<span><i style="background:${l.color}"></i>${l.label}</span>`).join('')}<span><i style="background:#cfcfcf"></i>Non idoneo</span></div>
    <div class="infobox" style="margin:0 14px 18px">Probabilità = meteo (pioggia 30 giorni, tempi dalla pioggia utile, temperature, gelo, stagione) × habitat della specie scelta (quota, bosco e piante simbionti, pendenza, esposizione, fondovalle, pH del suolo). Avvicinati con lo zoom per il dettaglio a pochi metri. Tocca un punto per il perché. È una stima: la presenza reale non è garantita.</div>`;
  renderProfiles();
  setupSearch();
  bus.on('pos', (p) => {
    if (shown && !state.point && !state.loading) {
      state.point = { lat: p.lat, lon: p.lon, name: '', gps: true };
      loadPoint().then(() => (renderCard(), renderMap()));
    }
  });
  bus.on('nav:tab', (t) => {
    if (t === 'fungi') onShow();
  });
}

async function geocode(q) {
  const loc = CITIES.filter((c) => c[0].toLowerCase().startsWith(q.toLowerCase())).slice(0, 5).map((c) => ({ name: c[0], lat: c[1], lon: c[2], sub: 'Italia' }));
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=7&language=it&format=json`, { signal: ctl.signal });
    clearTimeout(t);
    const j = await r.json();
    const net = (j.results || []).map((x) => ({ name: x.name, lat: x.latitude, lon: x.longitude, sub: [x.admin2 || x.admin1, x.country].filter(Boolean).join(', ') }));
    return net.length ? net : loc;
  } catch {
    return loc;
  }
}

async function pickPlace(c) {
  state.point = { lat: c.lat, lon: c.lon, name: c.name, manual: true };
  root.querySelector('#f-sug').innerHTML = '';
  root.querySelector('#f-q').value = c.name;
  root.querySelector('#f-q').blur();
  if (fmap) {
    if (selMarker) fmap.removeLayer(selMarker);
    selMarker = L.circleMarker([c.lat, c.lon], { radius: 9, color: '#fff', weight: 3, fillColor: '#12372a', fillOpacity: 1 }).addTo(fmap);
    fmap.setView([c.lat, c.lon], Math.max(fmap.getZoom(), 8));
  }
  root.querySelector('#f-card').innerHTML = `<div class="gauge-card"><div class="place">Calcolo l'indice per ${esc(c.name)}…</div><div class="progress"><i style="width:60%"></i></div></div>`;
  await loadPoint();
  renderCard();
}

function setupSearch() {
  const inp = root.querySelector('#f-q'), sug = root.querySelector('#f-sug');
  let t = null, list = [];
  const run = async () => {
    const q = inp.value.trim();
    if (q.length < 2) return (sug.innerHTML = '');
    list = await geocode(q);
    sug.innerHTML = list.length ? list.map((c, i) => `<button class="item" data-i="${i}"><div class="ti"><b>${esc(c.name)}</b><small>${esc(c.sub || '')}</small></div></button>`).join('') : '<div class="empty" style="padding:8px">Nessun risultato</div>';
  };
  inp.addEventListener('input', () => (clearTimeout(t), (t = setTimeout(run, 350))));
  inp.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    clearTimeout(t);
    await run();
    if (list[0]) pickPlace(list[0]);
  });
  sug.addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]');
    if (b) pickPlace(list[Number(b.dataset.i)]);
  });
  root.querySelector('#f-gps').onclick = async () => {
    const p = lastPos();
    if (!p) return toast('GPS non ancora pronto');
    inp.value = '';
    sug.innerHTML = '';
    if (selMarker && fmap) fmap.removeLayer(selMarker);
    state.point = { lat: p.lat, lon: p.lon, name: '', gps: true };
    await loadPoint();
    renderCard();
  };
}

function renderProfiles() {
  const cur = getSettings().fungiProfile;
  root.querySelector('#f-prof').innerHTML =
    Object.entries(PROFILES)
      .map(([k, p]) => `<button class="chip ${k === cur ? 'sel' : ''}" data-p="${k}">${ico(p.truffle ? 'target' : 'mushroom', 16)} ${p.label}</button>`)
      .join('') + `<button class="chip" id="f-refresh">${ico('locate', 16)} Aggiorna</button><button class="chip" id="f-calib">🎯 Calibra col diario</button>`;
  root.querySelectorAll('[data-p]').forEach(
    (b) =>
      (b.onclick = () => {
        setSetting('fungiProfile', b.dataset.p);
        renderProfiles();
        refreshView();
      })
  );
  root.querySelector('#f-refresh').onclick = () => load(true);
  root.querySelector('#f-calib').onclick = openCalib;
}

let shown = false;
function onShow() {
  if (!fmap) initMap();
  setTimeout(() => {
    if (!fmap) return;
    fmap.invalidateSize();
    if (!state.fitted) {
      state.fitted = true;
      fmap.fitBounds([[36.4, 6.6], [47.2, 18.8]]);
    }
  }, 120);
  if (!shown) {
    shown = true;
    load(false);
  }
}

function initMap() {
  fmap = L.map(root.querySelector('#fungi-map'), { zoomControl: false, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false, rotate: true, touchRotate: true, rotateControl: false, bearing: 0, attributionControl: true, minZoom: 5, maxZoom: 14 });
  fmap.attributionControl.setPrefix(false);
  window.__ffmap = fmap;
  L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}', { attribution: 'Esri, USGS, NOAA', maxZoom: 14, maxNativeZoom: 12, className: 'relief-tiles' }).addTo(fmap);
  // riferimenti SOPRA la heatmap: strade, acque, confini e nomi vettoriali (se non raggiungibili: tile raster Esri)
  fmap.createPane('refs');
  fmap.getPane('refs').style.zIndex = 450;
  fmap.getPane('refs').style.pointerEvents = 'none';
  const rasterRefs = () => {
    L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', { pane: 'refs', maxZoom: 14, maxNativeZoom: 12, opacity: 0.9, attribution: 'Esri' }).addTo(fmap);
    L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { pane: 'refs', maxZoom: 14, maxNativeZoom: 12, opacity: 0.95 }).addTo(fmap);
  };
  addRefLayer(fmap, rasterRefs).catch(() => rasterRefs());
  fmap.attributionControl.addAttribution('© OpenStreetMap, OpenFreeMap');
  const nb = root.querySelector('#f-north');
  fmap.on('rotate', () => {
    const br = fmap.getBearing();
    nb.hidden = Math.abs(br) < 1 || Math.abs(br - 360) < 1;
    nb.querySelector('i').style.transform = `rotate(${-br}deg)`;
  });
  nb.onclick = () => fmap.setBearing(0);
  fmap.fitBounds([[36.4, 6.6], [47.2, 18.8]]);
  zoneLayer = L.layerGroup().addTo(fmap);
  heat = new HeatLayer();
  heat.addTo(fmap);
  hab = new HabLayer();
  hab.addTo(fmap);
  fmap.on('click', async (e) => {
    state.point = { lat: e.latlng.lat, lon: e.latlng.lng, name: 'Punto selezionato' };
    if (selMarker) fmap.removeLayer(selMarker);
    selMarker = L.circleMarker(e.latlng, { radius: 9, color: '#fff', weight: 3, fillColor: '#12372a', fillOpacity: 1 }).addTo(fmap);
    // la mappa scorre in modo che il punto resti libero sopra la barra in basso
    const p = fmap.latLngToContainerPoint(e.latlng), target = fmap.getSize().y * 0.3;
    if (Math.abs(p.y - target) > 24) fmap.panBy([0, p.y - target], { animate: true });
    const bn = root.querySelector('#f-banner');
    bn.hidden = false;
    bn.innerHTML = '<span class="bn-l1">Calcolo habitat e meteo…</span>';
    await loadPoint();
    const k = `${e.latlng.lat.toFixed(2)},${e.latlng.lng.toFixed(2)}`;
    if (!state.point.gps) state.point.name = nameCache[k] || (nameCache[k] = await placeName(e.latlng.lat, e.latlng.lng).catch(() => '')) || 'Punto selezionato';
    renderCard();
    renderBanner();
  });
}

// ---------- habitat del punto ----------
const profKey = () => (SPECIES[getSettings().fungiProfile] ? getSettings().fungiProfile : 'autunnali');
const dateFor = (d) => {
  const x = new Date();
  x.setDate(x.getDate() + d);
  return x;
};
async function habFor(lat, lon) {
  const d = 0.03, cl = Math.cos((lat * Math.PI) / 180);
  const A = await analyze({ n: lat + d, s: lat - d, e: lon + d / cl, w: lon - d / cl }, 12);
  const ph = await soilAt(lat, lon, false);
  return { A, lat, lon, ph, water: undefined };
}
function enrichHab(h) {
  const same = () => state.habAt === h;
  soilAt(h.lat, h.lon, true).then((ph) => {
    if (!ph) return;
    h.ph = ph;
    if (same()) (renderCard(), renderBanner());
    hab && hab.refresh();
  }).catch(() => {});
  waterNear(h.lat, h.lon).then((w) => {
    h.water = w || { m: null };
    if (same()) (renderCard(), renderBanner());
  }).catch(() => { h.water = { m: null, fail: true }; if (same()) (renderCard(), renderBanner()); });
}
function exNow() {
  const h = state.habAt;
  if (!h) return null;
  const ex = explain(h.A, profKey(), h.lat, h.lon, h.ph, dayOfYear(dateFor(state.day)));
  if (!ex) return null;
  let H = ex.H;
  if (ex.sp.wet && h.water && h.water.m != null) H = h.water.m <= 100 ? Math.min(1, H * 1.25) : h.water.m <= 300 ? Math.min(1, H * 1.1) : h.water.m > 450 ? H * 0.8 : H;
  const cl = Math.cos((h.lat * Math.PI) / 180);
  const near = spotsFor(profKey(), dayOfYear(dateFor(state.day))).filter((s) => Math.hypot((s.lon - h.lon) * 111320 * cl, (s.lat - h.lat) * 110540) <= 1000);
  const mult = near.length ? 1.2 + 0.05 * Math.min(3, near.length - 1) : 1;
  return { ...ex, H, mult, nConfirm: near.length };
}
let nearCache = {};
function nearNow(W) {
  const h = state.habAt;
  if (!h) return null;
  const doy = dayOfYear(dateFor(state.day)), key = profKey();
  const ck = `${key}|${doy}|${h.lat.toFixed(4)}|${h.lon.toFixed(4)}|${h.ph || 0}`;
  if (nearCache.k !== ck) {
    nearCache = { k: ck, v: null };
    try { nearCache.v = bestNear(h.A, key, h.ph, doy, h.lat, h.lon, W); } catch (e) { console.warn('bestNear', e.message); }
  }
  const v = nearCache.v;
  return v ? { ...v, prob: probFrom(W, v.H) } : null;
}
const fmtM = (m) => (m < 950 ? Math.round(m / 10) * 10 + ' m' : (m / 1000).toFixed(1).replace('.', ',') + ' km');
let bestMarker;
function gotoNear(n) {
  if (bestMarker) fmap.removeLayer(bestMarker);
  bestMarker = L.marker([n.lat, n.lon], { icon: L.divIcon({ className: '', html: '<div class="best-pin">🎯</div>', iconSize: [30, 30], iconAnchor: [15, 15] }), interactive: false }).addTo(fmap);
  fmap.setView([n.lat, n.lon], Math.max(fmap.getZoom(), 13));
  root.querySelector('.fmap-wrap').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
const D8 = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
const WK = { river: 'fiume', stream: 'torrente', brook: 'ruscello', canal: 'canale', ditch: 'fosso', drain: 'fosso' };
function habRows(ex) {
  const h = state.habAt;
  const ph = h && h.ph;
  const rows = [];
  rows.push(['Bosco', ex.verified ? `${LC_NAME(ex.code)}${ex.trees.length && ex.forest > 0.3 ? ' (' + ex.trees.join(', ') + ')' : ''}` : 'non verificato (stima dalla quota)']);
  rows.push(['Terreno', `${ex.slope}° · ${ex.asp < 0 ? 'pianeggiante' : 'versante ' + D8[Math.round(ex.asp / 45) % 8]}`]);
  rows.push(['Posizione', ex.tpi == null ? '–' : ex.tpi < -6 ? 'fondovalle o impluvio' : ex.tpi > 30 ? 'crinale' : 'versante']);
  rows.push(['Suolo', ph ? `pH ${ph.toFixed(1).replace('.', ',')} (${ph >= 7.3 ? 'calcareo' : ph >= 6.5 ? 'neutro' : 'acido'})` : 'pH in arrivo']);
  rows.push(['Acqua vicina', h.water === undefined ? 'verifico…' : h.water && h.water.m != null ? `${h.water.m} m (${WK[h.water.kind] || 'corso d\'acqua'})` : h.water && h.water.fail ? 'n.d.' : 'nessun corso entro 500 m']);
  rows.push(['Specie più adatta', ex.sp.name]);
  if (ex.nConfirm) rows.push(['Il tuo diario', `trovato qui ${ex.nConfirm} ${ex.nConfirm > 1 ? 'volte' : 'volta'} nella stagione (+${Math.round((ex.mult - 1) * 100)}%)`]);
  return rows;
}
function renderBanner() {
  const bn = root.querySelector('#f-banner');
  if (!bn || bn.hidden || !state.ptData) return;
  const prof = PROFILES[getSettings().fungiProfile] || PROFILES.autunnali;
  const sr = state.ptData.series, o = outlook(sr, prof, sr.elev)[clamp(state.day, 0, 7)];
  const ex = exNow();
  const p = ex ? Math.min(97, Math.round(probFrom(o.score, ex.H) * ex.mult)) : o.score;
  const lv = levelOf(p);
  const nm = (state.point && state.point.name) || 'Punto';
  bn.innerHTML = `<button class="bn-x" aria-label="Chiudi">✕</button>
    <div class="bn-l1">📍 <b>${esc(nm)}</b> (${Math.round(sr.elev)} m) · Probabilità <b style="color:${lv.color}">${p}/100</b> · Pioggia 30gg: <b>${Math.round(o.R30)} mm</b></div>
    ${ex ? `<div class="bn-l2">${esc(ex.verified ? LC_NAME(ex.code) : 'bosco n.d.')} · ${ex.asp < 0 ? 'piano' : 'versante ' + D8[Math.round(ex.asp / 45) % 8] + ' ' + ex.slope + '°'} · ${esc(ex.sp.name)}</div>` : ''}
    ${(() => { const n = nearNow(o.score); return n && n.dist > 120 && n.prob > p + 5 ? `<div class="bn-l3">🎯 Meglio a <b>${fmtM(n.dist)} ${D8[Math.round(n.brg / 45) % 8]}</b> (probabilità ${n.prob})</div>` : ''; })()}
    <button class="bn-d">Perché? Dettagli ↓</button>`;
  bn.querySelector('.bn-x').onclick = () => (bn.hidden = true);
  bn.querySelector('.bn-d').onclick = () => root.querySelector('#f-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function load(force) {
  if (state.loading) return;
  state.loading = true;
  root.querySelector('#f-card').innerHTML = `<div class="gauge-card"><div class="place">Calcolo l'indice…</div><div class="progress"><i style="width:60%"></i></div></div>`;
  try {
    state.zones = await getZoneSeries(force);
    const p = lastPos();
    if (p && !state.point) state.point = { lat: p.lat, lon: p.lon, name: '', gps: true };
    await loadPoint(force);
    if (state.zones.stale) toast('Dati non aggiornati (offline)');
  } catch (e) {
    root.querySelector('#f-card').innerHTML = `<div class="warnbox" style="margin:12px 14px">Dati meteo non disponibili. Serve una connessione internet.</div>`;
    state.loading = false;
    return;
  }
  state.loading = false;
  renderCard();
  renderMap();
}

async function loadPoint() {
  const pt = state.point;
  if (!pt) {
    state.ptData = null;
    return;
  }
  try {
    state.ptData = await getPointSeries(pt.lat, pt.lon);
  } catch {
    state.ptData = null;
  }
  state.habAt = null;
  try {
    const h = await habFor(pt.lat, pt.lon);
    state.habAt = h;
    enrichHab(h);
  } catch (e) {
    console.warn('habitat punto', e.message);
  }
  if (pt.gps && !pt.name) {
    const k = `${pt.lat.toFixed(2)},${pt.lon.toFixed(2)}`;
    pt.name = nameCache[k] || (nameCache[k] = await placeName(pt.lat, pt.lon));
  }
}

async function aiAnalysis(box, c) {
  const { ex, o, series, prof, title } = c;
  box.textContent = 'Analizzo…';
  const h = state.habAt;
  const facts = [
    `Luogo: ${title}, quota ${Math.round(ex.alt)} m`,
    `Specie/profilo: ${prof.label}; più adatta qui: ${ex.sp.name} (${ex.sp.note})`,
    `Bosco: ${ex.verified ? LC_NAME(ex.code) + (ex.trees.length ? ' con ' + ex.trees.join(', ') : '') : 'non verificato'}`,
    `Pendenza ${ex.slope}°, ${ex.asp < 0 ? 'pianeggiante' : 'versante ' + D8[Math.round(ex.asp / 45) % 8]}, posizione ${ex.tpi == null ? 'n.d.' : ex.tpi < -6 ? 'fondovalle/impluvio' : ex.tpi > 30 ? 'crinale' : 'versante'}`,
    `Suolo: ${h && h.ph ? 'pH ' + h.ph.toFixed(1) : 'pH n.d.'}`,
    `Acqua: ${h && h.water && h.water.m != null ? h.water.m + ' m' : 'nessun corso entro 500 m o n.d.'}`,
    `Meteo: pioggia 14gg ${Math.round(o.R14)} mm, 30gg ${Math.round(o.R30)} mm, ultima pioggia utile ${o.lag != null ? o.lag + ' giorni fa' : 'nessuna'}, T media 7gg ${o.tmean.toFixed(1)} °C, gelo ${o.frostMin != null && o.frostMin < 0 ? 'sì' : 'no'}`,
    `Punteggi: meteo ${o.wscore}/100, habitat ${Math.round(ex.H * 100)}%, probabilità finale ${o.score}/100${o.closed ? '; FUORI periodo di raccolta' : ''}`,
  ].join('\n');
  try {
    const r = await askModel({
      system: 'Sei un esperto cercatore di funghi e tartufi italiano. Usa SOLO i dati forniti, non inventare. Rispondi in italiano, massimo 5 punti brevi con "•", senza trattini: 1) verdetto (vai ora / aspetta N giorni / non conviene), 2) perché (habitat e meteo), 3) dove cercare nel dettaglio (versante, fosso, piante), 4) quando tornare. Se manca un dato, dillo.',
      user: facts,
    });
    box.innerHTML = esc(r.text).replace(/\n/g, '<br>') + `<div class="hb-n">${esc(r.provider)} · valutazione indicativa</div>`;
  } catch (e) {
    box.textContent = 'AI non disponibile: ' + (e.message === 'NO_KEY' ? 'inserisci una chiave nelle impostazioni' : String(e.message).slice(0, 80));
  }
}

function reasons(prof, o, ex, wavg) {
  const good = [], bad = [];
  const lag = o.lag;
  if (lag == null) bad.push('Nessuna pioggia utile (oltre 12 mm) negli ultimi 30 giorni');
  else if (Math.abs(lag - prof.lagOpt) <= prof.lagSig) good.push(`Pioggia utile ${lag} giorni fa: finestra giusta (ideale circa ${Math.round(prof.lagOpt)})`);
  else if (lag < prof.lagOpt) bad.push(`Pioggia utile solo ${lag} giorni fa: ancora presto (ideale circa ${Math.round(prof.lagOpt)})`);
  else bad.push(`Pioggia utile ${lag} giorni fa: finestra in chiusura`);
  if (o.R30 >= prof.rain[0] * 2.4) good.push(`Pioggia 30 giorni ${Math.round(o.R30)} mm: sufficiente`);
  else bad.push(`Pioggia 30 giorni ${Math.round(o.R30)} mm: scarsa`);
  if (o.frostMin != null && o.frostMin < 0) bad.push(`Gelo recente (${o.frostMin.toFixed(0)} °C)`);
  if (o.tmean >= prof.tOpt[0] && o.tmean <= prof.tOpt[1]) good.push(`Temperatura media ${o.tmean.toFixed(0)} °C: ideale`);
  else bad.push(`Temperatura media ${o.tmean.toFixed(0)} °C: ${o.tmean > prof.tOpt[1] ? 'troppo calda' : 'troppo fredda'}`);
  if (wavg != null && wavg > 28) bad.push('Vento forte: asciuga il terreno');
  if (o.season < 0.5) bad.push('Fuori dal picco stagionale');
  if (ex) {
    const p = ex.parts || {};
    if (ex.nConfirm) good.push(`Hai già trovato qui (${ex.nConfirm} ${ex.nConfirm > 1 ? 'volte' : 'volta'}): zona confermata dal diario`);
    if (p.host >= 0.6) good.push(`Piante simbionti adatte${ex.trees.length ? ' (' + ex.trees.join(', ') + ')' : ''}`);
    else if (p.host < 0.3) bad.push(`Poche piante simbionti: ${ex.verified ? LC_NAME(ex.code) : 'bosco non verificato'}`);
    if (p.altF >= 0.9) good.push(`Quota ${Math.round(ex.alt)} m: nell'intervallo giusto`);
    else if (p.altF < 0.5) bad.push(`Quota ${Math.round(ex.alt)} m: fuori dall'ottimo`);
    if (p.aspF >= 0.92 && ex.asp >= 0) good.push('Esposizione favorevole');
    else if (p.aspF < 0.7) bad.push('Esposizione poco favorevole');
    if (p.slopeF < 0.6) bad.push(`Pendenza ${ex.slope}°: troppo ripida`);
    const h = state.habAt;
    if (h && h.ph) (p.phF >= 0.8 ? good : p.phF < 0.5 ? bad : []).push(`pH ${h.ph.toFixed(1).replace('.', ',')}: ${p.phF >= 0.8 ? 'adatto' : 'poco adatto alla specie'}`);
    if (ex.sp.wet) {
      if (p.tpiF >= 0.95 || (h && h.water && h.water.m != null && h.water.m <= 150)) good.push('Fondovalle o acqua vicina');
      else if (p.tpiF < 0.6) bad.push('Posizione poco adatta: non è fondovalle');
    }
  }
  return `<div class="why"><div><b>Punti di forza</b>${good.slice(0, 6).map((t) => `<p>✓ ${esc(t)}</p>`).join('') || '<p>–</p>'}</div><div><b>Criticità</b>${bad.slice(0, 6).map((t) => `<p>⚠ ${esc(t)}</p>`).join('') || '<p>–</p>'}</div></div>`;
}

function refreshView() {
  if (!state.zones) return;
  renderCard();
  renderMap();
}

function gaugeSVG(score, color) {
  const len = Math.PI * 80;
  return `<svg viewBox="0 0 200 108"><path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="rgba(255,255,255,.16)" stroke-width="16" stroke-linecap="round"/><path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="${color}" stroke-width="16" stroke-linecap="round" stroke-dasharray="${(len * score) / 100} ${len}"/></svg>`;
}

function renderCard() {
  const card = root.querySelector('#f-card');
  const prof = PROFILES[getSettings().fungiProfile] || PROFILES.autunnali;
  let series, elev, title;
  if (state.ptData) {
    series = state.ptData.series;
    elev = series.elev;
    title = state.point.name || (state.point.gps ? 'La tua posizione' : 'Punto selezionato');
  }
  if (!series) {
    card.innerHTML = `<div class="gauge-card"><div class="place">${ico('locate', 16)} In attesa del GPS…</div><p style="margin:10px 0 0;color:#c3dccb">Attendi il segnale oppure tocca un punto sulla mappa per vedere l'indice di quella zona.</p></div>`;
    return;
  }
  let o0;
  const out0 = outlook(series, prof, elev);
  const ex = exNow();
  const fin = (sc) => (ex ? Math.min(97, Math.round(probFrom(sc, ex.H) * ex.mult)) : sc);
  const out = out0.map((x) => ({ ...x, wscore: x.score, score: fin(x.score) }));
  const day = clamp(state.day, 0, out.length - 1);
  const o = out[day];
  const lv = levelOf(o.score);
  const best = out.reduce((a, b, i) => (b.score > a.score ? { score: b.score, i } : a), { score: -1, i: 0 });
  const dayName = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric' });
  let advice = '';
  if (o.score < 22 && best.score >= 45) advice = `Condizioni in miglioramento: picco previsto ${best.i === 0 ? 'oggi' : 'tra ' + best.i + ' giorni'} (${best.score}).`;
  else if (o.score >= 70) advice = 'Condizioni ottime: è il momento giusto per uscire.';
  else if (o.score >= 45) advice = 'Buone possibilità nelle zone adatte (esposizione e quota giuste).';
  else if (o.score < 22) advice = 'Poco probabile: manca pioggia utile o la temperatura è fuori range.';
  if (o.closed) advice += ` Attenzione: fuori dal periodo tipico di raccolta (da ${o.opens}). Verifica il regolamento della tua regione prima di cercare.`;
  let dday = '';
  if (best.score >= 45 && best.i > 0 && o.score < best.score - 8) dday = `Picco stimato tra ${Math.max(1, best.i - 1)} e ${best.i + 1} giorni (indice ${best.score}).`;
  else if (best.score >= 45 && best.i === 0) dday = 'Picco stimato: adesso e nei prossimi giorni.';
  else if (best.score < 45) dday = 'Nessun picco previsto nei prossimi giorni.';
  const wv = (series.w || []).slice(Math.max(0, PAST + day - 5), PAST + day).filter((v) => v != null);
  const wavg = wv.length ? wv.reduce((a, b) => a + b, 0) / wv.length : null;
  const wds = (series.wd || []).slice(Math.max(0, PAST + day - 5), PAST + day).filter((v) => v != null);
  let wdir = null;
  if (wds.length) {
    const sx = wds.reduce((a, v) => a + Math.sin((v * Math.PI) / 180), 0), cx = wds.reduce((a, v) => a + Math.cos((v * Math.PI) / 180), 0);
    wdir = (Math.atan2(sx, cx) * 180 / Math.PI + 360) % 360;
  }
  const D16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
  const wname = wdir == null ? '' : D16[Math.round(wdir / 22.5) % 16];
  const wfeel = wdir == null ? '' : wdir >= 315 || wdir < 67 ? 'secco' : wdir >= 112 && wdir < 247 ? 'umido' : '';
  const windTxt = wavg == null ? '–' : `${Math.round(wavg)} km/h ${wdir != null ? `<span class="wdir" style="transform:rotate(${Math.round(wdir + 90)}deg)">➤</span> da ${wname}` : ''} <small>${wavg > 30 ? 'terreno asciugato' : wavg > 18 ? 'asciuga un po\'' : 'calmo'}${wfeel ? ' · vento ' + wfeel : ''}</small>`;
  const place = state.point && state.point.gps ? 'Sei qui' : 'Zona';
  card.innerHTML = `<div class="gauge-card">
    <div class="place">${ico('locate', 16)} ${place}: <b style="color:#fff">${esc(title)}</b> · ${Math.round(elev)} m</div>
    <div class="gauge">${gaugeSVG(o.score, lv.color)}<div class="val"><b>${o.score}</b><span style="color:${lv.color === '#b9553a' ? '#ffb199' : '#fff'}">${lv.label}</span></div></div>
    <div style="text-align:center;font-size:.85rem;color:#c3dccb;margin-top:2px">${day === 0 ? 'Oggi' : dayName(o.date)} · ${esc(prof.short)}</div>
    ${advice ? `<div style="text-align:center;margin-top:8px;font-size:.9rem">${esc(advice)}</div>` : ''}
    ${dday ? `<div class="dday">📅 ${esc(dday)}</div>` : ''}
    ${ex ? `<div class="habbox"><div class="hb-t">Habitat qui <span>meteo ${o.wscore} · habitat ${Math.round(ex.H * 100)}%</span></div>${habRows(ex).map(([k, v]) => `<div class="hb-r"><span>${k}</span><b>${esc(v)}</b></div>`).join('')}${(() => { const n = nearNow(o.wscore); if (!n) return ''; if (n.dist > 120 && n.prob > o.score + 5) return `<div class="hb-near">🎯 Zona migliore vicina: <b>${fmtM(n.dist)} a ${D8[Math.round(n.brg / 45) % 8]}</b>, probabilità <b>${n.prob}</b> <button class="chip" id="f-goto">Mostra</button></div>`; return ex.H < 0.25 ? '<div class="hb-near">Habitat scarso qui e nei dintorni (3 km).</div>' : '<div class="hb-near">Sei già nella zona migliore dei dintorni.</div>'; })()}<div class="hb-n">${esc(ex.sp.note)}${ex.verified ? '' : ' · bosco non verificato: serve internet per i dati di copertura'}</div></div>` : ''}
    ${reasons(prof, o0 = out0[day], ex, wavg)}
    ${hasAI() && ex ? `<button class="chip" id="f-ai" style="margin-top:10px">✨ Analisi AI di questo punto</button><div id="f-aiout" class="aiout"></div>` : ''}
    <div class="stats">
      <div><span>Pioggia 14 giorni</span>${Math.round(o.R14)} mm</div>
      <div><span>Pioggia 30 giorni</span>${Math.round(o.R30)} mm</div>
      <div><span>Temp. media 7 giorni</span>${o.tmean.toFixed(1)} °C</div>
      <div><span>Gelo recente</span>${o.frostMin != null && o.frostMin < 0 ? 'sì (' + o.frostMin.toFixed(0) + ' °C)' : 'no'}</div>
      <div><span>Ultima pioggia utile</span>${o.lag != null ? o.lag + ' giorni fa' : 'nessuna'}</div>
      <div><span>Vento medio (5 giorni)</span>${windTxt}</div>
      <div><span>Stagione</span>${Math.round(o.season * 100)}%</div>
    </div>
    ${rainChart(series, prof)}
    <div class="days">${out.map((x, i) => `<div data-day="${i}" style="${i === day ? 'opacity:1' : 'opacity:.62'}"><b>${x.score}</b><i style="height:${Math.max(6, x.score * 0.6)}px;background:${levelOf(x.score).color};${i === day ? 'outline:2px solid #fff' : ''}"></i><span>${i === 0 ? 'Oggi' : new Date(x.date + 'T12:00:00').toLocaleDateString('it-IT', { weekday: 'short' })}</span></div>`).join('')}</div>
  </div>`;
  const gb = card.querySelector('#f-goto');
  if (gb) gb.onclick = () => gotoNear(nearNow(o.wscore));
  const aib = card.querySelector('#f-ai');
  if (aib) aib.onclick = () => aiAnalysis(card.querySelector('#f-aiout'), { ex, o, series, prof, title, place });
  card.querySelectorAll('[data-day]').forEach(
    (d) =>
      (d.onclick = () => {
        state.day = Number(d.dataset.day);
        renderCard();
        renderMap();
      })
  );
}

function renderMap() {
  if (!fmap || !state.zones) return;
  const prof = PROFILES[getSettings().fungiProfile] || PROFILES.autunnali;
  zoneLayer.clearLayers();
  const pts = ZONES.map((z, i) => {
    const sr = state.zones.series[i];
    const out = outlook(sr, prof, sr.elev);
    const o = out[clamp(state.day, 0, out.length - 1)];
    return { lat: z.lat, lon: z.lon, score: o.score, closed: o.closed, name: z.name, elev: sr.elev };
  });
  heat.setPoints(pts);
  hab.setInputs({ zones: pts, key: profKey(), prof, doy: dayOfYear(dateFor(state.day)) });
  const p = lastPos();
  if (p) {
    if (youMarker) fmap.removeLayer(youMarker);
    youMarker = L.marker([p.lat, p.lon], { icon: L.divIcon({ className: '', html: '<div class="you-ring"></div>', iconSize: [34, 34], iconAnchor: [17, 17] }), interactive: false, zIndexOffset: 1000 }).addTo(fmap);
  }
  const d = new Date();
  d.setDate(d.getDate() + state.day);
  root.querySelector('#f-daylabel').textContent = state.day === 0 ? '· oggi' : '· ' + d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'short' });
}

// Sfumatura continua del colore di raccolta sopra la mappa (interpolazione IDW tra le zone)
const STOPS = [[0, [185, 85, 58]], [22, [185, 85, 58]], [34, [224, 166, 58]], [45, [224, 166, 58]], [58, [127, 174, 74]], [70, [127, 174, 74]], [90, [27, 122, 74]], [100, [20, 105, 62]]];
function colorAt(v) {
  for (let i = 1; i < STOPS.length; i++) {
    if (v <= STOPS[i][0]) {
      const [a, ca] = STOPS[i - 1], [b, cb] = STOPS[i], t = b === a ? 0 : (v - a) / (b - a);
      return ca.map((c, k) => Math.round(c + (cb[k] - c) * t));
    }
  }
  return STOPS[STOPS.length - 1][1];
}
// i canvas vivono nel pannello ruotabile: si disegna in coordinate "layer" su un quadrato che copre lo schermo a qualsiasi rotazione
function frame(map) {
  const sz = map.getSize(), d = Math.ceil(Math.hypot(sz.x, sz.y));
  const ctr = map.containerPointToLayerPoint([sz.x / 2, sz.y / 2]);
  return { tl: ctr.subtract([d / 2, d / 2]).round(), d };
}
const toF = (map, f, lat, lon) => map.latLngToLayerPoint([lat, lon]).subtract(f.tl);
function placeCanvas(map, c) {
  const f = frame(map);
  L.DomUtil.setPosition(c, f.tl);
  c.width = f.d; c.height = f.d;
  c.style.width = f.d + 'px'; c.style.height = f.d + 'px';
  return f;
}
function clipItaly(x, map, f) {
  x.beginPath();
  for (const poly of ITALY) {
    for (const ring of poly) {
      for (let i = 0; i < ring.length; i += 2) {
        const q = toF(map, f, ring[i + 1], ring[i]);
        i ? x.lineTo(q.x, q.y) : x.moveTo(q.x, q.y);
      }
      x.closePath();
    }
  }
  x.clip('evenodd');
}
const HeatLayer = L.Layer.extend({
  onAdd(map) {
    this._map = map;
    this._c = L.DomUtil.create('canvas', 'heat-canvas');
    this._c.style.cssText = 'position:absolute;pointer-events:none;mix-blend-mode:multiply;opacity:.68';
    map.getPanes().tilePane.appendChild(this._c);
    this._c.style.zIndex = 250;
    map.on('moveend zoomend resize', this._draw, this);
    this._draw();
  },
  onRemove(map) {
    map.off('moveend zoomend resize', this._draw, this);
    this._c.remove();
  },
  setPoints(p) {
    this._pts = p;
    if (this._map) this._draw();
  },
  _draw() {
    const map = this._map, pts = this._pts;
    if (!map || !pts) return;
    const c = this._c, CELL = 12;
    const f = placeCanvas(map, c), D = f.d;
    const off = document.createElement('canvas');
    off.width = D; off.height = D;
    const o = off.getContext('2d');
    const P = pts.map((q) => ({ ...q, p: toF(map, f, q.lat, q.lon) }));
    for (let gy = 0; gy < D + CELL; gy += CELL) {
      for (let gx = 0; gx < D + CELL; gx += CELL) {
        let w = 0, v = 0;
        for (const q of P) {
          const wi = 1 / ((q.p.x - gx) ** 2 + (q.p.y - gy) ** 2 + 400);
          w += wi; v += wi * q.score;
        }
        const [r, g, b] = colorAt(v / w);
        o.fillStyle = `rgb(${r},${g},${b})`;
        o.fillRect(gx, gy, CELL + 1, CELL + 1);
      }
    }
    const x = c.getContext('2d');
    x.save();
    clipItaly(x, map, f);
    x.filter = 'blur(8px)';
    x.drawImage(off, -10, -10, D + 20, D + 20);
    x.restore();
  },
});
// Heatmap per pixel: meteo (IDW sulle zone) x habitat della specie (DEM, bosco, suolo). Sopra il rilievo, sotto strade e nomi.
const HabLayer = L.Layer.extend({
  onAdd(map) {
    this._map = map;
    this._c = L.DomUtil.create('canvas', 'heat-canvas');
    this._c.style.cssText = 'position:absolute;pointer-events:none;mix-blend-mode:multiply;opacity:.82';
    map.getPanes().tilePane.appendChild(this._c);
    this._c.style.zIndex = 251;
    this._on = () => (this._draw(), this._sched());
    map.on('moveend zoomend resize', this._on);
    this._sched();
  },
  onRemove(map) {
    map.off('moveend zoomend resize', this._on);
    this._c.remove();
  },
  setInputs(inp) {
    this._inp = inp;
    if (this._A) this._recompute();
    else this._sched();
  },
  refresh() {
    if (this._A) this._recompute();
  },
  _sched() {
    clearTimeout(this._t);
    this._t = setTimeout(() => this._load(), 180);
  },
  _status(t) {
    const el = root && root.querySelector('#f-hstat');
    if (el) el.innerHTML = t;
  },
  async _load() {
    const map = this._map;
    if (!map || !this._inp) return;
    const zoom = map.getZoom(), bb = map.getBounds(), b = { n: bb.getNorth(), s: bb.getSouth(), e: bb.getEast(), w: bb.getWest() };
    const A = this._A;
    if (A && Math.abs(zoom - A.zoomReq) < 0.8 && b.n <= A.T.bounds.n && b.s >= A.T.bounds.s && b.e <= A.T.bounds.e && b.w >= A.T.bounds.w) return this._draw();
    const tok = (this._tok = (this._tok || 0) + 1);
    this._status('<span class="spin"></span> Analisi habitat…');
    try {
      const nA = await analyze(b, zoom);
      if (tok !== this._tok) return;
      nA.zoomReq = zoom;
      this._A = nA;
      await this._recompute();
    } catch (e) {
      if (tok !== this._tok) return;
      console.warn('habitat', e.message);
      this._A = null;
      this._img = null;
      heat._c.style.visibility = 'visible';
      this._c.style.visibility = 'hidden';
      this._status('Habitat non disponibile (serve internet): mappa solo meteo');
    }
  },
  async _recompute() {
    const A = this._A, inp = this._inp;
    if (!A || !inp) return;
    const tok = this._tok;
    const ph = await soilField(A);
    const { H } = applyProfile(A, inp.key, ph, inp.doy);
    const W = weatherField(A, inp.zones, inp.prof, inp.doy);
    const C = confirmField(A, spotsFor(inp.key, inp.doy));
    const T = A.T, N = T.w * T.h, img = new ImageData(T.w, T.h);
    for (let k = 0; k < N; k++) {
      const sc = Math.min(97, Math.round(probFrom(W[k], H[k]) * C[k]));
      if (T.elev[k] <= 0 || sc < 6) continue;
      const [r, g, b] = colorAt(sc);
      img.data[k * 4] = r; img.data[k * 4 + 1] = g; img.data[k * 4 + 2] = b;
      img.data[k * 4 + 3] = Math.round(255 * (0.3 + 0.7 * clamp(sc / 70, 0, 1)));
    }
    if (tok !== this._tok) return;
    const c = document.createElement('canvas');
    c.width = T.w; c.height = T.h;
    c.getContext('2d').putImageData(img, 0, 0);
    this._img = c;
    heat._c.style.visibility = 'hidden';
    this._c.style.visibility = 'visible';
    this._draw();
    const soilN = ph ? 'suolo ✓' : 'suolo in apprendimento';
    this._status(`Habitat: quota ✓ · bosco ${A.src ? A.src + ' ✓' : 'non verificato'} · ${soilN}${T.z < 8 ? ' · zoom per più dettaglio' : ''}`);
    if (SPECIES[inp.key].some((s) => s.ph)) {
      const bb = this._map.getBounds();
      fillSoil({ n: bb.getNorth(), s: bb.getSouth(), e: bb.getEast(), w: bb.getWest() }, () => this.refresh());
    }
  },
  _draw() {
    const map = this._map, A = this._A;
    if (!map || !A || !this._img) return;
    const c = this._c, f = placeCanvas(map, c), x = c.getContext('2d'), bd = A.T.bounds;
    const nw = toF(map, f, bd.n, bd.w), se = toF(map, f, bd.s, bd.e);
    x.save();
    clipItaly(x, map, f);
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    x.drawImage(this._img, nw.x, nw.y, se.x - nw.x, se.y - nw.y);
    x.restore();
  },
});

// ---------- calibrazione sul diario ----------
function openCalib() {
  openPage('Calibra col diario', (pg) => {
    const n = findings().length;
    const NAMES = Object.fromEntries(Object.entries(PROFILES).map(([k, p]) => [k, p.short]));
    const cur = getSettings().fungiCal || {};
    pg.body.innerHTML = `<div style="padding:14px"><div class="infobox" style="margin:0 0 12px">Uso i tuoi ${n} ritrovamenti (porcini, galletti, ovuli, tartufi): scarico il meteo dei 36 giorni prima di ognuno e sposto i parametri del modello (giorni dalla pioggia, pioggia utile, temperatura) verso quanto hai davvero trovato. Serve internet.</div>
      <button class="btn" id="cal-go" style="width:100%" ${n ? '' : 'disabled'}>${n ? 'Calcola' : 'Nessun ritrovamento nel diario'}</button>
      ${Object.keys(cur).length ? '<button class="chip" id="cal-reset" style="margin-top:10px">Ripristina valori base</button>' : ''}
      <div id="cal-out" style="margin-top:14px"></div></div>`;
    const out = pg.body.querySelector('#cal-out');
    const rs = pg.body.querySelector('#cal-reset');
    if (rs) rs.onclick = () => { resetCal(); refreshView(); toast('Valori base ripristinati'); pg.close(); };
    pg.body.querySelector('#cal-go').onclick = async (e) => {
      e.target.disabled = true;
      let res;
      try {
        res = await calibrate((d, t) => (out.innerHTML = `<div class="progress"><i style="width:${Math.round((d / t) * 100)}%"></i></div><p class="muted">Meteo ${d}/${t}…</p>`));
      } catch (err) {
        out.innerHTML = '<div class="warnbox">Errore: ' + esc(err.message) + '</div>';
        e.target.disabled = false;
        return;
      }
      const keys = Object.keys(res.out);
      if (!keys.length) {
        out.innerHTML = `<div class="warnbox">Nessun dato utilizzabile (${res.failed} meteo non scaricati). Riprova con internet attivo.</div>`;
        e.target.disabled = false;
        return;
      }
      out.innerHTML = keys.map((k) => {
        const v = res.out[k];
        return `<div class="habbox" style="background:#eef3ec;color:#12372a"><div class="hb-t" style="color:#12372a">${esc(NAMES[k])} <span style="color:#4b5f55">${v.n} ritrovamenti</span></div>
          <div class="hb-r"><span>Indice mediano</span><b>${v.before} → ${v.after}</b></div>
          <div class="hb-r"><span>Sopra "Buona" (45)</span><b>${v.okBefore}/${v.n} → ${v.okAfter}/${v.n}</b></div>
          <div class="hb-r"><span>Giorni dalla pioggia utile</span><b>${v.lagMed != null ? v.lagMed : '–'}${v.cal.lagOpt ? ' (nuovo ottimo ' + v.cal.lagOpt + ')' : ''}</b></div>
          <div class="hb-r"><span>Pioggia 14 giorni</span><b>${v.r14[0]}-${v.r14[1]} mm</b></div>
          <div class="hb-r"><span>Pioggia 30 giorni (mediana)</span><b>${v.r30} mm</b></div>
          <div class="hb-r"><span>Temperatura media 7gg</span><b>${v.t != null ? v.t + ' °C' : '–'}</b></div>
          ${v.n < 4 ? '<div class="hb-n">Servono almeno 4 ritrovamenti per questa specie: parametri invariati.</div>' : ''}</div>`;
      }).join('') + `<button class="btn" id="cal-apply" style="width:100%;margin-top:6px">Applica</button><button class="chip" id="cal-copy" style="margin-top:10px">Copia dati</button>${res.failed ? `<p class="muted">${res.failed} ritrovamenti senza meteo (offline o storico mancante).</p>` : ''}`;
      out.querySelector('#cal-apply').onclick = () => { applyResult(res); refreshView(); toast('Calibrazione applicata'); pg.close(); };
      out.querySelector('#cal-copy').onclick = () => { try { navigator.clipboard.writeText(JSON.stringify(res.out)); toast('Copiato'); } catch { toast('Copia non riuscita'); } };
    };
  });
}
