#!/usr/bin/env node
// Importiert eine Ticketliste in die Datenbank.
//
// Prüft zuerst und meldet, was auffällt — Dubletten, uneinheitliche Länge,
// Lücken im Bereich. Geschrieben wird erst mit --commit, damit sich ein
// kaputter Export nicht unbemerkt in die Datenbank schiebt.
//
// Seit Migration 0006 läuft der Schreibweg über die Datenbankfunktion
// `stammdaten_schreiben`, nicht mehr über einen Upsert auf der Tabelle
// direkt. Zwei Gründe:
//
//   - Leere Zellen werden nicht mehr mitgesendet, sondern als fehlender
//     Schlüssel weggelassen. Ein Upsert hätte eine leere Zelle als „auf leer
//     setzen" verstanden — ein erneuter Import mit einer unvollständig
//     ausgefüllten Liste hätte damit in der App nachgetragene Namen und
//     Vermerke wieder gelöscht. Wer bewusst leeren will, macht das einzeln in
//     der App (siehe docs/ticketliste-pflegen.md).
//   - Neue Nummern brauchen eine ausdrückliche Freigabe (--neu-anlegen), und
//     jede echte Änderung landet im Änderungsprotokoll (ticket_changes).
//
//   node scripts/import-tickets.mjs data/tickets.sample.csv
//   node scripts/import-tickets.mjs data/tickets.csv --commit
//   node scripts/import-tickets.mjs data/tickets.csv --commit --neu-anlegen

import { readFileSync } from "node:fs";
import { argv, env, exit, stderr, stdout } from "node:process";
import { keyFromCli, looksMangled, refFromUrl } from "./supabase-key.mjs";

const file = argv[2];
const commit = argv.includes("--commit");
const neuAnlegen = argv.includes("--neu-anlegen");

if (!file) {
  stderr.write("Aufruf: node scripts/import-tickets.mjs <datei.csv> [--commit] [--neu-anlegen]\n");
  exit(1);
}

// ------------------------------------------------------------------ lesen --

/**
 * Zerlegt CSV nach RFC 4180: Felder dürfen in Anführungszeichen stehen und
 * darin Kommas, Zeilenumbrüche und verdoppelte Anführungszeichen enthalten.
 *
 * Ein Zeilenweise-Trennen an Kommas wäre kürzer, würde bei einem Export aus
 * Excel aber stillschweigend Unsinn einlesen — ein Name wie "Meier, Jonna"
 * verschiebt alle folgenden Spalten, ohne dass irgendwo ein Fehler auftaucht.
 */
function splitCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (quoted) {
      if (c !== '"') { field += c; continue; }
      // Verdoppeltes Anführungszeichen steht für ein einzelnes im Feld.
      if (text[i + 1] === '"') { field += '"'; i++; continue; }
      quoted = false;
      continue;
    }

    if (c === '"' && field === "") { quoted = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\r") continue;
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += c;
  }

  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  if (quoted) throw new Error("Ein Anführungszeichen wurde nicht geschlossen.");

  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

// Die einzigen Spalten, die die Datenbankfunktion versteht. Eine unbekannte
// Spalte — etwa ein Tippfehler oder ein Exportfeld aus dem Vorverkaufssystem,
// das hier niemand erwartet — soll auffallen, statt still ignoriert zu
// werden.
const ERLAUBTE_SPALTEN = ["code", "holder_name", "category", "note"];

function parseCsv(text) {
  const rows = splitCsv(text);
  if (rows.length < 2) throw new Error("Die Datei enthält keine Datenzeilen.");

  const header = rows[0].map((h) => h.trim().toLowerCase());

  const unbekannt = header.filter((h) => !ERLAUBTE_SPALTEN.includes(h));
  if (unbekannt.length) {
    throw new Error(
      `Unbekannte Spalte(n) in der Kopfzeile: ${unbekannt.join(", ")}. ` +
      `Erlaubt sind ausschließlich: ${ERLAUBTE_SPALTEN.join(", ")}.`,
    );
  }

  const codeAt = header.indexOf("code");
  if (codeAt === -1) throw new Error("Es fehlt eine Spalte `code`.");

  return rows.slice(1).map((cells, i) => {
    if (cells.length !== header.length) {
      throw new Error(
        `Zeile ${i + 2}: ${cells.length} Felder, erwartet ${header.length}. ` +
        "Der Export passt nicht zur Kopfzeile.",
      );
    }
    const value = (name) => {
      const at = header.indexOf(name);
      return at === -1 ? "" : (cells[at] ?? "").trim();
    };
    const code = (cells[codeAt] ?? "").trim();
    if (!code) throw new Error(`Zeile ${i + 2}: leere Ticketnummer.`);

    // Rohwerte, ausschließlich für die Vorabprüfung und die Anzeige unten —
    // dort soll eine leere Zelle sichtbar leer bleiben.
    const raw = {
      holder_name: value("holder_name"),
      category: value("category"),
      note: value("note"),
    };

    // Für den Schreibweg zählt nur, was tatsächlich in der Zelle steht: ein
    // fehlender Schlüssel heißt „unverändert lassen", eine leere Zelle wird
    // deshalb NICHT mitgeschickt. Nur `code` ist immer da.
    const zeile = { code };
    if (raw.holder_name) zeile.holder_name = raw.holder_name;
    if (raw.category) zeile.category = raw.category;
    if (raw.note) zeile.note = raw.note;

    return { code, raw, zeile };
  });
}

let rows;
try {
  rows = parseCsv(readFileSync(file, "utf8"));
} catch (err) {
  stderr.write(`Import abgebrochen: ${err.message}\n`);
  exit(1);
}

// ------------------------------------------------------------------ prüfen --

const codes = rows.map((r) => r.code);
const findings = [];

const seen = new Set();
const duplicates = new Set();
for (const code of codes) {
  if (seen.has(code)) duplicates.add(code);
  seen.add(code);
}
if (duplicates.size) {
  findings.push({
    schwere: "Fehler",
    text: `${duplicates.size} doppelte Nummern, u. a. ${[...duplicates].slice(0, 5).join(", ")}`,
  });
}

const lengths = new Set(codes.map((c) => c.length));
if (lengths.size > 1) {
  findings.push({
    schwere: "Fehler",
    text: `Uneinheitliche Länge: ${[...lengths].sort().join(", ")} Stellen. Führende Nullen im Export verloren?`,
  });
}

if (codes.some((c) => !/^\d+$/.test(c))) {
  const bad = codes.filter((c) => !/^\d+$/.test(c)).slice(0, 5);
  findings.push({ schwere: "Fehler", text: `Nicht nur Ziffern, u. a. ${bad.join(", ")}` });
}

// Die gemeinsame führende Ziffernfolge blendet die App im Eingabefeld fest
// ein — jede Stelle weniger ist eine Fehlerquelle weniger.
let prefix = codes.reduce((acc, code) => {
  let i = 0;
  while (i < acc.length && acc[i] === code[i]) i++;
  return acc.slice(0, i);
}, codes[0] ?? "");
// Bei nur einer Nummer wäre der ganze Code die Vorsilbe und es bliebe nichts
// zum Eintippen übrig. Mindestens drei Stellen bleiben immer stehen.
prefix = prefix.slice(0, Math.max(0, (codes[0]?.length ?? 0) - 3));

const numeric = codes.filter((c) => /^\d+$/.test(c)).map(Number).sort((a, b) => a - b);
const gaps = [];
for (let i = 1; i < numeric.length && gaps.length < 5; i++) {
  if (numeric[i] - numeric[i - 1] > 1) gaps.push(`${numeric[i - 1]} → ${numeric[i]}`);
}
if (gaps.length) {
  findings.push({
    schwere: "Hinweis",
    text: `Lücken im Nummernbereich, u. a. ${gaps.join(", ")}. Bei Stornos normal.`,
  });
}

const width = codes[0]?.length ?? 0;
stderr.write([
  `Datei:            ${file}`,
  `Tickets:          ${rows.length}`,
  `Bereich:          ${[...codes].sort()[0]} – ${[...codes].sort().at(-1)}`,
  `Feste Vorsilbe:   ${prefix || "(keine)"} — Eingabe mit ${width - prefix.length} statt ${width} Stellen`,
  `Kategorien:       ${[...new Set(rows.map((r) => r.raw.category).filter(Boolean))].join(", ") || "(keine gesetzt)"}`,
  `Personalisiert:   ${rows.some((r) => r.raw.holder_name) ? "ja" : "nein"}`,
  "",
].join("\n"));

for (const f of findings) stderr.write(`  ${f.schwere.padEnd(8)} ${f.text}\n`);
if (findings.length) stderr.write("\n");

const errors = findings.filter((f) => f.schwere === "Fehler");
if (errors.length) {
  stderr.write("Import abgebrochen — bitte den Export korrigieren.\n");
  exit(1);
}

// ------------------------------------------------------------------ Schlüssel --

const url = env.SUPABASE_URL;
if (!url) {
  stderr.write("SUPABASE_URL muss gesetzt sein.\n");
  exit(1);
}

// Bevorzugt die angemeldete CLI. Das umgeht die fehleranfälligste Stelle der
// Einrichtung: Das Dashboard zeigt den Schlüssel maskiert, und wer den
// angezeigten Text markiert, kopiert Aufzählungspunkte. Der Schlüssel wird
// schon für den Probelauf gebraucht, nicht erst zum Schreiben — die
// Datenbankfunktion läuft als service_role.
let key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!key || looksMangled(key)) {
  if (key) stderr.write("Der gesetzte Schlüssel ist unbrauchbar — frage die Supabase-CLI…\n");
  else stderr.write("Kein Schlüssel gesetzt — frage die Supabase-CLI…\n");

  const found = keyFromCli(refFromUrl(url), "secret");
  if (found) {
    key = found;
    stderr.write("Schlüssel von der CLI erhalten.\n\n");
  } else {
    stderr.write(
      "\nDie CLI konnte nicht helfen. Zwei Wege:\n\n" +
      "  npx supabase login && npx supabase link --project-ref <kennung>\n\n" +
      "oder den geheimen Schlüssel selbst setzen. Dabei im Supabase-Dashboard\n" +
      "den Kopier-Knopf benutzen — der angezeigte Text ist maskiert und ergibt\n" +
      "beim Markieren nur Aufzählungspunkte.\n",
    );
    exit(1);
  }
}

// Der öffentliche Schlüssel wird hier gern verwechselt. Er kommt bis zur
// Zeilensicherheit durch und scheitert dann mit einer Meldung, die nach einem
// Rechteproblem aussieht statt nach der falschen Zutat.
if (/^sb_publishable_/.test(key.trim()) || /"role":"anon"/.test(atob(key.split(".")[1] ?? "") || "")) {
  stderr.write(
    "Das ist der öffentliche Schlüssel. Es braucht den geheimen —\n" +
    "am einfachsten, indem du SUPABASE_SERVICE_ROLE_KEY gar nicht setzt und die\n" +
    "angemeldete Supabase-CLI ihn holen lässt.\n",
  );
  exit(1);
}

// -------------------------------------------------------------------- RPC --

// Höchstens 500 Zeilen je Aufruf — dieselbe Grenze, die die Datenbankfunktion
// selbst durchsetzt.
const CHUNK = 500;
const QUELLE = "import-skript";

/**
 * Ruft `stammdaten_schreiben` für einen Block auf. Wirft mit einer lesbaren
 * Meldung, wenn PostgREST einen Fehler zurückgibt (etwa doppelte Nummern
 * innerhalb des Blocks oder eine abweichende Stellenzahl gegenüber dem
 * Bestand — beides prüft die Funktion selbst, HTTP 400 mit `message`).
 */
async function stammdatenSchreiben(zeilen, { probe, neuErlaubt }) {
  const res = await fetch(`${url}/rest/v1/rpc/stammdaten_schreiben`, {
    method: "POST",
    headers: {
      apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json",
    },
    body: JSON.stringify({
      p_zeilen: zeilen, p_quelle: QUELLE, p_neu_erlaubt: neuErlaubt, p_probe: probe,
    }),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* keine JSON-Antwort */ }

  if (!res.ok) {
    const message = data?.message ?? text.slice(0, 300);
    throw new Error(`${res.status}: ${message}`);
  }
  return data;
}

function zeilenBereich(i, chunkLength) {
  const start = i + 2; // Zeile 1 ist die Kopfzeile.
  const end = start + chunkLength - 1;
  return start === end ? `Zeile ${start}` : `Zeilen ${start}–${end}`;
}

// ------------------------------------------------------------- Probelauf --
//
// Läuft immer, auch ohne --commit — er ist die eigentliche Vorschau. Dabei
// immer mit p_neu_erlaubt=true aufgerufen: Sonst bräche die Funktion schon
// beim ersten neuen Ticket mit einem Fehler ab, und genau diese Information
// — wie viele neue Nummern die Datei enthält — soll die Vorschau ja zeigen.
// Geschrieben wird wegen p_probe=true so oder so nichts.

let probeNeu = 0, probeGeaendert = 0, probeUnveraendert = 0;
const neueCodes = [];
const aenderungen = [];

stderr.write("Probelauf gegen die Datenbank (nichts wird geschrieben)…\n");

for (let i = 0; i < rows.length; i += CHUNK) {
  const block = rows.slice(i, i + CHUNK);
  let ergebnis;
  try {
    ergebnis = await stammdatenSchreiben(block.map((r) => r.zeile), {
      probe: true, neuErlaubt: true,
    });
  } catch (err) {
    stderr.write(`\nProbelauf abgebrochen bei ${zeilenBereich(i, block.length)}: ${err.message}\n`);
    exit(1);
  }
  probeNeu += ergebnis.neu ?? 0;
  probeGeaendert += ergebnis.geaendert ?? 0;
  probeUnveraendert += ergebnis.unveraendert ?? 0;
  for (const c of ergebnis.neueCodes ?? []) neueCodes.push(c);
  for (const a of ergebnis.aenderungen ?? []) aenderungen.push(a);
}

stderr.write([
  "",
  "Ergebnis des Probelaufs:",
  `  neu:          ${probeNeu}`,
  `  geändert:     ${probeGeaendert}`,
  `  unverändert:  ${probeUnveraendert}`,
  "",
].join("\n"));

const namensaenderungen = aenderungen.filter((a) => a.feld === "holder_name");
if (namensaenderungen.length) {
  stderr.write(`  Namensänderungen (erste ${Math.min(20, namensaenderungen.length)} von ${namensaenderungen.length}):\n`);
  for (const a of namensaenderungen.slice(0, 20)) {
    stderr.write(`    ${a.code}: ${a.alt || "(leer)"} → ${a.neu || "(leer)"}\n`);
  }
  stderr.write("\n");
}

if (neueCodes.length) {
  stderr.write(
    `  Neue Nummern (erste ${Math.min(20, neueCodes.length)} von insgesamt ${probeNeu}): ` +
    `${neueCodes.slice(0, 20).join(", ")}\n\n`,
  );
}

if (!commit) {
  stderr.write(
    "Nur geprüft, nichts geschrieben. Zum Schreiben erneut mit --commit aufrufen" +
    (probeNeu > 0 ? ", bei neuen Nummern zusätzlich mit --neu-anlegen.\n" : ".\n"),
  );
  exit(0);
}

// Neue Nummern brauchen eine ausdrückliche, zweite Zustimmung: Ein Import mit
// vertauschter Kopfzeile oder einem falschen Nummernbereich soll nicht
// stillschweigend 2000 neue Tickets anlegen.
if (probeNeu > 0 && !neuAnlegen) {
  stderr.write(
    `Abbruch: ${probeNeu} neue Nummer(n) in der Datei, aber --neu-anlegen wurde\n` +
    "nicht angegeben. Erneut aufrufen mit --commit --neu-anlegen, wenn das\n" +
    "gewollt ist — oder die Datei prüfen, falls nicht.\n",
  );
  exit(1);
}

// -------------------------------------------------------------- schreiben --

let geschriebeneBloecke = 0;
let geschriebeneZeilen = 0;
const gesamtBloecke = Math.ceil(rows.length / CHUNK);

for (let i = 0; i < rows.length; i += CHUNK) {
  const block = rows.slice(i, i + CHUNK);
  let ergebnis;
  try {
    ergebnis = await stammdatenSchreiben(block.map((r) => r.zeile), {
      probe: false, neuErlaubt: neuAnlegen,
    });
  } catch (err) {
    stderr.write(
      `\nAbbruch beim Schreiben von ${zeilenBereich(i, block.length)} ` +
      `(Block ${geschriebeneBloecke + 1} von ${gesamtBloecke}): ${err.message}\n\n` +
      (geschriebeneBloecke > 0
        ? `Bereits geschrieben: ${geschriebeneBloecke} von ${gesamtBloecke} Blöcken ` +
          `(${geschriebeneZeilen} Zeilen). Der Rest der Datei wurde nicht angefasst.\n`
        : "Es wurde noch kein Block geschrieben.\n"),
    );
    exit(1);
  }
  if (!ergebnis.geschrieben) {
    stderr.write(
      `\nAbbruch bei ${zeilenBereich(i, block.length)}: Die Funktion meldet ` +
      "geschrieben=false, obwohl kein Probelauf angefordert war.\n" +
      (geschriebeneBloecke > 0
        ? `Bereits geschrieben: ${geschriebeneBloecke} von ${gesamtBloecke} Blöcken.\n`
        : ""),
    );
    exit(1);
  }
  geschriebeneBloecke++;
  geschriebeneZeilen += block.length;
  stdout.write(`\r${geschriebeneZeilen}/${rows.length} geschrieben`);
}

stdout.write("\n");
stderr.write(`Fertig. ${geschriebeneZeilen} Tickets verarbeitet (${probeNeu} neu, ${probeGeaendert} geändert).\n`);
