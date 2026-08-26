// Anmeldung ohne Netz.
//
// Steht morgens kein Netz, kann der Server das Eventpasswort nicht prüfen.
// Ohne Ausweg stünde das Gerät genau dann still, wenn es gebraucht wird.
//
// Geprüft wird dann gegen einen gesalzenen Hashwert, den die letzte
// erfolgreiche Anmeldung hinterlegt hat. Das ist bewusst die schwächere
// Prüfung: Sie greift nur auf einem Gerät, das bereits legitim angemeldet war,
// und sobald wieder Netz da ist, entscheidet erneut der Server.

import * as store from "./store";

const ITERATIONS = 210_000;

interface Stored {
  salt: string;
  hash: string;
}

const encoder = new TextEncoder();

function toBase64(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

async function derive(password: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: ITERATIONS, hash: "SHA-256" },
    key, 256,
  );
  return toBase64(bits);
}

/** Nach erfolgreicher Anmeldung am Server hinterlegen. */
export async function keep(password: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  await store.set("localAuth", {
    salt: toBase64(salt.buffer),
    hash: await derive(password, salt),
  } satisfies Stored);
}

/** Ohne Netz: stimmt das Passwort mit dem der letzten Anmeldung überein? */
export async function matches(password: string): Promise<boolean> {
  const kept = await store.get<Stored>("localAuth");
  if (!kept) return false;

  const salt = Uint8Array.from(atob(kept.salt), (c) => c.charCodeAt(0));
  const hash = await derive(password, salt);

  // Zeitkonstant vergleichen, auch wenn der Angriff hier fernliegt.
  if (hash.length !== kept.hash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ kept.hash.charCodeAt(i);
  return diff === 0;
}
