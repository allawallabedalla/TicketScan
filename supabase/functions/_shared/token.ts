// Gerätetokens: signiert mit HMAC-SHA256, gültig bis zur Tagesgrenze.
//
// Die Grenze liegt bewusst bei 6 Uhr morgens und nicht 24 Stunden nach der
// Anmeldung — so fällt der Ablauf nie in eine laufende Nachtschicht.

const encoder = new TextEncoder();

export interface DeviceClaims {
  deviceId: string;
  label: string;
  expiresAt: number; // Unix-Sekunden
  /**
   * Darf die Stammdaten der Ticketliste ändern.
   *
   * Bewusst ein eigenes Recht mit eigenem Passwort: Das Eventpasswort kennen
   * am Festivalwochenende zehn Ehrenamtliche. Wer Namen nachträgt oder
   * Tickets ergänzt, ist eine andere Person mit einer anderen Aufgabe — und
   * das Recht, die Liste zu verändern, gehört nicht auf jedes Telefon am
   * Eingang.
   */
  admin?: boolean;
}

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function unb64url(text: string): Uint8Array {
  const padded = text.replaceAll("-", "+").replaceAll("_", "/")
    .padEnd(Math.ceil(text.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function key(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" },
    false, ["sign", "verify"],
  );
}

/** Versatz einer Zeitzone gegenüber UTC zum gegebenen Zeitpunkt, in Millisekunden. */
function zoneOffset(at: Date, zone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(at).map((p) => [p.type, p.value]),
  );
  const wall = Date.UTC(
    +parts.year, +parts.month - 1, +parts.day,
    +parts.hour, +parts.minute, +parts.second,
  );
  return wall - at.getTime();
}

/**
 * Nächstes Erreichen der Tageswechsel-Stunde in Ortszeit, als Unix-Sekunden.
 *
 * Die Zone muss ausdrücklich angegeben werden: Edge Functions laufen in UTC,
 * und `setHours` hätte den Wechsel im Sommer auf 8 Uhr deutscher Zeit gelegt —
 * mitten in die Zeit, in der schon Geräte in Betrieb sind.
 */
export function nextRollover(
  hour: number,
  zone = Deno.env.get("TICKETSCAN_TIMEZONE") ?? "Europe/Berlin",
  now = new Date(),
): number {
  const offset = zoneOffset(now, zone);
  // Ein Datum, dessen UTC-Felder die Wanduhr in der Zone abbilden.
  const wall = new Date(now.getTime() + offset);

  const target = new Date(wall);
  target.setUTCHours(hour, 0, 0, 0);
  if (target <= wall) target.setUTCDate(target.getUTCDate() + 1);

  // Zurück nach UTC. Den Versatz am Zielzeitpunkt neu bestimmen, damit eine
  // Zeitumstellung dazwischen nicht um eine Stunde danebenliegt.
  const rough = target.getTime() - offset;
  const exact = target.getTime() - zoneOffset(new Date(rough), zone);
  return Math.floor(exact / 1000);
}

export async function issue(claims: DeviceClaims, secret: string): Promise<string> {
  const body = b64url(encoder.encode(JSON.stringify(claims)));
  const sig = await crypto.subtle.sign("HMAC", await key(secret), encoder.encode(body));
  return `${body}.${b64url(new Uint8Array(sig))}`;
}

/** Gibt die Claims zurück, oder null wenn Signatur oder Frist nicht stimmen. */
export async function verify(token: string, secret: string): Promise<DeviceClaims | null> {
  // Der ganze Rumpf im try: unb64url ruft atob, und atob wirft bei
  // ungültigen Zeichen. Lag das nur um die Claims herum, antwortete ein
  // verstümmeltes Token mit 500 statt 401 — und ein Gerät mit beschädigtem
  // gespeicherten Token kam nie zum Anmeldebildschirm zurück, sondern sah
  // endlos Verbindungsfehler.
  try {
    const [body, sig] = token.split(".");
    if (!body || !sig) return null;

    const ok = await crypto.subtle.verify(
      "HMAC", await key(secret), unb64url(sig), encoder.encode(body),
    );
    if (!ok) return null;

    const claims = JSON.parse(new TextDecoder().decode(unb64url(body))) as DeviceClaims;
    if (claims.expiresAt * 1000 <= Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}

/**
 * Das Tokengeheimnis, oder null.
 *
 * Ohne diese Prüfung stand hier ein `!` — eine reine Zusicherung an den
 * Typprüfer, die zur Laufzeit nicht existiert. Fehlte die Variable, lief HMAC
 * mit einem leeren Schlüssel weiter: dann könnte jeder sich selbst ein Token
 * signieren. Fehlt sie, wird deshalb nichts mehr angenommen.
 */
/** Das Verwaltungspasswort, oder null wenn keines gesetzt ist. Ohne Wert ist
 *  die Verwaltung abgeschaltet — nicht offen. */
export function adminPassword(): string | null {
  const value = Deno.env.get("TICKETSCAN_ADMIN_PASSWORD");
  return value || null;
}

export function tokenSecret(): string | null {
  const secret = Deno.env.get("TICKETSCAN_TOKEN_SECRET");
  return secret && secret.length >= 16 ? secret : null;
}

/**
 * Zeitkonstanter Vergleich: die Antwortdauer verrät nichts darüber, wie viele
 * Zeichen übereinstimmt haben.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  // Über die längere Seite laufen, damit auch die Länge nichts verrät.
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

export const CORS = {
  // `||` statt `??`: Eine gesetzte, aber leere Variable ergäbe sonst einen
  // ungültigen Header statt des Rückfalls.
  "Access-Control-Allow-Origin": Deno.env.get("TICKETSCAN_ALLOWED_ORIGIN") || "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

/** Prüft den Authorization-Header und liefert die Claims. */
export async function requireDevice(req: Request): Promise<DeviceClaims | null> {
  const secret = tokenSecret();
  if (!secret) return null;
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  return await verify(token, secret);
}

/**
 * Gerät angemeldet und nicht gesperrt?
 *
 * Stand dreimal fast gleich in drei Endpunkten und fehlte im vierten: In
 * `stats` wurde `revoked_at` gar nicht geprüft, ein verlorenes Telefon kam
 * also weiterhin an Zählerstände, Geräteliste und Konfliktliste — und konnte
 * über POST die Bändchenzahl fälschen, also ausgerechnet den zweiten,
 * körperlichen Zähler.
 *
 * Zusätzlich wird ein Fehler beim Nachschlagen jetzt nicht mehr verschluckt.
 * `.single()` liefert bei null Treffern einen Fehler und `data = null`; die
 * alte Prüfung `row?.revoked_at` ging dann durch. Fehlerfall hieß: Zugang.
 */
export async function requireActiveDevice(
  req: Request,
  // deno-lint-ignore no-explicit-any
  db: any,
): Promise<{ claims: DeviceClaims } | { error: Response }> {
  const claims = await requireDevice(req);
  if (!claims) return { error: json({ error: "Anmeldung abgelaufen" }, 401) };

  const { data, error } = await db.from("devices")
    .select("revoked_at").eq("device_id", claims.deviceId).maybeSingle();

  if (error) return { error: json({ error: "Gerät nicht prüfbar" }, 503) };
  if (!data) return { error: json({ error: "Gerät unbekannt" }, 403) };
  if (data.revoked_at) return { error: json({ error: "Gerät gesperrt" }, 403) };

  return { claims };
}
