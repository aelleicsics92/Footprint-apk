import { bus, lerpAngle, rad, deg } from './util.js';
import { getSettings } from './store.js';
import { Capacitor, registerPlugin } from '@capacitor/core';

let heading = null; // gradi, nord vero
let started = false;
let lastEvt = 0;
let rawS = null, bias = 0;
const angDiff = (a, b) => ((a - b + 540) % 360) - 180;
// Allinea la bussola alla direzione reale di cammino (GPS): corregge sensore non calibrato e offset fissi
export function feedGps(course, speed) {
  if (rawS == null || course == null || isNaN(course) || !(speed >= 1.3)) return;
  const d = angDiff(course, rawS);
  if (Math.abs(d) > 35 + Math.abs(bias)) return;
  bias = Math.max(-25, Math.min(25, bias + (d - bias) * 0.08));
}

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

let absSeen = false, nativeOn = false;
let nativeAcc = 3;
export const compassAccuracy = () => (nativeOn ? nativeAcc : null);
function setHeading(h) {
  h = (h + (Number(getSettings().declination) || 0) + 360) % 360;
  rawS = rawS == null ? h : lerpAngle(rawS, h, 0.4);
  heading = (rawS + bias + 360) % 360;
  const now = performance.now();
  if (now - lastEvt > 50) { lastEvt = now; bus.emit('heading', heading); }
}
function onOrient(e, isAbs) {
  if (nativeOn) return;
  if (isAbs) absSeen = true;
  else if (absSeen) return; // preferisci l'evento assoluto
  let h = null;
  if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
  else if (e.alpha != null && (isAbs || e.absolute)) {
    h = e.beta != null && e.gamma != null ? tiltCompensated(e.alpha, e.beta, e.gamma) : (360 - e.alpha) % 360;
  }
  if (h == null || isNaN(h)) return;
  h = (h + (Number(getSettings().declination) || 0) + 360) % 360;
  rawS = rawS == null ? h : lerpAngle(rawS, h, 0.25);
  heading = (rawS + bias + 360) % 360;
  const now = performance.now();
  if (now - lastEvt > 60) {
    lastEvt = now;
    bus.emit('heading', heading);
  }
}

export function startCompass() {
  if (started) return;
  started = true;
  // sensore nativo Android (vettore di rotazione fuso): molto più affidabile degli eventi del WebView
  try {
    if (Capacitor.isNativePlatform && Capacitor.isNativePlatform()) {
      const IF = (Capacitor.Plugins && Capacitor.Plugins.IntentFiles) || registerPlugin('IntentFiles');
      IF.addListener('compass', (e) => { nativeOn = true; nativeAcc = e.acc; setHeading(e.h); });
      IF.compassStart().catch(() => {});
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') IF.compassStart().catch(() => {}); });
    }
  } catch {}
  window.addEventListener('deviceorientationabsolute', (e) => onOrient(e, true), true);
  window.addEventListener('deviceorientation', (e) => onOrient(e, false), true);
}
export const getHeading = () => heading;
export const compassAlive = () => heading != null;
