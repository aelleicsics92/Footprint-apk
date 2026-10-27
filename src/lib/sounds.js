// Versi: solo registrazioni della specie esatta (iNaturalist osservazioni verificate, poi Commons col nome latino nel titolo)
import { inatTaxonFor, latinList } from './photos.js';

const cache = new Map();
const jget = async (u) => {
  const r = await fetch(u);
  if (!r.ok) throw new Error('http ' + r.status);
  return r.json();
};

async function fromInat(x) {
  const t = await inatTaxonFor(x);
  if (!t) return null;
  const j = await jget(`https://api.inaturalist.org/v1/observations?taxon_id=${t.id}&sounds=true&quality_grade=research&order_by=votes&per_page=15&license=cc0,cc-by,cc-by-sa,cc-by-nc`);
  for (const o of j.results || []) {
    if (!o.taxon || !String(o.taxon.name).toLowerCase().startsWith(t.latin.toLowerCase().split(' ').slice(0, 2).join(' '))) continue;
    for (const s of o.sounds || []) {
      if (s.file_url && s.license_code) {
        return { url: s.file_url, title: `${o.taxon.name} (iNaturalist, ${s.attribution || s.license_code})` };
      }
    }
  }
  return null;
}

async function fromCommons(x) {
  for (const latin of latinList(x)) {
    const [g, s] = latin.toLowerCase().split(' ');
    if (!s) continue;
    const u = `https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrnamespace=6&gsrlimit=20&gsrsearch=${encodeURIComponent('filetype:audio "' + latin + '"')}&prop=imageinfo&iiprop=url|mime`;
    const j = await jget(u);
    const pages = Object.values((j.query && j.query.pages) || {}).sort((a, b) => a.index - b.index);
    const hit = pages.find((p) => p.imageinfo && /audio|ogg/.test(p.imageinfo[0].mime) && p.title.toLowerCase().includes(g) && p.title.toLowerCase().includes(s));
    if (hit) return { url: hit.imageinfo[0].url, title: hit.title.replace(/^File:/, '') + ' (Wikimedia Commons)' };
  }
  return null;
}

// x: scheda animale. Ritorna {url,title} o null (nessun verso se la specie non ne ha)
export async function findSound(x) {
  if (!x.verso) return null;
  const key = x.id;
  if (cache.has(key)) return cache.get(key);
  let r = null;
  try { r = await fromInat(x); } catch {}
  if (!r) try { r = await fromCommons(x); } catch {}
  if (r) cache.set(key, r);
  return r;
}
