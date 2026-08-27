// GET  /stats — Kennzahlen für die Einlassleitung.
// POST /stats — Stand der ausgegebenen Bändchen eintragen.
//
// Der Bändchenabgleich ist der zweite, körperliche Zähler neben dem digitalen:
// Was ausgegeben wurde, muss zu dem passen, was das System zählt. Läuft es
// auseinander, ist etwas im Argen — ein stummes Gerät, ein nicht erfasster
// Einlass, eine Fehlbedienung — und zwar bevor es an der Tür auffällt.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { CORS, json, requireActiveDevice } from "../_shared/token.ts";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const check = await requireActiveDevice(req, db);
  if ("error" in check) return check.error;
  const device = check.claims;

  if (req.method === "POST") {
    let counted = 0, note = "";
    try {
      ({ counted = 0, note = "" } = await req.json());
    } catch {
      return json({ error: "Ungültige Anfrage" }, 400);
    }
    if (!Number.isInteger(counted) || counted < 0) {
      return json({ error: "Bitte eine Anzahl angeben" }, 400);
    }

    // Das Ergebnis ansehen, bevor Erfolg gemeldet wird: Der Fremdschlüssel auf
    // devices kann verletzt sein, etwa wenn ein noch gültiges Token auf eine
    // aufgeräumte Kennung zeigt. Eine Schicht, die eine Bestätigung bekommt,
    // deren Zahl nirgends steht, merkt es erst am falschen Alarm.
    const { error } = await db.from("wristband_counts").insert({
      device_id: device.deviceId, counted, note: note || null,
    });
    if (error) return json({ error: "Bändchenstand nicht gespeichert" }, 500);
    return json({ ok: true });
  }

  const [redeemed, total, devices, conflicts, offline, bands] = await Promise.all([
    db.from("tickets").select("code", { count: "exact", head: true })
      .not("redeemed_at", "is", null),
    db.from("tickets").select("code", { count: "exact", head: true }),
    db.from("devices").select("device_id, label, last_seen_at, revoked_at")
      .order("last_seen_at", { ascending: false }),
    db.from("scan_log").select("code, device_id, server_ts", { count: "exact" })
      .eq("result", "conflict").order("server_ts", { ascending: false }).limit(25),
    db.from("scan_log").select("code, device_id, server_ts")
      .eq("offline", true).eq("action", "redeem")
      .order("server_ts", { ascending: false }).limit(500),
    db.from("wristband_counts").select("counted, noted_at, device_id")
      .order("noted_at", { ascending: false }).limit(20),
  ]);

  // Ungeprüfte Zeiträume: aufeinanderfolgende Scans ohne Abgleich, die weniger
  // als fünf Minuten auseinanderliegen, gehören zum selben Ausfall.
  const windows: Array<{ von: string; bis: string; anzahl: number }> = [];
  const stamps = (offline.data ?? []).map((r) => r.server_ts).sort();
  for (const at of stamps) {
    const last = windows.at(-1);
    if (last && Date.parse(at) - Date.parse(last.bis) < 5 * 60_000) {
      last.bis = at;
      last.anzahl++;
    } else {
      windows.push({ von: at, bis: at, anzahl: 1 });
    }
  }

  const handedOut = bands.data?.[0]?.counted ?? null;

  return json({
    eingeloest: redeemed.count ?? 0,
    gesamt: total.count ?? 0,
    geraete: devices.data ?? [],
    konflikte: conflicts.data ?? [],
    // Die Liste ist auf 25 gekappt. Ohne die Gesamtzahl daneben stünde in der
    // Übersicht bei 200 Konflikten die Zahl 25 — als Tatsachenaussage.
    konflikteGesamt: conflicts.count ?? (conflicts.data ?? []).length,
    ungeprueft: windows.slice(-10).reverse(),
    baendchen: handedOut,
    // Der eigentliche Zweck der Gegenrechnung.
    abweichung: handedOut === null ? null : handedOut - (redeemed.count ?? 0),
    serverTime: new Date().toISOString(),
  });
});
