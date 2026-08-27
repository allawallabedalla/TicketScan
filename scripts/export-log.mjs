#!/usr/bin/env node
// Führt Ticketstand und Protokoll als CSV aus.
//
// Für Abrechnung und Nachbereitung — und für den Fall, dass später jemand
// wissen will, wann welches Ticket eingelöst wurde.
//
//   node scripts/export-log.mjs > einlass.csv        alle Tickets, mit Stand
//   node scripts/export-log.mjs --eingeloest > drin.csv   nur die eingelösten
//   node scripts/export-log.mjs --protokoll > protokoll.csv  jeder Scanvorgang

import { argv, env, exit, stderr, stdout } from "node:process";
import { keyFromCli, looksMangled, refFromUrl } from "./supabase-key.mjs";

const url = env.SUPABASE_URL;
const wantLog = argv.includes("--protokoll");
const nurEingeloest = argv.includes("--eingeloest");

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
}

// Die Data API gibt höchstens 1000 Zeilen je Anfrage heraus — dieselbe
// Begrenzung, die den Endpunkten schon einmal die halbe Ticketliste
// unterschlagen hat. Hier wird deshalb ausdrücklich geblättert.
const PAGE = 1000;

async function* rows(table, select, order, filter = "") {
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(`${url}/rest/v1/${table}?select=${select}&order=${order}${filter}`, {
      headers: {
        apikey: key, authorization: `Bearer ${key}`,
        range: `${from}-${from + PAGE - 1}`,
      },
    });
    if (!res.ok) {
      stderr.write(`Abbruch: ${res.status} ${await res.text()}\n`);
      exit(1);
    }
    const page = await res.json();
    for (const row of page) yield row;
    if (page.length < PAGE) return;
  }
}

/** Nach RFC 4180: Anführungszeichen verdoppeln, heikle Felder einfassen. */
function cell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const TICKET_SPALTEN = ["code", "holder_name", "category", "note",
                        "redeemed_at", "redeemed_by_device"];

const [table, select, order, header, filter] = wantLog
  ? ["scan_log", "server_ts,client_ts,code,device_id,action,result,offline,reason",
     "server_ts.asc",
     ["server_ts", "client_ts", "code", "device_id", "action", "result", "offline", "reason"],
     ""]
  : nurEingeloest
  // Nur die eingelösten, in der Reihenfolge des Einlasses: die Liste, die
  // während des Festivals jemand sehen will.
  ? ["tickets", TICKET_SPALTEN.join(","), "redeemed_at.asc",
     TICKET_SPALTEN, "&redeemed_at=not.is.null"]
  : ["tickets", TICKET_SPALTEN.join(","), "code.asc", TICKET_SPALTEN, ""];

stdout.write(header.join(",") + "\n");

let n = 0;
for await (const row of rows(table, select, order, filter)) {
  stdout.write(header.map((k) => cell(row[k])).join(",") + "\n");
  n++;
}

stderr.write(`${n} Zeilen ausgeführt.\n`);
