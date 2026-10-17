import { bus, lerpAngle, rad, deg } from './util.js';
import { getSettings } from './store.js';

let heading = null; // gradi, nord vero
let started = false;
let lastEvt = 0;

// Direzione (da nord) in cui punta la cima del telefono se è in piano, oppure il retro se è in verticale.
// Usa la rotazione completa alpha/beta/gamma, quindi funziona in entrambe le posizioni.
function tiltCompensated(alpha, beta, gamma) {
  const a = rad(alpha), b = rad(beta), g = rad(gamma);
  const cA = Math.cos(a), sA = Math.sin(a), cB = Math.cos(b), sB = Math.sin(b), cG = Math.cos(g), sG = Math.sin(g);
  // retro del telefono (-Z) e cima (Y) proiettati sul piano orizzontale: [est, nord]
  const back = [-cA * sG - sA * sB * cG, -sA * sG + cA * sB * cG];
  const top = [-sA * cB, cA * cB];
  const v = Math.hypot(top[0], top[1]) >= Math.hypot(back[0], back[1]) ? top : back;
  return (deg(Math.atan2(v[0], v[1])) + 360) % 360;
}

let absSeen = false;
function onOrient(e, isAbs) {
  if (isAbs) absSeen = true;
  else if (absSeen) return; // preferisci l'evento assoluto
  let h = null;
  if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
  else if (e.alpha != null && (isAbs || e.absolute)) {
    h = e.beta != null && e.gamma != null ? tiltCompensated(e.alpha, e.beta, e.gamma) : (360 - e.alpha) % 360;
  }
  if (h == null || isNaN(h)) return;
  h = (h + (Number(getSettings().declination) || 0) + 360) % 360;
  heading = heading == null ? h : lerpAngle(heading, h, 0.25);
  const now = performance.now();
  if (now - lastEvt > 60) {
    lastEvt = now;
    bus.emit('heading', heading);
  }
}

export function startCompass() {
  if (started) return;
  started = true;
  window.addEventListener('deviceorientationabsolute', (e) => onOrient(e, true), true);
  window.addEventListener('deviceorientation', (e) => onOrient(e, false), true);
}
export const getHeading = () => heading;
export const compassAlive = () => heading != null;
