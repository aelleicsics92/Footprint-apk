// Radar della Protezione Civile (Radar-DPC, CC BY-SA 4.0): mosaico nazionale SRI (mm/h), pixel da 1 km, aggiornato ogni 5 minuti.
import { Capacitor, CapacitorHttp } from '@capacitor/core';

const API = 'https://radar-api.protezionecivile.it';
const HDR = { Origin: 'https://radar.protezionecivile.it', Referer: 'https://radar.protezionecivile.it/' };

// ---- rete: su Android richiesta nativa (nessun CORS, Origin impostabile), nel browser fetch ----
async function native(method, url, body, bin) {
  const r = await CapacitorHttp.request({ url, method, headers: { ...HDR, ...(body ? { 'Content-Type': 'application/json' } : {}) }, data: body, responseType: bin ? 'blob' : 'json', connectTimeout: 10000, readTimeout: 20000 });
  if (r.status < 200 || r.status >= 300) throw new Error('http ' + r.status);
  if (!bin) return r.data;
  const s = atob(r.data), u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}
async function web(method, url, body, bin) {
  const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error('http ' + r.status);
  return bin ? new Uint8Array(await r.arrayBuffer()) : r.json();
}
const net = (...a) => (Capacitor.isNativePlatform() ? native(...a) : web(...a));

export async function lastTime() {
  const j = await net('GET', `${API}/findLastProductByType?type=SRI`);
  const t = j && j.lastProducts && j.lastProducts[0] && j.lastProducts[0].time;
  if (!t) throw new Error('no time');
  return t;
}
export async function downloadSri(time) {
  const j = await net('POST', `${API}/downloadProduct`, { productType: 'SRI', productDate: time });
  if (!j || !j.url) throw new Error('no url');
  return net('GET', j.url, null, true);
}

// ---- TIFF (un solo canale float32, strisce, LZW/non compresso) ----
function lzw(src, out) {
  let pos = 0, bits = 0, nb = 0, o = 0;
  const tab = new Array(4096);
  let next = 258, w = 9, prev = null;
  const read = () => {
    while (nb < w) { if (pos >= src.length) return 257; bits = ((bits << 8) | src[pos++]) >>> 0; nb += 8; }
    const c = (bits >>> (nb - w)) & ((1 << w) - 1);
    nb -= w;
    bits &= (1 << nb) - 1;
    return c;
  };
  const emit = (a) => { for (let i = 0; i < a.length && o < out.length; i++) out[o++] = a[i]; };
  for (;;) {
    const c = read();
    if (c === 257) break;
    if (c === 256) { tab.length = 0; next = 258; w = 9; prev = null; continue; }
    let e;
    if (c < 256) e = [c];
    else if (tab[c]) e = tab[c];
    else if (c === next && prev) e = prev.concat(prev[0]);
    else break;
    emit(e);
    if (prev) tab[next++] = prev.concat(e[0]);
    prev = e;
    if (next >= 4095) { /* tabella piena: attende il clear */ } else if (next + 1 >= 2048) w = 12; else if (next + 1 >= 1024) w = 11; else if (next + 1 >= 512) w = 10;
    if (o >= out.length) break;
  }
  return o;
}
export function parseTiff(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const le = u8[0] === 0x49;
  const g16 = (o) => dv.getUint16(o, le), g32 = (o) => dv.getUint32(o, le);
  if (g16(2) !== 42) throw new Error('non tiff');
  let ifd = g32(4);
  const n = g16(ifd), tags = {};
  const SZ = { 1: 1, 3: 2, 4: 4, 8: 2, 9: 4 };
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12, tag = g16(e), type = g16(e + 2), cnt = g32(e + 4), sz = (SZ[type] || 1) * cnt;
    let off = sz <= 4 ? e + 8 : g32(e + 8);
    const vals = [];
    for (let k = 0; k < cnt; k++) vals.push(type === 3 ? g16(off + k * 2) : type === 4 ? g32(off + k * 4) : u8[off + k]);
    tags[tag] = vals;
  }
  const W = tags[256][0], H = tags[257][0], comp = (tags[259] || [1])[0], rps = (tags[278] || [H])[0], offs = tags[273], cnts = tags[279];
  if ((tags[317] || [1])[0] !== 1) throw new Error('predictor non supportato');
  if ((tags[258] || [32])[0] !== 32) throw new Error('bit non supportati');
  const out = new Uint8Array(W * H * 4);
  let row = 0;
  for (let s = 0; s < offs.length; s++) {
    const rows = Math.min(rps, H - row), need = rows * W * 4, seg = u8.subarray(offs[s], offs[s] + cnts[s]);
    const dst = out.subarray(row * W * 4, row * W * 4 + need);
    if (comp === 1) dst.set(seg.subarray(0, need));
    else if (comp === 5) lzw(seg, dst);
    else throw new Error('compressione ' + comp);
    row += rows;
  }
  const f = new Float32Array(W * H), v = new DataView(out.buffer);
  for (let i = 0; i < f.length; i++) f[i] = v.getFloat32(i * 4, le);
  return { W, H, data: f };
}

// ---- proiezione Transverse Mercator (WGS84, lat0 42, lon0 12.5, k0 1) ----
const A = 6378137, F = 1 / 298.257223563, E2 = F * (2 - F), EP2 = E2 / (1 - E2), D = Math.PI / 180;
const mer = (p) => A * ((1 - E2 / 4 - (3 * E2 * E2) / 64 - (5 * E2 ** 3) / 256) * p - ((3 * E2) / 8 + (3 * E2 * E2) / 32 + (45 * E2 ** 3) / 1024) * Math.sin(2 * p) + ((15 * E2 * E2) / 256 + (45 * E2 ** 3) / 1024) * Math.sin(4 * p) - ((35 * E2 ** 3) / 3072) * Math.sin(6 * p));
const M0 = mer(42 * D);
export function tmerc(lat, lon) {
  const p = lat * D, s = Math.sin(p), c = Math.cos(p), t = Math.tan(p), T = t * t, C = EP2 * c * c, N = A / Math.sqrt(1 - E2 * s * s), a = (lon - 12.5) * D * c;
  const x = N * (a + ((1 - T + C) * a ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * EP2) * a ** 5) / 120);
  const y = mer(p) - M0 + N * t * ((a * a) / 2 + ((5 - T + 9 * C + 4 * C * C) * a ** 4) / 24 + ((61 - 58 * T + T * T + 600 * C - 330 * EP2) * a ** 6) / 720);
  return [x, y];
}
// griglia SRI: x = -600000 + col*1000, y = 650000 - row*1000, 1200 x 1400
const toColRow = (lat, lon) => { const [x, y] = tmerc(lat, lon); return [(x + 600000) / 1000, (650000 - y) / 1000]; };

let MAP = null;
// Mappa di riproiezione verso un'immagine in Mercatore, calcolata una volta sola
export function buildMap(W0 = 1200, H0 = 1400) {
  if (MAP) return MAP;
  let s = 90, n = -90, w = 180, e = -180;
  for (let la = 33; la <= 49; la += 0.05) for (let lo = 4; lo <= 22; lo += 0.05) {
    const [c, r] = toColRow(la, lo);
    if (c >= 0 && c < W0 && r >= 0 && r < H0) { s = Math.min(s, la); n = Math.max(n, la); w = Math.min(w, lo); e = Math.max(e, lo); }
  }
  s -= 0.05; n += 0.05; w -= 0.05; e += 0.05;
  const merc = (la) => Math.log(Math.tan(Math.PI / 4 + (la * D) / 2)), mS = merc(s), mN = merc(n);
  const W = Math.round((e - w) * 85), H = Math.round((W * (mN - mS)) / ((e - w) * D));
  const idx = new Float32Array(W * H * 2);
  for (let y = 0; y < H; y++) {
    const m = mN - ((mN - mS) * (y + 0.5)) / H, la = (2 * Math.atan(Math.exp(m)) - Math.PI / 2) / D;
    for (let x = 0; x < W; x++) {
      const lo = w + ((e - w) * (x + 0.5)) / W, [c, r] = toColRow(la, lo), o = (y * W + x) * 2;
      idx[o] = c - 0.5; idx[o + 1] = r - 0.5;
    }
  }
  MAP = { s, n, w, e, W, H, idx, W0, H0 };
  return MAP;
}
// SRI -> immagine RGBA (colorFn(mm/h) -> [r,g,b,a 0..1]); interpolazione bilineare
export function renderSri(tif, colorFn) {
  const m = buildMap(tif.W, tif.H), { W, H, idx } = m, d = tif.data, w0 = tif.W, h0 = tif.H;
  const px = new Uint8ClampedArray(W * H * 4);
  const val = (c, r) => { const v = d[r * w0 + c]; return v > 0 ? v : 0; };
  for (let i = 0; i < W * H; i++) {
    const c = idx[i * 2], r = idx[i * 2 + 1];
    if (c < -0.5 || r < -0.5 || c > w0 - 0.5 || r > h0 - 0.5) continue;
    const c0 = Math.max(0, Math.min(w0 - 2, Math.floor(c))), r0 = Math.max(0, Math.min(h0 - 2, Math.floor(r))), tx = Math.max(0, Math.min(1, c - c0)), ty = Math.max(0, Math.min(1, r - r0));
    const raw = d[r0 * w0 + c0];
    if (raw <= -9000) continue; // fuori copertura
    const v = (val(c0, r0) * (1 - tx) + val(c0 + 1, r0) * tx) * (1 - ty) + (val(c0, r0 + 1) * (1 - tx) + val(c0 + 1, r0 + 1) * tx) * ty;
    const k = colorFn(v);
    if (k[3] <= 0) continue;
    px[i * 4] = k[0]; px[i * 4 + 1] = k[1]; px[i * 4 + 2] = k[2]; px[i * 4 + 3] = Math.round(k[3] * 255);
  }
  return { W, H, px, bounds: [[m.s, m.w], [m.n, m.e]] };
}
