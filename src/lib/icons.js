// Icone UI (stroke) e icone waypoint (colorate)
const P = {
  map: '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
  layers: '<path d="M12 3L3 8l9 5 9-5z"/><path d="M3 12.5l9 5 9-5M3 16.5l9 5 9-5"/>',
  locate: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3"/>',
  download: '<path d="M12 3v12m0 0l-4-4m4 4l4-4"/><path d="M4 17v3h16v-3"/>',
  upload: '<path d="M12 16V4m0 0L8 8m4-4l4 4"/><path d="M4 17v3h16v-3"/>',
  pinplus: '<path d="M12 21s-7-6.1-7-11a7 7 0 0114 0c0 4.9-7 11-7 11z"/><path d="M12 7v6M9 10h6"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4 18l5-5 4 4 3-3 4 4"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/>',
  cloud: '<path d="M7 18a4 4 0 010-8 5.5 5.5 0 0110.6 1.5A3.3 3.3 0 0117 18z"/>',
  route: '<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h8a3 3 0 000-6H8a3 3 0 010-6h8"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/>',
  share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.6M8.2 13.2l7.6 4.6"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  nav: '<path d="M12 3l7 17-7-4-7 4z"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12l4.5 4.5L19 7"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  mushroom: '<path d="M3 12a9 8 0 0118 0z"/><path d="M9.5 12l-.5 8h6l-.5-8"/>',
  leaf: '<path d="M5 19C5 10 10 5 20 4c0 10-5 15-13 15z"/><path d="M5 19l8-8"/>',
  paw: '<circle cx="6.5" cy="10" r="1.8"/><circle cx="10.5" cy="6" r="1.8"/><circle cx="15.5" cy="6" r="1.8"/><circle cx="19" cy="10" r="1.8"/><path d="M12.8 11.5c-3 0-5.3 3.2-5.3 5.2 0 2 2 2.2 5.3 1 3.3 1.2 5.3 1 5.3-1 0-2-2.3-5.2-5.3-5.2z"/>',
  play: '<path d="M7 5l12 7-12 7z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
  warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
  more: '<path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="3.2"/>',
  send: '<path d="M4 12l16-8-6 16-3-7z"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  book: '<path d="M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3z"/><path d="M5 17a3 3 0 013-3h11"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>',
  trail: '<path d="M4 20c4-2 2-6 6-8s6-1 6-5M16 7l3-3 1 4"/>',
  rec: '<circle cx="12" cy="12" r="5" fill="currentColor"/>',
  car: '<path d="M5 11l1.6-4.2A2 2 0 018.5 5.5h7a2 2 0 011.9 1.3L19 11h.5A1.5 1.5 0 0121 12.5V17a1 1 0 01-1 1h-1a2 2 0 01-4 0H9a2 2 0 01-4 0H4a1 1 0 01-1-1v-4.5A1.5 1.5 0 014.5 11zM8.1 7.4L7.2 10h9.6l-.9-2.6a.5.5 0 00-.5-.4H8.6a.5.5 0 00-.5.4z" fill-rule="evenodd"/><circle cx="7" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
};
export function ico(name, size = 22, cls = '') {
  return `<svg class="ico ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}

// ---------- Icone waypoint (viewBox 48) ----------
const svg48 = (inner) => `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
const shade = (inner) => inner;

function dome({ cap, hi, stem, stemPath, extra = '', capPath }) {
  return svg48(`
    <path d="${stemPath || 'M18 26 Q17 38 14 43 H34 Q31 38 30 26Z'}" fill="${stem}"/>
    <path d="${capPath || 'M5 27 C5 13 15 6 24 6 S43 13 43 27 Q24 32 5 27Z'}" fill="${cap}"/>
    <ellipse cx="17" cy="14" rx="8" ry="3.6" fill="${hi}" opacity=".55" transform="rotate(-18 17 14)"/>
    ${extra}`);
}
function truffle({ base, dark, light, warts = 'fine' }) {
  let tex = '';
  if (warts === 'pyr') {
    for (let i = 0; i < 14; i++) {
      const x = 11 + ((i * 17) % 27);
      const y = 12 + ((i * 11) % 24);
      tex += `<path d="M${x} ${y} l2.4 -3.4 l2.4 3.4z" fill="${light}" opacity=".5"/>`;
    }
  } else if (warts === 'mesh') {
    tex = `<path d="M12 16l24 14M10 24l26 12M16 12l22 12M12 32l20-18M20 38l18-16" stroke="${light}" stroke-width=".9" opacity=".35" fill="none"/>`;
  } else if (warts === 'vein') {
    tex = `<path d="M14 20q6 -3 10 2t10 -2M13 29q7 3 12 -1t10 3" stroke="${light}" stroke-width="1.1" opacity=".55" fill="none"/>`;
  }
  return svg48(`
    <path d="M24 7 C35 6 43 14 42 25 C41 36 33 43 23 42 C13 41 6 33 7 23 C8 14 14 8 24 7Z" fill="${base}"/>
    <path d="M24 7 C35 6 43 14 42 25 C41 36 33 43 23 42" fill="none" stroke="${dark}" stroke-width="2" opacity=".35"/>
    ${tex}
    <ellipse cx="17" cy="15" rx="6" ry="3" fill="#fff" opacity=".18" transform="rotate(-25 17 15)"/>`);
}
const circleBadge = (bg, inner) => svg48(`<circle cx="24" cy="24" r="19" fill="${bg}"/>${inner}`);

const WP_IMG = import.meta.glob('../assets/wp/*.png', { eager: true, query: '?url', import: 'default' });
const wpImg = (id) => `<img class="wpimg" src="${WP_IMG['../assets/wp/' + id + '.png']}" alt="" draggable="false">`;
const WP_DEF = [
  ['porcino', 'Porcino', '#8a4b21'],
  ['galletto', 'Gallinaccio', '#e2a017'],
  ['ovulo', 'Ovulo buono', '#e2531f'],
  ['prugnolo', 'Prugnolo', '#d9cfae'],
  ['gambesecche', 'Gambesecche', '#c9a26a'],
  ['chiodini', 'Chiodini', '#c9a26a'],
  ['prataiolo', 'Prataiolo', '#d8b9b0'],
  ['morchella', 'Spugnola', '#7a5b2c'],
  ['steccherino', 'Steccherino', '#d9a64b'],
  ['trombetta', 'Trombetta dei morti', '#3b3b3b'],
  ['pinarolo', 'Pinarolo', '#c99a2a'],
  ['pinaiolo', 'Pinaiolo', '#7a2f1a'],
  ['leccino', 'Leccino (boleto)', '#6b5236'],
  ['cardoncello', 'Cardoncello', '#8a7a62'],
  ['tignosa', 'Tignosa vinata', '#a45a5a'],
  ['lactarius', 'Sanguinello', '#d9722a'],
  ['vescia', 'Vescia gigante', '#e8e4da'],
  ['russola', 'Russola', '#a23a78'],
  ['mazza', 'Mazza di tamburo', '#9a8466'],
  ['pleurotus', 'Orecchione', '#6e7f93'],
  ['fungo', 'Fungo generico', '#a88a5d'],
  ['scorzone', 'Tartufo scorzone', '#33302d'],
  ['bianco', 'Tartufo bianco', '#b8996a'],
  ['bianchetto', 'Bianchetto', '#c9b48a'],
  ['nero', 'Nero pregiato', '#2a2623'],
  ['parcheggio', 'Parcheggio', '#1f6fb5'],
  ['acqua', 'Sorgente', '#3b9bd1'],
  ['pericolo', 'Pericolo', '#d9792a'],
  ['panorama', 'Panorama', '#3f7a4a'],
  ['orma', 'Orma / tracce', '#8a5a3a'],
];
export const WP_ICONS = WP_DEF.map(([id, label, color]) => ({ id, label, color, svg: wpImg(id) }));
export const orderedIcons = (order) => {
  const o = Array.isArray(order) ? order : [];
  const rank = (id) => (o.indexOf(id) < 0 ? 999 : o.indexOf(id));
  return [...WP_ICONS].sort((a, b) => rank(a.id) - rank(b.id));
};
export const WP_BY_ID = Object.fromEntries(WP_ICONS.map((i) => [i.id, i]));
export const wpIcon = (id) => WP_BY_ID[id] || WP_BY_ID.fungo;
export const GARMIN_SYM = {
  parcheggio: 'Parking Area',
  acqua: 'Drinking Water',
  pericolo: 'Danger Area',
  panorama: 'Scenic Area',
  orma: 'Trail Head',
  porcino: 'Forest',
  galletto: 'Forest',
  ovulo: 'Forest',
  russola: 'Forest',
  mazza: 'Forest',
  pleurotus: 'Forest',
  fungo: 'Forest',
  prugnolo: 'Forest',
  gambesecche: 'Forest',
  chiodini: 'Forest',
  prataiolo: 'Forest',
  morchella: 'Forest',
  steccherino: 'Forest',
  trombetta: 'Forest',
  pinarolo: 'Forest',
  pinaiolo: 'Forest',
  leccino: 'Forest',
  cardoncello: 'Forest',
  tignosa: 'Forest',
  lactarius: 'Forest',
  vescia: 'Forest',
  scorzone: 'Forest',
  bianco: 'Forest',
  bianchetto: 'Forest',
  nero: 'Forest',
};
