// GET /changes — Grundbestand holen und Änderungen nachziehen.
//
// Ohne `since` liefert der Endpunkt den vollständigen Grundbestand für ein
// frisch eingerichtetes Gerät, seitenweise. Mit `since` nur, was sich seither
// geändert hat.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { CORS, json, requireDevice } from "../_shared/token.ts";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// Supabase begrenzt die Data API auf 1000 Zeilen je Anfrage. Eine höhere
// Zahl hier wäre wirkungslos — schlimmer noch, sie würde das Ende einer
// Seite verschleiern und den Rest des Bestands still verschlucken.
const PAGE = 1000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const device = await requireDevice(req);
  if (!device) return json({ error: "Anmeldung abgelaufen" }, 401);

  const { data: row } = await db.from("devices")
    .select("revoked_at").eq("device_id", device.deviceId).single();
  if (row?.revoked_at) return json({ error: "Gerät gesperrt" }, 403);

  const params = new URL(req.url).searchParams;
  const since = params.get("since");
  const sinceCode = params.get("sinceCode");
  const offset = Math.max(0, Number(params.get("offset") ?? "0") || 0);

  const columns = "code, category, note, redeemed_at, redeemed_by_device, updated_at";
  let query = db.from("tickets").select(columns);

  if (since) {
    // Fortsetzung über (updated_at, code) statt über den Zeitstempel allein:
    // Nach einem Import tragen tausende Zeilen denselben Zeitstempel. Ein
    // Cursor nur auf updated_at würde sie entweder überspringen oder ewig
    // dieselbe Seite liefern.
    query = sinceCode
      ? query.or(`updated_at.gt.${since},and(updated_at.eq.${since},code.gt.${sinceCode})`)
      : query.gt("updated_at", since);

    query = query
      .order("updated_at", { ascending: true })
      .order("code", { ascending: true })
      .limit(PAGE);
  } else {
    // Grundbestand nach Nummer durchblättern. Der Primärschlüssel ist
    // eindeutig und stabil, damit kann keine Zeile zwischen zwei Seiten
    // verlorengehen.
    query = query.order("code", { ascending: true }).range(offset, offset + PAGE - 1);
  }

  const { data, error } = await query;
  if (error) return json({ error: "Abgleich fehlgeschlagen", detail: error.message }, 500);

  const serverTime = new Date().toISOString();
  await db.from("devices")
    .update({ last_seen_at: serverTime, synced_upto: serverTime })
    .eq("device_id", device.deviceId);

  const last = data.at(-1);

  return json({
    tickets: data,
    // Eine volle Seite heißt: es kommt noch mehr.
    more: data.length === PAGE,
    nextOffset: since ? null : offset + data.length,
    cursor: last?.updated_at ?? since,
    cursorCode: last?.code ?? sinceCode,
    serverTime,
  });
});
