// GET /changes — Grundbestand holen und Änderungen nachziehen.
//
// Ohne `since` liefert der Endpunkt den vollständigen Grundbestand für ein
// frisch eingerichtetes Gerät, seitenweise. Mit `since` nur, was sich seither
// geändert hat.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { CORS, json, requireActiveDevice } from "../_shared/token.ts";

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

  const check = await requireActiveDevice(req, db);
  if ("error" in check) return check.error;
  const device = check.claims;

  const params = new URL(req.url).searchParams;
  // Beide gehen ungeprüft in einen PostgREST-Filterausdruck. Ein sinceCode mit
  // Klammer oder Komma schlösse die and(...)-Gruppe vorzeitig.
  // Prüfen, aber NICHT umformen.
  //
  // Hier stand `new Date(rawSince).toISOString()`. Das hat Millisekunden-
  // auflösung, Postgres hat Mikrosekunden — der Zeiger wanderte damit bei
  // jeder Antwort ein Stück zurück. Bei tausend Zeilen mit demselben
  // Zeitstempel (nach jedem Import, nach jedem Zurücksetzen) lieferte der
  // Endpunkt danach ewig dieselbe Seite, und der Abgleich des Geräts kam nie
  // wieder zurück. Ein Zurückschneiden ist hier nie harmlos.
  const rawSince = params.get("since");
  const since = rawSince && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:?\d{2})?$/.test(rawSince)
    ? rawSince
    : null;
  const rawSinceCode = params.get("sinceCode");
  const sinceCode = rawSinceCode && /^\d{1,10}$/.test(rawSinceCode) ? rawSinceCode : null;
  const offset = Math.max(0, Number(params.get("offset") ?? "0") || 0);

  // Der Zeitstempel entsteht VOR der Abfrage, nicht danach.
  //
  // Das war die gefährlichste Stelle im ganzen Backend. now() ist in Postgres
  // der Transaktionsbeginn, nicht der Commit — eine Einlösung, die um
  // 20:14:03,100 beginnt und um 20:14:03,200 committet, trägt updated_at
  // 20:14:03,100 und wird von einer Abfrage um 20:14:03,150 noch nicht
  // gesehen. Stand der zurückgegebene Zeitstempel danach (20:14:03,250),
  // fragte das Gerät ab da nach updated_at > 20:14:03,250 — und bekam diese
  // Zeile nie wieder. Dieses eine Ticket galt dort dauerhaft als frei.
  //
  // Der Sicherheitsabstand von 60 Sekunden deckt zusätzlich Uhrenversatz
  // zwischen Edge-Laufzeit und Datenbank ab. Doppelt gelieferte Zeilen kosten
  // nichts, putTickets schreibt idempotent. Eine verlorene kostet einen
  // Doppeleinlass.
  const serverTime = new Date(Date.now() - 60_000).toISOString();

  const columns =
    "code, holder_name, category, note, redeemed_at, redeemed_by_device, updated_at";
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

  // last_seen_at bekommt die echte Zeit, nicht den zurückdatierten Zeiger:
  // Sonst erschiene in der Übersicht jedes Gerät eine Minute älter, als es
  // ist — bei der Frage „welches Gerät ist stumm?" eine Minute falsche
  // Auskunft. Der Sicherheitsabstand gehört allein zu synced_upto.
  await db.from("devices")
    .update({ last_seen_at: new Date().toISOString(), synced_upto: serverTime })
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
