// Prüft, dass die Ticketliste in der Verwaltung ein Filter ist und kein
// Suchschlitz: leeres Feld zeigt alles, jede Eingabe engt ein.
//
//   node verwaltung-filter.mjs

import { chromium } from "playwright";
await fetch("http://127.0.0.1:8123/api/reset");
const b = await chromium.launch({ ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
  args:["--use-fake-ui-for-media-stream","--use-fake-device-for-media-capture"] });
const ctx = await b.newContext({ viewport:{width:1100,height:800}, permissions:["camera"], locale:"de-DE" });
const p = await ctx.newPage();
const fehler=[]; p.on("pageerror",e=>fehler.push(e.message));
const log=[]; const ok=m=>log.push("  ok   "+m); const bad=m=>log.push("FEHLER "+m);

await p.goto("http://127.0.0.1:8123/"); await p.waitForTimeout(1200);
for(let i=0;i<12;i++){const w=p.getByRole("button",{name:/weiter|los geht|verstanden|schließen|überspringen|fertig/i});
  if(await w.count()===0)break; await w.first().click().catch(()=>{}); await p.waitForTimeout(200);}
await p.getByRole("button",{name:/Ticketliste pflegen/i}).click(); await p.waitForTimeout(400);
await p.locator('input[type="password"]').first().fill("nimda-test");
await p.locator('input[type="text"]').first().fill("Laptop Buero");
await p.getByRole("button",{name:/^Anmelden$/i}).click(); await p.waitForTimeout(9000);
const s=p.getByRole("button",{name:/Scanner öffnen/i}); if(await s.count()) await s.click();
await p.waitForTimeout(2500);

let n = await p.locator(".entries.roster li").count();
if (n > 0) ok(`Leeres Feld zeigt Zeilen (${n})`); else bad("leeres Feld zeigt nichts");
let t = await p.locator("body").innerText();
if (/2305 Tickets/.test(t)) ok("Gesamtzahl steht dran"); else bad("keine Gesamtzahl: "+t.replace(/\n/g," | ").slice(0,200));
await p.screenshot({path:"./filter-01-leer.png"});

// Blättern lädt nach
for (let i=0;i<4;i++){
  await p.evaluate(()=>{const el=document.querySelector(".sheet.overlay.list"); if(el) el.scrollTop=el.scrollHeight;});
  await p.waitForTimeout(700);
}
const n2 = await p.locator(".entries.roster li").count();
if (n2 > n) ok(`Nachladen beim Blättern: ${n} → ${n2}`); else bad(`kein Nachladen: ${n} → ${n2}`);

// Eine Ziffer filtert schon
await p.getByPlaceholder(/Nummer oder Name suchen/i).fill("7");
await p.waitForTimeout(800);
t = await p.locator("body").innerText();
if (/Treffer/.test(t)) ok("Eine Ziffer filtert bereits"); else bad("kein Filter bei einer Ziffer: "+t.slice(0,200));
await p.screenshot({path:"./filter-02-ziffer.png"});

// Leeren zeigt wieder alles
await p.getByPlaceholder(/Nummer oder Name suchen/i).fill("");
await p.waitForTimeout(800);
t = await p.locator("body").innerText();
if (/2305 Tickets/.test(t)) ok("Leeren zeigt wieder alles"); else bad("nach dem Leeren: "+t.slice(0,200));

console.log(log.join("\n"));
console.log("SEITENFEHLER:", fehler.length?fehler:"keine");
await b.close();
