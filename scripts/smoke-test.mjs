#!/usr/bin/env node
// Prüft die komplette Kette in einem Durchlauf: Sind die Endpunkte da, ist
// das Passwort gesetzt, steht das Schema, liegen Tickets in der Datenbank?
//
// Gedacht für direkt nach der Einrichtung — und noch einmal am Vorabend des
// Festivals. Bucht nichts und ändert nichts.
//
//   TICKETSCAN_API=https://<ref>.supabase.co/functions/v1 \
//   TICKETSCAN_EVENT_PASSWORD=... \
//   node scripts/smoke-test.mjs

import { env, exit, stderr } from "node:process";

const API = env.TICKETSCAN_API?.replace(/\/$/, "");
const PASSWORD = env.TICKETSCAN_EVENT_PASSWORD;

if (!API || !PASSWORD) {
  stderr.write("TICKETSCAN_API und TICKETSCAN_EVENT_PASSWORD müssen gesetzt sein.\n");
  exit(1);
}

let failed = 0;
const results = [];

function record(ok, name, detail) {
  results.push({ ok, name, detail });
  if (!ok) failed++;
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

// 2 — Anmeldung mit dem echten Passwort.
const session = await step("Anmeldung mit dem echten Passwort", async () => {
  const res = await fetch(`${API}/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: PASSWORD, label: "Smoke-Test" }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `${res.status}`);
  if (!data.token) throw new Error("kein Token in der Antwort");
  return `Gerätekennung ${String(data.deviceId).slice(0, 8)}…`;
});

// 3 — Läuft die Tagesgrenze in Ortszeit ab, nicht in UTC?
if (session) {
  await step("Tagesgrenze liegt in deutscher Ortszeit", async () => {
    const res = await fetch(`${API}/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: PASSWORD, label: "Smoke-Test" }),
    });
    const { expiresAt } = await res.json();
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
  const token = await (async () => {
    const res = await fetch(`${API}/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: PASSWORD, label: "Smoke-Test" }),
    });
    return (await res.json()).token;
  })();

  await step("Ticketliste abrufbar", async () => {
    const res = await fetch(`${API}/changes`, { headers: { authorization: `Bearer ${token}` } });
    if (res.status === 500) throw new Error("500 — ist die Migration eingespielt?");
    if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 120)}`);

    const { tickets } = await res.json();
    if (!Array.isArray(tickets)) throw new Error("unerwartete Antwort");
    if (tickets.length === 0) {
      throw new Error("0 Tickets — Liste noch nicht importiert (scripts/import-tickets.mjs)");
    }

    const codes = tickets.map((t) => t.code).sort();
    const offen = tickets.filter((t) => !t.redeemed_at).length;
    return `${tickets.length} Tickets, ${codes[0]} – ${codes.at(-1)}, ${offen} noch nicht eingelöst`;
  });

  await step("Abgelaufenes Token wird abgewiesen", async () => {
    const res = await fetch(`${API}/changes`, { headers: { authorization: "Bearer kaputt.kaputt" } });
    if (res.status !== 401) throw new Error(`erwartet 401, bekam ${res.status}`);
    return "401 wie erwartet";
  });
}

// ------------------------------------------------------------------ Bericht --

stderr.write("\n");
for (const { ok, name, detail } of results) {
  stderr.write(`  ${ok ? "ok  " : "FEHL"}  ${name.padEnd(42)} ${detail ?? ""}\n`);
}
stderr.write(
  failed === 0
    ? "\nAlles steht. Die App kann gegen dieses Backend arbeiten.\n"
    : `\n${failed} von ${results.length} Prüfungen fehlgeschlagen.\n`,
);
exit(failed === 0 ? 0 : 1);
