// GET /changes?since=<ISO> — Auffangnetz neben dem Realtime-Push.
//
// Läuft alle 20 Sekunden und nach jeder Netzwiederkehr. Ohne `since` liefert
// der Endpunkt den vollständigen Grundbestand für ein frisch eingerichtetes
// Gerät.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { CORS, json, requireDevice } from "../_shared/token.ts";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const PAGE = 5000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const device = await requireDevice(req);
  if (!device) return json({ error: "Anmeldung abgelaufen" }, 401);

  const since = new URL(req.url).searchParams.get("since");

  let query = db.from("tickets")
    .select("code, category, note, redeemed_at, redeemed_by_device, updated_at")
    .order("updated_at", { ascending: true })
    .limit(PAGE);

  if (since) query = query.gt("updated_at", since);

  const { data, error } = await query;
  if (error) return json({ error: "Abgleich fehlgeschlagen" }, 500);

  const serverTime = new Date().toISOString();
  await db.from("devices")
    .update({ last_seen_at: serverTime, synced_upto: serverTime })
    .eq("device_id", device.deviceId);

  return json({
    tickets: data,
    // Mehr Zeilen vorhanden? Dann noch einmal mit diesem Zeitstempel nachladen.
    more: data.length === PAGE,
    cursor: data.at(-1)?.updated_at ?? since,
    serverTime,
  });
});
