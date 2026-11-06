// Edge Function "telegram-bot" (unica per tutti gli utenti). Verify JWT: OFF.
// Secrets: BOT_TOKEN, WEBHOOK_SECRET
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const TOKEN = Deno.env.get("BOT_TOKEN")!;
const SECRET = Deno.env.get("WEBHOOK_SECRET") || "";
const api = (m: string, body: unknown) =>
  fetch(`https://api.telegram.org/bot${TOKEN}/${m}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const say = (chat_id: string, text: string) => api("sendMessage", { chat_id, text, disable_web_page_preview: true });
const norm = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

Deno.serve(async (req) => {
  if (SECRET && req.headers.get("x-telegram-bot-api-secret-token") !== SECRET) return new Response("no", { status: 401 });
  try {
    const u = await req.json();
    const m = u.message;
    if (!m || !m.text) return new Response("ok");
    const chat = String(m.chat.id);
    const raw: string = m.text.trim();

    // Collegamento tramite invito: /start CODICE
    if (raw.startsWith("/start")) {
      const code = raw.split(/\s+/)[1];
      if (!code) { await say(chat, "Ciao! Chiedi a chi usa Footprint di inviarti un invito dall'app (Impostazioni, Condividi posizione dell'auto)."); return new Response("ok"); }
      const { data: inv } = await sb.from("parking_invites").select("user_id,created_at").eq("code", code).maybeSingle();
      if (!inv || Date.now() - new Date(inv.created_at).getTime() > 7 * 864e5) { await say(chat, "Invito non valido o scaduto. Chiedine uno nuovo."); return new Response("ok"); }
      await sb.from("parking_contacts").upsert({ user_id: inv.user_id, chat_id: chat, name: m.from?.first_name || null }, { onConflict: "user_id,chat_id" });
      await sb.from("parking_invites").delete().eq("code", code);
      const { data: ps } = await sb.from("parking_share").select("display_name").eq("user_id", inv.user_id).maybeSingle();
      const n = ps?.display_name || "chi ti ha invitato";
      await say(chat, `Collegato! Scrivi "dove è ${n}?" per sapere dove ha parcheggiato l'auto. /stop per scollegarti.`);
      return new Response("ok");
    }

    if (raw.startsWith("/stop")) {
      await sb.from("parking_contacts").delete().eq("chat_id", chat);
      await say(chat, "Scollegato da tutti.");
      return new Response("ok");
    }

    // Contatti collegati a questa chat
    const { data: links } = await sb.from("parking_contacts").select("user_id").eq("chat_id", chat);
    if (!links || !links.length) return new Response("ok"); // sconosciuti: nessuna risposta
    const ids = links.map((l) => l.user_id);
    const { data: owners } = await sb.from("parking_share").select("user_id,display_name,lat,lon,ts").in("user_id", ids);
    if (!owners || !owners.length) { await say(chat, "Nessuna posizione dell'auto disponibile."); return new Response("ok"); }

    const t = norm(raw);
    if (!/\b(dove|posizione|auto|parcheggi\w*)\b/.test(t)) return new Response("ok");
    let pick = owners.filter((o) => o.display_name && t.includes(norm(o.display_name)));
    if (!pick.length) pick = owners.length === 1 ? owners : [];
    if (!pick.length) { await say(chat, "Di chi? " + owners.map((o) => o.display_name || "?").join(", ")); return new Response("ok"); }
    for (const o of pick) {
      const when = new Date(Number(o.ts)).toLocaleString("it-IT", { timeZone: "Europe/Rome" });
      await say(chat, `🚗 Auto di ${o.display_name || "?"}, parcheggiata il ${when}\nhttps://maps.google.com/?q=${o.lat},${o.lon}`);
      await api("sendLocation", { chat_id: chat, latitude: o.lat, longitude: o.lon });
    }
  } catch (_) { /* ignora */ }
  return new Response("ok");
});
