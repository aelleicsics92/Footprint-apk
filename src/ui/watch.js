// Pagina "Smartwatch": icone del menu a ruota e impostazioni dell'orologio, scelte dal telefono
import { openPage, openSheet, toast, closeTopSheet } from '../lib/ui.js';
import { getSettings, setSetting } from '../lib/store.js';
import { WP_ICONS, WP_BY_ID } from '../lib/icons.js';
import { esc } from '../lib/util.js';
import { watchCfg, sendToWatch, queueSend, WATCH_DEFAULT_ICONS } from '../lib/watchsync.js';

const sel = (k, v, opts) => `<select data-k="${k}" onfocus="this.select&&this.select()">${opts.map(([val, lab]) => `<option value="${val}" ${String(val) === String(v) ? 'selected' : ''}>${lab}</option>`).join('')}</select>`;
const row = (t, d, ctl) => `<div class="set-row"><div class="ti"><b>${t}</b>${d ? `<small>${d}</small>` : ''}</div>${ctl}</div>`;

export function openWatch() {
  openPage('Smartwatch', (pg) => {
    const draw = () => {
      const c = watchCfg();
      pg.body.innerHTML = `
        <div class="sec-h">ICONE DEL MENU A RUOTA (10)</div>
        <div class="list">${c.icons
          .map((id, n) => {
            const ic = WP_BY_ID[id];
            return `<div class="set-row"><span class="ic" style="width:34px;height:34px;display:inline-block">${ic ? ic.svg : ''}</span><div class="ti"><b>${n + 1}. ${esc(ic ? ic.label : id)}</b></div><button class="chip" data-pick="${n}">Cambia</button><button class="btn ghost" data-u="${n}" ${n ? '' : 'disabled'}>▲</button><button class="btn ghost" data-d="${n}" ${n < c.icons.length - 1 ? '' : 'disabled'}>▼</button></div>`;
          })
          .join('')}</div>
        <button class="btn ghost" id="w-reset" style="margin:10px 0 4px">Ripristina icone</button>
        <div class="sec-h">IMPOSTAZIONI DELL'OROLOGIO</div>
        <div class="list">
          ${row('Tasto salva', 'Pressione breve: salva subito, oppure apre il menu a ruota', sel('watchKeyMode', c.keyMode, [[0, 'Salva subito'], [1, 'Menu a ruota']]))}
          ${row('Tema', 'Neon (giallo/verde) o rosso notte', sel('watchTheme', c.theme, [[0, 'Neon'], [1, 'Rosso notte']]))}
          ${row('Vibra vicino al punto (m)', 'Distanza a cui parte la vibrazione', `<input type="number" data-k="watchProx" min="5" max="100" value="${c.prox}" onfocus="this.select()">`)}
          ${row('Avviso fuori traccia (m)', 'Nel rientro, vibra se ti allontani oltre questa distanza', `<input type="number" data-k="watchOffM" min="10" max="300" value="${c.offM}" onfocus="this.select()">`)}
          ${row('Sensibilità corona', '', sel('watchRot', c.rot, [[25, 'Alta'], [40, 'Media'], [70, 'Bassa']]))}
          ${row('Dimensione mappa', 'Più grande = più leggibile, vedi meno zona', sel('watchTscale', c.tscale, [[1, '1x'], [1.5, '1.5x'], [2, '2x']]))}
          <div class="set-row"><div class="ti"><b>Blocco touch</b><small>Schermo non sensibile (neve, gocce, guanti): si usa solo corona e tasti</small></div><label class="switch"><input type="checkbox" data-k="watchLock" ${c.lock ? 'checked' : ''}><i></i></label></div>
        </div>
        <button class="btn primary big" id="w-send" style="margin-top:16px">Invia al watch ora</button>
        <p id="w-st" style="margin:10px 2px;font-size:.85rem;color:#4b5f55;line-height:1.5">Le modifiche partono da sole dopo pochi secondi, via Bluetooth. Sul watch restano i tuoi waypoint: quelli fatti sul watch arrivano qui quando apri l'app.</p>`;
    };
    draw();
    const save = (icons) => {
      setSetting('watchIcons', icons);
      draw();
      queueSend(true);
    };
    pg.body.addEventListener('click', (e) => {
      const c = watchCfg();
      const u = e.target.closest('[data-u]'), d = e.target.closest('[data-d]'), p = e.target.closest('[data-pick]');
      if (u || d) {
        const n = Number((u || d).dataset[u ? 'u' : 'd']);
        const m = u ? n - 1 : n + 1;
        const a = c.icons.slice();
        [a[n], a[m]] = [a[m], a[n]];
        save(a);
      } else if (p) {
        const n = Number(p.dataset.pick);
        const sh = openSheet({
          title: `Icona ${n + 1}`,
          body: `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">${WP_ICONS.map((i) => `<button class="chip" data-ic="${i.id}" style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 2px"><span style="width:38px;height:38px;display:inline-block">${i.svg}</span><small>${esc(i.label)}</small></button>`).join('')}</div>`,
        });
        sh.body.addEventListener('click', (ev) => {
          const b = ev.target.closest('[data-ic]');
          if (!b) return;
          const a = watchCfg().icons.slice();
          const j = a.indexOf(b.dataset.ic);
          if (j >= 0 && j !== n) a[j] = a[n]; // già presente: scambio
          a[n] = b.dataset.ic;
          closeTopSheet();
          save(a);
        });
      } else if (e.target.closest('#w-reset')) {
        save(WATCH_DEFAULT_ICONS.slice());
      } else if (e.target.closest('#w-send')) {
        const st = pg.body.querySelector('#w-st');
        st.textContent = 'Invio in corso...';
        sendToWatch({ config: true, wps: true })
          .then((n) => (st.textContent = n ? `Inviato a ${n} orologio.` : 'Inviato, ma nessun orologio è collegato in questo momento: arriverà alla riconnessione.'))
          .catch(() => (st.textContent = 'Invio non riuscito: controlla che l\'orologio sia collegato al telefono (app Wear OS).'));
      }
    });
    pg.body.addEventListener('change', (e) => {
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
