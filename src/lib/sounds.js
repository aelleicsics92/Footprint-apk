// Versi degli animali da Wikimedia Commons (serve internet)
const cache = new Map();
export async function findSound(sci, nome) {
  const key = sci || nome;
  if (cache.has(key)) return cache.get(key);
  const latin = (sci || '').split(' ').slice(0, 2).join(' ');
  for (const q of [latin, nome].filter(Boolean)) {
    try {
      const u = `https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrnamespace=6&gsrlimit=8&gsrsearch=${encodeURIComponent('filetype:audio ' + q)}&prop=imageinfo&iiprop=url|mime`;
      const j = await (await fetch(u)).json();
      const pages = Object.values((j.query && j.query.pages) || {}).sort((a, b) => a.index - b.index);
      const hit = pages.find((p) => p.imageinfo && /audio|ogg/.test(p.imageinfo[0].mime));
      if (hit) {
        const r = { url: hit.imageinfo[0].url, title: hit.title.replace(/^File:/, '') };
        cache.set(key, r);
        return r;
      }
    } catch {}
  }
  cache.set(key, null);
  return null;
}
