// Prüft die Wahl am Anfang: Einlass scannen oder Ticketliste pflegen.
//
// Der Anlass war ein Bedienfehler, den ich selbst gebaut habe: Die Verwaltung
// versteckte sich hinter einem zweiten Passwort, von dem auf dem
// Anmeldebildschirm nichts stand — und wer schon angemeldet war, kam gar
// nicht mehr dorthin zurück, weil es kein Abmelden gab.
//
//   node anmeldung.mjs
//
// Setzt einen laufenden server.mjs voraus, siehe README.md.

import { chromium } from "playwright";
await fetch("http://127.0.0.1:8123/api/reset");
const b = await chromium.launch({ ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
  args:["--use-fake-ui-for-media-stream","--use-fake-device-for-media-capture"] });
const fehler=[]; const log=[]; const ok=m=>log.push("  ok   "+m); const bad=m=>log.push("FEHLER "+m);
const tab = async (w=390,h=844) => {
  const ctx = await b.newContext({ viewport:{width:w,height:h}, deviceScaleFactor:2, permissions:["camera"], locale:"de-DE" });
  const page = await ctx.newPage(); page.on("pageerror",e=>fehler.push(e.message)); return page;
};

let p = await tab();
await p.goto("http://127.0.0.1:8123/"); await p.waitForTimeout(1200);
for(let i=0;i<12;i++){const w=p.getByRole("button",{name:/weiter|los geht|verstanden|schließen|überspringen|fertig/i});
  if(await w.count()===0)break; await w.first().click().catch(()=>{}); await p.waitForTimeout(200);}
let t = await p.locator("body").innerText();
if (/Einlass scannen/.test(t) && /Ticketliste pflegen/.test(t)) ok("Zwei Knöpfe am Anfang");
else bad("Auswahl fehlt: "+t.replace(/\n/g," | ").slice(0,240));
await p.screenshot({path:"./wahl-01.png"});

// Falsches Passwort für die Verwaltung -> klare Meldung
await p.getByRole("button",{name:/Ticketliste pflegen/i}).click(); await p.waitForTimeout(400);
await p.locator('input[type="password"]').first().fill("herzberg2027");
await p.locator('input[type="text"]').first().fill("Laptop Büro");
await p.getByRole("button",{name:/^Anmelden$/i}).click(); await p.waitForTimeout(3000);
t = await p.locator("body").innerText();
if (/Einlasspasswort/.test(t)) ok("Falsches Passwort wird benannt");
else bad("keine Meldung: "+t.replace(/\n/g," | ").slice(0,240));
await p.screenshot({path:"./wahl-02-falsch.png"});

// Richtiges Verwaltungspasswort -> landet direkt in der Verwaltung
await p.locator('input[type="password"]').first().fill("nimda-test");
await p.getByRole("button",{name:/^Anmelden$/i}).click(); await p.waitForTimeout(9000);
const s=p.getByRole("button",{name:/Scanner öffnen/i}); if(await s.count()) await s.click();
await p.waitForTimeout(2500);
t = await p.locator("body").innerText();
if (/Ticketliste pflegen/.test(t) && /Liste einfügen/.test(t)) ok("Landet direkt in der Verwaltung");
else bad("nicht in der Verwaltung: "+t.replace(/\n/g," | ").slice(0,240));
await p.screenshot({path:"./wahl-03-verwaltung.png"});

// Scanner-Weg
p = await tab();
await p.goto("http://127.0.0.1:8123/"); await p.waitForTimeout(1200);
for(let i=0;i<12;i++){const w=p.getByRole("button",{name:/weiter|los geht|verstanden|schließen|überspringen|fertig/i});
  if(await w.count()===0)break; await w.first().click().catch(()=>{}); await p.waitForTimeout(200);}
await p.getByRole("button",{name:/Einlass scannen/i}).click(); await p.waitForTimeout(400);
await p.locator('input[type="password"]').first().fill("herzberg2027");
await p.locator('input[type="text"]').first().fill("Nordeingang 2");
await p.getByRole("button",{name:/^Anmelden$/i}).click(); await p.waitForTimeout(9000);
const s2=p.getByRole("button",{name:/Scanner öffnen/i}); if(await s2.count()) await s2.click();
await p.waitForTimeout(1500);
t = await p.locator("body").innerText();
if (/Tastatur/.test(t) && !/Ticketliste pflegen/.test(t)) ok("Einlassweg landet im Scanner");
else bad("Einlassweg: "+t.replace(/\n/g," | ").slice(0,240));
await p.screenshot({path:"./wahl-04-scanner.png"});

console.log(log.join("\n"));
console.log("SEITENFEHLER:", fehler.length?fehler:"keine");
await b.close();
