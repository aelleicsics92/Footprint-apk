// Genera icona adattiva, icone legacy, splash e grafiche per il Play Store a partire da assets/icon-fg.png
// (impronta di scarpone con fungo, felce e bussola). Uso: npm run icons  (richiede sharp)
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const RES = 'android/app/src/main/res';
const CREAM = '#f6f0d4';
const FG_PNG = fs.readFileSync('assets/icon-fg.png');
const svg = (inner, size = 108, vb = '0 0 108 108') => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${vb}">${inner}</svg>`;
const BG = svg(`<rect width="108" height="108" fill="${CREAM}"/>`);
const solid = (size, color) => sharp({ create: { width: size, height: size, channels: 4, background: color } }).png().toBuffer();
const fgAt = (size) => sharp(FG_PNG).resize(size, size, { kernel: 'lanczos3' }).png().toBuffer();
const monoAt = async (size) => {
  const { data, info } = await sharp(FG_PNG).resize(size, size).raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) { data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; }
  return sharp(data, { raw: info }).png().toBuffer();
};
const fullAt = async (size) => sharp(await solid(size, CREAM)).composite([{ input: await fgAt(size) }]).png().toBuffer();
const write = (p, buf) => (fs.mkdirSync(path.dirname(p), { recursive: true }), fs.writeFileSync(p, buf));

fs.mkdirSync('assets', { recursive: true });
fs.writeFileSync('assets/icon-background.svg', BG);

const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(dens)) {
  const dir = `${RES}/mipmap-${d}`;
  const layer = Math.round(108 * k);
  write(`${dir}/ic_launcher_foreground.png`, await fgAt(layer));
  write(`${dir}/ic_launcher_background.png`, await solid(layer, CREAM));
  write(`${dir}/ic_launcher_monochrome.png`, await monoAt(layer));
  // legacy: l'area visibile 72/108 della tela riempie 48dp
  const leg = Math.round(48 * k);
  const big = Math.round((leg * 108) / 72);
  const full = await fullAt(big);
  const off = Math.round((big - leg) / 2);
  const square = await sharp(full).extract({ left: off, top: off, width: leg, height: leg }).png().toBuffer();
  const r = leg / 2;
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${leg}" height="${leg}"><circle cx="${r}" cy="${r}" r="${r}"/></svg>`);
  const round = await sharp(square).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  const rs = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${leg}" height="${leg}"><rect width="${leg}" height="${leg}" rx="${leg * 0.22}"/></svg>`);
  const rounded = await sharp(square).composite([{ input: rs, blend: 'dest-in' }]).png().toBuffer();
  write(`${dir}/ic_launcher.png`, rounded);
  write(`${dir}/ic_launcher_round.png`, round);
}

const adaptive = () => `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>
</adaptive-icon>
`;
write(`${RES}/mipmap-anydpi-v26/ic_launcher.xml`, adaptive());
write(`${RES}/mipmap-anydpi-v26/ic_launcher_round.xml`, adaptive());
for (const f of [`${RES}/drawable/ic_launcher_background.xml`, `${RES}/drawable-v24/ic_launcher_foreground.xml`, `${RES}/values/ic_launcher_background.xml`]) if (fs.existsSync(f)) fs.rmSync(f);

// Splash: sfondo crema, impronta, nome e sottotitolo
const splashFiles = [];
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name === 'splash.png' && splashFiles.push(path.join(d, e.name))));
walk(RES);
const fgBuf = await fgAt(1024);
for (const f of splashFiles) {
  const m = await sharp(f).metadata();
  const s = Math.round(Math.min(m.width, m.height) * 0.46);
  const bg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${m.width}" height="${m.height}"><rect width="100%" height="100%" fill="${CREAM}"/></svg>`);
  const logo = await sharp(fgBuf).resize(s, s).toBuffer();
  const top = Math.round((m.height - s) / 2) - Math.round(s * 0.14);
  const fs1 = Math.round(m.width * 0.1), fs2 = Math.round(m.width * 0.032);
  const ty = top + s + Math.round(fs1 * 0.5);
  const txt = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${m.width}" height="${m.height}"><text x="50%" y="${ty}" text-anchor="middle" font-family="DejaVu Serif, Georgia, serif" font-weight="bold" font-size="${fs1}" fill="#2f3b12">Footprint</text><text x="50%" y="${ty + Math.round(fs2 * 2.1)}" text-anchor="middle" font-family="DejaVu Serif, Georgia, serif" font-style="italic" font-size="${fs2}" fill="#5a6a2a">Traccia il cammino, rispetta il bosco.</text></svg>`);
  const out = await sharp(bg).composite([{ input: logo, left: Math.round((m.width - s) / 2), top }, { input: txt, left: 0, top: 0 }]).png().toBuffer();
  fs.writeFileSync(f, out);
}
write(`${RES}/values/colors.xml`, `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="colorPrimary">#12372A</color>
    <color name="colorPrimaryDark">#0A281D</color>
    <color name="colorAccent">#D28A2C</color>
</resources>
`);

// Play Store
write('store/icon-512.png', await fullAt(512));
const tile = await sharp(await fullAt(380)).composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="380" height="380"><rect width="380" height="380" rx="84"/></svg>'), blend: 'dest-in' }]).png().toBuffer();
const feature = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="500" viewBox="0 0 1024 500"><defs><radialGradient id="g" cx="30%" cy="40%" r="90%"><stop offset="0" stop-color="#34815f"/><stop offset=".55" stop-color="#1b4d3a"/><stop offset="1" stop-color="#0a281d"/></radialGradient></defs><rect width="1024" height="500" fill="url(#g)"/>
<g fill="none" stroke="#9fe0b8" stroke-opacity=".14" stroke-width="2"><path d="M520 120 C560 20 760 0 860 80 C960 160 940 330 820 380 C690 430 480 340 520 120Z"/><path d="M600 150 C630 90 740 70 800 120 C860 170 840 270 770 300 C690 330 580 260 600 150Z"/><path d="M460 60 C520 -40 800 -60 920 40 C1040 140 1020 400 860 460 C680 520 380 400 460 60Z"/></g>
<text x="470" y="235" font-family="DejaVu Serif, Georgia, serif" font-size="96" font-weight="bold" fill="#f8f1dc">Footprint</text>
<text x="474" y="300" font-family="DejaVu Serif, Georgia, serif" font-size="26" fill="#cfe4d6" font-style="italic">Traccia il cammino, rispetta il bosco.</text>
<text x="474" y="360" font-family="Poppins, DejaVu Sans, sans-serif" font-size="24" fill="#f3b45a" letter-spacing="2">GPS · MAPPE OFFLINE · FUNGHI · AI</text></svg>`;
const ft = await sharp(Buffer.from(feature)).composite([{ input: tile, left: 50, top: 60 }]).png().toBuffer();
write('store/feature-graphic-1024x500.png', ft);
console.log('Icone generate');
