// Foto delle specie da Wikipedia/Wikimedia Commons (licenze libere), con cache locale per l'uso offline.
import { kvGet, kvSet } from './store.js';

export function wikiTitle(x) {
  if (x.foto) return x.foto;
  const first = String(x.sci || '').split(/[\/,(]/)[0].replace(/\be affini\b/, '').replace(/\bvar\..*$/, '').trim();
  const [g, s] = first.split(/\s+/);
  if (!g) return x.nome;
  return s && /^[a-z-]+$/.test(s) && s !== 'spp.' && s !== 'spp' ? `${g} ${s}` : g;
}

const mem = new Map();
const queue = [];
let running = 0;
const run = (fn) =>
  new Promise((res) => {
    queue.push(() => fn().then(res, () => res(null)));
    pump();
  });
function pump() {
  while (running < 3 && queue.length) {
    running++;
    queue.shift()().finally(() => {
      running--;
      pump();
    });
  }
}

async function summary(lang, title) {
  const r = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}?redirect=true`);
  if (!r.ok) return null;
  const j = await r.json();
  return j.thumbnail ? { src: j.thumbnail.source, page: j.content_urls?.desktop?.page || '' } : null;
}

// Restituisce un URL utilizzabile in <img> oppure null
export function getPhoto(x) {
  const title = wikiTitle(x);
  if (mem.has(title)) return mem.get(title);
  const p = run(async () => {
    const key = 'ph:' + title;
    try {
      const c = await kvGet(key);
      if (c && c.blob) return URL.createObjectURL(c.blob);
    } catch {}
    if (!navigator.onLine) return null;
    let s = null;
    try {
      s = (await summary('it', title)) || (await summary('en', title));
    } catch {}
    if (!s) return null;
    const src = s.src.replace(/\/(\d+)px-/, '/480px-');
    let blob;
    try {
      const r = await fetch(src);
      if (!r.ok) throw new Error();
      blob = await r.blob();
    } catch {
      return s.src;
    }
    try {
      await kvSet(key, { blob, page: s.page });
    } catch {}
    return URL.createObjectURL(blob);
  }).then((u) => {
    if (!u) mem.delete(title);
    return u;
  });
  mem.set(title, p);
  return p;
}

// Collega i segnaposto [data-ph="kind|id"] presenti in un contenitore
export function hydratePhotos(root, resolver) {
  const els = [...root.querySelectorAll('[data-ph]')];
  const load = (el) => {
    if (el.dataset.done) return;
    el.dataset.done = '1';
    const x = resolver(el.dataset.ph);
    if (!x) return;
    if (el.classList.contains('sc-photo')) {
      getGallery(x, x._k === 'tartufi' ? 4 : 3).then((urls) => {
        if (!el.isConnected) return;
        if (urls && urls.length > 1) {
          el.classList.add('gal');
          el.innerHTML = urls.map((u) => `<img src="${u}" alt="" draggable="false">`).join('');
          const chk = () => {
            if (el.querySelector('img')) return;
            el.classList.remove('gal');
            getPhoto(x).then((u) => el.isConnected && (el.innerHTML = u ? `<img src="${u}" alt="" draggable="false">` : '<span class="muted">Foto non disponibile</span>'));
          };
          el.querySelectorAll('img').forEach((im) => im.addEventListener('error', () => (im.remove(), chk())));
        } else getPhoto(x).then((u) => {
          if (!el.isConnected) return;
          el.innerHTML = u ? `<img src="${u}" alt="" draggable="false">` : '<span class="muted">Foto non disponibile</span>';
        });
      });
      return;
    }
    getPhoto(x).then((u) => {
      if (u && el.isConnected) el.innerHTML = `<img src="${u}" alt="" draggable="false">`;
      else if (el.isConnected && el.classList.contains('sc-photo')) el.innerHTML = '<span class="muted">Foto non disponibile</span>';
    });
  };
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (es) =>
        es.forEach((e) => {
          if (e.isIntersecting) {
            io.unobserve(e.target);
            load(e.target);
          }
        }),
      { root: null, rootMargin: '200px' }
    );
    els.forEach((e) => io.observe(e));
  } else els.forEach(load);
}

// Galleria: più foto dalla pagina Wikipedia (es. tartufo fuori e dentro, pianta con foglia e fiore)
const BAD = /(map|mappa|range|distrib|icon|logo|symbol|diagram|schema|\.svg|\.png|\.gif|\.webp|commons|wiki|question|edible|toxic|poison|flag|sign|stub|silhouette|portrait|spore|microscop|illustration|drawing|plate|\bpl\b)/i;
const GOOD = /(section|cross|interior|inside|sliced|cut|gleba|sezione|tagliat|flower|fiore|bloom|fruit|frutto|leaf|foglia|habitat|young|adult|track|print|scat)/i;
async function mediaList(lang, title) {
  const r = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/media-list/${encodeURIComponent(title.replace(/ /g, '_'))}?redirect=true`);
  if (!r.ok) return [];
  const j = await r.json();
  return (j.items || [])
    .filter((i) => i.type === 'image' && i.srcset && i.srcset.length && /\.jpe?g/i.test(i.title || '') && !BAD.test(i.title || ''))
    .map((i) => ({ t: i.title, src: 'https:' + i.srcset[i.srcset.length - 1].src }));
}
export function getGallery(x, n = 4) {
  const title = wikiTitle(x);
  return run(async () => {
    const key = 'gal:' + title;
    try {
      const c = await kvGet(key);
      if (c && c.urls && c.urls.length) return c.urls.slice(0, n);
    } catch {}
    if (!navigator.onLine) return [];
    let list = [];
    try {
      list = await mediaList('it', title);
      if (list.length < 2) list = list.concat(await mediaList('en', title));
    } catch {}
    const seen = new Set();
    list = list.filter((i) => (seen.has(i.src) ? false : seen.add(i.src)));
    list.sort((a, b) => Number(GOOD.test(b.t)) - Number(GOOD.test(a.t)));
    const urls = list.slice(0, n).map((i) => i.src);
    if (urls.length) try { await kvSet(key, { urls }); } catch {}
    return urls;
  });
}
