#!/usr/bin/env node
// Importiert eine Ticketliste in die Datenbank.
//
// Prüft zuerst und meldet, was auffällt — Dubletten, uneinheitliche Länge,
// Lücken im Bereich. Geschrieben wird erst mit --commit, damit sich ein
// kaputter Export nicht unbemerkt in die Datenbank schiebt.
//
//   node scripts/import-tickets.mjs data/tickets.sample.csv
//   node scripts/import-tickets.mjs data/tickets.csv --commit

import { readFileSync } from "node:fs";
import { argv, env, exit, stderr, stdout } from "node:process";

const file = argv[2];
const commit = argv.includes("--commit");

if (!file) {
  stderr.write("Aufruf: node scripts/import-tickets.mjs <datei.csv> [--commit]\n");
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

function parseCsv(text) {
  const rows = splitCsv(text);
  if (rows.length < 2) throw new Error("Die Datei enthält keine Datenzeilen.");

  const header = rows[0].map((h) => h.trim().toLowerCase());
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
    return {
      code,
      holder_name: value("holder_name") || null,
      category: value("category") || "Festival-Ticket",
      note: value("note") || null,
    };
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
  `Kategorien:       ${[...new Set(rows.map((r) => r.category))].join(", ")}`,
  `Personalisiert:   ${rows.some((r) => r.holder_name) ? "ja" : "nein"}`,
  "",
].join("\n"));

for (const f of findings) stderr.write(`  ${f.schwere.padEnd(8)} ${f.text}\n`);
if (findings.length) stderr.write("\n");

const errors = findings.filter((f) => f.schwere === "Fehler");
if (errors.length) {
  stderr.write("Import abgebrochen — bitte den Export korrigieren.\n");
  exit(1);
}

if (!commit) {
  stderr.write("Prüfung bestanden. Zum Schreiben erneut mit --commit aufrufen.\n");
  exit(0);
}

// --------------------------------------------------------------- schreiben --

const url = env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  stderr.write("SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY müssen gesetzt sein.\n");
  exit(1);
}

// Aus der Anleitung übernommene Beispielwerte abfangen, bevor der Server sie
// als „Invalid API key“ zurückweist — die Meldung führt sonst auf die falsche
// Fährte.
if (/^(eyJ\.\.\.|\.\.\.|<.*>)$/i.test(key.trim())) {
  stderr.write(
    `SUPABASE_SERVICE_ROLE_KEY enthält noch den Beispielwert '${key}'.\n` +
    "Den echten Schlüssel gibt es unter Project Settings → API Keys.\n" +
    "Gesucht ist der geheime: `sb_secret_...` (neu) oder `service_role`\n" +
    "als langer eyJ-Wert (älter). Nicht der publishable/anon-Schlüssel.\n",
  );
  exit(1);
}

// Der öffentliche Schlüssel wird hier gern verwechselt. Er kommt bis zur
// Zeilensicherheit und scheitert dann mit einer Meldung, die nach einem
// Rechteproblem aussieht statt nach der falschen Zutat.
// Manche Terminals ersetzen eingefügte Geheimnisse in der Anzeige durch
// Punkte — und je nach Programm landen diese Punkte auch im Wert. Der Fehler
// kommt dann tief aus der HTTP-Bibliothek und nennt einen Zeichencode, mit dem
// niemand etwas anfangen kann.
if (/[^\x21-\x7e]/.test(key.trim())) {
  stderr.write(
    "SUPABASE_SERVICE_ROLE_KEY enthält Zeichen, die in einem Schlüssel nicht\n" +
    "vorkommen — vermutlich hat das Terminal die Eingabe verfremdet.\n\n" +
    "Zuverlässiger Weg auf dem Mac: Schlüssel im Browser kopieren, dann\n\n" +
    "  export SUPABASE_SERVICE_ROLE_KEY=\"$(pbpaste)\"\n\n" +
    "So wandert der Wert aus der Zwischenablage direkt in die Variable, ohne\n" +
    "je durch die Eingabezeile zu laufen.\n",
  );
  exit(1);
}

if (/^sb_publishable_/.test(key.trim())) {
  stderr.write(
    "SUPABASE_SERVICE_ROLE_KEY enthält den öffentlichen Schlüssel\n" +
    "(`sb_publishable_...`). Zum Schreiben braucht es den geheimen:\n" +
    "`sb_secret_...` unter Project Settings → API Keys.\n",
  );
  exit(1);
}

const CHUNK = 500;
let written = 0;

for (let i = 0; i < rows.length; i += CHUNK) {
  const chunk = rows.slice(i, i + CHUNK);
  const res = await fetch(`${url}/rest/v1/tickets?on_conflict=code`, {
    method: "POST",
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      // Bestehende Einlösungen bleiben unangetastet: der Upsert schreibt nur
      // die Stammdaten, nicht redeemed_at.
      prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(chunk),
  });

  if (!res.ok) {
    stderr.write(`\nAbbruch bei Zeile ${i + 1}: ${res.status} ${await res.text()}\n`);
    exit(1);
  }
  written += chunk.length;
  stdout.write(`\r${written}/${rows.length} geschrieben`);
}

stdout.write("\n");
stderr.write(`Fertig. ${written} Tickets importiert.\n`);
