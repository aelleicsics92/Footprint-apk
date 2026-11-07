// Se dopo la riapertura la pagina non produce frame (schermata verde ferma), forza il ridisegno nativo
import { Capacitor, registerPlugin } from '@capacitor/core';
import { mark } from './perf.js';
let n = 0;
function watch() {
  let fired = false;
  requestAnimationFrame(() => { fired = true; });
  setTimeout(() => {
    if (fired || document.visibilityState !== 'visible' || n >= 6) return;
    n++;
    mark('ridisegno forzato ' + n);
    try { (Capacitor.Plugins.IntentFiles || registerPlugin('IntentFiles')).kickRender(); } catch {}
    watch();
  }, 1200);
}
export function initRenderKick() {
  if (!Capacitor.isNativePlatform || !Capacitor.isNativePlatform()) return;
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { n = 0; watch(); } });
}
