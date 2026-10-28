import './style.css';
import { initWidgetSync } from './lib/widgetsync.js';
import { openSOS } from './ui/sos.js';
import { saveParking, openNewWaypoint, getWaypoints } from './lib/waypoints.js';
import { setTarget } from './lib/state.js';
import { initManDown } from './lib/mandown.js';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { $, bus, esc, fmtDist, fmtDur } from './lib/util.js';
import { ico } from './lib/icons.js';
import { installInputBehaviour, closeTopSheet, closeTopPage, openSheet, toast, takeBackReturn, clearBackReturn, runTopBack } from './lib/ui.js';
import { getSettings } from './lib/store.js';
import { startWatch } from './lib/geo.js';
import { startCompass } from './lib/compass.js';
import { loadWaypoints, quickWaypoint, importQuick } from './lib/waypoints.js';
import { loadTracks, startRecording, stopRecording, pendingRecovery, recoverSave, discardRecovery, getRec } from './lib/track.js';
import { setWakeLock } from './lib/wake.js';
import { mountMap, invalidate } from './ui/mapscreen.js';
import { mountCompass } from './ui/compassscreen.js';
import { mountAI } from './ui/aiscreen.js';
import { mountFungi } from './ui/fungiscreen.js';
import { mountTrip } from './ui/trip.js';
import { mountMore } from './ui/more.js';
import { initNotifications, initPinned } from './lib/notify.js';
import { initCoverage } from './lib/coverage.js';
import { initWalked } from './lib/walked.js';
import { initIncomingFiles } from './lib/importer.js';

const TABS = [
  ['map', 'Mappa', 'map'],
  ['compass', 'Bussola', 'compass'],
  ['ai', 'Identifica', 'camera'],
  ['trip', 'Viaggio', 'gauge'],
  ['more', 'Altro', 'more'],
  ['fungi', 'Previsione', 'mushroom'],
];
let current = 'map';

const tabHist = [];
function goTab(id) {
  if (id !== 'map') clearBackReturn();
  // navigazione da menu/pulsanti interni: ricordo la schermata di partenza per il tasto indietro
  if (id !== current && TABS.some((t) => t[0] === id)) { tabHist.push(current); if (tabHist.length > 8) tabHist.shift(); }
  showTab(id);
}
function showTab(id) {
  if (!TABS.some((t) => t[0] === id)) return;
  current = id;
  TABS.forEach(([k]) => $('#screen-' + k).classList.toggle('active', k === id));
  $('#app').classList.toggle('on-map', id === 'map');
  $('#nav')
    .querySelectorAll('button')
    .forEach((b) => b.classList.toggle('active', b.dataset.t === (id === 'fungi' ? 'more' : id)));
  if (id === 'map') setTimeout(invalidate, 50);
}

async function boot() {
  installInputBehaviour();
  $('#nav').innerHTML = TABS.filter((t) => t[0] !== 'fungi').map(([k, l, i]) => `<button data-t="${k}">${ico(i, 24)}<span>${l}</span></button>`).join('');
  $('#nav').addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]');
    if (b) {
      clearBackReturn();
      tabHist.length = 0;
      showTab(b.dataset.t);
      bus.emit('nav:tab', b.dataset.t);
    }
  });
  bus.on('nav:tab', goTab);

  if (Capacitor.isNativePlatform()) {
    try {
      await StatusBar.setStyle({ style: Style.Dark });
      await StatusBar.setBackgroundColor({ color: '#12372a' });
    } catch {}
    App.addListener('backButton', () => {
      if (runTopBack()) return;
      if (closeTopSheet()) return;
      if (closeTopPage()) return;
      const br = takeBackReturn();
      if (br) {
        if (tabHist.length) { const t = tabHist.pop(); showTab(t); bus.emit('nav:tab', t); }
        br();
        return;
      }
      if (tabHist.length) {
        const t = tabHist.pop();
        showTab(t);
        bus.emit('nav:tab', t);
        return;
      }
      if (current !== 'map') {
        showTab('map');
        bus.emit('nav:tab', 'map');
        return;
      }
      App.exitApp();
    });
  }

  await Promise.all([loadWaypoints(), loadTracks()]);
  mountMap($('#screen-map'));
  mountCompass($('#screen-compass'));
  mountAI($('#screen-ai'));
  mountFungi($('#screen-fungi'));
  mountTrip($('#screen-trip'));
  mountMore($('#screen-more'));
  try { document.documentElement.classList.toggle('night', !!getSettings().nightMode); document.documentElement.classList.toggle('hc', !!getSettings().hiContrast); } catch {}
  showTab('map');
  startWatch();
  initWalked();
  recover();
  setTimeout(() => {
    initNotifications();
    initPinned();
    initCoverage();
    initIncomingFiles();
    startCompass();
    setWakeLock(getSettings().keepAwake);
  }, 400);
}

async function recover() {
  const cur = await pendingRecovery();
  if (cur) {
    // ripresa automatica: nessuna domanda, la traccia continua da dove era
    const gap = Math.max(0, Date.now() - (cur.savedAt || cur.points[cur.points.length - 1][3] || Date.now()));
    await startRecording({ id: cur.id, name: cur.name, start: cur.start, points: cur.points, dist: cur.dist, up: cur.up, down: cur.down, paused: (cur.paused || 0) + (gap > 30 * 60000 ? gap : 0), lastAlt: cur.lastAlt });
    toast(`Registrazione ripresa (${fmtDist(cur.dist || 0)})`);
    return;
  }
}

window.addEventListener('hwvolume', () => { if (getSettings().volumeWp) quickWaypoint(); });
setTimeout(() => { try { initManDown(); } catch {} }, 3000);
setTimeout(() => { try { if (getSettings().volumeWp) ((Capacitor.Plugins && Capacitor.Plugins.IntentFiles) || registerPlugin('IntentFiles')).setVolumeKey({ enabled: true }); } catch {} }, 1500);

async function runAction(a) {
  if (a === 'wp') { showTab('map'); bus.emit('nav:tab', 'map'); openNewWaypoint(); }
  else if (a === 'car') {
    showTab('map'); bus.emit('nav:tab', 'map');
    const car = getWaypoints().filter((w) => w.icon === 'parcheggio').sort((x, y) => y.ts - x.ts)[0];
    if (car) { setTarget(car.id); bus.emit('wp:target', car.id); }
    else await saveParking();
  } else if (a === 'rec') {
    if (getRec().status === 'idle') { await startRecording(); toast('Registrazione avviata'); }
    else { const t = await stopRecording(); toast(t ? 'Traccia salvata' : 'Traccia troppo corta: non salvata'); }
  } else if (a === 'sos') { showTab('map'); bus.emit('nav:tab', 'map'); openSOS(); }
  else if (a === 'fungi') { showTab('fungi'); bus.emit('nav:tab', 'fungi'); }
}
window.addEventListener('fpaction', () => pullQuick());

async function pullQuick() {
  try {
    if (!Capacitor.isNativePlatform()) return;
    const r = await ((Capacitor.Plugins && Capacitor.Plugins.IntentFiles) || registerPlugin('IntentFiles')).takeQuick();
    if (r && r.items && r.items.length) await importQuick(r.items);
    if (r && r.action) await runAction(r.action);
  } catch {}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pullQuick(); });
setTimeout(pullQuick, 1200);
setTimeout(pullQuick, 3500);
setTimeout(() => { try { initWidgetSync(); } catch {} }, 2500);
import('./lib/calib.js').then((m) => m.initAutoLearn()).catch(() => {});

boot();
