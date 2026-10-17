// Radar compagni, terreno e sole, righello fotocamera
import { openPage, openSheet, toast } from '../lib/ui.js';
import { esc, bus, haversine, bearing, cardinal, fmtDist } from '../lib/util.js';
import { lastPos } from '../lib/geo.js';
import { getHeading } from '../lib/compass.js';
import { lsGet, lsSet } from '../lib/store.js';
import { ico } from '../lib/icons.js';

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
