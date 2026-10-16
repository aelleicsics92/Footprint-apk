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
