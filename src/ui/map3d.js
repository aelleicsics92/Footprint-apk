// Mappa 3D: rilievo reale (DEM Terrarium), ombreggiatura, pendenza colorata, posizione e waypoint
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { openPage, toast } from '../lib/ui.js';
import { bus } from '../lib/util.js';
import { lastPos } from '../lib/geo.js';
import { getWaypoints, openWaypoint } from '../lib/waypoints.js';
import { getRec } from '../lib/track.js';
import { wpIcon } from '../lib/icons.js';

const DEM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
let protoDone = false;

// Tile di pendenza calcolati dal DEM: colori in stile carta pendenze (valanghe)
function registerSlope() {
  if (protoDone) return;
  protoDone = true;
  maplibregl.addProtocol('slope', async (params) => {
    const [z, x, y] = params.url.replace('slope://', '').split('/').map(Number);
    const url = DEM.replace('{z}', z).replace('{x}', x).replace('{y}', y);
    const r = await fetch(url);
    const bmp = await createImageBitmap(await r.blob());
    const N = 256;
    const cv = new OffscreenCanvas(N, N);
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0, N, N);
    const d = g.getImageData(0, 0, N, N).data;
    const el = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) el[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
    const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / 2 ** z)));
    const mpp = (40075016.686 * Math.cos(lat)) / (N * 2 ** z);
    const out = g.createImageData(N, N);
    for (let j = 1; j < N - 1; j++) {
      for (let i = 1; i < N - 1; i++) {
        const dx = (el[j * N + i + 1] - el[j * N + i - 1]) / (2 * mpp);
        const dy = (el[(j + 1) * N + i] - el[(j - 1) * N + i]) / (2 * mpp);
        const deg = (Math.atan(Math.hypot(dx, dy)) * 180) / Math.PI;
        const o = (j * N + i) * 4;
        let c = null;
        if (deg >= 40) c = [120, 30, 150];
        else if (deg >= 35) c = [215, 40, 40];
        else if (deg >= 30) c = [245, 130, 30];
        else if (deg >= 25) c = [250, 215, 50];
        else if (deg >= 15) c = [120, 200, 90];
        if (c) (out.data[o] = c[0]), (out.data[o + 1] = c[1]), (out.data[o + 2] = c[2]), (out.data[o + 3] = deg >= 15 ? 150 : 0);
      }
    }
    g.putImageData(out, 0, 0);
    const blob = await cv.convertToBlob({ type: 'image/png' });
    return { data: await blob.arrayBuffer() };
  });
}

export function openMap3D(center) {
  registerSlope();
  openPage('Mappa 3D', (pg) => {
    pg.body.style.cssText = 'padding:0;position:relative';
    pg.body.innerHTML = `<div id="m3d" style="position:absolute;inset:0"></div>
      <div class="m3d-bar">
        <button class="chip sel" data-t="slope">Pendenza</button>
        <button class="chip" data-t="sat">Satellite</button>
        <button class="chip" data-t="ex">Rilievo x2</button>
        <button class="chip" data-t="me">Io</button>
      </div>
      <div class="m3d-leg"><i style="background:#78c85a"></i>15°<i style="background:#fad732"></i>25°<i style="background:#f5821e"></i>30°<i style="background:#d72828"></i>35°<i style="background:#781e96"></i>40°+</div>
      <div class="m3d-info" id="m3d-info">Tocca il rilievo per quota e pendenza. Due dita per inclinare e ruotare.</div>`;
    const me = lastPos();
    const c = center || (me ? [me.lon, me.lat] : [12.5, 42]);
    let sat = false, ex = 1.4, slopeOn = true;
    const map = new maplibregl.Map({
      container: pg.body.querySelector('#m3d'),
      center: c,
      zoom: 13.2,
      pitch: 62,
      maxPitch: 80,
      attributionControl: { compact: true },
      style: {
        version: 8,
        sources: {
          topo: { type: 'raster', tiles: ['a', 'b', 'c'].map((s) => `https://${s}.tile.opentopomap.org/{z}/{x}/{y}.png`), tileSize: 256, maxzoom: 17, attribution: '© OpenStreetMap, SRTM | © OpenTopoMap' },
          sat: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 18, attribution: 'Immagini © Esri' },
          dem: { type: 'raster-dem', tiles: [DEM], encoding: 'terrarium', tileSize: 256, maxzoom: 14, attribution: 'DEM: Mapzen/AWS Terrain Tiles' },
          slope: { type: 'raster', tiles: ['slope://{z}/{x}/{y}'], tileSize: 256, maxzoom: 14 },
        },
        layers: [
          { id: 'topo', type: 'raster', source: 'topo' },
          { id: 'sat', type: 'raster', source: 'sat', layout: { visibility: 'none' } },
          { id: 'hill', type: 'hillshade', source: 'dem', paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': '#1c2a20' } },
          { id: 'slope', type: 'raster', source: 'slope', paint: { 'raster-opacity': 0.7 } },
          { id: 'rec', type: 'line', source: 'rec', paint: { 'line-color': '#e0381e', 'line-width': 4 } },
        ].filter((l) => l.id !== 'rec'),
        terrain: { source: 'dem', exaggeration: ex },
      },
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showZoom: false }), 'top-right');
    const markers = [];
    const drawWp = () => {
      markers.splice(0).forEach((m) => m.remove());
      getWaypoints().forEach((w) => {
        const e = document.createElement('div');
        e.style.cssText = 'width:30px;height:30px;border-radius:9px;overflow:hidden;box-shadow:0 2px 6px #0007;border:2px solid #fff;background:#fff';
        e.innerHTML = wpIcon(w.icon).svg;
        e.onclick = (ev) => (ev.stopPropagation(), openWaypoint(w));
        markers.push(new maplibregl.Marker({ element: e }).setLngLat([w.lon, w.lat]).addTo(map));
      });
    };
    const dot = document.createElement('div');
    dot.style.cssText = 'width:18px;height:18px;border-radius:50%;background:#1a73e8;border:3px solid #fff;box-shadow:0 0 0 4px #1a73e855';
    const meMarker = new maplibregl.Marker({ element: dot });
    if (me) meMarker.setLngLat([me.lon, me.lat]).addTo(map);
    const offPos = bus.on('pos', (p) => meMarker.setLngLat([p.lon, p.lat]).addTo(map));
    map.on('load', () => {
      map.addSource('rec', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } } });
      map.addLayer({ id: 'rec', type: 'line', source: 'rec', paint: { 'line-color': '#e0381e', 'line-width': 4 } });
      const upd = () => {
        const pts = getRec().points || [];
        map.getSource('rec').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: pts.map((p) => [p.lon, p.lat]) } });
      };
      upd();
      pg.recT = setInterval(upd, 4000);
      drawWp();
    });
    const info = pg.body.querySelector('#m3d-info');
    map.on('click', (e) => {
      try {
        const z = map.queryTerrainElevation(e.lngLat);
        const d = 20, k = 111320;
        const zx = map.queryTerrainElevation({ lng: e.lngLat.lng + d / (k * Math.cos((e.lngLat.lat * Math.PI) / 180)), lat: e.lngLat.lat });
        const zy = map.queryTerrainElevation({ lng: e.lngLat.lng, lat: e.lngLat.lat + d / k });
        const deg = Math.round((Math.atan(Math.hypot((zx - z) / d, (zy - z) / d)) * 180) / Math.PI);
        info.textContent = `Quota ${Math.round(z)} m · pendenza ${deg}°`;
      } catch {
        info.textContent = 'Quota non disponibile';
      }
    });
    pg.body.querySelector('.m3d-bar').addEventListener('click', (e) => {
      const b = e.target.closest('[data-t]');
      if (!b) return;
      const t = b.dataset.t;
      if (t === 'slope') (slopeOn = !slopeOn), map.setLayoutProperty('slope', 'visibility', slopeOn ? 'visible' : 'none'), b.classList.toggle('sel', slopeOn);
      if (t === 'sat') (sat = !sat), map.setLayoutProperty('sat', 'visibility', sat ? 'visible' : 'none'), map.setLayoutProperty('topo', 'visibility', sat ? 'none' : 'visible'), b.classList.toggle('sel', sat);
      if (t === 'ex') (ex = ex > 1.5 ? 1.4 : 2.6), map.setTerrain({ source: 'dem', exaggeration: ex }), (b.textContent = ex > 1.5 ? 'Rilievo x2' : 'Rilievo x1'), b.classList.toggle('sel', ex > 1.5);
      if (t === 'me') {
        const p = lastPos();
        if (p) map.easeTo({ center: [p.lon, p.lat], zoom: 14, duration: 800 });
        else toast('GPS non ancora pronto');
      }
    });
    pg.onClose = () => {
      offPos && offPos();
      clearInterval(pg.recT);
      map.remove();
    };
  });
}
