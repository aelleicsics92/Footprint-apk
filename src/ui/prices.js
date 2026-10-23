// Quotazioni dei tartufi al cavatore. Il file prezzi si aggiorna da internet (repository del progetto), con copia incorporata.
import bundled from '../data/prices.json';
import { openPage } from '../lib/ui.js';
import { esc } from '../lib/util.js';
import { wpIcon } from '../lib/icons.js';
import { PROFILES, windowState } from '../lib/fungi.js';
import { kvGet, kvSet } from '../lib/store.js';
import { Capacitor, CapacitorHttp } from '@capacitor/core';

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

// ---------- lettura in tempo reale dai siti di quotazioni (solo app Android: la rete nativa evita i blocchi CORS) ----------
const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
async function getText(url) {
  if (!Capacitor.isNativePlatform()) throw new Error('solo app');
  const r = await Promise.race([CapacitorHttp.get({ url, headers: { 'User-Agent': UA, 'Accept-Language': 'it' }, responseType: 'text' }), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 9000))]);
  if (r.status !== 200) throw new Error('http ' + r.status);
  return typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
}
const toText = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&euro;/g, '€').replace(/&nbsp;|&#160;/g, ' ').replace(/&#8364;/g, '€').replace(/\s+/g, ' ');
const num = (s) => { const t = s.trim(); return Number(/^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, '') : t.replace(/\./g, '').replace(',', '.')); };
export function parseAndare(html) {
  const t = toText(html);
  const g = (re) => { const m = re.exec(t); return m ? num(m[1]) : null; };
  const min = g(/Minima\D{0,30}?(\d[\d.,]*)/i), max = g(/Massima\D{0,30}?(\d[\d.,]*)/i);
  if (!min || !max || min >= max || max > 20000) return null;
  const mix = g(/Piccola\s*[-–/]\s*Grande\D{0,30}?(\d[\d.,]*)/i);
  const d = /aggiornat\w*\s+al\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i.exec(t);
  const date = d ? `${d[3].length === 2 ? '20' + d[3] : d[3]}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}` : null;
  return { min, max, mix: mix && mix >= min && mix <= max ? mix : Math.round((min + max) / 2), date };
}
export function parseMedia(html, name) {
  const t = toText(html);
  const m = new RegExp(name + '[^\\d]{0,80}?(\\d[\\d.]*)[^\\d]{1,30}?(\\d[\\d.]*)', 'i').exec(t);
  if (!m) return null;
  const min = num(m[1]), max = num(m[2]);
  return min && max && min < max && max < 20000 ? { min, max, mix: Math.round((min + max) / 2), date: null } : null;
}
const SLUG = { bianco: 'bianco-pregiato', uncinato: 'uncinato', scorzone: 'scorzone', nero: 'nero-pregiato', bianchetto: 'bianchetto' };
async function discover(id) {
  const html = await getText('https://www.andareatartufi.it/?s=' + encodeURIComponent('quotazioni tartufo ' + SLUG[id].replace('-', ' ')));
  const re = /https?:\/\/(?:www\.)?andareatartufi\.it\/(\d{4}\/\d{2}\/\d{2}\/quotazioni-tartufo-[a-z0-9-]+)\/?/gi;
  let m, best = null;
  while ((m = re.exec(html))) if (m[1].includes(SLUG[id]) && (!best || m[1] > best)) best = m[1];
  return best ? `https://www.andareatartufi.it/${best}/` : null;
}
async function liveItem(it) {
  const tries = [];
  if (it.url) tries.push(it.url);
  for (const u of tries) {
    try { const r = parseAndare(await getText(u)); if (r) return { ...it, ...r, date: r.date || it.date, kind: 'cavatore', src: 'andareatartufi.it', live: true }; } catch {}
  }
  try {
    const u = await discover(it.id);
    if (u) { const r = parseAndare(await getText(u)); if (r) return { ...it, ...r, url: u, date: r.date || it.date, kind: 'cavatore', src: 'andareatartufi.it', live: true }; }
  } catch {}
  try {
    const r = parseMedia(await getText('https://prezzitartufo.it/'), { bianco: 'Bianco\\s+Pregiato', nero: 'Nero\\s+Pregiato', bianchetto: 'Bianchetto', scorzone: 'Estivo', uncinato: 'Uncinato' }[it.id]);
    if (r) return { ...it, ...r, date: new Date().toISOString().slice(0, 10), kind: 'mercato', src: 'prezzitartufo.it', live: true };
  } catch {}
  return it;
}
export async function loadLive(base) {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const c = await kvGet('priceslive');
    if (c && Date.now() - c.at < 3 * 3600000) return c.data;
  } catch {}
  const items = await Promise.all(base.items.map(liveItem));
  if (!items.some((x) => x.live)) return null;
  const data = { ...base, items, updated: new Date().toISOString().slice(0, 10), liveAt: Date.now() };
  try { await kvSet('priceslive', { at: Date.now(), data }); } catch {}
  return data;
}

export const priceOf = (data, id) => (data.items || []).find((x) => x.id === id);

export function openPrices() {
  openPage('Prezzi tartufo', async (pg) => {
    pg.body.innerHTML = '<div class="empty">Carico le quotazioni…</div>';
    const base = await loadPrices();
    const render = (data, liveState) => {
    const today = new Date().toISOString().slice(0, 10);
    const items = data.items.map((x) => ({ ...x, open: !windowState(today, (PROFILES[x.id] || {}).window).closed })).sort((a, b) => Number(b.open) - Number(a.open));
    pg.body.innerHTML = `
      <p class="muted" style="margin:12px 16px 4px;font-size:.84rem">Quanto viene pagato il tartufo a chi lo cerca (al kg). ${liveState === 'live' ? '<b style="color:#1f7a44">● Letto ora dai siti di quotazioni</b>' : liveState === 'load' ? 'Controllo i prezzi online…' : liveState === 'fail' ? 'Online non raggiungibile: mostro le ultime quotazioni note (' + fmt(data.updated) + ').' : 'Aggiornato al ' + fmt(data.updated) + '.'}</p>
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
    };
    render(base, Capacitor.isNativePlatform() ? 'load' : '');
    if (Capacitor.isNativePlatform()) loadLive(base).then((d) => render(d || base, d ? 'live' : 'fail')).catch(() => render(base, 'fail'));
  });
}
