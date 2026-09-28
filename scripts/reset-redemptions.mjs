#!/usr/bin/env node
// Setzt alle Einlösungen zurück.
//
// Nach der Generalprobe steht der Bestand voller Testeinlösungen. Ohne diesen
// Weg bliebe nur der SQL-Editor — und dort wird unter Zeitdruck schnell mehr
// gelöscht als gemeint.
//
// Die Ticketliste selbst bleibt unangetastet. Das Protokoll wird auf Wunsch
// mitgelöscht; ohne --auch-protokoll bleibt es als Nachweis erhalten.
//
// --gesichert ist Pflicht, sobald tatsächlich geschrieben wird: Ohne ein
// gesichertes Protokoll lässt sich eine versehentlich gelöschte Einlösung
// hinterher nicht mehr rekonstruieren.
//
//   node scripts/reset-redemptions.mjs                    # nur zeigen
//   node scripts/export-log.mjs --protokoll > protokoll-$(date +%F).csv
//   node scripts/reset-redemptions.mjs --commit --gesichert
//   node scripts/reset-redemptions.mjs --commit --gesichert --auch-protokoll

import { argv, env, exit, stderr } from "node:process";
import { createInterface } from "node:readline/promises";
import { keyFromCli, looksMangled, refFromUrl } from "./supabase-key.mjs";

const url = env.SUPABASE_URL;
const commit = argv.includes("--commit");
const alsoLog = argv.includes("--auch-protokoll");

if (!url) {
  stderr.write("SUPABASE_URL muss gesetzt sein.\n");
  exit(1);
}

let key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!key || looksMangled(key)) {
  key = keyFromCli(refFromUrl(url), "secret");
  if (!key) {
    stderr.write("Kein Schlüssel. Entweder npx supabase login, oder\n" +
                 "SUPABASE_SERVICE_ROLE_KEY selbst setzen.\n");
    exit(1);
  }
  stderr.write("Schlüssel von der CLI erhalten.\n");
}

const rest = (path, init = {}) => fetch(`${url}/rest/v1/${path}`, {
  ...init,
  headers: {
    apikey: key, authorization: `Bearer ${key}`,
    "content-type": "application/json", ...init.headers,
  },
});

// Ohne die res.ok-Prüfung nahm ein Tippfehler im Projekt oder ein abgelaufener
// Schlüssel still eine leere Antwort als „0 Einlösungen" — und der Rest des
// Skripts lief dann fröhlich mit falschen Zahlen weiter, statt abzubrechen.
async function count(path) {
  const res = await rest(`${path}&select=code`, { headers: { prefer: "count=exact" } });
  if (!res.ok) {
    stderr.write(
      `Abbruch beim Zählen (${path}): ${res.status} ${await res.text()}\n` +
      "Falsches Projekt oder falscher Schlüssel?\n",
    );
    exit(1);
  }
  return Number(res.headers.get("content-range")?.split("/")[1] ?? 0);
}

/** Zeitpunkt der jüngsten Einlösung, oder null, wenn keine vorliegt. */
async function letzteEinloesung() {
  const res = await rest(
    "tickets?redeemed_at=not.is.null&select=redeemed_at&order=redeemed_at.desc&limit=1",
  );
  if (!res.ok) {
    stderr.write(
      `Abbruch beim Lesen der jüngsten Einlösung: ${res.status} ${await res.text()}\n` +
      "Falsches Projekt oder falscher Schlüssel?\n",
    );
    exit(1);
  }
  const rows = await res.json();
  return rows[0]?.redeemed_at ? new Date(rows[0].redeemed_at) : null;
}

const redeemed = await count("tickets?redeemed_at=not.is.null");
const logged = await count("scan_log?scan_id=not.is.null");

stderr.write([
  ``,
  `Projekt:          ${url}`,
  `Eingelöst:        ${redeemed}`,
  `Protokolleinträge: ${logged}${alsoLog ? " — werden mitgelöscht" : " — bleiben erhalten"}`,
  ``,
].join("\n"));

if (redeemed === 0 && !alsoLog) {
  stderr.write("Nichts zurückzusetzen.\n");
  exit(0);
}

if (!commit) {
  stderr.write("Nur angesehen. Zum Ausführen erneut mit --commit aufrufen.\n");
  exit(0);
}

// Pflichtschalter: Ohne gesichertes Protokoll ist eine versehentliche Zeit
// selbst dann nicht mehr rekonstruierbar, wenn man sich im Nachhinein daran
// erinnert. Das Protokoll ist der einzige Nachweis, aus dem sich eine
// gelöschte Einlösung wiederherstellen lässt.
if (!argv.includes("--gesichert")) {
  stderr.write(
    "\nAbbruch: Ohne --gesichert wird hier nichts zurückgesetzt.\n" +
    "Erst das Protokoll sichern:\n\n" +
    `  node scripts/export-log.mjs --protokoll > protokoll-$(date +%F).csv\n\n` +
    "Danach denselben Aufruf um --gesichert ergänzen.\n",
  );
  exit(1);
}

const letzte = await letzteEinloesung();
const minutenHer = letzte ? Math.round((Date.now() - letzte.getTime()) / 60_000) : null;
const laeuftGerade = minutenHer !== null && minutenHer < 120;

stderr.write(
  letzte
    ? `Jüngste Einlösung: ${letzte.toISOString()} (vor ${minutenHer} Minuten)\n`
    : "Jüngste Einlösung: keine\n",
);

if (laeuftGerade) {
  stderr.write(
    "\n⚠️  Läuft der Einlass gerade? Die jüngste Einlösung liegt weniger als\n" +
    "zwei Stunden zurück. Ein Reset jetzt würde eingelöste Tickets wieder\n" +
    "freigeben, während Gäste bereits mit Bändchen drin sind.\n",
  );
}

// Bewusst eine Rückfrage, die man nicht versehentlich wegtippt: Das hier
// löscht die Arbeit eines ganzen Abends, wenn man sich im Zeitpunkt irrt.
const rl = createInterface({ input: process.stdin, output: process.stderr });
const frage = alsoLog
  ? `Wirklich ${redeemed} Einlösungen zurücksetzen — und dabei zusätzlich ` +
    `${logged} Protokollzeilen UNWIDERRUFLICH löschen? Tippe ZURUECKSETZEN: `
  : `Wirklich ${redeemed} Einlösungen zurücksetzen? Tippe ZURUECKSETZEN: `;
const answer = await rl.question(frage);

if (answer.trim() !== "ZURUECKSETZEN") {
  rl.close();
  stderr.write("Abgebrochen, nichts geändert.\n");
  exit(1);
}

if (laeuftGerade) {
  const zweiteAntwort = await rl.question(
    "\nDer Einlass läuft möglicherweise gerade. Zum Fortfahren erneut " +
    "ZURUECKSETZEN tippen: ",
  );
  if (zweiteAntwort.trim() !== "ZURUECKSETZEN") {
    rl.close();
    stderr.write("Abgebrochen, nichts geändert.\n");
    exit(1);
  }
}

rl.close();

const reset = await rest("tickets?redeemed_at=not.is.null", {
  method: "PATCH",
  headers: { prefer: "return=minimal" },
  body: JSON.stringify({ redeemed_at: null, redeemed_by_device: null, redeemed_scan_id: null }),
});
if (!reset.ok) {
  stderr.write(`Fehlgeschlagen: ${reset.status} ${await reset.text()}\n`);
  exit(1);
}

if (alsoLog) {
  const cleared = await rest("scan_log?scan_id=not.is.null", {
    method: "DELETE", headers: { prefer: "return=minimal" },
  });
  if (!cleared.ok) {
    stderr.write(`Protokoll nicht gelöscht: ${cleared.status} ${await cleared.text()}\n`);
    exit(1);
  }
}

stderr.write(`\nZurückgesetzt. ${redeemed} Tickets sind wieder frei.\n`);
stderr.write("Die Geräte ziehen den Stand beim nächsten Abgleich nach.\n");
