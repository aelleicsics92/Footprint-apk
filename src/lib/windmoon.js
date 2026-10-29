// Luna (calcolo locale) e venti dei prossimi giorni (Open-Meteo) per la previsione.
const SYN = 29.530588853, REF = Date.UTC(2000, 0, 6, 18, 14);
export function moonAge(d = new Date()) { return ((((d.getTime() - REF) / 86400000) % SYN) + SYN) % SYN; }
export function moonInfo(d = new Date()) {
  const a = moonAge(d), f = a / SYN;
  const names = ['Luna nuova', 'Crescente', 'Primo quarto', 'Gibbosa crescente', 'Luna piena', 'Gibbosa calante', 'Ultimo quarto', 'Calante'];
  const icons = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'];
  const i = Math.round(f * 8) % 8;
  return { i, name: names[i], icon: icons[i], age: a, illum: Math.round((1 - Math.cos(2 * Math.PI * f)) * 50), waxing: f < 0.5 };
}
export function nextPhase(target, from = new Date()) { // target 0 nuova, 0.5 piena
  const a = moonAge(from) / SYN; let d = (target - a + 1) % 1;
  return new Date(from.getTime() + d * SYN * 86400000);
}
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'O', 'NO'];
const WN = { N: 'Tramontana', NE: 'Grecale', E: 'Levante', SE: 'Scirocco', S: 'Ostro', SW: 'Libeccio', O: 'Ponente', NO: 'Maestrale' };
export const windName = (deg) => { const k = DIRS[Math.round(deg / 45) % 8]; return { k, n: WN[k] }; };
// venti umidi dal mare (da S/SE/SW) aiutano; secchi e freddi da N/NE seccano il terreno
export const windTone = (deg) => { const k = windName(deg).k; return ['SE', 'S', 'SW'].includes(k) ? '＋ umido' : ['N', 'NE'].includes(k) ? '− secco/freddo' : '≈ neutro'; };
export async function windsAt(lat, lon) {
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&daily=wind_speed_10m_max,wind_direction_10m_dominant,wind_gusts_10m_max&forecast_days=7&timezone=auto`);
  if (!r.ok) throw new Error('vento');
  const d = (await r.json()).daily;
  return d.time.map((t, i) => ({ t, v: d.wind_speed_10m_max[i], dir: d.wind_direction_10m_dominant[i], g: d.wind_gusts_10m_max[i] }));
}
export async function windMoonHtml(lat, lon) {
  const m = moonInfo(), np = nextPhase(0), fp = nextPhase(0.5), f = (d) => d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
  let w = [];
  try { w = await windsAt(lat, lon); } catch {}
  const day = (t) => new Date(t + 'T12:00').toLocaleDateString('it-IT', { weekday: 'short' });
  return `<div class="infobox" style="margin:10px 14px">
    <b>${m.icon} ${m.name}</b> · illuminata ${m.illum}%<br><small class="muted">Prossima luna nuova ${f(np)}, piena ${f(fp)}. Tradizione: per molti raccoglitori le lune crescenti favoriscono la cacciata, effetto non dimostrato.</small>
    ${w.length ? `<div class="wx-hours" style="padding:8px 0 0">${w.map((x) => { const n = windName(x.dir); return `<div style="text-align:center;min-width:56px;flex:none"><small>${day(x.t)}</small><div style="font-size:1.1rem;transform:rotate(${Math.round(x.dir + 180)}deg)">↑</div><b style="font-size:.8rem">${Math.round(x.v)} km/h</b><small style="display:block">${n.n}</small><small style="display:block;color:#4b5f55">${windTone(x.dir)}</small></div>`; }).join('')}</div>` : '<small class="muted">Venti non disponibili offline.</small>'}</div>`;
}
