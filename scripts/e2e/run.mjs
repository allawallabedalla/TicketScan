// Fährt die gebaute App im Browser durch den ganzen Ablauf am Eingang.
//
// Siehe README.md daneben. Kurz: Dieser Durchlauf hat Fehler gefunden, die
// drei Leseläufe übersehen haben — darunter einen, der die ganze App leer
// werden ließ. Er gehört vor jede Veröffentlichung.
//
//   node run.mjs
//
// CHROMIUM=/pfad/zu/chrome setzt einen eigenen Browser, sonst nimmt Playwright
// den eigenen.

import { chromium } from "playwright";

const shot = (p, n) => p.screenshot({ path: `./${n}.png` });
const log = [];
const ok = (m) => { log.push("  ok   " + m); };
const bad = (m) => { log.push("FEHLER " + m); };


async function tippe(p, code) {
  if (await p.locator(".keypad").count() === 0 || !(await p.locator(".keypad").isVisible())) {
    await p.getByRole("button", { name: /Tastatur/i }).click();
    await p.waitForTimeout(400);
  }
  // Eventuelle Reste löschen
  for (let i = 0; i < 6; i++) await p.locator(".key.soft").click().catch(() => {});
  for (const z of code) await p.locator(`.key:not(.soft):not(.go)`, { hasText: new RegExp(`^${z}$`) }).first().click();
  await p.waitForTimeout(200);
  await p.locator(".key.go").click();
  await p.waitForTimeout(700);
}

await fetch("http://127.0.0.1:8123/api/reset");

const b = await chromium.launch({
  ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-capture"],
});
const ctx = await b.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
  permissions: ["camera"], locale: "de-DE",
});
const p = await ctx.newPage();
const fehler = [];
p.on("pageerror", (e) => fehler.push("pageerror: " + e.message));
p.on("console", (m) => { if (m.type() === "error") fehler.push("console: " + m.text()); });

await p.goto("http://127.0.0.1:8123/");
await p.waitForTimeout(1500);
await shot(p, "01-start");

// Quick Guide wegklicken, falls er kommt
for (let i = 0; i < 12; i++) {
  const weiter = p.getByRole("button", { name: /weiter|los geht|verstanden|schließen|überspringen|fertig/i });
  if (await weiter.count() === 0) break;
  await weiter.first().click().catch(() => {});
  await p.waitForTimeout(250);
}
await shot(p, "02-nach-guide");

// Anmeldung
const pw = p.locator('input[type="password"], input[name="password"]').first();
if (await pw.count()) {
  await pw.fill("herzberg2027");
  const label = p.locator('input[type="text"]').first();
  if (await label.count()) await label.fill("Nordeingang 2");
  await p.getByRole("button", { name: /anmelden|weiter|start/i }).first().click();
  ok("Anmeldung abgeschickt");
} else bad("kein Passwortfeld gefunden");
await p.waitForTimeout(1200);
await shot(p, "03-nach-anmeldung");

// Einrichtung: Ticketliste laden
for (let i = 0; i < 40; i++) {
  const t = await p.getByText(/2305|Liste|Tastatur/).count();
  if (t) break;
  const knopf = p.getByRole("button", { name: /laden|einrichten|weiter|starten|los/i });
  if (await knopf.count()) await knopf.first().click().catch(() => {});
  await p.waitForTimeout(700);
}
await p.waitForTimeout(2500);
await shot(p, "04-eingerichtet");

// --------------------------------------------------------- Scanner öffnen --
await p.getByRole("button", { name: /Scanner öffnen/i }).click();
await p.waitForTimeout(1200);
await shot(p, "05-scanner");

// Ticket 00042 über die Tastatur einlassen
await tippe(p, "0042");
await shot(p, "07-bestaetigung");
let text = await p.locator("body").innerText();
if (/Gültig/.test(text)) ok("Bestätigungsschritt erscheint"); else bad("kein Bestätigungsschritt: " + text.slice(0,200));
if (/Person 42/.test(text)) ok("Name steht in der Bestätigung"); else bad("kein Name in der Bestätigung");

await p.getByRole("button", { name: /^Einlassen$/i }).click();
await p.waitForTimeout(600);
await shot(p, "08-ergebnis");
text = await p.locator("body").innerText();
if (/Einlass frei/.test(text)) ok("Grüne Rückmeldung"); else bad("keine grüne Rückmeldung: " + text.slice(0,200));
if (/Person 42/.test(text)) ok("Name auch im Ergebnis"); else bad("kein Name im Ergebnis");

await p.waitForTimeout(2000);

// Dasselbe Ticket noch einmal -> muss als bereits eingelöst erkannt werden
await tippe(p, "0042");
await shot(p, "09-doppelt");
text = await p.locator("body").innerText();
if (/Bereits eingelöst/.test(text)) ok("Doppelscan erkannt"); else bad("Doppelscan NICHT erkannt: " + text.slice(0,250));
if (/Trotzdem einlassen/.test(text)) ok("Freigabeknopf vorhanden"); else bad("kein Freigabeknopf");
if (!/zurücknehmen/i.test(text)) ok("kein Vertipper-Vorschlag mehr"); else bad("Vertipper-Vorschlag noch da");
await p.getByRole("button", { name: /^Abweisen$/i }).click();
await p.waitForTimeout(500);

// Unbekannte Nummer
await tippe(p, "9999");
await shot(p, "10-unbekannt");
text = await p.locator("body").innerText();
if (/Unbekannte Nummer/.test(text)) ok("Unbekannte Nummer erkannt"); else bad("unbekannte Nummer nicht erkannt: " + text.slice(0,200));
if (await p.getByRole("button", { name: /weiter/i }).count()) await p.getByRole("button", { name: /weiter/i }).first().click();
await p.waitForTimeout(400);

// --------------------------------------------------------------- Liste --
await p.getByRole("button", { name: /^Liste$/i }).click();
await p.waitForTimeout(900);
await shot(p, "11-liste");
text = await p.locator("body").innerText();
if (/Alle\s*2305/.test(text.replace(/\n/g, " "))) ok("Liste zeigt 2305"); else bad("Liste zeigt nicht 2305: " + text.slice(0,300));
if (/Eingelöst\s*1/.test(text.replace(/\n/g, " "))) ok("Zähler Eingelöst = 1"); else bad("Zähler Eingelöst falsch: " + text.replace(/\n/g," ").slice(0,300));

// Suche nach Nummer
await p.getByPlaceholder(/Nummer oder Name/i).fill("42");
await p.waitForTimeout(600);
await shot(p, "12-suche-nummer");
text = await p.locator("body").innerText();
if (/00 04 2/.test(text)) ok("Suche über Nummer findet 00042"); else bad("Suche über Nummer findet nichts: " + text.slice(0,300));

// Suche nach Name
await p.getByPlaceholder(/Nummer oder Name/i).fill("Person 777");
await p.waitForTimeout(600);
await shot(p, "13-suche-name");
text = await p.locator("body").innerText();
if (/00 77 7/.test(text)) ok("Suche über Namen findet das Ticket"); else bad("Suche über Namen findet nichts: " + text.replace(/\n/g," ").slice(0,300));

// Reiter Offen
await p.getByPlaceholder(/Nummer oder Name/i).fill("");
await p.waitForTimeout(400);
await p.getByRole("button", { name: /^Offen/i }).click();
await p.waitForTimeout(600);
await shot(p, "14-offen");

// Blättern: lädt nach?
await p.evaluate(() => { const el = document.querySelector(".sheet.list"); if (el) el.scrollTop = el.scrollHeight; });
await p.waitForTimeout(900);
await p.evaluate(() => { const el = document.querySelector(".sheet.list"); if (el) el.scrollTop = el.scrollHeight; });
await p.waitForTimeout(900);
const zeilen = await p.locator(".entries.roster li").count();
if (zeilen > 120) ok(`Nachladen beim Blättern: ${zeilen} Zeilen`); else bad(`Nachladen greift nicht: ${zeilen} Zeilen`);
await shot(p, "15-geblaettert");

await p.getByRole("button", { name: /Schließen/i }).first().click();
await p.waitForTimeout(500);

// --------------------------------------------------------------- Verlauf --
await p.getByRole("button", { name: /^Verlauf$/i }).click();
await p.waitForTimeout(700);
await shot(p, "16-verlauf");
text = await p.locator("body").innerText();
if (/00 04 2/.test(text)) ok("Verlauf zeigt den Vorgang"); else bad("Verlauf leer: " + text.slice(0,250));
if (await p.getByRole("button", { name: /Zurücknehmen/i }).count()) {
  await p.getByRole("button", { name: /Zurücknehmen/i }).first().click();
  await p.waitForTimeout(1500);
  await shot(p, "17-zurueckgenommen");
  ok("Rücknahme ausgelöst");
} else bad("kein Zurücknehmen-Knopf");
await p.getByRole("button", { name: /Schließen/i }).first().click();
await p.waitForTimeout(1200);

// Nach der Rücknahme: Liste muss das Ticket wieder als offen führen
await p.getByRole("button", { name: /^Liste$/i }).click();
await p.waitForTimeout(1200);
await p.getByPlaceholder(/Nummer oder Name/i).fill("00042");
await p.waitForTimeout(700);
await shot(p, "18-nach-ruecknahme");
text = await p.locator("body").innerText();
if (/noch nicht eingelöst/.test(text)) ok("Ticket nach Rücknahme wieder offen");
else bad("Ticket nach Rücknahme NICHT offen: " + text.replace(/\n/g," ").slice(0,300));
await p.getByRole("button", { name: /Schließen/i }).first().click();
await p.waitForTimeout(400);

// ------------------------------------------------------------- Übersicht --
await p.getByRole("button", { name: /Übersicht/i }).click();
await p.waitForTimeout(1200);
await shot(p, "19-uebersicht");
text = await p.locator("body").innerText();
if (/2305/.test(text)) ok("Übersicht zeigt Kennzahlen"); else bad("Übersicht ohne Kennzahlen: " + text.slice(0,300));
await p.getByRole("button", { name: /Schließen/i }).first().click();
await p.waitForTimeout(400);

// ------------------------------------------------------------- Ohne Netz --
await ctx.setOffline(true);
await tippe(p, "0100");
text = await p.locator("body").innerText();
if (/Gültig/.test(text)) ok("Entscheidung fällt auch ohne Netz");
else bad("ohne Netz keine Entscheidung: " + text.slice(0,200));
await p.getByRole("button", { name: /^Einlassen$/i }).click();
await p.waitForTimeout(3000);
await shot(p, "20-ohne-netz");
text = await p.locator("body").innerText();
if (/wartet|warten|kein Kontakt/.test(text)) ok("Statuszeile meldet die Warteschlange");
else bad("Statuszeile meldet ohne Netz nichts: " + text.replace(/\n/g," ").slice(-200));

await ctx.setOffline(false);
await p.waitForTimeout(9000);
await shot(p, "21-wieder-online");
text = await p.locator("body").innerText();
if (/alles gesendet/.test(text)) ok("Warteschlange nach Netzrückkehr geleert");
else bad("Warteschlange bleibt stehen: " + text.replace(/\n/g," ").slice(-200));

console.log("SICHTBAR:", (await p.locator("body").innerText()).slice(0, 400).replace(/\n+/g, " | "));
console.log(log.join("\n"));
console.log("SEITENFEHLER:", fehler.length ? fehler.join("\n") : "keine");
await ctx.close(); await b.close();
