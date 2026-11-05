// Visualizzatore foto a schermo intero: pizzica per zoom, trascina, doppio tocco, scorri tra le foto, indietro per chiudere
import { pushBack } from './ui.js';

export function openLightbox(urls, start = 0) {
  if (!urls || !urls.length) return;
  let i = start, sc = 1, tx = 0, ty = 0;
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.94);touch-action:none;overflow:hidden;display:flex;align-items:center;justify-content:center';
  el.innerHTML = '<img draggable="false" style="max-width:100%;max-height:100%;transform-origin:center;will-change:transform;user-select:none"><button aria-label="Chiudi" style="position:absolute;top:calc(var(--sat,0px) + 12px);right:14px;width:44px;height:44px;border-radius:50%;border:0;background:rgba(255,255,255,.18);color:#fff;font-size:26px;line-height:1">×</button><div style="position:absolute;bottom:calc(var(--sab,0px) + 18px);left:0;right:0;text-align:center;color:#fff;font-size:.85rem;opacity:.85"></div>';
  document.body.appendChild(el);
  const img = el.querySelector('img'), cnt = el.querySelector('div');
  const apply = () => { img.style.transform = `translate(${tx}px,${ty}px) scale(${sc})`; };
  const show = (n) => { i = (n + urls.length) % urls.length; sc = 1; tx = ty = 0; img.src = urls[i]; cnt.textContent = urls.length > 1 ? `${i + 1} / ${urls.length}` : ''; apply(); };
  let popBack = null;
  const close = () => { el.remove(); if (popBack) popBack(); popBack = null; };
  popBack = pushBack(() => { popBack = null; el.remove(); });
  el.querySelector('button').onclick = close;
  const P = new Map();
  let d0 = 0, s0 = 1, sx = 0, sy = 0, tx0 = 0, ty0 = 0, moved = 0, lastTap = 0, t0 = 0;
  const dist = () => { const [a, b] = [...P.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  el.addEventListener('pointerdown', (e) => {
    if (e.target.tagName === 'BUTTON') return;
    el.setPointerCapture(e.pointerId);
    P.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (P.size === 2) { d0 = dist(); s0 = sc; }
    else { sx = e.clientX; sy = e.clientY; tx0 = tx; ty0 = ty; moved = 0; t0 = Date.now(); }
  });
  el.addEventListener('pointermove', (e) => {
    if (!P.has(e.pointerId)) return;
    P.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (P.size === 2) { sc = Math.max(1, Math.min(6, (s0 * dist()) / d0)); if (sc === 1) { tx = ty = 0; } apply(); moved = 99; }
    else if (P.size === 1) {
      const dx = e.clientX - sx, dy = e.clientY - sy;
      moved = Math.max(moved, Math.hypot(dx, dy));
      if (sc > 1) { tx = tx0 + dx; ty = ty0 + dy; apply(); }
    }
  });
  const up = (e) => {
    if (!P.has(e.pointerId)) return;
    const wasOne = P.size === 1;
    P.delete(e.pointerId);
    if (!wasOne) { sx = [...P.values()][0]?.x ?? 0; sy = [...P.values()][0]?.y ?? 0; tx0 = tx; ty0 = ty; return; }
    const dx = e.clientX - sx;
    if (sc === 1 && Math.abs(dx) > 60 && moved > 60 && urls.length > 1) { show(i + (dx < 0 ? 1 : -1)); return; }
    if (moved < 10 && Date.now() - t0 < 300) {
      if (Date.now() - lastTap < 300) { sc = sc > 1 ? 1 : 2.5; if (sc === 1) tx = ty = 0; apply(); lastTap = 0; }
      else lastTap = Date.now();
    }
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  show(i);
}
