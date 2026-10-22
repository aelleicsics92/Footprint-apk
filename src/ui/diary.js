import { openPage } from '../lib/ui.js';
import { esc, fmtDate } from '../lib/util.js';
import { getWaypoints, openWaypoint } from '../lib/waypoints.js';
import { wpIcon } from '../lib/icons.js';
import { toast } from '../lib/ui.js';

const NON_RACCOLTA = ['parcheggio', 'acqua', 'pericolo', 'panorama', 'orma'];
const M = ['G', 'F', 'M', 'A', 'M', 'G', 'L', 'A', 'S', 'O', 'N', 'D'];

export function openDiary() {
  openPage('Diario raccolti', (pg) => {
    const all = getWaypoints().filter((w) => !NON_RACCOLTA.includes(w.icon)).sort((a, b) => b.ts - a.ts);
    if (!all.length) {
      pg.body.innerHTML = '<div class="empty"><p>Nessun ritrovamento.<br>Salva un waypoint di fungo o tartufo (puoi indicare quantità e peso) e comparirà qui.</p></div>';
      return;
    }
    const years = [...new Set(all.map((w) => new Date(w.ts).getFullYear()))].sort((a, b) => b - a);
    let year = years[0];
    const draw = () => {
      const l = all.filter((w) => new Date(w.ts).getFullYear() === year);
      const qty = l.reduce((a, w) => a + (Number(w.qty) || 1), 0);
      const kg = l.reduce((a, w) => a + (Number(w.kg) || 0), 0);
      const months = Array(12).fill(0);
      l.forEach((w) => (months[new Date(w.ts).getMonth()] += Number(w.qty) || 1));
      const mx = Math.max(...months, 1);
      const sp = {}, dogs = {};
      l.forEach((w) => {
        const n = wpIcon(w.icon).label;
        sp[n] = (sp[n] || 0) + (Number(w.qty) || 1);
        if (w.dog) dogs[w.dog] = (dogs[w.dog] || 0) + (Number(w.qty) || 1);
      });
      const top = Object.entries(sp).sort((a, b) => b[1] - a[1]);
      const day0 = new Date().toDateString();
      const today = all.filter((w) => new Date(w.ts).toDateString() === day0);
      const tsp = {};
      today.forEach((w) => { const n = wpIcon(w.icon).label; const t = tsp[n] || (tsp[n] = { q: 0, kg: 0 }); t.q += Number(w.qty) || 1; t.kg += Number(w.kg) || 0; });
      const tkg = today.reduce((a, w) => a + (Number(w.kg) || 0), 0), tq = today.reduce((a, w) => a + (Number(w.qty) || 1), 0);
      const paniere = today.length
        ? `<div class="paniere"><b>Paniere di oggi</b><div class="pn-t">${tq} pz${tkg ? ' · ' + tkg.toFixed(1).replace('.', ',') + ' kg' : ''}</div><div>${Object.entries(tsp).map(([n, t]) => `${esc(n)}: ${t.q} pz${t.kg ? ' (' + t.kg.toFixed(1).replace('.', ',') + ' kg)' : ''}`).join(' · ')}</div></div>`
        : '';
      const withAlt = l.filter((w) => w.alt != null && !isNaN(w.alt));
      let altHtml = '';
      if (withAlt.length >= 3) {
        const B = 200, bins = {};
        withAlt.forEach((w) => { const k = Math.floor(w.alt / B) * B; bins[k] = (bins[k] || 0) + (Number(w.qty) || 1); });
        const ks = Object.keys(bins).map(Number).sort((a, b) => a - b), tot = Object.values(bins).reduce((a, b) => a + b, 0), mxb = Math.max(...Object.values(bins));
        const bk = ks.reduce((a, k) => (bins[k] > bins[a] ? k : a), ks[0]);
        altHtml = `<div class="sec-title" style="font-size:1.05rem;margin-top:26px">Per quota</div><p class="muted" style="margin:0 16px 6px;font-size:.85rem">${Math.round((bins[bk] / tot) * 100)}% dei ritrovamenti tra ${bk} e ${bk + B} m</p><div class="list">${ks.map((k) => `<div class="set-row"><div class="ti"><b>${k}-${k + B} m</b></div><div class="qbar"><i style="width:${(bins[k] / mxb) * 100}%"></i></div><b>${bins[k]}</b></div>`).join('')}</div>`;
      }
      pg.body.innerHTML = `
        ${paniere}
        <div style="padding:10px 14px 0"><button class="btn ghost big" id="why-btn">Perché qui? Analizza i miei ritrovamenti</button><div id="why-out" style="margin-top:8px;font-size:.88rem;line-height:1.5"></div></div>
        <div class="row gap" style="padding:12px 14px 0;flex-wrap:wrap">${years.map((y) => `<button class="chip ${y === year ? 'sel' : ''}" data-y="${y}">${y}</button>`).join('')}</div>
        <div class="diary-stat"><div><b>${l.length}</b><span>Ritrovamenti</span></div><div><b>${qty}</b><span>Esemplari</span></div><div><b>${kg ? kg.toFixed(1).replace('.', ',') : '–'}</b><span>kg totali</span></div></div>
        <div class="mbars">${months.map((v, i) => `<div style="height:${Math.max(3, (v / mx) * 100)}%" title="${v}"><small>${M[i]}</small></div>`).join('')}</div>
        ${altHtml}
        <div class="sec-title" style="font-size:1.05rem;margin-top:26px">Per specie</div>
        <div class="list">${top.map(([n, c]) => `<div class="set-row"><div class="ti"><b>${esc(n)}</b></div><b>${c}</b></div>`).join('')}</div>
        ${Object.keys(dogs).length ? `<div class="sec-title" style="font-size:1.05rem">Per cane</div><div class="list">${Object.entries(dogs).sort((a, b) => b[1] - a[1]).map(([n, c]) => `<div class="set-row"><div class="ti"><b>${esc(n)}</b></div><b>${c}</b></div>`).join('')}</div>` : ''}
        <div class="sec-title" style="font-size:1.05rem">Registro</div>
        <div class="list">${l.map((w) => `<button class="item" data-w="${w.id}"><span class="lead"><span class="ic">${wpIcon(w.icon).svg}</span></span><div class="ti"><b>${esc(w.title)}</b><small>${fmtDate(w.ts)}${w.qty ? ' · ' + w.qty + ' pz' : ''}${w.kg ? ' · ' + w.kg + ' kg' : ''}${w.alt != null ? ' · ' + Math.round(w.alt) + ' m' : ''}${w.dog ? ' · 🐕 ' + esc(w.dog) : ''}</small></div></button>`).join('')}</div>`;
      pg.body.querySelector('#why-btn').onclick = () => why(pg.body.querySelector('#why-out'), all);
      pg.body.querySelectorAll('[data-y]').forEach((b) => (b.onclick = () => ((year = Number(b.dataset.y)), draw())));
      pg.body.querySelectorAll('[data-w]').forEach((b) => (b.onclick = () => openWaypoint(all.find((w) => w.id === b.dataset.w))));
    };
    draw();
  });
}

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
async function why(out, all) {
  if (!navigator.onLine) { out.textContent = 'Serve internet per leggere il meteo storico.'; return; }
  const groups = {};
  all.forEach((w) => (groups[w.icon] = (groups[w.icon] || []).concat(w)));
  const list = Object.entries(groups).filter(([, a]) => a.length >= 3);
  if (!list.length) { out.textContent = 'Servono almeno 3 ritrovamenti della stessa specie.'; return; }
  const res = [];
  for (const [icon, ws] of list) {
    out.textContent = 'Leggo il meteo storico: ' + wpIcon(icon).label + '…';
    const rain = [], temp = [], lag = [], alt = ws.filter((w) => w.alt != null).map((w) => w.alt);
    for (const w of ws.slice(0, 12)) {
      try {
        const e = new Date(w.ts), s = new Date(w.ts - 20 * 86400000);
        const f = (d) => d.toISOString().slice(0, 10);
        const j = await (await fetch(`https://archive-api.open-meteo.com/v1/archive?latitude=${w.lat.toFixed(3)}&longitude=${w.lon.toFixed(3)}&start_date=${f(s)}&end_date=${f(e)}&daily=precipitation_sum,temperature_2m_mean&timezone=auto`)).json();
        const p = j.daily.precipitation_sum, t = j.daily.temperature_2m_mean, n = p.length;
        rain.push(p.slice(Math.max(0, n - 15), n - 1).reduce((a, b) => a + (b || 0), 0));
        temp.push(t.slice(Math.max(0, n - 8)).reduce((a, b) => a + (b || 0), 0) / Math.min(8, n));
        let l = null;
        for (let i = n - 2; i >= 0; i--) if ((p[i] || 0) >= 8) { l = n - 1 - i; break; }
        if (l != null) lag.push(l);
      } catch {}
    }
    if (rain.length >= 3) res.push(`<b>${esc(wpIcon(icon).label)}</b> (${ws.length} ritrovamenti): ${Math.round(med(rain))} mm di pioggia nei 14 giorni prima${lag.length ? `, ultima pioggia utile (8 mm o più) circa ${med(lag)} giorni prima` : ''}, temperatura media ${med(temp).toFixed(0)} °C${alt.length ? `, quota tipica ${Math.round(med(alt))} m` : ''}.`);
  }
  out.innerHTML = res.length ? res.map((r) => `<p style="margin:0 0 8px">${r}</p>`).join('') + '<small class="muted">Valori mediani dei tuoi punti, da dati meteo storici Open-Meteo. Indicativi.</small>' : 'Dati meteo non disponibili al momento.';
}
