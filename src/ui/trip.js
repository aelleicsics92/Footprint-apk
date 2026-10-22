// Computer di viaggio: km, dislivello, quota, velocità e passo in tempo reale
import { openPage } from '../lib/ui.js';
import { bus, fmtDist, fmtDur, haversine, cardinal } from '../lib/util.js';
import { getRec, elapsed, startRecording, stopRecording } from '../lib/track.js';
import { lastPos } from '../lib/geo.js';
import { getWaypoints } from '../lib/waypoints.js';
import { ico } from '../lib/icons.js';

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

export function openTrip() {
  openPage('Computer di viaggio', (pg) => {
    pg.body.innerHTML = '<div id="trip" class="trip"></div>';
    const el = pg.body.querySelector('#trip');
    const cell = (l, v, big) => `<div class="tc ${big ? 'big' : ''}"><span>${l}</span><b>${v}</b></div>`;
    const draw = () => {
      const s = stats();
      el.innerHTML = `
        <div class="trip-state ${s.rec ? (s.paused ? 'pause' : 'on') : ''}">${s.rec ? (s.paused ? 'In pausa' : 'Registrazione in corso') : 'Traccia non in registrazione'}
          <button class="chip" id="trip-toggle">${s.rec ? 'Ferma' : 'Avvia'}</button></div>
        <div class="tg">
          ${cell('Distanza', fmtDist(s.dist), true)}
          ${cell('Tempo', fmtDur(s.el), true)}
          ${cell('Dislivello +', n(s.up, 0, ' m'))}
          ${cell('Dislivello −', n(s.down, 0, ' m'))}
          ${cell('Quota attuale', n(s.alt, 0, ' m'), true)}
          ${cell('Pendenza', n(s.slope, 0, ' %'))}
          ${cell('Velocità', n(s.speed, 1, ' km/h'))}
          ${cell('Velocità media', n(s.avg, 1, ' km/h'))}
          ${cell('Passo medio', pace(s.pace))}
          ${cell('In movimento', fmtDur(s.moving))}
          ${cell('Quota max', n(s.maxA, 0, ' m'))}
          ${cell('Quota min', n(s.minA, 0, ' m'))}
          ${cell('Direzione', s.heading != null ? `${Math.round(s.heading)}° ${cardinal(s.heading)}` : '–')}
          ${cell('Dall\'auto', s.car != null ? fmtDist(s.car) : '–')}
          ${cell('Dalla partenza', s.start != null ? fmtDist(s.start) : '–')}
          ${cell('Precisione GPS', s.acc != null ? '±' + Math.round(s.acc) + ' m' : '–')}
        </div>`;
      el.querySelector('#trip-toggle').onclick = async () => {
        if (s.rec) await stopRecording();
        else await startRecording();
        draw();
      };
    };
    draw();
    const o = [bus.on('rec:tick', draw), bus.on('pos', draw), bus.on('rec:state', draw)];
    pg.onClose = () => o.forEach((f) => f && f());
  });
}
