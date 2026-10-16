import L from 'leaflet';
import { getSettings, setSetting } from '../lib/store.js';
import { bus, esc, clamp } from '../lib/util.js';
import { ico } from '../lib/icons.js';
import { toast } from '../lib/ui.js';
import { lastPos } from '../lib/geo.js';
import { PROFILES, LEVELS, levelOf, ZONES, getZoneSeries, getPointSeries, outlook, nearestZone } from '../lib/fungi.js';
import { placeName } from './weather.js';

let root, fmap, zoneLayer, youMarker, selMarker;
let state = { day: 0, point: null, ptData: null, zones: null, loading: false };
let nameCache = {};

export function mountFungi(el) {
  root = el;
  el.innerHTML = `
    <div class="sec-title">Previsione funghi</div>
    <div class="chips" id="f-prof"></div>
    <div id="f-card"></div>
    <div class="sec-title" style="font-size:1.15rem;padding-top:10px">Italia <span class="muted" id="f-daylabel" style="font-size:.85rem;font-family:var(--sans)"></span></div>
    <div id="fungi-map"></div>
    <div class="legend">${LEVELS.map((l) => `<span><i style="background:${l.color}"></i>${l.label}</span>`).join('')}</div>
    <div class="infobox" style="margin:0 14px 18px">Indice stimato da pioggia degli ultimi 30 giorni, tempi dalla pioggia utile, temperature, gelo, bilancio idrico e stagionalità (corretta per quota). Tocca la mappa per un punto qualsiasi, tocca un giorno per vedere la previsione. È una stima: la presenza reale dipende dal bosco.</div>`;
  renderProfiles();
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

function renderProfiles() {
  const cur = getSettings().fungiProfile;
  root.querySelector('#f-prof').innerHTML =
    Object.entries(PROFILES)
      .map(([k, p]) => `<button class="chip ${k === cur ? 'sel' : ''}" data-p="${k}">${ico(k === 'tartufi' ? 'target' : 'mushroom', 16)} ${p.label}</button>`)
      .join('') + `<button class="chip" id="f-refresh">${ico('locate', 16)} Aggiorna</button>`;
  root.querySelectorAll('[data-p]').forEach(
    (b) =>
      (b.onclick = () => {
        setSetting('fungiProfile', b.dataset.p);
        renderProfiles();
        refreshView();
      })
  );
  root.querySelector('#f-refresh').onclick = () => load(true);
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
  fmap = L.map(root.querySelector('#fungi-map'), { zoomControl: false, attributionControl: true, minZoom: 5, maxZoom: 10 });
  fmap.attributionControl.setPrefix(false);
  L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', { attribution: 'Esri, HERE, Garmin', maxZoom: 10, maxNativeZoom: 10 }).addTo(fmap);
  fmap.fitBounds([[36.4, 6.6], [47.2, 18.8]]);
  zoneLayer = L.layerGroup().addTo(fmap);
  fmap.on('click', async (e) => {
    state.point = { lat: e.latlng.lat, lon: e.latlng.lng, name: 'Punto selezionato' };
    if (selMarker) fmap.removeLayer(selMarker);
    selMarker = L.circleMarker(e.latlng, { radius: 9, color: '#fff', weight: 3, fillColor: '#12372a', fillOpacity: 1 }).addTo(fmap);
    await loadPoint();
    renderCard();
  });
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
  if (pt.gps && !pt.name) {
    const k = `${pt.lat.toFixed(2)},${pt.lon.toFixed(2)}`;
    pt.name = nameCache[k] || (nameCache[k] = await placeName(pt.lat, pt.lon));
  }
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
  const prof = PROFILES[getSettings().fungiProfile];
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
  const out = outlook(series, prof, elev);
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
  const place = state.point && state.point.gps ? 'Sei qui' : 'Zona';
  card.innerHTML = `<div class="gauge-card">
    <div class="place">${ico('locate', 16)} ${place}: <b style="color:#fff">${esc(title)}</b> · ${Math.round(elev)} m</div>
    <div class="gauge">${gaugeSVG(o.score, lv.color)}<div class="val"><b>${o.score}</b><span style="color:${lv.color === '#b9553a' ? '#ffb199' : '#fff'}">${lv.label}</span></div></div>
    <div style="text-align:center;font-size:.85rem;color:#c3dccb;margin-top:2px">${day === 0 ? 'Oggi' : dayName(o.date)} · ${esc(prof.short)}</div>
    ${advice ? `<div style="text-align:center;margin-top:8px;font-size:.9rem">${esc(advice)}</div>` : ''}
    <div class="stats">
      <div><span>Pioggia 14 giorni</span>${Math.round(o.R14)} mm</div>
      <div><span>Pioggia 30 giorni</span>${Math.round(o.R30)} mm</div>
      <div><span>Temp. media 7 giorni</span>${o.tmean.toFixed(1)} °C</div>
      <div><span>Gelo recente</span>${o.frostMin != null && o.frostMin < 0 ? 'sì (' + o.frostMin.toFixed(0) + ' °C)' : 'no'}</div>
      <div><span>Ultima pioggia utile</span>${o.lag != null ? o.lag + ' giorni fa' : 'nessuna'}</div>
      <div><span>Stagione</span>${Math.round(o.season * 100)}%</div>
    </div>
    <div class="days">${out.map((x, i) => `<div data-day="${i}" style="${i === day ? 'opacity:1' : 'opacity:.62'}"><b>${x.score}</b><i style="height:${Math.max(6, x.score * 0.6)}px;background:${levelOf(x.score).color};${i === day ? 'outline:2px solid #fff' : ''}"></i><span>${i === 0 ? 'Oggi' : new Date(x.date + 'T12:00:00').toLocaleDateString('it-IT', { weekday: 'short' })}</span></div>`).join('')}</div>
  </div>`;
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
  const prof = PROFILES[getSettings().fungiProfile];
  zoneLayer.clearLayers();
  ZONES.forEach((z, i) => {
    const s = state.zones.series[i];
    const out = outlook(s, prof, s.elev);
    const o = out[clamp(state.day, 0, out.length - 1)];
    const lv = levelOf(o.score);
    const m = L.circleMarker([z.lat, z.lon], { radius: 11, color: '#fff', weight: 2, fillColor: lv.color, fillOpacity: 0.92 });
    m.bindTooltip(`<b>${esc(z.name)}</b><br>${lv.label} · ${o.score}`, { direction: 'top' });
    m.on('click', async (e) => {
      L.DomEvent.stopPropagation(e);
      state.point = { lat: z.lat, lon: z.lon, name: z.name };
      await loadPoint();
      renderCard();
      root.scrollTo && root.scrollTo({ top: 0, behavior: 'smooth' });
    });
    m.addTo(zoneLayer);
  });
  const p = lastPos();
  if (p) {
    if (youMarker) fmap.removeLayer(youMarker);
    youMarker = L.marker([p.lat, p.lon], { icon: L.divIcon({ className: '', html: '<div class="you-ring"></div>', iconSize: [34, 34], iconAnchor: [17, 17] }), interactive: false, zIndexOffset: 1000 }).addTo(fmap);
  }
  const d = new Date();
  d.setDate(d.getDate() + state.day);
  root.querySelector('#f-daylabel').textContent = state.day === 0 ? '· oggi' : '· ' + d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'short' });
}
