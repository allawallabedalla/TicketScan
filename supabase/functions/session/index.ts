// POST /session — Gerät anmelden.
//
// Das Eventpasswort wird ausschließlich hier geprüft, nie im Browser: das
// ausgelieferte Bundle kann jeder lesen, ein Hashwert darin ebenso.
// Abgefragt wird einmal je Gerät und Festivaltag, nie beim Scannen.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { CORS, issue, json, nextRollover, timingSafeEqual, tokenSecret } from "../_shared/token.ts";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const ROLLOVER_HOUR = Number(Deno.env.get("TICKETSCAN_SESSION_ROLLOVER_HOUR") ?? "6");

// Eine gemeinsame Losung wird nicht erraten, sie wird weitergegeben — die
// Protokollierung unten wiegt schwerer als diese Bremse.
const MAX_ATTEMPTS = 10;
const WINDOW_MINUTES = 15;
// Zusätzlich eine Bremse über alle Adressen hinweg. Die Zählung je Adresse
// lässt sich durch Streuen des Headers umgehen; diese hier nicht. Sie liegt
// so hoch, dass zehn Geräte am Morgen nie in ihre Nähe kommen.
const MAX_ATTEMPTS_TOTAL = 60;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Nur POST" }, 405);

  // Der LETZTE Eintrag der Kette, nicht der erste.
  //
  // Proxys hängen an: Was der Aufrufer selbst mitschickt, steht vorn, die
  // tatsächlich beobachtete Gegenstelle hinten. Mit `[0]` griff die Zählung
  // genau den Wert ab, den der Aufrufer frei bestimmen konnte — ein zufälliger
  // Header je Versuch, und die Bremse fand nie mehr als einen Treffer. Damit
  // war das Passwort unbegrenzt durchprobierbar, und `remote_ip` im Protokoll
  // war frei erfunden.
  const chain = req.headers.get("x-forwarded-for")?.split(",").map((v) => v.trim())
    .filter(Boolean) ?? [];
  const ip = req.headers.get("cf-connecting-ip")?.trim() || chain.at(-1) || "unbekannt";

  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();
  const [{ count }, { count: total }] = await Promise.all([
    db.from("session_log").select("id", { count: "exact", head: true })
      .eq("remote_ip", ip).eq("succeeded", false).gte("created_at", since),
    db.from("session_log").select("id", { count: "exact", head: true })
      .eq("succeeded", false).gte("created_at", since),
  ]);

  if ((count ?? 0) >= MAX_ATTEMPTS || (total ?? 0) >= MAX_ATTEMPTS_TOTAL) {
    return json({ error: "Zu viele Versuche. Bitte in einer Viertelstunde erneut." }, 429);
  }

  let password = "", label = "", deviceId: string | null = null;
  try {
    ({ password = "", label = "", deviceId = null } = await req.json());
  } catch {
    return json({ error: "Ungültige Anfrage" }, 400);
  }

  const secret = tokenSecret();
  if (!secret) {
    // Geschlossen scheitern. Mit leerem Geheimnis könnte jeder sich selbst ein
    // gültiges Token signieren.
    console.error("TICKETSCAN_TOKEN_SECRET fehlt oder ist zu kurz");
    return json({ error: "Server nicht eingerichtet" }, 500);
  }

  const expected = Deno.env.get("TICKETSCAN_EVENT_PASSWORD") ?? "";
  if (!expected || !timingSafeEqual(password, expected)) {
    const { error } = await db.from("session_log")
      .insert({ label, succeeded: false, remote_ip: ip });
    // Der Fehlversuch ist die Grundlage der Ratenbegrenzung. Wird er nicht
    // geschrieben, zählt nichts mehr — das muss wenigstens im Log stehen.
    if (error) console.error("Fehlversuch nicht protokolliert:", error.message);
    return json({ error: "Passwort stimmt nicht" }, 401);
  }

  if (!label.trim()) return json({ error: "Bitte einen Gerätenamen angeben" }, 400);

  const expiresAt = nextRollover(ROLLOVER_HOUR);
  const expiresIso = new Date(expiresAt * 1000).toISOString();

  // Ein Gerät, das sich am nächsten Morgen erneut anmeldet, behält seine
  // Kennung — damit bleibt sein Protokoll über alle Festivaltage zusammen.
  let device;
  if (deviceId) {
    // Erst nachsehen, ob die Kennung gesperrt ist.
    //
    // Vorher fiel der Code bei einer gesperrten Kennung einfach in den
    // Insert-Zweig durch und legte ein frisches, ungesperrtes Gerät an. Damit
    // sperrte revoked_at eine Kennung, nicht ein Gerät — ein verlorenes
    // Telefon meldete sich beim nächsten Versuch schlicht neu an.
    const { data: known } = await db.from("devices")
      .select("device_id, revoked_at").eq("device_id", deviceId).maybeSingle();

    if (known?.revoked_at) {
      await db.from("session_log").insert({ label, succeeded: false, remote_ip: ip });
      return json({ error: "Dieses Gerät ist gesperrt. Bitte an die Einlassleitung." }, 403);
    }

    if (known) {
      const { data } = await db.from("devices")
        .update({ label, session_expires_at: expiresIso, last_seen_at: new Date().toISOString() })
        .eq("device_id", deviceId).is("revoked_at", null).select().single();
      device = data;
    }
  }
  if (!device) {
    const { data, error } = await db.from("devices")
      .insert({ label, session_expires_at: expiresIso }).select().single();
    if (error) return json({ error: "Gerät konnte nicht angelegt werden" }, 500);
    device = data;
  }

  const { error: logError } = await db.from("session_log")
    .insert({ device_id: device.device_id, label, succeeded: true, remote_ip: ip });
  if (logError) console.error("Anmeldung nicht protokolliert:", logError.message);

  const token = await issue({ deviceId: device.device_id, label, expiresAt }, secret);

  return json({ token, deviceId: device.device_id, label, expiresAt });
});
