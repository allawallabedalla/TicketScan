// POST /session — Gerät anmelden.
//
// Das Eventpasswort wird ausschließlich hier geprüft, nie im Browser: das
// ausgelieferte Bundle kann jeder lesen, ein Hashwert darin ebenso.
// Abgefragt wird einmal je Gerät und Festivaltag, nie beim Scannen.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { CORS, issue, json, nextRollover, timingSafeEqual } from "../_shared/token.ts";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const ROLLOVER_HOUR = Number(Deno.env.get("TICKETSCAN_SESSION_ROLLOVER_HOUR") ?? "6");

// Eine gemeinsame Losung wird nicht erraten, sie wird weitergegeben — die
// Protokollierung unten wiegt schwerer als diese Bremse.
const MAX_ATTEMPTS = 10;
const WINDOW_MINUTES = 15;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Nur POST" }, 405);

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unbekannt";

  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();
  const { count } = await db.from("session_log")
    .select("id", { count: "exact", head: true })
    .eq("remote_ip", ip).eq("succeeded", false).gte("created_at", since);

  if ((count ?? 0) >= MAX_ATTEMPTS) {
    return json({ error: "Zu viele Versuche. Bitte in einer Viertelstunde erneut." }, 429);
  }

  let password = "", label = "", deviceId: string | null = null;
  try {
    ({ password = "", label = "", deviceId = null } = await req.json());
  } catch {
    return json({ error: "Ungültige Anfrage" }, 400);
  }

  const expected = Deno.env.get("TICKETSCAN_EVENT_PASSWORD") ?? "";
  if (!expected || !timingSafeEqual(password, expected)) {
    await db.from("session_log").insert({ label, succeeded: false, remote_ip: ip });
    return json({ error: "Passwort stimmt nicht" }, 401);
  }

  if (!label.trim()) return json({ error: "Bitte einen Gerätenamen angeben" }, 400);

  const expiresAt = nextRollover(ROLLOVER_HOUR);
  const expiresIso = new Date(expiresAt * 1000).toISOString();

  // Ein Gerät, das sich am nächsten Morgen erneut anmeldet, behält seine
  // Kennung — damit bleibt sein Protokoll über alle Festivaltage zusammen.
  let device;
  if (deviceId) {
    const { data } = await db.from("devices")
      .update({ label, session_expires_at: expiresIso, last_seen_at: new Date().toISOString() })
      .eq("device_id", deviceId).is("revoked_at", null).select().single();
    device = data;
  }
  if (!device) {
    const { data, error } = await db.from("devices")
      .insert({ label, session_expires_at: expiresIso }).select().single();
    if (error) return json({ error: "Gerät konnte nicht angelegt werden" }, 500);
    device = data;
  }

  await db.from("session_log")
    .insert({ device_id: device.device_id, label, succeeded: true, remote_ip: ip });

  const token = await issue(
    { deviceId: device.device_id, label, expiresAt },
    Deno.env.get("TICKETSCAN_TOKEN_SECRET")!,
  );

  return json({ token, deviceId: device.device_id, label, expiresAt });
});
