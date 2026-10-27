// Foto delle specie: iNaturalist (foto della specie esatta) + Wikimedia Commons (sezioni/tagliati) + Wikipedia, con cache offline.
import { kvGet, kvSet } from './store.js';

const ALIAS = { 'canis lupus familiaris': ['Canis familiaris'], 'canis familiaris': ['Canis familiaris'] };
const WIKI_ALIAS = { 'Canis familiaris': 'Cane' };

// Nomi latini da provare, dal più specifico al meno (mai specie sbagliate: il cane non ripiega sul lupo)
export function latinList(x) {
  const raw = String(x.foto || x.sci || '').split(/[\/,(]/)[0].replace(/\be affini\b/, '').replace(/\bvar\..*$/, '').replace(/\bspp?\.?$/, '').trim();
  const w = raw.split(/\s+/).filter(Boolean);
  const full = w.join(' ');
  if (ALIAS[full.toLowerCase()]) return ALIAS[full.toLowerCase()];
  const out = [];
  if (w.length >= 3) out.push(w.slice(0, 3).join(' '));
  if (w.length >= 2) out.push(w.slice(0, 2).join(' '));
  if (!out.length && w[0]) out.push(w[0]);
  return [...new Set(out)];
}
export const wikiTitle = (x) => latinList(x)[0] || x.nome;

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
const jget = async (u) => {
  const r = await fetch(u);
  if (!r.ok) throw new Error('http ' + r.status);
  return r.json();
};

// Tassone iNaturalist con nome esatto
const taxMem = new Map();
export function inatTaxon(latin) {
  if (taxMem.has(latin)) return taxMem.get(latin);
  const p = (async () => {
    const key = 'tx:' + latin;
    try {
      const c = await kvGet(key);
      if (c && c.id) return c;
    } catch {}
    const j = await jget(`https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(latin)}&per_page=10&is_active=true`);
    const l = latin.toLowerCase();
    const t = (j.results || []).find((r) => String(r.name).toLowerCase() === l);
    if (!t) return null;
    const v = { id: t.id, name: t.name, thumb: t.default_photo ? t.default_photo.medium_url : null };
    try { await kvSet(key, v); } catch {}
    return v;
  })().catch(() => null).then((v) => {
    if (!v) taxMem.delete(latin);
    return v;
  });
  taxMem.set(latin, p);
  return p;
}
export async function inatTaxonFor(x) {
  for (const l of latinList(x)) {
    const t = await inatTaxon(l);
    if (t) return { ...t, latin: l };
  }
  return null;
}

const blobOf = async (src) => {
  try {
    const r = await fetch(src);
    if (!r.ok) throw new Error();
    return await r.blob();
  } catch {
    return null;
  }
};

// Miniatura per le liste: foto principale della specie esatta
export function getPhoto(x) {
  const k = x._k + '|' + x.id;
  if (mem.has(k)) return mem.get(k);
  const p = run(async () => {
    const key = 'ph2t:' + latinList(x).join('|');
    try {
      const c = await kvGet(key);
      if (c && c.blob) return URL.createObjectURL(c.blob);
    } catch {}
    if (!navigator.onLine) return null;
    let src = null;
    const t = await inatTaxonFor(x);
    if (t && t.thumb) src = t.thumb;
    if (!src) src = await wikiThumb(x);
    if (!src) return null;
    const blob = await blobOf(src);
    if (!blob) return src;
    try { await kvSet(key, { blob }); } catch {}
    return URL.createObjectURL(blob);
  }).then((u) => {
    if (!u) mem.delete(k);
    return u;
  });
  mem.set(k, p);
  return p;
}

async function wikiThumb(x) {
  for (const l of latinList(x)) {
    const title = WIKI_ALIAS[l] || l;
    for (const lang of title === l ? ['en', 'it'] : ['it']) {
      try {
        const j = await jget(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}?redirect=true`);
        if (j.thumbnail && j.type !== 'disambiguation') return j.thumbnail.source.replace(/\/(\d+)px-/, '/640px-');
      } catch {}
    }
  }
  return null;
}

// Commons: file il cui titolo contiene il binomio esatto
const CUT = /(cut|section|sliced|slice|halved|half|gleba|cross|inside|interior|interno|sezione|tagliat|aperto|spaccat|longitudinal|fruitbody_?cut|opened)/i;
const BADT = /(map|range|distrib|icon|logo|symbol|diagram|\.svg|\.gif|\.webp|\.png|question|flag|silhouette|spore|microscop|illustration|drawing|plate|herbarium|stamp|coin|painting|skull|skeleton|taxiderm)/i;
async function commons(latin, wantCut, limit) {
  const [g, s] = latin.split(' ');
  if (!g) return [];
  const q = wantCut ? `"${latin}" cut OR section OR sliced OR gleba` : `"${latin}"`;
  const u = `https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrnamespace=6&gsrlimit=40&gsrsearch=${encodeURIComponent(q + ' filetype:bitmap')}&prop=imageinfo&iiprop=url|mime&iiurlwidth=800`;
  const j = await jget(u);
  const pages = Object.values((j.query && j.query.pages) || {}).sort((a, b) => a.index - b.index);
  const out = [];
  for (const p of pages) {
    const t = p.title.replace(/^File:/, '');
    const tl = t.toLowerCase();
    if (!/\.jpe?g$/i.test(t) || BADT.test(t)) continue;
    if (!tl.includes(g.toLowerCase()) || (s && !tl.includes(s.toLowerCase()))) continue;
    if (wantCut !== CUT.test(t)) continue;
    const ii = p.imageinfo && p.imageinfo[0];
    if (ii) out.push({ src: ii.thumburl || ii.url, t });
    if (out.length >= limit) break;
  }
  return out;
}

async function inatPhotos(t, n) {
  const j = await jget(`https://api.inaturalist.org/v1/taxa/${t.id}`);
  const tx = (j.results || [])[0];
  const arr = (tx && tx.taxon_photos) || [];
  return arr
    .filter((p) => p.photo && p.photo.license_code)
    .slice(0, n)
    .map((p) => ({ src: p.photo.large_url || p.photo.medium_url, t: p.photo.attribution || '' }));
}

// Galleria: più foto della specie esatta (interno/sezione per funghi e tartufi)
export function getPhotos(x, n = 6) {
  const gk = 'g|' + x._k + '|' + x.id;
  if (mem.has(gk)) return mem.get(gk);
  const p = run(async () => {
    const key = 'ph2g:' + latinList(x).join('|');
    try {
      const c = await kvGet(key);
      if (c && c.blobs && c.blobs.length) return c.blobs.map((b) => (b instanceof Blob ? URL.createObjectURL(b) : b));
    } catch {}
    if (!navigator.onLine) return [];
    const isF = x._k === 'funghi' || x._k === 'tartufi';
    const t = await inatTaxonFor(x);
    const latin = t ? t.latin : latinList(x)[0];
    let ins = [], cut = [], com = [];
    await Promise.all([
      t ? inatPhotos(t, 8).then((r) => (ins = r), () => {}) : 0,
      isF && latin ? commons(latin, true, 3).then((r) => (cut = r), () => {}) : 0,
      latin ? commons(latin, false, 4).then((r) => (com = r), () => {}) : 0,
    ]);
    let list;
    if (isF) list = [...ins.slice(0, 3), ...cut.slice(0, 2), ...com.slice(0, 2), ...ins.slice(3), ...cut.slice(2)];
    else list = [...ins.slice(0, 4), ...com.slice(0, 2), ...ins.slice(4)];
    if (!list.length) {
      const w = await wikiThumb(x);
      if (w) list = [{ src: w, t: '' }];
    }
    const seen = new Set();
    list = list.filter((i) => (seen.has(i.src) ? false : seen.add(i.src))).slice(0, n);
    const blobs = [];
    for (const i of list) {
      const b = await blobOf(i.src);
      blobs.push(b || i.src);
    }
    if (blobs.length) try { await kvSet(key, { blobs }); } catch {}
    return blobs.map((b) => (b instanceof Blob ? URL.createObjectURL(b) : b));
  }).then((u) => {
    if (!u || !u.length) mem.delete(gk);
    return u || [];
  });
  mem.set(gk, p);
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
      getPhotos(x, 6).then((urls) => {
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

