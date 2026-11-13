// Pagina "Smartwatch": stato dell'orologio, icone del menu a ruota, mappe offline e preferenze hardware
import { openPage, openSheet, toast, closeTopSheet, confirmBox, leavePages } from '../lib/ui.js';
import { getSettings, setSetting } from '../lib/store.js';
import { WP_ICONS, WP_BY_ID } from '../lib/icons.js';
import { esc, bus } from '../lib/util.js';
import { listAreas, fmtMB } from '../lib/offline.js';
import { watchCfg, sendCmd, sendTracks, sendToWatch, queueSend, watchInfo, WATCH_DEFAULT_ICONS, WATCH_MAX_ICONS } from '../lib/watchsync.js';
import { estimateWatchBytes, estimateMinutes, pickSource, sendAreaToWatch } from '../lib/watchmaps.js';

let TAB = 0; // scheda aperta: 0 icone, 1 mappe, 2 hardware
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
const fmtSize = (b) => (b >= 1073741824 ? (b / 1073741824).toFixed(1) + ' GB' : fmtMB(b));
const FULL = 'style="width:100%;box-sizing:border-box"';
const sel = (k, v, opts) => `<select data-k="${k}" ${FULL} onfocus="this.select&&this.select()">${opts.map(([val, lab]) => `<option value="${val}" ${String(val) === String(v) ? 'selected' : ''}>${lab}</option>`).join('')}</select>`;
// riga di form: titolo e descrizione in alto a tutta larghezza, controllo sotto a tutta larghezza
const row = (t, d, ctl) => `<div class="set-row col"><div class="ti"><b>${t}</b>${d ? `<small>${d}</small>` : ''}</div>${ctl}</div>`;
// mappe: strato e dettaglio fissi, niente scelte
const MAP_SRC = 'sat', MAP_Z = 16;
const SRC_NAME = { sat: 'Satellite', topo: 'Topografica' };

// Coda di invio mappe: resta attiva anche se chiudi la pagina
let sending = null; // {id, phase, done, total}
const pendingAck = {}; // id area -> istante dell'invio, in attesa che l'orologio confermi
let queue = [];
const selected = new Set(); // mappe scelte nell'elenco
let running = false;
let repaint = null; // ridisegna la pagina se aperta
let lastStatus = null;

const watchMapBytes = (a) => {
  const sr = pickSource(a, MAP_SRC);
  return sr ? estimateWatchBytes(a, sr, MAP_Z) : 0;
};

async function runQueue() {
  if (running) return;
  running = true;
  while (queue.length) {
    const a = queue.shift();
    const src = pickSource(a, MAP_SRC);
    if (!src) continue;
    const est = estimateWatchBytes(a, src, MAP_Z);
    if (lastStatus && lastStatus.free && est > lastStatus.free * 0.9) {
      toast(`${a.name}: spazio insufficiente sull'orologio`);
      continue;
    }
    sending = { id: a.id, phase: 'prep', done: 0, total: 1 };
    repaint && repaint();
    try {
      await sendAreaToWatch(a, {
        src,
        maxZ: MAP_Z,
        onPhase: (ph, d, t) => {
          sending = { id: a.id, phase: ph, done: d, total: t };
          const el = document.querySelector(`[data-prog="${a.id}"]`);
          if (el) el.textContent = ph === 'prep' ? `Preparo ${Math.round((d / (t || 1)) * 100)}%` : 'Invio in corso...';
        },
      });
      pendingAck[a.id] = Date.now();
    } catch (e) {
      toast(`${a.name}: invio non riuscito (${(e && e.message) || e})`);
    }
    sending = null;
    repaint && repaint();
  }
  running = false;
  toast('Invio mappe completato: l\'orologio le sta installando');
  repaint && repaint();
}

const isQueued = (id) => queue.some((q) => q.id === id) || (sending && sending.id === id);

export function openWatch() {
  openPage('Smartwatch', (pg) => {
    let info = { nodes: [], status: null, ok: false };
    let areas = [];
    let alive = true;

    pg.body.innerHTML = '<div id="w-banner"></div><div id="w-tabs"></div><div id="w-pane" style="padding-bottom:34px"></div>';
    const $ = (q) => pg.body.querySelector(q);

    // ---------- banner di stato ----------
    const paintBanner = () => {
      const n = info.nodes[0], st = info.status;
      let dot = '#c0392b', txt = 'Nessun orologio collegato';
      if (!info.ok) { dot = '#9a9a9a'; txt = 'Controllo orologio...'; }
      else if (n) {
        dot = '#2e9d5a';
        const name = (st && st.model) || n.name || 'Orologio';
        const link = n.nearby ? 'Connesso Bluetooth' : 'Connesso (rete)';
        const bat = st && typeof st.bat === 'number' ? `Batteria: ${st.bat}%${st.chg ? ' (in carica)' : ''}` : 'Batteria: n/d';
        const old = st && st.ts && Date.now() - st.ts > 20 * 60000 ? ` <span style="opacity:.65">(dato delle ${new Date(st.ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })})</span>` : '';
        txt = `<b>${esc(name)}</b> - ${link} | ${bat}${old}`;
      }
      $('#w-banner').innerHTML = `<div style="display:flex;align-items:center;gap:8px;padding:7px 14px;font-size:.8rem;background:#e7efe9;color:#12372a;border-bottom:1px solid #d3e0d6"><i style="flex:none;width:9px;height:9px;border-radius:50%;background:${dot}"></i><span>${txt}</span></div>`;
    };

    // ---------- schede ----------
    const paintTabs = () => {
      const tabs = ['Icone rapide', 'Mappe offline', 'Preferenze hardware'];
      $('#w-tabs').innerHTML = `<div style="display:flex;gap:6px;padding:12px 12px 4px">${tabs
        .map((t, i) => `<button data-tab="${i}" style="flex:1;min-width:0;padding:10px 4px;border-radius:12px;border:1.5px solid #12372a;font-weight:600;font-size:.78rem;line-height:1.15;background:${i === TAB ? '#12372a' : 'transparent'};color:${i === TAB ? '#fff' : '#12372a'}">${t}</button>`)
        .join('')}</div>`;
    };

    // ---------- scheda 1: icone rapide ----------
    const paneIcons = () => {
      const c = watchCfg();
      const n = c.icons.length;
      const sq = 'flex:none;width:38px;height:38px;border-radius:12px;border:0;background:#ebe4d0;color:#12372a;font-size:1rem;display:inline-flex;align-items:center;justify-content:center;padding:0';
      return `<style>.wx-ic img,.wx-ic svg{width:100%;height:100%;display:block;object-fit:contain}</style>
        <div class="sec-h">VOCI DEL MENU A RUOTA (${n}/${WATCH_MAX_ICONS})</div>
        <div class="list">${c.icons
          .map((id, i) => {
            const ic = WP_BY_ID[id];
            return `<div class="set-row" style="gap:12px;padding:10px 12px"><span class="wx-ic" data-pick="${i}" style="flex:none;display:block;width:36px;height:36px;margin-right:2px">${ic ? ic.svg : ''}</span><div class="ti" style="min-width:0"><b data-pick="${i}">${i + 1}. ${esc(ic ? ic.label : id)}</b><button class="chip" data-pick="${i}" style="margin-top:5px;padding:4px 14px;font-size:.8rem">Cambia</button></div><div style="display:flex;gap:6px;flex:none"><button data-u="${i}" ${i ? '' : 'disabled style="opacity:.35;' + sq + '"'} ${i ? `style="${sq}"` : ''} aria-label="Su">▲</button><button data-d="${i}" ${i < n - 1 ? `style="${sq}"` : `disabled style="opacity:.35;${sq}"`} aria-label="Giù">▼</button><button data-x="${i}" ${n > 1 ? `style="${sq};color:#c0392b"` : `disabled style="opacity:.35;${sq}"`} aria-label="Elimina">✕</button></div></div>`;
          })
          .join('')}</div>
        <button class="btn primary big" id="w-add" style="margin-top:12px" ${n >= WATCH_MAX_ICONS ? 'disabled' : ''}>+ Aggiungi icona</button>
        <button class="btn ghost" id="w-reset" style="margin:10px 0 4px">Ripristina icone di partenza</button>
        <p class="muted" style="margin:10px 2px;font-size:.85rem;line-height:1.5">Il menu a ruota compare sul watch col tasto salva. L'ultima icona usata resta preselezionata. Le modifiche arrivano da sole sull'orologio.</p>`;
    };

    const openPicker = (title, onPick, taken = []) => {
      const sh = openSheet({
        title,
        body: `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">${WP_ICONS.map((i) => `<button class="chip" data-ic="${i.id}" ${taken.includes(i.id) ? 'disabled style="opacity:.35;display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 2px"' : 'style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 2px"'}><span style="width:38px;height:38px;display:inline-block">${i.svg}</span><small>${esc(i.label)}</small></button>`).join('')}</div>`,
      });
      sh.body.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-ic]');
        if (!b || b.disabled) return;
        closeTopSheet();
        onPick(b.dataset.ic);
      });
    };
    const saveIcons = (arr) => {
      setSetting('watchIcons', arr);
      paintPane();
      queueSend(true);
    };

    // ---------- scheda 2: mappe offline ----------
    const mapStatus = (a) => {
      const st = info.status;
      if (sending && sending.id === a.id) return ['In trasferimento...', '#b7791f', '#fdf0d5'];
      if (queue.some((q) => q.id === a.id)) return ['In coda', '#8a5a00', '#fdf0d5'];
      if (st && st.maps && st.maps[a.id] != null) return ['Inviata', '#1f7a45', '#dff3e6'];
      const t = pendingAck[a.id];
      if (t && Date.now() - t < 10 * 60000) return ['In trasferimento...', '#b7791f', '#fdf0d5'];
      if (t) return ['Non confermata', '#c0392b', '#fbe3df'];
      return ['Non inviata', '#6b7280', '#eceae0'];
    };
    const paneMaps = () => {
      const st = info.status;
      let storage;
      if (st && st.total) {
        const used = st.tiles || 0;
        const pct = Math.max(used > 0 ? 1.5 : 0, Math.min(100, (used / st.total) * 100));
        storage = `<div style="margin:12px 0 4px;padding:12px 14px;border-radius:14px;background:#fffdf6;border:1px solid #e6e0cd"><div style="display:flex;justify-content:space-between;gap:10px;font-size:.9rem"><b>Spazio occupato sul Watch</b><span>${fmtSize(used)}</span></div><div style="height:10px;border-radius:5px;background:#e3e0d2;margin:8px 0 6px;overflow:hidden"><div style="height:100%;width:${pct}%;background:#2e7a4d"></div></div><small class="muted">Liberi ${fmtSize(st.free)} su ${fmtSize(st.total)}</small></div>`;
      } else {
        storage = `<div style="margin:12px 0 4px;padding:12px 14px;border-radius:14px;background:#fffdf6;border:1px solid #e6e0cd;font-size:.9rem"><b>Spazio occupato sul Watch</b><br><small class="muted">Dato non ancora disponibile: apri l'app Footprint sul watch.</small></div>`;
      }
      const toSend = areas.filter((a) => pickSource(a, MAP_SRC) && !(st && st.maps && st.maps[a.id] != null) && !isQueued(a.id) && !(pendingAck[a.id] && Date.now() - pendingAck[a.id] < 10 * 60000));
      const allBar = areas.length
        ? `<div style="display:flex;gap:8px;margin:10px 0 2px"><button class="btn primary" id="w-all" style="flex:1" ${toSend.length && info.nodes.length ? '' : 'disabled'}>Invia tutte${toSend.length ? ` (${toSend.length})` : ''}</button>${queue.length ? '<button class="btn" id="w-qclr">Svuota coda</button>' : ''}</div><small class="muted" style="display:block;margin:0 2px 4px">Le mappe già sul watch non vengono rimandate. L'invio va avanti in coda, anche se esci da questa pagina.</small>`
        : '';
      for (const id of [...selected]) if (!areas.find((a) => a.id === id)) selected.delete(id);
      const nSel = selected.size;
      const selBar = areas.length
        ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin:2px 0 8px;align-items:center"><button class="chip" id="w-selall">${nSel === areas.length ? 'Deseleziona tutte' : 'Seleziona tutte'}</button>${nSel ? `<b style="font-size:.9rem">${nSel} selezionate</b>` : '<small class="muted">Spunta le mappe per inviarle o eliminarle insieme</small>'}</div>${nSel ? `<div style="display:flex;gap:8px;margin:0 0 8px"><button class="btn primary" id="w-selsend" style="flex:1" ${info.nodes.length ? '' : 'disabled'}>Invia selezione</button><button class="btn" id="w-seldel" style="flex:1;color:#c0392b" ${info.nodes.length ? '' : 'disabled'}>Elimina dal Watch</button></div>` : ''}<button class="chip" id="w-delall" style="color:#c0392b;margin:0 0 10px" ${info.nodes.length ? '' : 'disabled'}>Elimina tutte le mappe dal Watch</button>`
        : '';
      const list = areas.length
        ? `<div class="list">${areas
            .map((a) => {
              const sr = pickSource(a, MAP_SRC);
              const est = sr ? estimateWatchBytes(a, sr, MAP_Z) : 0;
              const [lab, col, bg] = mapStatus(a);
              const queued = isQueued(a.id);
              const mine = sending && sending.id === a.id;
              const prog = mine ? (sending.phase === 'prep' ? `Preparo ${Math.round((sending.done / (sending.total || 1)) * 100)}%` : 'Invio in corso...') : '';
              const sent = st && st.maps && st.maps[a.id] != null;
              const can = !!sr && info.nodes.length > 0 && !queued;
              return `<div class="set-row col" style="gap:8px"><label style="display:flex;gap:12px;align-items:flex-start;cursor:pointer"><input type="checkbox" data-sel="${a.id}" ${selected.has(a.id) ? 'checked' : ''} style="width:22px;height:22px;margin-top:2px;flex:none"><div class="ti"><b>${esc(a.name)}</b><small>${sr ? `circa ${fmtSize(est)} sul watch${sr === 'sat' ? ', con i nomi' : ''}` : 'Solo sentieri: scarica anche Satellite o Topografica'}</small></div></label><div style="display:flex;align-items:center;justify-content:space-between;gap:10px"><span style="font-size:.78rem;font-weight:600;padding:4px 11px;border-radius:10px;color:${col};background:${bg}">${lab}</span><span style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end"><button class="chip" data-send="${a.id}" ${can ? '' : 'disabled'}>${queued ? 'In coda' : sent ? 'Reinvia al Watch' : 'Invia al Watch'}</button>${sent ? `<button class="chip" data-del="${a.id}" style="color:#c0392b" ${info.nodes.length && !queued ? '' : 'disabled'}>Elimina dal Watch</button>` : ''}</span></div>${prog ? `<div data-prog="${a.id}" style="font-size:.8rem;color:#b7791f">${prog}</div>` : ''}</div>`;
            })
            .join('')}</div>`
        : `<div class="empty" style="padding:26px 14px"><p>Nessuna mappa offline sul telefono.</p></div>`;
      return `<div style="padding:0 14px">${storage}
        <div class="sec-h" style="padding-left:0">MAPPE SUL TELEFONO</div>${allBar}${selBar}${list}
        <button class="btn primary big" id="w-dl" style="margin-top:14px">+ Scarica nuova mappa</button>
        <p class="muted" style="margin:10px 2px;font-size:.82rem;line-height:1.5">L'invio va via Bluetooth (circa 1 MB al minuto): per le zone grandi tieni il watch vicino. Con il satellite sono inclusi i nomi di paesi, monti e acque (la preparazione richiede qualche minuto). Puoi eliminarle dal watch con «Elimina dal Watch».</p></div>`;
    };

    const startSend = async (a) => {
      const src = pickSource(a, MAP_SRC);
      if (!src) return toast('Questa zona ha solo sentieri');
      if (isQueued(a.id)) return;
      const est = estimateWatchBytes(a, src, MAP_Z);
      const st = info.status;
      if (st && st.free && est > st.free * 0.9) return toast("Spazio insufficiente sull'orologio");
      if (est > 40e6 && !(await confirmBox(`Circa <b>${fmtSize(est)}</b>: via Bluetooth servono circa ${estimateMinutes(est)} minuti. Continuare?`, { ok: 'Invia' }))) return;
      queue.push(a);
      toast(running ? 'Aggiunta alla coda' : 'Invio avviato');
      paintPane();
      runQueue();
    };

    // ---------- scheda 3: preferenze hardware ----------
    const paneHw = () => {
      const c = watchCfg();
      return `<div class="sec-h">TASTI E CORONA</div>
        <div class="list">
          ${row('Tasto salva', 'Pressione breve: salva subito oppure apre il menu a ruota', sel('watchKeyMode', c.keyMode, [[0, 'Salva subito'], [1, 'Menu a ruota']]))}
          ${row('Sensibilità corona', 'Quanto serve girare per fare un passo', sel('watchRot', c.rot, [[25, 'Alta'], [40, 'Media'], [70, 'Bassa']]))}
        </div>
        <small class="muted" style="display:block;margin:6px 4px 0;line-height:1.5">Per scegliere quali tasti fisici usare: sul watch apri Menu, Assegna SALVA / Assegna ALT e premi il tasto.</small>
        <div class="sec-h">VIBRAZIONE</div>
        <div class="list">
          ${row('Vibra vicino al punto (m)', 'Distanza a cui parte la vibrazione', `<input type="number" data-k="watchProx" min="5" max="100" value="${c.prox}" onfocus="this.select()">`)}
          ${row('Avviso fuori traccia (m)', 'Nel rientro, vibra se ti allontani oltre questa distanza', `<input type="number" data-k="watchOffM" min="10" max="300" value="${c.offM}" onfocus="this.select()">`)}
        </div>
        <div class="sec-h">SCHERMO</div>
        <div class="list">
          ${row('Tema', 'Neon (giallo e verde) o rosso notte', sel('watchTheme', c.theme, [[0, 'Neon'], [1, 'Rosso notte']]))}
          ${row('Dimensione mappa', 'Più grande = più leggibile, vedi meno zona', sel('watchTscale', c.tscale, [[1, '1x'], [1.5, '1.5x'], [2, '2x']]))}
          <div class="set-row"><div class="ti"><b>Blocco touch</b><small>Schermo non sensibile (neve, gocce, guanti): si usa solo corona e tasti</small></div><label class="switch"><input type="checkbox" data-k="watchLock" ${c.lock ? 'checked' : ''}><i></i></label></div>
        </div>
        <button class="btn primary big" id="w-send" style="margin-top:16px">Invia al watch ora</button>
        <p id="w-st" style="margin:10px 2px;font-size:.85rem;color:#4b5f55;line-height:1.5">Le modifiche partono da sole dopo pochi secondi, via Bluetooth. Quelle fatte dal menu del watch valgono finché non ne invii altre da qui.</p>`;
    };

    const paintPane = () => {
      $('#w-pane').innerHTML = TAB === 0 ? paneIcons() : TAB === 1 ? paneMaps() : paneHw();
    };

    // ---------- aggiornamento stato ----------
    const refresh = async () => {
      try {
        const r = await watchInfo();
        info = { nodes: r.nodes, status: r.status, ok: true };
      } catch {
        info = { nodes: [], status: null, ok: true };
      }
      if (!alive) return;
      lastStatus = info.status;
      areas = await listAreas().catch(() => areas);
      paintBanner();
      if (TAB === 1 && !sending) paintPane();
    };

    repaint = (full) => {
      if (!alive) return;
      if (TAB === 1) paintPane();
      if (full) refresh();
    };
    paintBanner();
    paintTabs();
    paintPane();
    refresh();
    const iv = setInterval(refresh, 10000);
    pg.onClose = () => {
      alive = false;
      repaint = null;
      clearInterval(iv);
    };

    // ---------- eventi ----------
    pg.body.addEventListener('click', async (e) => {
      const tab = e.target.closest('[data-tab]');
      if (tab) {
        TAB = Number(tab.dataset.tab);
        paintTabs();
        paintPane();
        if (TAB === 1) refresh();
        return;
      }
      const c = watchCfg();
      const u = e.target.closest('[data-u]'), d = e.target.closest('[data-d]'), x = e.target.closest('[data-x]'), p = e.target.closest('[data-pick]');
      if (u || d) {
        const n = Number((u || d).dataset[u ? 'u' : 'd']);
        const m = u ? n - 1 : n + 1;
        const a = c.icons.slice();
        [a[n], a[m]] = [a[m], a[n]];
        saveIcons(a);
      } else if (x) {
        if (c.icons.length > 1) saveIcons(c.icons.filter((_, i) => i !== Number(x.dataset.x)));
      } else if (p) {
        const n = Number(p.dataset.pick);
        openPicker(`Icona ${n + 1}`, (id) => {
          const a = watchCfg().icons.slice();
          const j = a.indexOf(id);
          if (j >= 0 && j !== n) a[j] = a[n]; // già presente: scambio
          a[n] = id;
          saveIcons(a);
        });
      } else if (e.target.closest('#w-add')) {
        const cur = c.icons;
        if (cur.length >= WATCH_MAX_ICONS) return;
        openPicker('Aggiungi icona', (id) => saveIcons([...watchCfg().icons, id]), cur);
      } else if (e.target.closest('#w-reset')) {
        saveIcons(WATCH_DEFAULT_ICONS.slice());
      } else if (e.target.closest('#w-dl')) {
        leavePages();
        bus.emit('nav:tab', 'map');
        setTimeout(() => bus.emit('map:download'), 250);
      } else if (e.target.closest('#w-all')) {
        const st = info.status;
        const free = st && st.free ? st.free * 0.9 : Infinity;
        let tot = 0, n = 0;
        for (const a of areas) {
          if (!pickSource(a, MAP_SRC) || (st && st.maps && st.maps[a.id] != null) || isQueued(a.id) || (pendingAck[a.id] && Date.now() - pendingAck[a.id] < 10 * 60000)) continue;
          tot += watchMapBytes(a);
          queue.push(a);
          n++;
        }
        if (tot > free) toast("Attenzione: potrebbe non esserci spazio per tutte, quelle che non entrano vengono saltate");
        toast(`${n} mappe in coda`);
        paintPane();
        runQueue();
      } else if (e.target.closest('#w-selall')) {
        if (selected.size === areas.length) selected.clear(); else areas.forEach((a) => selected.add(a.id));
        paintPane();
      } else if (e.target.closest('#w-selsend')) {
        const st = info.status;
        let n = 0, skip = 0;
        for (const a of areas) {
          if (!selected.has(a.id)) continue;
          if (!pickSource(a, MAP_SRC) || (st && st.maps && st.maps[a.id] != null) || isQueued(a.id)) { skip++; continue; }
          queue.push(a);
          n++;
        }
        selected.clear();
        toast(n ? `${n} mappe in coda${skip ? `, ${skip} già presenti` : ''}` : 'Le mappe scelte sono già sul watch');
        paintPane();
        runQueue();
      } else if (e.target.closest('#w-seldel')) {
        const ids = areas.filter((a) => selected.has(a.id)).map((a) => a.id);
        if (ids.length && (await confirmBox(`Eliminare <b>${ids.length}</b> mappe dal watch? Restano sul telefono.`, { ok: 'Elimina' }))) {
          try {
            await sendCmd({ op: 'delmap', ids });
            if (info.status && info.status.maps) ids.forEach((i) => delete info.status.maps[i]);
            ids.forEach((i) => delete pendingAck[i]);
            selected.clear();
            toast('Richiesta inviata: il watch elimina le mappe');
          } catch (err) {
            toast('Non riuscito: ' + ((err && err.message) || err));
          }
          paintPane();
        }
      } else if (e.target.closest('#w-delall')) {
        if (await confirmBox('Eliminare <b>tutte</b> le mappe dal watch? Restano sul telefono.', { ok: 'Elimina tutte' })) {
          try {
            await sendCmd({ op: 'clearmaps' });
            if (info.status) info.status.maps = {};
            for (const k of Object.keys(pendingAck)) delete pendingAck[k];
            toast('Richiesta inviata: il watch elimina tutte le mappe');
          } catch (err) {
            toast('Non riuscito: ' + ((err && err.message) || err));
          }
          paintPane();
        }
      } else if (e.target.closest('#w-qclr')) {
        queue = [];
        paintPane();
      } else if (e.target.closest('[data-del]')) {
        const a = areas.find((z) => z.id === e.target.closest('[data-del]').dataset.del);
        if (a && (await confirmBox(`Eliminare <b>${esc(a.name)}</b> dal watch?`, { ok: 'Elimina' }))) {
          try {
            await sendCmd({ op: 'delmap', id: a.id });
            if (info.status && info.status.maps) delete info.status.maps[a.id];
            delete pendingAck[a.id];
            toast('Richiesta inviata: il watch elimina la mappa');
          } catch (err) {
            toast('Non riuscito: ' + ((err && err.message) || err));
          }
          paintPane();
        }
      } else if (e.target.closest('[data-send]')) {
        const a = areas.find((z) => z.id === e.target.closest('[data-send]').dataset.send);
        if (a) startSend(a);
      } else if (e.target.closest('#w-send')) {
        const st = pg.body.querySelector('#w-st');
        st.textContent = 'Invio in corso...';
        sendToWatch({ config: true, wps: true })
          .then((n) => (st.textContent = n ? `Inviato a ${n} orologio.` : 'Inviato, ma nessun orologio è collegato in questo momento: arriverà alla riconnessione.'))
          .catch(() => (st.textContent = "Invio non riuscito: controlla che l'orologio sia collegato al telefono (app Wear OS)."));
      }
    });
    pg.body.addEventListener('change', (e) => {
      const cb = e.target.closest && e.target.closest('[data-sel]');
      if (cb) {
        if (cb.checked) selected.add(cb.dataset.sel); else selected.delete(cb.dataset.sel);
        paintPane();
        return;
      }
      const k = e.target && e.target.dataset && e.target.dataset.k;
      if (!k) return;
      let v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      if (e.target.tagName === 'SELECT' || e.target.type === 'number') v = Number(v);
      if (e.target.type === 'number' && !isFinite(v)) return;
      setSetting(k, v);
      queueSend(true);
    });
    // Invio da tastiera: conferma il campo
    pg.body.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target && e.target.tagName === 'INPUT') {
        e.preventDefault();
        e.target.blur();
      }
    });
  });
}
