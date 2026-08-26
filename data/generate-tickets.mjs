#!/usr/bin/env node
// Erzeugt eine Ticketliste im Importformat von TicketScan.
//
// Platzhalter, bis die echte Liste vorliegt. Die Spalten entsprechen der
// Tabelle `tickets` aus dem Konzept, damit der Importer unverändert gegen
// die echten Daten läuft.
//
//   node data/generate-tickets.mjs --from 1 --to 2305 > data/tickets.sample.csv

import { argv, stdout, stderr, exit } from "node:process";

function arg(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
}

const from = Number(arg("from", 1));
const to = Number(arg("to", 2305));
const width = Number(arg("width", 5));
const category = arg("category", "Festival-Ticket");

if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from) {
  stderr.write("Ungültiger Bereich. Erwartet: --from <n> --to <m> mit n <= m\n");
  exit(1);
}

const pad = (n) => String(n).padStart(width, "0");

const rows = [];
for (let n = from; n <= to; n++) rows.push(pad(n));

if (rows.some((c) => c.length !== width)) {
  stderr.write(`Mindestens eine Nummer passt nicht in ${width} Stellen.\n`);
  exit(1);
}

// Die gemeinsame führende Ziffernfolge blendet die App im Eingabefeld fest
// ein — jede Stelle weniger ist eine Fehlerquelle weniger.
const commonPrefix = rows.reduce((acc, code) => {
  let i = 0;
  while (i < acc.length && acc[i] === code[i]) i++;
  return acc.slice(0, i);
}, rows[0]);

stdout.write("code,holder_name,category,note\n");
for (const code of rows) stdout.write(`${code},,${category},\n`);

stderr.write(
  [
    `${rows.length} Tickets erzeugt`,
    `Bereich:          ${rows[0]} – ${rows[rows.length - 1]}`,
    `Feste Vorsilbe:   ${commonPrefix || "(keine)"}`,
    `Eingabestellen:   ${width - commonPrefix.length} statt ${width}`,
    `Dichte im Raum:   ${((rows.length / 10 ** width) * 100).toFixed(2)} % — dicht, siehe Abschnitt 01 des Konzepts`,
    "",
  ].join("\n"),
);
