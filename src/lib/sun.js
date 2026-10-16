// Alba/tramonto e fasi lunari calcolati offline
const rad = Math.PI / 180;
export function sunTimes(date, lat, lon) {
  const J1970 = 2440588, dayMs = 86400000;
  const d = date.valueOf() / dayMs - 0.5 + J1970 - 2451545;
  const n = Math.round(d - 0.0009 - -lon / 360);
  const ds = 0.0009 + -lon / 360 + n;
  const M = rad * (357.5291 + 0.98560028 * ds);
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + rad * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(L) * Math.sin(rad * 23.4397));
  const Jnoon = 2451545 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const h = rad * -0.833;
  const w = Math.acos((Math.sin(h) - Math.sin(rad * lat) * Math.sin(dec)) / (Math.cos(rad * lat) * Math.cos(dec)));
  if (isNaN(w)) return null;
  const Jset = 2451545 + (0.0009 + (w + -rad * lon) / (2 * Math.PI) + n) + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const Jrise = Jnoon - (Jset - Jnoon);
  const toDate = (j) => new Date((j + 0.5 - J1970) * dayMs);
  return { sunrise: toDate(Jrise), sunset: toDate(Jset) };
}
export function moonPhase(date = new Date()) {
  const syn = 29.530588853;
  const ref = Date.UTC(2000, 0, 6, 18, 14);
  const age = (((date.getTime() - ref) / 86400000) % syn + syn) % syn;
  const frac = age / syn;
  const illum = Math.round((1 - Math.cos(2 * Math.PI * frac)) * 50);
  const names = [['🌑', 'Luna nuova'], ['🌒', 'Luna crescente'], ['🌓', 'Primo quarto'], ['🌔', 'Gibbosa crescente'], ['🌕', 'Luna piena'], ['🌖', 'Gibbosa calante'], ['🌗', 'Ultimo quarto'], ['🌘', 'Luna calante']];
  const [em, name] = names[Math.round(frac * 8) % 8];
  return { em, name, illum, waxing: frac < 0.5 };
}

export function sunPos(date, lat, lon) {
  const dayMs = 86400000, J1970 = 2440588, J2000 = 2451545;
  const d = date.valueOf() / dayMs - 0.5 + J1970 - J2000;
  const M = rad * (357.5291 + 0.98560028 * d);
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + rad * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(L) * Math.sin(rad * 23.4397));
  const ra = Math.atan2(Math.sin(L) * Math.cos(rad * 23.4397), Math.cos(L));
  const H = rad * (280.16 + 360.9856235 * d) - rad * -lon - ra;
  const phi = rad * lat;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)) + Math.PI; // da Nord, orario
  return { alt, az };
}
