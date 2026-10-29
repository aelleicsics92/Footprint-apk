import { $, esc } from './util.js';
import { ico } from './icons.js';

// ---------- Toast ----------
let toastTimer;
export function toast(msg, ms = 2400) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------- Sheets ----------
const sheets = [];
export function openSheet({ title = '', body = '', onMount, full = false, cls = '' }) {
  const root = $('#sheet-root');
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet-back"></div>
    <div class="sheet ${full ? 'full' : ''} ${cls}" role="dialog" aria-modal="true">
      <div class="sheet-grip"></div>
      ${title ? `<div class="sheet-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close aria-label="Chiudi">${ico('close', 20)}</button></div>` : ''}
      <div class="sheet-body"></div>
    </div>`;
  root.appendChild(wrap);
  const bodyEl = $('.sheet-body', wrap);
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else if (body) bodyEl.appendChild(body);
  const api = {
    el: wrap,
    body: bodyEl,
    close() {
      const i = sheets.indexOf(api);
      if (i >= 0) sheets.splice(i, 1);
      wrap.classList.add('out');
      setTimeout(() => wrap.remove(), 180);
      api.onClose && api.onClose();
    },
  };
  wrap.addEventListener('click', (e) => {
    if (e.target.classList.contains('sheet-back') || e.target.closest('[data-close]')) api.close();
  });
  // trascina verso il basso per chiudere (da maniglia, titolo o dall'inizio del contenuto)
  const sheetEl = $('.sheet', wrap);
  let ty = null, dy = 0, fromHead = false;
  let noDrag = false;
  try { noDrag = !!JSON.parse(localStorage.getItem('fp.settings') || '{}').dbgNoDrag; } catch {}
  if (!noDrag) sheetEl.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    fromHead = !!e.target.closest('.sheet-grip,.sheet-head');
    const top = fromHead || (bodyEl.contains(e.target) && bodyEl.scrollTop <= 0);
    ty = top ? t.clientY : null;
    dy = 0;
  }, { passive: true });
  if (!noDrag) sheetEl.addEventListener('touchmove', (e) => {
    if (ty == null) return;
    dy = e.touches[0].clientY - ty;
    if (dy > (fromHead ? 8 : 16) && (fromHead || bodyEl.scrollTop <= 0)) {
      sheetEl.style.transition = 'none';
      sheetEl.style.transform = `translateY(${dy}px)`;
    } else if (dy < 0) ty = null;
  }, { passive: true });
  const endDrag = () => {
    if (ty == null) return;
    ty = null;
    sheetEl.style.transition = '';
    sheetEl.style.transform = '';
    if (dy > 90) api.close();
    dy = 0;
  };
  sheetEl.addEventListener('touchend', endDrag);
  sheetEl.addEventListener('touchcancel', endDrag);
  sheets.push(api);
  requestAnimationFrame(() => wrap.classList.add('in'));
  onMount && onMount(api);
  return api;
}
export const closeTopSheet = () => {
  const s = sheets[sheets.length - 1];
  if (s) {
    s.close();
    return true;
  }
  return false;
};

export function confirmBox(message, { ok = 'OK', cancel = 'Annulla', danger = false, title = '' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const s = openSheet({
      title,
      cls: 'confirm',
      body: `<p class="confirm-msg">${message}</p>
        <div class="row gap">
          <button class="btn ghost grow" data-act="no">${esc(cancel)}</button>
          <button class="btn ${danger ? 'danger' : 'primary'} grow" data-primary data-act="yes">${esc(ok)}</button>
        </div>`,
    });
    s.onClose = () => !done && ((done = true), resolve(false));
    s.body.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      done = true;
      resolve(b.dataset.act === 'yes');
      s.close();
    });
  });
}

// ---------- Pagine a schermo intero ----------
let pageStack = [];
export function openPage(title, render, { actions = '' } = {}) {
  const root = $('#page');
  const el = document.createElement('div');
  el.className = 'page-layer';
  el.innerHTML = `<header class="page-head"><button class="icon-btn" data-back aria-label="Indietro">${ico('back', 24)}</button><h2>${esc(title)}</h2><div class="page-actions">${actions}</div></header><div class="page-body"></div>`;
  root.appendChild(el);
  root.classList.remove('hidden');
  const api = {
    el,
    reopen: () => openPage(title, render, { actions }),
    body: $('.page-body', el),
    head: $('.page-actions', el),
    close() {
      const i = pageStack.indexOf(api);
      if (i >= 0) pageStack.splice(i, 1);
      el.classList.add('out');
      setTimeout(() => {
        el.remove();
        if (!pageStack.length) root.classList.add('hidden');
      }, 160);
      api.onClose && api.onClose();
    },
  };
  $('[data-back]', el).addEventListener('click', () => api.close());
  pageStack.push(api);
  requestAnimationFrame(() => el.classList.add('in'));
  render(api);
  return api;
}
// Overlay a schermo intero senza sheet/pagina (torcia, selezione posizione...): il tasto indietro li chiude
const backs = [];
export function pushBack(fn) {
  backs.push(fn);
  return () => { const i = backs.indexOf(fn); if (i >= 0) backs.splice(i, 1); };
}
export function runTopBack() {
  const f = backs.pop();
  if (!f) return false;
  f();
  return true;
}
// Chiude tutte le pagine ricordandole: il tasto indietro dalla mappa le riapre
let backReturn = null;
export function leavePages() {
  const items = pageStack.map((p) => p.reopen).filter(Boolean);
  pageStack.slice().forEach((p) => p.close());
  backReturn = items.length ? () => items.forEach((f) => f()) : null;
}
export const takeBackReturn = () => { const f = backReturn; backReturn = null; return f; };
export const clearBackReturn = () => { backReturn = null; };
export const closeTopPage = () => {
  const p = pageStack[pageStack.length - 1];
  if (p) {
    p.close();
    return true;
  }
  return false;
};

// ---------- Comportamento globale dei campi ----------
export function installInputBehaviour() {
  // Seleziona tutto il contenuto al focus
  document.addEventListener('focusin', (e) => {
    const t = e.target;
    if (t.dataset && t.dataset.noselect !== undefined) return;
    if (t.matches && t.matches('input[type=text],input[type=number],input[type=tel],input[type=search],input[type=password],input:not([type])')) {
      setTimeout(() => {
        try {
          t.select();
        } catch {}
      }, 0);
    }
  });
  // Invio = conferma (pulsante primario del contenitore), Tab = navigazione nativa
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    const t = e.target;
    if (!t.matches || !t.matches('input,select')) return;
    const scope = t.closest('[data-enter-scope],.sheet,.page-layer');
    const btn = scope && scope.querySelector('[data-primary]:not([disabled])');
    if (btn) {
      e.preventDefault();
      t.blur();
      btn.click();
    } else if (t.tagName === 'INPUT') {
      e.preventDefault();
      t.blur(); // conferma il campo (evento change)
    }
  });
}

export function setBusy(btn, busy, label) {
  if (!btn) return;
  btn.disabled = busy;
  if (label != null) btn.dataset.label ||= btn.innerHTML;
  btn.innerHTML = busy ? `<span class="spin"></span> ${esc(label || '')}` : btn.dataset.label || btn.innerHTML;
}
