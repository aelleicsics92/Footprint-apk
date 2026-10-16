import './style.css';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { $, bus, esc, fmtDist, fmtDur } from './lib/util.js';
import { ico } from './lib/icons.js';
import { installInputBehaviour, closeTopSheet, closeTopPage, openSheet, toast } from './lib/ui.js';
import { getSettings } from './lib/store.js';
import { startWatch } from './lib/geo.js';
import { startCompass } from './lib/compass.js';
import { loadWaypoints } from './lib/waypoints.js';
import { loadTracks, startRecording, stopRecording, pendingRecovery, recoverSave, discardRecovery, getRec } from './lib/track.js';
import { setWakeLock } from './lib/wake.js';
import { mountMap, invalidate } from './ui/mapscreen.js';
import { mountCompass } from './ui/compassscreen.js';
import { mountAI } from './ui/aiscreen.js';
import { mountFungi } from './ui/fungiscreen.js';
import { mountMore } from './ui/more.js';

const TABS = [
  ['map', 'Mappa', 'map'],
  ['compass', 'Bussola', 'compass'],
  ['ai', 'Identifica', 'camera'],
  ['fungi', 'Funghi', 'mushroom'],
  ['more', 'Altro', 'more'],
];
let current = 'map';

function showTab(id) {
  if (!TABS.some((t) => t[0] === id)) return;
  current = id;
  TABS.forEach(([k]) => $('#screen-' + k).classList.toggle('active', k === id));
  $('#nav')
    .querySelectorAll('button')
    .forEach((b) => b.classList.toggle('active', b.dataset.t === id));
  if (id === 'map') setTimeout(invalidate, 50);
}

async function boot() {
  installInputBehaviour();
  $('#nav').innerHTML = TABS.map(([k, l, i]) => `<button data-t="${k}">${ico(i, 24)}<span>${l}</span></button>`).join('');
  $('#nav').addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]');
    if (b) {
      showTab(b.dataset.t);
      bus.emit('nav:tab', b.dataset.t);
    }
  });
  bus.on('nav:tab', showTab);

  if (Capacitor.isNativePlatform()) {
    try {
      await StatusBar.setStyle({ style: Style.Dark });
      await StatusBar.setBackgroundColor({ color: '#12372a' });
    } catch {}
    App.addListener('backButton', () => {
      if (closeTopSheet()) return;
      if (closeTopPage()) return;
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
  mountMore($('#screen-more'));
  showTab('map');

  startWatch();
  startCompass();
  setWakeLock(getSettings().keepAwake);
  recover();
}

async function recover() {
  const cur = await pendingRecovery();
  if (cur) {
    const s = openSheet({
      title: 'Traccia interrotta',
      body: `<p class="confirm-msg">Hai una traccia non salvata (${fmtDist(cur.dist || 0)}). Cosa vuoi fare?</p>
        <div class="stack"><button class="btn primary big" data-a="resume">Riprendi la registrazione</button><button class="btn ghost big" data-a="save">Salva così com'è</button><button class="btn ghost big danger-t" data-a="drop">Scarta</button></div>`,
    });
    s.body.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      s.close();
      if (b.dataset.a === 'resume') await startRecording({ id: cur.id, name: cur.name, start: cur.start, points: cur.points, dist: cur.dist, up: cur.up, down: cur.down, paused: (cur.paused || 0) + Math.max(0, Date.now() - (cur.points[cur.points.length - 1][3] || Date.now())), lastAlt: cur.lastAlt });
      else if (b.dataset.a === 'save') {
        await recoverSave(cur);
        toast('Traccia salvata');
        if (getSettings().recordTrack) startRecording();
      } else {
        await discardRecovery();
        if (getSettings().recordTrack) startRecording();
      }
    });
    return;
  }
  if (getSettings().recordTrack) startRecording();
}

boot();
