// Genera icona adattiva, icone legacy, splash e grafiche per il Play Store.
// Uso: npm run icons  (richiede sharp)
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const RES = 'android/app/src/main/res';

const contour = (o, w = 0.9) => `stroke="#a8ecc4" stroke-opacity="${o}" stroke-width="${w}" fill="none"`;
const BG_BODY = `
  <defs>
    <radialGradient id="bg" cx="50%" cy="38%" r="80%"><stop offset="0" stop-color="#2f8a63"/><stop offset=".48" stop-color="#17503a"/><stop offset="1" stop-color="#06201a"/></radialGradient>
    <radialGradient id="glow" cx="50%" cy="46%" r="42%"><stop offset="0" stop-color="#ffe2a8" stop-opacity=".38"/><stop offset="1" stop-color="#ffe2a8" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="108" height="108" fill="url(#bg)"/>
  <g>
    <path d="M54 10 C80 6 100 24 98 50 C96 78 74 100 50 98 C24 96 8 76 10 52 C12 28 30 12 54 10Z" ${contour(0.16)}/>
    <path d="M54 20 C72 18 88 31 86 50 C84 70 68 88 50 86 C32 84 20 68 22 52 C24 34 38 22 54 20Z" ${contour(0.2)}/>
    <path d="M54 30 C65 29 76 38 75 50 C74 62 63 76 51 75 C40 74 32 63 33 53 C34 41 43 31 54 30Z" ${contour(0.26)}/>
    <path d="M-10 30 C12 20 30 30 28 48 C26 66 4 70 -10 62" ${contour(0.14)}/>
    <path d="M118 70 C96 62 84 74 88 90 C92 104 108 108 118 104" ${contour(0.14)}/>
    <path d="M-10 14 C20 4 50 -4 80 -2" ${contour(0.1)}/>
  </g>
  <rect width="108" height="108" fill="url(#glow)"/>`;

const PIN = 'M54 86 C54 86 33 64 33 45 A21 21 0 1 1 75 45 C75 64 54 86 54 86Z';
const MUSH = `<path d="M40.500 46 C40.500 36.500 47 31 54 31 S67.500 36.500 67.500 46 Q54 49.500 40.500 46Z"/><path d="M49.300 47.500 H58.700 Q58.200 53 60 58 H48 Q49.800 53 49.300 47.500Z"/>`;

const DEFS = `<defs>
  <linearGradient id="pin" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="#ffd788"/><stop offset=".5" stop-color="#f09a2a"/><stop offset="1" stop-color="#b5560c"/></linearGradient>
  <linearGradient id="rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff3d2"/><stop offset="1" stop-color="#f6b24c" stop-opacity="0"/></linearGradient>
  <linearGradient id="mush" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0f3a2b"/><stop offset="1" stop-color="#06241b"/></linearGradient>
  <mask id="cut" maskUnits="userSpaceOnUse" x="0" y="0" width="108" height="108"><rect width="108" height="108" fill="#fff"/><g fill="#000">${MUSH}</g></mask>
  <filter id="blur" x="-30%" y="-30%" width="160%" height="170%"><feGaussianBlur stdDeviation="2.2"/></filter>
</defs>`;

const TRAIL = `<path d="M6 100 C26 104 34 86 54 87 S86 96 104 82" fill="none" stroke="#fff3d2" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="0.1 4.6" opacity=".9"/>`;
const GROUND = `<ellipse cx="54" cy="86.500" rx="13" ry="3.200" fill="#04140e" opacity=".5"/>`;

const FG_BODY = `${GROUND}${TRAIL}
  <g filter="url(#blur)" opacity=".5" transform="translate(0 2.500)"><path d="${PIN}" fill="#020c08"/></g>
  <path d="${PIN}" fill="url(#pin)"/>
  <path d="${PIN}" fill="none" stroke="url(#rim)" stroke-width="1.300"/>
  <path d="M38 38 C40 28 48 24 56 24" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="2.200" stroke-linecap="round"/>
  <circle cx="54" cy="45" r="15.500" fill="#fff4d6" opacity=".95"/>
  <g fill="url(#mush)">${MUSH}</g>
  <g fill="#fff4d6" opacity=".95"><circle cx="49" cy="38.800" r="1.700"/><circle cx="56.500" cy="36" r="1.400"/><circle cx="60.500" cy="41.500" r="1.500"/></g>`;

const svg = (inner, size = 108, vb = '0 0 108 108') => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${vb}">${inner}</svg>`;
const FG = svg(`${DEFS}${FG_BODY}`);
const FG_MONO = svg(`${DEFS}<path d="${PIN}" fill="#fff" mask="url(#cut)"/>`);
const BG = svg(BG_BODY);
const FULL = svg(`${BG_BODY}${DEFS}${FG_BODY}`);

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
