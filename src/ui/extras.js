// Radar compagni, terreno e sole, righello fotocamera
import { openPage, openSheet, toast } from '../lib/ui.js';
import { esc, bus, haversine, bearing, cardinal, fmtDist } from '../lib/util.js';
import { lastPos } from '../lib/geo.js';
import { getHeading } from '../lib/compass.js';
import { lsGet, lsSet } from '../lib/store.js';
import { ico } from '../lib/icons.js';
import { getGroups, createGroup, joinGroup, updateGroup, removeGroup, syncService, search, initMates, syncFromNative } from '../lib/mates.js';

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
      pg.body.innerHTML = `<div id="rd-grp" style="padding:14px 14px 0"></div><div style="padding:14px"><p class="muted" style="margin-top:0;font-size:.88rem">Il compagno condivide la sua posizione da WhatsApp o Maps: copia il messaggio, incollalo qui e il radar ti indica direzione e distanza. Riincolla per aggiornarla.</p>
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
      drawGroup();
      upd();
    };
    let searching = false, cd = 0, cdT = null;
    const drawGroup = () => {
      const el = pg.body.querySelector('#rd-grp');
      if (!el) return;
      const gs = getGroups();
      const anyOn = gs.some((g) => g.on);
      const cards = gs.map((g) => `<div class="card" data-k="${esc(g.key)}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><div class="muted" style="font-size:.82rem">Codice <b>${esc(g.key)}</b></div><button class="btn ghost small" data-a="share">${ico('share', 16)}</button></div>
        <label class="field" style="margin:6px 0 0"><span>Nome del gruppo</span><input data-f="label" type="text" maxlength="30" value="${esc(g.label || '')}" placeholder="es. Funghi con Marco" onfocus="this.select()"></label>
        <label class="field" style="margin:6px 0 0"><span>Il tuo nome in questo gruppo</span><input data-f="name" type="text" maxlength="20" value="${esc(g.name || '')}" onfocus="this.select()"></label>
        <button class="btn ${g.on ? 'primary' : ''} big" data-a="tog" style="margin-top:8px">${ico(g.on ? 'check' : 'close', 18)} ${g.on ? 'Visibile (tocca per spegnere)' : 'Spento, non visibile (tocca per accendere)'}</button>
        <button class="btn ghost small" data-a="leave" style="margin-top:6px">Esci dal gruppo</button></div>`).join('');
      el.innerHTML = `${gs.length ? `<button class="btn primary big" id="g-find" ${searching ? 'disabled' : ''} ${anyOn ? '' : 'disabled'}>${ico('search', 18)} ${searching ? `Cerco compagni... ${cd}s` : anyOn ? 'Cerca compagni (gruppi accesi)' : 'Accendi un gruppo per cercare'}</button>
        <div class="muted" style="font-size:.8rem;margin:6px 0 10px">Ricerca di 90 secondi, funziona se anche il compagno è visibile nello stesso gruppo. Con tutti i gruppi spenti non consumi batteria.</div>` : ''}
        ${cards}
        <div class="card"><b>${gs.length ? 'Aggiungi un altro gruppo' : 'Radar offline (Bluetooth e Wi-Fi)'}</b><p class="muted" style="margin:6px 0 10px;font-size:.88rem">Crea un gruppo e dai il codice ai compagni, oppure entra con il loro codice. Raggio circa 50-100 m.</p>
          <label class="field"><span>Il tuo nome</span><input id="g-n" type="text" maxlength="20" value="${esc(gs[0]?.name || '')}" onfocus="this.select()"></label>
          <label class="field"><span>Nome del gruppo (facoltativo)</span><input id="g-l" type="text" maxlength="30" onfocus="this.select()"></label>
          <button class="btn primary big" id="g-new">${ico('pinplus', 18)} Crea gruppo</button>
          <label class="field" style="margin-top:12px"><span>Oppure entra con un codice</span><input id="g-c" type="text" maxlength="12" autocapitalize="characters" onfocus="this.select()"></label>
          <button class="btn big" id="g-join">${ico('check', 18)} Entra nel gruppo</button></div>`;
      const nm = () => el.querySelector('#g-n').value.trim() || 'Io';
      const lb = () => el.querySelector('#g-l').value.trim();
      el.querySelector('#g-new').onclick = async () => { createGroup(nm(), lb()); await syncService(true); drawGroup(); };
      el.querySelector('#g-join').onclick = async () => {
        const r = joinGroup(el.querySelector('#g-c').value, nm(), lb());
        if (r === 'dup') return toast('Sei già in questo gruppo');
        if (!r) return toast('Codice non valido');
        await syncService(true); drawGroup();
      };
      const kd = (e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target.id === 'g-c' ? el.querySelector('#g-join') : el.querySelector('#g-new')).click(); } };
      ['#g-n', '#g-c', '#g-l'].forEach((q) => (el.querySelector(q).onkeydown = kd));
      el.querySelectorAll('.card[data-k]').forEach((c) => {
        const key = c.dataset.k, g = gs.find((x) => x.key === key);
        c.querySelectorAll('[data-f]').forEach((i) => {
          const sv = () => { updateGroup(key, { [i.dataset.f]: i.value.trim() }); if (i.dataset.f === 'name') syncService(false); };
          i.onblur = sv;
          i.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); sv(); i.blur(); toast('Salvato'); } };
        });
        c.querySelector('[data-a=share]').onclick = () => { try { navigator.share ? navigator.share({ text: `Entra nel mio gruppo Footprint con il codice ${key}` }) : (navigator.clipboard.writeText(key), toast('Codice copiato')); } catch { toast(key); } };
        c.querySelector('[data-a=tog]').onclick = async () => { updateGroup(key, { on: !g.on }); await syncService(true); drawGroup(); };
        const lv = c.querySelector('[data-a=leave]');
        lv.onclick = async () => {
          if (!lv.dataset.sure) { lv.dataset.sure = '1'; lv.textContent = 'Tocca di nuovo per uscire'; setTimeout(() => { delete lv.dataset.sure; lv.textContent = 'Esci dal gruppo'; }, 3000); return; }
          removeGroup(key); await syncService(false); mates = lsGet('fp.mates', []); drawGroup(); upd();
        };
      });
      const fb = el.querySelector('#g-find');
      if (fb) fb.onclick = async () => {
        const r = await search(90);
        if (r === 'ok') { searching = true; cd = 90; clearInterval(cdT); cdT = setInterval(() => { cd--; if (cd <= 0) { searching = false; clearInterval(cdT); } drawGroup(); }, 1000); drawGroup(); toast('Ricerca avviata, resta in zona aperta'); }
        else if (r === 'perms') toast('Servono i permessi Bluetooth e dispositivi vicini');
        else if (r === 'web') toast('Disponibile solo nell\'app');
        else if (r === 'nogroup') toast('Accendi prima un gruppo');
        else toast('Servizio non attivo, riprova tra poco');
      };
    };
    const upd = () => {
      const el = pg.body.querySelector('#rd-list');
      if (!el) return;
      const me = lastPos(), h = getHeading() || 0;
      el.innerHTML = mates.length ? mates.map((m, i) => {
        const d = me ? haversine(me, m) : null, b = me ? bearing(me, m) : null;
        return `<div class="card" style="display:flex;align-items:center;gap:14px"><div style="width:64px;height:64px;border-radius:50%;border:2px solid var(--moss);display:flex;align-items:center;justify-content:center"><div style="transform:rotate(${b == null ? 0 : b - h}deg);font-size:1.8rem;line-height:1;color:var(--moss)">▲</div></div>
          <div class="grow"><b>${esc(m.name)}</b>${m.gkey ? ` <span class="muted" style="font-size:.78rem">${esc((getGroups().find((g) => g.key === m.gkey) || {}).label || '')}</span>` : ''}<div class="muted" style="font-size:.88rem">${d == null ? 'attendo il GPS' : `${fmtDist(d)} a ${cardinal(b)} (${Math.round(b)}°)`}<br>posizione di ${Math.round((Date.now() - m.ts) / 60000)} min fa</div></div>
          <button class="btn ghost small" data-rm="${i}">${ico('trash', 16)}</button></div>`;
      }).join('') : '';
      el.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { mates.splice(Number(b.dataset.rm), 1); lsSet('fp.mates', mates); upd(); }));
    };
    draw();
    initMates();
    syncFromNative();
    const o1 = bus.on('pos', upd), o2 = bus.on('heading', upd);
    const o3 = bus.on('mates:changed', (e) => { mates = lsGet('fp.mates', []); upd(); if (e && e.fresh) toast('Compagno trovato'); });
    const o4 = bus.on('mates:search', (v) => { if (!v) { searching = false; clearInterval(cdT); drawGroup(); } });
    pg.onClose = () => { o1 && o1(); o2 && o2(); o3 && o3(); o4 && o4(); clearInterval(cdT); };
  });
}
