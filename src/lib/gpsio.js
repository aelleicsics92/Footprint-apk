import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { esc, uid } from './util.js';
import { GARMIN_SYM, WP_BY_ID } from './icons.js';

const iso = (t) => new Date(t || Date.now()).toISOString();

// ---------- Esportazione GPX 1.1 (compatibile Garmin e tutti i GPS) ----------
export function toGPX({ waypoints = [], tracks = [], name = 'Footprint' }) {
  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<gpx version="1.1" creator="Footprint" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">');
  out.push(`<metadata><name>${esc(name)}</name><time>${iso()}</time></metadata>`);
  for (const w of waypoints) {
    out.push(`<wpt lat="${w.lat.toFixed(7)}" lon="${w.lon.toFixed(7)}">`);
    if (w.alt != null) out.push(`<ele>${Number(w.alt).toFixed(1)}</ele>`);
    out.push(`<time>${iso(w.ts)}</time><name>${esc(w.title)}</name>`);
    if (w.desc) out.push(`<desc>${esc(w.desc)}</desc>`);
    out.push(`<sym>${esc(GARMIN_SYM[w.icon] || 'Flag, Blue')}</sym><type>Footprint/${esc(w.icon || 'fungo')}</type>`);
    out.push('</wpt>');
  }
  for (const t of tracks) {
    out.push(`<trk><name>${esc(t.name)}</name><trkseg>`);
    for (const p of t.points) {
      out.push(`<trkpt lat="${p[0].toFixed(7)}" lon="${p[1].toFixed(7)}">${p[2] != null ? `<ele>${Number(p[2]).toFixed(1)}</ele>` : ''}<time>${iso(p[3])}</time></trkpt>`);
    }
    out.push('</trkseg></trk>');
  }
  out.push('</gpx>');
  return out.join('\n');
}

// ---------- Importazione: GPX, KML, GeoJSON, TCX, LOC ----------
const num = (v) => (v == null || v === '' || isNaN(Number(v)) ? null : Number(v));
const txt = (el, tag) => {
  const n = el.getElementsByTagName(tag)[0];
  return n ? n.textContent.trim() : '';
};
const guessIcon = (type, sym, name) => {
  if (type && type.startsWith('Footprint/')) {
    const id = type.slice(10);
    if (WP_BY_ID[id]) return id;
  }
  const s = (sym || '').toLowerCase();
  const n = (name || '').toLowerCase();
  if (s.includes('park')) return 'parcheggio';
  if (s.includes('water') || s.includes('spring')) return 'acqua';
  if (s.includes('danger') || s.includes('skull')) return 'pericolo';
  if (s.includes('scenic') || s.includes('summit')) return 'panorama';
  if (s.includes('trail')) return 'orma';
  if (n.includes('porcin')) return 'porcino';
  if (n.includes('tartuf')) return 'bianco';
  return 'fungo';
};

function parseGPX(doc) {
  const waypoints = [], tracks = [];
  for (const w of Array.from(doc.getElementsByTagName('wpt'))) {
    const lat = num(w.getAttribute('lat')), lon = num(w.getAttribute('lon'));
    if (lat == null || lon == null) continue;
    const name = txt(w, 'name') || 'Waypoint';
    const t = txt(w, 'time');
    waypoints.push({
      id: uid(), title: name, desc: txt(w, 'desc') || txt(w, 'cmt'), lat, lon, alt: num(txt(w, 'ele')),
      ts: t ? Date.parse(t) || Date.now() : Date.now(), icon: guessIcon(txt(w, 'type'), txt(w, 'sym'), name),
    });
  }
  const segs = [];
  for (const trk of Array.from(doc.getElementsByTagName('trk'))) {
    const name = txt(trk, 'name') || 'Traccia importata';
    const pts = [];
    for (const p of Array.from(trk.getElementsByTagName('trkpt'))) {
      const lat = num(p.getAttribute('lat')), lon = num(p.getAttribute('lon'));
      if (lat == null || lon == null) continue;
      const t = txt(p, 'time');
      pts.push([lat, lon, num(txt(p, 'ele')), t ? Date.parse(t) || 0 : 0]);
    }
    segs.push({ name, pts });
  }
  for (const rte of Array.from(doc.getElementsByTagName('rte'))) {
    const name = txt(rte, 'name') || 'Percorso importato';
    const pts = [];
    for (const p of Array.from(rte.getElementsByTagName('rtept'))) {
      const lat = num(p.getAttribute('lat')), lon = num(p.getAttribute('lon'));
      if (lat != null && lon != null) pts.push([lat, lon, num(txt(p, 'ele')), 0]);
    }
    segs.push({ name, pts });
  }
  for (const s of segs) if (s.pts.length > 1) tracks.push(buildTrack(s.name, s.pts));
  return { waypoints, tracks };
}

function parseKML(doc) {
  const waypoints = [], tracks = [];
  for (const pm of Array.from(doc.getElementsByTagName('Placemark'))) {
    const name = txt(pm, 'name') || 'Punto';
    const desc = txt(pm, 'description').replace(/<[^>]+>/g, '').slice(0, 300);
    const pt = pm.getElementsByTagName('Point')[0];
    if (pt) {
      const c = txt(pt, 'coordinates').split(',').map(Number);
      if (c.length >= 2 && !isNaN(c[0]) && !isNaN(c[1])) waypoints.push({ id: uid(), title: name, desc, lat: c[1], lon: c[0], alt: isNaN(c[2]) ? null : c[2], ts: Date.now(), icon: guessIcon('', '', name) });
    }
    for (const ls of Array.from(pm.getElementsByTagName('LineString'))) {
      const pts = txt(ls, 'coordinates').split(/\s+/).map((s) => s.split(',').map(Number)).filter((c) => c.length >= 2 && !isNaN(c[0]) && !isNaN(c[1])).map((c) => [c[1], c[0], isNaN(c[2]) ? null : c[2], 0]);
      if (pts.length > 1) tracks.push(buildTrack(name, pts));
    }
  }
  return { waypoints, tracks };
}

function parseGeoJSON(obj) {
  const waypoints = [], tracks = [];
  const feats = obj.type === 'FeatureCollection' ? obj.features : obj.type === 'Feature' ? [obj] : [{ type: 'Feature', geometry: obj, properties: {} }];
  for (const f of feats) {
    const g = f.geometry; if (!g) continue;
    const name = (f.properties && (f.properties.name || f.properties.title)) || 'Importato';
    const line = (coords) => coords.map((c) => [c[1], c[0], c[2] ?? null, 0]);
    if (g.type === 'Point') waypoints.push({ id: uid(), title: name, desc: (f.properties && f.properties.description) || '', lat: g.coordinates[1], lon: g.coordinates[0], alt: g.coordinates[2] ?? null, ts: Date.now(), icon: 'fungo' });
    else if (g.type === 'LineString') tracks.push(buildTrack(name, line(g.coordinates)));
    else if (g.type === 'MultiLineString') g.coordinates.forEach((c, i) => tracks.push(buildTrack(`${name} ${i + 1}`, line(c))));
  }
  return { waypoints, tracks: tracks.filter((t) => t.points.length > 1) };
}

function parseTCX(doc) {
  const pts = [];
  for (const tp of Array.from(doc.getElementsByTagName('Trackpoint'))) {
    const lat = num(txt(tp, 'LatitudeDegrees')), lon = num(txt(tp, 'LongitudeDegrees'));
    if (lat == null || lon == null) continue;
    const t = txt(tp, 'Time');
    pts.push([lat, lon, num(txt(tp, 'AltitudeMeters')), t ? Date.parse(t) || 0 : 0]);
  }
  return { waypoints: [], tracks: pts.length > 1 ? [buildTrack('Traccia TCX', pts)] : [] };
}

function parseLOC(doc) {
  const waypoints = [];
  for (const w of Array.from(doc.getElementsByTagName('waypoint'))) {
    const c = w.getElementsByTagName('coord')[0];
    if (!c) continue;
    const lat = num(c.getAttribute('lat')), lon = num(c.getAttribute('lon'));
    const nm = w.getElementsByTagName('name')[0];
    if (lat != null && lon != null) waypoints.push({ id: uid(), title: (nm && (nm.getAttribute('id') || nm.textContent)) || 'LOC', desc: '', lat, lon, alt: null, ts: Date.now(), icon: 'fungo' });
  }
  return { waypoints, tracks: [] };
}

export function buildTrack(name, pts) {
  let dist = 0, up = 0, down = 0, maxAlt = -1e9, minAlt = 1e9, lastAlt = null;
  for (let i = 0; i < pts.length; i++) {
    if (i) dist += hav(pts[i - 1], pts[i]);
    const a = pts[i][2];
    if (a != null) {
      maxAlt = Math.max(maxAlt, a); minAlt = Math.min(minAlt, a);
      if (lastAlt == null) lastAlt = a;
      else if (Math.abs(a - lastAlt) >= 4) { if (a > lastAlt) up += a - lastAlt; else down += lastAlt - a; lastAlt = a; }
    }
  }
  const t0 = pts.find((p) => p[3])?.[3] || Date.now();
  const t1 = [...pts].reverse().find((p) => p[3])?.[3] || t0;
  return { id: uid(), name, start: t0, end: t1, dur: Math.max(0, (t1 - t0) / 1000), dist, up, down, maxAlt: maxAlt > -1e9 ? maxAlt : null, minAlt: minAlt < 1e9 ? minAlt : null, points: pts };
}
function hav(a, b) {
  const R = 6371008.8, r = Math.PI / 180;
  const dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function parseGpsText(text, filename = '') {
  const t = text.trim();
  if (t.startsWith('{')) return parseGeoJSON(JSON.parse(t));
  const doc = new DOMParser().parseFromString(t, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('File non valido');
  const root = doc.documentElement.localName.toLowerCase();
  if (root === 'gpx') return parseGPX(doc);
  if (root === 'kml') return parseKML(doc);
  if (root === 'trainingcenterdatabase') return parseTCX(doc);
  if (root === 'loc') return parseLOC(doc);
  throw new Error('Formato non riconosciuto: ' + (filename || root));
}

// ---------- Condivisione ----------
export async function shareFile(filename, content, { title = 'Footprint', text = '' } = {}) {
  if (Capacitor.isNativePlatform()) {
    const r = await Filesystem.writeFile({ path: `share/${filename}`, data: content, directory: Directory.Cache, encoding: Encoding.UTF8, recursive: true });
    await Share.share({ title, text, files: [r.uri], dialogTitle: title });
  } else {
    const blob = new Blob([content], { type: 'application/gpx+xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
}
export async function shareText(text, title = 'Footprint') {
  if (Capacitor.isNativePlatform() || navigator.share) {
    try {
      await Share.share({ title, text, dialogTitle: title });
      return;
    } catch (e) {
      if (String(e).includes('cancel')) return;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch {}
}
export const safeName = (s) => String(s).replace(/[^\w\-]+/g, '_').slice(0, 50) || 'footprint';
export const mapsLink = (lat, lon) => `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lon.toFixed(6)}`;
