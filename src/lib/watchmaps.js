// Invio delle mappe offline al watch: tile della zona impacchettati in un ZIP (senza compressione) e spediti via Bluetooth
import { get } from 'idb-keyval';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { tileStore } from './store.js';
import { tileRange, tileKey, SOURCES, countTiles } from './offline.js';
import { createLabelRenderer } from './reflayer.js';

const IF = () => (Capacitor.Plugins && Capacitor.Plugins.IntentFiles) || registerPlugin('IntentFiles');

// Dimensione media di un tile (byte) per la stima prima dell'invio
export const TILE_AVG = { sat: 22000, topo: 18000 };
export const DETAIL = [
  [15, 'Leggera (fino a zoom 15)'],
  [16, 'Media (fino a zoom 16)'],
  [17, 'Massima (fino a zoom 17)'],
];

// Strati utilizzabili sul watch (i sovrapposti come i sentieri no)
export const watchSources = (a) => (a.sources || []).filter((s) => SOURCES[s] && !SOURCES[s].overlay);
export const pickSource = (a, want) => {
  const l = watchSources(a);
  return l.includes(want) ? want : l[0] || null;
};
export const zoomLimit = (a, maxZ) => Math.min(a.zmax, maxZ);
export const estimateWatchBytes = (a, src, maxZ) => {
  if (!src || zoomLimit(a, maxZ) < a.zmin) return 0;
  return countTiles(a.bounds, a.zmin, zoomLimit(a, maxZ)) * (TILE_AVG[src] || 20000);
};
export const estimateMinutes = (bytes) => Math.max(1, Math.round(bytes / 60000 / 60));

// ---- ZIP "stored" (senza compressione) ----
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

class ZipOut {
  constructor(path) {
    this.path = path;
    this.parts = [];
    this.size = 0; // byte nel buffer corrente
    this.offset = 0; // byte totali scritti
    this.entries = [];
    this.first = true;
    this.enc = new TextEncoder();
  }
  _push(u8) {
    this.parts.push(u8);
    this.size += u8.length;
    this.offset += u8.length;
  }
  async _flush() {
    if (!this.parts.length) return;
    const blob = new Blob(this.parts);
    const b64 = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(',')[1] || '');
      r.onerror = () => rej(r.error);
      r.readAsDataURL(blob);
    });
    this.parts = [];
    this.size = 0;
    if (this.first) {
      await Filesystem.writeFile({ path: this.path, data: b64, directory: Directory.Cache, recursive: true });
      this.first = false;
    } else {
      await Filesystem.appendFile({ path: this.path, data: b64, directory: Directory.Cache });
    }
  }
  async add(name, data) {
    const nm = this.enc.encode(name);
    const crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 0, true);
    h.setUint16(8, 0, true);
    h.setUint16(10, 0, true);
    h.setUint16(12, 33, true);
    h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true);
    h.setUint32(22, data.length, true);
    h.setUint16(26, nm.length, true);
    h.setUint16(28, 0, true);
    this.entries.push({ nm, crc, len: data.length, off: this.offset });
    this._push(new Uint8Array(h.buffer));
    this._push(nm);
    this._push(data);
    if (this.size > 1500000) await this._flush();
  }
  async finish() {
    const cdOff = this.offset;
    let cdSize = 0;
    for (const e of this.entries) {
      const h = new DataView(new ArrayBuffer(46));
      h.setUint32(0, 0x02014b50, true);
      h.setUint16(4, 20, true);
      h.setUint16(6, 20, true);
      h.setUint16(8, 0, true);
      h.setUint16(10, 0, true);
      h.setUint16(12, 0, true);
      h.setUint16(14, 33, true);
      h.setUint32(16, e.crc, true);
      h.setUint32(20, e.len, true);
      h.setUint32(24, e.len, true);
      h.setUint16(28, e.nm.length, true);
      h.setUint32(42, e.off, true);
      this._push(new Uint8Array(h.buffer));
      this._push(e.nm);
      cdSize += 46 + e.nm.length;
    }
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, this.entries.length, true);
    end.setUint16(10, this.entries.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, cdOff, true);
    this._push(new Uint8Array(end.buffer));
    await this._flush();
  }
}

const extOf = (t) => (t === 'image/jpeg' ? 'jpg' : t === 'image/webp' ? 'webp' : 'png');

/**
 * Prepara lo ZIP dei tile dell'area e lo invia al watch.
 * onPhase('prep', fatti, totali) durante la preparazione, onPhase('send') durante il trasferimento.
 */
export async function sendAreaToWatch(a, { src, maxZ, onPhase }) {
  const zl = zoomLimit(a, maxZ);
  const total = countTiles(a.bounds, a.zmin, zl);
  const path = 'watchmap/area.zip';
  try { await Filesystem.deleteFile({ path, directory: Directory.Cache }); } catch {}
  const zip = new ZipOut(path);
  await zip.add('meta.json', new TextEncoder().encode(JSON.stringify({ id: a.id, name: a.name, src })));
  // satellite: si incollano i nomi (paesi, monti, acque) sopra ogni tile
  let lab = null, cv = null, cx = null;
  if (src === 'sat') {
    try {
      lab = await createLabelRenderer(512);
      cv = document.createElement('canvas');
      cv.width = cv.height = 256;
      cx = cv.getContext('2d');
    } catch { lab = null; }
  }
  const withLabels = async (blob, z, x, y) => {
    try {
      const bmp = await createImageBitmap(blob);
      cx.clearRect(0, 0, 256, 256);
      cx.drawImage(bmp, 0, 0, 256, 256);
      if (bmp.close) bmp.close();
      await lab.draw(cx, z, x, y);
      const out = await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.82));
      return out ? { buf: new Uint8Array(await out.arrayBuffer()), ext: 'jpg' } : null;
    } catch { return null; }
  };
  let done = 0, have = 0;
  for (let z = a.zmin; z <= zl; z++) {
    const r = tileRange(a.bounds, z);
    for (let x = r.x0; x <= r.x1; x++) {
      for (let y = r.y0; y <= r.y1; y++) {
        done++;
        const blob = await get(tileKey(src, z, x, y), tileStore);
        if (blob) {
          let buf = null, ext = extOf(blob.type);
          if (lab) {
            const r = await withLabels(blob, z, x, y);
            if (r) { buf = r.buf; ext = r.ext; }
          }
          if (!buf) buf = new Uint8Array(await blob.arrayBuffer());
          await zip.add(`${z}/${x}/${y}.${ext}`, buf);
          have++;
        }
        if (done % 60 === 0) onPhase && onPhase('prep', done, total);
      }
    }
  }
  if (lab) lab.remove();
  if (!have) throw new Error('nessun tile salvato per questa zona e questo strato');
  await zip.finish();
  onPhase && onPhase('send', total, total);
  const u = await Filesystem.getUri({ path, directory: Directory.Cache });
  await IF().watchSendFile({ path: u.uri });
  try { await Filesystem.deleteFile({ path, directory: Directory.Cache }); } catch {}
  return { tiles: have, bytes: zip.offset };
}
