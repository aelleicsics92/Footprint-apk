// Radar e temporali sulla mappa: ultime 2 ore di radar reale (RainViewer) + previsione a griglia del modello (Open-Meteo) per le ore successive.
import L from 'leaflet';

const hhmm = (t) => {
  const d = new Date(t), n = new Date(), m0 = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const k = Math.round((m0(d) - m0(n)) / 86400000);
  return (k === 0 ? '' : k === 1 ? 'domani ' : k === -1 ? 'ieri ' : d.toLocaleDateString('it-IT', { weekday: 'short' }) + ' ') + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
};
// ore da mostrare: da adesso fino alla fine di domani
const endTomorrow = () => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 2); return d.getTime(); };
const modelFrames = (grid) => grid.times.map((t, h) => ({ kind: 'model', t, h })).filter((f) => f.t > Date.now() - 30 * 60000 && f.t < endTomorrow());
const RAMP = [
  [0.1, 120, 190, 255, 0.3], [0.5, 70, 140, 240, 0.55], [2, 40, 190, 120, 0.65], [5, 250, 220, 40, 0.72], [10, 250, 130, 30, 0.8], [25, 220, 40, 40, 0.85],
];
function color(p) {
  if (p < RAMP[0][0]) return [0, 0, 0, 0];
  for (let i = RAMP.length - 1; i >= 0; i--) {
    if (p >= RAMP[i][0]) {
      const a = RAMP[i], b = RAMP[i + 1];
      if (!b) return a.slice(1);
      const t = (p - a[0]) / (b[0] - a[0]);
      return a.slice(1).map((v, k) => v + (b[k + 1] - v) * t);
    }
  }
  return [0, 0, 0, 0];
}

export function createStorm(map, ui) {
  let radar = null, host = '', frames = [], idx = 0, tile = null, over = null, grid = null, gridKey = '', timer = null, on = false, busy = false;
  const info = { radarCount: 0, fcCount: 0 };

  async function loadRadar() {
    try {
      const j = await (await fetch('https://api.rainviewer.com/public/weather-maps.json')).json();
      host = j.host;
      radar = ((j.radar && j.radar.past) || []).map((f) => ({ kind: 'radar', t: f.time * 1000, path: f.path }));
    } catch {
      radar = [];
    }
  }

  // Griglia fissa agganciata a multipli del passo: lo stesso punto della mappa ha sempre gli stessi valori,
  // qualunque sia l'inquadratura. Il passo si infittisce con lo zoom.
  const cache = new Map();
  const stepFor = (z) => (z <= 6 ? 0.5 : z <= 7 ? 0.25 : z <= 9 ? 0.15 : z <= 11 ? 0.08 : 0.04);
  async function fetchPts(list) {
    const todo = list.filter(([la, lo]) => { const c = cache.get(la + ',' + lo); return !c || Date.now() - c.ts > 30 * 60000; });
    const chunks = [];
    for (let i = 0; i < todo.length; i += 90) chunks.push(todo.slice(i, i + 90));
    await Promise.all(chunks.map(async (ch) => {
      const u = `https://api.open-meteo.com/v1/forecast?latitude=${ch.map((q) => q[0]).join(',')}&longitude=${ch.map((q) => q[1]).join(',')}&hourly=precipitation,cape,weather_code&forecast_hours=49&timezone=UTC`;
      const j = await (await fetch(u)).json();
      const arr = Array.isArray(j) ? j : [j];
      arr.forEach((o, i) => cache.set(ch[i][0] + ',' + ch[i][1], { ts: Date.now(), h: o.hourly }));
    }));
  }
  async function loadGrid() {
    const z = map.getZoom();
    let step = stepFor(z);
    const bb = map.getBounds().pad(0.2);
    const dims = (st) => ({ la0: Math.floor(bb.getSouth() / st), la1: Math.ceil(bb.getNorth() / st), lo0: Math.floor(bb.getWest() / st), lo1: Math.ceil(bb.getEast() / st) });
    let d = dims(step);
    while ((d.la1 - d.la0 + 1) * (d.lo1 - d.lo0 + 1) > 420) { step *= 1.5; d = dims(step); }
    const key = [step, d.la0, d.la1, d.lo0, d.lo1].join('|');
    if (grid && grid.key === key && Date.now() - grid.ts < 15 * 60000) return grid;
    const nR = d.la1 - d.la0 + 1, nC = d.lo1 - d.lo0 + 1, list = [];
    const r3 = (v) => Math.round(v * 1000) / 1000;
    for (let i = 0; i < nR; i++) for (let k = 0; k < nC; k++) list.push([r3((d.la0 + i) * step), r3((d.lo0 + k) * step)]);
    await fetchPts(list);
    const pts = list.map(([la, lo]) => cache.get(la + ',' + lo).h);
    const times = pts[0].time.map((t) => Date.parse(t + 'Z'));
    const bounds = L.latLngBounds([d.la0 * step, d.lo0 * step], [d.la1 * step, d.lo1 * step]);
    grid = { key, ts: Date.now(), bounds, nR, nC, times, pts };
    return grid;
  }

  function drawModel(h) {
    if (!grid) return;
    const { nR, nC, pts, bounds } = grid;
    const sc = Math.max(3, Math.min(10, Math.floor(420 / Math.max(nR, nC))));
    const W = (nC - 1) * sc + 1, H = (nR - 1) * sc + 1;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const x = cv.getContext('2d'), im = x.createImageData(W, H);
    const P = (i, k) => Math.max(0, pts[i * nC + k].precipitation[h] || 0);
    const T = (i, k) => { const q = pts[i * nC + k], c = q.weather_code[h] || 0, ca = q.cape[h] || 0, p = q.precipitation[h] || 0; return c >= 95 ? 1 : ca > 800 && p > 0.3 ? Math.min(1, (ca - 800) / 1500) : 0; };
    const sm = (t) => t * t * (3 - 2 * t);
    // la latitudine nell'immagine è lineare in Mercatore: converto riga -> latitudine -> indice di griglia
    const merc = (la) => Math.log(Math.tan(Math.PI / 4 + (la * Math.PI) / 360));
    const mS = merc(bounds.getSouth()), mN = merc(bounds.getNorth());
    const latStep = (bounds.getNorth() - bounds.getSouth()) / (nR - 1);
    for (let py = 0; py < H; py++) {
      const m = mN - ((mN - mS) * py) / (H - 1), la = (2 * Math.atan(Math.exp(m)) - Math.PI / 2) * (180 / Math.PI);
      const fy = Math.max(0, Math.min(nR - 1.0001, (la - bounds.getSouth()) / latStep)), i0 = Math.floor(fy), ty = sm(fy - i0);
      for (let px = 0; px < W; px++) {
        const fx = (px / (W - 1)) * (nC - 1), k0 = Math.min(nC - 2, Math.floor(fx)), tx = sm(fx - k0);
        const bl = (f) => (f(i0, k0) * (1 - tx) + f(i0, k0 + 1) * tx) * (1 - ty) + (f(i0 + 1, k0) * (1 - tx) + f(i0 + 1, k0 + 1) * tx) * ty;
        let c = color(bl(P));
        const th = bl(T);
        if (th > 0.3 && c[3] > 0) {
          const mm = Math.min(1, (th - 0.3) / 0.4);
          c = [c[0] + (175 - c[0]) * mm, c[1] + (55 - c[1]) * mm, c[2] + (210 - c[2]) * mm, Math.max(c[3], 0.85)];
        }
        const o = (py * W + px) * 4;
        im.data[o] = c[0]; im.data[o + 1] = c[1]; im.data[o + 2] = c[2]; im.data[o + 3] = Math.round(c[3] * 255);
      }
    }
    x.putImageData(im, 0, 0);
    const url = cv.toDataURL();
    if (over) over.setUrl(url), over.setBounds(bounds);
    else over = L.imageOverlay(url, bounds, { opacity: 1, interactive: false, zIndex: 320 }).addTo(map);
  }

  // il radar ha pixel da circa 1 km: oltre lo zoom 8 lo ammorbidisco per evitare i quadrettoni
  function smoothRadar() {
    const z = map.getZoom(), px = z <= 8 ? 0 : Math.min(16, (z - 8) * 3.2);
    const el = map.getContainer();
    el.style.setProperty('--radar-blur', px + 'px');
  }
  map.on('zoomend', smoothRadar);

  function show(i) {
    idx = Math.max(0, Math.min(frames.length - 1, i));
    const f = frames[idx];
    if (!f) return;
    if (f.kind === 'radar') {
      if (over) { map.removeLayer(over); over = null; }
      const url = `${host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`;
      smoothRadar();
      if (!tile) tile = L.tileLayer(url, { opacity: 0.7, maxNativeZoom: 7, maxZoom: 22, zIndex: 310, className: 'storm-tiles' }).addTo(map);
      else tile.setUrl(url);
    } else {
      if (tile) { map.removeLayer(tile); tile = null; }
      drawModel(f.h);
    }
    ui.frame(f, idx, frames.length);
  }

  async function build() {
    if (busy) return;
    busy = true;
    try {
      if (!radar) await loadRadar();
      let model = [];
      try {
        await loadGrid();
        model = modelFrames(grid);
      } catch {}
      const keep = frames[idx] && frames[idx].t;
      frames = [...radar, ...model];
      info.radarCount = radar.length;
      info.fcCount = model.length;
      if (!frames.length) { ui.error(); return; }
      let start = radar.length ? radar.length - 1 : 0;
      if (keep) { const k = frames.findIndex((f) => f.t === keep); if (k >= 0) start = k; }
      ui.setup(frames, start);
      show(start);
    } finally {
      busy = false;
    }
  }

  let mv = null;
  const onMove = () => {
    clearTimeout(mv);
    mv = setTimeout(async () => {
      if (!on || !navigator.onLine) return;
      const f = frames[idx];
      if (f && f.kind === 'model') await build();
      else {
        const before = grid && grid.key;
        try { await loadGrid(); if (grid.key !== before) { const model = modelFrames(grid); frames = [...radar, ...model]; ui.setup(frames, idx); ui.frame(frames[idx], idx, frames.length); } } catch {}
      }
    }, 900);
  };

  return {
    async start() {
      if (on) return;
      if (!navigator.onLine) return ui.offline();
      on = true;
      map.on('moveend', onMove);
      ui.loading();
      await build();
    },
    stop() {
      on = false;
      clearInterval(timer);
      timer = null;
      map.off('moveend', onMove);
      if (tile) { map.removeLayer(tile); tile = null; }
      if (over) { map.removeLayer(over); over = null; }
      ui.stopped();
    },
    seek: show,
    toggle() {
      if (timer) { clearInterval(timer); timer = null; return false; }
      timer = setInterval(() => show(idx + 1 >= frames.length ? 0 : idx + 1), 550);
      return true;
    },
    isOn: () => on,
    fmt: hhmm,
  };
}
