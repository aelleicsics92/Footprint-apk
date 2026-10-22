import L from 'leaflet';
import 'leaflet-rotate';
import 'leaflet/dist/leaflet.css';
import { Fog } from '../lib/fog.js';
import { SOURCES, makeLayer, countTiles, estimateBytes, fmtMB, MAX_TILES, enqueueDownload, initQueue, getQueue } from '../lib/offline.js';
import { getSettings, setSetting, lsGet, lsSet } from '../lib/store.js';
import { bus, esc, fmtDist, fmtDur, fmtCoord, haversine, bearing, cardinal, clamp } from '../lib/util.js';
import { ico, wpIcon } from '../lib/icons.js';
import { openSheet, toast, confirmBox } from '../lib/ui.js';
import { lastPos, gpsStatus, ensurePermission, restartWatch } from '../lib/geo.js';
import { getHeading, compassAlive } from '../lib/compass.js';
import { getWaypoints, getWaypoint, openWaypoint, openNewWaypoint, quickWaypoint, saveParking } from '../lib/waypoints.js';
import { getRec, elapsed, startRecording, pauseRecording, resumeRecording, stopRecording, renameTrack, loadTrackPoints, getTracks } from '../lib/track.js';
import { getTarget, setTarget } from '../lib/state.js';
import { toGPX, shareFile, safeName } from '../lib/gpsio.js';
import { openSOS } from './sos.js';
import { fetchWx, wmo, openWeather, pressureDrop } from './weather.js';
import { sunTimes } from '../lib/sun.js';
import { notifyNow } from '../lib/notify.js';
import { getCoverage } from '../lib/coverage.js';

let map, baseLayers = {}, trailsLayer, userMarker, accCircle, wpGroup, targetLine, recLine, shownGroup;
let follow = true, firstFix = false, shownTrackName = null;
let followPts = null, offTrack = null, lastAlert = 0;
let covGroup, backtrack = false, btLast = null, btAt = 0, sunDay = '', heatGroup, exploredGroup;
let root;

export const getMap = () => map;

export function mountMap(el) {
  root = el;
  el.innerHTML = `
    <div id="map"></div>
    <div class="map-top">
      <button class="sos-btn" id="btn-sos" aria-label="Emergenza">SOS</button>
      <div class="hud" id="hud"><div class="row2"><span>In attesa del GPS…</span></div></div>
    </div>
    <button class="wx-chip" id="wx-chip" aria-label="Meteo" hidden></button>
    <button class="north-btn" id="btn-north" aria-label="Nord">
      <svg viewBox="0 0 48 48" width="44" height="44" id="north-needle"><circle cx="24" cy="24" r="22" fill="rgba(255,253,246,.94)" stroke="#12372a" stroke-width="2"/><path d="M24 7l6 17H18z" fill="#c0392b"/><path d="M24 41l-6-17h12z" fill="#33403a"/><circle cx="24" cy="24" r="2.5" fill="#fff"/><text x="24" y="6.5" text-anchor="middle" font-size="7" font-weight="700" fill="#12372a" dy="5" style="display:none">N</text></svg>
    </button>
    <div class="map-tools">
      <button class="round" id="btn-layers" aria-label="Livelli mappa">${ico('layers', 22)}</button>
      <button class="round on" id="btn-locate" aria-label="La mia posizione">${ico('locate', 22)}</button>
      <button class="round" id="btn-car" aria-label="Trova la mia auto">${ico('car', 22)}</button>
      <button class="round" id="btn-3d" aria-label="Mappa 3D" style="font-weight:800;font-size:.8rem">3D</button>
      <button class="round" id="btn-dl" aria-label="Scarica mappa offline">${ico('download', 22)}</button>
    </div>
    <div class="rec-chip hidden" id="rec-chip"></div>
    <div class="dl-chip hidden" id="dl-chip"></div>
    <div class="ov-legend hidden" id="ov-legend"></div>
    <button class="fab" id="btn-wp" aria-label="Nuovo waypoint">${ico('pinplus', 30)}</button>`;

  const s = getSettings();
  const saved = lsGet('fp.view');
  map = L.map('map', { zoomControl: false, attributionControl: true, preferCanvas: true, rotate: true, touchRotate: true, rotateControl: false, bearing: 0, worldCopyJump: false, zoomSnap: 0.5, zoomDelta: 1, maxZoom: 20, minZoom: 4 });
  map.attributionControl.setPrefix(false);
  L.control.scale({ position: 'bottomleft', imperial: false, maxWidth: 130 }).addTo(map);
  window.__fpmap = map;
  const needle = root.querySelector('#north-needle');
  const onRot = () => {
    const b = map.getBearing ? map.getBearing() : 0;
    needle.style.transform = `rotate(${-b}deg)`;
    root.querySelector('#btn-north').classList.toggle('rot', Math.abs(b) > 0.5);
    onHeading(lastHeading);
  };
  map.on('rotate', onRot);
  root.querySelector('#btn-north').onclick = () => map.setBearing(0);
  map.setView(saved ? [saved.lat, saved.lng] : [42.3, 12.6], saved ? saved.zoom : 6);
  baseLayers = { sat: makeLayer('sat'), topo: makeLayer('topo') };
  trailsLayer = makeLayer('trails', { opacity: 0.95, zIndex: 5 });
  applyLayers();
  wpGroup = L.layerGroup().addTo(map);
  shownGroup = L.layerGroup().addTo(map);
  recLine = L.polyline([], { color: '#ff5a4a', weight: 5, opacity: 0.95 }).addTo(map);
  targetLine = L.polyline([], { color: '#d28a2c', weight: 4, dashArray: '2 9', lineCap: 'round' }).addTo(map);

  let refollowT = null;
  map.on('dragstart', () => { setFollow(false); clearTimeout(refollowT); });
  map.on('dragend', () => { clearTimeout(refollowT); refollowT = setTimeout(() => { const p = lastPos(); if (p && !followPts) { setFollow(true); map.panTo([p.lat, p.lon], { animate: true }); } }, 25000); });
  map.on('moveend', () => {
    const c = map.getCenter();
    lsSet('fp.view', { lat: c.lat, lng: c.lng, zoom: map.getZoom() });
  });

  root.querySelector('#btn-layers').onclick = openLayers;
  root.querySelector('#btn-dl').onclick = openDownload;
  setupSosHold(root.querySelector('#btn-sos'));
  setupCar(root.querySelector('#btn-car'));
  root.querySelector('#btn-3d').onclick = () => { const c = map.getCenter(); import('./map3d.js').then((m) => m.openMap3D([c.lng, c.lat])); };
  setupWeatherChip(root.querySelector('#wx-chip'));
  root.querySelector('#btn-locate').onclick = () => {
    const p = lastPos();
    if (!p) return toast('GPS non ancora pronto');
    setFollow(true);
    map.setView([p.lat, p.lon], Math.max(map.getZoom(), 16), { animate: true });
  };
  const fab = root.querySelector('#btn-wp');
  let timer = null, long = false;
  fab.addEventListener('pointerdown', () => {
    long = false;
    timer = setTimeout(() => {
      long = true;
      navigator.vibrate && navigator.vibrate(40);
      quickWaypoint();
    }, 650);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((e) => fab.addEventListener(e, () => clearTimeout(timer)));
  fab.addEventListener('click', () => {
    if (!long) openNewWaypoint();
  });

  bus.on('pos', onPos);
  initQueue();
  const dlChip = root.querySelector('#dl-chip');
  bus.on('dl:update', (qq) => {
    if (!qq.length) return dlChip.classList.add('hidden');
    const r = qq.find((j) => j.status === 'running') || qq[0];
    dlChip.classList.remove('hidden');
    dlChip.textContent = `Mappe: ${Math.round(((r.done || 0) / (r.total || 1)) * 100)}%${qq.length > 1 ? ` · ${qq.length - 1} in coda` : ''}`;
  });
  bus.on('dl:done', (d) => toast(`Mappa salvata: ${d.name} (${fmtMB(d.bytes)})`, 3500));
  bus.on('dl:error', (d) => toast(d.msg, 4000));
  bus.on('gps:status', updateHud);
  root.querySelector('#hud').addEventListener('click', async () => { if (!lastPos() && ['denied', 'off'].includes(gpsStatus().state)) { await ensurePermission(); restartWatch(); } });
  bus.on('heading', onHeading);
  bus.on('wp:changed', () => { renderWaypoints(); if (map && getSettings().showHeat) drawOverlays(); });
  setTimeout(drawOverlays, 800);
  bus.on('wp:target', (id) => {
    setTarget(id);
    bus.emit('nav:tab', 'map');
    const w = getWaypoint(id);
    const p = lastPos();
    if (w && map) {
      if (p) map.fitBounds([[p.lat, p.lon], [w.lat, w.lon]], { padding: [70, 70], maxZoom: 17 });
      else map.setView([w.lat, w.lon], 16);
    }
  });
  bus.on('wp:pick', ({ lat, lon, done }) => {
    bus.emit('nav:tab', 'map');
    setFollow(false);
    map.setView([lat, lon], Math.max(map.getZoom(), 17));
    const c = map.getContainer();
    const cross = document.createElement('div');
    cross.className = 'pick-cross';
    cross.innerHTML = '<svg width="44" height="44" viewBox="0 0 44 44" fill="none" stroke="#d93025" stroke-width="3" stroke-linecap="round"><circle cx="22" cy="22" r="11"/><path d="M22 2v12M22 30v12M2 22h12M30 22h12"/></svg>';
    const bar = document.createElement('div');
    bar.className = 'pick-bar';
    bar.innerHTML = '<span>Sposta la mappa: la mira è la nuova posizione</span><button class="btn ghost" data-a="no">Annulla</button><button class="btn primary" data-a="ok">Conferma</button>';
    c.appendChild(cross); c.appendChild(bar);
    L.DomEvent.disableClickPropagation(bar);
    bar.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]');
      if (!a) return;
      const ctr = map.getCenter();
      cross.remove(); bar.remove();
      done(a.dataset.a === 'ok' ? { lat: ctr.lat, lon: ctr.lng } : null);
    });
  });
  bus.on('wp:goto', (id) => {
    const w = getWaypoint(id);
    if (w) {
      setFollow(false);
      map.setView([w.lat, w.lon], Math.max(map.getZoom(), 16));
    }
  });
  bus.on('target:changed', (id) => {
    if (!id) backtrack = false;
    renderWaypoints();
    updateTargetLine();
    updateHud();
  });
  bus.on('rec:state', renderRec);
  bus.on('rec:tick', updateRecChip);
  bus.on('rec:point', (pt) => {
    recLine.addLatLng([pt[0], pt[1]]);
    updateRecChip();
  });
  bus.on('settings:changed', () => {
    renderWaypoints();
    renderRec();
  });
  bus.on('track:show', showTrack);
  bus.on('track:follow', async ({ id, name }) => {
    const pts = await loadTrackPoints(id);
    followPts = pts.map((q) => [q[0], q[1]]);
    lastAlert = 0;
    offTrack = null;
    await showTrack({ id, name });
    toast(`Ti avviso se ti allontani oltre ${getSettings().offTrackM || 80} m dalla traccia`, 3500);
  });
  bus.on('map:fit', (b) => {
    setFollow(false);
    setTimeout(() => map.fitBounds([[b.south, b.west], [b.north, b.east]]), 100);
  });
  bus.on('nav:tab', (t) => t === 'map' && setTimeout(() => map.invalidateSize(), 60));
  renderWaypoints();
  renderRec();
  updateHud();
}

export function invalidate() {
  map && map.invalidateSize();
}

function applyLayers() {
  const s = getSettings();
  Object.entries(baseLayers).forEach(([k, l]) => (k === s.baseLayer ? l.addTo(map) : map.removeLayer(l)));
  if (s.overlayTrails) trailsLayer.addTo(map);
  else map.removeLayer(trailsLayer);
  const max = SOURCES[s.baseLayer].maxNative + 2;
  map.setMaxZoom(max);
}

function setFollow(v) {
  follow = v;
  root.querySelector('#btn-locate').classList.toggle('on', v);
}

function onPos(p) {
  const ll = [p.lat, p.lon];
  if (!userMarker) {
    userMarker = L.marker(ll, {
      icon: L.divIcon({ className: '', html: '<div class="me"><div class="cone"></div><div class="dot"></div></div>', iconSize: [34, 34], iconAnchor: [17, 17] }),
      interactive: false,
      zIndexOffset: 1000,
    }).addTo(map);
    accCircle = L.circle(ll, { radius: p.acc || 10, color: '#2f8cff', weight: 1, fillColor: '#2f8cff', fillOpacity: 0.12, interactive: false }).addTo(map);
  } else {
    userMarker.setLatLng(ll);
    accCircle.setLatLng(ll).setRadius(p.acc || 10);
  }
  if (!firstFix) {
    firstFix = true;
    if (!lsGet('fp.view') || lsGet('fp.view').zoom < 10) map.setView(ll, 16);
    else if (follow) map.setView(ll, Math.max(map.getZoom(), 15));
  } else if (follow) map.panTo(ll, { animate: true, duration: 0.4 });
  if (!compassAlive() && p.heading != null && p.speed > 1) onHeading(p.heading);
  updateTargetLine();
  checkOffTrack(p);
  checkBacktrack(p);
  checkSunset(p);
  updateHud();
}

let lastHeading = 0;
function onHeading(h) {
  if (h == null) return;
  lastHeading = h;
  const c = userMarker && userMarker.getElement() && userMarker.getElement().querySelector('.cone');
  const b = map && map.getBearing ? map.getBearing() : 0;
  if (c) c.style.transform = `rotate(${h - b}deg)`;
}

function updateHud() {
  const hud = root.querySelector('#hud');
  const p = lastPos();
  let html = p
    ? `<div class="row2"><b>${fmtCoord(p.lat, p.lon)}</b><span>${p.alt != null ? Math.round(p.alt) + ' m' : '— m'} · ±${Math.round(p.acc || 0)} m</span></div>`
    : `<div class="row2"><span style="white-space:normal;line-height:1.25">${esc(gpsStatus().msg || 'In attesa del GPS…')}</span></div>`;
  const tid = getTarget();
  const w = tid && getWaypoint(tid);
  if (w) {
    const d = p ? `${fmtDist(haversine(p, w))} · ${Math.round(bearing(p, w))}° ${cardinal(bearing(p, w))}` : '';
    html += `<div class="tgt">${ico('nav', 14)}<span>${esc(w.title)} · ${d}</span><button data-clear="target">Fine</button></div>`;
  }
  if (shownTrackName) html += `<div class="tgt">${ico('route', 14)}<span>${esc(shownTrackName)}${followPts ? (offTrack != null ? (offTrack > (getSettings().offTrackM || 80) ? ` · <b style="color:#ff8a7a">fuori traccia ${Math.round(offTrack)} m</b>` : ' · sulla traccia') : ' · in guida') : ''}</span><button data-clear="track">${followPts ? 'Ferma' : 'Nascondi'}</button></div>`;
  hud.innerHTML = html;
  hud.querySelectorAll('[data-clear]').forEach(
    (b) =>
      (b.onclick = () => {
        if (b.dataset.clear === 'target') setTarget(null);
        else {
          shownGroup.clearLayers();
          shownTrackName = null;
          followPts = null;
          offTrack = null;
          updateHud();
        }
      })
  );
}

function updateTargetLine() {
  const p = lastPos();
  const w = getTarget() && getWaypoint(getTarget());
  targetLine.setLatLngs(p && w ? [[p.lat, p.lon], [w.lat, w.lon]] : []);
}

function renderWaypoints() {
  if (!wpGroup) return;
  wpGroup.clearLayers();
  if (!getSettings().showWaypoints) return;
  const tid = getTarget();
  const fy = getSettings().wpYear, fm = Number(getSettings().wpMonth) || 0;
  for (const w of getWaypoints()) {
    if (fy || fm) {
      const d = new Date(w.ts);
      if (fy && String(d.getFullYear()) !== String(fy)) continue;
      if (fm && d.getMonth() + 1 !== fm) continue;
    }
    const ic = wpIcon(w.icon);
    const m = L.marker([w.lat, w.lon], {
      icon: L.divIcon({
        className: 'wp-marker' + (w.id === tid ? ' target' : ''),
        html: `<div class="pin" style="--c:${ic.color}"><div class="bd">${ic.svg}</div></div>`,
        iconSize: [42, 50],
        iconAnchor: [21, 48],
      }),
      zIndexOffset: 500,
    });
    m.on('click', () => openWaypoint(w));
    m.addTo(wpGroup);
  }
}

// ---------- registrazione ----------
function renderRec() {
  const chip = root.querySelector('#rec-chip');
  const r = getRec();
  const enabled = getSettings().recordTrack;
  if (r.status === 'idle') {
    recLine.setLatLngs([]);
    chip.classList.toggle('hidden', !enabled);
    chip.className = 'rec-chip' + (enabled ? '' : ' hidden');
    chip.innerHTML = `<span>Traccia ferma</span><button data-r="start" aria-label="Avvia">${ico('play', 18)}</button>`;
  } else {
    chip.className = 'rec-chip' + (r.status === 'pause' ? ' pause' : '');
    chip.innerHTML = `<span class="dot"></span><span id="rec-t"></span><button data-r="${r.status === 'pause' ? 'resume' : 'pause'}" aria-label="Pausa/riprendi">${ico(r.status === 'pause' ? 'play' : 'pause', 18)}</button><button class="stop" data-r="stop" aria-label="Stop e salva">${ico('stop', 16)}</button>`;
    updateRecChip();
  }
  chip.onclick = async (e) => {
    const b = e.target.closest('[data-r]');
    if (!b) return;
    const a = b.dataset.r;
    if (a === 'start') startRecording();
    else if (a === 'pause') pauseRecording();
    else if (a === 'resume') resumeRecording();
    else if (a === 'stop') {
      const t = await stopRecording();
      if (!t) return toast('Traccia troppo corta: non salvata');
      afterSave(t);
    }
  };
}
function updateRecChip() {
  const el = root.querySelector('#rec-t');
  const r = getRec();
  if (el) el.textContent = `${fmtDur(elapsed())} · ${fmtDist(r.dist)}`;
}
function afterSave(t) {
  const s = openSheet({
    title: 'Traccia salvata',
    body: `<div data-enter-scope>
      <div class="stat-row"><div><b>${fmtDist(t.dist)}</b><span>Distanza</span></div><div><b>${fmtDur(t.dur)}</b><span>Durata</span></div><div><b>${Math.round(t.up)} m</b><span>Salita</span></div></div>
      <label class="field"><span>Nome</span><input id="tn" type="text" value="${esc(t.name)}" maxlength="80"></label>
      <div class="row gap"><button class="btn ghost grow" id="tn-share">${ico('share', 18)} Condividi</button><button class="btn primary grow" data-primary id="tn-ok">${ico('check', 18)} Salva</button></div></div>`,
  });
  const nm = () => s.body.querySelector('#tn').value.trim() || t.name;
  s.body.querySelector('#tn-ok').onclick = async () => {
    await renameTrack(t.id, nm());
    s.close();
  };
  s.body.querySelector('#tn-share').onclick = async () => {
    const name = nm();
    await renameTrack(t.id, name);
    const pts = await loadTrackPoints(t.id);
    s.close();
    try {
      await shareFile(`${safeName(name)}.gpx`, toGPX({ tracks: [{ ...t, name, points: pts }], name }), { title: name });
    } catch {}
  };
}

async function showTrack({ id, name }) {
  const pts = await loadTrackPoints(id);
  if (!pts.length) return;
  shownGroup.clearLayers();
  const ll = pts.map((p) => [p[0], p[1]]);
  L.polyline(ll, { color: '#ffb23e', weight: 5, opacity: 0.95 }).addTo(shownGroup);
  L.circleMarker(ll[0], { radius: 7, color: '#fff', weight: 2, fillColor: '#1b7a4a', fillOpacity: 1 }).addTo(shownGroup);
  L.circleMarker(ll[ll.length - 1], { radius: 7, color: '#fff', weight: 2, fillColor: '#c0392b', fillOpacity: 1 }).addTo(shownGroup);
  shownTrackName = name;
  setFollow(false);
  bus.emit('nav:tab', 'map');
  setTimeout(() => {
    map.invalidateSize();
    map.fitBounds(L.latLngBounds(ll), { padding: [50, 50] });
  }, 80);
  updateHud();
}

// ---------- livelli ----------
function openLayers() {
  const s = getSettings();
  const sh = openSheet({
    title: 'Livelli mappa',
    body: `<div class="stack">
      <div class="seg" style="margin:0 0 4px"><button data-b="sat" class="${s.baseLayer === 'sat' ? 'sel' : ''}">Satellite</button><button data-b="topo" class="${s.baseLayer === 'topo' ? 'sel' : ''}">Topografica</button></div>
      <div class="set-row" style="padding:6px 0"><div class="ti"><b>Sentieri e percorsi CAI</b><small>Percorsi segnati, mulattiere, sentieri escursionistici</small></div><label class="switch"><input type="checkbox" id="ly-trails" ${s.overlayTrails ? 'checked' : ''}><i></i></label></div>
      <div class="set-row" style="padding:6px 0"><div class="ti"><b>Waypoint</b><small>Mostra i punti salvati</small></div><label class="switch"><input type="checkbox" id="ly-wp" ${s.showWaypoints ? 'checked' : ''}><i></i></label></div>
      <div class="set-row" style="padding:6px 0"><div class="ti"><b>Mappa di calore</b><small>Aree verdi dove hai più ritrovamenti</small></div><label class="switch"><input type="checkbox" id="ly-heat" ${s.showHeat ? 'checked' : ''}><i></i></label></div>
      <div class="set-row" style="padding:6px 0"><div class="ti"><b>Zone senza campo dati</b><small>Puntini rossi dove eri senza internet (stima, non misura il segnale voce)</small></div><label class="switch"><input type="checkbox" id="ly-cov" ${s.showNoSignal ? 'checked' : ''}><i></i></label></div>
      <div class="set-row" style="padding:6px 0"><div class="ti"><b>Zone battute oggi</b><small>Leggera nebbia su tutta la mappa che si dissolve entro 6 m da dove sei passato nelle ultime 24 ore</small></div><label class="switch"><input type="checkbox" id="ly-fog" ${s.showExplored ? 'checked' : ''}><i></i></label></div>
      <div><b style="font-size:.95rem">Ritrovamenti per periodo</b><small class="muted" style="display:block;margin-bottom:6px">Mostra solo i waypoint di un anno o mese (es. dove hai trovato porcini a ottobre)</small>
        <div class="row gap"><select id="ly-year" class="grow" onfocus="this.select&&this.select()">${yearOpts(s.wpYear)}</select><select id="ly-month" class="grow" onfocus="this.select&&this.select()">${monthOpts(s.wpMonth)}</select></div></div>
    </div>`,
  });
  sh.body.querySelectorAll('[data-b]').forEach(
    (b) =>
      (b.onclick = () => {
        setSetting('baseLayer', b.dataset.b);
        sh.body.querySelectorAll('[data-b]').forEach((x) => x.classList.toggle('sel', x === b));
        applyLayers();
      })
  );
  sh.body.querySelector('#ly-trails').onchange = (e) => {
    setSetting('overlayTrails', e.target.checked);
    applyLayers();
  };
  const filt = () => {
    setSetting('wpYear', sh.body.querySelector('#ly-year').value);
    setSetting('wpMonth', Number(sh.body.querySelector('#ly-month').value) || 0);
    renderWaypoints();
  };
  sh.body.querySelector('#ly-cov').onchange = (e) => { setSetting('showNoSignal', e.target.checked); drawOverlays(); };
  sh.body.querySelector('#ly-heat').onchange = (e) => { setSetting('showHeat', e.target.checked); drawOverlays(); };
  sh.body.querySelector('#ly-fog').onchange = (e) => { setSetting('showExplored', e.target.checked); drawOverlays(); };
  sh.body.querySelector('#ly-year').onchange = filt;
  sh.body.querySelector('#ly-month').onchange = filt;
  sh.body.querySelector('#ly-wp').onchange = (e) => {
    setSetting('showWaypoints', e.target.checked);
    renderWaypoints();
  };
}

// ---------- download offline ----------
function openDownload() {
  const b = map.getBounds();
  const bounds = { north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() };
  const cur = Math.round(map.getZoom());
  const s = getSettings();
  const now = new Date();
  const defName = `Area ${now.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })} ${now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;
  const sh = openSheet({
    title: 'Scarica mappa offline',
    full: true,
    body: `<div data-enter-scope>
      <p class="muted" style="margin:0 0 4px">L'area visibile viene messa in coda e scaricata in background. Puoi inquadrare altre zone e aggiungerle: si scaricano una dopo l'altra.</p>
      <label class="field"><span>Nome area</span><input id="dl-name" type="text" value="${esc(defName)}" maxlength="60"></label>
      <label class="field"><span>Dettaglio massimo: zoom <b id="dl-zl"></b></span><input id="dl-z" type="range" min="12" max="17" value="${clamp(cur + 1, 13, 17)}" style="width:100%"></label>
      <div class="chips" style="padding:0 0 8px">
        <button class="chip ${s.baseLayer === 'sat' ? 'sel' : ''}" data-s="sat">Satellite</button>
        <button class="chip ${s.baseLayer === 'topo' ? 'sel' : ''}" data-s="topo">Topografica</button>
        <button class="chip ${s.overlayTrails ? 'sel' : ''}" data-s="trails">Sentieri</button>
      </div>
      <div class="infobox" id="dl-info"></div>
            <button class="btn primary big" data-primary id="dl-go">${ico('download', 20)} Aggiungi alla coda</button>
    </div>`,
  });
  const q = (x) => sh.body.querySelector(x);
  const srcSel = () => [...sh.body.querySelectorAll('[data-s].sel')].map((x) => x.dataset.s);
  const zmin = () => Math.max(6, Math.min(Number(q('#dl-z').value), cur - 3));
  const upd = () => {
    const zmax = Number(q('#dl-z').value);
    q('#dl-zl').textContent = zmax;
    const srcs = srcSel();
    const per = countTiles(bounds, zmin(), zmax);
    const total = per * srcs.length;
    const mb = estimateBytes(per, srcs);
    const big = total > MAX_TILES;
    q('#dl-info').className = big ? 'warnbox' : 'infobox';
    q('#dl-info').innerHTML = big
      ? `Area troppo grande (${total.toLocaleString('it-IT')} tile). Avvicina la mappa o riduci il dettaglio.`
      : `<b>${total.toLocaleString('it-IT')}</b> tile · circa <b>${fmtMB(mb)}</b> · zoom ${zmin()}–${zmax}`;
    q('#dl-go').disabled = big || !srcs.length;
  };
  sh.body.querySelectorAll('[data-s]').forEach((c) => (c.onclick = () => (c.classList.toggle('sel'), upd())));
  q('#dl-z').oninput = upd;
  upd();
  q('#dl-go').onclick = async () => {
    try {
      await enqueueDownload({ name: q('#dl-name').value.trim() || defName, bounds, zmin: zmin(), zmax: Number(q('#dl-z').value), sources: srcSel() });
      toast(`In coda (${getQueue().length}). Scarico in background: puoi aggiungere altre aree.`, 3500);
    } catch (e) {
      toast(e.message || 'Impossibile aggiungere', 4000);
    }
    sh.close();
  };
}

const MONTHS = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
function yearOpts(cur) {
  const ys = [...new Set(getWaypoints().map((w) => new Date(w.ts).getFullYear()))].sort((a, b) => b - a);
  return `<option value="">Tutti gli anni</option>` + ys.map((y) => `<option value="${y}" ${String(cur) === String(y) ? 'selected' : ''}>${y}</option>`).join('');
}
function monthOpts(cur) {
  return `<option value="0">Tutti i mesi</option>` + MONTHS.map((m, i) => `<option value="${i + 1}" ${Number(cur) === i + 1 ? 'selected' : ''}>${m}</option>`).join('');
}

// ---------- SOS: pressione lunga per evitare tocchi accidentali ----------
function setupSosHold(btn) {
  let t = null, fired = false;
  const stop = () => {
    clearTimeout(t);
    btn.classList.remove('holding');
  };
  btn.addEventListener('pointerdown', () => {
    fired = false;
    btn.classList.add('holding');
    t = setTimeout(() => {
      fired = true;
      stop();
      navigator.vibrate && navigator.vibrate([70, 40, 70]);
      openSOS();
    }, 2000);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((e) => btn.addEventListener(e, stop));
  btn.addEventListener('click', () => {
    if (!fired) toast('Tieni premuto per 2 secondi per attivare l\'SOS', 2200);
  });
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
}

// ---------- Trova la mia auto ----------
function setupCar(btn) {
  let t = null, long = false;
  btn.addEventListener('pointerdown', () => {
    long = false;
    t = setTimeout(async () => {
      long = true;
      await saveParking();
    }, 700);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((e) => btn.addEventListener(e, () => clearTimeout(t)));
  btn.addEventListener('click', async () => {
    if (long) return;
    const ps = getWaypoints().filter((w) => w.icon === 'parcheggio').sort((a, b) => b.ts - a.ts);
    if (!ps.length) {
      if (await confirmBox('Nessun parcheggio salvato. Salvo la <b>posizione attuale come auto parcheggiata</b>? Poi un tocco su questo pulsante ti guida fino all\'auto.', { ok: 'Salva qui' })) await saveParking();
      return;
    }
    toast(`Ti guido a: ${ps[0].title} (tieni premuto per salvare un nuovo parcheggio)`, 3200);
    bus.emit('wp:target', ps[0].id);
    backtrack = true;
    btLast = null;
    toast('Modalità rientro: vibrazione breve = direzione giusta, doppia = ti allontani', 4500);
  });
}

// ---------- avviso fuori traccia ----------
function distToPolyline(p, pts) {
  const k = Math.cos((p.lat * Math.PI) / 180) * 111320, m = 110540;
  const px = p.lon * k, py = p.lat * m;
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][1] * k, ay = pts[i][0] * m, bx = pts[i + 1][1] * k, by = pts[i + 1][0] * m;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
    best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
  }
  return best;
}
function checkOffTrack(p) {
  if (!followPts || followPts.length < 2) return;
  offTrack = distToPolyline(p, followPts);
  const thr = getSettings().offTrackM || 80;
  if (offTrack > thr && Date.now() - lastAlert > 30000) {
    lastAlert = Date.now();
    navigator.vibrate && navigator.vibrate([300, 150, 300, 150, 300]);
    toast(`Fuori traccia di ${Math.round(offTrack)} m`, 3500);
  }
}

// ---------- meteo al volo ----------
function setupWeatherChip(chip) {
  let open = lsGet('fp.wxopen', false), data = lsGet('fp.wxchip'), fetching = false;
  const paint = () => {
    if (!data || !data.current || data.current.temperature_2m == null) return (chip.hidden = true);
    chip.hidden = false;
    const c = data.current;
    const [em] = wmo(c.weather_code);
    chip.classList.toggle('open', !!open);
    chip.innerHTML = open
      ? `<span class="wx-main">${em} <b>${Math.round(c.temperature_2m)}°</b></span><span class="wx-more">Vento ${Math.round(c.wind_speed_10m)} km/h · Umidità ${c.relative_humidity_2m}%<br>Percepita ${Math.round(c.apparent_temperature)}° · Pioggia ${c.precipitation} mm</span><span class="wx-link" data-wx="open">Dettagli ›</span>`
      : `<span class="wx-main">${em} <b>${Math.round(c.temperature_2m)}°</b> <small>${Math.round(c.wind_speed_10m)} km/h</small>${data.drop >= 3 ? ' ⚠' : ''}</span>`;
  };
  const load = async () => {
    const p = lastPos();
    if (!p || fetching || !navigator.onLine) return;
    if (data && Date.now() - data.t < 15 * 60000) return;
    fetching = true;
    try {
      const d = await fetchWx(p.lat, p.lon);
      data = { t: Date.now(), current: d.current, drop: pressureDrop(d) };
      if (data.drop >= 3 && lsGet('fp.pdrop') !== new Date().toDateString()) {
        lsSet('fp.pdrop', new Date().toDateString());
        navigator.vibrate && navigator.vibrate([200, 100, 200]);
        const m = 'Pressione in rapido calo: possibile temporale o cambio meteo nelle prossime ore.';
        toast(m, 5000);
        notifyNow('Meteo in peggioramento', m);
      }
      lsSet('fp.wxchip', data);
      paint();
    } catch {}
    fetching = false;
  };
  chip.addEventListener('click', (e) => {
    if (e.target.closest('[data-wx]')) return openWeather();
    open = !open;
    lsSet('fp.wxopen', open);
    paint();
  });
  bus.on('pos', load);
  setInterval(load, 5 * 60000);
  paint();
}

// ---------- rientro con vibrazione ----------
function checkBacktrack(p) {
  if (!backtrack || Date.now() - btAt < 12000) return;
  const t = getTarget() && getWaypoint(getTarget());
  if (!t) return;
  const d = haversine(p, t);
  btAt = Date.now();
  if (d < 25) {
    backtrack = false;
    navigator.vibrate && navigator.vibrate([200, 100, 200, 100, 400]);
    return toast('Sei arrivato all\'auto');
  }
  if (btLast != null) navigator.vibrate && navigator.vibrate(btLast - d > 3 ? 70 : [90, 70, 90]);
  btLast = d;
}

// ---------- avviso tramonto ----------
function checkSunset(p) {
  const s = getSettings();
  if (!s.sunsetAlert) return;
  const day = new Date().toDateString();
  if (sunDay === day) return;
  const st = sunTimes(new Date(), p.lat, p.lon);
  if (!st) return;
  const mins = (st.sunset.getTime() - Date.now()) / 60000;
  if (mins > 45 || mins < 0) return;
  sunDay = day;
  const car = getWaypoints().filter((w) => w.icon === 'parcheggio').sort((a, b) => b.ts - a.ts)[0];
  const dist = car ? ` e sei a ${fmtDist(haversine(p, car))} dall'auto` : '';
  const msg = `Mancano ${Math.round(mins)} minuti al tramonto${dist}. È il momento di iniziare il rientro.`;
  navigator.vibrate && navigator.vibrate([250, 120, 250]);
  toast(msg, 6000);
  notifyNow('Tramonto vicino', msg);
}

// ---------- heatmap personale, zone senza campo e foschia delle zone battute ----------
let fog = null;
function drawOverlays() {
  const s = getSettings();
  if (!heatGroup) {
    heatGroup = L.layerGroup();
    covGroup = L.layerGroup();
  }
  if (!fog) {
    fog = new Fog(map);
    bus.on('walked:changed', () => fog.on && fog.schedule());
    bus.on('rec:point', () => fog.on && fog.schedule());
    bus.on('tracks:changed', () => fog.on && fog.reload());
    bus.on('pos', () => fog.on && fog.schedule());
  }
  heatGroup.clearLayers();
  covGroup.clearLayers();
  map.removeLayer(covGroup);
  map.removeLayer(heatGroup);
  if (s.showNoSignal) {
    getCoverage().then((pts) => {
      pts.filter((q) => !q[2]).forEach((q) => L.circle([q[0], q[1]], { radius: 22, stroke: false, fillColor: '#d93025', fillOpacity: 0.55, interactive: false }).addTo(covGroup));
      covGroup.addTo(map);
    });
  }
  if (s.showHeat) {
    for (const w of getWaypoints()) {
      if (['parcheggio', 'acqua', 'pericolo', 'panorama'].includes(w.icon)) continue;
      L.circle([w.lat, w.lon], { radius: 45, stroke: false, fillColor: '#1fa34a', fillOpacity: 0.22, interactive: false }).addTo(heatGroup);
    }
    heatGroup.addTo(map);
  }
  fog.setActive(!!s.showExplored);
  const lg = root.querySelector('#ov-legend');
  const rows = [];
  if (s.showHeat) rows.push('<span><i style="background:#1fa34a"></i>Ritrovamenti (più verde = più punti)</span>');
  if (s.showNoSignal) rows.push('<span><i style="background:#d93025"></i>Senza campo dati</span>');
  if (s.showExplored) rows.push('<span><i style="background:#c9d3d6"></i>Nebbia = non ancora battuto oggi</span>');
  lg.innerHTML = rows.join('');
  lg.classList.toggle('hidden', !rows.length);
}
bus.on('cov:changed', () => { if (map && getSettings().showNoSignal) drawOverlays(); });
