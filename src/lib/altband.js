// Fascia altimetrica colorata (da DEM Terrarium), serve internet o tile in cache
import L from 'leaflet';
export function makeAltLayer(min, max) {
  const Grid = L.GridLayer.extend({
    createTile(coords, done) {
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      const z = Math.min(coords.z, 13), sh = coords.z - z;
      const f = 2 ** sh;
      const tx = Math.floor(coords.x / f), ty = Math.floor(coords.y / f);
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = () => {
        try {
          const t = document.createElement('canvas');
          t.width = t.height = 256;
          const g = t.getContext('2d', { willReadFrequently: true });
          g.drawImage(im, 0, 0);
          const d = g.getImageData(0, 0, 256, 256).data;
          const o = c.getContext('2d'), out = o.createImageData(256, 256);
          const span = 256 / f, ox = (coords.x - tx * f) * span, oy = (coords.y - ty * f) * span;
          for (let y = 0; y < 256; y++) {
            const sy = Math.min(255, Math.floor(oy + (y * span) / 256));
            for (let x = 0; x < 256; x++) {
              const sx = Math.min(255, Math.floor(ox + (x * span) / 256));
              const i = (sy * 256 + sx) * 4;
              const h = d[i] * 256 + d[i + 1] + d[i + 2] / 256 - 32768;
              if (h >= min && h <= max) {
                const k = (y * 256 + x) * 4;
                out.data[k] = 255; out.data[k + 1] = 196; out.data[k + 2] = 0; out.data[k + 3] = 105;
              }
            }
          }
          o.putImageData(out, 0, 0);
        } catch {}
        done(null, c);
      };
      im.onerror = () => done(null, c);
      im.src = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${tx}/${ty}.png`;
      return c;
    },
  });
  return new Grid({ opacity: 1, zIndex: 300, pane: 'overlayPane' });
}
