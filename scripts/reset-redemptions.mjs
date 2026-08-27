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
//   node scripts/reset-redemptions.mjs                    # nur zeigen
//   node scripts/reset-redemptions.mjs --commit
//   node scripts/reset-redemptions.mjs --commit --auch-protokoll

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

async function count(path) {
  const res = await rest(`${path}&select=code`, { headers: { prefer: "count=exact" } });
  return Number(res.headers.get("content-range")?.split("/")[1] ?? 0);
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

// Bewusst eine Rückfrage, die man nicht versehentlich wegtippt: Das hier
// löscht die Arbeit eines ganzen Abends, wenn man sich im Zeitpunkt irrt.
const rl = createInterface({ input: process.stdin, output: process.stderr });
const answer = await rl.question(
  `Wirklich ${redeemed} Einlösungen zurücksetzen? Tippe ZURUECKSETZEN: `,
);
rl.close();

if (answer.trim() !== "ZURUECKSETZEN") {
  stderr.write("Abgebrochen, nichts geändert.\n");
  exit(1);
}

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
