// Foschia leggera su tutta la mappa che si dissolve entro ~6 m dal percorso già fatto oggi
import { getTracks, loadTrackPoints, getRec } from './track.js';
import { getWalked } from './walked.js';
import { lastPos } from './geo.js';

export class Fog {
  constructor(map) {
    this.map = map;
    this.cv = document.createElement('canvas');
    this.cv.className = 'fog-cv';
    map.getContainer().appendChild(this.cv);
    this.lines = [];
    this.on = false;
    this.raf = 0;
    const r = () => this.schedule();
    map.on('move zoom rotate resize viewreset', r);
    this.sched = r;
  }
  setActive(v) {
    this.on = v;
    this.cv.style.display = v ? 'block' : 'none';
    if (v) this.reload();
  }
  async reload() {
    if (!this.on) return;
    const since = Date.now() - 24 * 3600 * 1000;
    const lines = [];
    for (const t of getTracks().filter((t) => t.start >= since)) lines.push((await loadTrackPoints(t.id)).map((q) => [q[0], q[1]]));
    this.walked = await getWalked();
    this.lines = lines;
    this.schedule();
  }
  schedule() {
    if (!this.on || this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.draw();
    });
  }
  draw() {
    const m = this.map, sz = m.getSize(), cv = this.cv;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (cv.width !== sz.x * dpr || cv.height !== sz.y * dpr) {
      cv.width = sz.x * dpr;
      cv.height = sz.y * dpr;
      cv.style.width = sz.x + 'px';
      cv.style.height = sz.y + 'px';
    }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, sz.x, sz.y);
    g.fillStyle = 'rgba(232,238,240,0.14)';
    g.fillRect(0, 0, sz.x, sz.y);
    g.globalCompositeOperation = 'destination-out';
    const c = m.getCenter();
    const mpp = (156543.03 * Math.cos((c.lat * Math.PI) / 180)) / 2 ** m.getZoom();
    const w = Math.max(7, (2 * 6) / mpp); // 6 m per lato
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = '#000';
    g.fillStyle = '#000';
    g.lineWidth = w;
    const lines = this.lines.slice();
    if (this.walked) lines.push(this.walked);
    lines.push(getRec().points);
    const p = lastPos();
    if (p) lines.push([[p.lat, p.lon]]);
    g.beginPath();
    for (const ln of lines) {
      let prev = null;
      for (const q of ln) {
        const pt = m.latLngToContainerPoint(q);
        if (pt.x < -80 || pt.y < -80 || pt.x > sz.x + 80 || pt.y > sz.y + 80) { prev = null; continue; }
        if (prev) { g.moveTo(prev.x, prev.y); g.lineTo(pt.x, pt.y); }
        else { g.moveTo(pt.x, pt.y); g.lineTo(pt.x + 0.01, pt.y); }
        prev = pt;
      }
    }
    g.stroke();
    g.globalCompositeOperation = 'source-over';
  }
}
