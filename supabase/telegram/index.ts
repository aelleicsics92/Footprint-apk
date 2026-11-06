// Edge Function "telegram-bot": risponde a "dove è Ale?" con la posizione dell'auto. Nessun JWT (è il webhook di Telegram).
// Secrets da impostare: BOT_TOKEN, OWNER_UID (tuo User UID), ALLOWED_IDS (chat id autorizzati separati da virgola), WEBHOOK_SECRET (testo a piacere)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const TOKEN = Deno.env.get("BOT_TOKEN")!;
const OWNER = Deno.env.get("OWNER_UID")!;
const ALLOWED = (Deno.env.get("ALLOWED_IDS") || "").split(",").map((x) => x.trim()).filter(Boolean);
const SECRET = Deno.env.get("WEBHOOK_SECRET") || "";
const api = (m: string, body: unknown) =>
  fetch(`https://api.telegram.org/bot${TOKEN}/${m}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

Deno.serve(async (req) => {
  if (SECRET && req.headers.get("x-telegram-bot-api-secret-token") !== SECRET) return new Response("no", { status: 401 });
  try {
    const u = await req.json();
    const m = u.message;
    if (!m || !m.text) return new Response("ok");
    const id = String(m.chat.id);
    const text = m.text.toLowerCase();
    if (text.startsWith("/start") || text.startsWith("/id")) {
      await api("sendMessage", { chat_id: id, text: `Il tuo ID Telegram è ${id}` });
      return new Response("ok");
    }
    if (!ALLOWED.includes(id)) return new Response("ok"); // sconosciuti: nessuna risposta
    if (/dove|ale|auto|parcheggi|posizione/.test(text)) {
      const { data } = await sb.from("parking_share").select("lat,lon,name,ts").eq("user_id", OWNER).maybeSingle();
      if (!data) {
        await api("sendMessage", { chat_id: id, text: "Nessuna posizione dell'auto disponibile." });
      } else {
        const when = new Date(Number(data.ts)).toLocaleString("it-IT", { timeZone: "Europe/Rome" });
        await api("sendMessage", { chat_id: id, text: `🚗 Auto di Ale parcheggiata il ${when}\nhttps://maps.google.com/?q=${data.lat},${data.lon}` });
        await api("sendLocation", { chat_id: id, latitude: data.lat, longitude: data.lon });
      }
    }
  } catch (_) { /* ignora */ }
  return new Response("ok");
});
