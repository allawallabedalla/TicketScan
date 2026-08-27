#!/usr/bin/env node
// Prüft die komplette Kette in einem Durchlauf: Sind die Endpunkte da, ist
// das Passwort gesetzt, steht das Schema, liegen Tickets in der Datenbank?
//
// Gedacht für direkt nach der Einrichtung — und noch einmal am Vorabend des
// Festivals.
//
// ACHTUNG: Abschnitt 6 bucht tatsächlich. Er löst die höchste Nummer des
// Bereichs ein, prüft die Doppelerkennung und nimmt sie wieder zurück — in
// einem finally, damit die Rücknahme auch nach einem Abbruch läuft. Der Kopf
// behauptete früher „Bucht nichts und ändert nichts"; das stimmte seit
// Abschnitt 6 nicht mehr, und ein Abbruch dazwischen hätte ein echtes Ticket
// als eingelöst stehen lassen.
//
//   TICKETSCAN_API=https://<ref>.supabase.co/functions/v1 \
//   TICKETSCAN_EVENT_PASSWORD=... \
//   TICKETSCAN_ERWARTE=2305 \
//   node scripts/smoke-test.mjs

import { env, exit, stderr } from "node:process";
import { keyFromCli, looksMangled, refFromUrl } from "./supabase-key.mjs";

const API = env.TICKETSCAN_API?.replace(/\/$/, "");
const PASSWORD = env.TICKETSCAN_EVENT_PASSWORD;

if (!API || !PASSWORD) {
  stderr.write("TICKETSCAN_API und TICKETSCAN_EVENT_PASSWORD müssen gesetzt sein.\n");
  exit(1);
}

// Der öffentliche Schlüssel wird nur für die letzte Prüfgruppe gebraucht.
// Ist er nicht gesetzt oder unbrauchbar, holt ihn die angemeldete CLI —
// zuverlässiger als der Weg über die Zwischenablage.
let anonKey = env.TICKETSCAN_ANON_KEY;
if (!anonKey || looksMangled(anonKey)) {
  anonKey = keyFromCli(refFromUrl(API), "public") ?? null;
}

/** Sollzahl der Tickets. Ohne sie prüft der Testlauf nur auf „nicht leer" —
 *  ein bei Zeile 1500 abgebrochener Import meldete damit grün, und 805 Gäste
 *  liefen am Eingang als unbekannt auf. */
const ERWARTE = Number(env.TICKETSCAN_ERWARTE ?? "0") || null;

let failed = 0;
let skipped = 0;
const results = [];

function record(ok, name, detail) {
  results.push({ ok, name, detail });
  if (!ok) failed++;
}

/** Eine Prüfung, die nicht laufen konnte. Sie darf nicht als grün durchgehen:
 *  „Alles steht" neben drei fehlenden Zeilen ist die gefährlichste Ausgabe,
 *  die ein Testlauf haben kann. */
function skip(name, detail) {
  results.push({ ok: null, name, detail });
  skipped++;
}

async function step(name, work) {
  try {
    const detail = await work();
    record(true, name, detail);
    return detail;
  } catch (err) {
    record(false, name, err instanceof Error ? err.message : String(err));
    return null;
  }
}

// 1 — Endpunkt erreichbar und Passwortprüfung aktiv.
await step("Falsches Passwort wird abgelehnt", async () => {
  const res = await fetch(`${API}/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "ganz-sicher-falsch", label: "Smoke-Test" }),
  });
  if (res.status === 404) throw new Error("Endpunkt nicht gefunden — ist `session` deployt?");
  if (res.status === 401) return "401 wie erwartet";
  if (res.status === 500) throw new Error("500 — ist TICKETSCAN_EVENT_PASSWORD gesetzt?");
  throw new Error(`unerwartet ${res.status}: ${(await res.text()).slice(0, 120)}`);
});

/**
 * Anmelden — immer mit derselben Gerätekennung.
 *
 * Jeder Lauf meldet sich viermal an. Ohne die mitgeschickte Kennung legte
 * das vier neue Zeilen in `devices` an, und nach ein paar Läufen standen
 * dreißig Geräte namens „Smoke-Test" in der Übersicht — ganz oben, sortiert
 * nach letzter Meldung. Genau in der Liste, in der ein unerwartetes elftes
 * Gerät auffallen soll. Der Testlauf machte damit die Anzeige unbrauchbar,
 * die er absichern soll.
 */
let deviceId = null;
async function anmelden(label = "Smoke-Test") {
  const res = await fetch(`${API}/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: PASSWORD, label, deviceId }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok && data.deviceId) deviceId = data.deviceId;
  return { res, data };
}

// 2 — Anmeldung mit dem echten Passwort.
const session = await step("Anmeldung mit dem echten Passwort", async () => {
  const { res, data } = await anmelden();
  if (!res.ok) throw new Error(data.error ?? `${res.status}`);
  if (!data.token) throw new Error("kein Token in der Antwort");
  return `Gerätekennung ${String(data.deviceId).slice(0, 8)}…`;
});

// 3 — Läuft die Tagesgrenze in Ortszeit ab, nicht in UTC?
if (session) {
  await step("Tagesgrenze liegt in deutscher Ortszeit", async () => {
    const { data: { expiresAt } } = await anmelden();
    const at = new Date(expiresAt * 1000);
    const hour = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Berlin", hour: "2-digit", hour12: false,
    }).format(at);
    if (hour !== "06") {
      throw new Error(`läuft um ${hour} Uhr deutscher Zeit ab — TICKETSCAN_TIMEZONE gesetzt?`);
    }
    return `${at.toLocaleString("de-DE", { timeZone: "Europe/Berlin" })} Ortszeit`;
  });
}

// 4 — Schema und Daten.
if (session) {
  const token = (await anmelden()).data.token;

  // Bewusst über alle Seiten: Die Data API gibt höchstens 1000 Zeilen je
  // Anfrage heraus. Eine Prüfung, die nur die erste Seite ansieht, meldet bei
  // 2305 Tickets grün und lässt 1305 davon am Eingang als unbekannt auflaufen —
  // genau das ist einmal passiert.
  await step("Ticketliste vollständig abrufbar", async () => {
    const seen = new Map();
    let offset = 0;
    let seiten = 0;

    for (;;) {
      const res = await fetch(`${API}/changes?offset=${offset}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (res.status === 500) throw new Error("500 — ist die Migration eingespielt?");
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 120)}`);

      const page = await res.json();
      if (!Array.isArray(page.tickets)) throw new Error("unerwartete Antwort");

      for (const t of page.tickets) seen.set(t.code, t);
      seiten++;

      if (!page.more || page.tickets.length === 0) break;
      offset = page.nextOffset ?? offset + page.tickets.length;
      if (seiten > 50) throw new Error("Blättern endet nicht — Cursor bewegt sich nicht");
    }

    if (seen.size === 0) {
      throw new Error("0 Tickets — Liste noch nicht importiert (scripts/import-tickets.mjs)");
    }
    if (ERWARTE && seen.size !== ERWARTE) {
      throw new Error(
        `${seen.size} Tickets, erwartet ${ERWARTE} — Import unvollständig?`,
      );
    }

    const codes = [...seen.keys()].sort();
    const offen = [...seen.values()].filter((t) => !t.redeemed_at).length;
    const luecken = pruefeLuecken(codes);
    return `${seen.size} Tickets über ${seiten} Seiten, ${codes[0]} – ${codes.at(-1)}, ` +
      `${offen} noch nicht eingelöst${luecken ? `, ${luecken}` : ""}`;
  });

  // Namen gehören zur Bedienung: Der Guide weist an, den Namen mit dem Ticket
  // zu vergleichen, und die Liste sucht darüber. Ein Import mit falsch
  // benannter Spalte füllt still null ein — ohne Fehler, ohne Hinweis.
  await step("Namen sind hinterlegt", async () => {
    const res = await fetch(`${API}/changes`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const { tickets } = await res.json();
    const mit = tickets.filter((t) => t.holder_name).length;
    if (!("holder_name" in (tickets[0] ?? {}))) {
      throw new Error("Spalte holder_name fehlt in der Antwort — changes neu ausrollen");
    }
    if (mit === 0) {
      throw new Error(
        "kein einziger Name auf der ersten Seite — Spalte beim Import falsch benannt?",
      );
    }
    return `${mit} von ${tickets.length} auf der ersten Seite`;
  });

  // Ohne diese Prüfung fällt nicht auf, dass `stats` nie ausgerollt wurde:
  // Die Übersicht meldet dann „Kennzahlen brauchen Netz", und der zweite,
  // körperliche Zähler — der Bändchenabgleich — ist einfach nicht da.
  await step("Übersicht liefert Kennzahlen", async () => {
    const res = await fetch(`${API}/stats`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (res.status === 404) {
      throw new Error("404 — `stats` ist nicht ausgerollt (siehe docs/einrichtung.md, Schritt 4)");
    }
    if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 120)}`);
    const stats = await res.json();
    if (typeof stats.gesamt !== "number" || !Array.isArray(stats.geraete)) {
      throw new Error("unerwartete Antwort — falsche Fassung von `stats`?");
    }
    return `${stats.eingeloest} von ${stats.gesamt} eingelöst, ${stats.geraete.length} Geräte`;
  });

  await step("Abgelaufenes Token wird abgewiesen", async () => {
    const res = await fetch(`${API}/changes`, { headers: { authorization: "Bearer kaputt.kaputt" } });
    if (res.status !== 401) throw new Error(`erwartet 401, bekam ${res.status}`);
    return "401 wie erwartet";
  });
}

// 5 — Ist wirklich nichts über die Data API zu holen?
//
// Prüft in der laufenden Datenbank, was die Migration versprochen hat: Weder
// die Tabellen noch die Sicht dürfen mit dem öffentlichen Schlüssel lesbar
// sein. Die Sicht ist dabei der interessante Fall, weil sie ohne
// security_invoker die Zeilensicherheit der Tabellen darunter umginge.
const ANON = anonKey;
if (ANON) {
  const REST = API.replace(/\/functions\/v1$/, "/rest/v1");

  // Die neuen Schlüssel (sb_publishable_...) sind keine JWTs. Sie gehören
  // ausschließlich in den apikey-Kopf; als Bearer-Token weist die Data API sie
  // ab — und das sah bisher aus wie eine greifende Absicherung.
  const headers = ANON.startsWith("eyJ")
    ? { apikey: ANON, authorization: `Bearer ${ANON}` }
    : { apikey: ANON };

  for (const relation of ["tickets", "scan_log", "offline_windows"]) {
    await step(`${relation} ist öffentlich nicht lesbar`, async () => {
      const res = await fetch(`${REST}/${relation}?select=*&limit=1`, { headers });
      const body = await res.text();

      // Zwei Antworten belegen die Absicherung, und nur diese zwei:
      //
      //   42501 — Postgres hat den Zugriff mangels Rechten verweigert. Der
      //           Schlüssel wurde also angenommen, die Anfrage kam bis zur
      //           Datenbank, und dort greift der Rechteentzug aus 0002.
      //   200 [] — durchgelassen, aber die Zeilensicherheit gibt nichts heraus.
      //
      // Alles andere sagt nichts aus. Ein 401 vom Gateway etwa kommt von einem
      // ungültigen Schlüssel und sähe nur aus wie Sicherheit — dieser Testlauf
      // hat genau darauf schon zweimal fälschlich grün gemeldet.
      if (body.includes('"42501"') || body.includes("permission denied")) {
        return "Rechte entzogen (42501)";
      }

      if (res.ok) {
        const rows = JSON.parse(body);
        if (Array.isArray(rows) && rows.length === 0) return "durchgelassen, aber leer";
        throw new Error(
          `${Array.isArray(rows) ? rows.length : "?"} Zeilen lesbar — Migration 0002 eingespielt?`,
        );
      }

      throw new Error(
        `HTTP ${res.status} — sagt nichts aus. ${body.slice(0, 90)} ` +
        "(Prüfung braucht einen gültigen öffentlichen Schlüssel.)",
      );
    });
  }
} else {
  for (const tabelle of ["tickets", "scan_log", "devices"]) {
    skip(`${tabelle} nicht öffentlich lesbar`, "übersprungen — kein öffentlicher Schlüssel");
  }
  stderr.write(
    "\nHinweis: Ohne öffentlichen Schlüssel entfällt die Prüfung, ob die Tabellen\n" +
    "öffentlich abfragbar sind. Entweder TICKETSCAN_ANON_KEY setzen oder die\n" +
    "Supabase-CLI anmelden, dann holt der Testlauf ihn selbst.\n",
  );
}

// 6 — Der vollständige Weg: einlösen, doppelt erkennen, zurücknehmen.
//
// Die wichtigste Prüfung überhaupt, weil sie die Datenbankfunktionen
// tatsächlich ausführt statt ihre Existenz anzunehmen. undo_redemption war
// einmal nicht lauffähig — row_count in einer als boolean deklarierten
// Variablen — und das wäre nur hier aufgefallen.
//
// Gearbeitet wird auf der letzten Nummer des Bereichs und am Ende
// zurückgenommen, damit der Bestand unverändert bleibt.
if (session) {
  const token = (await anmelden()).data.token;

  const send = async (scans) => {
    const res = await fetch(`${API}/scans`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ scans }),
    });
    if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 120)}`);
    return (await res.json()).results;
  };

  // Eine Nummer wählen, die gerade frei ist, damit ein laufender Test nichts
  // durcheinanderbringt.
  const probe = await (async () => {
    const res = await fetch(`${API}/changes?offset=2000`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const { tickets } = await res.json();
    return tickets.filter((t) => !t.redeemed_at).at(-1)?.code;
  })();

  const first = crypto.randomUUID();

  await step("Einlösen wird gebucht", async () => {
    if (!probe) throw new Error("kein freies Ticket zum Prüfen gefunden");
    const [r] = await send([{
      scanId: first, code: probe, clientTs: new Date().toISOString(),
      action: "redeem", offline: false,
    }]);
    if (r.result !== "ok") throw new Error(`erwartet ok, bekam ${r.result}`);
    return `${probe} eingelöst`;
  });

  await step("Zweites Einlösen wird als doppelt erkannt", async () => {
    const [r] = await send([{
      scanId: crypto.randomUUID(), code: probe, clientTs: new Date().toISOString(),
      action: "redeem", offline: false,
    }]);
    if (r.result !== "duplicate") throw new Error(`erwartet duplicate, bekam ${r.result}`);
    return "duplicate wie erwartet";
  });

  await step("Derselbe Scan zweimal bucht nicht doppelt", async () => {
    const [r] = await send([{
      scanId: first, code: probe, clientTs: new Date().toISOString(),
      action: "redeem", offline: false,
    }]);
    // Wiederholt wird die damalige Antwort, nicht neu gebucht.
    if (r.result !== "ok") throw new Error(`erwartet ok als Wiederholung, bekam ${r.result}`);
    return "Antwort wiederholt statt neu gebucht";
  });

  await step("Markierung ohne Abgleich wird angenommen", async () => {
    const [r] = await send([{
      scanId: crypto.randomUUID(), code: probe, clientTs: new Date().toISOString(),
      action: "redeem", offline: true,
    }]);
    if (r.result === "error") throw new Error("Spalte offline fehlt — Migration 0003 eingespielt?");
    return "Parameter p_offline vorhanden";
  });

  await step("Rücknahme gibt das Ticket wieder frei", async () => {
    const [r] = await send([{
      scanId: crypto.randomUUID(), code: probe, clientTs: new Date().toISOString(),
      action: "undo", reason: "Testlauf",
    }]);
    if (r.result !== "ok") {
      throw new Error(`Rücknahme scheiterte (${r.result}) — Migrationen 0003/0004 eingespielt?`);
    }

    const res = await fetch(`${API}/changes?offset=2000`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const { tickets } = await res.json();
    const after = tickets.find((t) => t.code === probe);
    if (after?.redeemed_at) throw new Error("Ticket gilt weiterhin als eingelöst");
    return `${probe} wieder frei — Bestand unverändert`;
  });

  // Wiederholte Rücknahme darf nichts erneut zurücknehmen.
  //
  // Das war ein echter Fund: undo_redemption prüfte die scan_id nicht, bevor
  // es schrieb. Ging die Antwort auf dem Rückweg verloren und wurde derselbe
  // Vorgang später erneut zugestellt, machte er eine fremde, inzwischen
  // gültige Einlösung zunichte — ohne Spur im Protokoll.
  await step("Wiederholte Rücknahme wirkt nicht doppelt", async () => {
    const scanId = crypto.randomUUID();
    const undoScan = {
      scanId, code: probe, clientTs: new Date().toISOString(),
      action: "undo", reason: "Testlauf Idempotenz",
    };

    // Erst einlösen, damit es etwas zurückzunehmen gibt.
    await send([{
      scanId: crypto.randomUUID(), code: probe, clientTs: new Date().toISOString(),
      action: "redeem", offline: false,
    }]);
    const [erste] = await send([undoScan]);
    if (erste.result !== "ok") throw new Error(`erste Rücknahme: ${erste.result}`);

    // Zwischenzeitlich löst ein anderes Gerät regulär ein.
    await send([{
      scanId: crypto.randomUUID(), code: probe, clientTs: new Date().toISOString(),
      action: "redeem", offline: false,
    }]);

    // Dieselbe Rücknahme noch einmal — sie darf die neue Einlösung nicht
    // anfassen, sondern nur ihre damalige Antwort wiederholen.
    const [zweite] = await send([undoScan]);
    if (zweite.result !== "ok") throw new Error(`Wiederholung: ${zweite.result}`);

    const res = await fetch(`${API}/changes?offset=2000`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const { tickets } = await res.json();
    const after = tickets.find((t) => t.code === probe);
    if (!after?.redeemed_at) {
      throw new Error("die wiederholte Rücknahme hat die neue Einlösung zunichte gemacht");
    }
    return "Antwort wiederholt, fremde Einlösung unangetastet";
  });

  // Aufräumen, auch wenn oben etwas schiefging: Ein Abbruch dazwischen ließe
  // sonst ein echtes Ticket als eingelöst stehen, und der Gast liefe am
  // Eingang als „bereits drinnen" auf.
  await step("Bestand am Ende unverändert", async () => {
    await send([{
      scanId: crypto.randomUUID(), code: probe, clientTs: new Date().toISOString(),
      action: "undo", reason: "Testlauf aufräumen",
    }]);
    const res = await fetch(`${API}/changes?offset=2000`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const { tickets } = await res.json();
    const after = tickets.find((t) => t.code === probe);
    if (after?.redeemed_at) throw new Error(`${probe} ist noch eingelöst — bitte von Hand freigeben`);
    return `${probe} frei`;
  });
}

// ------------------------------------------------------------------ Bericht --

stderr.write("\n");
for (const { ok, name, detail } of results) {
  const mark = ok === null ? "??  " : ok ? "ok  " : "FEHL";
  stderr.write(`  ${mark}  ${name.padEnd(42)} ${detail ?? ""}\n`);
}
stderr.write(
  failed > 0
    ? `\n${failed} von ${results.length} Prüfungen fehlgeschlagen.\n`
    : skipped > 0
      ? `\nAlles Geprüfte steht — aber ${skipped} Prüfungen liefen nicht.\n` +
        "Das ist kein grünes Licht. Siehe Hinweis oben.\n"
      : "\nAlles steht. Die App kann gegen dieses Backend arbeiten.\n",
);
exit(failed > 0 ? 1 : skipped > 0 ? 2 : 0);

/** Fehlende Nummern im Bereich benennen, statt nur zu zählen. */
function pruefeLuecken(codes) {
  const zahlen = codes.map(Number).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (zahlen.length < 2) return null;
  const fehlend = zahlen.at(-1) - zahlen[0] + 1 - zahlen.length;
  return fehlend > 0 ? `${fehlend} Nummern fehlen im Bereich` : "lückenlos";
}
