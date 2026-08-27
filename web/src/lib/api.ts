// Zugriff auf die Endpunkte. Jeder Aufruf setzt voraus, dass er scheitern
// darf — die App entscheidet lokal und ist auf keine dieser Antworten
// angewiesen, um weiterarbeiten zu können.

import type { QueuedScan, Session, Ticket } from "./store";

const BASE = import.meta.env.VITE_API_URL ?? "";

export class Unauthorized extends Error {}

async function call<T>(path: string, session: Session, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      authorization: `Bearer ${session.token}`,
      "content-type": "application/json",
    },
  });

  // Abgelaufenes Token heißt: einmal neu anmelden, nicht: Daten wegwerfen.
  if (res.status === 401 || res.status === 403) throw new Unauthorized(await res.text());
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return await res.json() as T;
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
  const data = await call<ChangesResponse>(`/changes${query ? `?${query}` : ""}`, session);

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

/** Stand der ausgegebenen Bändchen melden. */
export async function reportWristbands(session: Session, counted: number): Promise<void> {
  await call("/stats", session, { method: "POST", body: JSON.stringify({ counted }) });
}
