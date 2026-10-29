// Footprint Wrapped: riepilogo di fine stagione a storie + immagine da condividere.
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { getTracks, loadTracks } from '../lib/track.js';
import { getWaypoints } from '../lib/waypoints.js';
import { wpIcon } from '../lib/icons.js';
import { pushBack, toast } from '../lib/ui.js';
import { esc } from '../lib/util.js';

const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
export const wrappedAvailable = () => new Date().getMonth() === 11 || new Date().getMonth() === 0;

export function computeWrapped(year) {
  const tr = getTracks().filter((t) => new Date(t.start).getFullYear() === year);
  const wp = getWaypoints().filter((w) => new Date(w.ts).getFullYear() === year);
  const km = tr.reduce((a, t) => a + (t.dist || 0), 0) / 1000;
  const up = tr.reduce((a, t) => a + (t.up || 0), 0);
  const hrs = tr.reduce((a, t) => a + (t.dur || 0), 0) / 3600000;
  const perM = Array(12).fill(0);
  tr.forEach((t) => (perM[new Date(t.start).getMonth()] += (t.dist || 0) / 1000));
  const rm = perM.indexOf(Math.max(...perM));
  const longest = tr.reduce((b, t) => (!b || (t.dist || 0) > (b.dist || 0) ? t : b), null);
  const maxAlt = tr.reduce((m, t) => Math.max(m, t.maxAlt || 0), 0);
  const sp = {};
  wp.forEach((w) => { const l = wpIcon(w.icon).label; sp[l] = (sp[l] || 0) + (w.qty || 1); });
  const top = Object.entries(sp).sort((a, b) => b[1] - a[1]);
  const kg = wp.reduce((a, w) => a + (w.kg || 0), 0);
  const pieces = wp.reduce((a, w) => a + (w.qty || 0), 0);
  let title = ['Esploratore del bosco', '🥾'];
  if (km > 400 || up > 15000) title = ['Camminatore instancabile', '🏔️'];
  else if (top[0] && /porcin|tartuf|bianco|nero|scorzone|regius/i.test(top[0][0]) && top[0][1] >= 10) title = ['Cavatore di razza', '🍄'];
  else if (kg > 10 || pieces > 60) title = ['Re della cacciata', '👑'];
  else if (tr.length >= 40) title = ['Frequentatore assiduo dei sentieri', '🧭'];
  return { year, n: tr.length, km, up, hrs, rm: km ? MESI[rm] : null, rmKm: perM[rm], longest, maxAlt, top, kg, pieces, finds: wp.length, title };
}

function slides(s) {
  const f = (n, d = 0) => n.toLocaleString('it-IT', { maximumFractionDigits: d });
  const a = [
    { bg: '#12372a', big: String(s.year), t: 'La tua stagione', sub: 'Footprint Wrapped' },
    { bg: '#1f5a43', big: f(s.km, 0) + ' km', t: 'Hai camminato', sub: `${s.n} uscite · ${f(s.hrs, 0)} ore in movimento` },
    { bg: '#8a4b21', big: f(s.up) + ' m', t: 'Dislivello salito', sub: `${s.maxAlt ? 'Punto più alto: ' + f(s.maxAlt) + ' m' : ''}` },
  ];
  if (s.top.length) a.push({ bg: '#6b3a18', big: s.top[0][0], t: 'Il tuo ritrovamento più frequente', sub: s.top.slice(0, 3).map((x) => `${esc(x[0])} ${x[1]}`).join(' · ') + (s.kg ? ` · ${f(s.kg, 1)} kg totali` : '') });
  if (s.rm) a.push({ bg: '#2a4d6b', big: s.rm[0].toUpperCase() + s.rm.slice(1), t: 'Il tuo mese record', sub: `${f(s.rmKm, 0)} km percorsi${s.longest ? ' · uscita più lunga ' + f(s.longest.dist / 1000, 1) + ' km' : ''}` });
  a.push({ bg: '#12372a', big: s.title[1] + ' ' + s.title[0], t: 'Il tuo titolo', sub: 'Buona stagione!', last: true });
  return a;
}

async function drawImage(s) {
  const c = document.createElement('canvas'); c.width = 1080; c.height = 1920;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 1920); g.addColorStop(0, '#12372a'); g.addColorStop(1, '#1f5a43');
  x.fillStyle = g; x.fillRect(0, 0, 1080, 1920);
  x.fillStyle = '#fff'; x.textAlign = 'center';
  const f = (n, d = 0) => n.toLocaleString('it-IT', { maximumFractionDigits: d });
  x.font = '700 64px sans-serif'; x.fillText('FOOTPRINT WRAPPED ' + s.year, 540, 190);
  const rows = [[f(s.km) + ' km', 'percorsi'], [f(s.up) + ' m', 'di dislivello'], [String(s.n), 'uscite'], [s.top[0] ? s.top[0][0] : String(s.finds), s.top[0] ? 'più trovato' : 'ritrovamenti'], [s.rm ? s.rm : '-', 'mese record']];
  rows.forEach((r, i) => { const y = 440 + i * 230; x.font = '800 120px sans-serif'; x.fillStyle = '#fff'; x.fillText(r[0].length > 12 ? r[0].slice(0, 12) : r[0], 540, y); x.font = '500 46px sans-serif'; x.fillStyle = '#b7d3c4'; x.fillText(r[1], 540, y + 62); });
  x.fillStyle = '#fff'; x.font = '800 78px sans-serif'; x.fillText(s.title[1] + ' ' + s.title[0], 540, 1700);
  x.fillStyle = '#b7d3c4'; x.font = '500 40px sans-serif'; x.fillText('Footprint', 540, 1810);
  return c.toDataURL('image/png');
}
async function shareImg(s) {
  const url = await drawImage(s), b64 = url.split(',')[1], name = `footprint-wrapped-${s.year}.png`;
  if (Capacitor.isNativePlatform()) {
    const r = await Filesystem.writeFile({ path: `share/${name}`, data: b64, directory: Directory.Cache, recursive: true });
    await Share.share({ title: 'Footprint Wrapped', files: [r.uri], dialogTitle: 'Condividi' });
  } else { const a = document.createElement('a'); a.href = url; a.download = name; a.click(); }
}

export async function openWrapped(year = new Date().getFullYear() - (new Date().getMonth() === 0 ? 1 : 0)) {
  await loadTracks().catch(() => {});
  const s = computeWrapped(year);
  if (!s.n && !s.finds) { toast('Nessun dato per ' + year); return; }
  const sl = slides(s);
  let i = 0;
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;z-index:9000;display:flex;flex-direction:column;color:#fff;font-family:var(--sans);transition:background .3s;user-select:none';
  document.body.appendChild(ov);
  const close = () => { unback(); ov.remove(); };
  const unback = pushBack(close);
  const render = () => {
    const c = sl[i];
    ov.style.background = c.bg;
    ov.innerHTML = `<div style="display:flex;gap:4px;padding:calc(var(--sat,0px) + 12px) 12px 0">${sl.map((_, k) => `<i style="flex:1;height:4px;border-radius:2px;background:${k <= i ? '#fff' : 'rgba(255,255,255,.3)'}"></i>`).join('')}</div>
      <button data-x style="position:absolute;right:14px;top:calc(var(--sat,0px) + 24px);background:none;border:0;color:#fff;font-size:1.6rem;z-index:2">✕</button>
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px"><div style="opacity:.8;font-size:1.1rem;margin-bottom:14px">${c.t}</div><div style="font-size:${c.big.length > 10 ? '2.4rem' : '4.2rem'};font-weight:800;line-height:1.1">${esc(c.big)}</div><div style="opacity:.85;margin-top:16px;font-size:1.05rem;max-width:300px">${c.sub}</div>
      ${c.last ? '<button data-sh class="btn" style="margin-top:28px;background:#fff;color:#12372a;font-weight:800">Condividi immagine</button>' : ''}</div>
      <div style="padding:0 0 calc(var(--sab,0px) + 14px);text-align:center;opacity:.55;font-size:.8rem">Tocca per proseguire</div>`;
  };
  ov.addEventListener('click', async (e) => {
    if (e.target.closest('[data-x]')) return close();
    if (e.target.closest('[data-sh]')) { try { await shareImg(s); } catch (er) { if (!String(er).includes('cancel')) toast('Condivisione non riuscita'); } return; }
    const r = ov.getBoundingClientRect();
    if (e.clientX < r.width * 0.3) i = Math.max(0, i - 1);
    else if (i < sl.length - 1) i++;
    render();
  });
  render();
}
