// POST /verwaltung — Stammdaten der Ticketliste ändern.
//
// Der Weg für jemanden, der Namen nachträgt oder Tickets ergänzt, ohne Zugang
// zum Supabase-Dashboard und ohne Kommandozeile. Er meldet sich in derselben
// App an und gibt zusätzlich das Verwaltungspasswort ein; erst dann trägt sein
// Token das Recht, hier zu schreiben.
//
// WAS DIESER ENDPUNKT NICHT KANN, und das ist Absicht:
//
//   - `redeemed_at`, `redeemed_by_device` und `redeemed_scan_id` anfassen.
//     Das ist der Einlassstand. Wer ihn leert, macht ein benutztes Ticket
//     wieder gültig; wer ihn setzt, sperrt einen Gast aus, der noch gar nicht
//     da war. Zurückgenommen wird über den Verlauf in der App, und das
//     hinterlässt eine Spur im Protokoll — ein Feld zu überschreiben nicht.
//   - Tickets löschen. Eine Nummer, die auf einem Papierticket steht, aus der
//     Liste zu nehmen heißt, jemanden an der Tür abzuweisen. Das gehört nicht
//     hinter einen Knopf, den man versehentlich trifft.
//
// Beides bleibt dem Dashboard vorbehalten, wo es hingehört.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { CORS, json, requireActiveDevice } from "../_shared/token.ts";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

/** Je Anfrage. Bei 2305 Zeilen sind das fünf Anfragen — genug, um eine ganze
 *  Liste in einem Rutsch einzuspielen, klein genug für ein Mobilfunknetz. */
const MAX_ZEILEN = 500;

const FELDER = {
  holderName: "holder_name", category: "category", note: "note",
  // Sperrvermerk (Migration 0007): Text = gesperrt mit diesem Grund, null = frei.
  gesperrt: "gesperrt",
} as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Nur POST" }, 405);

  const check = await requireActiveDevice(req, db);
  if ("error" in check) return check.error;
  if (!check.claims.admin) {
    return json({ error: "Dieses Gerät darf die Liste nicht ändern" }, 403);
  }

  let body: { zeilen?: unknown; probe?: unknown; neuAnlegen?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Ungültige Anfrage" }, 400);
  }
  const zeilen = body.zeilen;
  if (!Array.isArray(zeilen)) return json({ error: "zeilen fehlt" }, 400);
  if (!zeilen.length) return json({ error: "Nichts zu tun" }, 400);
  if (zeilen.length > MAX_ZEILEN) {
    return json({ error: `Höchstens ${MAX_ZEILEN} Zeilen je Anfrage` }, 400);
  }

  // Nur die Felder weitergeben, die die Zeile tatsächlich trägt.
  //
  // Vorher ging jede Zeile vollständig in einen Upsert — ein fehlender Name
  // wurde zu null und überschrieb den vorhandenen. Eine Liste nur aus
  // Nummern leerte damit die Namen aller enthaltenen Tickets. Jetzt gilt:
  // fehlt ein Feld, bleibt es; ist es null, wird es geleert. Die eigentliche
  // Arbeit, samt Stellenprüfung, Dubletten, Längen und Protokoll, macht
  // stammdaten_schreiben (Migration 0006) — derselbe Weg wie das Import-Skript.
  const sauber = [];
  for (const [i, zeile] of zeilen.entries()) {
    if (!zeile || typeof zeile !== "object") {
      return json({ error: `Zeile ${i + 1}: ungültig` }, 400);
    }
    const z = zeile as Record<string, unknown>;
    if (typeof z.code !== "string" || !/^\d+$/.test(z.code.trim())) {
      return json({ error: `Zeile ${i + 1}: „${String(z.code)}" ist keine Nummer` }, 400);
    }
    const aus: Record<string, string | null> = { code: z.code.trim() };
    for (const [von, nach] of Object.entries(FELDER)) {
      if (!(von in z) || z[von] === undefined) continue;
      if (z[von] !== null && typeof z[von] !== "string") {
        return json({ error: `Zeile ${i + 1}: ${von} ist kein Text` }, 400);
      }
      aus[nach] = z[von] as string | null;
    }
    sauber.push(aus);
  }

  const { data, error } = await db.rpc("stammdaten_schreiben", {
    p_zeilen: sauber,
    p_quelle: `app:${check.claims.label}`,
    p_neu_erlaubt: body.neuAnlegen === true,
    p_probe: body.probe === true,
  });

  if (error) {
    // Eine Prüfung der Funktion (raise exception) ist ein Eingabefehler und
    // gehört wörtlich vor die Person, die die Liste pflegt. Alles andere ist
    // ein Serverfehler.
    if (error.code === "P0001") return json({ error: error.message }, 400);
    if (error.code === "PGRST202") {
      return json({ error: "Migration 0006 fehlt — bitte Backend veröffentlichen." }, 500);
    }
    return json({ error: "Nicht gespeichert", detail: error.message }, 500);
  }

  return json(data);
});
