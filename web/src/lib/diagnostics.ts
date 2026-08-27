// Angaben, die eine Rückmeldung erst brauchbar machen.
//
// Jede Fehlersuche in diesem Projekt begann mit denselben Fragen: Welche
// Fassung läuft, was liefert die Kamera, wie viele Tickets liegen auf dem
// Gerät, wann bestand zuletzt Kontakt. Sie einzeln zu erfragen kostet
// jedesmal eine Runde — also sammelt die App sie selbst ein.

import * as store from "./store";
import { detectPlatform, isInstalled } from "./platform";

export async function collect(): Promise<string> {
  const [tickets, queued, lastSync, session, camera] = await Promise.all([
    store.countTickets().catch(() => -1),
    store.queueSize().catch(() => -1),
    store.get<string>("lastSyncAt"),
    store.get<store.Session>("session"),
    store.get<string>("cameraSize"),
  ]);

  const zeit = (iso?: string) =>
    iso ? new Date(iso).toLocaleString("de-DE") : "nie";

  return [
    `Fassung:        ${__BUILD__}`,
    `Gerät:          ${session?.label ?? "nicht angemeldet"}`,
    `Kennung:        ${session?.deviceId?.slice(0, 8) ?? "—"}`,
    `Kamera:         ${camera ?? "noch nicht geöffnet"}`,
    `Tickets:        ${tickets}`,
    `Warteschlange:  ${queued}`,
    `Letzter Abgleich: ${zeit(lastSync)}`,
    `Auf Homebildschirm: ${isInstalled() ? "ja" : "nein"}`,
    `Umgebung:       ${detectPlatform()}`,
    `Bildschirm:     ${window.innerWidth}×${window.innerHeight}`,
    `Browser:        ${navigator.userAgent}`,
    `Zeitpunkt:      ${new Date().toLocaleString("de-DE")}`,
  ].join("\n");
}

const REPO = import.meta.env.VITE_FEEDBACK_REPO ?? "allawallabedalla/TicketScan";

/** Fertig ausgefüllter Entwurf für einen Eintrag im Repo. */
export function issueUrl(title: string, description: string, facts: string): string {
  const body = [
    "### Was ist passiert?", "", description || "_(bitte ergänzen)_", "",
    "### Was war zu erwarten?", "", "_(bitte ergänzen)_", "",
    "### Angaben vom Gerät", "", "```", facts, "```",
  ].join("\n");

  const params = new URLSearchParams({ title: title || "Rückmeldung aus der App", body });
  return `https://github.com/${REPO}/issues/new?${params}`;
}
