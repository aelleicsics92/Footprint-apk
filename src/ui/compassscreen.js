import { bus, fmtCoord, fmtDist, haversine, bearing, cardinal, esc } from '../lib/util.js';
import { ico, wpIcon } from '../lib/icons.js';
import { getHeading, compassAlive } from '../lib/compass.js';
import { lastPos, gpsStatus } from '../lib/geo.js';
import { getTarget, setTarget } from '../lib/state.js';
import { getWaypoint } from '../lib/waypoints.js';
import { getRec, getTracks, loadTrackPoints } from '../lib/track.js';

let bt = null; // {pts} traccia inversa attiva

let root, rot, tgtMark;

function dialSVG() {
  let ticks = '';
  for (let a = 0; a < 360; a += 5) {
    const major = a % 30 === 0;
    const len = major ? 16 : a % 10 === 0 ? 10 : 6;
    ticks += `<line x1="150" y1="${12}" x2="150" y2="${12 + len}" stroke="${major ? '#fff' : '#8fb09c'}" stroke-width="${major ? 2.4 : 1.3}" transform="rotate(${a} 150 150)"/>`;
  }
  const lab = (t, a, c = '#fff', s = 22) =>
    `<text x="150" y="52" text-anchor="middle" fill="${c}" font-size="${s}" font-weight="700" font-family="Georgia,serif" transform="rotate(${a} 150 150)"><tspan transform="rotate(${-a} 150 46)">${t}</tspan></text>`;
  let nums = '';
  for (let a = 30; a < 360; a += 30) if (a % 90) nums += `<text x="150" y="46" text-anchor="middle" fill="#a6c4b1" font-size="12" transform="rotate(${a} 150 150)">${a}</text>`;
  return `<svg viewBox="0 0 300 300"><defs><radialGradient id="dg" cx="50%" cy="45%" r="60%"><stop offset="0" stop-color="#245f48"/><stop offset="1" stop-color="#0f2f23"/></radialGradient></defs>
    <circle cx="150" cy="150" r="146" fill="url(#dg)" stroke="#d28a2c" stroke-width="3"/>
    <g class="rot" id="dial-rot">
      ${ticks}${nums}
      <text x="150" y="58" text-anchor="middle" fill="#ff7a5c" font-size="30" font-weight="800" font-family="Georgia,serif">N</text>
      <text x="150" y="258" text-anchor="middle" fill="#fff" font-size="26" font-weight="700" font-family="Georgia,serif" transform="rotate(180 150 258)">S</text>
      <text x="253" y="160" text-anchor="middle" fill="#fff" font-size="26" font-weight="700" font-family="Georgia,serif" transform="rotate(90 253 150)">E</text>
      <text x="47" y="160" text-anchor="middle" fill="#fff" font-size="26" font-weight="700" font-family="Georgia,serif" transform="rotate(-90 47 150)">O</text>
      <g id="tgt-mark" style="display:none"><path d="M150 16 l11 -17 h-22z" fill="#ffb23e" stroke="#fff" stroke-width="1.5" transform="translate(0 19)"/><circle cx="150" cy="40" r="5" fill="#ffb23e" stroke="#fff" stroke-width="1.5"/></g>
    </g>
    <circle cx="150" cy="150" r="5" fill="#d28a2c"/>
    <path d="M150 112 L158 150 L150 188 L142 150Z" fill="rgba(255,255,255,.12)"/>
  </svg>`;
}

export function mountCompass(el) {
  root = el;
  el.innerHTML = `<div class="compass-wrap">
    <div class="compass-head" id="c-deg">--°</div>
    <div class="compass-sub" id="c-card">BUSSOLA</div>
    <div class="dial"><div class="needle"></div>${dialSVG()}</div>
    <button class="btn ghost" id="c-back" style="margin-top:12px;color:#fff;border-color:rgba(255,255,255,.4)">↩ Torna indietro sui tuoi passi</button>
    <div class="target-card hidden" id="c-bt"></div>
    <div class="target-card hidden" id="c-target"></div>
    <div class="gps-grid" id="c-gps"></div>
    <p class="muted" id="c-note" style="color:#a6c4b1;text-align:center;font-size:.8rem;margin-top:14px">Tieni il telefono in piano. Per calibrare, muovilo disegnando un otto.</p>
  </div>`;
  el.querySelector('#c-back').onclick = async () => {
    if (bt) { bt = null; updateInfo(); return; }
    let pts = getRec().points;
    if (!pts || pts.length < 2) {
      const t = getTracks()[0];
      pts = t ? await loadTrackPoints(t.id) : [];
    }
    if (!pts || pts.length < 2) return alert('Nessuna traccia registrata da seguire a ritroso.');
    bt = { pts };
    updateInfo();
  };
  rot = el.querySelector('#dial-rot');
  tgtMark = el.querySelector('#tgt-mark');
  bus.on('heading', onHeading);
  bus.on('pos', updateInfo);
  bus.on('gps:status', updateInfo);
  bus.on('target:changed', updateInfo);
  setTimeout(() => {
    if (!compassAlive()) el.querySelector('#c-note').textContent = 'Sensore bussola non disponibile: uso la direzione GPS quando ti muovi.';
  }, 4000);
  updateInfo();
}

let btT = 0;
function onHeading(h) {
  if (!rot) return;
  if (bt && Date.now() - btT > 250) { btT = Date.now(); updateInfo(); }
  rot.style.transform = `rotate(${-h}deg)`;
  root.querySelector('#c-deg').textContent = `${Math.round(h)}°`;
  root.querySelector('#c-card').textContent = cardinal(h);
}

function updateInfo() {
  if (!root) return;
  const p = lastPos();
  const w = getTarget() && getWaypoint(getTarget());
  const card = root.querySelector('#c-target');
  const btc = root.querySelector('#c-bt'), btb = root.querySelector('#c-back');
  btb.textContent = bt ? '✖ Ferma il ritorno' : '↩ Torna indietro sui tuoi passi';
  if (bt && p) {
    const pts = bt.pts, P2 = (q) => ({ lat: q[0], lon: q[1] });
    let bi = 0, bd = Infinity;
    for (let i = 0; i < pts.length; i++) { const d = haversine(p, P2(pts[i])); if (d < bd) { bd = d; bi = i; } }
    let j = bi, acc = 0;
    while (j > 0 && acc < 30) { acc += haversine(P2(pts[j]), P2(pts[j - 1])); j--; }
    let left = 0;
    for (let i = bi; i > 0; i--) left += haversine(P2(pts[i]), P2(pts[i - 1]));
    left += bd;
    if (bi === 0 && bd < 20) {
      tgtMark.style.display = 'none';
      btc.classList.remove('hidden');
      btc.innerHTML = '<b style="font-size:1.2rem">Sei tornato al punto di partenza</b>';
    } else {
      const br = bearing(p, P2(pts[j])), h = getHeading();
      tgtMark.style.display = '';
      tgtMark.setAttribute('transform', `rotate(${br} 150 150)`);
      btc.classList.remove('hidden');
      btc.innerHTML = `<div class="bt-arrow" style="transform:rotate(${Math.round(br - (h || 0))}deg)">⬆</div><div style="flex:1"><b style="font-size:1.3rem">${fmtDist(left)} alla partenza</b><small>segui la freccia lungo il tuo percorso${bd > 40 ? ` · sei a ${Math.round(bd)} m dalla traccia` : ''}</small></div>`;
    }
    card.classList.add('hidden');
    return updateGps(p);
  }
  btc.classList.add('hidden');
  if (w && p) {
    const br = bearing(p, w);
    tgtMark.style.display = '';
    tgtMark.setAttribute('transform', `rotate(${br} 150 150)`);
    const ic = wpIcon(w.icon);
    card.classList.remove('hidden');
    card.innerHTML = `<span class="ic big" style="width:42px;height:42px">${ic.svg}</span><div style="flex:1"><b>${esc(w.title)}</b><small>${fmtDist(haversine(p, w))} · direzione ${Math.round(br)}° ${cardinal(br)}</small></div><button class="btn small ghost" id="c-stop">Fine</button>`;
    card.querySelector('#c-stop').onclick = () => setTarget(null);
  } else {
    if (tgtMark) tgtMark.style.display = 'none';
    card.classList.add('hidden');
  }
  updateGps(p);
}

function updateGps(p) {
  const g = root.querySelector('#c-gps');
  g.innerHTML = p
    ? `<div><span>Latitudine</span><b>${p.lat.toFixed(6)}</b></div><div><span>Longitudine</span><b>${p.lon.toFixed(6)}</b></div><div><span>Quota</span><b>${p.alt != null ? Math.round(p.alt) + ' m' : '—'}</b></div><div><span>Velocità</span><b>${p.speed != null ? (p.speed * 3.6).toFixed(1) + ' km/h' : '—'}</b></div>`
    : `<div style="grid-column:1/3"><span>GPS</span><b style="font-size:.9rem">${esc(gpsStatus().msg || 'in attesa del segnale…')}</b></div>`;
}
