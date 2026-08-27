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
    updated_at: "2026-08-01T00:00:00.000Z",
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

  if (p === "/api/reset") {
    for (const t of tickets.values()) { t.redeemed_at = null; t.redeemed_by_device = null;
      t.updated_at = "2026-08-01T00:00:00.000Z"; }
    scanLog.clear();
    return send(res, 200, { ok: true });
  }

  if (p === "/api/session" && req.method === "POST") {
    const b = await body(req);
    if (b.password !== "herzberg2027") return send(res, 401, { error: "Passwort stimmt nicht" });
    return send(res, 200, {
      token: "test-token", deviceId: b.deviceId ?? "geraet-1",
      label: b.label ?? "Test", expiresAt: Math.floor(Date.now()/1000) + 20*3600,
    });
  }

  if (p === "/api/changes") {
    if (req.headers.authorization !== "Bearer test-token") return send(res, 401, { error: "weg" });
    const since = url.searchParams.get("since");
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
    if (req.headers.authorization !== "Bearer test-token") return send(res, 401, { error: "weg" });
    const { scans } = await body(req);
    const results = scans.map((s) => {
      if (scanLog.has(s.scanId)) return scanLog.get(s.scanId);
      const t = tickets.get(s.code);
      let r;
      if (!t) r = { scanId: s.scanId, code: s.code, result: "unknown" };
      else if (s.action === "undo") {
        t.redeemed_at = null; t.redeemed_by_device = null;
        t.updated_at = new Date().toISOString();
        r = { scanId: s.scanId, code: s.code, result: "ok", redeemed_at: null, redeemed_by_device: null };
      } else if (t.redeemed_at) {
        r = { scanId: s.scanId, code: s.code, result: "duplicate",
              redeemed_at: t.redeemed_at, redeemed_by_device: t.redeemed_by_device };
      } else {
        t.redeemed_at = new Date().toISOString(); t.redeemed_by_device = "geraet-1";
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
    if (req.headers.authorization !== "Bearer test-token") return send(res, 401, { error: "weg" });
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
