#!/usr/bin/env node
// Erzeugt eine Ticketliste im Importformat von TicketScan.
//
// Platzhalter, bis die echte Liste vorliegt. Die Spalten entsprechen der
// Tabelle `tickets` aus dem Konzept, damit der Importer unverändert gegen
// die echten Daten läuft.
//
//   node data/generate-tickets.mjs --from 1 --to 2305 > data/tickets.sample.csv
//
// Die Namen sind erfunden und dienen nur der Vorführung. Sie hängen allein an
// der Ticketnummer, nicht am Zufall des Aufrufs: Zweimal erzeugt ergibt
// zweimal dieselbe Liste — sonst würde jeder Import alle 2305 Zeilen als
// geändert markieren und jedes Gerät den ganzen Bestand neu ziehen.

import { argv, stdout, stderr, exit } from "node:process";

function arg(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
}

const from = Number(arg("from", 1));
const to = Number(arg("to", 2305));
const width = Number(arg("width", 5));
const category = arg("category", "Festival-Ticket");
const withNames = !argv.includes("--ohne-namen");

if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from) {
  stderr.write("Ungültiger Bereich. Erwartet: --from <n> --to <m> mit n <= m\n");
  exit(1);
}

const pad = (n) => String(n).padStart(width, "0");

// ------------------------------------------------------------ Demo-Namen --

const VORNAMEN = [
  "Anna", "Ben", "Clara", "David", "Emma", "Felix", "Greta", "Hannes",
  "Ida", "Jonas", "Katja", "Lars", "Marie", "Nils", "Olga", "Paul",
  "Quirin", "Rieke", "Simon", "Tilda", "Ulrich", "Vera", "Wanda", "Xenia",
  "Yannick", "Zoe", "Amir", "Bilal", "Chiara", "Dilara", "Elias", "Fatima",
  "Gabriel", "Hanna", "Isabel", "Jakob", "Kira", "Leon", "Mila", "Noah",
  "Ole", "Pia", "Ronja", "Sophie", "Theo", "Uwe", "Valentin", "Wiebke",
];

const NACHNAMEN = [
  "Albrecht", "Bergmann", "Christiansen", "Dietrich", "Engelhardt", "Fischer",
  "Gruber", "Hoffmann", "Iversen", "Jansen", "Kowalski", "Lehmann",
  "Möller", "Neumann", "Ortmann", "Petersen", "Quandt", "Richter",
  "Schneider", "Thiele", "Ulrich", "Vogt", "Wagner", "Xylander",
  "Yildirim", "Zimmermann", "Baumgartner", "Cordes", "Drechsler", "Eberhardt",
  "Freitag", "Gerlach", "Hartwig", "Immler", "Junghans", "Krämer",
  "Lindqvist", "Marquardt", "Nowak", "Oswald", "Pfeiffer", "Reinhardt",
  "Steinbach", "Tenbrink", "Uhlmann", "Vollmer", "Weidemann", "Zeller",
];

// Zwei teilerfremde Schrittweiten über zwei verschieden lange Listen: Die
// Paarung wiederholt sich erst nach kgV(48, 48) · … — für 2305 Zeilen reicht
// das, ohne dass sichtbare Muster entstehen.
function nameFor(n) {
  const streu = (n * 2654435761) >>> 0;           // Knuths Multiplikator
  // Etwa jedes neunte Ticket bleibt bewusst namenlos. In der echten Liste
  // wird es genauso sein: Abendkasse, Gästeliste, weitergegebene Tickets.
  // Wer den Fall nur in der Theorie kennt, baut eine App, die daran scheitert.
  if (streu % 9 === 0) return "";
  const vor = VORNAMEN[streu % VORNAMEN.length];
  const nach = NACHNAMEN[Math.floor(streu / VORNAMEN.length) % NACHNAMEN.length];
  return `${vor} ${nach}`;
}

// RFC 4180: nur maskieren, was maskiert werden muss — sonst weicht die Datei
// unnötig von dem ab, was ein Tabellenprogramm exportieren würde.
const csv = (v) => (/[",\n\r]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);

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
for (let n = from; n <= to; n++) {
  const name = withNames ? nameFor(n) : "";
  stdout.write(`${pad(n)},${csv(name)},${csv(category)},\n`);
}

stderr.write(
  [
    `${rows.length} Tickets erzeugt`,
    `Namen:            ${withNames ? "erfunden, zur Vorführung (--ohne-namen lässt sie weg)" : "keine"}`,
    `Bereich:          ${rows[0]} – ${rows[rows.length - 1]}`,
    `Feste Vorsilbe:   ${commonPrefix || "(keine)"}`,
    `Eingabestellen:   ${width - commonPrefix.length} statt ${width}`,
    `Dichte im Raum:   ${((rows.length / 10 ** width) * 100).toFixed(2)} % — dicht, siehe Abschnitt 01 des Konzepts`,
    "",
  ].join("\n"),
);
