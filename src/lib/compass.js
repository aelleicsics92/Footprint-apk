import { bus, lerpAngle, rad, deg } from './util.js';
import { getSettings } from './store.js';

let heading = null; // gradi, nord vero
let started = false;
let lastEvt = 0;

function tiltCompensated(alpha, beta, gamma) {
  const a = rad(alpha), b = rad(beta), g = rad(gamma);
  const cA = Math.cos(a), sA = Math.sin(a), cB = Math.cos(b), sB = Math.sin(b), cG = Math.cos(g), sG = Math.sin(g);
  const rA = -cA * sG - sA * sB * cG;
  const rB = -sA * sG + cA * sB * cG;
  let h = Math.atan(rA / rB);
  if (rB < 0) h += Math.PI;
  else if (rA < 0) h += 2 * Math.PI;
  return deg(h);
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
