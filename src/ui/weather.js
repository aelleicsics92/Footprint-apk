import { lsGet, lsSet } from '../lib/store.js';
import { openPage, openSheet, toast } from '../lib/ui.js';
import { esc } from '../lib/util.js';
import { ico } from '../lib/icons.js';
import { lastPos, getOnce } from '../lib/geo.js';
import { moonPhase } from '../lib/sun.js';

// calo di pressione nelle prossime 6 ore (hPa), positivo = in calo
export function pressureDrop(d) {
  try {
    const h = d.hourly, now = Date.now();
    const i = h.time.findIndex((t) => new Date(t).getTime() >= now - 3600000);
    if (i < 0 || h.pressure_msl[i + 6] == null) return 0;
    return h.pressure_msl[i] - h.pressure_msl[i + 6];
  } catch {
    return 0;
  }
}

const WMO = {
  0: ['☀️', 'Sereno'], 1: ['🌤️', 'Prevalentemente sereno'], 2: ['⛅', 'Parzialmente nuvoloso'], 3: ['☁️', 'Coperto'],
  45: ['🌫️', 'Nebbia'], 48: ['🌫️', 'Nebbia con brina'], 51: ['🌦️', 'Pioviggine leggera'], 53: ['🌦️', 'Pioviggine'], 55: ['🌧️', 'Pioviggine intensa'],
  56: ['🌧️', 'Pioviggine gelata'], 57: ['🌧️', 'Pioviggine gelata'], 61: ['🌧️', 'Pioggia debole'], 63: ['🌧️', 'Pioggia'], 65: ['🌧️', 'Pioggia forte'],
  66: ['🌧️', 'Pioggia gelata'], 67: ['🌧️', 'Pioggia gelata forte'], 71: ['🌨️', 'Neve debole'], 73: ['🌨️', 'Neve'], 75: ['❄️', 'Neve forte'], 77: ['🌨️', 'Nevischio'],
  80: ['🌦️', 'Rovesci deboli'], 81: ['🌧️', 'Rovesci'], 82: ['⛈️', 'Rovesci violenti'], 85: ['🌨️', 'Rovesci di neve'], 86: ['❄️', 'Rovesci di neve forti'],
  95: ['⛈️', 'Temporale'], 96: ['⛈️', 'Temporale con grandine'], 99: ['⛈️', 'Temporale con forte grandine'],
};
export const wmo = (c) => WMO[c] || ['🌡️', '—'];

export async function fetchWx(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,pressure_msl&hourly=temperature_2m,precipitation_probability,weather_code,pressure_msl,soil_temperature_0cm,soil_moisture_0_to_1cm&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset&timezone=auto&forecast_days=7&wind_speed_unit=kmh`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('meteo ' + r.status);
  return r.json();
}
export async function placeName(lat, lon) {
  try {
    const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=it`);
    const j = await r.json();
    return j.locality || j.city || j.principalSubdivision || '';
  } catch {
    return '';
  }
}

async function geocode(q) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=7&language=it&format=json`, { signal: ctl.signal });
    clearTimeout(t);
    const j = await r.json();
    return (j.results || []).map((x) => ({ name: x.name, lat: x.latitude, lon: x.longitude, sub: [x.admin2 || x.admin1, x.country].filter(Boolean).join(', ') }));
  } catch {
    return [];
  }
}

export function openWeather() {
  openPage('Meteo', async (pg) => {
    pg.body.innerHTML = `<div class="f-search" style="margin-top:10px"><input id="wx-q" type="text" placeholder="Cerca un'altra città…" autocomplete="off" enterkeyhint="search" onfocus="this.select()"><button class="chip" id="wx-gps">${ico('locate', 16)} Qui</button></div>
      <div id="wx-sug" class="f-sug"></div><div id="wx-main"><div class="empty">Cerco la tua posizione…</div></div>`;
    const main = pg.body.querySelector('#wx-main'), qi = pg.body.querySelector('#wx-q'), sug = pg.body.querySelector('#wx-sug');
    let cur = null;
    const show = async (p, label, gps) => {
      cur = { lat: p.lat, lon: p.lon, name: label };
      main.innerHTML = '<div class="empty">Carico le previsioni…</div>';
      let data = null, name = label || '', stale = false;
      try {
        const [d, n] = await Promise.all([fetchWx(p.lat, p.lon), label ? label : placeName(p.lat, p.lon)]);
        data = d; name = n || label || '';
        cur.name = name;
        if (gps) lsSet('fp.wx', { data, name, t: Date.now() });
      } catch {}
      if (!data && gps) { const cache = lsGet('fp.wx'); if (cache) { data = cache.data; name = cache.name; stale = cache.t; } }
      if (!data) { main.innerHTML = `<div class="empty">${ico('cloud', 40)}<p>Meteo non disponibile.<br>Serve una connessione internet.</p></div>`; return; }
      render(main, data, name, stale);
      const bt = document.createElement('button');
      bt.className = 'btn';
      bt.style.cssText = 'margin:0 14px 12px;width:calc(100% - 28px);background:#e3eee5;color:#12372a;font-weight:800';
      bt.innerHTML = `${ico('book', 18)} Meteo storico di ${esc(name || 'questa zona')}`;
      bt.onclick = () => openHistory(cur);
      const nowCard = main.querySelector('.wx-now');
      nowCard.insertAdjacentElement('afterend', bt);
    };
    const here = async () => {
      let p = lastPos();
      if (!p) { try { p = await getOnce(10000); } catch {} }
      if (!p) { const cache = lsGet('fp.wx'); if (cache) { render(main, cache.data, cache.name, cache.t); return; } main.innerHTML = `<div class="empty">${ico('cloud', 40)}<p>Meteo non disponibile.<br>Serve il GPS e una connessione internet.</p></div>`; return; }
      await show(p, '', true);
    };
    let tm;
    qi.oninput = () => {
      clearTimeout(tm);
      const q = qi.value.trim();
      if (q.length < 2) return (sug.innerHTML = '');
      tm = setTimeout(async () => {
        const list = await geocode(q);
        sug.innerHTML = list.length ? list.map((c, i) => `<button class="item" data-i="${i}"><div class="ti"><b>${esc(c.name)}</b><small>${esc(c.sub || '')}</small></div></button>`).join('') : '<div class="muted" style="padding:8px 14px">Nessun risultato (serve internet)</div>';
        sug.querySelectorAll('[data-i]').forEach((b) => (b.onclick = () => { const c = list[Number(b.dataset.i)]; sug.innerHTML = ''; qi.value = c.name; qi.blur(); show(c, c.name, false); }));
      }, 350);
    };
    qi.onkeydown = (e) => { if (e.key === 'Enter') { const b = sug.querySelector('[data-i]'); if (b) b.click(); } };
    pg.body.querySelector('#wx-gps').onclick = () => { qi.value = ''; sug.innerHTML = ''; here(); };
    here();
  });
}

const iso = (d) => d.toISOString().slice(0, 10);
export function openHistory(pt) {
  if (!pt) return;
  const s = openSheet({ title: 'Meteo storico', full: true, body: `<div id="mh"><p class="muted" style="margin:0 0 8px">${esc(pt.name || 'Posizione attuale')}</p>
    <div class="chips" style="padding:0 0 8px" id="mh-p"><button class="chip active" data-d="30">Ultimi 30 giorni</button><button class="chip" data-d="90">90 giorni</button><button class="chip" data-d="365">Ultimo anno</button><button class="chip" data-d="ly">Stesso periodo anno scorso</button></div>
    <div class="row gap"><label class="field grow"><span>Dal</span><input id="mh-a" type="date" onfocus="this.select()"></label><label class="field grow"><span>Al</span><input id="mh-b" type="date" onfocus="this.select()"></label></div>
    <button class="btn primary" id="mh-go" style="width:100%">Mostra</button><div id="mh-o" style="margin-top:12px"></div></div>` });
  const q = (x) => s.body.querySelector(x);
  const day = 86400000;
  const setRange = (a, b) => { q('#mh-a').value = iso(a); q('#mh-b').value = iso(b); };
  const preset = (k) => {
    const end = new Date(Date.now() - 2 * day);
    if (k === 'ly') { const a = new Date(Date.now() - 365 * day - 15 * day), b = new Date(Date.now() - 365 * day + 15 * day); setRange(a, b); } else setRange(new Date(end.getTime() - (Number(k) - 1) * day), end);
  };
  const run = async () => {
    const a = q('#mh-a').value, b = q('#mh-b').value;
    if (!a || !b || a > b) { q('#mh-o').textContent = 'Controlla le date.'; return; }
    q('#mh-o').textContent = 'Carico i dati…';
    try {
      const r = await fetch(`https://archive-api.open-meteo.com/v1/archive?latitude=${pt.lat.toFixed(3)}&longitude=${pt.lon.toFixed(3)}&start_date=${a}&end_date=${b}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max&timezone=auto`);
      if (!r.ok) throw new Error('http');
      const d = (await r.json()).daily;
      const n = d.time.length, sum = (x) => x.reduce((t, v) => t + (v || 0), 0);
      const rain = d.precipitation_sum, rd = rain.filter((v) => v >= 1).length, mx = Math.max(...rain, 1);
      const tmx = Math.max(...d.temperature_2m_max), tmn = Math.min(...d.temperature_2m_min);
      const avg = (sum(d.temperature_2m_max) + sum(d.temperature_2m_min)) / (2 * n);
      const bars = rain.map((v) => `<i style="flex:1;min-width:1px;height:${Math.max(2, (v / mx) * 70)}px;background:#3d8f6a;border-radius:2px 2px 0 0" title="${v} mm"></i>`).join('');
      q('#mh-o').innerHTML = `<div class="stats" style="background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px">
        <div><span>Pioggia totale</span><b>${sum(rain).toFixed(0)} mm</b></div><div><span>Giorni di pioggia</span><b>${rd} su ${n}</b></div>
        <div><span>Temp. media</span><b>${avg.toFixed(1)} °C</b></div><div><span>Max / Min</span><b>${tmx.toFixed(0)}° / ${tmn.toFixed(0)}°</b></div>
        <div><span>Giorno più piovoso</span><b>${mx.toFixed(0)} mm, ${new Date(d.time[rain.indexOf(Math.max(...rain))] + 'T12:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })}</b></div><div><span>Vento max</span><b>${Math.max(...d.wind_speed_10m_max).toFixed(0)} km/h</b></div></div>
        <div style="margin:14px 0 4px;font-weight:700">Pioggia giorno per giorno</div><div style="display:flex;align-items:flex-end;gap:1px;height:76px">${bars}</div>
        <div class="muted" style="display:flex;justify-content:space-between;font-size:.75rem"><span>${a}</span><span>${b}</span></div>
        <p class="muted" style="font-size:.75rem">Dati storici Open-Meteo, gli ultimi 2 giorni possono mancare.</p>`;
    } catch { q('#mh-o').textContent = 'Dati non disponibili. Serve una connessione internet.'; }
  };
  q('#mh-p').onclick = (e) => { const b = e.target.closest('[data-d]'); if (!b) return; q('#mh-p').querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === b)); preset(b.dataset.d); run(); };
  q('#mh-go').onclick = run;
  preset('30'); run();
}

function render(body, d, name, stale) {
  const c = d.current;
  const [em, txt] = wmo(c.weather_code);
  const now = Date.now();
  const hours = [];
  for (let i = 0; i < d.hourly.time.length && hours.length < 9; i++) {
    const t = new Date(d.hourly.time[i]).getTime();
    if (t >= now - 3600000 && (hours.length === 0 || i % 3 === 0 || true)) {
      if (hours.length && (t - new Date(d.hourly.time[hours[hours.length - 1]]).getTime()) < 3 * 3600000) continue;
      hours.push(i);
    }
  }
  const days = d.daily.time
    .map((t, i) => {
      const dt = new Date(t + 'T12:00:00');
      const [e, tx] = wmo(d.daily.weather_code[i]);
      return `<div class="wx-day"><span class="d">${i === 0 ? 'Oggi' : dt.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric' })}</span><span class="em">${e}</span><small>${esc(tx)}<br>${d.daily.precipitation_sum[i].toFixed(1)} mm · ${d.daily.precipitation_probability_max[i] ?? 0}%</small><span class="t">${Math.round(d.daily.temperature_2m_min[i])}° / ${Math.round(d.daily.temperature_2m_max[i])}°</span></div>`;
    })
    .join('');
  body.innerHTML = `
    <div class="wx-now">
      <div class="row" style="justify-content:space-between;align-items:flex-start"><div><div style="color:#bcd3c4;font-size:.9rem">${esc(name || 'La tua posizione')}</div><div class="big">${Math.round(c.temperature_2m)}°</div><div>${esc(txt)} · percepita ${Math.round(c.apparent_temperature)}°</div></div><div class="em">${em}</div></div>
      <div class="stats" style="margin-top:14px"><div><span>Vento</span>${Math.round(c.wind_speed_10m)} km/h (raffiche ${Math.round(c.wind_gusts_10m)})</div><div><span>Umidità</span>${c.relative_humidity_2m}%</div><div><span>Pressione</span>${Math.round(c.pressure_msl)} hPa</div><div><span>Alba / tramonto</span>${d.daily.sunrise[0].slice(11)} / ${d.daily.sunset[0].slice(11)}</div></div>
    </div>
    ${(() => {
      const mo = moonPhase(), drop = pressureDrop(d), h = d.hourly;
      const i = Math.max(0, h.time.findIndex((t) => new Date(t).getTime() >= Date.now() - 3600000));
      const st = h.soil_temperature_0cm?.[i], sm = h.soil_moisture_0_to_1cm?.[i];
      const frost = Math.min(d.daily.temperature_2m_min[0], d.daily.temperature_2m_min[1] ?? 99) <= 0;
      return `<div class="stats" style="margin:12px 14px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px"><div><span>Luna</span>${mo.em} ${mo.name} (${mo.illum}%)</div><div><span>Pressione</span>${Math.round(c.pressure_msl)} hPa ${drop >= 3 ? '<b style="color:var(--danger)">⚠ in calo ' + drop.toFixed(1) + '</b>' : drop <= -3 ? '↑ in aumento' : '· stabile'}</div>${st != null ? `<div><span>Temperatura suolo</span>${Math.round(st)}°C</div>` : ''}${sm != null ? `<div><span>Umidità suolo</span>${Math.round(sm * 100)}%</div>` : ''}<div><span>Gelo notturno</span>${frost ? 'SÌ (prossime 48 h)' : 'No'}</div></div>`;
    })()}
    ${stale ? `<div class="infobox" style="margin:0 14px">Dati salvati (offline), aggiornati il ${new Date(stale).toLocaleString('it-IT')}</div>` : ''}
    <div class="sec-title" style="font-size:1.1rem">Prossime ore</div>
    <div class="wx-hours">${hours
      .map((i) => `<div><span>${d.hourly.time[i].slice(11, 16)}</span><div style="font-size:1.5rem;padding:0">${wmo(d.hourly.weather_code[i])[0]}</div><b>${Math.round(d.hourly.temperature_2m[i])}°</b><span>${d.hourly.precipitation_probability[i] ?? 0}%</span></div>`)
      .join('')}</div>
    <div class="sec-title" style="font-size:1.1rem">7 giorni</div>
    <div class="list">${days}</div>
    <p class="muted" style="text-align:center;font-size:.75rem;margin:12px">Dati meteo: Open-Meteo.com</p>`;
}
