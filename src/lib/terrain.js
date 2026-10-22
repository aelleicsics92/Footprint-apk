// Pendenza ed esposizione di un punto dal DEM Terrarium (serve internet)
const cache = new Map();
const tileImg = (z, x, y) => new Promise((res, rej) => {
  const im = new Image();
  im.crossOrigin = 'anonymous';
  im.onload = () => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(im, 0, 0);
    res(g.getImageData(0, 0, 256, 256).data);
  };
  im.onerror = rej;
  im.src = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
});
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
export async function getTerrain(lat, lon) {
  const key = lat.toFixed(4) + ',' + lon.toFixed(4);
  if (cache.has(key)) return cache.get(key);
  const z = 14, n = 2 ** z;
  const fx = ((lon + 180) / 360) * n;
  const r = (lat * Math.PI) / 180;
  const fy = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  const tx = Math.floor(fx), ty = Math.floor(fy);
  const d = await tileImg(z, tx, ty);
  const px = Math.min(251, Math.max(4, Math.floor((fx - tx) * 256))), py = Math.min(251, Math.max(4, Math.floor((fy - ty) * 256)));
  const h = (x, y) => { const i = (y * 256 + x) * 4; return d[i] * 256 + d[i + 1] + d[i + 2] / 256 - 32768; };
  const s = 2, mpp = (40075016.686 * Math.cos(r)) / (256 * n);
  const step = s * mpp;
  const g = (dx, dy) => h(px + dx * s, py + dy * s);
  const dzdx = ((g(1, -1) + 2 * g(1, 0) + g(1, 1)) - (g(-1, -1) + 2 * g(-1, 0) + g(-1, 1))) / (8 * step);
  const dzdy = ((g(-1, 1) + 2 * g(0, 1) + g(1, 1)) - (g(-1, -1) + 2 * g(0, -1) + g(1, -1))) / (8 * step); // y verso sud
  const slope = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
  let asp = null;
  if (slope >= 2) asp = ((Math.atan2(-dzdx, dzdy) * 180) / Math.PI + 360) % 360;
  const out = { elev: h(px, py), slope, aspect: asp, dir: asp == null ? 'pianeggiante' : DIRS[Math.round(asp / 45) % 8] };
  cache.set(key, out);
  return out;
}
export const terrainText = (t) => `Pendenza ${Math.round(t.slope)}°${t.aspect != null ? ` · versante ${t.dir} (${Math.round(t.aspect)}°)` : ' · terreno pianeggiante'}`;
