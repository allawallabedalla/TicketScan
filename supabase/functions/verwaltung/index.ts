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

interface Zeile {
  code?: unknown;
  holderName?: unknown;
  category?: unknown;
  note?: unknown;
}

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Nur POST" }, 405);

  const check = await requireActiveDevice(req, db);
  if ("error" in check) return check.error;
  if (!check.claims.admin) {
    return json({ error: "Dieses Gerät darf die Liste nicht ändern" }, 403);
  }

  let zeilen: Zeile[];
  try {
    ({ zeilen } = await req.json());
  } catch {
    return json({ error: "Ungültige Anfrage" }, 400);
  }
  if (!Array.isArray(zeilen)) return json({ error: "zeilen fehlt" }, 400);
  if (!zeilen.length) return json({ error: "Nichts zu tun" }, 400);
  if (zeilen.length > MAX_ZEILEN) {
    return json({ error: `Höchstens ${MAX_ZEILEN} Zeilen je Anfrage` }, 400);
  }

  // Die vorhandenen Nummern holen, um Stellenzahl und Bestand zu prüfen.
  // Ohne das könnte ein Tippfehler eine vierstellige Nummer anlegen — und die
  // App leitet aus der Liste ab, wie viele Stellen einzutippen sind.
  const { data: vorhanden, error: leseFehler } = await db
    .from("tickets").select("code").order("code").limit(1);
  if (leseFehler) return json({ error: "Liste nicht lesbar" }, 500);
  const stellen = vorhanden?.[0]?.code.length ?? 5;

  const sauber = [];
  for (const [i, zeile] of zeilen.entries()) {
    const code = text(zeile.code, 32);
    if (!code || !/^\d+$/.test(code)) {
      return json({ error: `Zeile ${i + 1}: „${String(zeile.code)}" ist keine Nummer` }, 400);
    }
    if (code.length !== stellen) {
      return json({
        error: `Zeile ${i + 1}: „${code}" hat ${code.length} statt ${stellen} Stellen. ` +
          "Führende Nullen im Export verloren?",
      }, 400);
    }
    sauber.push({
      code,
      holder_name: text(zeile.holderName, 120),
      category: text(zeile.category, 60) ?? "Festival-Ticket",
      note: text(zeile.note, 300),
    });
  }

  // merge-duplicates schreibt genau die Spalten des Payloads. redeemed_at
  // steht nicht darin und bleibt deshalb unangetastet — auch bei einem Ticket,
  // das gerade eingelöst wurde.
  const { error } = await db.from("tickets")
    .upsert(sauber, { onConflict: "code" });
  if (error) return json({ error: "Nicht gespeichert", detail: error.message }, 500);

  return json({ ok: true, geschrieben: sauber.length });
});
