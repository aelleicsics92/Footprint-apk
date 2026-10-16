import { DB, statoBadge, openScheda } from './db.js';
import { esc } from '../lib/util.js';
import { ico } from '../lib/icons.js';

const TABS = [
  ['animali', 'Animali'],
  ['erbe', 'Erbe'],
  ['funghi', 'Funghi'],
  ['tartufi', 'Tartufi'],
  ['regole', 'Regole'],
];
let tab = 'animali', q = '';
let root;

export function mountGuide(el) {
  root = el;
  render();
}

function render() {
  root.innerHTML = `
    <div class="chips">${TABS.map(([k, l]) => `<button class="chip ${k === tab ? 'sel' : ''}" data-gt="${k}">${l}</button>`).join('')}</div>
    ${tab === 'regole' ? rules() : `<div style="margin:0 14px"><input id="g-q" type="search" placeholder="Cerca…" value="${esc(q)}"></div><div class="list" id="g-list"></div>`}`;
  root.querySelectorAll('[data-gt]').forEach((b) => (b.onclick = () => ((tab = b.dataset.gt), (q = ''), render())));
  if (tab !== 'regole') {
    const inp = root.querySelector('#g-q');
    inp.oninput = () => {
      q = inp.value;
      fill();
    };
    fill();
  }
}

function fill() {
  const list = root.querySelector('#g-list');
  const s = q.trim().toLowerCase();
  const items = DB[tab].filter((x) => !s || x.nome.toLowerCase().includes(s) || (x.sci || '').toLowerCase().includes(s));
  list.innerHTML = items.length
    ? items
        .map(
          (x) => `<button class="item" data-id="${x.id}"><div class="ti"><b>${esc(x.nome)}</b><small><i>${esc(x.sci)}</i></small></div>${x.stato ? statoBadge(x.stato) : `<small class="muted">${esc(x.gruppo)}</small>`}</button>`
        )
        .join('')
    : '<div class="empty">Nessun risultato</div>';
  list.querySelectorAll('[data-id]').forEach((b) => (b.onclick = () => openScheda(DB[tab].find((x) => x.id === b.dataset.id))));
}

function rules() {
  return `<div class="card"><h3>${ico('warn', 18)} Sicurezza</h3>
    <ul style="margin:6px 0 0;padding-left:18px;line-height:1.5">
      <li>Non mangiare mai funghi o erbe in base a un'app o a una foto.</li>
      <li>I controlli sono gratuiti presso l'<b>Ispettorato micologico della tua ASL</b>.</li>
      <li>Raccogli in cestino aerato, mai in sacchetti di plastica.</li>
      <li>Se hai sintomi (nausea, vomito, diarrea) dopo aver mangiato funghi, vai subito al pronto soccorso e porta un esemplare: i sintomi dell'amanita falloide compaiono dopo 6-24 ore.</li>
    </ul></div>
    <div class="card"><h3>${ico('book', 18)} Regole di raccolta (Italia)</h3>
    <ul style="margin:6px 0 0;padding-left:18px;line-height:1.5">
      <li><b>Funghi</b>: la raccolta è regolata dalle Regioni: spesso servono permesso o tesserino, con limiti giornalieri (in molte regioni circa 3 kg a persona) e divieti in parchi e riserve. Verifica le norme locali.</li>
      <li><b>Tartufi</b>: serve il <b>tesserino di idoneità</b> regionale, il cane addestrato, la zappetta e il rispetto del calendario di raccolta.</li>
      <li>Rispetta il bosco: non rastrellare la lettiera, ricopri le buche, non raccogliere esemplari troppo piccoli.</li>
      <li>Fauna: mantieni la distanza, non seguire le tracce di orso o lupo.</li>
    </ul></div>
    <p class="muted" style="text-align:center;font-size:.78rem;margin:14px">Schede indicative: consulta sempre un esperto.</p>`;
}
