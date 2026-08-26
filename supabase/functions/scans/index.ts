// POST /scans — ein Bündel Scans einreichen, bis zu 50 auf einmal.
//
// Idempotent über die geräteseitig erzeugte scan_id: bricht die Verbindung
// nach dem Schreiben, aber vor der Antwort ab, wird der zweite Versuch nicht
// doppelt gebucht, sondern beantwortet wie der erste.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { CORS, json, requireDevice } from "../_shared/token.ts";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const MAX_BATCH = 50;

interface Scan {
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

  const device = await requireDevice(req);
  if (!device) return json({ error: "Anmeldung abgelaufen" }, 401);

  const { data: row } = await db.from("devices")
    .select("revoked_at").eq("device_id", device.deviceId).single();
  if (row?.revoked_at) return json({ error: "Gerät gesperrt" }, 403);

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
      const { data } = await db.rpc("undo_redemption", {
        p_code: scan.code, p_device_id: device.deviceId,
        p_scan_id: scan.scanId, p_reason: scan.reason ?? null,
      });
      results.push({ scanId: scan.scanId, code: scan.code, result: data ? "ok" : "unknown" });
      continue;
    }

    const { data, error } = await db.rpc("redeem_ticket", {
      p_code: scan.code, p_device_id: device.deviceId,
      p_scan_id: scan.scanId, p_client_ts: scan.clientTs,
      p_offline: scan.offline ?? false,
    });
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
