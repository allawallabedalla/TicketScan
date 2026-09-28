// Nachgestellter Server: genau die Endpunkte, die die App aufruft, plus die
// gebaute App selbst als statische Dateien.
//
// 2305 Tickets im Speicher, Idempotenz über die scanId wie in der Datenbank,
// jedes neunte Ticket ohne Namen. Bewusst schlicht: Er soll die App prüfen,
// nicht das Backend — dafür gibt es scripts/smoke-test.mjs gegen Supabase.
//
//   node server.mjs dist 8123
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const DIST = process.argv[2];
const PORT = Number(process.argv[3] ?? 8123);

const N = 2305;

// Zeitstempel mit MIKROSEKUNDEN, wie PostgREST sie liefert.
//
// Das ist kein Detail: Der Endpunkt hat den Wert einmal durch `new Date()`
// geschickt und damit auf Millisekunden gekürzt — der Abgleichszeiger lief
// dadurch bei jeder Antwort ein Stück zurück, und bei tausend Zeilen mit
// demselben Zeitstempel blätterte die App endlos im Kreis. Ein Prüfstand mit
// Millisekunden kann diesen Fehler gar nicht zeigen, deshalb steht er hier.
let changesAufrufe = 0;
let folge = 0;
const stempel = () => {
  const ms = new Date().toISOString().slice(0, -1);
  return `${ms}${String(folge++ % 1000).padStart(3, "0")}+00:00`;
};
const tickets = new Map();
for (let i = 1; i <= N; i++) {
  const code = String(i).padStart(5, "0");
  tickets.set(code, {
    code,
    holder_name: i % 9 === 0 ? null : `Person ${i}`,
    category: "Festival-Ticket",
    note: null,
    redeemed_at: null,
    redeemed_by_device: null,
    updated_at: "2026-08-01T00:00:00.000000+00:00",
  });
}
const scanLog = new Map();          // scanId -> ergebnis (Idempotenz)
export const state = { tickets };

const TYPES = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css",
  ".json":"application/json", ".webmanifest":"application/manifest+json",
  ".png":"image/png", ".svg":"image/svg+xml", ".wasm":"application/wasm",
  ".traineddata":"application/octet-stream", ".gz":"application/octet-stream" };

function body(req) {
  return new Promise((res) => {
    let b = ""; req.on("data", (c) => b += c); req.on("end", () => res(b ? JSON.parse(b) : {}));
  });
}
const send = (res, code, obj) => {
  res.writeHead(code, { "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*", "access-control-allow-methods": "*" });
  res.end(JSON.stringify(obj));
};

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;

  if (req.method === "OPTIONS") { send(res, 204, {}); return; }

  // Alle Tickets auf einen Schlag anfassen, wie es reset-redemptions und der
  // Import tun: Danach tragen 2305 Zeilen DENSELBEN Zeitstempel — der Fall,
  // in dem der Abgleich vorher hängen blieb.
  if (p === "/api/beruehre-alle") {
    const jetzt = stempel();
    for (const t of tickets.values()) t.updated_at = jetzt;
    return send(res, 200, { ok: true, stempel: jetzt });
  }

  if (p === "/api/reset") {
    for (const t of tickets.values()) { t.redeemed_at = null; t.redeemed_by_device = null;
      t.updated_at = "2026-08-01T00:00:00.000000+00:00"; }
    scanLog.clear();
    return send(res, 200, { ok: true });
  }

  if (p === "/api/session" && req.method === "POST") {
    const b = await body(req);
    const admin = b.password === "nimda-test";
    if (b.password !== "herzberg2027" && !admin) {
      return send(res, 401, { error: "Passwort stimmt nicht" });
    }
    return send(res, 200, {
      token: admin ? "admin-token" : "test-token", deviceId: b.deviceId ?? "geraet-1",
      label: b.label ?? "Test", expiresAt: Math.floor(Date.now()/1000) + 20*3600,
      admin,
    });
  }

  if (p === "/api/verwaltung" && req.method === "POST") {
    if (req.headers.authorization !== "Bearer admin-token") {
      return send(res, 403, { error: "Dieses Gerät darf die Liste nicht ändern" });
    }
    // Nachbildung von stammdaten_schreiben (Migration 0006): ein fehlendes
    // Feld bleibt, null leert; Probelauf; neue Nummern nur mit Freigabe.
    const { zeilen, probe, neuAnlegen } = await body(req);
    const codes = zeilen.map((z) => z.code);
    const doppelt = codes.filter((c, i) => codes.indexOf(c) !== i);
    if (doppelt.length) return send(res, 400, { error: `Doppelte Nummern in der Liste: ${doppelt.join(", ")}` });
    const felder = { holderName: "holder_name", category: "category", note: "note", gesperrt: "gesperrt" };
    const bericht = { neu: 0, geaendert: 0, unveraendert: 0, neueCodes: [], aenderungen: [], geschrieben: !probe };
    for (const z of zeilen) {
      if (z.code.length !== 5) return send(res, 400, { error: `„${z.code}" hat ${z.code.length} statt 5 Stellen.` });
      const t = tickets.get(z.code);
      if (!t) {
        bericht.neu++; bericht.neueCodes.push(z.code);
        if (probe) continue;
        if (!neuAnlegen) return send(res, 400, { error: `Nummer ${z.code} steht nicht in der Liste.` });
        tickets.set(z.code, { code: z.code, holder_name: z.holderName ?? null,
          category: z.category ?? "Festival-Ticket", note: z.note ?? null,
          redeemed_at: null, redeemed_by_device: null, updated_at: stempel() });
        continue;
      }
      let diff = false;
      for (const [von, nach] of Object.entries(felder)) {
        if (!(von in z)) continue;
        const neu = nach === "category" ? (z[von] || "Festival-Ticket") : (z[von] || null);
        if (neu === (t[nach] ?? null)) continue;
        diff = true;
        bericht.aenderungen.push({ code: z.code, feld: nach, alt: t[nach], neu });
        if (!probe) t[nach] = neu;
      }
      if (diff) { bericht.geaendert++; if (!probe) t.updated_at = stempel(); }
      else bericht.unveraendert++;
    }
    return send(res, 200, bericht);
  }

  if (p === "/api/zaehler") return send(res, 200, { changes: changesAufrufe });

  if (p === "/api/changes") {
    changesAufrufe++;
    if (!["Bearer test-token","Bearer admin-token"].includes(req.headers.authorization)) return send(res, 401, { error: "weg" });
    let since = url.searchParams.get("since");
    // KAPUTT=1 stellt den behobenen Fehler nach: Der Endpunkt schnitt den
    // Zeitstempel auf Millisekunden zurück, der Zeiger lief damit rückwärts.
    // Damit lässt sich prüfen, dass der Schutz in sync.ts wirklich greift —
    // ein Test, der nur auf der heilen Fassung läuft, prüft nichts.
    if (since && process.env.KAPUTT) since = new Date(since).toISOString();
    const sinceCode = url.searchParams.get("sinceCode");
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const PAGE = 1000;
    let rows = [...tickets.values()];
    let out;
    if (since) {
      rows = rows.filter((t) => t.updated_at > since || (t.updated_at === since && sinceCode && t.code > sinceCode));
      rows.sort((a,b) => a.updated_at.localeCompare(b.updated_at) || a.code.localeCompare(b.code));
      out = rows.slice(0, PAGE);
    } else {
      rows.sort((a,b) => a.code.localeCompare(b.code));
      out = rows.slice(offset, offset + PAGE);
    }
    const last = out.at(-1);
    return send(res, 200, {
      tickets: out, more: out.length === PAGE,
      nextOffset: since ? null : offset + out.length,
      cursor: last?.updated_at ?? since, cursorCode: last?.code ?? sinceCode,
      serverTime: new Date().toISOString(),
    });
  }

  if (p === "/api/scans" && req.method === "POST") {
    if (!["Bearer test-token","Bearer admin-token"].includes(req.headers.authorization)) return send(res, 401, { error: "weg" });
    const { scans } = await body(req);
    const results = scans.map((s) => {
      if (scanLog.has(s.scanId)) return scanLog.get(s.scanId);
      const t = tickets.get(s.code);
      let r;
      if (!t) r = { scanId: s.scanId, code: s.code, result: "unknown" };
      else if (s.action === "undo") {
        // Wie 0005: Mit undoOf nur die gemeinte Einlösung zurücknehmen.
        if (!t.redeemed_at || (s.undoOf && t.redeemed_scan !== s.undoOf)) {
          r = { scanId: s.scanId, code: s.code, result: "unknown",
                redeemed_at: t.redeemed_at, redeemed_by_device: t.redeemed_by_device };
        } else {
          t.redeemed_at = null; t.redeemed_by_device = null; t.redeemed_scan = null;
          t.updated_at = stempel();
          r = { scanId: s.scanId, code: s.code, result: "ok", redeemed_at: null, redeemed_by_device: null };
        }
      } else if (t.gesperrt && !t.redeemed_at) {
        // Wie 0007: gesperrt wird nie eingelöst.
        r = { scanId: s.scanId, code: s.code, result: "gesperrt", redeemed_at: null, redeemed_by_device: null };
      } else if (t.redeemed_at) {
        r = { scanId: s.scanId, code: s.code, result: "duplicate",
              redeemed_at: t.redeemed_at, redeemed_by_device: t.redeemed_by_device };
      } else {
        t.redeemed_at = stempel(); t.redeemed_by_device = "geraet-1"; t.redeemed_scan = s.scanId;
        t.updated_at = t.redeemed_at;
        r = { scanId: s.scanId, code: s.code, result: "ok",
              redeemed_at: t.redeemed_at, redeemed_by_device: t.redeemed_by_device };
      }
      scanLog.set(s.scanId, r);
      return r;
    });
    return send(res, 200, { results });
  }

  if (p === "/api/stats") {
    if (!["Bearer test-token","Bearer admin-token"].includes(req.headers.authorization)) return send(res, 401, { error: "weg" });
    if (req.method === "POST") { await body(req); return send(res, 200, { ok: true }); }
    const eingeloest = [...tickets.values()].filter((t) => t.redeemed_at).length;
    return send(res, 200, {
      eingeloest, gesamt: N,
      geraete: [{ device_id: "geraet-1", label: "Nordeingang 2",
                  last_seen_at: new Date().toISOString(), revoked_at: null }],
      konflikte: [], konflikteGesamt: 0, ungeprueft: [],
      baendchen: null, abweichung: null, serverTime: new Date().toISOString(),
    });
  }

  // Statische Dateien
  let file = join(DIST, p === "/" ? "index.html" : p);
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, "index.html");
  const t = TYPES[extname(file)] ?? "application/octet-stream";
  res.writeHead(200, { "content-type": t, "cache-control": "no-store" });
  res.end(readFileSync(file));
}).listen(PORT, () => console.log("bereit auf " + PORT));
