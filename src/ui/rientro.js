// Bussola del rientro: schermo scuro ad alto contrasto con una freccia gigante verso auto o punto di partenza
import { bus, haversine, bearing, fmtDist, cardinal } from '../lib/util.js';
import { lastPos } from '../lib/geo.js';
import { getHeading } from '../lib/compass.js';
import { getWaypoints } from '../lib/waypoints.js';
import { getRec, getTracks } from '../lib/track.js';
import { pushBack, toast } from '../lib/ui.js';

let open = false;

// destinazione: auto parcheggiata più recente, altrimenti inizio della traccia in registrazione
function dest() {
  const car = getWaypoints().filter((w) => w.icon === 'parcheggio').sort((a, b) => b.ts - a.ts)[0];
  if (car) return { lat: car.lat, lon: car.lon, name: 'Auto' };
  const r = getRec();
  if (r.points && r.points.length) return { lat: r.points[0][0], lon: r.points[0][1], name: 'Partenza' };
  return null;
}

export function openReturn() {
  if (open) return;
  const d = dest();
  if (!d) return toast('Nessuna auto salvata né traccia in corso: segna prima il parcheggio');
  open = true;
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;inset:0;z-index:9000;background:#000;color:#ffb23e;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2vh;padding:24px;text-align:center;font-family:sans-serif';
  el.innerHTML = `<div id="rt-n" style="font-size:1.1rem;letter-spacing:.2em;text-transform:uppercase;opacity:.8">Verso ${d.name}</div>
    <div id="rt-a" style="font-size:min(62vw,52vh);line-height:1;transition:transform .15s linear;will-change:transform;text-shadow:0 0 30px rgba(255,178,62,.55)">▲</div>
    <div id="rt-d" style="font-size:min(20vw,12vh);font-weight:800;line-height:1">--</div>
    <div id="rt-c" style="font-size:1.3rem;opacity:.85"></div>
    <button id="rt-x" style="margin-top:3vh;background:none;border:2px solid #ffb23e;color:#ffb23e;border-radius:16px;padding:12px 28px;font-size:1.1rem;font-weight:700">Chiudi</button>`;
  document.body.appendChild(el);
  const q = (x) => el.querySelector(x);
  let lastH = 0;
  const upd = () => {
    const me = lastPos();
    if (!me) { q('#rt-d').textContent = 'attendo il GPS'; q('#rt-d').style.fontSize = '2rem'; return; }
    const dist = haversine(me, d), b = bearing(me, d);
    let h = getHeading();
    if (h == null || isNaN(h)) h = lastH;
    lastH = h;
    q('#rt-a').style.transform = `rotate(${b - h}deg)`;
    q('#rt-d').style.fontSize = '';
    q('#rt-d').textContent = dist < 1000 ? `${Math.round(dist)} m` : `${(dist / 1000).toFixed(1).replace('.', ',')} km`;
    q('#rt-c').textContent = dist < 25 ? 'Sei arrivato' : `${cardinal(b)} (${Math.round(b)}°)`;
  };
  let t = 0;
  const o1 = bus.on('pos', upd), o2 = bus.on('heading', () => { const n = Date.now(); if (n - t > 120) { t = n; upd(); } });
  const close = () => { o1 && o1(); o2 && o2(); unback(); el.remove(); open = false; };
  const unback = pushBack(close);
  q('#rt-x').onclick = close;
  upd();
}
