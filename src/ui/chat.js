import { ico } from '../lib/icons.js';
import { esc } from '../lib/util.js';
import { askModel, parseJSON, aiErrorMessage, hasAI } from '../lib/ai.js';
import { lastPos } from '../lib/geo.js';
import { fungiContext, nearestZone } from '../lib/fungi.js';
import { getSettings } from '../lib/store.js';

let history = [];
let root, busy = false;

const SUGG = ['Quando usciranno i funghi sull\'Appennino?', 'Quando ha piovuto a Genova nell\'ultimo mese?', 'Che tempo farà qui nei prossimi giorni?', 'Come riconosco un porcino da un boleto Satana?'];

export function mountChat(el) {
  root = el;
  render();
}

function render() {
  root.innerHTML = `
    <div class="chat" id="ch-list">
      ${
        history.length
          ? history.map((m) => `<div class="msg ${m.role}">${esc(m.text)}${m.meta ? `<small>${esc(m.meta)}</small>` : ''}</div>`).join('')
          : `<div class="msg bot">Ciao! Chiedimi di funghi, tartufi, fauna, erbe o meteo (anche di zone lontane).</div>
             <div class="chips" style="padding:0;flex-wrap:wrap">${SUGG.map((s) => `<button class="chip" data-s="${esc(s)}">${esc(s)}</button>`).join('')}</div>`
      }
    </div>
    <div class="chat-input" data-enter-scope>
      <input id="ch-in" type="text" placeholder="Scrivi una domanda…" maxlength="400" autocomplete="off">
      <button class="btn primary" data-primary id="ch-send" aria-label="Invia">${ico('send', 22)}</button>
    </div>`;
  root.querySelectorAll('[data-s]').forEach((b) => (b.onclick = () => send(b.dataset.s)));
  root.querySelector('#ch-send').onclick = () => send(root.querySelector('#ch-in').value);
  scrollEnd();
}
function scrollEnd() {
  const scr = root.closest('.screen');
  if (scr) setTimeout(() => (scr.scrollTop = scr.scrollHeight), 30);
}

async function geocode(name) {
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=it&countryCode=IT`);
  const j = await r.json();
  return j.results && j.results[0];
}
async function weatherSummary(label, lat, lon, daysBack) {
  const past = Math.min(92, Math.max(1, daysBack || 30));
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=precipitation_sum,temperature_2m_max,temperature_2m_min&past_days=${past}&forecast_days=7&timezone=auto`);
  if (!r.ok) throw new Error('meteo');
  const j = await r.json();
  const d = j.daily;
  const today = new Date().toISOString().slice(0, 10);
  const ti = d.time.indexOf(today) >= 0 ? d.time.indexOf(today) : past;
  const rainDays = [];
  let tot = 0;
  for (let i = 0; i <= ti; i++) {
    const v = d.precipitation_sum[i] || 0;
    tot += v;
    if (v >= 1) rainDays.push(`${d.time[i].slice(5)}: ${v.toFixed(1)} mm`);
  }
  const fc = [];
  for (let i = ti + 1; i < d.time.length; i++) fc.push(`${d.time[i].slice(5)}: ${Math.round(d.temperature_2m_min[i])}-${Math.round(d.temperature_2m_max[i])}°C, ${(d.precipitation_sum[i] || 0).toFixed(1)} mm`);
  return `Meteo ${label} (quota ${Math.round(j.elevation)} m). Ultimi ${past} giorni: pioggia totale ${tot.toFixed(0)} mm in ${rainDays.length} giorni piovosi (>=1 mm): ${rainDays.slice(-20).join('; ') || 'nessuna'}. Previsione: ${fc.join(' | ')}.`;
}

async function send(text) {
  text = String(text || '').trim();
  if (!text || busy) return;
  if (!hasAI()) {
    history.push({ role: 'user', text }, { role: 'bot', text: aiErrorMessage(new Error('NO_KEY')) });
    return render();
  }
  busy = true;
  history.push({ role: 'user', text });
  render();
  const list = root.querySelector('#ch-list');
  list.insertAdjacentHTML('beforeend', '<div class="msg bot typing"><i></i><i></i><i></i></div>');
  scrollEnd();
  try {
    const ctx = [];
    const p = lastPos();
    if (p) ctx.push(`Posizione dell'utente: ${p.lat.toFixed(3)}, ${p.lon.toFixed(3)} (zona vicina: ${nearestZone(p.lat, p.lon).zone.name}).`);
    const wantsWx = /pio(ve|gg|v)|meteo|temperatur|neve|gel(o|ata)|vento|nebbia|caldo|freddo|umid|previsio|tempo/i.test(text);
    const wantsFungi = /fung|porcin|tartuf|gallett|ovol|spugnol|prataiol|raccolt|boschi|crescit/i.test(text);
    if (wantsWx) {
      const plan = await askModel({
        system: 'Estrai i luoghi e il periodo da una domanda in italiano. Rispondi SOLO con JSON.',
        user: `Domanda: "${text}"\nJSON: {"luoghi":["nome città/zona italiana o 'qui' se parla della posizione dell'utente"],"giorni_indietro":numero intero (30 se non specificato)}`,
        json: true,
      }).then((r) => parseJSON(r.text)).catch(() => ({ luoghi: ['qui'], giorni_indietro: 30 }));
      for (const nome of (plan.luoghi || []).slice(0, 2)) {
        try {
          if (/^(qui|posizione|vicino)/i.test(nome) && p) ctx.push(await weatherSummary('della posizione dell\'utente', p.lat, p.lon, plan.giorni_indietro));
          else {
            const g = await geocode(nome);
            if (g) ctx.push(await weatherSummary(`${g.name}${g.admin1 ? ' (' + g.admin1 + ')' : ''}`, g.latitude, g.longitude, plan.giorni_indietro));
            else ctx.push(`Luogo "${nome}" non trovato.`);
          }
        } catch {
          ctx.push(`Dati meteo per "${nome}" non disponibili.`);
        }
      }
    }
    if (wantsFungi) {
      try {
        ctx.push(await fungiContext(getSettings().fungiProfile || 'autunnali'));
      } catch {
        ctx.push('Indice funghi non disponibile (serve connessione).');
      }
    }
    const recent = history.slice(-7, -1).map((m) => `${m.role === 'user' ? 'Utente' : 'Assistente'}: ${m.text}`).join('\n');
    const system = `Sei Footprint AI, assistente italiano per trekking, funghi, tartufi, fauna selvatica, erbe spontanee e meteo. Oggi è ${new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}. Rispondi in modo breve e pratico (massimo 8 righe, niente elenchi lunghi). Per meteo e indice funghi usa SOLO i dati forniti sotto; se mancano dillo. L'indice di crescita dei funghi è una stima basata su pioggia, temperatura e stagione, non una certezza. Quando si parla di consumare funghi o erbe ricorda di far controllare il raccolto a un esperto (ispettorato micologico ASL).`;
    const r = await askModel({ system, user: `${ctx.join('\n')}\n\n${recent ? 'Conversazione precedente:\n' + recent + '\n\n' : ''}Domanda: ${text}` });
    history.push({ role: 'bot', text: r.text.trim(), meta: r.provider });
  } catch (e) {
    history.push({ role: 'bot', text: aiErrorMessage(e) });
  }
  busy = false;
  render();
}
