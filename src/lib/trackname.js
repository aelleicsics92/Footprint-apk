// Nome predefinito della traccia: località più vicina, data e waypoint raccolti
import { CITIES, TOWNS } from '../data/italyfeat.js';
import { haversine } from './util.js';

// [singolare, plurale, cresce a gruppi (si scrive solo il plurale)]
const N = {
  porcino: ['porcino', 'porcini'], regius: ['porcino reale', 'porcini reali'], pinaiolo: ['pinaiolo', 'pinaioli'], pinarolo: ['pinarolo', 'pinaroli'], leccino: ['leccino', 'leccini'],
  galletto: ['gallinaccio', 'gallinacci', 1], ovulo: ['ovulo', 'ovuli'], prugnolo: ['prugnolo', 'prugnoli', 1], gambesecche: ['gambesecche', 'gambesecche', 1], chiodini: ['chiodini', 'chiodini', 1],
  pioppino: ['pioppino', 'pioppini', 1], prataiolo: ['prataiolo', 'prataioli'], morchella: ['spugnola', 'spugnole'], steccherino: ['steccherino', 'steccherini'],
  trombetta: ['trombetta dei morti', 'trombette dei morti', 1], cardoncello: ['cardoncello', 'cardoncelli', 1], tignosa: ['tignosa', 'tignose'], lactarius: ['sanguinello', 'sanguinelli'],
  vescia: ['vescia', 'vesce'], russola: ['russola', 'russole'], mazza: ['mazza di tamburo', 'mazze di tamburo'], pleurotus: ['orecchione', 'orecchioni', 1], fungo: ['fungo', 'funghi'],
  scorzone: ['t. scorzone', 't. scorzoni'], uncinato: ['t. uncinato', 't. uncinati'], bianco: ['t. bianco', 't. bianchi'], bianchetto: ['bianchetto', 'bianchetti'], nero: ['t. nero', 't. neri'],
};
export function foundText(wps) {
  const c = {};
  for (const w of wps) if (N[w.icon]) c[w.icon] = (c[w.icon] || 0) + 1;
  const parts = Object.entries(c).sort((a, b) => b[1] - a[1]).map(([k, n]) => { const d = N[k]; return d[2] ? d[1] : n === 1 ? `1 ${d[0]}` : `${n} ${d[1]}`; });
  return parts.length < 2 ? parts.join('') : parts.slice(0, -1).join(', ') + ' e ' + parts[parts.length - 1];
}
async function place(lat, lon) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4000);
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&accept-language=it&lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`, { signal: ctl.signal });
    clearTimeout(t);
    const a = (await r.json()).address || {};
    const n = a.village || a.hamlet || a.town || a.suburb || a.city || a.municipality || a.locality;
    if (n) return n;
  } catch {}
  let best = null, bd = 15000;
  for (const [nm, la, lo] of [...CITIES, ...TOWNS]) { const d = haversine({ lat, lon }, { lat: la, lon: lo }); if (d < bd) { bd = d; best = nm; } }
  return best;
}
export async function defaultTrackName(pts, start, end, wps) {
  const p = pts[0];
  const loc = p ? await place(p[0], p[1]) : null;
  const d = new Date(start).toLocaleDateString('it-IT');
  const f = foundText(wps.filter((w) => w.ts >= start - 60000 && w.ts <= end + 60000));
  return `${loc || 'Traccia'}, ${d}${f ? ', ' + f : ''}`;
}
