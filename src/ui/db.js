import animals from '../data/animals.json';
import plants from '../data/plants.json';
import mushrooms from '../data/mushrooms.json';
import truffles from '../data/truffles.json';
import { esc } from '../lib/util.js';
import { openSheet } from '../lib/ui.js';

export const DB = {
  animali: animals.map((x) => ({ ...x, _k: 'animali' })),
  erbe: plants.map((x) => ({ ...x, _k: 'erbe' })),
  funghi: mushrooms.map((x) => ({ ...x, _k: 'funghi' })),
  tartufi: truffles.map((x) => ({ ...x, _k: 'tartufi' })),
};
export const ALL = [...DB.animali, ...DB.erbe, ...DB.funghi, ...DB.tartufi];
export const byId = (id, kinds) => ALL.find((x) => x.id === id && (!kinds || kinds.includes(x._k)));

export function statoBadge(stato) {
  if (!stato) return '';
  const s = stato.toLowerCase();
  const cls = s.includes('mortale') ? 'b-dead' : s.includes('tossic') ? 'b-bad' : s.includes('cautela') || s.includes('cottura') || s.includes('non commestibile') ? 'b-warn' : 'b-ok';
  return `<span class="badge ${cls}">${esc(stato)}</span>`;
}

const row = (k, v) => (v ? `<dt>${k}</dt><dd>${esc(v)}</dd>` : '');

export function schedaHTML(x) {
  if (x._k === 'animali') {
    return `<div><h3 style="font-size:1.4rem">${esc(x.nome)}</h3><small class="muted"><i>${esc(x.sci)}</i> · ${esc(x.gruppo)}</small>
      <dl class="kv" style="margin-top:12px">${row('Habitat', x.habitat)}${row('Impronta', x.orma)}${row('Escrementi', x.escrementi)}${row('Verso', x.verso)}${row('Note', x.nota)}</dl></div>`;
  }
  const extra = x._k === 'erbe' ? row('Parte usata', x.parte) + row('Periodo', x.periodo) + row('Ambiente', x.ambiente) : row('Periodo', x.periodo) + row('Habitat', x.habitat);
  const warn =
    x._k === 'erbe' || x._k === 'funghi'
      ? `<div class="warnbox"><b>Non consumare nulla in base a un'app.</b> Fai sempre verificare funghi ed erbe da un esperto (ispettorato micologico ASL per i funghi).</div>`
      : '';
  return `<div><h3 style="font-size:1.4rem">${esc(x.nome)}</h3><div style="margin:4px 0 8px">${statoBadge(x.stato)} <small class="muted"><i>${esc(x.sci)}</i></small></div>
    <dl class="kv">${extra}${row('Come riconoscerlo', x.riconoscimento)}${row('Attenzione', x.attenzione)}</dl>${warn}</div>`;
}

export function openScheda(x) {
  openSheet({ body: schedaHTML(x), full: false });
}
