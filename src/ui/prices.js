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

// ---------- media pesata di più fonti ----------
const ageDays = (d) => (d ? Math.max(0, (Date.now() - new Date(d + 'T12:00:00').getTime()) / 86400000) : null);
const wAge = (d) => { const a = ageDays(d); return a == null ? 0.4 : a <= 21 ? 1 : a <= 60 ? 0.6 : a <= 120 ? 0.3 : 0.15; };
const wmean = (arr, w) => { let n = 0, t = 0; arr.forEach((v, i) => { if (v != null && w[i] > 0) { n += v * w[i]; t += w[i]; } }); return t ? n / t : null; };
export function consensus(it) {
  const src = (it.sources && it.sources.length ? it.sources : [{ name: it.src || 'fonte', kind: it.kind, date: it.date, min: it.min, mix: it.mix, max: it.max }]).filter((x) => x.mix > 0);
  const w = src.map((x) => wAge(x.date));
  // le fonti molto lontane dalla mediana delle altre pesano meno (mostrate comunque, segnate come fuori scala)
  const sorted = src.map((x, i) => ({ v: x.mix, w: w[i] })).sort((a, b) => a.v - b.v);
  let acc = 0, med = sorted[0] ? sorted[0].v : 0;
  const tot = sorted.reduce((a, b) => a + b.w, 0);
  for (const e of sorted) { acc += e.w; if (acc >= tot / 2) { med = e.v; break; } }
  const out = src.map((x) => Math.abs(x.mix - med) / med > 0.5);
  const w2 = w.map((v, i) => (out[i] ? v * 0.35 : v));
  const sz = (k) => wmean(src.map((x) => x.sizes && x.sizes[k]), w2);
  const mins = wmean(src.map((x) => x.min), w2), maxs = wmean(src.map((x) => x.max), w2), mix = wmean(src.map((x) => x.mix), w2);
  const dates = src.map((x) => x.date).filter(Boolean).sort();
  const sizes = { p: sz('p'), m: sz('m'), g: sz('g') };
  return {
    ...it, min: Math.round(mins), max: Math.round(maxs), mix: Math.round(mix), date: dates[dates.length - 1] || it.date, src: src.length > 1 ? `media di ${src.length} fonti` : src[0].name, kind: src.length > 1 ? 'media' : it.kind,
    list: src.map((x, i) => ({ ...x, off: out[i] })), sizes: sizes.p || sizes.m || sizes.g ? sizes : null,
  };
}
const finalize = (d) => ({ ...d, items: (d.items || []).map(consensus) });

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
  return finalize(best);
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
const numAuto = (str) => {
  let t = String(str).trim();
  const c = t.lastIndexOf(','), d = t.lastIndexOf('.');
  if (c >= 0 && d >= 0) t = c > d ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else if (c >= 0) t = /,\d{3}$/.test(t) ? t.replace(/,/g, '') : t.replace(',', '.');
  else if (d >= 0 && /\.\d{3}$/.test(t)) t = t.replace(/\./g, '');
  return Number(t);
};
const EPI = { magnatum: 'bianco', melanosporum: 'nero', uncinatum: 'uncinato', aestivum: 'scorzone', borchii: 'bianchetto' };
// andareatartufi.app: tabella per pezzatura (0-15 g, 15-100 g, oltre 100 g)
export function parseApp(html) {
  const t = toText(html), out = {};
  const re = /PREZZO\s+TARTUFO\s+[A-ZÀ-Ü' ]+?\(\s*Tuber\s+([A-Za-z]+)[^)]*\)\s+(N\/A|\d[\d.,]*)\s+(N\/A|\d[\d.,]*)\s+(N\/A|\d[\d.,]*)/gi;
  let m;
  while ((m = re.exec(t))) {
    const id = EPI[m[1].toLowerCase()];
    if (!id) continue;
    const v = [m[2], m[3], m[4]].map((x) => (/n\/a/i.test(x) ? null : numAuto(x)));
    const nums = v.filter((x) => x > 0);
    if (!nums.length) continue;
    out[id] = { min: Math.min(...nums), max: Math.max(...nums), mix: Math.round(nums.reduce((a, b) => a + b, 0) / nums.length), sizes: { p: v[0], m: v[1], g: v[2] } };
  }
  return out;
}
// tartufo.com: prezzi per fascia di peso (8-20 g, 20-50 g, oltre 50 g)
export function parseCom(html) {
  const t = toText(html), out = {};
  const A = { bianco: /Tuber\s+magnatum/i, bianchetto: /Tuber\s+borchii/i, nero: /Tuber\s+melanosporum/i, scorzone: /Tuber\s+aestivum\s+Vittadini/i, uncinato: /var\.?\s*uncinatum/i };
  for (const [id, re] of Object.entries(A)) {
    const m = re.exec(t);
    if (!m) continue;
    let seg = t.slice(m.index, m.index + 700);
    const nx = seg.slice(12).search(/\(\s*Tuber/i);
    if (nx > 0) seg = seg.slice(0, nx + 12);
    const g = (r) => { const x = r.exec(seg); return x ? numAuto(x[1]) : null; };
    const p = g(/\b8\s*[–-]\s*20\s*g\D{0,12}?([\d.,]+)/), mm = g(/\b20\s*[–-]\s*50\s*g\D{0,12}?([\d.,]+)/), gg = g(/>\s*50\s*g\D{0,12}?([\d.,]+)/);
    const nums = [p, mm, gg].filter((x) => x > 0);
    if (!nums.length) continue;
    const d = /(?:last\s*updated|aggiornat\w*)\D{0,12}(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/i.exec(seg);
    out[id] = { min: Math.min(...nums), max: Math.max(...nums), mix: Math.round(nums.reduce((a, b) => a + b, 0) / nums.length), sizes: { p, m: mm, g: gg }, date: d ? `${d[3]}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}` : null };
  }
  return out;
}
async function liveCavatore(it) {
  const tries = [];
  if (it.url) tries.push(it.url);
  for (const u of tries) {
    try { const r = parseAndare(await getText(u)); if (r) return r; } catch {}
  }
  try {
    const u = await discover(it.id);
    if (u) { const r = parseAndare(await getText(u)); if (r) return { ...r, url: u }; }
  } catch {}
  return null;
}
// aggiorna (o aggiunge) la fonte con quel nome, solo se il valore è plausibile rispetto a quello precedente
function put(item, name, kind, r, url) {
  if (!r) return false;
  const old = (item.sources || []).find((x) => x.name === name);
  if (old && (r.mix < old.mix * 0.4 || r.mix > old.mix * 2.5)) return false;
  const today = new Date().toISOString().slice(0, 10);
  const nv = { name, kind, date: r.date || today, min: r.min, mix: r.mix, max: r.max, ...(r.sizes ? { sizes: r.sizes } : {}), url: r.url || url || (old && old.url), live: true };
  item.sources = [...(item.sources || []).filter((x) => x.name !== name), nv];
  return true;
}
export async function loadLive(base) {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const c = await kvGet('priceslive2');
    if (c && Date.now() - c.at < 3 * 3600000) return c.data;
  } catch {}
  const items = JSON.parse(JSON.stringify(base.items)).map((x) => ({ ...x, sources: (x.sources || []).map((y) => ({ ...y })) }));
  let ok = 0;
  const [app, com] = await Promise.all([
    getText('https://andareatartufi.app/tartufi-quotazione/').then(parseApp).catch(() => ({})),
    getText('https://www.tartufo.com/en/truffle-prices/').then(parseCom).catch(() => ({})),
  ]);
  await Promise.all(items.map(async (it) => {
    const own = (it.sources || []).find((x) => x.name === 'andareatartufi.it (cavatore)');
    if (put(it, 'andareatartufi.app', 'mercato', app[it.id], 'https://andareatartufi.app/tartufi-quotazione/')) ok++;
    if (put(it, 'tartufo.com', 'mercato', com[it.id], 'https://www.tartufo.com/en/truffle-prices/')) ok++;
    const cav = await liveCavatore(own || { id: it.id });
    if (cav && put(it, 'andareatartufi.it (cavatore)', 'cavatore', cav)) ok++;
    try {
      const r = parseMedia(await getText('https://prezzitartufo.it/'), { bianco: 'Bianco\\s+Pregiato', nero: 'Nero\\s+Pregiato', bianchetto: 'Bianchetto', scorzone: 'Estivo' }[it.id] || 'zzzz');
      if (r && put(it, 'prezzitartufo.it', 'mercato', { ...r, date: null })) ok++;
    } catch {}
  }));
  if (!ok) return null;
  const data = finalize({ ...base, items: items.map((x) => ({ ...x })), updated: new Date().toISOString().slice(0, 10), liveAt: Date.now(), liveOk: ok });
  try { await kvSet('priceslive2', { at: Date.now(), data }); } catch {}
  return data;
}

export const priceOf = (data, id) => (data.items || []).find((x) => x.id === id);

export function openPrices() {
  openPage('Prezzi tartufo', async (pg) => {
    pg.body.innerHTML = '<div class="empty">Carico le quotazioni…</div>';
    const base = await loadPrices();
    let open = null;
    const tiers = (x) => {
      const med = x.sizes && x.sizes.m ? x.sizes.m : (x.min + x.max) / 2;
      const p = x.sizes && x.sizes.p ? x.sizes.p : x.min, g = x.sizes && x.sizes.g ? x.sizes.g : x.max;
      const row = (n, gr, kg, ex) => `<div class="pr-t3"><div><b>${n}</b><small>${gr}</small></div><div class="r"><b>${eur(kg)} €/kg</b><small>${eur(kg / 10)} €/etto · ${ex} g ≈ ${(kg * ex / 1000).toFixed(kg * ex / 1000 < 10 ? 1 : 0).replace('.', ',')} €</small></div></div>`;
      const srcs = (x.list || []).map((y) => `<div class="pr-t3" style="${y.off ? 'opacity:.55' : ''}"><div><b style="font-size:.86rem">${y.url ? `<a href="${esc(y.url)}" target="_blank" rel="noopener" style="color:inherit">${esc(y.name)}</a>` : esc(y.name)}</b><small>${y.kind === 'cavatore' ? 'al cavatore' : 'mercato'} · ${y.date ? fmt(y.date) : 'senza data'}${y.live ? ' · letto ora' : ''}${y.off ? ' · fuori scala' : ''}</small></div><div class="r"><b>${eur(y.min)}-${eur(y.max)}</b><small>medio ${eur(y.mix)} €/kg</small></div></div>`).join('');
      return `<div class="pr-tiers">${row('Piccola', 'fino a ~20 g', p, 10)}${row('Media', '20-50 g', med, 35)}${row('Grande', '50 g e oltre', g, 80)}
        <small class="muted">Il prezzo cresce con il calibro.</small>
        <div class="pr-mix" style="display:block;margin-top:8px"><b style="font-size:.86rem">Fonti confrontate</b></div>${srcs}
        <small class="muted">Media pesata: le fonti recenti contano di più, quelle molto distanti dalle altre pesano meno. I prezzi "al cavatore" (quello che incassa chi cerca) sono più bassi di quelli di mercato.</small></div>`;
    };
    let calcG = '', calcS = '';
    const render = (data, liveState) => {
    const today = new Date().toISOString().slice(0, 10);
    const items = data.items.map((x) => ({ ...x, open: !windowState(today, (PROFILES[x.id] || {}).window).closed })).sort((a, b) => Number(b.open) - Number(a.open));
    pg.body.innerHTML = `
      <p class="muted" style="margin:12px 16px 4px;font-size:.84rem">Prezzo medio al kg, confrontando più siti di quotazioni. ${liveState === 'live' ? '<b style="color:#1f7a44">● Letto ora dai siti di quotazioni</b>' : liveState === 'load' ? 'Controllo i prezzi online…' : liveState === 'fail' ? 'Online non raggiungibile: mostro le ultime quotazioni note (' + fmt(data.updated) + ').' : 'Aggiornato al ' + fmt(data.updated) + '.'}</p>
      <div class="pr-list">${items.map((x) => `<div class="pr-card ${x.open ? '' : 'off'}" data-x="${x.id}">
        <span class="ic big">${wpIcon(x.id).svg}</span>
        <div class="pr-b"><b>${esc(x.name)}</b><small><i>${esc(x.latin)}</i></small>
          <div class="pr-p">${eur(x.min)}-${eur(x.max)} <small>€/kg</small></div>
          <small>Partita mista circa <b>${eur(x.mix)} €/kg</b></small>
          <div class="pr-t"><span class="badge ${x.open ? 'b-ok' : 'b-warn'}">${x.open ? 'Di stagione' : 'Fuori stagione'}</span> <span class="badge b-warn" style="background:#eef0f2;color:#445">${x.kind === 'cavatore' ? 'al cavatore' : x.kind === 'media' ? 'media delle fonti' : 'media di mercato'}</span></div>
          <small class="muted">Dato più recente del ${fmt(x.date)} · ${esc(x.src)}</small>
          <div class="pr-more">${open === x.id ? tiers(x) : ''}<span class="pr-btn">${open === x.id ? 'Nascondi pezzature' : 'Vedi pezzature (I, II, III scelta)'} <b>${open === x.id ? '▴' : '▾'}</b></span></div></div></div>`).join('')}</div>
      <div class="card" style="margin:10px 14px"><h3>Quanto vale il mio raccolto?</h3>
        <div class="row gap"><select id="pc-s" class="grow">${items.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select><input id="pc-g" class="grow" type="number" inputmode="numeric" placeholder="grammi" onfocus="this.select()"></div>
        <div id="pc-o" style="margin-top:10px"></div></div>
      <p class="muted" style="margin:6px 18px 18px;font-size:.78rem;line-height:1.5">${esc(data.note || '')} Sono medie nazionali indicative: calibro, qualità e zona cambiano il prezzo. Per vendere servono tesserino e documenti fiscali in regola.</p>`;
    const calc = () => {
      const it = items.find((x) => x.id === pg.body.querySelector('#pc-s').value), g = Number(pg.body.querySelector('#pc-g').value) || 0;
      const f2 = (v) => v.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      pg.body.querySelector('#pc-o').innerHTML = g && it ? `<div style="font-size:2.1rem;font-weight:800;color:#12372a;line-height:1.1">${f2((g / 1000) * it.mix)} €</div><div class="muted" style="font-size:.85rem;margin-top:2px">stima partita mista · da ${f2((g / 1000) * it.min)} a ${f2((g / 1000) * it.max)} €</div>` : '<div class="muted" style="font-size:.85rem">Scegli la specie e inserisci i grammi</div>';
      calcG = pg.body.querySelector('#pc-g').value; calcS = pg.body.querySelector('#pc-s').value;
    };
    pg.body.querySelectorAll('[data-x]').forEach((c) => (c.onclick = () => { open = open === c.dataset.x ? null : c.dataset.x; render(data, liveState); }));
    if (calcG) { pg.body.querySelector('#pc-g').value = calcG; if (calcS) pg.body.querySelector('#pc-s').value = calcS; }
    calc();
    pg.body.querySelector('#pc-s').onchange = calc;
    pg.body.querySelector('#pc-g').oninput = calc;
    };
    render(base, Capacitor.isNativePlatform() ? 'load' : '');
    if (Capacitor.isNativePlatform()) loadLive(base).then((d) => render(d || base, d ? 'live' : 'fail')).catch(() => render(base, 'fail'));
  });
}
