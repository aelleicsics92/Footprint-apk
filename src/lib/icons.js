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

export const WP_ICONS = [
  { id: 'porcino', label: 'Porcino', color: '#8a4b21', svg: dome({ cap: '#8a4b21', hi: '#c98a52', stem: '#efe3c8', stemPath: 'M17 26 Q13 36 12 43 H36 Q35 36 31 26Z', extra: '<path d="M18 33q6 3 12 0M17 38q7 3 14 0" stroke="#d9c9a5" stroke-width="1" fill="none"/>' }) },
  { id: 'galletto', label: 'Galletto', color: '#e2a017', svg: svg48('<path d="M20 25 L18 43 H30 L28 25Z" fill="#f0b43a"/><path d="M4 19 Q8 13 15 14 Q19 8 24 10 Q29 8 33 14 Q40 13 44 19 Q38 24 30 26 H18 Q10 24 4 19Z" fill="#e2a017"/><path d="M12 19q3 2 4 6M20 16q1 4 0 9M30 17q-1 4 1 8M37 19q-3 2 -4 5" stroke="#b97a0c" stroke-width="1.3" fill="none" opacity=".6"/>') },
  { id: 'ovulo', label: 'Ovulo buono', color: '#e2531f', svg: svg48('<path d="M13 40 Q10 33 17 31 H31 Q38 33 35 40 Q24 46 13 40Z" fill="#f4efe0"/><path d="M19 30 L19 38 H29 L29 30Z" fill="#f2c230"/><path d="M5 27 C5 14 14 8 24 8 S43 14 43 27 Q24 31 5 27Z" fill="#e2531f"/><path d="M6 27 Q24 32 42 27" stroke="#f2c230" stroke-width="2.2" fill="none"/><ellipse cx="16" cy="15" rx="7" ry="3" fill="#ff9a6a" opacity=".5" transform="rotate(-20 16 15)"/>') },
  { id: 'russola', label: 'Russola', color: '#a3243b', svg: svg48('<path d="M19 26 Q18 36 17 43 H31 Q30 36 29 26Z" fill="#f5f1e6"/><path d="M4 26 C4 16 14 11 24 11 S44 16 44 26 Q24 31 4 26Z" fill="#a3243b"/><path d="M8 25 Q24 29 40 25" stroke="#e8c7a0" stroke-width="1.6" fill="none"/><ellipse cx="17" cy="17" rx="8" ry="3" fill="#d4566c" opacity=".5" transform="rotate(-12 17 17)"/>') },
  { id: 'mazza', label: 'Mazza di tamburo', color: '#b58d5c', svg: svg48('<path d="M21.5 24 L20.5 45 H27.5 L26.5 24Z" fill="#e7d8bf"/><path d="M21 31h6M20.8 36h6.4M20.6 41h6.8" stroke="#a98b61" stroke-width="1.1"/><path d="M3 24 C6 11 17 7 24 7 S42 11 45 24 Q24 29 3 24Z" fill="#d1b389"/><ellipse cx="24" cy="12" rx="6" ry="3" fill="#7d5a35"/><g fill="#8a6a43"><circle cx="12" cy="19" r="1.5"/><circle cx="18" cy="15" r="1.3"/><circle cx="31" cy="15" r="1.3"/><circle cx="37" cy="19" r="1.5"/><circle cx="24" cy="21" r="1.4"/></g><path d="M20 26q4 2 8 0" stroke="#fff" stroke-width="1.6" fill="none"/>') },
  { id: 'pleurotus', label: 'Orecchione', color: '#6f7f92', svg: svg48('<rect x="31" y="3" width="11" height="42" rx="4" fill="#6b4f3a"/><path d="M33 20 C16 10 4 20 6 32 C14 34 26 30 33 20Z" fill="#7f8ea0"/><path d="M33 30 C20 24 10 31 14 40 C22 42 30 38 33 30Z" fill="#9aa8b8"/><path d="M33 12 C22 6 14 11 16 18 C23 19 30 17 33 12Z" fill="#6f7f92"/><path d="M12 28q10 1 20-7M16 38q8 -1 16 -6" stroke="#55626f" stroke-width="1" fill="none" opacity=".6"/>') },
  { id: 'fungo', label: 'Fungo generico', color: '#c4a77d', svg: dome({ cap: '#c4a77d', hi: '#ecd9b8', stem: '#f1e8d6', extra: '<g fill="#fff" opacity=".85"><circle cx="15" cy="17" r="2"/><circle cx="25" cy="13" r="2.4"/><circle cx="33" cy="19" r="1.8"/><circle cx="23" cy="21" r="1.4"/></g>' }) },
  { id: 'scorzone', label: 'Tartufo scorzone', color: '#2a2522', svg: truffle({ base: '#2d2724', dark: '#000', light: '#9c8d80', warts: 'pyr' }) },
  { id: 'bianco', label: 'Tartufo bianco', color: '#d9c08a', svg: truffle({ base: '#dcc58f', dark: '#7a6330', light: '#fff4d2', warts: 'vein' }) },
  { id: 'bianchetto', label: 'Bianchetto', color: '#b98b63', svg: truffle({ base: '#bf936a', dark: '#6a4524', light: '#f4dcc0', warts: 'vein' }) },
  { id: 'nero', label: 'Nero pregiato', color: '#3b2b23', svg: truffle({ base: '#3d2d25', dark: '#000', light: '#b49a86', warts: 'mesh' }) },
  { id: 'parcheggio', label: 'Parcheggio', color: '#2f6fb3', svg: circleBadge('#2f6fb3', '<path d="M19 34V14h8a6 6 0 010 12h-8" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>') },
  { id: 'acqua', label: 'Sorgente', color: '#2b9bd1', svg: circleBadge('#2b9bd1', '<path d="M24 10 C31 20 33 24 33 28 a9 9 0 01-18 0 c0-4 2-8 9-18z" fill="#fff"/>') },
  { id: 'pericolo', label: 'Pericolo', color: '#d9822b', svg: svg48('<path d="M24 5 L45 41 H3Z" fill="#d9822b" stroke="#fff" stroke-width="2" stroke-linejoin="round"/><path d="M24 17v13" stroke="#fff" stroke-width="4" stroke-linecap="round"/><circle cx="24" cy="35" r="2.4" fill="#fff"/>') },
  { id: 'panorama', label: 'Panorama', color: '#4f8a6a', svg: circleBadge('#4f8a6a', '<circle cx="31" cy="16" r="4" fill="#ffe28a"/><path d="M8 35 L19 18 L26 28 L30 23 L40 35Z" fill="#fff"/>') },
  { id: 'orma', label: 'Orma / tracce', color: '#7a5a3a', svg: circleBadge('#7a5a3a', '<g fill="#fff"><circle cx="15.5" cy="22" r="3"/><circle cx="21" cy="15" r="3"/><circle cx="28" cy="15" r="3"/><circle cx="33" cy="22" r="3"/><path d="M24.5 24c-5 0-8.5 5-8.5 8 0 3 3 3.5 8.5 1.8 5.500 1.700 8.500 1.200 8.500-1.800 0-3-3.500-8-8.500-8z"/></g>') },
];
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
  scorzone: 'Forest',
  bianco: 'Forest',
  bianchetto: 'Forest',
  nero: 'Forest',
};
