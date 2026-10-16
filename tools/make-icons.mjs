// Genera icona adattiva, icone legacy, splash e grafiche per il Play Store.
// Uso: npm run icons  (richiede sharp)
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const RES = 'android/app/src/main/res';
const ROOT = path.resolve('.');

const contour = (o) => `stroke="#9fe0b8" stroke-opacity="${o}" stroke-width=".9" fill="none"`;
const BG_BODY = `
  <defs><radialGradient id="bg" cx="50%" cy="36%" r="78%"><stop offset="0" stop-color="#34815f"/><stop offset=".5" stop-color="#1b4d3a"/><stop offset="1" stop-color="#0a281d"/></radialGradient></defs>
  <rect width="108" height="108" fill="url(#bg)"/>
  <g>
    <path d="M60 30 C62 14 84 8 96 18 C108 28 104 50 90 56 C76 62 58 48 60 30Z" ${contour(0.2)}/>
    <path d="M50 30 C50 6 86 -2 102 12 C118 26 112 58 92 66 C70 74 48 56 50 30Z" ${contour(0.15)}/>
    <path d="M70 30 C72 20 84 16 92 22 C100 28 96 42 86 46 C76 50 68 42 70 30Z" ${contour(0.22)}/>
    <path d="M-6 70 C10 60 30 66 34 82 C38 98 20 112 6 110 C-8 108 -14 82 -6 70Z" ${contour(0.2)}/>
    <path d="M-14 60 C8 46 40 54 46 80 C52 106 28 122 4 120Z" ${contour(0.15)}/>
    <path d="M14 20 C26 12 40 16 42 28 C44 40 30 48 20 44 C10 40 6 28 14 20Z" ${contour(0.12)}/>
  </g>
  <path d="M-4 98 C18 94 24 72 42 76 S76 98 112 72" fill="none" stroke="#f3b45a" stroke-width="2.6" stroke-linecap="round" stroke-dasharray="0.1 4.2" opacity=".9"/>`;

function fgShapes(mode) {
  // mode: 'color' | 'mono' (silhouette bianca per icona a tema)
  const f = (c) => (mode === 'mono' ? '#fff' : c);
  const toe = (cx, cy, rx, ry, rot) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" transform="rotate(${rot} ${cx} ${cy})" fill="${f('url(#toe)')}"/>`;
  const toes = toe(30.5, 46, 5.6, 7.6, -30) + toe(42.5, 31.5, 5.9, 8.2, -11) + toe(65.5, 31.5, 5.9, 8.2, 11) + toe(77.5, 46, 5.6, 7.6, 30);
  const stem = `<path d="M46.5 66 Q45 77 41.5 83.5 H66.500 Q63 77 61.500 66Z" fill="${f('url(#stem)')}"/>`;
  const cap = `<path d="M32.500 66.500 C32.500 52 42 46.500 54 46.500 S75.500 52 75.500 66.500 Q54 72 32.500 66.500Z" fill="${f('url(#cap)')}"/>`;
  return toes + stem + cap;
}

const DEFS = `<defs>
  <linearGradient id="cap" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e0924b"/><stop offset=".55" stop-color="#ac5b25"/><stop offset="1" stop-color="#76391a"/></linearGradient>
  <linearGradient id="stem" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#e6d8b4"/><stop offset=".5" stop-color="#faf3de"/><stop offset="1" stop-color="#d6c59b"/></linearGradient>
  <linearGradient id="toe" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fcf6e2"/><stop offset="1" stop-color="#dfcf a5"/></linearGradient>
  <filter id="blur" x="-30%" y="-30%" width="160%" height="170%"><feGaussianBlur stdDeviation="1.7"/></filter>
</defs>`.replace('#dfcf a5', '#dfcfa5');

const FG_DETAILS = `
  <ellipse cx="45" cy="53.500" rx="9.500" ry="3" transform="rotate(-14 45 53.500)" fill="#ffd9a6" opacity=".45"/>
  <g fill="#f6e7c4" opacity=".85"><circle cx="52" cy="52" r="1.500"/><circle cx="61.500" cy="55" r="1.300"/><circle cx="46" cy="60" r="1.100"/><circle cx="66" cy="61.500" r="1"/><circle cx="56" cy="61" r=".9"/></g>
  <path d="M49.500 72 Q54 74 58.500 72 M48.500 77.500 Q54 79.500 59.500 77.500" stroke="#c9b88c" stroke-width=".8" fill="none" opacity=".8"/>
  <ellipse cx="29" cy="43" rx="1.600" ry="2.400" transform="rotate(-30 29 43)" fill="#fff" opacity=".5"/>
  <ellipse cx="41.500" cy="28.500" rx="1.700" ry="2.600" transform="rotate(-11 41.500 28.500)" fill="#fff" opacity=".5"/>
  <ellipse cx="66.500" cy="28.500" rx="1.700" ry="2.600" transform="rotate(11 66.500 28.500)" fill="#fff" opacity=".5"/>
  <ellipse cx="79" cy="43" rx="1.600" ry="2.400" transform="rotate(30 79 43)" fill="#fff" opacity=".5"/>`;

const svg = (inner, size = 108, vb = '0 0 108 108') => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${vb}">${inner}</svg>`;
const FG = svg(`${DEFS}<g filter="url(#blur)" opacity=".55" transform="translate(0 1.8)" fill="#04150e">${fgShapes('mono').replace(/fill="#fff"/g, 'fill="#04150e"')}</g>${fgShapes('color')}${FG_DETAILS}`);
const FG_MONO = svg(`${DEFS}${fgShapes('mono')}`);
const BG = svg(BG_BODY);
const FULL = svg(`${BG_BODY}${DEFS}<g filter="url(#blur)" opacity=".55" transform="translate(0 1.8)" fill="#04150e">${fgShapes('mono').replace(/fill="#fff"/g, 'fill="#04150e"')}</g>${fgShapes('color')}${FG_DETAILS}`);

const png = (s, size) => sharp(Buffer.from(s), { density: 300 }).resize(size, size).png().toBuffer();
const write = (p, buf) => (fs.mkdirSync(path.dirname(p), { recursive: true }), fs.writeFileSync(p, buf));

fs.mkdirSync('assets', { recursive: true });
fs.writeFileSync('assets/icon-background.svg', BG);
fs.writeFileSync('assets/icon-foreground.svg', FG);
fs.writeFileSync('assets/icon-full.svg', FULL);

const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(dens)) {
  const dir = `${RES}/mipmap-${d}`;
  const layer = Math.round(108 * k);
  write(`${dir}/ic_launcher_foreground.png`, await png(FG, layer));
  write(`${dir}/ic_launcher_background.png`, await png(BG, layer));
  write(`${dir}/ic_launcher_monochrome.png`, await png(FG_MONO, layer));
  // legacy: l'area visibile 72/108 della tela riempie 48dp
  const leg = Math.round(48 * k);
  const big = Math.round((leg * 108) / 72);
  const full = await sharp(Buffer.from(FULL), { density: 300 }).resize(big, big).png().toBuffer();
  const off = Math.round((big - leg) / 2);
  const square = await sharp(full).extract({ left: off, top: off, width: leg, height: leg }).png().toBuffer();
  const r = leg / 2;
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${leg}" height="${leg}"><circle cx="${r}" cy="${r}" r="${r}"/></svg>`);
  const round = await sharp(square).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  const rs = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${leg}" height="${leg}"><rect width="${leg}" height="${leg}" rx="${leg * 0.18}"/></svg>`);
  const rounded = await sharp(square).composite([{ input: rs, blend: 'dest-in' }]).png().toBuffer();
  write(`${dir}/ic_launcher.png`, rounded);
  write(`${dir}/ic_launcher_round.png`, round);
}

const adaptive = (extra = '') => `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>
</adaptive-icon>
`;
write(`${RES}/mipmap-anydpi-v26/ic_launcher.xml`, adaptive());
write(`${RES}/mipmap-anydpi-v26/ic_launcher_round.xml`, adaptive());
for (const f of [`${RES}/drawable/ic_launcher_background.xml`, `${RES}/drawable-v24/ic_launcher_foreground.xml`, `${RES}/values/ic_launcher_background.xml`]) if (fs.existsSync(f)) fs.rmSync(f);

// Splash (stessa dimensione dei file esistenti)
const splashFiles = [];
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name === 'splash.png' && splashFiles.push(path.join(d, e.name))));
walk(RES);
const fgBuf = await png(FG, 1024);
for (const f of splashFiles) {
  const m = await sharp(f).metadata();
  const s = Math.round(Math.min(m.width, m.height) * 0.42);
  const bg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${m.width}" height="${m.height}"><defs><radialGradient id="g" cx="50%" cy="42%" r="75%"><stop offset="0" stop-color="#2a6b50"/><stop offset=".6" stop-color="#14402f"/><stop offset="1" stop-color="#0a281d"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`);
  const logo = await sharp(fgBuf).resize(s, s).toBuffer();
  const out = await sharp(bg).composite([{ input: logo, left: Math.round((m.width - s) / 2), top: Math.round((m.height - s) / 2) }]).png().toBuffer();
  fs.writeFileSync(f, out);
}
// colore tema splash Android 12+
write(`${RES}/values/colors.xml`, `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="colorPrimary">#12372A</color>
    <color name="colorPrimaryDark">#0A281D</color>
    <color name="colorAccent">#D28A2C</color>
</resources>
`);

// Play Store
write('store/icon-512.png', await png(FULL, 512));
const fgFull = await png(FG, 420);
const feature = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="500" viewBox="0 0 1024 500"><defs><radialGradient id="g" cx="30%" cy="40%" r="90%"><stop offset="0" stop-color="#34815f"/><stop offset=".55" stop-color="#1b4d3a"/><stop offset="1" stop-color="#0a281d"/></radialGradient></defs><rect width="1024" height="500" fill="url(#g)"/>
<g fill="none" stroke="#9fe0b8" stroke-opacity=".14" stroke-width="2"><path d="M520 120 C560 20 760 0 860 80 C960 160 940 330 820 380 C690 430 480 340 520 120Z"/><path d="M600 150 C630 90 740 70 800 120 C860 170 840 270 770 300 C690 330 580 260 600 150Z"/><path d="M460 60 C520 -40 800 -60 920 40 C1040 140 1020 400 860 460 C680 520 380 400 460 60Z"/></g>
<path d="M-10 470 C200 440 320 400 520 430 S860 470 1040 400" fill="none" stroke="#f3b45a" stroke-width="5" stroke-linecap="round" stroke-dasharray="0.1 14" opacity=".85"/>
<text x="470" y="235" font-family="DejaVu Serif, Georgia, serif" font-size="96" font-weight="bold" fill="#f8f1dc">Footprint</text>
<text x="474" y="300" font-family="DejaVu Serif, Georgia, serif" font-size="26" fill="#cfe4d6" font-style="italic">Traccia il cammino, rispetta il bosco.</text>
<text x="474" y="360" font-family="Poppins, DejaVu Sans, sans-serif" font-size="24" fill="#f3b45a" letter-spacing="2">GPS · MAPPE OFFLINE · FUNGHI · AI</text></svg>`;
const ft = await sharp(Buffer.from(feature)).composite([{ input: fgFull, left: 30, top: 40 }]).png().toBuffer();
write('store/feature-graphic-1024x500.png', ft);
console.log('Icone generate');
