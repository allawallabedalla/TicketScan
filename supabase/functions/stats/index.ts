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
    db.from("scan_log").select("device_id, client_ts, result")
      .eq("offline", true).eq("action", "redeem").in("result", ["ok", "conflict"])
      .order("client_ts", { ascending: false }).limit(2000),
    db.from("wristband_counts").select("counted, noted_at, device_id")
      .order("noted_at", { ascending: false }).limit(500),
  ]);

  // Ungeprüfte Zeiträume: je Gerät, nach der Uhrzeit AUF dem Gerät.
  //
  // Vorher zählte server_ts — der Zeitpunkt, an dem die Scans nach der
  // Funklücke ankamen. Ein Gerät, das von 20:40 bis 21:14 im Funkloch stand,
  // erschien als „21:14–21:14, 37 eingelöst". Dazu waren alle Geräte
  // vermischt, und abgewiesene Duplikate zählten als Einlösung.
  // Aufeinanderfolgende Scans eines Geräts, die weniger als fünf Minuten
  // auseinanderliegen, gehören zum selben Ausfall.
  const windows: Array<{ geraet: string; von: string; bis: string; anzahl: number; doppelt: number }> = [];
  const zeilen = [...(offline.data ?? [])]
    .sort((a, b) => a.device_id.localeCompare(b.device_id) || a.client_ts.localeCompare(b.client_ts));
  for (const r of zeilen) {
    const last = windows.at(-1);
    if (last && last.geraet === r.device_id && Date.parse(r.client_ts) - Date.parse(last.bis) < 5 * 60_000) {
      last.bis = r.client_ts;
    } else {
      windows.push({ geraet: r.device_id, von: r.client_ts, bis: r.client_ts, anzahl: 0, doppelt: 0 });
    }
    const w = windows.at(-1)!;
    if (r.result === "conflict") w.doppelt++;
    else w.anzahl++;
  }
  windows.sort((a, b) => b.bis.localeCompare(a.bis));

  // Bändchen: der jüngste Stand JE GERÄT, aufsummiert.
  //
  // Vorher galt die global letzte Meldung. Meldete Nord 800 und danach Süd
  // 600, stand in der Übersicht „600 Bändchen gegen 1400 Einlösungen — 800
  // nicht erfasst": ein Fehlalarm, der den Zähler wertlos macht. Wer den
  // Gesamtstand von einem einzigen Gerät meldet, bekommt dasselbe Ergebnis
  // wie vorher.
  const jeGeraet = new Map<string, { counted: number; noted_at: string; device_id: string }>();
  for (const b of bands.data ?? []) {
    if (!jeGeraet.has(b.device_id)) jeGeraet.set(b.device_id, b);
  }
  const meldungen = [...jeGeraet.values()];
  const handedOut = meldungen.length ? meldungen.reduce((n, b) => n + b.counted, 0) : null;

  return json({
    eingeloest: redeemed.count ?? 0,
    gesamt: total.count ?? 0,
    geraete: devices.data ?? [],
    konflikte: conflicts.data ?? [],
    // Die Liste ist auf 25 gekappt. Ohne die Gesamtzahl daneben stünde in der
    // Übersicht bei 200 Konflikten die Zahl 25 — als Tatsachenaussage.
    konflikteGesamt: conflicts.count ?? (conflicts.data ?? []).length,
    ungeprueft: windows.slice(0, 10),
    baendchen: handedOut,
    // Welche Meldungen in die Summe eingehen, mit Zeitpunkt. Eine alte
    // Meldung gegen die laufende Einlösungszahl ergibt eine wachsende
    // Abweichung — das muss sichtbar sein, sonst hält man es für einen Fehler.
    baendchenMeldungen: meldungen,
    // Der eigentliche Zweck der Gegenrechnung.
    abweichung: handedOut === null ? null : handedOut - (redeemed.count ?? 0),
    serverTime: new Date().toISOString(),
  });
});
