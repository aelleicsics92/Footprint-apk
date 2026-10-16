// Torcia, segnale SOS luminoso (Morse) e fischietto acustico
import { ico } from '../lib/icons.js';

let layer = null, audio = null, timer = null;
function close() {
  clearTimeout(timer);
  timer = null;
  if (audio) {
    try { audio.osc.stop(); audio.ctx.close(); } catch {}
    audio = null;
  }
  if (layer) layer.remove();
  layer = null;
}
function overlay(html) {
  close();
  layer = document.createElement('div');
  layer.className = 'tool-layer';
  layer.innerHTML = `${html}<button class="tool-x" aria-label="Chiudi">${ico('close', 26)}</button>`;
  document.body.appendChild(layer);
  layer.querySelector('.tool-x').onclick = close;
  return layer;
}

export function openTorch() {
  const l = overlay('<div class="tool-msg">Torcia · tocca X per chiudere</div>');
  l.style.background = '#fff';
  l.style.color = '#000';
}

// SOS in Morse: ... --- ...  (unità 250 ms)
export function openStrobe() {
  const l = overlay('<div class="tool-msg">SOS luminoso (· · · — — — · · ·)</div>');
  const seq = [];
  const dot = 1, dash = 3;
  for (const g of [[dot, dot, dot], [dash, dash, dash], [dot, dot, dot]]) {
    g.forEach((d, i) => seq.push([1, d], [0, i < 2 ? 1 : 3]));
  }
  seq.push([0, 4]);
  let i = 0;
  const step = () => {
    const [on, u] = seq[i % seq.length];
    l.style.background = on ? '#fff' : '#000';
    l.style.color = on ? '#000' : '#fff';
    i++;
    timer = setTimeout(step, u * 250);
  };
  step();
}

// Fischietto: tono acuto a impulsi
export function openWhistle() {
  const l = overlay('<div class="tool-msg">Fischietto di emergenza attivo<br><small>Alza il volume al massimo</small></div>');
  l.style.background = '#b3261e';
  l.style.color = '#fff';
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 3200;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    audio = { ctx, osc };
    let on = true;
    const pulse = () => {
      if (!audio) return;
      on = !on;
      gain.gain.value = on ? 1 : 0;
      osc.frequency.value = on ? (Math.random() > 0.5 ? 3200 : 3700) : 3200;
      timer = setTimeout(pulse, on ? 700 : 250);
    };
    pulse();
  } catch {
    l.querySelector('.tool-msg').textContent = 'Audio non disponibile';
  }
}
