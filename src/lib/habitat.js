// Motore habitat: incrocia quota, pendenza, esposizione, posizione (fondovalle/crinale) dal DEM,
// copertura del suolo/bosco (CORINE Land Cover, fallback ESA WorldCover), pH del suolo (SoilGrids) e acqua (OSM)
// con le esigenze di ogni specie (src/data/species.js). Tutto calcolato sul telefono.
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { kvGet, kvSet } from './store.js';
import { SPECIES, GEN, GEN_NAME } from '../data/species.js';
import { seasonFactor, FORECAST } from './fungi.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ss = (x, a, b) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const trap = (x, o0, o1, z0, z1) => (x >= o0 && x <= o1 ? 1 : x < o0 ? clamp((x - z0) / (o0 - z0), 0, 1) : clamp((z1 - x) / (z1 - o1), 0, 1));
const RAD = Math.PI / 180;
const NG = GEN.length;
const GI = Object.fromEntries(GEN.map((g, i) => [g, i]));
const UNK = 32767;

// ---------- rete ----------
const loadImg = (src, ms = 14000) =>
  new Promise((res, rej) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    const t = setTimeout(() => rej(new Error('timeout')), ms);
    im.onload = () => (clearTimeout(t), res(im));
    im.onerror = () => (clearTimeout(t), rej(new Error('img')));
    im.src = src;
  });
async function imgPixels(url, w, h) {
  let im;
  try {
    im = await loadImg(url);
  } catch (e) {
    if (!Capacitor.isNativePlatform()) throw e;
    const r = await CapacitorHttp.get({ url, responseType: 'blob', connectTimeout: 8000, readTimeout: 15000 });
    if (r.status !== 200 || !r.data) throw new Error('http ' + r.status);
    im = await loadImg('data:image/png;base64,' + r.data);
  }
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = false;
  g.drawImage(im, 0, 0, w, h);
  return g.getImageData(0, 0, w, h).data;
}
async function getJSON(url, ms = 12000) {
  if (Capacitor.isNativePlatform()) {
    const r = await Promise.race([CapacitorHttp.get({ url, responseType: 'json' }), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
    if (r.status !== 200) throw new Error('http ' + r.status);
    return typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
  }
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error('http ' + r.status);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

// ---------- geometria Web Mercator ----------
const WORLD = 40075016.686;
export const ll2px = (z, lat, lon) => {
  const n = 256 * 2 ** z, r = lat * RAD;
  return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n];
};
export const px2ll = (z, X, Y) => {
  const n = 256 * 2 ** z;
  return [(Math.atan(Math.sinh(Math.PI * (1 - (2 * Y) / n))) / RAD), (X / n) * 360 - 180];
};
const px2m = (z, v) => (v / (256 * 2 ** z)) * WORLD - WORLD / 2;

// ---------- DEM (Terrarium) ----------
const demCache = new Map();
function demTile(z, x, y) {
  const k = `${z}/${x}/${y}`;
  if (demCache.has(k)) return demCache.get(k);
  const p = imgPixels(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`, 256, 256).then((d) => {
    const e = new Float32Array(65536);
    for (let i = 0; i < 65536; i++) e[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
    return e;
  });
  p.catch(() => demCache.delete(k));
  demCache.set(k, p);
  if (demCache.size > 80) demCache.delete(demCache.keys().next().value);
  return p;
}

async function buildTerrain(b, zoom) {
  const lat0 = (b.n + b.s) / 2;
  let z = clamp(Math.round(zoom), 5, 12), x0, x1, y0, y1;
  const padLat = (b.n - b.s) * 0.06, padLon = (b.e - b.w) * 0.06;
  for (;;) {
    const a = ll2px(z, b.n + padLat, b.w - padLon), c = ll2px(z, b.s - padLat, b.e + padLon);
    x0 = Math.floor(a[0] / 256); x1 = Math.floor(c[0] / 256); y0 = Math.floor(a[1] / 256); y1 = Math.floor(c[1] / 256);
    if (((x1 - x0 + 1) > 5 || (y1 - y0 + 1) > 5 || (x1 - x0 + 1) * (y1 - y0 + 1) > 20) && z > 5) z--;
    else break;
  }
  const nx = x1 - x0 + 1, ny = y1 - y0 + 1, W = nx * 256, H = ny * 256;
  const jobs = [];
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) jobs.push(demTile(z, tx, ty).then((e) => ({ tx, ty, e }), () => null));
  const res = await Promise.all(jobs);
  if (res.filter(Boolean).length < Math.ceil(jobs.length * 0.6)) throw new Error('DEM non disponibile');
  const s = Math.max(1, Math.ceil(Math.max(W, H) / 420));
  const w = Math.floor(W / s), h = Math.floor(H / s);
  const elev = new Float32Array(w * h);
  for (const t of res) {
    if (!t) continue;
    const ox = (t.tx - x0) * 256, oy = (t.ty - y0) * 256;
    for (let j = 0; j < h; j++) {
      const yy = j * s + (s >> 1) - oy;
      if (yy < 0 || yy > 255) continue;
      for (let i = 0; i < w; i++) {
        const xx = i * s + (s >> 1) - ox;
        if (xx < 0 || xx > 255) continue;
        elev[j * w + i] = t.e[yy * 256 + xx];
      }
    }
  }
  const mpp = (WORLD * Math.cos(lat0 * RAD)) / (256 * 2 ** z), cell = mpp * s;
  const slope = new Uint8Array(w * h), asp = new Int16Array(w * h), tpi = new Int16Array(w * h).fill(UNK);
  const at = (i, j) => elev[clamp(j, 0, h - 1) * w + clamp(i, 0, w - 1)];
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const dzdx = (at(i + 1, j - 1) + 2 * at(i + 1, j) + at(i + 1, j + 1) - at(i - 1, j - 1) - 2 * at(i - 1, j) - at(i - 1, j + 1)) / (8 * cell);
      const dzdy = (at(i - 1, j + 1) + 2 * at(i, j + 1) + at(i + 1, j + 1) - at(i - 1, j - 1) - 2 * at(i, j - 1) - at(i + 1, j - 1)) / (8 * cell);
      const sl = Math.atan(Math.hypot(dzdx, dzdy)) / RAD;
      slope[j * w + i] = Math.min(89, Math.round(sl));
      asp[j * w + i] = sl < 2 ? -1 : Math.round(((Math.atan2(-dzdx, dzdy) / RAD) + 360) % 360);
    }
  }
  // TPI (quota rispetto alla media nel raggio di ~250 m): il miglior indicatore morfologico per il tartufo bianco
  const R = Math.round(250 / cell);
  if (R >= 1 && R <= 14) {
    const iw = w + 1, I = new Float64Array(iw * (h + 1));
    for (let j = 0; j < h; j++) {
      let row = 0;
      for (let i = 0; i < w; i++) {
        row += elev[j * w + i];
        I[(j + 1) * iw + i + 1] = I[j * iw + i + 1] + row;
      }
    }
    for (let j = 0; j < h; j++) {
      const ja = Math.max(0, j - R), jb = Math.min(h - 1, j + R);
      for (let i = 0; i < w; i++) {
        const ia = Math.max(0, i - R), ib = Math.min(w - 1, i + R);
        const sum = I[(jb + 1) * iw + ib + 1] - I[ja * iw + ib + 1] - I[(jb + 1) * iw + ia] + I[ja * iw + ia];
        tpi[j * w + i] = Math.round(elev[j * w + i] - sum / ((jb - ja + 1) * (ib - ia + 1)));
      }
    }
  }
  const tl = px2ll(z, x0 * 256, y0 * 256), br = px2ll(z, x0 * 256 + w * s, y0 * 256 + h * s);
  return { z, s, w, h, x0: x0 * 256, y0: y0 * 256, elev, slope, asp, tpi, mpp, cell, lat0, bounds: { n: tl[0], w: tl[1], s: br[0], e: br[1] } };
}

// ---------- copertura del suolo ----------
const CLC = {
  111: [230, 0, 77], 112: [255, 0, 0], 121: [204, 77, 242], 122: [204, 0, 0], 123: [230, 204, 204], 124: [230, 204, 230], 131: [166, 0, 204], 132: [166, 77, 0], 133: [255, 77, 255], 141: [255, 166, 255], 142: [255, 230, 255],
  211: [255, 255, 168], 212: [255, 255, 0], 213: [230, 230, 0], 221: [230, 128, 0], 222: [242, 166, 77], 223: [230, 166, 0], 231: [230, 230, 77], 241: [255, 230, 166], 242: [255, 230, 77], 243: [230, 204, 77], 244: [242, 204, 166],
  311: [128, 255, 0], 312: [0, 166, 0], 313: [77, 255, 0], 321: [204, 242, 77], 322: [166, 255, 128], 323: [166, 230, 77], 324: [166, 242, 0], 331: [230, 230, 230], 332: [204, 204, 204], 333: [204, 255, 204], 334: [0, 0, 0], 335: [166, 230, 204],
  411: [166, 166, 255], 412: [77, 77, 255], 421: [204, 204, 255], 422: [230, 230, 255], 423: [166, 166, 230], 511: [0, 204, 242], 512: [128, 242, 230], 521: [0, 255, 166], 522: [166, 255, 230], 523: [230, 242, 255],
};
const WC = { 313: [0, 100, 0], 323: [255, 187, 34], 321: [255, 255, 76], 211: [240, 150, 255], 112: [250, 0, 0], 331: [180, 180, 180], 512: [0, 100, 200], 411: [0, 150, 160], 333: [250, 230, 160] };
function decoder(pal) {
  const ent = Object.entries(pal).map(([k, v]) => [Number(k), v]), memo = new Map();
  return (r, g, b) => {
    const key = (r << 16) | (g << 8) | b;
    let v = memo.get(key);
    if (v !== undefined) return v;
    let best = 0, bd = 1500;
    for (const [k, c] of ent) {
      const d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2;
      if (d < bd) (bd = d), (best = k);
    }
    memo.set(key, best);
    return best;
  };
}
const decClc = decoder(CLC), decWc = decoder(WC);

async function buildLandcover(T) {
  const x1 = T.x0 + T.w * T.s, y1 = T.y0 + T.h * T.s;
  const bb = [px2m(T.z, T.x0), -px2m(T.z, y1), px2m(T.z, x1), -px2m(T.z, T.y0)].map((v) => v.toFixed(1)).join(',');
  const srcs = [
    [`https://image.discomap.eea.europa.eu/arcgis/rest/services/Corine/CLC2018_WM/MapServer/export?bbox=${bb}&bboxSR=3857&imageSR=3857&size=${T.w},${T.h}&format=png&transparent=false&f=image`, decClc, 'CORINE 2018'],
    [`https://services.terrascope.be/wms/v2?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=WORLDCOVER_2021_MAP&STYLES=&SRS=EPSG:3857&BBOX=${bb}&WIDTH=${T.w}&HEIGHT=${T.h}&FORMAT=image/png&TRANSPARENT=false`, decWc, 'ESA WorldCover'],
  ];
  for (const [url, dec, name] of srcs) {
    try {
      const d = await imgPixels(url, T.w, T.h);
      const codes = new Uint16Array(T.w * T.h);
      let known = 0;
      for (let i = 0; i < codes.length; i++) {
        const c = dec(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
        codes[i] = c;
        if (c) known++;
      }
      if (known > codes.length * 0.15) return { codes, src: name };
    } catch (e) {
      console.warn('copertura', name, e.message);
    }
  }
  return null;
}

// [quota di bosco, quota di vegetazione aperta/arbustiva con potenziale simbiotico]
const COV = { 311: [1, 0], 312: [1, 0], 313: [1, 0], 324: [0.65, 0.35], 323: [0, 0.5], 322: [0, 0.3], 321: [0, 0.25], 244: [0, 0.3], 243: [0, 0.25], 242: [0, 0.12], 241: [0, 0.1], 222: [0, 0.12], 223: [0, 0.12], 221: [0, 0.05], 211: [0, 0.05], 212: [0, 0.05], 231: [0, 0.15], 141: [0, 0.1], 333: [0, 0.15], 331: [0, 0.05] };
export const LC_NAME = (c) => (c === 311 ? 'latifoglie' : c === 312 ? 'conifere' : c === 313 ? 'bosco misto' : c === 324 ? 'bosco giovane / arbusteto' : c >= 321 && c <= 323 ? 'prato e arbusti' : c >= 211 && c <= 244 ? 'coltivi' : c >= 111 && c <= 142 ? 'urbano' : c >= 511 ? 'acqua' : c === 0 ? 'n.d.' : 'altro');

// mix dei generi forestali dalla classe di copertura, quota, latitudine e posizione
function mixInto(out, code, alt, lat, tpi) {
  out.fill(0);
  const alpine = lat > 44.2;
  const broad = (k) => {
    out[GI.fagus] += k * ss(alt, 750, 1050) * (1 - ss(alt, 1850, 2000));
    out[GI.quercus] += k * ((1 - ss(alt, 600, 1000)) + 0.3 * ss(alt, 600, 1000) * (1 - ss(alt, 1000, 1400)));
    out[GI.castanea] += k * 0.35 * ss(alt, 150, 350) * (1 - ss(alt, 900, 1100));
    out[GI.carpinus] += k * 0.4 * ss(alt, 100, 300) * (1 - ss(alt, 900, 1150));
    out[GI.corylus] += k * 0.2 * ss(alt, 200, 500) * (1 - ss(alt, 1300, 1500));
    const valley = tpi !== UNK && tpi < -6 && alt < 800;
    out[GI.ripar] += k * (valley ? 0.5 : 0.12) * (1 - ss(alt, 500, 800));
    out[GI.tilia] += k * (valley ? 0.2 : 0.08) * (1 - ss(alt, 600, 900));
  };
  const conif = (k) => {
    if (alpine) {
      out[GI.picea] += k * ss(alt, 800, 1300) * (1 - ss(alt, 2000, 2200));
      out[GI.abies] += k * 0.5 * ss(alt, 800, 1200) * (1 - ss(alt, 1800, 1950));
      out[GI.larix] += k * ss(alt, 1700, 1900);
      out[GI.pinus] += k * (0.5 * (1 - ss(alt, 900, 1300)) + 0.3 * ss(alt, 1900, 2100));
    } else {
      out[GI.abies] += k * ss(alt, 900, 1200) * (1 - ss(alt, 1800, 1950));
      out[GI.picea] += k * 0.1 * ss(alt, 1300, 1600);
      out[GI.pinus] += k * (1 - 0.7 * ss(alt, 1000, 1400));
    }
  };
  if (code === 312) conif(1);
  else if (code === 313) (broad(0.5), conif(0.5));
  else broad(1);
  let t = 0;
  for (let g = 0; g < NG; g++) t += out[g];
  if (t > 0) for (let g = 0; g < NG; g++) out[g] /= t;
}

// ---------- analisi: parte indipendente dal profilo ----------
export async function analyze(bounds, zoom, withLand = true) {
  const T = await buildTerrain(bounds, zoom);
  let L = null;
  if (withLand && T.z >= 8) L = await buildLandcover(T);
  const N = T.w * T.h, mix = new Uint8Array(N * NG), fo = new Uint8Array(N), op = new Uint8Array(N), tmp = new Float32Array(NG);
  const memo = new Map();
  for (let j = 0; j < T.h; j++) {
    const lat = px2ll(T.z, T.x0, T.y0 + (j + 0.5) * T.s)[0];
    for (let i = 0; i < T.w; i++) {
      const k = j * T.w + i, alt = T.elev[k];
      let code = L ? L.codes[k] : 313, cov;
      if (!L) cov = [0.55, 0];
      else cov = COV[code] || [0, 0];
      fo[k] = Math.round(cov[0] * 255);
      op[k] = Math.round(cov[1] * 255);
      if (cov[0] + cov[1] === 0 || alt <= 0) continue;
      const tp = T.tpi[k];
      const mk = `${code}|${Math.round(alt / 40)}|${Math.round(lat * 2)}|${tp !== UNK && tp < -6 ? 1 : 0}`;
      let m = memo.get(mk);
      if (!m) {
        mixInto(tmp, code, alt, lat, tp);
        m = Uint8Array.from(tmp, (v) => Math.round(v * 255));
        memo.set(mk, m);
      }
      mix.set(m, k * NG);
    }
  }
  return { T, L, mix, fo, op, src: L ? L.src : null };
}

// ---------- punteggio per specie ----------
function aspF(kind, asp, alt, soft) {
  if (kind === 'any') return 1;
  if (asp < 0) return 0.9;
  const c = kind === 'cool' ? Math.cos((asp - 30) * RAD) : Math.cos((asp - 205) * RAD);
  let f = soft ? 0.85 + 0.15 * c : 0.75 + 0.25 * c;
  if (alt > 1400) f += (1 - f) * ss(alt, 1400, 1900);
  return f;
}
const slopeF = (s, [ok, zero]) => (s <= ok ? 1 : s >= zero ? 0.1 : 1 - 0.9 * ((s - ok) / (zero - ok)));
function tpiF(kind, tpi) {
  if (tpi === UNK) return kind === 'valley' ? 0.7 : 1;
  if (kind === 'valley') return tpi <= -4 ? 1 : tpi <= 12 ? 1 - 0.3 * ((tpi + 4) / 16) : tpi <= 30 ? 0.7 - 0.25 * ((tpi - 12) / 18) : 0.3;
  if (kind === 'mid') return tpi < -25 ? 0.75 : tpi > 35 ? 0.65 : 1;
  return tpi > 45 ? 0.75 : 1;
}
const phF = (ph, r) => (ph == null || isNaN(ph) || !r ? 0.8 : Math.max(0.15, trap(ph, r[0], r[1], r[0] - 1.8, r[1] + 1.2)));

const parts = { altF: 0, host: 0, aspF: 0, slopeF: 0, tpiF: 0, phF: 0, raw: 0 };
function cell(A, sp, k, ph, doy) {
  const T = A.T, alt = T.elev[k];
  const altF = trap(alt, sp.alt[0], sp.alt[1], sp.alt[2], sp.alt[3]);
  parts.altF = altF; parts.raw = 0;
  if (altF < 0.02) return 0;
  const f = A.fo[k] / 255, o = A.op[k] / 255;
  let dot = 0;
  for (let g = 0; g < NG; g++) {
    const m = A.mix[k * NG + g];
    if (m) dot += (m / 255) * (sp.hosts[GEN[g]] || 0);
  }
  let host = f * dot + o * (sp.open || 0) * 0.7 * dot;
  if (sp.wet && f === 0 && o > 0 && A.T.tpi[k] !== UNK && A.T.tpi[k] < -8) host = Math.max(host, (sp.hosts.ripar || 0) * 0.4);
  parts.host = host;
  if (host < 0.03) return 0;
  const a = aspF(sp.asp, T.asp[k], alt, sp.aspSoft), s = slopeF(T.slope[k], sp.slope), t = tpiF(sp.tpi, T.tpi[k]), p = phF(ph, sp.ph);
  parts.aspF = a; parts.slopeF = s; parts.tpiF = t; parts.phF = p;
  const raw = altF * host * a * s * t * (0.35 + 0.65 * p) / (0.35 + 0.65);
  parts.raw = raw;
  return raw;
}
const seasonBump = (sp, doy) => (sp.season ? (doy >= sp.season[0] && doy <= sp.season[1] ? 1 : 0.85) : 1);
export const dayOfYear = (d = new Date()) => Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 86400000);

export function applyProfile(A, key, phField, doy) {
  const list = SPECIES[key] || SPECIES.autunnali, N = A.T.w * A.T.h;
  const H = new Float32Array(N), SP = new Uint8Array(N);
  for (let k = 0; k < N; k++) {
    const ph = phField ? phField[k] : null;
    let best = 0, bi = 0;
    for (let q = 0; q < list.length; q++) {
      const v = cell(A, list[q], k, ph, doy) * seasonBump(list[q], doy);
      if (v > best) (best = v), (bi = q);
    }
    H[k] = best;
    SP[k] = bi;
  }
  return { H, SP, list };
}

// dettagli di una cella (per la scheda del punto)
export function explain(A, key, lat, lon, ph, doy) {
  const T = A.T, [X, Y] = ll2px(T.z, lat, lon);
  const i = Math.floor((X - T.x0) / T.s), j = Math.floor((Y - T.y0) / T.s);
  if (i < 0 || j < 0 || i >= T.w || j >= T.h) return null;
  const k = j * T.w + i, list = SPECIES[key] || SPECIES.autunnali;
  let best = 0, bi = 0, bp = null;
  list.forEach((sp, q) => {
    const v = cell(A, sp, k, ph, doy) * seasonBump(sp, doy);
    if (v > best || !bp) (best = v), (bi = q), (bp = { ...parts });
  });
  const gens = [];
  for (let g = 0; g < NG; g++) gens.push([GEN[g], A.mix[k * NG + g] / 255]);
  gens.sort((a, b) => b[1] - a[1]);
  const code = A.L ? A.L.codes[k] : 0;
  return {
    alt: T.elev[k], slope: T.slope[k], asp: T.asp[k], tpi: T.tpi[k] === UNK ? null : T.tpi[k], code, forest: A.fo[k] / 255,
    trees: gens.filter((g) => g[1] >= 0.15).slice(0, 3).map((g) => GEN_NAME[g[0]]), H: Math.min(1, best), sp: list[bi], parts: bp, verified: !!A.L, src: A.src,
  };
}
export const probFrom = (W, H) => Math.round(W * (0.25 + 0.75 * Math.pow(Math.min(1, Math.max(0, H)), 0.7)));

// ---------- campo meteo per pixel (IDW sulle zone + correzione di quota stagionale) ----------
export function weatherField(A, zones, prof, doy) {
  const T = A.T, N = T.w * T.h, NL = 40;
  const lat = new Float32Array(NL * NL), W0 = new Float32Array(NL * NL), ZE = new Float32Array(NL * NL);
  for (let a = 0; a < NL; a++) {
    for (let b = 0; b < NL; b++) {
      const [la, lo] = px2ll(T.z, T.x0 + ((b + 0.5) / NL) * T.w * T.s, T.y0 + ((a + 0.5) / NL) * T.h * T.s);
      const cl = Math.cos(la * RAD);
      let w = 0, v = 0, e = 0;
      for (const q of zones) {
        const d2 = (q.lat - la) ** 2 + ((q.lon - lo) * cl) ** 2;
        const wi = 1 / (d2 + 0.02);
        w += wi; v += wi * q.score; e += wi * q.elev;
      }
      W0[a * NL + b] = v / w;
      ZE[a * NL + b] = e / w;
    }
  }
  const sfT = [];
  for (let e = 0; e <= 2600; e += 50) sfT.push(seasonFactor(doy, prof, e));
  const sf = (e) => sfT[clamp(Math.round(e / 50), 0, sfT.length - 1)];
  const out = new Float32Array(N);
  for (let j = 0; j < T.h; j++) {
    const fy = clamp((j / T.h) * NL - 0.5, 0, NL - 1.001), a0 = Math.floor(fy), ty = fy - a0;
    for (let i = 0; i < T.w; i++) {
      const fx = clamp((i / T.w) * NL - 0.5, 0, NL - 1.001), b0 = Math.floor(fx), tx = fx - b0;
      const g = (a, b, arr) => arr[(a0 + a) * NL + b0 + b];
      const bil = (arr) => (g(0, 0, arr) * (1 - tx) + g(0, 1, arr) * tx) * (1 - ty) + (g(1, 0, arr) * (1 - tx) + g(1, 1, arr) * tx) * ty;
      const w0 = bil(W0), ze = bil(ZE);
      const r = clamp(sf(T.elev[j * T.w + i]) / Math.max(0.15, sf(ze)), 0.5, 1.3);
      out[j * T.w + i] = clamp(w0 * r, 0, 100);
    }
  }
  return out;
}

// ---------- pH del suolo (SoilGrids), appreso a poco a poco ----------
let soilPts = null, soilBusy = false, soilFails = 0, soilLast = 0, soilCount = 0;
async function loadSoil() {
  if (!soilPts) soilPts = (await kvGet('soil:pts')) || [];
  return soilPts;
}
export async function soilField(A) {
  const pts = await loadSoil();
  if (!pts.length) return null;
  const T = A.T, NL = 24, lat = new Float32Array(NL * NL).fill(NaN);
  for (let a = 0; a < NL; a++) {
    for (let b = 0; b < NL; b++) {
      const [la, lo] = px2ll(T.z, T.x0 + ((b + 0.5) / NL) * T.w * T.s, T.y0 + ((a + 0.5) / NL) * T.h * T.s);
      const cl = Math.cos(la * RAD);
      let w = 0, v = 0;
      for (const p of pts) {
        const d2 = (p.lat - la) ** 2 + ((p.lon - lo) * cl) ** 2;
        if (d2 > 0.5 * 0.5) continue;
        const wi = 1 / (d2 + 0.005);
        w += wi; v += wi * p.ph;
      }
      if (w > 0) lat[a * NL + b] = v / w;
    }
  }
  const out = new Float32Array(T.w * T.h);
  for (let j = 0; j < T.h; j++) {
    const fy = clamp((j / T.h) * NL - 0.5, 0, NL - 1.001), a0 = Math.floor(fy), ty = fy - a0;
    for (let i = 0; i < T.w; i++) {
      const fx = clamp((i / T.w) * NL - 0.5, 0, NL - 1.001), b0 = Math.floor(fx), tx = fx - b0;
      const v = [lat[a0 * NL + b0], lat[a0 * NL + b0 + 1], lat[(a0 + 1) * NL + b0], lat[(a0 + 1) * NL + b0 + 1]];
      out[j * T.w + i] = v.some(isNaN) ? NaN : (v[0] * (1 - tx) + v[1] * tx) * (1 - ty) + (v[2] * (1 - tx) + v[3] * tx) * ty;
    }
  }
  return out;
}
export async function soilAt(lat, lon, fetchIfMissing = true) {
  const pts = await loadSoil();
  let near = null, bd = 0.0036; // ~6 km
  for (const p of pts) {
    const d = (p.lat - lat) ** 2 + ((p.lon - lon) * Math.cos(lat * RAD)) ** 2;
    if (d < bd) (bd = d), (near = p);
  }
  if (near || !fetchIfMissing) return near ? near.ph : null;
  return fetchSoil(lat, lon);
}
async function fetchSoil(lat, lon) {
  const j = await getJSON(`https://rest.isric.org/soilgrids/v2.0/properties/query?lon=${lon.toFixed(4)}&lat=${lat.toFixed(4)}&property=phh2o&depth=0-5cm&depth=5-15cm&value=mean`, 20000);
  const vals = (j.properties?.layers?.[0]?.depths || []).map((d) => d.values?.mean).filter((v) => v != null);
  if (!vals.length) throw new Error('pH n.d.');
  const ph = vals.reduce((a, b) => a + b, 0) / vals.length / 10;
  const pts = await loadSoil();
  pts.push({ lat: +lat.toFixed(3), lon: +lon.toFixed(3), ph: +ph.toFixed(2) });
  if (pts.length > 500) pts.shift();
  kvSet('soil:pts', pts);
  return ph;
}
// riempie in background i punti mancanti nell'area vista (1 richiesta ogni 13 s: limite del servizio)
export async function fillSoil(b, onNew) {
  if (soilBusy || soilFails >= 3 || soilCount >= 60 || Date.now() - soilLast < 13000) return;
  const pts = await loadSoil();
  const cx = (b.e + b.w) / 2, cy = (b.n + b.s) / 2, step = 0.22;
  const cands = [];
  for (let la = Math.floor(b.s / step) * step; la <= b.n; la += step) {
    for (let lo = Math.floor(b.w / step) * step; lo <= b.e; lo += step) {
      const x = la + step / 2, y = lo + step / 2;
      if (pts.some((p) => Math.abs(p.lat - x) < step * 0.7 && Math.abs(p.lon - y) < step * 0.7)) continue;
      cands.push([x, y, (x - cy) ** 2 + (y - cx) ** 2]);
    }
  }
  cands.sort((a, c) => a[2] - c[2]);
  if (!cands.length) return;
  soilBusy = true;
  soilLast = Date.now();
  try {
    await fetchSoil(cands[0][0], cands[0][1]);
    soilFails = 0;
    soilCount++;
    onNew && onNew();
  } catch (e) {
    soilFails++;
  } finally {
    soilBusy = false;
  }
}

// ---------- acqua vicina (OpenStreetMap) ----------
export async function waterNear(lat, lon) {
  const q = `[out:json][timeout:12];way(around:500,${lat.toFixed(5)},${lon.toFixed(5)})[waterway~"^(river|stream|brook|canal|ditch|drain)$"];out geom 15;`;
  const j = await getJSON('https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(q), 14000);
  let best = null;
  const cl = Math.cos(lat * RAD);
  for (const w of j.elements || []) {
    const g = w.geometry || [];
    for (let i = 0; i < g.length; i++) {
      const ax = (g[i].lon - lon) * 111320 * cl, ay = (g[i].lat - lat) * 110540;
      let d = Math.hypot(ax, ay);
      if (i + 1 < g.length) {
        const bx = (g[i + 1].lon - lon) * 111320 * cl, by = (g[i + 1].lat - lat) * 110540;
        const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
        const t = l2 ? clamp(-(ax * dx + ay * dy) / l2, 0, 1) : 0;
        d = Math.hypot(ax + t * dx, ay + t * dy);
      }
      if (!best || d < best.m) best = { m: Math.round(d), kind: (w.tags && w.tags.waterway) || 'stream' };
    }
  }
  return best && best.m <= 600 ? best : null;
}
export const FORECAST_DAYS = FORECAST;

// migliore zona nei dintorni (cella con probabilità più alta dopo una media 5x5), entro ~3 km
export function bestNear(A, key, ph, doy, lat, lon, W) {
  const T = A.T, N = T.w * T.h;
  const phf = ph ? new Float32Array(N).fill(ph) : null;
  const { H } = applyProfile(A, key, phf, doy);
  const R = 2, S = new Float32Array(N);
  for (let j = 0; j < T.h; j++) {
    for (let i = 0; i < T.w; i++) {
      let s = 0, n = 0;
      for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
        const a = i + di, b = j + dj;
        if (a >= 0 && b >= 0 && a < T.w && b < T.h) (s += H[b * T.w + a]), n++;
      }
      S[j * T.w + i] = s / n;
    }
  }
  const cl = Math.cos(lat * RAD);
  let best = null;
  for (let j = 0; j < T.h; j++) {
    for (let i = 0; i < T.w; i++) {
      const [la, lo] = px2ll(T.z, T.x0 + (i + 0.5) * T.s, T.y0 + (j + 0.5) * T.s);
      const dx = (lo - lon) * 111320 * cl, dy = (la - lat) * 110540, d = Math.hypot(dx, dy);
      if (d > 3000) continue;
      const v = S[j * T.w + i] - d / 60000; // a parità di habitat preferisce il più vicino
      if (!best || v > best.v) best = { v, H: S[j * T.w + i], lat: la, lon: lo, dist: Math.round(d), brg: (Math.atan2(dx, dy) / RAD + 360) % 360, k: j * T.w + i };
    }
  }
  if (!best) return null;
  best.prob = probFrom(W, best.H);
  return best;
}

// conferma dal diario: entro 1 km da un tuo ritrovamento (stessa specie, stessa stagione) il punteggio sale del 20-35%
export function confirmField(A, spots) {
  const T = A.T, N = T.w * T.h, out = new Float32Array(N).fill(1);
  if (!spots.length) return out;
  const rad = Math.ceil(1000 / T.cell) + 1, cnt = new Uint8Array(N);
  for (const s of spots) {
    const [X, Y] = ll2px(T.z, s.lat, s.lon), ci = (X - T.x0) / T.s, cj = (Y - T.y0) / T.s;
    if (ci < -rad || cj < -rad || ci > T.w + rad || cj > T.h + rad) continue;
    for (let j = Math.max(0, Math.floor(cj - rad)); j <= Math.min(T.h - 1, Math.ceil(cj + rad)); j++) {
      for (let i = Math.max(0, Math.floor(ci - rad)); i <= Math.min(T.w - 1, Math.ceil(ci + rad)); i++) {
        if (Math.hypot(i - ci, j - cj) * T.cell <= 1000) cnt[j * T.w + i] = Math.min(4, cnt[j * T.w + i] + 1);
      }
    }
  }
  for (let k = 0; k < N; k++) if (cnt[k]) out[k] = 1.2 + 0.05 * (cnt[k] - 1);
  return out;
}
