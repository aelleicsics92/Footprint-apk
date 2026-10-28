// Strade, acque, confini e nomi come VETTORI (OpenFreeMap / OpenStreetMap) sopra la heatmap, sincronizzati con la mappa Leaflet
// (zoom, spostamento e rotazione a due dita). Testo nitido a qualsiasi zoom, più paesi con lo zoom, niente serif.
const OFM = 'https://tiles.openfreemap.org';

async function baseStyle() {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(OFM + '/styles/positron', { signal: ctl.signal });
    clearTimeout(t);
    const j = await r.json();
    const key = Object.keys(j.sources || {}).find((k) => j.sources[k].type === 'vector');
    if (key && j.glyphs) return { key, sources: { [key]: j.sources[key] }, glyphs: j.glyphs };
  } catch {}
  return { key: 'ofm', sources: { ofm: { type: 'vector', url: OFM + '/planet' } }, glyphs: OFM + '/fonts/{fontstack}/{range}.pbf' };
}

const NM = ['coalesce', ['get', 'name:it'], ['get', 'name']];
const HALO = { 'text-halo-color': '#fffdf5', 'text-halo-width': 2, 'text-halo-blur': 0.4 };
// gli zoom qui sono quelli MapLibre (= zoom Leaflet - 1)
function layers(S) {
  const road = (id, classes, color, w, minzoom, cw) => [
    { id: id + '-c', type: 'line', source: S, 'source-layer': 'transportation', minzoom, filter: ['all', ['in', ['get', 'class'], ['literal', classes]], ['!=', ['get', 'brunnel'], 'tunnel']], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-opacity': 0.9, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, cw * 0.5, 10, cw, 14, cw * 2.2] } },
    { id: id, type: 'line', source: S, 'source-layer': 'transportation', minzoom, filter: ['all', ['in', ['get', 'class'], ['literal', classes]], ['!=', ['get', 'brunnel'], 'tunnel']], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': color, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, w * 0.5, 10, w, 14, w * 2.2] } },
  ];
  const place = (id, cls, minzoom, size, upper = true) => ({
    id, type: 'symbol', source: S, 'source-layer': 'place', minzoom, filter: ['in', ['get', 'class'], ['literal', cls]],
    layout: { 'text-field': NM, 'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 3, size[0], 12, size[1]], 'text-transform': upper ? 'uppercase' : 'none', 'text-letter-spacing': upper ? 0.05 : 0, 'text-max-width': 8, 'symbol-sort-key': ['coalesce', ['get', 'rank'], 99], 'text-padding': 3 },
    paint: { 'text-color': '#1b2a22', ...HALO },
  });
  return [
    { id: 'water', type: 'fill', source: S, 'source-layer': 'water', paint: { 'fill-color': '#b9d6ec', 'fill-opacity': 0.96 } },
    { id: 'rivers', type: 'line', source: S, 'source-layer': 'waterway', minzoom: 5, filter: ['in', ['get', 'class'], ['literal', ['river', 'canal']]], paint: { 'line-color': '#7fb0d6', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.6, 12, 2.2] } },
    { id: 'streams', type: 'line', source: S, 'source-layer': 'waterway', minzoom: 9, filter: ['in', ['get', 'class'], ['literal', ['stream', 'ditch']]], paint: { 'line-color': '#8fbbdc', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.5, 14, 1.4] } },
    { id: 'bnd2', type: 'line', source: S, 'source-layer': 'boundary', filter: ['==', ['get', 'admin_level'], 2], paint: { 'line-color': '#6d5c80', 'line-width': 1.3, 'line-dasharray': [3, 2] } },
    { id: 'bnd4', type: 'line', source: S, 'source-layer': 'boundary', minzoom: 5, filter: ['==', ['get', 'admin_level'], 4], paint: { 'line-color': '#9a8eac', 'line-width': 0.8, 'line-dasharray': [2, 2] } },
    ...road('r-min', ['minor', 'service', 'track'], '#b8a88c', 0.7, 11, 1.6),
    ...road('r-ter', ['tertiary'], '#f7cf99', 1.4, 9, 2.6),
    ...road('r-sec', ['secondary'], '#f4b676', 1.8, 8, 3),
    ...road('r-pri', ['primary'], '#f09a52', 2.2, 7, 3.4),
    ...road('r-tru', ['trunk'], '#ec7a3c', 2.6, 5, 3.8),
    ...road('r-mot', ['motorway'], '#e4572e', 3, 4, 4.2),
    { id: 'ref', type: 'symbol', source: S, 'source-layer': 'transportation_name', minzoom: 7, filter: ['all', ['has', 'ref'], ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary']]]], layout: { 'symbol-placement': 'line', 'text-field': ['get', 'ref'], 'text-font': ['Noto Sans Bold'], 'text-size': 10, 'symbol-spacing': 320, 'text-rotation-alignment': 'map' }, paint: { 'text-color': '#7a3510', ...HALO, 'text-halo-width': 1.6 } },
    { id: 'wname', type: 'symbol', source: S, 'source-layer': 'water_name', minzoom: 5, layout: { 'text-field': NM, 'text-font': ['Noto Sans Italic'], 'text-size': 11, 'text-max-width': 6 }, paint: { 'text-color': '#3f78a8', 'text-halo-color': '#d4e7f5', 'text-halo-width': 1.4 } },
    { id: 'peak', type: 'symbol', source: S, 'source-layer': 'mountain_peak', minzoom: 8, layout: { 'text-field': ['concat', NM, ['case', ['has', 'ele'], ['concat', '\n', ['to-string', ['get', 'ele']], ' m'], '']], 'text-font': ['Noto Sans Bold'], 'text-size': 10, 'text-max-width': 8, 'symbol-sort-key': ['*', -1, ['coalesce', ['to-number', ['get', 'ele']], 0]], 'text-padding': 4 }, paint: { 'text-color': '#5a3a22', ...HALO } },
    place('pl-hamlet', ['hamlet', 'suburb', 'neighbourhood', 'isolated_dwelling', 'quarter'], 11, [9, 11], false),
    place('pl-village', ['village'], 7, [9, 12]),
    place('pl-town', ['town'], 5, [10, 14]),
    place('pl-city', ['city'], 3, [12, 17]),
  ];
}


// Solo nomi (paesi, città, monti, acque) per la mappa satellitare: testo bianco con alone scuro morbido, gerarchia per importanza
function labelLayers(S) {
  const W = { 'text-color': '#ffffff', 'text-halo-color': 'rgba(14,28,20,0.78)', 'text-halo-width': 1.5, 'text-halo-blur': 1 };
  const pl = (id, cls, minzoom, sz, font, upper) => ({
    id, type: 'symbol', source: S, 'source-layer': 'place', minzoom, filter: ['in', ['get', 'class'], ['literal', cls]],
    layout: { 'text-field': NM, 'text-font': [font], 'text-size': ['interpolate', ['linear'], ['zoom'], 3, sz[0], 14, sz[1]], 'text-transform': upper ? 'uppercase' : 'none', 'text-letter-spacing': upper ? 0.08 : 0.01, 'text-max-width': 7, 'symbol-sort-key': ['*', -1, ['coalesce', ['to-number', ['get', 'rank']], 99]], 'text-padding': 3 },
    paint: W,
  });
  return [
    { id: 'wname', type: 'symbol', source: S, 'source-layer': 'water_name', minzoom: 6, layout: { 'text-field': NM, 'text-font': ['Noto Sans Italic'], 'text-size': 11, 'text-max-width': 6, 'text-letter-spacing': 0.06 }, paint: { 'text-color': '#cfe8fb', 'text-halo-color': 'rgba(10,30,50,0.75)', 'text-halo-width': 1.3, 'text-halo-blur': 1 } },
    { id: 'peak', type: 'symbol', source: S, 'source-layer': 'mountain_peak', minzoom: 8, layout: { 'text-field': ['concat', '\u25B2 ', NM, ['case', ['has', 'ele'], ['concat', '\n', ['to-string', ['get', 'ele']], ' m'], '']], 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 8, 10, 14, 12], 'text-max-width': 8, 'symbol-sort-key': ['*', -1, ['coalesce', ['to-number', ['get', 'ele']], 0]], 'text-padding': 5, 'text-anchor': 'center' }, paint: { 'text-color': '#ffe9b8', 'text-halo-color': 'rgba(40,24,8,0.8)', 'text-halo-width': 1.4, 'text-halo-blur': 1 } },
    pl('pl-hamlet', ['hamlet', 'suburb', 'neighbourhood', 'isolated_dwelling', 'quarter'], 11, [9, 11.5], 'Noto Sans Regular', false),
    pl('pl-village', ['village'], 8, [10, 13], 'Noto Sans Regular', false),
    pl('pl-town', ['town'], 6, [11, 15], 'Noto Sans Bold', false),
    pl('pl-city', ['city'], 3, [12, 19], 'Noto Sans Bold', true),
  ];
}

export async function addRefLayer(lmap, onFail, opts = {}) {
  const maplibregl = (await import('maplibre-gl')).default;
  await import('maplibre-gl/dist/maplibre-gl.css');
  const base = await baseStyle();
  const el = document.createElement('div');
  el.className = 'ref-gl';
  el.style.cssText = `position:absolute;left:0;top:0;right:0;bottom:0;z-index:${opts.labels ? 640 : 450};pointer-events:none`;
  lmap.getContainer().appendChild(el);
  const c = lmap.getCenter();
  const bear = () => -((lmap.getBearing && lmap.getBearing()) || 0);
  const ml = new maplibregl.Map({
    container: el, interactive: false, attributionControl: false, fadeDuration: 0, renderWorldCopies: false,
    center: [c.lng, c.lat], zoom: lmap.getZoom() - 1, bearing: bear(),
    style: { version: 8, glyphs: base.glyphs, sources: base.sources, layers: opts.labels ? labelLayers(base.key) : layers(base.key) },
  });
  let ok = false, failed = false, errs = 0;
  const fail = () => {
    if (failed) return;
    failed = true;
    api.remove();
    onFail && onFail();
  };
  ml.on('sourcedata', (e) => {
    if (e.sourceId === base.key && e.isSourceLoaded) ok = true;
  });
  ml.on('error', (e) => {
    const st = e && e.error && e.error.status;
    if (st === 404 || st === 204) return;
    if (!ok && ++errs >= 3) fail();
  });
  const t = setTimeout(() => !ok && fail(), 20000);
  const sync = () => {
    const k = lmap.getCenter();
    ml.jumpTo({ center: [k.lng, k.lat], zoom: lmap.getZoom() - 1, bearing: bear() });
  };
  const onZoomAnim = (e) => ml.jumpTo({ center: [e.center.lng, e.center.lat], zoom: e.zoom - 1, bearing: bear() });
  const onResize = () => (ml.resize(), sync());
  lmap.on('move zoom rotate', sync);
  lmap.on('zoomanim', onZoomAnim);
  lmap.on('resize', onResize);
  const api = {
    remove() {
      clearTimeout(t);
      lmap.off('move zoom rotate', sync);
      lmap.off('zoomanim', onZoomAnim);
      lmap.off('resize', onResize);
      try { ml.remove(); } catch {}
      el.remove();
    },
    resize: onResize,
    show(v) { el.style.display = v ? '' : 'none'; if (v) onResize(); },
  };
  return api;
}
