// Holt einen API-Schlüssel über die bereits angemeldete Supabase-CLI.
//
// Der Umweg über Kopieren und Einfügen ist die fehleranfälligste Stelle der
// ganzen Einrichtung: Das Dashboard zeigt den Schlüssel maskiert an, und wer
// den angezeigten Text markiert, kopiert Aufzählungspunkte statt des
// Schlüssels. Wenn die CLI ohnehin angemeldet ist, kann sie ihn liefern.

import { execFileSync } from "node:child_process";

/** Projektkennung aus einer beliebigen Supabase-Adresse. */
export function refFromUrl(url) {
  return url?.match(/https:\/\/([a-z0-9]+)\.supabase\./)?.[1] ?? null;
}

/**
 * @param {string} ref  Projektkennung
 * @param {"secret"|"public"} kind
 * @returns {string|null}
 */
export function keyFromCli(ref, kind) {
  if (!ref) return null;

  let raw;
  try {
    raw = execFileSync(
      "npx",
      ["--yes", "supabase", "projects", "api-keys", "--project-ref", ref, "--output", "json"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 60_000 },
    );
  } catch {
    return null; // Nicht angemeldet, andere CLI-Fassung, kein Netz — der
                 // Aufrufer fällt dann auf die Umgebungsvariable zurück.
  }

  let entries;
  try {
    entries = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(entries)) return null;

  // Je nach Alter des Projekts heißen die Schlüssel service_role und anon oder
  // sb_secret_... und sb_publishable_...
  const wanted = kind === "secret"
    ? (name, value) => /service_role|secret/i.test(name) || /^sb_secret_/.test(value)
    : (name, value) => /anon|publishable/i.test(name) || /^sb_publishable_/.test(value);

  for (const entry of entries) {
    const name = String(entry.name ?? entry.type ?? "");
    const value = String(entry.api_key ?? entry.apiKey ?? entry.key ?? "");
    if (value && wanted(name, value)) return value;
  }
  return null;
}

/** Wirkt ein Wert wie ein echter Schlüssel — oder wie maskierte Anzeige? */
export function looksMangled(key) {
  return /[^\x21-\x7e]/.test(key.trim());
}
