import { getSettings, apiKey } from './store.js';

// Catena di provider: Gemini -> OpenRouter -> Groq (fallback open source)
export function providers() {
  const s = getSettings();
  const list = [];
  if (apiKey('gemini')) list.push({ id: 'gemini', name: 'Gemini', key: apiKey('gemini'), model: s.geminiModel });
  if (apiKey('openrouter')) list.push({ id: 'openrouter', name: 'OpenRouter', key: apiKey('openrouter'), model: s.openrouterModel });
  if (apiKey('groq')) list.push({ id: 'groq', name: 'Groq', key: apiKey('groq'), model: s.groqModel });
  return list;
}
export const hasAI = () => providers().length > 0;

async function post(url, headers, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  if (!r.ok) {
    let t = '';
    try {
      t = (await r.text()).slice(0, 300);
    } catch {}
    const e = new Error(`HTTP ${r.status} ${t}`);
    e.status = r.status;
    throw e;
  }
  return r.json();
}

async function callGemini(p, { system, user, images, audio, json }) {
  const parts = [{ text: user }];
  for (const i of images || []) parts.push({ inline_data: { mime_type: i.mime, data: i.data } });
  if (audio) parts.push({ inline_data: { mime_type: audio.mime, data: audio.data } });
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature: 0.2, ...(json ? { responseMimeType: 'application/json' } : {}) },
  };
  const j = await post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(p.model)}:generateContent`, { 'x-goog-api-key': p.key }, body);
  const t = (j.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('');
  if (!t) throw new Error('Risposta vuota');
  return t;
}

async function callOpenAI(p, url, extraHeaders, { system, user, images, json }) {
  const content = [{ type: 'text', text: user }];
  for (const i of images || []) content.push({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.data}` } });
  const body = {
    model: p.model,
    temperature: 0.2,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: images && images.length ? content : user },
    ],
  };
  if (json) body.response_format = { type: 'json_object' };
  const j = await post(url, { Authorization: `Bearer ${p.key}`, ...extraHeaders }, body);
  const t = j.choices?.[0]?.message?.content;
  if (!t) throw new Error('Risposta vuota');
  return typeof t === 'string' ? t : t.map((x) => x.text || '').join('');
}

export async function askModel(opts) {
  const list = providers();
  if (!list.length) throw new Error('NO_KEY');
  let order = list;
  if (opts.audio) {
    order = list.filter((p) => p.id === 'gemini');
    if (!order.length) throw new Error('AUDIO_NEEDS_GEMINI');
  }
  let lastErr;
  for (const p of order) {
    try {
      let text;
      if (p.id === 'gemini') text = await callGemini(p, opts);
      else if (p.id === 'openrouter') text = await callOpenAI(p, 'https://openrouter.ai/api/v1/chat/completions', { 'HTTP-Referer': 'https://footprint.app', 'X-Title': 'Footprint' }, opts);
      else text = await callOpenAI(p, 'https://api.groq.com/openai/v1/chat/completions', {}, opts);
      return { text, provider: p.name };
    } catch (e) {
      lastErr = e;
      console.warn('AI provider fallito', p.id, e.message);
    }
  }
  throw lastErr || new Error('AI non disponibile');
}

export function parseJSON(text) {
  const t = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(t);
  } catch {}
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error('Risposta AI non valida');
}

export function aiErrorMessage(e) {
  const m = String(e && e.message);
  if (m === 'NO_KEY') return 'Nessuna chiave AI configurata. Inseriscila in Impostazioni → Intelligenza artificiale.';
  if (m === 'AUDIO_NEEDS_GEMINI') return 'Il riconoscimento dei suoni richiede una chiave Gemini (Impostazioni).';
  if (m.includes('429')) return 'Limite di richieste raggiunto. Riprova tra poco.';
  if (m.includes('401') || m.includes('403')) return 'Chiave AI non valida o non autorizzata.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Nessuna connessione. L\'AI richiede internet.';
  return 'AI non disponibile: ' + m.slice(0, 120);
}

// ---------- audio: decodifica e conversione in WAV 16 kHz mono ----------
export async function audioToWav(arrayBuffer, maxSec = 45) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  const buf = await ctx.decodeAudioData(arrayBuffer.slice(0));
  ctx.close && ctx.close();
  const rate = 16000;
  const len = Math.min(Math.floor(buf.duration * rate), maxSec * rate);
  const off = new OfflineAudioContext(1, len, rate);
  const src = off.createBufferSource();
  src.buffer = buf;
  src.connect(off.destination);
  src.start(0);
  const rendered = await off.startRendering();
  const pcm = rendered.getChannelData(0);
  const out = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const w = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); out.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, rate, true); out.setUint32(28, rate * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true);
  w(36, 'data'); out.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
  const bytes = new Uint8Array(out.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return { mime: 'audio/wav', data: btoa(bin) };
}
