// Abgleich mit dem Server: Grundbestand holen, Änderungen nachziehen,
// Warteschlange leeren.
//
// Nichts davon liegt im Weg eines Scans. Die App entscheidet lokal; dieser
// Teil sorgt nur dafür, dass die lokale Sicht möglichst aktuell ist und
// gemachte Einlösungen ankommen.

import * as api from "./api";
import * as store from "./store";
import type { Session } from "./store";

const MAX_BATCH = 50;

export interface SyncState {
  online: boolean;
  queued: number;
  lastSyncAt: string | null;
  syncing: boolean;
}

/** Erstbefüllung: die vollständige Ticketliste aufs Gerät. */
export async function bootstrap(
  session: Session,
  onProgress?: (loaded: number) => void,
): Promise<number> {
  let cursor: string | null = null;
  let total = 0;

  for (;;) {
    const page = await api.fetchChanges(session, cursor);
    await store.putTickets(page.tickets);
    total += page.tickets.length;
    onProgress?.(total);

    if (!page.more || !page.cursor || page.cursor === cursor) break;
    cursor = page.cursor;
  }

  await store.set("syncedUpto", (await lastServerTime(session)) ?? new Date().toISOString());
  return total;
}

async function lastServerTime(session: Session): Promise<string | null> {
  try {
    const page = await api.fetchChanges(session, new Date().toISOString());
    return page.serverTime;
  } catch {
    return null;
  }
}

/** Änderungen nachziehen. Läuft regelmäßig und nach jeder Netzwiederkehr. */
export async function pullChanges(session: Session): Promise<number> {
  const since = await store.get<string>("syncedUpto") ?? null;
  const page = await api.fetchChanges(session, since);

  if (page.tickets.length) {
    // Was hier ankommt, ist die Wahrheit des Servers — bis auf Einlösungen,
    // die dieses Gerät noch in der Warteschlange hat.
    const pending = new Set((await store.queued()).map((s) => s.code));
    await store.putTickets(
      page.tickets.map((t) => pending.has(t.code) ? { ...t, pending: true } : t),
    );
  }

  await store.set("syncedUpto", page.serverTime);
  return page.tickets.length;
}

/**
 * Schickt die Warteschlange weg. Was der Server anders sieht als das Gerät,
 * wird lokal korrigiert — die Person ist dann längst durch, aber die Zählung
 * stimmt wieder.
 */
export async function flushQueue(session: Session): Promise<api.ScanResult[]> {
  const all = await store.queued();
  if (!all.length) return [];

  const results: api.ScanResult[] = [];

  for (let i = 0; i < all.length; i += MAX_BATCH) {
    const batch = all.slice(i, i + MAX_BATCH);
    const answers = await api.submitScans(session, batch);

    for (const answer of answers) {
      // Ein Fehler kommt beim nächsten Durchlauf erneut dran, statt verloren
      // zu gehen.
      if (answer.result === "error") continue;

      await store.dequeue(answer.scanId);
      results.push(answer);

      const ticket = await store.getTicket(answer.code);
      if (!ticket) continue;

      await store.putTickets([{
        ...ticket,
        pending: false,
        redeemedAt: answer.redeemed_at ?? ticket.redeemedAt,
        redeemedByDevice: answer.redeemed_by_device ?? ticket.redeemedByDevice,
      }]);
    }
  }

  return results;
}

/** Ein Durchlauf: erst senden, dann holen. In dieser Reihenfolge, damit die
 *  eigenen Einlösungen nicht vom Server überschrieben werden, bevor sie dort
 *  angekommen sind. */
export async function syncOnce(session: Session): Promise<api.ScanResult[]> {
  const results = await flushQueue(session);
  await pullChanges(session);
  return results;
}
