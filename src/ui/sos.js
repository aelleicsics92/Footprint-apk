import { getSettings } from '../lib/store.js';
import { openSheet } from '../lib/ui.js';
import { esc, fmtCoord } from '../lib/util.js';
import { ico } from '../lib/icons.js';
import { lastPos } from '../lib/geo.js';
import { mapsLink, shareText } from '../lib/gpsio.js';
import { toast } from '../lib/ui.js';
import { openTorch, openStrobe, openWhistle } from './tools.js';

function go(url) {
  window.location.href = url;
}

export function openSOS() {
  const s = getSettings();
  const num = (s.sosNumber || '112').replace(/[^\d+]/g, '') || '112';
  const name = s.sosName || 'Emergenze';
  const p = lastPos();
  const pos = p ? fmtCoord(p.lat, p.lon) : 'posizione non disponibile';
  const ice = [s.iceBlood && `Gruppo sanguigno ${s.iceBlood}`, s.iceAllergies && `Allergie: ${s.iceAllergies}`, s.icePhone && `Contatto ICE: ${s.icePhone}`].filter(Boolean).join(' · ');
  const msg0 = p ? `AIUTO! Sono in difficoltà. La mia posizione: ${pos} ${mapsLink(p.lat, p.lon)}${p.alt != null ? ` quota ${Math.round(p.alt)} m` : ''}` : 'AIUTO! Sono in difficoltà.';
  const msg = ice ? `${msg0} ${ice}` : msg0;
  const sh = openSheet({
    title: 'Emergenza',
    body: `<div class="stack">
      <button class="btn danger big" id="sos-call" style="font-size:1.15rem;padding:18px">${ico('phone', 24)} Chiama ${esc(name)} (${esc(num)})</button>
      ${num !== '112' ? `<button class="btn ghost big" id="sos-112">${ico('phone', 20)} 112 Numero unico emergenze</button>` : ''}
      <button class="btn ghost big" id="sos-sms">${ico('chat', 20)} SMS con la mia posizione a ${esc(num)}</button>
      <button class="btn ghost big" id="sos-share">${ico('share', 20)} Condividi posizione (WhatsApp…)</button>
      <div class="coords-box"><span class="lbl">Coordinate da comunicare ai soccorsi</span><b>${pos}</b><button class="btn ghost small" id="sos-copy" style="margin-top:8px">${ico('copy', 16)} Copia coordinate e quota</button><br><small>${p && p.alt != null ? `quota ${Math.round(p.alt)} m · ` : ''}${p ? `precisione ±${Math.round(p.acc || 0)} m` : ''}</small></div>
      ${ice ? `<div class="warnbox" style="background:#fff;border-color:#c0392b"><b>Scheda sanitaria</b><br>${esc(ice)}</div>` : ''}
      <div class="row gap wrap"><button class="btn ghost grow" id="sos-torch">Torcia</button><button class="btn ghost grow" id="sos-strobe">SOS luminoso</button><button class="btn ghost grow" id="sos-whistle">Fischietto</button></div>
      <p class="muted" style="margin:0;font-size:.8rem">Dove non c'è campo prova a spostarti in un punto aperto: il 112 funziona anche con altri operatori. Numero modificabile in Impostazioni.</p>
    </div>`,
  });
  const q = (x) => sh.body.querySelector(x);
  q('#sos-call').onclick = () => go(`tel:${num}`);
  const b112 = q('#sos-112');
  if (b112) b112.onclick = () => go('tel:112');
  q('#sos-sms').onclick = () => go(`sms:${num}?body=${encodeURIComponent(msg)}`);
  q('#sos-torch').onclick = () => { sh.close(); openTorch(); };
  q('#sos-strobe').onclick = () => { sh.close(); openStrobe(); };
  q('#sos-whistle').onclick = () => { sh.close(); openWhistle(); };
  q('#sos-copy').onclick = async () => {
    const t = p ? `${pos}${p.alt != null ? ` quota ${Math.round(p.alt)} m` : ''} ${mapsLink(p.lat, p.lon)}` : 'posizione non disponibile';
    try {
      await navigator.clipboard.writeText(t);
      toast('Coordinate copiate');
    } catch {
      toast('Copia non riuscita');
    }
  };
  q('#sos-share').onclick = () => shareText(msg, 'La mia posizione');
}
