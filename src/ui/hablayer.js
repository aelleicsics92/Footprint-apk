// Heatmap di previsione per pixel (meteo x habitat della specie), usata nella schermata Previsione e nella mappa principale
import L from 'leaflet';
import { ITALY } from '../data/italy.js';
import { clamp } from '../lib/util.js';
import { getSettings } from '../lib/store.js';
import { SPECIES } from '../data/species.js';
import { PROFILES, ZONES, getZoneSeries, outlook } from '../lib/fungi.js';
import * as HAB from '../lib/habitat.js';
import { analyzeBase, finishAnalysis, applyProfile, weatherField, soilField, fillSoil, confirmField, probFrom, dayOfYear } from '../lib/habitat.js';
import { spotsFor } from '../lib/calib.js';

// Sfumatura continua del colore di raccolta sopra la mappa (interpolazione IDW tra le zone)
const STOPS = [[0, [185, 85, 58]], [22, [185, 85, 58]], [34, [224, 166, 58]], [45, [224, 166, 58]], [58, [127, 174, 74]], [70, [127, 174, 74]], [90, [27, 122, 74]], [100, [20, 105, 62]]];
export function colorAt(v) {
  for (let i = 1; i < STOPS.length; i++) {
    if (v <= STOPS[i][0]) {
      const [a, ca] = STOPS[i - 1], [b, cb] = STOPS[i], t = b === a ? 0 : (v - a) / (b - a);
      return ca.map((c, k) => Math.round(c + (cb[k] - c) * t));
    }
  }
  return STOPS[STOPS.length - 1][1];
}
// i canvas vivono nel pannello ruotabile: si disegna in coordinate "layer" su un quadrato che copre lo schermo a qualsiasi rotazione
export function frame(map) {
  const sz = map.getSize(), d = Math.ceil(Math.hypot(sz.x, sz.y));
  const ctr = map.containerPointToLayerPoint([sz.x / 2, sz.y / 2]);
  return { tl: ctr.subtract([d / 2, d / 2]).round(), d };
}
export const toF = (map, f, lat, lon) => map.latLngToLayerPoint([lat, lon]).subtract(f.tl);
export function placeCanvas(map, c) {
  const f = frame(map);
  L.DomUtil.setPosition(c, f.tl);
  c.width = f.d; c.height = f.d;
  c.style.width = f.d + 'px'; c.style.height = f.d + 'px';
  return f;
}
export function clipItaly(x, map, f) {
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
// Heatmap per pixel: meteo (IDW sulle zone) x habitat della specie (DEM, bosco, suolo). Sopra il rilievo, sotto strade e nomi.
export const HabLayer = L.Layer.extend({
  initialize(o) {
    this._o = o || {};
  },
  onAdd(map) {
    this._map = map;
    this._c = L.DomUtil.create('canvas', 'heat-canvas');
    this._c.style.cssText = `position:absolute;pointer-events:none;mix-blend-mode:${this._o.blend || 'multiply'};opacity:${this._o.opacity || 0.82}`;
    map.getPanes().tilePane.appendChild(this._c);
    this._c.style.zIndex = 251;
    this._on = () => (this._draw(), this._sched());
    map.on('moveend zoomend resize', this._on);
    this._sched();
  },
  onRemove(map) {
    map.off('moveend zoomend resize', this._on);
    clearTimeout(this._rt);
    clearTimeout(this._t);
    this._c.remove();
  },
  setInputs(inp) {
    this._inp = inp;
    this._drawW();
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
    this._o.status && this._o.status(t);
  },
  async _load() {
    const map = this._map;
    if (!map || !this._inp) return;
    const zoom = map.getZoom(), sz = map.getSize();
    const cs = [[0, 0], [sz.x, 0], [0, sz.y], [sz.x, sz.y]].map((q) => map.containerPointToLatLng(q));
    const b = { n: Math.max(...cs.map((c) => c.lat)), s: Math.min(...cs.map((c) => c.lat)), e: Math.max(...cs.map((c) => c.lng)), w: Math.min(...cs.map((c) => c.lng)) };
    const A = this._A;
    if (A && Math.abs(zoom - A.zoomReq) < 0.8 && b.n <= A.T.bounds.n && b.s >= A.T.bounds.s && b.e <= A.T.bounds.e && b.w >= A.T.bounds.w) return this._draw();
    if (this._busy) {
      this._again = true;
      return;
    }
    this._busy = true;
    const tok = (this._tok = (this._tok || 0) + 1);
    this._status('<span class="spin"></span> Analisi habitat…');
    const pad = 0.12, pw = (b.n - b.s) * pad, pl = (b.e - b.w) * pad;
    try {
      const base = await Promise.race([analyzeBase({ n: b.n + pw, s: b.s - pw, e: b.e + pl, w: b.w - pl }, zoom), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout quota')), 40000))]);
      this._status('<span class="spin"></span> Analisi boschi…');
      const L = base.lcP ? await base.lcP : null;
      if (!L) {
        // senza copertura del suolo non c'è distinzione bosco/strada: resta il meteo e si riprova
        this._busy = false;
        this._A = null;
        this._img = null;
        this._drawW();
        this._status('Analisi boschi in corso…' + (HAB.lcDiag ? ' (' + HAB.lcDiag + ')' : ''));
        clearTimeout(this._rt);
        this._rt = setTimeout(() => this._load(), 12000);
        return;
      }
      const nA = finishAnalysis(base.T, L);
      nA.zoomReq = zoom;
      this._A = nA;
      await this._recompute();
    } catch (e) {
      this._busy = false;
      this._again = false;
      console.warn('habitat', e.message);
      this._A = null;
      this._img = null;
      this._o.onState && this._o.onState(false);
      this._drawW();
      this._status('Habitat non disponibile (serve internet): mappa solo meteo');
      clearTimeout(this._rt);
      this._rt = setTimeout(() => this._load(), 20000);
      return;
    }
    this._busy = false;
    if (this._again) {
      this._again = false;
      this._sched();
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
    this._o.onState && this._o.onState(true);
    this._c.style.visibility = 'visible';
    this._draw();
    const soilN = ph ? 'suolo ✓' : 'suolo in apprendimento';
    this._status(`Habitat: quota ✓ · bosco ${A.src ? A.src + ' ✓' : 'non verificato'} · ${soilN}${T.z < 8 ? ' · zoom per più dettaglio' : ''}`);
    if (SPECIES[inp.key].some((s) => s.ph)) {
      const bb = this._map.getBounds();
      fillSoil({ n: bb.getNorth(), s: bb.getSouth(), e: bb.getEast(), w: bb.getWest() }, () => this.refresh());
    }
  },
  _drawW() {
    const map = this._map, inp = this._inp;
    if (!map || !inp || !inp.zones || !inp.zones.length) return;
    const c = this._c, f = placeCanvas(map, c), D = f.d, CELL = 16;
    const off = document.createElement('canvas');
    off.width = D; off.height = D;
    const o = off.getContext('2d');
    const P = inp.zones.map((q) => ({ s: q.score, p: toF(map, f, q.lat, q.lon) }));
    for (let gy = 0; gy < D + CELL; gy += CELL) {
      for (let gx = 0; gx < D + CELL; gx += CELL) {
        let w = 0, v = 0;
        for (const q of P) {
          const wi = 1 / ((q.p.x - gx) ** 2 + (q.p.y - gy) ** 2 + 2500);
          w += wi; v += wi * q.s;
        }
        const [r, g, b] = colorAt(v / w);
        o.fillStyle = `rgb(${r},${g},${b})`;
        o.fillRect(gx, gy, CELL + 1, CELL + 1);
      }
    }
    const x = c.getContext('2d');
    x.save();
    clipItaly(x, map, f);
    x.globalAlpha = 0.8;
    x.drawImage(off, 0, 0);
    x.restore();
    c.style.visibility = 'visible';
  },
  _draw() {
    const map = this._map, A = this._A;
    if (!map) return;
    if (!A || !this._img) return this._drawW();
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


export async function forecastInputs(day = 0) {
  const key = SPECIES[getSettings().fungiProfile] ? getSettings().fungiProfile : 'autunnali';
  const prof = PROFILES[key];
  const data = await getZoneSeries();
  const zones = ZONES.map((z, i) => {
    const sr = data.series[i], out = outlook(sr, prof, sr.elev), o = out[clamp(day, 0, out.length - 1)];
    return { lat: z.lat, lon: z.lon, score: o.score, elev: sr.elev, closed: o.closed, name: z.name };
  });
  const d = new Date();
  d.setDate(d.getDate() + day);
  return { zones, key, prof, doy: dayOfYear(d) };
}
