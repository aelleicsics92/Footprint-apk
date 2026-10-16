import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { ico } from '../lib/icons.js';
import { esc, bus } from '../lib/util.js';
import { toast, setBusy } from '../lib/ui.js';
import { askModel, parseJSON, aiErrorMessage, audioToWav, hasAI } from '../lib/ai.js';
import { lastPos } from '../lib/geo.js';
import { nearestZone } from '../lib/fungi.js';
import { DB, ALL, byId, schedaHTML, openScheda } from './db.js';

const CATS = [
  { id: 'orma', label: 'Impronta', icon: 'paw', kinds: ['animali'], filter: (x) => x.orma, prompt: 'impronta di animale' },
  { id: 'cacca', label: 'Escrementi', icon: 'search', kinds: ['animali'], filter: (x) => x.escrementi, prompt: 'escrementi di animale selvatico o domestico' },
  { id: 'erba', label: 'Erba spontanea', icon: 'leaf', kinds: ['erbe'], filter: () => true, prompt: 'pianta spontanea / erba' },
  { id: 'fungo', label: 'Fungo', icon: 'mushroom', kinds: ['funghi', 'tartufi'], filter: () => true, prompt: 'fungo o tartufo' },
  { id: 'verso', label: 'Verso', icon: 'mic', kinds: ['animali'], filter: (x) => x.verso, prompt: 'verso/suono di animale (audio)' },
];

let state = { cat: 'orma', image: null, audio: null, audioName: '' };
let root;

export function mountIdentify(el) {
  root = el;
  render();
}

function render() {
  const cat = CATS.find((c) => c.id === state.cat);
  const isAudio = cat.id === 'verso';
  root.innerHTML = `
    <div class="cat-grid">${CATS.slice(0, 3)
      .map((c) => `<button class="cat ${c.id === state.cat ? 'sel' : ''}" data-cat="${c.id}">${ico(c.icon, 26)}${c.label}</button>`)
      .join('')}</div>
    <div class="cat-grid" style="grid-template-columns:repeat(2,1fr);margin-top:0">${CATS.slice(3)
      .map((c) => `<button class="cat ${c.id === state.cat ? 'sel' : ''}" data-cat="${c.id}">${ico(c.icon, 26)}${c.label}</button>`)
      .join('')}</div>
    <div class="drop" id="idf-drop">
      ${
        isAudio
          ? state.audio
            ? `<p>${ico('mic', 36)}<br><b>${esc(state.audioName)}</b></p>`
            : `<p class="muted">${ico('mic', 36)}<br>Registra il verso o carica un file audio</p>`
          : state.image
          ? `<img src="data:${state.image.mime};base64,${state.image.data}" alt="Foto da analizzare">`
          : `<p class="muted">${ico('camera', 36)}<br>Scatta una foto o scegline una dalla galleria</p>`
      }
      <div class="row gap wrap" style="justify-content:center">
        ${
          isAudio
            ? `<button class="btn ghost" id="idf-rec">${ico('mic', 18)} Registra</button><button class="btn ghost" id="idf-file">${ico('upload', 18)} Carica audio</button>`
            : `<button class="btn ghost" id="idf-photo">${ico('camera', 18)} Foto / Galleria</button>`
        }
      </div>
    </div>
    <div data-enter-scope><div style="margin:0 14px"><label class="field"><span>${isAudio ? 'Note (facoltative)' : 'Dimensioni o note (facoltative)'}</span><input id="idf-note" type="text" placeholder="${isAudio ? 'es. di notte, vicino a un torrente' : 'es. orma lunga 7 cm, trovata nel fango'}" maxlength="140"></label></div>
    <div style="margin:0 14px 8px"><button class="btn primary big" data-primary id="idf-go" ${state.image || state.audio ? '' : 'disabled'}>${ico('sparkle', 20)} Analizza con AI</button></div></div>
    <div id="idf-out"></div>
    <input type="file" id="idf-input" accept="audio/*" class="hidden">`;
  root.querySelectorAll('[data-cat]').forEach(
    (b) =>
      (b.onclick = () => {
        state = { cat: b.dataset.cat, image: null, audio: null, audioName: '' };
        render();
      })
  );
  if (isAudio) {
    root.querySelector('#idf-rec').onclick = recordAudio;
    root.querySelector('#idf-file').onclick = () => root.querySelector('#idf-input').click();
    root.querySelector('#idf-input').onchange = onAudioFile;
  } else {
    root.querySelector('#idf-photo').onclick = takePhoto;
  }
  root.querySelector('#idf-go').onclick = analyze;
}

async function takePhoto() {
  try {
    const p = await Camera.getPhoto({ quality: 82, width: 1400, height: 1400, correctOrientation: true, resultType: CameraResultType.Base64, source: CameraSource.Prompt, promptLabelHeader: 'Foto', promptLabelPhoto: 'Galleria', promptLabelPicture: 'Scatta foto' });
    state.image = { mime: 'image/' + (p.format === 'jpg' ? 'jpeg' : p.format || 'jpeg'), data: p.base64String };
    render();
  } catch (e) {
    if (!/cancel/i.test(String(e.message || e))) toast('Impossibile aprire la fotocamera');
  }
}

async function onAudioFile(e) {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  try {
    toast('Preparo l\'audio…');
    state.audio = await audioToWav(await f.arrayBuffer());
    state.audioName = f.name;
    render();
  } catch {
    toast('Formato audio non leggibile');
  }
}

let recorder = null;
async function recordAudio() {
  const btn = root.querySelector('#idf-rec');
  if (recorder) {
    recorder.stop();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      recorder = null;
      try {
        const blob = new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' });
        state.audio = await audioToWav(await blob.arrayBuffer());
        state.audioName = 'Registrazione';
      } catch {
        toast('Registrazione non valida');
      }
      render();
    };
    recorder.start();
    btn.innerHTML = `${ico('stop', 18)} Stop (max 30 s)`;
    setTimeout(() => recorder && recorder.stop(), 30000);
  } catch {
    recorder = null;
    toast('Microfono non disponibile: controlla i permessi');
  }
}

function dbList(cat) {
  return ALL.filter((x) => cat.kinds.includes(x._k) && cat.filter(x))
    .map((x) => `${x.id}|${x.nome}${x.sci ? ' (' + x.sci + ')' : ''}`)
    .join('; ');
}

async function analyze() {
  const cat = CATS.find((c) => c.id === state.cat);
  const out = root.querySelector('#idf-out');
  if (!hasAI()) {
    out.innerHTML = `<div class="warnbox" style="margin:12px 14px">${esc(aiErrorMessage(new Error('NO_KEY')))}</div>`;
    return;
  }
  const btn = root.querySelector('#idf-go');
  setBusy(btn, true, 'Analizzo…');
  out.innerHTML = '';
  const p = lastPos();
  let zone = '';
  if (p) {
    const z = nearestZone(p.lat, p.lon);
    zone = `${p.lat.toFixed(3)},${p.lon.toFixed(3)} (zona: ${z.zone.name})`;
  }
  const note = root.querySelector('#idf-note').value.trim();
  const system =
    'Sei un naturalista italiano esperto di tracce di fauna, flora spontanea e micologia. Rispondi SOLO con JSON valido, in italiano. Non inventare: se l\'immagine o il suono non bastano, dillo e abbassa la confidenza. Per funghi ed erbe non dare mai conferma certa di commestibilità e indica sempre le specie simili pericolose.';
  const user = `Categoria: ${cat.prompt}. Data: ${new Date().toLocaleDateString('it-IT')}. Posizione approssimativa: ${zone || 'non nota'}. ${note ? 'Note dell\'utente: ' + note + '. ' : ''}
Database locale (id|nome): ${dbList(cat)}.
Se il soggetto corrisponde a una voce del database usa il suo id in "id_db", altrimenti null.
Rispondi con questo JSON: {"identificabile":true|false,"candidati":[{"id_db":"...|null","nome":"","scientifico":"","confidenza":0-100,"motivo":"elementi visibili o udibili che lo supportano","da_verificare":"cosa controllare per confermare"}],"avvertenze":"","consigli":"come migliorare foto/registrazione se serve"} con al massimo 3 candidati ordinati per confidenza.`;
  try {
    const r = await askModel({ system, user, json: true, images: state.image ? [state.image] : [], audio: state.audio });
    showResult(out, parseJSON(r.text), cat, r.provider);
  } catch (e) {
    out.innerHTML = `<div class="warnbox" style="margin:12px 14px">${esc(aiErrorMessage(e))}</div>`;
  }
  setBusy(btn, false);
}

function showResult(out, j, cat, provider) {
  const c = (j.candidati || []).slice(0, 3);
  const risky = cat.id === 'fungo' || cat.id === 'erba';
  if (!c.length) {
    out.innerHTML = `<div class="cand"><h3>Nessun riconoscimento</h3><p>${esc(j.consigli || j.avvertenze || 'Prova con una foto più nitida o da un\'altra angolazione.')}</p></div>`;
    return;
  }
  out.innerHTML =
    (risky ? `<div class="warnbox" style="margin:12px 14px"><b>Attenzione.</b> L'AI può sbagliare. Non mangiare mai funghi o erbe in base a questo risultato: fai controllare da un esperto.</div>` : '') +
    c
      .map((x, i) => {
        const entry = x.id_db && x.id_db !== 'null' ? byId(x.id_db, cat.kinds) : null;
        const conf = Math.max(0, Math.min(100, Number(x.confidenza) || 0));
        return `<div class="cand"><div class="row" style="justify-content:space-between;align-items:flex-start"><h3>${i === 0 ? '1. ' : i + 1 + '. '}${esc(x.nome || entry?.nome || '—')}</h3><b>${conf}%</b></div>
          <small class="muted"><i>${esc(x.scientifico || entry?.sci || '')}</i></small>
          <div class="bar"><i style="width:${conf}%"></i></div>
          ${x.motivo ? `<p style="margin:6px 0">${esc(x.motivo)}</p>` : ''}
          ${x.da_verificare ? `<p class="muted" style="margin:6px 0;font-size:.88rem"><b>Da verificare:</b> ${esc(x.da_verificare)}</p>` : ''}
          ${i === 0 && entry ? `<div style="border-top:1px solid var(--paper2);margin-top:10px;padding-top:10px">${schedaHTML(entry)}</div>` : entry ? `<button class="btn ghost small" data-scheda="${entry.id}" data-k="${entry._k}">${ico('book', 16)} Scheda</button>` : ''}
        </div>`;
      })
      .join('') +
    (j.avvertenze ? `<div class="infobox" style="margin:0 14px 8px">${esc(j.avvertenze)}</div>` : '') +
    (j.consigli ? `<p class="muted" style="margin:0 18px 8px;font-size:.85rem">${esc(j.consigli)}</p>` : '') +
    `<p class="muted" style="text-align:center;font-size:.75rem;margin:6px 0 18px">Analisi: ${esc(provider)}</p>`;
  out.querySelectorAll('[data-scheda]').forEach((b) => (b.onclick = () => openScheda(byId(b.dataset.scheda, [b.dataset.k]))));
}
