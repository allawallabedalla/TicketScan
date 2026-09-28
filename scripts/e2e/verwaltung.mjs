// Prüft die Verwaltungsansicht: Wer sie sehen darf, was sie schreibt, und was
// sie ablehnt.
//
// Der wichtigste Fall steht ganz oben: Ein Gerät, das sich mit dem
// Eventpasswort angemeldet hat, darf die Ticketliste NICHT bearbeiten und
// bekommt den Abschnitt gar nicht erst zu sehen.
//
//   node verwaltung.mjs
//
// Setzt einen laufenden server.mjs voraus, siehe README.md.

import { chromium } from "playwright";
await fetch("http://127.0.0.1:8123/api/reset");
const b = await chromium.launch({ ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
  args:["--use-fake-ui-for-media-stream","--use-fake-device-for-media-capture"] });
const fehler=[];
const neuerTab = async () => {
  const ctx = await b.newContext({ viewport:{width:390,height:844}, permissions:["camera"], locale:"de-DE" });
  const page = await ctx.newPage();
  page.on("pageerror", e => fehler.push(e.message));
  return page;
};
let p = await neuerTab();
const log=[]; const ok=m=>log.push("  ok   "+m); const bad=m=>log.push("FEHLER "+m);

async function anmelden(pw) {
  await p.goto("http://127.0.0.1:8123/");
  await p.waitForTimeout(1200);
  for(let i=0;i<12;i++){const w=p.getByRole("button",{name:/weiter|los geht|verstanden|schließen|überspringen|fertig/i});
    if(await w.count()===0)break; await w.first().click().catch(()=>{}); await p.waitForTimeout(200);}
  // Seit der Wahl am Anfang steht davor „Einlass scannen" / „Ticketliste pflegen".
  const wahl = p.getByRole("button", { name: pw === "herzberg2027" ? /Einlass scannen/ : /Ticketliste pflegen/ });
  if (await wahl.count()) { await wahl.first().click(); await p.waitForTimeout(300); }
  await p.locator('input[type="password"]').first().fill(pw);
  await p.locator('input[type="text"]').first().fill("Nordeingang 2");
  await p.getByRole("button",{name:/anmelden|weiter|start/i}).first().click();
  await p.waitForTimeout(6000);
  const s = p.getByRole("button",{name:/Scanner öffnen/i});
  if (await s.count()) await s.click();
  await p.waitForTimeout(1000);
}

// 1) Normales Eventpasswort: kein Verwaltungsabschnitt
await anmelden("herzberg2027");
let sichtbar = await p.locator("body").innerText();
if (!/Verwaltungspasswort|Ich soll die Ticketliste/.test(sichtbar)) ok("Anmeldung zeigt kein Verwaltungsfeld");
else bad("Verwaltungsfeld ist sichtbar");
await p.getByRole("button",{name:/Übersicht/i}).click();
await p.waitForTimeout(1500);
let t = await p.locator("body").innerText();
if (!/Ticketliste pflegen/.test(t)) ok("Eventpasswort sieht die Verwaltung nicht");
else bad("Verwaltung auch ohne Adminrecht sichtbar");
await p.screenshot({path:"./adm-01-ohne.png"});

// 2) Adminpasswort — frischer Tab, damit die Einrichtung neu läuft
p = await neuerTab();
await anmelden("nimda-test");
await p.waitForTimeout(2000);
// Wer „Ticketliste pflegen" gewählt hat, landet seit der Wahl am Anfang
// direkt in der Verwaltung — dann ist der Weg über die Übersicht nicht nötig.
if (await p.locator(".tabs").count()) {
  ok("Adminpasswort schaltet die Verwaltung frei (direkt geöffnet)");
} else {
  await p.getByRole("button",{name:/Übersicht/i}).click();
  await p.waitForTimeout(1800);
  t = await p.locator("body").innerText();
  if (/Ticketliste pflegen/.test(t)) ok("Adminpasswort schaltet die Verwaltung frei");
  else bad("Verwaltung fehlt trotz Adminpasswort: "+t.slice(0,250));
  await p.getByRole("button",{name:/Liste bearbeiten/i}).click();
  await p.waitForTimeout(900);
}
await p.screenshot({path:"./adm-02-verwaltung.png"});

// 3) Einzelne Änderung
await p.getByPlaceholder(/Nummer oder Name suchen/i).fill("00042");
await p.waitForTimeout(700);
await p.getByRole("button",{name:/^Ändern$/i}).first().click();
await p.waitForTimeout(500);
const namensfeld = p.locator('.field input').first();
await namensfeld.fill("Jojo Testmann");
await p.getByRole("button",{name:/^Speichern$/i}).click();
await p.waitForTimeout(1500);
t = await p.locator("body").innerText();
if (/gespeichert/.test(t)) ok("Einzelne Änderung gespeichert");
else bad("Einzelspeichern: "+t.slice(0,200));
await p.screenshot({path:"./adm-03-einzeln.png"});

// 4) Liste einfügen
await p.locator(".tab", { hasText: /Liste einfügen/ }).click();
await p.waitForTimeout(400);
// Semikolon als Trennzeichen, und ein Name MIT Komma darin: Der wurde
// früher an allen drei Trennzeichen zugleich zerlegt.
await p.locator("textarea").fill("code;name\n00100; Anna Weber\n00101; Weber, Ben\n00102;;VIP");
await p.waitForTimeout(600);
t = await p.locator("body").innerText();
if (/3 Zeilen erkannt/.test(t)) ok("Vorschau liest 3 Zeilen"); else bad("Vorschau: "+t.slice(0,300));
if (/Weber, Ben/.test(t)) ok("Komma im Namen bleibt im Namen"); else bad("Komma zerlegt den Namen");
await p.screenshot({path:"./adm-04-liste.png"});
await p.evaluate(() => [...document.querySelectorAll("button")].find(b => /Zeilen prüfen/.test(b.textContent))?.click());
await p.waitForTimeout(1500);
t = await p.locator("body").innerText();
if (/geändert/.test(t) && /unverändert/.test(t)) ok("Probelauf zeigt Änderungen"); else bad("Probelauf: "+t.slice(0,300));
await p.evaluate(() => [...document.querySelectorAll("button")].find(b => /Änderungen übernehmen/.test(b.textContent))?.click());
await p.waitForTimeout(3000);
t = await p.locator("body").innerText();
if (/Übernommen/.test(t)) ok("Liste übernommen"); else bad("Übernehmen: "+t.slice(0,300));

// 4b) Leere Felder löschen nichts: Nur-Nummer-Zeile ändert Anna Weber nicht
await p.locator("textarea").fill("00100\n00101");
await p.waitForTimeout(400);
await p.evaluate(() => [...document.querySelectorAll("button")].find(b => /Zeilen prüfen/.test(b.textContent))?.click());
await p.waitForTimeout(1500);
t = await p.locator("body").innerText();
if (/0 geändert/.test(t.replace(/\s+/g, " "))) ok("Nur Nummern ändern nichts"); else bad("Leere Felder: "+t.slice(0,300));

// 4c) Doppelte Nummer wird erkannt
await p.locator("textarea").fill("00100; A\n00100; B");
await p.waitForTimeout(400);
t = await p.locator("body").innerText();
if (/Doppelte Nummern/.test(t)) ok("Doppelte Nummer erkannt"); else bad("Dubletten: "+t.slice(0,300));

// 5) Fehlende führende Nullen werden abgefangen
await p.locator("textarea").fill("100, Anna\n00101, Ben");
await p.waitForTimeout(600);
t = await p.locator("body").innerText();
if (/führenden Nullen/.test(t)) ok("Verlorene führende Nullen erkannt"); else bad("Nullenprüfung: "+t.slice(0,300));
const gesperrt = await p.evaluate(() => [...document.querySelectorAll("button")].find(b => /Zeilen prüfen/.test(b.textContent))?.disabled);
if (gesperrt) ok("Übernehmen ist dann gesperrt"); else bad("Übernehmen nicht gesperrt");
await p.screenshot({path:"./adm-05-nullen.png"});

// 6) Kommt die Änderung im Scanner an?
await p.evaluate(() => [...document.querySelectorAll("button")].find(b => /Schließen/.test(b.textContent))?.click());
await p.waitForTimeout(400);
await p.evaluate(() => [...document.querySelectorAll("button")].find(b => /Schließen/.test(b.textContent))?.click());
await p.waitForTimeout(1000);
await p.getByRole("button",{name:/Tastatur/i}).click();
await p.waitForTimeout(400);
for (const z of "0042") await p.locator(`.key:not(.soft):not(.go)`,{hasText:new RegExp(`^${z}$`)}).first().click();
await p.locator(".key.go").click();
await p.waitForTimeout(900);
t = await p.locator("body").innerText();
if (/Jojo Testmann/.test(t)) ok("Neuer Name steht im Bestätigungsschritt");
else bad("Name kommt nicht an: "+t.replace(/\n/g," ").slice(0,220));
await p.screenshot({path:"./adm-06-scan.png"});

console.log(log.join("\n"));
console.log("SEITENFEHLER:", fehler.length?fehler:"keine");
await b.close();
