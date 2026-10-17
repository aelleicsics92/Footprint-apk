import { setSetting, getSettings, apiKey } from './store.js';

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
  // Le chiavi nuove ("AQ.…") non vedono più i modelli 1.x/2.x (errore 404): servono i Gemini 3.x.
  const legacy = (m) => !m || /latest|gemini-(1|2)\./.test(m);
  const first = legacy(p.model) ? 'gemini-3.5-flash' : p.model;
  const models = [...new Set([first, 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.7-flash'])];
  const gen = (m) => post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`, { 'x-goog-api-key': p.key }, body);
  const vtx = (m) => post(`https://aiplatform.googleapis.com/v1/publishers/google/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(p.key)}`, {}, body);
  let j, firstErr;
  for (const m of models) {
    try {
      j = await gen(m);
      if (m !== p.model) setSetting('geminiModel', m);
      break;
    } catch (e) {
      firstErr = firstErr || e;
      if (![404, 429, 500, 503].includes(e.status)) break; // chiave rifiutata o richiesta errata: inutile cambiare modello
    }
  }
  if (!j) {
    try {
      j = await vtx(first);
    } catch {
      throw firstErr;
    }
  }
  const t = (j.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('');
  if (!t) throw new Error('Risposta vuota');
  return t;
}

async function pickGroqModel(key, vision, bad) {
  const r = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${key}` } });
  if (!r.ok) return null;
  const ids = ((await r.json()).data || []).map((x) => x.id).filter((id) => id !== bad && !/whisper|tts|guard|playai|orpheus|prompt/i.test(id));
  const pick = (re) => ids.find((id) => re.test(id));
  return vision
    ? pick(/llama-4-maverick/) || pick(/llama-4-scout/) || pick(/vision/) || pick(/llama-4/) || pick(/qwen/)
    : pick(/gpt-oss-120b/) || pick(/llama-3\.3-70b/) || pick(/llama-4/) || pick(/70b|120b/) || ids[0];
}

async function pickOpenRouter(key, vision, bad) {
  try {
    const r = await fetch('https://openrouter.ai/api/v1/models', { headers: { Authorization: `Bearer ${key}` } });
    if (!r.ok) return null;
    const ms = ((await r.json()).data || []).filter((m) => m.id !== bad && /:free$/.test(m.id) && (m.pricing ? Number(m.pricing.prompt) === 0 : true));
    const img = (m) => (m.architecture?.input_modalities || []).includes('image') || /vision|vl|gemma-3|llama-4|pixtral|qwen.*vl|mistral-small/i.test(m.id);
    const pool = vision ? ms.filter(img) : ms;
    const pref = [/llama-4-maverick/, /gemma-3-27b/, /llama-4-scout/, /mistral-small/, /qwen.*vl/, /gemma-3/, /gpt-oss-120b/, /llama-3\.3-70b/, /deepseek/];
    for (const re of pref) {
      const f = pool.find((m) => re.test(m.id));
      if (f) return f.id;
    }
    return pool[0]?.id || null;
  } catch {
    return null;
  }
}

const clip = (t, n) => (t.length > n ? t.slice(0, n * 0.7) + '\n[…]\n' + t.slice(-n * 0.3) : t);

async function callOpenAI(p, url, extraHeaders, { system, user, images, json }) {
  if (p.id === 'groq') {
    // i piani gratuiti hanno limiti di token al minuto: riduci il contesto
    user = clip(user, 9000);
    system = clip(system, 3000);
    if (images && images.length) {
      const m = await pickGroqModel(p.key, true, '');
      if (!m) throw new Error('nessun modello con visione disponibile');
      p = { ...p, model: m };
    }
  }
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
  let j;
  try {
    j = await post(url, { Authorization: `Bearer ${p.key}`, ...extraHeaders }, body);
  } catch (e) {
    // modello ritirato o non disponibile: scegli automaticamente uno valido dall'elenco del provider
    if (!['groq', 'openrouter'].includes(p.id) || ![400, 404, 429].includes(e.status)) throw e;
    const vis = !!(images && images.length);
    const m = p.id === 'groq' ? await pickGroqModel(p.key, vis, p.model) : await pickOpenRouter(p.key, vis, p.model);
    if (!m) throw e;
    body.model = m;
    j = await post(url, { Authorization: `Bearer ${p.key}`, ...extraHeaders }, body);
  }
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
  const errs = [];
  for (const p of order) {
    try {
      let text;
      if (p.id === 'gemini') text = await callGemini(p, opts);
      else if (p.id === 'openrouter') text = await callOpenAI(p, 'https://openrouter.ai/api/v1/chat/completions', { 'HTTP-Referer': 'https://footprint.app', 'X-Title': 'Footprint' }, opts);
      else text = await callOpenAI(p, 'https://api.groq.com/openai/v1/chat/completions', {}, opts);
      return { text, provider: p.name };
    } catch (e) {
      lastErr = e;
      errs.push(`${p.name}: ${String(e.message).slice(0, 90)}`);
      console.warn('AI provider fallito', p.id, e.message);
    }
  }
  const out = new Error(errs.length ? errs.join(' | ') : 'AI non disponibile');
  out.status = lastErr && lastErr.status;
  throw out;
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

// Prova rapida di ogni provider configurato (per la diagnosi in Impostazioni)
export async function testProviders() {
  const out = [];
  for (const p of providers()) {
    try {
      const opts = { system: 'Rispondi solo: ok', user: 'ping' };
      if (p.id === 'gemini') await callGemini(p, opts);
      else if (p.id === 'openrouter') await callOpenAI(p, 'https://openrouter.ai/api/v1/chat/completions', { 'HTTP-Referer': 'https://footprint.app', 'X-Title': 'Footprint' }, opts);
      else await callOpenAI(p, 'https://api.groq.com/openai/v1/chat/completions', {}, opts);
      out.push({ name: p.name, ok: true, msg: 'funziona' });
    } catch (e) {
      out.push({ name: p.name, ok: false, msg: String(e.message).replace(/\s+/g, ' ').slice(0, 140) });
    }
  }
  return out;
}

export function aiErrorMessage(e) {
  const m = String(e && e.message);
  if (m === 'NO_KEY') return 'Nessuna chiave AI configurata. Inseriscila in Impostazioni → Intelligenza artificiale.';
  if (m === 'AUDIO_NEEDS_GEMINI') return 'Il riconoscimento dei suoni richiede una chiave Gemini (Impostazioni).';
  if (/^(Gemini|OpenRouter|Groq):/.test(m)) return 'AI non disponibile. ' + m.slice(0, 260);
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
