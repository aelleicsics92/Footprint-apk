import { mountIdentify } from './identify.js';
import { mountChat } from './chat.js';
import { mountGuide } from './guide.js';

let root, tab = 'id';
const mounted = {};

export function mountAI(el) {
  root = el;
  el.innerHTML = `<div class="seg" style="position:sticky;top:0;z-index:5;margin:0;padding:calc(var(--sat) + 8px) 14px 8px;background:var(--paper);border-radius:0">
      <div style="display:flex;width:100%;background:var(--paper2);border-radius:14px;padding:4px">
        <button data-t="id" class="sel" style="flex:1;border:0;background:none;border-radius:11px;padding:9px 6px;font-weight:600;font-size:.88rem;color:var(--muted)">Identifica</button>
        <button data-t="chat" style="flex:1;border:0;background:none;border-radius:11px;padding:9px 6px;font-weight:600;font-size:.88rem;color:var(--muted)">Chiedi</button>
        <button data-t="guide" style="flex:1;border:0;background:none;border-radius:11px;padding:9px 6px;font-weight:600;font-size:.88rem;color:var(--muted)">Guida</button>
      </div></div>
    <div id="ai-id"></div><div id="ai-chat" class="hidden"></div><div id="ai-guide" class="hidden"></div>`;
  mountIdentify(el.querySelector('#ai-id'));
  mountChat(el.querySelector('#ai-chat'));
  mountGuide(el.querySelector('#ai-guide'));
  el.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => show(b.dataset.t)));
  show('id');
}
function show(t) {
  tab = t;
  root.querySelectorAll('[data-t]').forEach((b) => {
    const on = b.dataset.t === t;
    b.style.background = on ? 'var(--card)' : 'none';
    b.style.color = on ? 'var(--forest)' : 'var(--muted)';
    b.style.boxShadow = on ? '0 1px 3px rgba(0,0,0,.12)' : 'none';
  });
  root.querySelector('#ai-id').classList.toggle('hidden', t !== 'id');
  root.querySelector('#ai-chat').classList.toggle('hidden', t !== 'chat');
  root.querySelector('#ai-guide').classList.toggle('hidden', t !== 'guide');
}
