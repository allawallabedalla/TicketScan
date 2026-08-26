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

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) throw new Error("Die Datei enthält keine Datenzeilen.");

  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const codeAt = header.indexOf("code");
  if (codeAt === -1) throw new Error("Es fehlt eine Spalte `code`.");

  return lines.slice(1).map((line, i) => {
    const cells = line.split(",");
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
const prefix = codes.reduce((acc, code) => {
  let i = 0;
  while (i < acc.length && acc[i] === code[i]) i++;
  return acc.slice(0, i);
}, codes[0] ?? "");

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
  `Bereich:          ${codes[0]} – ${codes.at(-1)}`,
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
