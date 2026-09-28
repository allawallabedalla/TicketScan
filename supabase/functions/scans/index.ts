// POST /scans — ein Bündel Scans einreichen, bis zu 50 auf einmal.
//
// Idempotent über die geräteseitig erzeugte scan_id: bricht die Verbindung
// nach dem Schreiben, aber vor der Antwort ab, wird der zweite Versuch nicht
// doppelt gebucht, sondern beantwortet wie der erste.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { CORS, json, requireActiveDevice } from "../_shared/token.ts";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const MAX_BATCH = 50;

interface Scan {
  /** Bei einer Rücknahme: die scan_id der Einlösung, die gemeint ist. */
  undoOf?: string;
  scanId: string;
  code: string;
  clientTs: string;
  action?: "redeem" | "undo";
  reason?: string;
  /** Entstand der Scan ohne Verbindung? Dann war er im Moment der
   *  Entscheidung nicht gegen die anderen Geräte prüfbar. */
  offline?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Nur POST" }, 405);

  const check = await requireActiveDevice(req, db);
  if ("error" in check) return check.error;
  const device = check.claims;

  let scans: Scan[];
  try {
    ({ scans } = await req.json());
  } catch {
    return json({ error: "Ungültige Anfrage" }, 400);
  }
  if (!Array.isArray(scans)) return json({ error: "scans fehlt" }, 400);
  if (scans.length > MAX_BATCH) return json({ error: `Höchstens ${MAX_BATCH} Scans` }, 400);

  const results = [];
  for (const scan of scans) {
    if (scan.action === "undo") {
      // Der Fehler wurde hier weggeworfen: Scheiterte die RPC, war `data`
      // undefined und die Antwort lautete "unknown" — der Client nahm den
      // Eintrag daraufhin aus der Warteschlange, und die Rücknahme war
      // verworfen, ohne je ausgeführt worden zu sein.
      const undoArgs = {
        p_code: scan.code, p_device_id: device.deviceId,
        p_scan_id: scan.scanId, p_reason: scan.reason ?? null,
        p_client_ts: scan.clientTs, p_offline: scan.offline ?? false,
        // Welche Einlösung gemeint ist. Fehlt der Wert, nimmt die Funktion
        // zurück, was gerade eingelöst ist — das ist der Fall „Trotzdem
        // einlassen", bei dem jemand bewusst eine fremde Einlösung freigibt.
        p_undo_of: scan.undoOf ?? null,
      };
      let { data, error } = await db.rpc("undo_redemption", undoArgs);
      // Einmal wiederholen: Lief dieselbe scanId gerade noch in einer
      // abgebrochenen Anfrage des Geräts, scheitert der Protokolleintrag am
      // Primärschlüssel. Der zweite Aufruf findet ihn und wiederholt die
      // damalige Antwort.
      if (error) ({ data, error } = await db.rpc("undo_redemption", undoArgs));
      if (error || typeof data !== "string") {
        results.push({ scanId: scan.scanId, code: scan.code, result: "error" });
        continue;
      }

      // Den tatsächlichen Stand mitschicken. Ohne ihn setzte das Gerät das
      // Ticket nach JEDER Rücknahme auf frei — auch nach einer abgelehnten
      // („unknown": inzwischen fremd eingelöst). Weil der Server die Zeile
      // dann nicht anfasst, lieferte auch der Abgleich sie nie nach, und das
      // Ticket blieb auf diesem Gerät dauerhaft frei.
      const { data: stand, error: standFehler } = await db.from("tickets")
        .select("redeemed_at, redeemed_by_device").eq("code", scan.code).maybeSingle();
      results.push({
        scanId: scan.scanId, code: scan.code, result: data,
        ...(standFehler ? {} : {
          redeemed_at: stand?.redeemed_at ?? null,
          redeemed_by_device: stand?.redeemed_by_device ?? null,
        }),
      });
      continue;
    }

    const redeemArgs = {
      p_code: scan.code, p_device_id: device.deviceId,
      p_scan_id: scan.scanId, p_client_ts: scan.clientTs,
      p_offline: scan.offline ?? false,
    };
    let { data, error } = await db.rpc("redeem_ticket", redeemArgs);
    // Siehe oben: gleichzeitige Doppelzustellung derselben scanId.
    if (error) ({ data, error } = await db.rpc("redeem_ticket", redeemArgs));
    // Nicht abbrechen: der Rest des Bündels soll trotzdem durchlaufen, und das
    // Gerät sendet die gescheiterten Scans beim nächsten Mal erneut.
    if (error || !data?.[0]) {
      results.push({ scanId: scan.scanId, code: scan.code, result: "error" });
      continue;
    }
    results.push({ scanId: scan.scanId, ...data[0] });
  }

  await db.from("devices")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("device_id", device.deviceId);

  return json({ results, serverTime: new Date().toISOString() });
});
