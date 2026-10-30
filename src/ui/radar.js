// Radar compagni: elenco gruppi a card, interruttore per gruppo, creazione/unione da bottom sheet
import { openPage, openSheet, toast, leavePages } from '../lib/ui.js';
import { esc, bus, haversine, bearing, cardinal, fmtDist } from '../lib/util.js';
import { lastPos } from '../lib/geo.js';
import { getHeading } from '../lib/compass.js';
import { lsGet, lsSet } from '../lib/store.js';
import { ico } from '../lib/icons.js';
import { getGroups, createGroup, joinGroup, updateGroup, removeGroup, syncService, search, sendPing, isMateHidden, toggleMateHidden, initMates, syncFromNative } from '../lib/mates.js';

const FRESH = 15 * 60000;
const parseCoords = (t) => {
  const m = String(t).match(/(-?\d{1,2}\.\d{3,})\s*[,;\s]\s*(-?\d{1,3}\.\d{3,})/);
  if (!m) return null;
  const lat = Number(m[1]), lon = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
};

export function openRadar() {
  openPage('Radar compagni', (pg) => {
    let searching = false, cd = 0, cdT = null;
    const css = document.createElement('style');
    css.textContent = `.rc{background:var(--card,#fffdf7);border:1px solid #e7e0cd;border-radius:18px;padding:14px;margin:0 0 12px;box-shadow:0 1px 3px rgba(0,0,0,.05)}
      .rc.off{opacity:.78}
      .rc-top{display:flex;align-items:center;gap:12px}.rc-name{flex:1;font-weight:700;font-size:1.08rem;color:#12372a;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .rc-code{display:flex;align-items:center;gap:6px;margin-top:8px}
      .rc-chip{font-family:monospace;letter-spacing:.12em;background:#eef3ec;color:#12372a;border-radius:8px;padding:4px 9px;font-weight:700;font-size:.9rem}
      .rc-ib{background:none;border:0;padding:6px;border-radius:10px;color:#4b5f55;display:inline-flex}.rc-ib:active{background:#eee6d2}
      .rc-st{margin-top:10px;font-size:.9rem;display:flex;align-items:center;gap:8px;color:#4b5f55}
      .rc-dot{width:10px;height:10px;border-radius:50%;background:#b8b19a;flex:none}.rc.on .rc-dot{background:#2e9b5c;box-shadow:0 0 0 4px rgba(46,155,92,.18)}.rc.sr .rc-dot{background:#e6a23c;animation:rcp 1s infinite}
      @keyframes rcp{50%{opacity:.35}}
      .rc-m{display:flex;align-items:center;gap:12px;padding:10px 0;border-top:1px solid #f0ead8;margin-top:10px}
      .rc-ar{width:46px;height:46px;border-radius:50%;border:2px solid var(--moss);display:flex;align-items:center;justify-content:center;flex:none}
      .rc-fab{position:sticky;bottom:14px;margin:6px 0 14px;width:100%;box-shadow:0 6px 18px rgba(18,55,42,.35)}
      .rc-empty{text-align:center;padding:34px 24px;color:#4b5f55}`;
    pg.body.appendChild(css);
    const wrap = document.createElement('div');
    wrap.style.padding = '10px 14px 0';
    pg.body.appendChild(wrap);

    const render = () => {
      const gs = getGroups(), mates = lsGet('fp.mates', []), me = lastPos(), h = getHeading() || 0;
      const row = (m, idx) => {
        const d = me ? haversine(me, m) : null, b = me ? bearing(me, m) : null, min = Math.round((Date.now() - m.ts) / 60000);
        return `<div class="rc-m" ${m.lat != null ? `data-mk="${esc(m.gkey || 'all')}"` : ''} style="cursor:pointer"><div class="rc-ar"><svg viewBox="0 0 24 24" width="30" height="30" style="transform:rotate(${b == null ? 0 : b - h}deg);color:var(--moss)" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21V4M5 11l7-7 7 7"/></svg></div>
          <div style="flex:1;min-width:0"><b>${esc(m.name)}</b>${m.ping && Date.now() - m.ping < 3600e3 ? ' <span style="background:#c0392b;color:#fff;border-radius:6px;padding:1px 6px;font-size:.75rem">CHIAMA</span>' : ''}<div class="muted" style="font-size:.85rem">${d == null ? 'attendo il GPS' : `${fmtDist(d)} a ${cardinal(b)}`} · ${min < 1 ? 'ora' : min + ' min fa'}${m.bat != null ? ` · <span style="color:${m.bat <= 20 ? '#c0392b' : 'inherit'}">🔋 ${m.bat}%</span>` : ''}${m.acc ? ` · ±${m.acc} m` : ''}</div></div>
          ${m.gkey ? `<button class="rc-ib" data-eye="${idx}" aria-label="Mostra o nascondi sulla mappa" style="opacity:${isMateHidden(m) ? .4 : 1}"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>${isMateHidden(m) ? '<path d="M3 3l18 18"/>' : ''}</svg></button>` : `<button class="rc-ib" data-rm="${idx}" aria-label="Rimuovi">${ico('trash', 18)}</button>`}</div>`;
      };
      const cards = gs.map((g) => {
        const ms = mates.map((m, i) => ({ m, i })).filter((x) => x.m.gkey === g.key).sort((a, b) => b.m.ts - a.m.ts);
        const near = ms.filter((x) => Date.now() - x.m.ts < FRESH).length;
        const sr = g.on && searching;
        const st = !g.on ? 'Spento, non visibile' : sr ? `Ricerca in corso... ${cd}s` : near ? `Visibile · ${near} ${near === 1 ? 'compagno' : 'compagni'} nel raggio` : 'Visibile · nessun compagno rilevato';
        return `<div class="rc ${g.on ? 'on' : 'off'} ${sr ? 'sr' : ''}" data-k="${esc(g.key)}">
          <div class="rc-top"><div class="rc-name">${esc(g.label || 'Gruppo senza nome')}</div>
            <label class="switch" aria-label="Visibile nel gruppo"><input type="checkbox" data-sw ${g.on ? 'checked' : ''}><i></i></label></div>
          <div class="rc-code"><span class="rc-chip">${esc(g.key)}</span>
            <button class="rc-ib" data-a="copy" aria-label="Copia o condividi codice">${ico('share', 18)}</button>
            <span style="flex:1"></span>
            <button class="rc-ib" data-a="menu" aria-label="Impostazioni gruppo">${ico('sliders', 20)}</button></div>
          <div class="rc-st"><span class="rc-dot"></span><span>${st}</span></div>
          ${g.on ? `<button class="btn small" data-a="find" style="margin-top:10px" ${searching ? 'disabled' : ''}>${ico('search', 16)} ${searching ? 'Cerco...' : 'Cerca compagni'}</button> <button class="btn small" data-a="ping" style="margin-top:10px;background:#c0392b;color:#fff">Vienimi a prendere</button>` : ''}
          ${g.on && ms.length ? `<button class="btn small" data-a="onmap" style="margin-top:8px;background:#e3eee5;color:#12372a;width:100%">${ico('map', 16)} Mostra i compagni sulla mappa</button>` : ''}
          ${ms.map((x) => row(x.m, x.i)).join('')}</div>`;
      }).join('');
      const manual = mates.map((m, i) => ({ m, i })).filter((x) => !x.m.gkey);
      wrap.innerHTML = `${gs.length ? cards : `<div class="rc-empty"><div style="font-size:2.4rem">${ico('locate', 44)}</div><b style="display:block;margin:8px 0 4px;color:#12372a">Nessun gruppo</b>Trova i tuoi compagni senza internet: crea un gruppo o entra con un codice.</div>`}
        ${manual.length ? `<div class="rc"><div class="rc-name">Posizioni inserite a mano</div>${manual.map((x) => row(x.m, x.i)).join('')}</div>` : ''}
        <div style="text-align:center;margin:4px 0 8px"><button class="chip" data-a="manual">Aggiungi posizione a mano (WhatsApp o Maps)</button></div>
        <button class="btn primary big rc-fab" data-a="new">${ico('pinplus', 20)} Crea un nuovo gruppo o unisciti</button>`;
      wire();
    };

    const wire = () => {
      wrap.querySelector('[data-a=new]').onclick = openNew;
      wrap.querySelector('[data-a=manual]').onclick = openManual;
      wrap.querySelectorAll('[data-mk]').forEach((r) => (r.onclick = (e) => { if (e.target.closest('[data-rm],[data-eye]')) return; leavePages(); bus.emit('nav:tab', 'map'); setTimeout(() => bus.emit('mates:show', r.dataset.mk), 150); }));
      wrap.querySelectorAll('[data-eye]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); const m = lsGet('fp.mates', [])[Number(b.dataset.eye)]; if (m) toggleMateHidden(m); }));
      wrap.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { const l = lsGet('fp.mates', []); l.splice(Number(b.dataset.rm), 1); lsSet('fp.mates', l); render(); }));
      wrap.querySelectorAll('.rc[data-k]').forEach((c) => {
        const key = c.dataset.k, g = getGroups().find((x) => x.key === key);
        c.querySelector('[data-sw]').onchange = async (e) => {
          updateGroup(key, { on: e.target.checked });
          render();
          const ok = await syncService(true);
          if (!ok && e.target.checked) toast('Servono i permessi Bluetooth e dispositivi vicini');
        };
        c.querySelector('[data-a=copy]').onclick = () => { try { navigator.share ? navigator.share({ text: `Entra nel gruppo Footprint "${g.label || ''}" con il codice ${key}` }) : (navigator.clipboard.writeText(key), toast('Codice copiato')); } catch { toast(key); } };
        c.querySelector('[data-a=menu]').onclick = () => openMenu(key);
        const f = c.querySelector('[data-a=find]');
        if (f) f.onclick = startSearch;
        const om = c.querySelector('[data-a=onmap]');
        if (om) om.onclick = () => { leavePages(); bus.emit('nav:tab', 'map'); setTimeout(() => bus.emit('mates:show', key), 150); };
        const pb = c.querySelector('[data-a=ping]');
        if (pb) pb.onclick = async () => {
          const r = await sendPing(key, 'Vienimi a prendere qui');
          toast(r === 'ok' ? 'Chiamata inviata ai compagni vicini (2 min)' : r === 'perms' ? 'Servono i permessi Bluetooth' : r === 'web' ? 'Solo nell\'app' : 'Servizio non attivo');
        };
      });
    };

    const startSearch = async () => {
      const r = await search(90);
      if (r === 'ok') {
        searching = true; cd = 90; clearInterval(cdT);
        cdT = setInterval(() => { cd--; if (cd <= 0) { searching = false; clearInterval(cdT); } render(); }, 1000);
        render(); toast('Ricerca avviata, resta in zona aperta');
      } else if (r === 'perms') toast('Servono i permessi Bluetooth e dispositivi vicini');
      else if (r === 'web') toast('Disponibile solo nell\'app');
      else if (r === 'nogroup') toast('Accendi prima un gruppo');
      else toast('Servizio non attivo, riprova tra poco');
    };

    const openNew = () => {
      const s = openSheet({ title: 'Nuovo gruppo', body: `<div style="display:flex;gap:8px;margin-bottom:12px"><button class="chip active" data-t="c" style="flex:1">Crea</button><button class="chip" data-t="j" style="flex:1">Unisciti</button></div>
        <label class="field" id="n-l"><span>Nome del gruppo</span><input id="n-label" type="text" maxlength="30" placeholder="es. Funghi con Marco" onfocus="this.select()"></label>
        <label class="field" id="n-c" style="display:none"><span>Codice del gruppo</span><input id="n-code" type="text" maxlength="12" autocapitalize="characters" placeholder="Incolla il codice ricevuto" onfocus="this.select()"></label>
        <label class="field"><span>Il tuo nome</span><input id="n-me" type="text" maxlength="20" value="${esc(getGroups()[0]?.name || '')}" onfocus="this.select()"></label>
        <button class="btn primary big" id="n-go" style="margin-top:6px">${ico('check', 18)} Crea gruppo</button>` });
      let mode = 'c';
      const q = (x) => s.body.querySelector(x);
      s.body.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => {
        mode = b.dataset.t;
        s.body.querySelectorAll('[data-t]').forEach((x) => x.classList.toggle('active', x === b));
        q('#n-l').style.display = mode === 'j' ? 'none' : ''; q('#n-c').style.display = mode === 'c' ? 'none' : '';
        q('#n-go').innerHTML = `${ico('check', 18)} ${mode === 'c' ? 'Crea gruppo' : 'Entra nel gruppo'}`;
      }));
      const go = async () => {
        const me = q('#n-me').value.trim() || 'Io';
        if (mode === 'c') createGroup(me, q('#n-label').value.trim());
        else {
          const r = joinGroup(q('#n-code').value, me, '');
          if (r === 'dup') return toast('Sei già in questo gruppo');
          if (!r) return toast('Codice non valido');
        }
        s.close(); render();
        await syncService(true);
      };
      q('#n-go').onclick = go;
      s.body.querySelectorAll('input').forEach((i) => (i.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } }));
    };

    const openMenu = (key) => {
      const g = getGroups().find((x) => x.key === key);
      if (!g) return;
      const s = openSheet({ title: 'Impostazioni gruppo', body: `<div class="muted" style="margin-bottom:10px">Codice <b>${esc(key)}</b></div>
        <label class="field"><span>Nome del gruppo</span><input id="m-l" type="text" maxlength="30" value="${esc(g.label || '')}" onfocus="this.select()"></label>
        <label class="field"><span>Il tuo nome in questo gruppo</span><input id="m-n" type="text" maxlength="20" value="${esc(g.name || '')}" onfocus="this.select()"></label>
        <button class="btn primary big" id="m-save">${ico('check', 18)} Salva</button>
        <button class="btn big" id="m-out" style="margin-top:10px;background:#f6e4e0;color:#b3261e">${ico('trash', 18)} Esci dal gruppo</button>` });
      const q = (x) => s.body.querySelector(x);
      const save = async () => { updateGroup(key, { label: q('#m-l').value.trim(), name: q('#m-n').value.trim() || 'Io' }); s.close(); render(); syncService(false); toast('Salvato'); };
      q('#m-save').onclick = save;
      s.body.querySelectorAll('input').forEach((i) => (i.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } }));
      const out = q('#m-out');
      out.onclick = async () => {
        if (!out.dataset.sure) { out.dataset.sure = '1'; out.lastChild.textContent = ' Tocca di nuovo per confermare'; return; }
        removeGroup(key); s.close(); render(); syncService(false);
      };
    };

    const openManual = () => {
      const s = openSheet({ title: 'Posizione a mano', body: `<p class="muted" style="margin-top:0;font-size:.88rem">Incolla il messaggio con la posizione del compagno (WhatsApp o Maps): il radar indica direzione e distanza.</p>
        <label class="field"><span>Nome</span><input id="r-n" type="text" maxlength="30" onfocus="this.select()"></label>
        <label class="field"><span>Posizione (link o coordinate)</span><textarea id="r-t" rows="2" onfocus="this.select()"></textarea></label>
        <button class="btn primary big" id="r-add">${ico('check', 18)} Aggiungi / aggiorna</button>` });
      s.body.querySelector('#r-add').onclick = () => {
        const c = parseCoords(s.body.querySelector('#r-t').value);
        if (!c) return toast('Non trovo le coordinate nel testo');
        const name = s.body.querySelector('#r-n').value.trim() || 'Compagno';
        lsSet('fp.mates', lsGet('fp.mates', []).filter((m) => m.gkey || m.name !== name).concat({ name, ...c, ts: Date.now() }));
        s.close(); render();
      };
    };

    render();
    initMates();
    syncFromNative();
    let lt = 0;
    const tick = () => { const n = Date.now(); if (n - lt > 2500) { lt = n; render(); } };
    const o1 = bus.on('pos', tick), o2 = bus.on('heading', tick);
    const o3 = bus.on('mates:changed', (e) => { render(); if (e && e.fresh) toast('Compagno trovato'); });
    const o4 = bus.on('mates:search', (v) => { if (!v) { searching = false; clearInterval(cdT); render(); } });
    pg.onClose = () => { o1 && o1(); o2 && o2(); o3 && o3(); o4 && o4(); clearInterval(cdT); };
  });
}
