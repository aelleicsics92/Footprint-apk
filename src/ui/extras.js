// Radar compagni, terreno e sole, righello fotocamera
import { openPage, openSheet, toast } from '../lib/ui.js';
import { esc, bus, haversine, bearing, cardinal, fmtDist } from '../lib/util.js';
import { lastPos } from '../lib/geo.js';
import { getHeading } from '../lib/compass.js';
import { lsGet, lsSet } from '../lib/store.js';
import { ico } from '../lib/icons.js';
import { sunPos } from '../lib/sun.js';

// ---------- Radar compagni (posizione incollata da WhatsApp/Maps) ----------
export function parseCoords(t) {
  const m = String(t).match(/(-?\d{1,2}\.\d{3,})\s*[,;\s]\s*(-?\d{1,3}\.\d{3,})/);
  if (!m) return null;
  const lat = Number(m[1]), lon = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}
export function openRadar() {
  openPage('Radar compagni', (pg) => {
    let mates = lsGet('fp.mates', []);
    const draw = () => {
      pg.body.innerHTML = `<div style="padding:14px"><p class="muted" style="margin-top:0;font-size:.88rem">Il compagno condivide la sua posizione da WhatsApp o Maps: copia il messaggio, incollalo qui e il radar ti indica direzione e distanza. Riincolla per aggiornarla.</p>
        <label class="field"><span>Nome</span><input id="rd-n" type="text" maxlength="30" onfocus="this.select()"></label>
        <label class="field"><span>Posizione (link o coordinate)</span><textarea id="rd-t" rows="2" onfocus="this.select()"></textarea></label>
        <button class="btn primary big" id="rd-add">${ico('check', 18)} Aggiungi / aggiorna</button></div>
        <div id="rd-list" style="padding:0 14px"></div>`;
      pg.body.querySelector('#rd-add').onclick = () => {
        const c = parseCoords(pg.body.querySelector('#rd-t').value);
        if (!c) return toast('Non trovo le coordinate nel testo');
        const name = pg.body.querySelector('#rd-n').value.trim() || 'Compagno';
        mates = mates.filter((m) => m.name !== name).concat({ name, ...c, ts: Date.now() });
        lsSet('fp.mates', mates);
        draw();
      };
      upd();
    };
    const upd = () => {
      const el = pg.body.querySelector('#rd-list');
      if (!el) return;
      const me = lastPos(), h = getHeading() || 0;
      el.innerHTML = mates.length ? mates.map((m, i) => {
        const d = me ? haversine(me, m) : null, b = me ? bearing(me, m) : null;
        return `<div class="card" style="display:flex;align-items:center;gap:14px"><div style="width:64px;height:64px;border-radius:50%;border:2px solid var(--moss);display:flex;align-items:center;justify-content:center"><div style="transform:rotate(${b == null ? 0 : b - h}deg);font-size:1.8rem;line-height:1;color:var(--moss)">▲</div></div>
          <div class="grow"><b>${esc(m.name)}</b><div class="muted" style="font-size:.88rem">${d == null ? 'attendo il GPS' : `${fmtDist(d)} a ${cardinal(b)} (${Math.round(b)}°)`}<br>posizione di ${Math.round((Date.now() - m.ts) / 60000)} min fa</div></div>
          <button class="btn ghost small" data-rm="${i}">${ico('trash', 16)}</button></div>`;
      }).join('') : '';
      el.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { mates.splice(Number(b.dataset.rm), 1); lsSet('fp.mates', mates); upd(); }));
    };
    draw();
    const o1 = bus.on('pos', upd), o2 = bus.on('heading', upd);
    pg.onClose = () => { o1 && o1(); o2 && o2(); };
  });
}

// ---------- Terreno: pendenza, esposizione, ore di sole ----------
export function openTerrain(center) {
  const sh = openSheet({ title: 'Terreno e sole', body: '<div class="empty">Leggo le quote…</div>' });
  (async () => {
    const p = center || lastPos();
    if (!p) return (sh.body.innerHTML = '<div class="empty">Serve il GPS (o un punto sulla mappa).</div>');
    try {
      const step = 90, kLat = step / 110540, kLon = step / (111320 * Math.cos((p.lat * Math.PI) / 180));
      const la = [], lo = [];
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { la.push((p.lat + j * kLat).toFixed(5)); lo.push((p.lon + i * kLon).toFixed(5)); }
      const r = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${la.join(',')}&longitude=${lo.join(',')}`);
      const z = (await r.json()).elevation;
      // z indicizzato [riga j][colonna i], j=0 sud, j=2 nord
      const dzdx = ((z[2] + 2 * z[5] + z[8]) - (z[0] + 2 * z[3] + z[6])) / (8 * step);
      const dzdy = ((z[6] + 2 * z[7] + z[8]) - (z[0] + 2 * z[1] + z[2])) / (8 * step);
      const slope = Math.atan(Math.hypot(dzdx, dzdy));
      const aspect = slope < 0.02 ? null : ((Math.atan2(-dzdx, -dzdy) * 180) / Math.PI + 360) % 360;
      // ore di sole dirette stimate oggi (senza ombre di rilievi o chioma)
      let mins = 0, flat = 0;
      const day = new Date(); day.setHours(0, 0, 0, 0);
      for (let t = 0; t < 1440; t += 10) {
        const s = sunPos(new Date(day.getTime() + t * 60000), p.lat, p.lon);
        if (s.alt <= 0) continue;
        flat += 10;
        const cosI = Math.sin(s.alt) * Math.cos(slope) + Math.cos(s.alt) * Math.sin(slope) * Math.cos(s.az - ((aspect ?? 0) * Math.PI) / 180);
        if (cosI > 0) mins += 10;
      }
      const sd = slope * 180 / Math.PI, pct = Math.tan(slope) * 100;
      const verdict = aspect == null ? 'Terreno pianeggiante' : aspect > 315 || aspect <= 45 ? 'Versante Nord: ombroso e umido (buono con la siccità)' : aspect <= 135 ? 'Versante Est: sole al mattino, umidità media' : aspect <= 225 ? 'Versante Sud: caldo e asciutto (buono a fine stagione)' : 'Versante Ovest: sole al pomeriggio';
      sh.body.innerHTML = `<div class="stack"><div class="stats"><div><span>Quota</span>${Math.round(z[4])} m</div><div><span>Pendenza</span>${Math.round(pct)}% (${Math.round(sd)}°)</div><div><span>Esposizione</span>${aspect == null ? 'piano' : cardinal(aspect) + ' (' + Math.round(aspect) + '°)'}</div><div><span>Sole diretto oggi</span>${(mins / 60).toFixed(1)} h su ${(flat / 60).toFixed(1)}</div></div>
        <div class="infobox">${verdict}</div><p class="muted" style="font-size:.78rem;margin:0">Stima da dati altimetrici (risoluzione circa 90 m, Open-Meteo). Non considera ombre dei rilievi o della chioma degli alberi.</p></div>`;
    } catch {
      sh.body.innerHTML = '<div class="empty">Servono internet e il GPS per leggere le quote.</div>';
    }
  })();
}

// ---------- Righello su fotocamera ----------
export function openRuler(onPhoto) {
  const COIN = 25.75; // moneta da 2 euro, mm
  const lay = document.createElement('div');
  lay.className = 'tool-layer';
  lay.style.cssText = 'background:#000;flex-direction:column;justify-content:flex-start';
  lay.innerHTML = `<video playsinline autoplay muted style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"></video><canvas style="position:absolute;inset:0;width:100%;height:100%"></canvas>
    <div style="position:absolute;left:0;right:0;bottom:0;padding:12px 16px calc(14px + var(--sab));background:rgba(0,0,0,.6);color:#fff;font-size:.82rem;font-weight:400;text-align:left">
      Calibra: appoggia una moneta da 2 € accanto all'oggetto e regola il cerchio finché la copre. <input id="rl-s" type="range" min="40" max="260" value="110" style="width:100%">
      <div class="row gap" style="margin-top:8px"><button class="btn primary grow" id="rl-snap">${ico('camera', 18)} Scatta con righello</button></div></div>
    <button class="tool-x" aria-label="Chiudi">${ico('close', 26)}</button>`;
  document.body.appendChild(lay);
  const video = lay.querySelector('video'), cv = lay.querySelector('canvas'), sl = lay.querySelector('#rl-s');
  let stream, raf;
  const close = () => { cancelAnimationFrame(raf); stream && stream.getTracks().forEach((t) => t.stop()); lay.remove(); };
  lay.querySelector('.tool-x').onclick = close;
  const paint = (c, w, h, dia) => {
    const x = c.getContext('2d');
    const pxmm = dia / COIN;
    x.clearRect(0, 0, w, h);
    x.strokeStyle = '#ffe14d'; x.fillStyle = '#ffe14d'; x.lineWidth = 2; x.font = '12px sans-serif';
    x.beginPath(); x.arc(w / 2, h * 0.3, dia / 2, 0, 7); x.stroke();
    for (let mm = 0; mm * pxmm < h * 0.8; mm++) {
      const len = mm % 10 === 0 ? 26 : mm % 5 === 0 ? 18 : 10;
      x.beginPath(); x.moveTo(0, 60 + mm * pxmm); x.lineTo(len, 60 + mm * pxmm); x.stroke();
      if (mm % 10 === 0) x.fillText(mm / 10 + ' cm', 30, 64 + mm * pxmm);
    }
    for (let mm = 0; mm * pxmm < w; mm++) {
      const len = mm % 10 === 0 ? 26 : mm % 5 === 0 ? 18 : 10;
      x.beginPath(); x.moveTo(mm * pxmm, h - 200); x.lineTo(mm * pxmm, h - 200 - len); x.stroke();
    }
  };
  const loop = () => {
    const r = cv.getBoundingClientRect();
    cv.width = r.width; cv.height = r.height;
    paint(cv, r.width, r.height, Number(sl.value));
    raf = requestAnimationFrame(loop);
  };
  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 } }, audio: false }).then((s) => {
    stream = s; video.srcObject = s; loop();
  }).catch(() => { toast('Fotocamera non disponibile'); close(); });
  lay.querySelector('#rl-snap').onclick = () => {
    const r = cv.getBoundingClientRect(), vw = video.videoWidth, vh = video.videoHeight;
    if (!vw) return;
    const out = document.createElement('canvas');
    out.width = r.width * 2; out.height = r.height * 2;
    const x = out.getContext('2d'), sc = Math.max(out.width / vw, out.height / vh);
    x.drawImage(video, (out.width - vw * sc) / 2, (out.height - vh * sc) / 2, vw * sc, vh * sc);
    const ov = document.createElement('canvas');
    ov.width = r.width; ov.height = r.height;
    paint(ov, r.width, r.height, Number(sl.value));
    x.drawImage(ov, 0, 0, out.width, out.height);
    const data = out.toDataURL('image/jpeg', 0.85).split(',')[1];
    close();
    onPhoto({ mime: 'image/jpeg', data });
  };
}
