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
    category: string;
    note: string | null;
    redeemed_at: string | null;
    redeemed_by_device: string | null;
    updated_at: string;
  }>;
  more: boolean;
  cursor: string | null;
  serverTime: string;
}

export interface ScanResult {
  scanId: string;
  code: string;
  result: "ok" | "duplicate" | "unknown" | "conflict" | "error";
  redeemed_at?: string | null;
  redeemed_by_device?: string | null;
}

/** Holt Änderungen seit einem Zeitstempel, oder den Grundbestand ohne. */
export async function fetchChanges(session: Session, since: string | null) {
  const query = since ? `?since=${encodeURIComponent(since)}` : "";
  const data = await call<ChangesResponse>(`/changes${query}`, session);
  const tickets: Ticket[] = data.tickets.map((t) => ({
    code: t.code,
    category: t.category,
    note: t.note,
    redeemedAt: t.redeemed_at,
    redeemedByDevice: t.redeemed_by_device,
  }));
  return { tickets, more: data.more, cursor: data.cursor, serverTime: data.serverTime };
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
        reason: s.reason,
        offline: s.offline,
      })),
    }),
  });
  return results;
}
