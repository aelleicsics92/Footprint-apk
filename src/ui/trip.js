// Computer di viaggio: km, dislivello, quota, velocità e passo in tempo reale
import { bus, fmtDist, fmtDur, haversine, cardinal } from '../lib/util.js';
import { getRec, elapsed, startRecording, stopRecording } from '../lib/track.js';
import { lastPos } from '../lib/geo.js';
import { getWaypoints } from '../lib/waypoints.js';

function stats() {
  const r = getRec(), p = lastPos();
  const pts = r.points;
  let moving = 0, maxA = null, minA = null;
  for (let i = 1; i < pts.length; i++) {
    const dt = (pts[i][3] - pts[i - 1][3]) / 1000;
    const d = haversine({ lat: pts[i - 1][0], lon: pts[i - 1][1] }, { lat: pts[i][0], lon: pts[i][1] });
    if (dt > 0 && dt < 90 && d / dt > 0.3) moving += dt;
  }
  for (const q of pts) if (q[2] != null) { maxA = maxA == null ? q[2] : Math.max(maxA, q[2]); minA = minA == null ? q[2] : Math.min(minA, q[2]); }
  // pendenza sugli ultimi ~40 m
  let slope = null;
  if (pts.length > 2) {
    let d = 0, j = pts.length - 1;
    while (j > 0 && d < 40) { d += haversine({ lat: pts[j - 1][0], lon: pts[j - 1][1] }, { lat: pts[j][0], lon: pts[j][1] }); j--; }
    const a0 = pts[j][2], a1 = pts[pts.length - 1][2];
    if (d >= 15 && a0 != null && a1 != null) slope = ((a1 - a0) / d) * 100;
  }
  const car = getWaypoints().filter((w) => w.icon === 'parcheggio').sort((a, b) => b.ts - a.ts)[0];
  const first = pts[0];
  const el = elapsed();
  const avg = moving > 5 ? (r.dist / moving) * 3.6 : null;
  return {
    rec: r.status !== 'idle', paused: r.status === 'pause',
    dist: r.dist, el, moving, up: r.up, down: r.down,
    alt: p && p.alt != null ? p.alt : null, maxA, minA,
    speed: p && p.speed != null && p.speed >= 0 ? p.speed * 3.6 : null,
    avg, pace: avg ? 60 / avg : null, slope,
    heading: p && p.heading != null && !isNaN(p.heading) ? p.heading : null,
    car: car && p ? haversine(p, car) : null,
    start: first && p ? haversine(p, { lat: first[0], lon: first[1] }) : null,
    acc: p ? p.acc : null,
  };
}
const n = (v, d = 0, u = '') => (v == null || isNaN(v) ? '–' : v.toFixed(d).replace('.', ',') + u);
const pace = (v) => (v == null || !isFinite(v) ? '–' : `${Math.floor(v)}:${String(Math.round((v % 1) * 60)).padStart(2, '0')} /km`);

const I = {
  dist: '<path d="M7 20a2 2 0 100-4 2 2 0 000 4zM17 8a2 2 0 100-4 2 2 0 000 4z"/><path d="M9 18h6a3 3 0 000-6H9a3 3 0 010-6h6"/>',
  time: '<circle cx="12" cy="13" r="8"/><path d="M12 8v5l3 2M9 2h6"/>',
  up: '<path d="M2 19l6-10 4 6 3-4 7 8z"/><path d="M19 3v5M16.5 5.5h5"/>',
  down: '<path d="M2 19l6-10 4 6 3-4 7 8z"/><path d="M16.5 5.5h5"/>',
  alt: '<circle cx="12" cy="12" r="9"/><path d="M12 12l3-5"/><path d="M7 15h10"/>',
  slope: '<path d="M3 19h18M3 19L21 6M13 19a9 9 0 00-1.5-5"/>',
  speed: '<path d="M4 17a9 9 0 1116 0z"/><path d="M12 15l4-5"/>',
  avg: '<path d="M4 17a9 9 0 1116 0z"/><path d="M12 15l-4-5M9 20h6"/>',
  pace: '<circle cx="12" cy="14" r="7"/><path d="M12 10v4l2 2M10 2h4M12 2v3"/>',
  move: '<circle cx="13" cy="4.5" r="2"/><path d="M10 21l2-6-3-2 2-5 4 2 2 3M8 12l-3 1"/>',
  max: '<path d="M2 20l7-12 4 6 3-4 6 10z"/><path d="M9 4v0"/><path d="M8 3h2"/>',
  min: '<path d="M2 6c4 0 4 12 10 12s6-12 10-12"/>',
  dir: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  car: '<path d="M4 16v-4l2-5h12l2 5v4M4 16h16M4 16v2h3v-2M17 16v2h3v-2"/><circle cx="8" cy="13" r=".8"/><circle cx="16" cy="13" r=".8"/>',
  flag: '<path d="M5 21V4M5 4h12l-3 4 3 4H5"/>',
  gps: '<path d="M4 20l4-4M8 16l-3-3 4-4 3 3zM13 11l4-4 3 3-4 4zM12 3a9 9 0 019 9M12 7a5 5 0 015 5"/>',
};
const svg = (k) => `<svg class="tci" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${I[k]}</svg>`;

export function mountTrip(root) {
  root.innerHTML = '<header class="trip-head">Computer di viaggio</header><div id="trip" class="trip"></div>';
  const el = root.querySelector('#trip');
  const cell = (l, ic, v, big) => `<div class="tc ${big ? 'big' : ''}"><span>${l}</span><div class="tv">${svg(ic)}<b>${v}</b></div></div>`;
  let visible = false;
  const draw = () => {
    if (!visible) return;
    const s = stats();
    el.innerHTML = `
      <div class="trip-state ${s.rec ? (s.paused ? 'pause' : 'on') : ''}"><span>${s.rec ? (s.paused ? 'In pausa' : 'Registrazione in corso') : 'Traccia non in registrazione'}</span>
        <button class="chip" id="trip-toggle">${s.rec ? 'Ferma' : 'Avvia'}</button></div>
      <div class="tg">
        ${cell('Distanza', 'dist', fmtDist(s.dist), true)}
        ${cell('Tempo', 'time', fmtDur(s.el), true)}
        ${cell('Dislivello +', 'up', n(s.up, 0, ' m'))}
        ${cell('Dislivello −', 'down', n(s.down, 0, ' m'))}
        ${cell('Quota attuale', 'alt', n(s.alt, 0, ' m'), true)}
        ${cell('Pendenza', 'slope', n(s.slope, 0, ' %'), true)}
        ${cell('Velocità', 'speed', n(s.speed, 1, ' km/h'))}
        ${cell('Velocità media', 'avg', n(s.avg, 1, ' km/h'))}
        ${cell('Passo medio', 'pace', pace(s.pace))}
        ${cell('In movimento', 'move', fmtDur(s.moving))}
        ${cell('Quota max', 'max', n(s.maxA, 0, ' m'))}
        ${cell('Quota min', 'min', n(s.minA, 0, ' m'))}
        ${cell('Direzione', 'dir', s.heading != null ? `${Math.round(s.heading)}° ${cardinal(s.heading)}` : '–')}
        ${cell("Dall'auto", 'car', s.car != null ? fmtDist(s.car) : '–')}
        ${cell('Dalla partenza', 'flag', s.start != null ? fmtDist(s.start) : '–')}
        ${cell('Precisione GPS', 'gps', s.acc != null ? '±' + Math.round(s.acc) + ' m' : '–')}
      </div>`;
    el.querySelector('#trip-toggle').onclick = async () => {
      if (s.rec) await stopRecording();
      else await startRecording();
      draw();
    };
  };
  bus.on('rec:tick', draw);
  bus.on('pos', draw);
  bus.on('rec:state', draw);
  bus.on('nav:tab', (t) => {
    visible = t === 'trip';
    draw();
  });
}
