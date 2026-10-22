// "Uomo a terra": se registri e non ti muovi per 15 minuti parte un conto alla rovescia, poi un allarme sonoro
import { getSettings } from './store.js';
import { getRec } from './track.js';
import { lastPos } from './geo.js';
import { haversine } from './util.js';

const LIMIT = 15 * 60000, COUNT = 60;
let anchor = null, lastMotion = Date.now(), ui = null, ctx = null, osc = null, vib = null;

function stopAlarm() {
  try { osc && osc.stop(); } catch {}
  osc = null;
  clearInterval(vib);
  if (ui) { ui.remove(); ui = null; }
  anchor = { p: lastPos(), t: Date.now() };
}
function beep(loud) {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = loud ? 1800 : 900;
    g.gain.value = loud ? 1 : 0.4;
    o.connect(g); g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + (loud ? 0.5 : 0.25));
  } catch {}
}
function alarm() {
  if (ui) return;
  ui = document.createElement('div');
  ui.className = 'md-overlay';
  let n = COUNT;
  ui.innerHTML = `<div class="md-box"><b>Sei fermo da 15 minuti</b><div class="md-n" id="md-n">${n}</div><p>Tocca se stai bene, altrimenti suona l'allarme.</p><button class="btn primary big" id="md-ok">Sto bene</button></div>`;
  document.body.appendChild(ui);
  ui.querySelector('#md-ok').onclick = stopAlarm;
  const tick = setInterval(() => {
    if (!ui) return clearInterval(tick);
    n--;
    const el = ui.querySelector('#md-n');
    if (el) el.textContent = Math.max(n, 0);
    if (n > 0) { beep(false); navigator.vibrate && navigator.vibrate(200); }
    else {
      clearInterval(tick);
      beep(true);
      vib = setInterval(() => { beep(true); navigator.vibrate && navigator.vibrate([400, 100, 400]); }, 900);
    }
  }, 1000);
}
export function initManDown() {
  window.addEventListener('devicemotion', (e) => {
    const a = e.accelerationIncludingGravity;
    if (!a) return;
    const m = Math.abs(Math.hypot(a.x || 0, a.y || 0, a.z || 0) - 9.81);
    if (m > 1.2) lastMotion = Date.now();
  });
  setInterval(() => {
    const r = getRec(), p = lastPos();
    if (!getSettings().manDown || r.status !== 'rec' || !p) { anchor = null; return; }
    if (!anchor || haversine(p, anchor.p) > 25) { anchor = { p, t: Date.now() }; return; }
    if (Date.now() - anchor.t > LIMIT && Date.now() - lastMotion > LIMIT) alarm();
  }, 20000);
}
