// Quotazioni dei tartufi al cavatore. Il file prezzi si aggiorna da internet (repository del progetto), con copia incorporata.
import bundled from '../data/prices.json';
import { openPage } from '../lib/ui.js';
import { esc } from '../lib/util.js';
import { wpIcon } from '../lib/icons.js';
import { PROFILES, windowState } from '../lib/fungi.js';
import { kvGet, kvSet } from '../lib/store.js';

const URL_RAW = 'https://raw.githubusercontent.com/aelleicsics92/Footprint-apk/main/src/data/prices.json';
const eur = (v) => Math.round(v).toLocaleString('it-IT');
const fmt = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('it-IT');

export async function loadPrices() {
  let best = bundled;
  try {
    const c = await kvGet('prices');
    if (c && c.updated > best.updated) best = c;
  } catch {}
  if (navigator.onLine) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 6000);
      const r = await fetch(URL_RAW + '?t=' + Date.now(), { signal: ctl.signal, cache: 'no-store' });
      clearTimeout(t);
      if (r.ok) {
        const j = await r.json();
        if (j && j.items && j.updated >= best.updated) { best = j; await kvSet('prices', j); }
      }
    } catch {}
  }
  return best;
}
export const priceOf = (data, id) => (data.items || []).find((x) => x.id === id);

export function openPrices() {
  openPage('Prezzi tartufo', async (pg) => {
    pg.body.innerHTML = '<div class="empty">Carico le quotazioni…</div>';
    const data = await loadPrices();
    const today = new Date().toISOString().slice(0, 10);
    const items = data.items.map((x) => ({ ...x, open: !windowState(today, (PROFILES[x.id] || {}).window).closed })).sort((a, b) => Number(b.open) - Number(a.open));
    pg.body.innerHTML = `
      <p class="muted" style="margin:12px 16px 4px;font-size:.84rem">Quanto viene pagato il tartufo a chi lo cerca (al kg). Aggiornato al ${fmt(data.updated)}.</p>
      <div class="pr-list">${items.map((x) => `<div class="pr-card ${x.open ? '' : 'off'}">
        <span class="ic big">${wpIcon(x.id).svg}</span>
        <div class="pr-b"><b>${esc(x.name)}</b><small><i>${esc(x.latin)}</i></small>
          <div class="pr-p">${eur(x.min)}-${eur(x.max)} <small>€/kg</small></div>
          <small>Partita mista circa <b>${eur(x.mix)} €/kg</b></small>
          <div class="pr-t"><span class="badge ${x.open ? 'b-ok' : 'b-warn'}">${x.open ? 'Di stagione' : 'Fuori stagione'}</span> <span class="badge b-warn" style="background:#eef0f2;color:#445">${x.kind === 'cavatore' ? 'al cavatore' : 'media di mercato'}</span></div>
          <small class="muted">Quotazione del ${fmt(x.date)} · ${esc(x.src)}</small></div></div>`).join('')}</div>
      <div class="card" style="margin:10px 14px"><h3>Quanto vale il mio raccolto?</h3>
        <div class="row gap"><select id="pc-s" class="grow">${items.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select><input id="pc-g" class="grow" type="number" inputmode="numeric" placeholder="grammi" onfocus="this.select()"></div>
        <div id="pc-o" style="margin-top:8px;font-weight:700;font-size:1.05rem"></div></div>
      <p class="muted" style="margin:6px 18px 18px;font-size:.78rem;line-height:1.5">${esc(data.note || '')} I valori al cavatore sono medie nazionali indicative: calibro, qualità e zona cambiano il prezzo. Per vendere servono tesserino e documenti fiscali in regola.</p>`;
    const calc = () => {
      const it = items.find((x) => x.id === pg.body.querySelector('#pc-s').value), g = Number(pg.body.querySelector('#pc-g').value) || 0;
      pg.body.querySelector('#pc-o').textContent = g && it ? `${eur((g / 1000) * it.min)}-${eur((g / 1000) * it.max)} € (mista: ${eur((g / 1000) * it.mix)} €)` : '';
    };
    pg.body.querySelector('#pc-s').onchange = calc;
    pg.body.querySelector('#pc-g').oninput = calc;
  });
}
