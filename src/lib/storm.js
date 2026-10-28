// Radar e temporali sulla mappa: ultime 2 ore di radar reale (RainViewer) + previsione a griglia del modello (Open-Meteo) per le ore successive.
import L from 'leaflet';

const hhmm = (t) => new Date(t).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
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

  async function loadGrid() {
    const b = map.getBounds().pad(0.35);
    const key = [b.getSouth().toFixed(1), b.getWest().toFixed(1), b.getNorth().toFixed(1), b.getEast().toFixed(1), Math.round(map.getZoom())].join('|');
    if (grid && grid.key === key && Date.now() - grid.ts < 15 * 60000) return grid;
    const N = 8, lats = [], lons = [];
    for (let i = 0; i < N; i++) for (let k = 0; k < N; k++) {
      lats.push((b.getSouth() + ((b.getNorth() - b.getSouth()) * i) / (N - 1)).toFixed(3));
      lons.push((b.getWest() + ((b.getEast() - b.getWest()) * k) / (N - 1)).toFixed(3));
    }
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${lats.join(',')}&longitude=${lons.join(',')}&hourly=precipitation,cape,weather_code&forecast_hours=14&timezone=UTC`;
    const j = await (await fetch(u)).json();
    const arr = Array.isArray(j) ? j : [j];
    const times = arr[0].hourly.time.map((t) => Date.parse(t + 'Z'));
    grid = { key, ts: Date.now(), bounds: b, N, times, pts: arr.map((o) => o.hourly) };
    return grid;
  }

  function drawModel(h) {
    if (!grid) return;
    const { N, pts, bounds } = grid, S = 128;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const x = cv.getContext('2d'), im = x.createImageData(S, S);
    const P = (i, k) => Math.max(0, pts[i * N + k].precipitation[h] || 0);
    const T = (i, k) => { const q = pts[i * N + k]; const c = q.weather_code[h] || 0, ca = q.cape[h] || 0, p = q.precipitation[h] || 0; return c >= 95 ? 1 : ca > 800 && p > 0.3 ? Math.min(1, (ca - 800) / 1500) : 0; };
    for (let py = 0; py < S; py++) {
      const fy = ((S - 1 - py) / (S - 1)) * (N - 1), i0 = Math.min(N - 2, Math.floor(fy)), ty = fy - i0;
      for (let px = 0; px < S; px++) {
        const fx = (px / (S - 1)) * (N - 1), k0 = Math.min(N - 2, Math.floor(fx)), tx = fx - k0;
        const bl = (f) => (f(i0, k0) * (1 - tx) + f(i0, k0 + 1) * tx) * (1 - ty) + (f(i0 + 1, k0) * (1 - tx) + f(i0 + 1, k0 + 1) * tx) * ty;
        let c = color(bl(P));
        const th = bl(T);
        if (th > 0.3 && c[3] > 0) {
          const m = Math.min(1, (th - 0.3) / 0.4);
          c = [c[0] + (175 - c[0]) * m, c[1] + (55 - c[1]) * m, c[2] + (210 - c[2]) * m, Math.max(c[3], 0.85)];
        }
        const o = (py * S + px) * 4;
        im.data[o] = c[0]; im.data[o + 1] = c[1]; im.data[o + 2] = c[2]; im.data[o + 3] = Math.round(c[3] * 255);
      }
    }
    x.putImageData(im, 0, 0);
    const url = cv.toDataURL();
    if (over) over.setUrl(url), over.setBounds(bounds);
    else over = L.imageOverlay(url, bounds, { opacity: 1, interactive: false, zIndex: 320 }).addTo(map);
  }

  function show(i) {
    idx = Math.max(0, Math.min(frames.length - 1, i));
    const f = frames[idx];
    if (!f) return;
    if (f.kind === 'radar') {
      if (over) { map.removeLayer(over); over = null; }
      const url = `${host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`;
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
        const now = Date.now();
        model = grid.times.map((t, h) => ({ kind: 'model', t, h })).filter((f) => f.t > now - 30 * 60000);
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
        try { await loadGrid(); if (grid.key !== before) { const now = Date.now(); const model = grid.times.map((t, h) => ({ kind: 'model', t, h })).filter((q) => q.t > now - 30 * 60000); frames = [...radar, ...model]; ui.setup(frames, idx); ui.frame(frames[idx], idx, frames.length); } } catch {}
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
      timer = setInterval(() => show(idx + 1 >= frames.length ? 0 : idx + 1), 800);
      return true;
    },
    isOn: () => on,
    fmt: hhmm,
  };
}
