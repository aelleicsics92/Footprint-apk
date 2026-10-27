import animals from '../data/animals.json';
import plants from '../data/plants.json';
import mushrooms from '../data/mushrooms.json';
import truffles from '../data/truffles.json';
import { esc } from '../lib/util.js';
import { openSheet } from '../lib/ui.js';
import { hydratePhotos } from '../lib/photos.js';
import { findSound } from '../lib/sounds.js';

export const DB = {
  animali: animals.map((x) => ({ ...x, _k: 'animali' })),
  erbe: plants.map((x) => ({ ...x, _k: 'erbe' })),
  funghi: mushrooms.map((x) => ({ ...x, _k: 'funghi' })),
  tartufi: truffles.map((x) => ({ ...x, _k: 'tartufi' })),
};
export const ALL = [...DB.animali, ...DB.erbe, ...DB.funghi, ...DB.tartufi];
export const byId = (id, kinds) => ALL.find((x) => x.id === id && (!kinds || kinds.includes(x._k)));

export function statoBadge(stato) {
  if (!stato) return '';
  const s = stato.toLowerCase();
  const cls = s.includes('mortale') ? 'b-dead' : s.includes('tossic') ? 'b-bad' : s.includes('cautela') || s.includes('cottura') || s.includes('non commestibile') ? 'b-warn' : 'b-ok';
  const em = cls === 'b-ok' ? '🟢' : cls === 'b-warn' ? '🟡' : '🔴';
  return `<span class="badge ${cls}">${em} ${esc(stato)}</span>`;
}

const row = (k, v) => (v ? `<dt>${k}</dt><dd>${esc(v)}</dd>` : '');

const photoBox = (x) => `<div class="sc-photo" data-ph="${x._k}|${x.id}"><span class="muted">Carico la foto…</span></div><small class="muted ph-credit">Foto: iNaturalist, Wikimedia Commons (licenze libere)</small>`;
export const findByKey = (k) => { const [kind, id] = k.split('|'); return (DB[kind] || []).find((y) => y.id === id); };

const COOK = [
  [/porcino|porcinello|boleto (granulato|dorato|baio|appendicolato|scarpone)|pinarolo/i, 'Pulisci con un panno o pennello, senza bagnarlo; raschia la base del gambo. Mai sott\'acqua.', 'Fresco in frigo 2-3 giorni (carta, non plastica). Essicca a fette (40-50 °C) o congela già cotto. Sott\'olio solo con ricetta sicura (acidificato) per il rischio botulino.', 'Trifolati con aglio e nepitella, crudi a lamelle (solo i più freschi), risotti, tagliatelle, grigliati.'],
  [/gallinaccio|finferla|cantarello|galletto/i, 'Pulisci a secco, strofina il cappello, taglia la base del gambo.', 'Fresco pochi giorni. Congela dopo una cottura a secco in padella; essiccati diventano gommosi.', 'In padella con burro e prezzemolo, con uova, nei risotti. Sempre ben cotti.'],
  [/ovol[oi] buon|cesarea|ovolo/i, 'Pulisci il cappello con un panno; rimuovi la volva alla base.', 'Fresco 1-2 giorni, non si essicca bene. Consumalo subito.', 'Crudo in insalata con olio e limone (solo se certissimo e freschissimo), oppure grigliato.'],
  [/mazza di tamburo|mazza/i, 'Elimina il gambo (fibroso), pulisci il cappello.', 'Fresco 2 giorni. Si impana e si congela.', 'Cappello impanato e fritto (cotoletta), ben cotto.'],
  [/prataiolo|champignon/i, 'Pulisci con un panno, elimina la base del gambo.', 'Fresco 3-4 giorni in frigo.', 'Trifolato, crudo a lamelle, in torte salate. Attenzione a non confonderlo con funghi tossici simili.'],
  [/orecchione|cardoncello|pleurotus|pioppino/i, 'Pulisci a secco; elimina la parte dura del gambo.', 'Fresco 5-7 giorni; congela già cotto.', 'Alla griglia, in padella, in zuppe e sughi.'],
  [/chiodino|famigliola|armillaria/i, 'Non si mangia mai crudo. Scarta i gambi duri. Va sbollentato 10-15 min e l\'acqua buttata.', 'Dopo la sbollentatura congela o metti sott\'olio con ricetta sicura.', 'In umido, sott\'olio, con la pasta. Mai poco cotto.'],
  [/spugnola|morchella|prugnolo/i, 'Taglia a metà per eliminare terra e insetti, lava rapidamente. Vanno sempre ben cotte.', 'Essicca bene (si reidrata). Fresche pochi giorni.', 'In padella con panna o burro, ripiene, nei sughi. Mai crude.'],
  [/lingua di bue|laetiporo|pollo del bosco/i, 'Usa solo le parti tenere e giovani.', 'Fresco pochi giorni; congela cotto.', 'In padella o impanato, sempre ben cotto. Alcune persone lo digeriscono male: assaggia poco la prima volta.'],
  [/vescia/i, 'Raccogli solo esemplari con carne bianca e compatta. Pela la buccia esterna.', 'Fresca 1-2 giorni.', 'A fette impanate e fritte.'],
  [/steccherino|barba di leone|ciuffo|maitake|ramaria|cavolfiore/i, 'Pulisci con un panno e dividi in ciuffi.', 'Fresco pochi giorni.', 'In padella con aglio e olio, o in umido.'],
  [/tartuf|scorzone|bianchetto|bianco|nero/i, 'Spazzola con uno spazzolino morbido sotto acqua corrente fredda, asciuga subito.', 'In frigo avvolto in carta assorbente (cambiala ogni giorno) dentro un barattolo di vetro, 5-7 giorni. Mai in acqua.', 'Crudo grattugiato a lamelle su uova, pasta, risotto o carne, appena prima di servire. Non cuocerlo.'],
];
const COOK_DEF = ['Pulisci a secco con un panno, elimina le parti terrose o rovinate.', 'Fresco in frigo 2-3 giorni; per conservarlo più a lungo cuocilo e congelalo.', 'Cuoci sempre bene e assaggia una piccola quantità la prima volta.'];
function cucinaHTML(x) {
  const st = (x.stato || '').toLowerCase();
  if (x._k === 'erbe') {
    if (!st.startsWith('commest')) return '';
    return `<div class="infobox" style="margin-top:10px"><b>Dopo la cerca</b><br>Lava bene in acqua fredda, usa le parti giovani. Consuma entro 1-2 giorni o sbollenta e congela. Cuoci in frittate, minestre e ripieni.</div>`;
  }
  if (x._k !== 'funghi' && x._k !== 'tartufi') return '';
  if (x._k === 'funghi' && !st.startsWith('commest')) return '';
  const m = COOK.find((c) => c[0].test(x.nome)) || [null, ...COOK_DEF];
  return `<div class="infobox" style="margin-top:10px"><b>Dopo la cerca</b><br><b>Pulizia:</b> ${esc(m[1])}<br><b>Conservazione:</b> ${esc(m[2])}<br><b>In cucina:</b> ${esc(m[3])}${st.includes('cottura') ? '<br><b>Importante:</b> tossico da crudo, cottura completa obbligatoria.' : ''}</div>`;
}

export function schedaHTML(x) {
  if (x._k === 'animali') {
    return `<div>${photoBox(x)}<h3 style="font-size:1.4rem">${esc(x.nome)}</h3><small class="muted"><i>${esc(x.sci)}</i> · ${esc(x.gruppo)}</small>
      <dl class="kv" style="margin-top:12px">${row('Habitat', x.habitat)}${row('Impronta', x.orma)}${row('Escrementi', x.escrementi)}${row('Verso', x.verso)}${row('Note', x.nota)}</dl>
      ${x.verso && x.gruppo !== 'rettile' ? `<button class="btn ghost big" id="snd-btn" style="margin-top:12px">🔊 Ascolta verso</button><div id="snd-out" class="muted" style="font-size:.8rem;margin-top:6px"></div>` : ''}</div>`;
  }
  const extra = x._k === 'erbe' ? row('Parte usata', x.parte) + row('Periodo', x.periodo) + row('Ambiente', x.ambiente) : row('Periodo', x.periodo) + row('Habitat', x.habitat);
  const warn =
    x._k === 'erbe' || x._k === 'funghi'
      ? `<div class="warnbox"><b>Non consumare nulla in base a un'app.</b> Fai sempre verificare funghi ed erbe da un esperto (ispettorato micologico ASL per i funghi).</div>`
      : '';
  return `<div>${photoBox(x)}<h3 style="font-size:1.4rem">${esc(x.nome)}</h3><div style="margin:4px 0 8px">${statoBadge(x.stato)} <small class="muted"><i>${esc(x.sci)}</i></small></div>
    <dl class="kv">${extra}${row('Come riconoscerlo', x.riconoscimento)}${row('Attenzione', x.attenzione)}</dl>${cucinaHTML(x)}${warn}</div>`;
}

export function openScheda(x) {
  const sh = openSheet({ body: schedaHTML(x), full: false });
  hydratePhotos(sh.body, findByKey);
  const sb = sh.body.querySelector('#snd-btn');
  if (sb) sb.onclick = async () => {
    const o = sh.body.querySelector('#snd-out');
    sb.disabled = true;
    o.textContent = 'Cerco la registrazione…';
    const r = navigator.onLine ? await findSound(x) : null;
    sb.disabled = false;
    if (!r) { o.textContent = navigator.onLine ? 'Nessuna registrazione trovata per questa specie.' : 'Serve internet per ascoltare i versi.'; return; }
    o.innerHTML = `<audio controls autoplay style="width:100%" src="${esc(r.url)}"></audio>Fonte: ${esc(r.title)}`;
  };
}
