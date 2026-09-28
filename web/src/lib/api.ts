// Zugriff auf die Endpunkte. Jeder Aufruf setzt voraus, dass er scheitern
// darf — die App entscheidet lokal und ist auf keine dieser Antworten
// angewiesen, um weiterarbeiten zu können.

import type { QueuedScan, Session, Ticket } from "./store";

const BASE = import.meta.env.VITE_API_URL ?? "";

export class Unauthorized extends Error {}

/**
 * Obergrenze für eine einzelne Anfrage.
 *
 * Ohne sie wartete fetch, bis der Browser selbst aufgibt — auf iOS eine
 * Minute, in Chrome mehrere. Im schwankenden Mobilfunk bleibt eine Anfrage
 * genau so hängen: gesendet, Funkzelle gewechselt, keine Antwort. Weil der
 * Abgleich nur einen Durchlauf zur Zeit erlaubt, stand damit die ganze
 * Übertragung still — keine Einlösung ging raus, keine fremde kam an, und das
 * Fenster für Doppeleinlass wuchs von acht Sekunden auf Minuten. Bei der
 * Anmeldung um 6 Uhr hieß es „Einen Moment…" ohne Ende, und der Rückfall auf
 * die Anmeldung ohne Netz griff nie, weil nie ein Fehler kam.
 *
 * Eine abgebrochene Anfrage ist harmlos: Scans sind über die scanId
 * idempotent, der nächste Takt sendet sie erneut.
 */
export const FRIST_MS = 30_000;

/** Für eine volle Seite des Grundbestands (1000 Zeilen) im schwachen Netz. */
export const FRIST_GRUNDBESTAND_MS = 60_000;

export class Zeitueberschreitung extends Error {}

/**
 * fetch mit Zeitlimit — über Anfrage UND Antwortinhalt.
 *
 * Die erste Fassung hob die Frist auf, sobald die Kopfzeilen da waren. Das
 * Lesen des Inhalts blieb ohne Grenze, und genau dort reißt es im Mobilfunk
 * ab: Funkzellenwechsel mitten in einer Seite mit tausend Zeilen. Deshalb
 * läuft `lesen` innerhalb der Frist, und der Abbruch trifft auch den Strom.
 *
 * AbortController statt AbortSignal.timeout, weil Letzteres auf älteren
 * iPhones fehlt.
 */
export async function fetchMitFrist<T>(
  url: string,
  init: RequestInit,
  lesen: (res: Response) => Promise<T>,
  ms = FRIST_MS,
): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    return await lesen(res);
  } catch (err) {
    if (ctrl.signal.aborted) throw new Zeitueberschreitung(`${url}: keine Antwort nach ${ms / 1000} s`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function call<T>(
  path: string, session: Session, init: RequestInit = {}, ms = FRIST_MS,
): Promise<T> {
  return await fetchMitFrist(`${BASE}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      authorization: `Bearer ${session.token}`,
      "content-type": "application/json",
    },
  }, async (res) => {
    // Abgelaufenes Token heißt: einmal neu anmelden, nicht: Daten wegwerfen.
    if (res.status === 401 || res.status === 403) throw new Unauthorized(await res.text());
    if (!res.ok) {
      // Die Meldung des Servers durchreichen. Vorher kam nur „/verwaltung:
      // 400" an — und „Zeile 12 hat 4 statt 5 Stellen" ging verloren.
      let detail = "";
      try { detail = ((await res.json()) as { error?: string }).error ?? ""; } catch { /* kein JSON */ }
      throw new Error(detail || `${path}: ${res.status}`);
    }
    return await res.json() as T;
  }, ms);
}

interface ChangesResponse {
  tickets: Array<{
    code: string;
    holder_name: string | null;
    category: string;
    note: string | null;
    redeemed_at: string | null;
    redeemed_by_device: string | null;
    updated_at: string;
  }>;
  more: boolean;
  nextOffset: number | null;
  cursor: string | null;
  cursorCode: string | null;
  serverTime: string;
}

export interface PageRequest {
  /** Grundbestand: ab welcher Zeile weiterblättern. */
  offset?: number;
  /** Änderungen: Fortsetzung nach diesem Zeitstempel … */
  since?: string | null;
  /** … und dieser Nummer, für Zeilen mit gleichem Zeitstempel. */
  sinceCode?: string | null;
}

export interface ScanResult {
  scanId: string;
  code: string;
  result: "ok" | "duplicate" | "unknown" | "conflict" | "error";
  redeemed_at?: string | null;
  redeemed_by_device?: string | null;
}

/** Holt eine Seite: Änderungen seit einem Zeitstempel, oder den Grundbestand. */
export async function fetchChanges(session: Session, page: PageRequest = {}) {
  const params = new URLSearchParams();
  if (page.since) params.set("since", page.since);
  if (page.sinceCode) params.set("sinceCode", page.sinceCode);
  if (page.offset) params.set("offset", String(page.offset));

  const query = params.toString();
  // Der Grundbestand kommt in vollen Seiten zu tausend Zeilen und bekommt
  // deshalb mehr Zeit als ein Nachziehen, das meist leer ist.
  const data = await call<ChangesResponse>(
    `/changes${query ? `?${query}` : ""}`, session, {},
    page.since ? FRIST_MS : FRIST_GRUNDBESTAND_MS,
  );

  const tickets: Ticket[] = data.tickets.map((t) => ({
    code: t.code,
    // Nicht jedes Ticket trägt einen Namen — fehlt er, bleibt das Feld leer,
    // und die Nummer allein entscheidet.
    holderName: t.holder_name || null,
    category: t.category,
    note: t.note,
    redeemedAt: t.redeemed_at,
    redeemedByDevice: t.redeemed_by_device,
  }));

  return {
    tickets,
    more: data.more,
    nextOffset: data.nextOffset,
    cursor: data.cursor,
    cursorCode: data.cursorCode,
    serverTime: data.serverTime,
  };
}

export async function submitScans(session: Session, scans: QueuedScan[]) {
  const { results } = await call<{ results: ScanResult[] }>("/scans", session, {
    method: "POST",
    body: JSON.stringify({
      scans: scans.map((s) => ({
        scanId: s.scanId,
        code: s.code,
        clientTs: s.clientTs,
        action: s.action,
        undoOf: s.undoOf,
        reason: s.reason,
        offline: s.offline,
      })),
    }),
  });
  return results;
}

/** Kennzahlen für die Übersicht. Braucht Netz — anders als alles andere. */
export async function fetchStats<T>(session: Session): Promise<T> {
  return await call<T>("/stats", session);
}

/**
 * Eine Zeile Stammdaten. Ein Feld, das FEHLT, bleibt auf dem Server, wie es
 * ist; ein Feld mit `null` wird geleert. Beim Einfügen einer Liste fehlen
 * leere Zellen deshalb — vorher löschte jede leere Zelle einen Namen.
 */
export interface Stammdaten {
  code: string;
  holderName?: string | null;
  category?: string | null;
  note?: string | null;
}

/** Was ein Schreibvorgang bewirkt hat oder im Probelauf bewirken würde. */
export interface StammdatenBericht {
  neu: number;
  geaendert: number;
  unveraendert: number;
  neueCodes: string[];
  aenderungen: Array<{ code: string; feld: string; alt: string | null; neu: string | null }>;
  geschrieben: boolean;
}

/**
 * Stammdaten schreiben — Nummer, Name, Kategorie, Vermerk.
 *
 * Der Einlassstand ist nicht dabei und kann es auch nicht sein: Der Endpunkt
 * nimmt `redeemed_at` gar nicht entgegen. `probe` schreibt nichts und zeigt
 * nur, was sich ändern würde. Neue Nummern legt der Server nur mit
 * `neuAnlegen` an — ein Tippfehler wie 12305 wäre sonst ein gültiges Ticket.
 */
export async function saveTickets(
  session: Session,
  zeilen: Stammdaten[],
  optionen: { probe?: boolean; neuAnlegen?: boolean } = {},
): Promise<StammdatenBericht> {
  return await call<StammdatenBericht>("/verwaltung", session, {
    method: "POST",
    body: JSON.stringify({ zeilen, probe: !!optionen.probe, neuAnlegen: !!optionen.neuAnlegen }),
  });
}

/** Stand der ausgegebenen Bändchen melden. */
export async function reportWristbands(session: Session, counted: number): Promise<void> {
  await call("/stats", session, { method: "POST", body: JSON.stringify({ counted }) });
}
