import L from 'leaflet';
import { get, set, del } from 'idb-keyval';
import { tileStore, kvGet, kvSet } from './store.js';
import { uid, sleep, bus } from './util.js';
import { getVecTile } from './reflayer.js';

export const SOURCES = {
  sat: {
    id: 'sat',
    name: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    maxNative: 18,
    attr: 'Immagini © Esri, Maxar, Earthstar Geographics',
  },
  topo: {
    id: 'topo',
    name: 'Topografica',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    subdomains: 'abc',
    maxNative: 17,
    attr: '© OpenStreetMap, SRTM | © OpenTopoMap (CC-BY-SA)',
  },
  trails: {
    id: 'trails',
    name: 'Sentieri e percorsi CAI',
    url: 'https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png',
    maxNative: 18,
    overlay: true,
    attr: 'Sentieri © waymarkedtrails.org (CC-BY-SA)',
  },
};

export const tileKey = (src, z, x, y) => `${src}/${z}/${x}/${y}`;

function fillUrl(src, z, x, y) {
  const s = SOURCES[src];
  const sub = s.subdomains ? s.subdomains[(x + y) % s.subdomains.length] : '';
  return s.url.replace('{s}', sub).replace('{z}', z).replace('{x}', x).replace('{y}', y);
}

// Layer che legge prima dalla cache offline
export const CachedTileLayer = L.TileLayer.extend({
  createTile(coords, done) {
    const tile = document.createElement('img');
    tile.alt = '';
    tile.setAttribute('role', 'presentation');
    const src = this.options.srcId;
    const z = coords.z;
    const n = 1 << z;
    const x = ((coords.x % n) + n) % n;
    const y = coords.y;
    const net = () => {
      tile.onload = () => done(null, tile);
      tile.onerror = () => done(null, tile);
      tile.src = fillUrl(src, z, x, y);
    };
    get(tileKey(src, z, x, y), tileStore)
      .then((blob) => {
        if (!blob) return net();
        const u = URL.createObjectURL(blob);
        const fin = () => {
          URL.revokeObjectURL(u);
          done(null, tile);
        };
        tile.onload = fin;
        tile.onerror = fin;
        tile.src = u;
      })
      .catch(net);
    return tile;
  },
});

export function makeLayer(srcId, opts = {}) {
  const s = SOURCES[srcId];
  return new CachedTileLayer(s.url, {
    srcId,
    maxZoom: 20,
    maxNativeZoom: s.maxNative,
    attribution: s.attr,
    crossOrigin: false,
    ...opts,
  });
}

// ---------- calcolo tile ----------
const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};
export function tileRange(b, z) {
  const x0 = lon2x(b.west, z), x1 = lon2x(b.east, z);
  const y0 = lat2y(b.north, z), y1 = lat2y(b.south, z);
  return { x0: Math.min(x0, x1), x1: Math.max(x0, x1), y0: Math.min(y0, y1), y1: Math.max(y0, y1) };
}
export function countTiles(b, zmin, zmax) {
  let n = 0;
  for (let z = zmin; z <= zmax; z++) {
    const r = tileRange(b, z);
    n += (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
  }
  return n;
}
function* iterTiles(b, zmin, zmax) {
  for (let z = zmin; z <= zmax; z++) {
    const r = tileRange(b, z);
    for (let x = r.x0; x <= r.x1; x++) for (let y = r.y0; y <= r.y1; y++) yield { z, x, y };
  }
}

// ---------- aree scaricate ----------
export const listAreas = async () => (await kvGet('areas')) || [];

export const MAX_TILES = 14000;

export async function downloadArea({ name, bounds, zmin, zmax, sources, onProgress, signal }) {
  const total = countTiles(bounds, zmin, zmax) * sources.length;
  if (total > MAX_TILES) throw new Error(`Area troppo grande (${total} tile). Riduci l'area o lo zoom.`);
  const jobs = [];
  for (const src of sources) for (const t of iterTiles(bounds, zmin, zmax)) jobs.push({ src, ...t });
  let done = 0, fail = 0, bytes = 0;
  let idx = 0;
  const worker = async () => {
    while (idx < jobs.length) {
      if (signal && signal.aborted) return;
      const j = jobs[idx++];
      const key = tileKey(j.src, j.z, j.x, j.y);
      try {
        const have = await get(key, tileStore);
        if (have) {
          bytes += have.size;
        } else {
          let ok = false;
          for (let a = 0; a < 2 && !ok; a++) {
            try {
              const r = await fetch(fillUrl(j.src, j.z, j.x, j.y), { signal });
              if (r.ok) {
                const blob = await r.blob();
                if (blob.size > 0) {
                  await set(key, blob, tileStore);
                  bytes += blob.size;
                  ok = true;
                }
              } else if (r.status === 404) break;
            } catch (e) {
              if (signal && signal.aborted) return;
              await sleep(300);
            }
          }
          if (!ok) fail++;
          await sleep(15);
        }
      } catch {
        fail++;
      }
      done++;
      if (done % 10 === 0 || done === jobs.length) onProgress && onProgress({ done, total, fail, bytes });
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  const aborted = signal && signal.aborted;
  let vec = false;
  if (!aborted) vec = await downloadVec(bounds, zmin, signal).catch(() => false);
  if (!aborted) {
    const areas = await listAreas();
    areas.push({ id: uid(), name, bounds, zmin, zmax, sources, tiles: total - fail, bytes, vec, created: Date.now() });
    await kvSet('areas', areas);
  }
  return { done, total, fail, bytes, aborted };
}

// Nomi (tile vettoriali) delle aree scaricate: zoom bassi fino a 12, bastano per paesi, cime e laghi a ogni ingrandimento
export async function downloadVec(bounds, zmin, signal) {
  const lo = Math.max(4, Math.min(zmin - 1, 12));
  let n = 0;
  const jobs = [];
  for (const t of iterTiles(bounds, lo, 12)) { jobs.push(t); if (++n > 4000) break; }
  let idx = 0, fail = 0;
  const worker = async () => {
    while (idx < jobs.length) {
      if (signal && signal.aborted) return;
      const j = jobs[idx++];
      try { if (!(await getVecTile(j.z, j.x, j.y, signal))) fail++; } catch { fail++; }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return fail === 0;
}
export async function fillVecForAreas() {
  if (!navigator.onLine) return;
  const areas = await listAreas();
  let ch = false;
  for (const a of areas) {
    if (a.vec) continue;
    if (await downloadVec(a.bounds, a.zmin)) { a.vec = true; ch = true; }
  }
  if (ch) await kvSet('areas', areas);
}

export async function deleteArea(id) {
  const areas = await listAreas();
  const target = areas.find((a) => a.id === id);
  if (!target) return;
  const rest = areas.filter((a) => a.id !== id);
  const keep = new Set();
  for (const a of rest) for (const s of a.sources) for (const t of iterTiles(a.bounds, a.zmin, a.zmax)) keep.add(tileKey(s, t.z, t.x, t.y));
  for (const s of target.sources) {
    for (const t of iterTiles(target.bounds, target.zmin, target.zmax)) {
      const k = tileKey(s, t.z, t.x, t.y);
      if (!keep.has(k)) await del(k, tileStore);
    }
  }
  await kvSet('areas', rest);
}

export const fmtMB = (b) => (b / 1048576 >= 10 ? Math.round(b / 1048576) : (b / 1048576).toFixed(1)) + ' MB';
export const estimateBytes = (tiles, srcs) => tiles * srcs.reduce((a, s) => a + (s === 'sat' ? 22000 : s === 'topo' ? 18000 : 4000), 0);

// ---------- coda di download in background ----------
let queue = [];
let current = null; // { job, ctrl }
let qLoaded = false;
export const getQueue = () => queue;
const persist = () => kvSet('dlqueue', queue.map((j) => ({ ...j, status: 'queued' })));
const emit = () => bus.emit('dl:update', queue);

export async function initQueue() {
  if (qLoaded) return;
  qLoaded = true;
  setTimeout(() => fillVecForAreas().catch(() => {}), 25000);
  queue = ((await kvGet('dlqueue')) || []).map((j) => ({ ...j, status: 'queued', done: 0 }));
  emit();
  pump();
}
export async function enqueueDownload(job) {
  await initQueue();
  const total = countTiles(job.bounds, job.zmin, job.zmax) * job.sources.length;
  if (total > MAX_TILES) throw new Error(`Area troppo grande (${total} tile).`);
  queue.push({ id: uid(), status: 'queued', done: 0, total, bytes: 0, fail: 0, ...job });
  persist();
  emit();
  pump();
}
export function cancelDownload(id) {
  if (current && current.job.id === id) current.ctrl.abort();
  queue = queue.filter((j) => j.id !== id);
  persist();
  emit();
}
async function pump() {
  if (current) return;
  const job = queue.find((j) => j.status === 'queued');
  if (!job) return;
  job.status = 'running';
  const ctrl = new AbortController();
  current = { job, ctrl };
  emit();
  try {
    const r = await downloadArea({
      name: job.name, bounds: job.bounds, zmin: job.zmin, zmax: job.zmax, sources: job.sources, signal: ctrl.signal,
      onProgress: (p) => { job.done = p.done; job.total = p.total; job.bytes = p.bytes; job.fail = p.fail; emit(); },
    });
    if (!r.aborted) bus.emit('dl:done', { name: job.name, bytes: r.bytes, fail: r.fail });
  } catch (e) {
    bus.emit('dl:error', { name: job.name, msg: String(e.message || e) });
  }
  queue = queue.filter((j) => j !== job);
  current = null;
  persist();
  emit();
  pump();
}
