// Gerätetokens: signiert mit HMAC-SHA256, gültig bis zur Tagesgrenze.
//
// Die Grenze liegt bewusst bei 6 Uhr morgens und nicht 24 Stunden nach der
// Anmeldung — so fällt der Ablauf nie in eine laufende Nachtschicht.

const encoder = new TextEncoder();

export interface DeviceClaims {
  deviceId: string;
  label: string;
  expiresAt: number; // Unix-Sekunden
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
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;

  const ok = await crypto.subtle.verify(
    "HMAC", await key(secret), unb64url(sig), encoder.encode(body),
  );
  if (!ok) return null;

  try {
    const claims = JSON.parse(new TextDecoder().decode(unb64url(body))) as DeviceClaims;
    if (claims.expiresAt * 1000 <= Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
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
  "Access-Control-Allow-Origin": Deno.env.get("TICKETSCAN_ALLOWED_ORIGIN") ?? "*",
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
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  return await verify(token, Deno.env.get("TICKETSCAN_TOKEN_SECRET")!);
}
