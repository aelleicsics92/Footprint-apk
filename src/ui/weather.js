import { lsGet, lsSet } from '../lib/store.js';
import { openPage, toast } from '../lib/ui.js';
import { esc } from '../lib/util.js';
import { ico } from '../lib/icons.js';
import { lastPos, getOnce } from '../lib/geo.js';

const WMO = {
  0: ['☀️', 'Sereno'], 1: ['🌤️', 'Prevalentemente sereno'], 2: ['⛅', 'Parzialmente nuvoloso'], 3: ['☁️', 'Coperto'],
  45: ['🌫️', 'Nebbia'], 48: ['🌫️', 'Nebbia con brina'], 51: ['🌦️', 'Pioviggine leggera'], 53: ['🌦️', 'Pioviggine'], 55: ['🌧️', 'Pioviggine intensa'],
  56: ['🌧️', 'Pioviggine gelata'], 57: ['🌧️', 'Pioviggine gelata'], 61: ['🌧️', 'Pioggia debole'], 63: ['🌧️', 'Pioggia'], 65: ['🌧️', 'Pioggia forte'],
  66: ['🌧️', 'Pioggia gelata'], 67: ['🌧️', 'Pioggia gelata forte'], 71: ['🌨️', 'Neve debole'], 73: ['🌨️', 'Neve'], 75: ['❄️', 'Neve forte'], 77: ['🌨️', 'Nevischio'],
  80: ['🌦️', 'Rovesci deboli'], 81: ['🌧️', 'Rovesci'], 82: ['⛈️', 'Rovesci violenti'], 85: ['🌨️', 'Rovesci di neve'], 86: ['❄️', 'Rovesci di neve forti'],
  95: ['⛈️', 'Temporale'], 96: ['⛈️', 'Temporale con grandine'], 99: ['⛈️', 'Temporale con forte grandine'],
};
export const wmo = (c) => WMO[c] || ['🌡️', '—'];

async function fetchWx(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,pressure_msl&hourly=temperature_2m,precipitation_probability,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset&timezone=auto&forecast_days=7&wind_speed_unit=kmh`;
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

export function openWeather() {
  openPage('Meteo', async (pg) => {
    pg.body.innerHTML = '<div class="empty">Cerco la tua posizione…</div>';
    let p = lastPos();
    if (!p) {
      try {
        p = await getOnce(10000);
      } catch {}
    }
    const cache = lsGet('fp.wx');
    let data = null, name = '', stale = false;
    if (p) {
      try {
        pg.body.innerHTML = '<div class="empty">Carico le previsioni…</div>';
        [data, name] = await Promise.all([fetchWx(p.lat, p.lon), placeName(p.lat, p.lon)]);
        lsSet('fp.wx', { data, name, t: Date.now() });
      } catch {}
    }
    if (!data && cache) {
      data = cache.data;
      name = cache.name;
      stale = cache.t;
    }
    if (!data) {
      pg.body.innerHTML = `<div class="empty">${ico('cloud', 40)}<p>Meteo non disponibile.<br>Serve il GPS e una connessione internet.</p></div>`;
      return;
    }
    render(pg.body, data, name, stale);
  });
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
    ${stale ? `<div class="infobox" style="margin:0 14px">Dati salvati (offline), aggiornati il ${new Date(stale).toLocaleString('it-IT')}</div>` : ''}
    <div class="sec-title" style="font-size:1.1rem">Prossime ore</div>
    <div class="wx-hours">${hours
      .map((i) => `<div><span>${d.hourly.time[i].slice(11, 16)}</span><div style="font-size:1.5rem;padding:0">${wmo(d.hourly.weather_code[i])[0]}</div><b>${Math.round(d.hourly.temperature_2m[i])}°</b><span>${d.hourly.precipitation_probability[i] ?? 0}%</span></div>`)
      .join('')}</div>
    <div class="sec-title" style="font-size:1.1rem">7 giorni</div>
    <div class="list">${days}</div>
    <p class="muted" style="text-align:center;font-size:.75rem;margin:12px">Dati meteo: Open-Meteo.com</p>`;
}
