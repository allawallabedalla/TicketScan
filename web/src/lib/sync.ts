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
  let offset = 0;
  let total = 0;
  let syncedUpto: string | null = null;

  for (;;) {
    const page = await api.fetchChanges(session, { offset });

    // Der Zeitstempel der ersten Seite ist der Stand, ab dem später
    // nachgezogen wird. Nähme man den der letzten, gingen Einlösungen
    // verloren, die während des Ladens passiert sind.
    syncedUpto ??= page.serverTime;

    await store.putTickets(page.tickets);
    total += page.tickets.length;
    onProgress?.(total);

    if (!page.more || page.tickets.length === 0) break;
    offset = page.nextOffset ?? offset + page.tickets.length;
  }

  await store.set("syncedUpto", syncedUpto ?? new Date().toISOString());
  await store.remove("syncedUptoCode");
  return total;
}

/** Änderungen nachziehen. Läuft regelmäßig und nach jeder Netzwiederkehr. */
export async function pullChanges(session: Session): Promise<number> {
  let since = await store.get<string>("syncedUpto") ?? null;
  let sinceCode = await store.get<string>("syncedUptoCode") ?? null;
  let changed = 0;

  for (;;) {
    const page = await api.fetchChanges(session, { since, sinceCode });

    if (page.tickets.length) {
      // Was hier ankommt, ist die Wahrheit des Servers — bis auf Einlösungen,
      // die dieses Gerät noch in der Warteschlange hat.
      const pending = new Set((await store.queued()).map((s) => s.code));
      await store.putTickets(
        page.tickets.map((t) => pending.has(t.code) ? { ...t, pending: true } : t),
      );
      changed += page.tickets.length;
    }

    if (!page.more || page.tickets.length === 0) {
      // Erst am Ende weiterstellen, und dann auf die Serverzeit: Ein
      // abgebrochener Durchlauf wiederholt sich dann einfach.
      await store.set("syncedUpto", page.serverTime);
      await store.remove("syncedUptoCode");
      break;
    }

    // Mitten im Blättern über (Zeitstempel, Nummer) fortsetzen — nach einem
    // Import tragen tausende Zeilen denselben Zeitstempel.
    since = page.cursor;
    sinceCode = page.cursorCode;
    await store.set("syncedUpto", since);
    await store.set("syncedUptoCode", sinceCode);
  }

  return changed;
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

  // Erst hier, nach beiden Schritten: Der Zeitpunkt belegt tatsächlichen
  // Kontakt zum Server. navigator.onLine sagt dagegen nur, dass das Gerät
  // irgendeine Netzwerkschnittstelle hat — im Flugmodus mit eingeschaltetem
  // WLAN steht der Wert weiterhin auf online.
  await store.set("lastSyncAt", new Date().toISOString());
  return results;
}
