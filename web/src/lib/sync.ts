// Abgleich mit dem Server: Grundbestand holen, Änderungen nachziehen,
// Warteschlange leeren.
//
// Nichts davon liegt im Weg eines Scans. Die App entscheidet lokal; dieser
// Teil sorgt nur dafür, dass die lokale Sicht möglichst aktuell ist und
// gemachte Einlösungen ankommen.

import * as api from "./api";
import * as store from "./store";
import type { Session } from "./store";

/**
 * Wie viele Vorgänge je Anfrage.
 *
 * Der Server bucht jeden Vorgang als eigenen Datenbankaufruf, nacheinander.
 * Fünfzig davon bei einer zähen Datenbank (350 ms je Aufruf) plus Mobilfunk
 * sprengen die Frist — und weil die Wiederholung genauso lange braucht, kam
 * die Warteschlange nie mehr durch. Deshalb klein anfangen, nach einem
 * Abbruch halbieren und erst mit Erfolgen wieder wachsen.
 */
const MAX_BATCH = 25;
const MIN_BATCH = 5;
let buendel = MAX_BATCH;

/**
 * So weit reicht jede Abfrage hinter den gespeicherten Zeiger zurück.
 *
 * Der Zeitstempel einer Zeile ist der BEGINN ihrer Transaktion, nicht der
 * Moment, in dem sie sichtbar wird. Beginnt eine längere Transaktion (ein
 * Block Stammdaten) vor einer kurzen (eine Einlösung), wird aber erst nach
 * ihr sichtbar, steht der Zeiger eines Geräts, das dazwischen abgleicht,
 * schon hinter ihren Zeilen — und sie kämen dort nie an. Die sechs früheren
 * Durchgänge haben den Zeiger für dicht gehalten; er war es nicht.
 *
 * Eine Minute Rückgriff fängt das ab. Doppelt gelieferte Zeilen kosten
 * nichts: putTickets schreibt idempotent, merge behält wartende Vorgänge.
 */
const RUECKGRIFF_MS = 60_000;

/**
 * Was die Warteschlange noch offen hat, je Ticketnummer.
 *
 * Ohne das überschreibt der Serverstand lokale Einlösungen, die noch nicht
 * angekommen sind: Das Ticket steht dann wieder auf „frei" und kann ein
 * zweites Mal durchgewinkt werden. Der alte Code setzte nur `pending: true`
 * und übernahm `redeemed_at` trotzdem vom Server — der Kommentar dort
 * versprach das Gegenteil.
 */
async function offen(): Promise<Map<string, "redeem" | "undo">> {
  // Sortiert, nicht in der Reihenfolge von getAll(): Der Schlüssel ist eine
  // Zufalls-UUID, und die Map behält den zuletzt gesetzten Wert. Stehen für
  // eine Nummer eine Rücknahme UND eine Einlösung an — genau der Fall bei
  // „Trotzdem einlassen" —, entschied vorher der Zufall, welche gilt. Fiel
  // die Wahl auf die Rücknahme, löschte der nächste Abgleich die gerade
  // getroffene Einlösung lokal wieder weg.
  const alle = (await store.queued())
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0) || a.clientTs.localeCompare(b.clientTs));
  const map = new Map<string, "redeem" | "undo">();
  for (const scan of alle) map.set(scan.code, scan.action);
  return map;
}

/** Übernimmt die Stammdaten vom Server, behält aber die lokale Entscheidung,
 *  solange sie noch in der Warteschlange steht. */
function merge(server: store.Ticket[], wartend: Map<string, "redeem" | "undo">, lokal: Map<string, store.Ticket>): store.Ticket[] {
  return server.map((t) => {
    const action = wartend.get(t.code);
    if (!action) return t;
    const mine = lokal.get(t.code);
    return action === "redeem"
      ? { ...t, redeemedAt: mine?.redeemedAt ?? t.redeemedAt,
          redeemedByDevice: mine?.redeemedByDevice ?? t.redeemedByDevice, pending: true }
      : { ...t, redeemedAt: null, redeemedByDevice: null, pending: true };
  });
}

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

    // Auch die Erstbefüllung darf nicht über eine noch nicht gesendete
    // Einlösung schreiben. Das passiert genau dann, wenn die Sitzung ablief,
    // während Vorgänge in der Warteschlange standen.
    const wartend = await offen();
    if (wartend.size) {
      const lokal = new Map<string, store.Ticket>();
      for (const code of wartend.keys()) {
        const t = await store.getTicket(code);
        if (t) lokal.set(code, t);
      }
      await store.putTickets(merge(page.tickets, wartend, lokal));
    } else {
      await store.putTickets(page.tickets);
    }
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
  const gespeichert = await store.get<string>("syncedUpto") ?? null;
  // Mit Rückgriff beginnen und ohne Nummer — siehe RUECKGRIFF_MS. Innerhalb
  // eines Durchlaufs wird danach normal über (Zeitstempel, Nummer)
  // weitergeblättert.
  let since: string | null = gespeichert && Number.isFinite(Date.parse(gespeichert))
    ? new Date(Date.parse(gespeichert) - RUECKGRIFF_MS).toISOString()
    : gespeichert;
  let sinceCode: string | null = null;
  let changed = 0;

  // Zwei Riegel gegen eine Schleife, die nicht vorankommt.
  //
  // Der Zeiger lief einmal rückwärts, weil ein Zeitstempel unterwegs auf
  // Millisekunden gekürzt wurde — der Endpunkt lieferte dann ewig dieselbe
  // Seite, und dieser Aufruf kehrte nie zurück. Weil `laufend` in syncOnce
  // erst im finally freigegeben wird, war der Abgleich des Geräts damit bis
  // zum Neustart tot: keine Einlösung ging mehr raus, die Statuszeile log.
  //
  // Ein Abgleich, der nicht vorankommt, muss abbrechen und es beim nächsten
  // Takt erneut versuchen. Stehenbleiben ist die sichere Richtung, Hängen
  // nicht.
  const MAX_SEITEN = 40;
  let seiten = 0;

  for (;;) {
    const page = await api.fetchChanges(session, { since, sinceCode });

    if (++seiten > MAX_SEITEN) {
      console.warn("Abgleich abgebrochen: mehr als", MAX_SEITEN, "Seiten");
      break;
    }

    if (page.tickets.length) {
      // Was hier ankommt, ist die Wahrheit des Servers — bis auf Vorgänge,
      // die dieses Gerät noch in der Warteschlange hat.
      const wartend = await offen();
      const lokal = new Map<string, store.Ticket>();
      for (const code of wartend.keys()) {
        const t = await store.getTicket(code);
        if (t) lokal.set(code, t);
      }
      await store.putTickets(merge(page.tickets, wartend, lokal));
      changed += page.tickets.length;
    }

    if (!page.more || page.tickets.length === 0) {
      // Der Zeiger darf nur auf Daten stehen, die auch angekommen sind.
      //
      // Vorher sprang er auf die Serverzeit. Die entsteht aber nach der
      // Abfrage — eine Einlösung, die dazwischen sichtbar wurde, lag darunter
      // und wurde diesem Gerät nie wieder geliefert. Das Ticket galt hier
      // dauerhaft als frei, und der Fehler heilte nicht aus.
      //
      // page.cursor ist der Zeitstempel der letzten tatsächlich gelieferten
      // Zeile; kam nichts, fällt der Endpunkt auf `since` zurück und der
      // Zeiger bleibt stehen. Das ist die sichere Richtung.
      //
      // Kam gar nichts, bleibt der gespeicherte Zeiger. Der Endpunkt meldet
      // dann den angefragten Stand zurück — und das ist wegen des Rückgriffs
      // eine Minute ÄLTER. Ihn zu übernehmen hieße, mit jedem leeren Abgleich
      // eine Minute weiter zurückzuwandern.
      if (page.tickets.length && page.cursor) {
        await store.set("syncedUpto", page.cursor);
        if (page.cursorCode) await store.set("syncedUptoCode", page.cursorCode);
        else await store.remove("syncedUptoCode");
      }
      break;
    }

    // Mitten im Blättern über (Zeitstempel, Nummer) fortsetzen — nach einem
    // Import tragen tausende Zeilen denselben Zeitstempel.
    if (page.cursor === since && page.cursorCode === sinceCode) {
      console.warn("Abgleich abgebrochen: Zeiger bewegt sich nicht", since, sinceCode);
      break;
    }

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

  // In der Reihenfolge der Einreihung senden. Der Schlüssel der Warteschlange
  // ist eine Zufalls-UUID; ohne diese Sortierung konnte eine Rücknahme vor der
  // Einlösung ankommen, die sie zurücknehmen sollte — danach war das Ticket
  // auf dem Server eingelöst und auf dem Gerät frei, und der rechtmäßige
  // Inhaber wurde an der nächsten Tür abgewiesen.
  all.sort((a, b) =>
    (a.seq ?? 0) - (b.seq ?? 0) || a.clientTs.localeCompare(b.clientTs));

  const results: api.ScanResult[] = [];

  for (let i = 0; i < all.length;) {
    const batch = all.slice(i, i + buendel);
    let answers: api.ScanResult[];
    try {
      answers = await api.submitScans(session, batch);
    } catch (err) {
      if (err instanceof api.Zeitueberschreitung) buendel = Math.max(MIN_BATCH, Math.floor(buendel / 2));
      throw err;
    }
    buendel = Math.min(MAX_BATCH, buendel + 5);
    i += batch.length;

    for (const answer of answers) {
      const scan = batch.find((s) => s.scanId === answer.scanId);

      // Ein Fehler kommt beim nächsten Durchlauf erneut dran, statt verloren
      // zu gehen — aber nicht endlos. Ein dauerhaft scheiternder Vorgang ließ
      // die Statuszeile für immer auf „1 wartet" stehen und machte damit die
      // einzige Anzeige blind, an der ein echter Rückstau auffiele.
      if (answer.result === "error") {
        // Zählen, aber nie wegwerfen.
        //
        // Hier stand einmal ein `dequeue` ab zehn Fehlversuchen. Zehn
        // Versuche sind bei acht Sekunden Takt achtzig Sekunden — eine ganz
        // gewöhnliche Datenbankstörung hätte damit die Warteschlange aller
        // zehn Geräte geleert, und die Statuszeile hätte danach „alles
        // gesendet" gemeldet. Grün über weggeworfenen Einlösungen ist das
        // Schlechteste, was diese Anzeige tun kann.
        if (!scan) continue;
        await store.requeue({ ...scan, attempts: (scan.attempts ?? 0) + 1 });
        continue;
      }

      await store.dequeue(answer.scanId);
      results.push(answer);

      // Den Verlauf nachführen, wo der Server anders entschieden hat. Sonst
      // bot er für eine Einlösung, die nie gegolten hat, „Zurücknehmen" an
      // — und für eine abgelehnte Rücknahme stand dort „zurückgenommen".
      if (scan?.action === "redeem" && answer.result === "conflict") {
        await store.amend(answer.scanId, { server: "conflict" });
      }
      if (scan?.action === "undo" && answer.result === "unknown" && scan.undoOf) {
        await store.amend(scan.undoOf, { undoneAt: undefined, server: "ruecknahme-abgelehnt" });
      }

      // Steht für diese Nummer noch ein weiterer Vorgang aus, gilt lokal
      // dessen Absicht, nicht die Antwort auf den ersten. Beispiel
      // „Trotzdem einlassen": Rücknahme und Einlösung stehen hintereinander;
      // die Antwort auf die Rücknahme darf das Ticket nicht auf frei setzen,
      // solange die Einlösung noch nicht durch ist.
      if ((await store.queued()).some((s) => s.code === answer.code)) continue;

      const ticket = await store.getTicket(answer.code);
      if (!ticket) continue;

      // Den Stand des Servers übernehmen, wenn er einen mitschickt — auch
      // `null`. Vorher fiel ein fehlendes Feld auf den lokalen Wert zurück:
      // Eine abgelehnte Rücknahme ließ das Ticket damit auf diesem Gerät
      // dauerhaft frei, obwohl es auf dem Server eingelöst war. Und weil der
      // Server die Zeile nicht angefasst hatte, lieferte auch der Abgleich
      // sie nie nach. Eine Kopie des Tickets ging an diesem Gerät grün durch.
      const stand = "redeemed_at" in answer;
      await store.putTickets([{
        ...ticket,
        pending: false,
        redeemedAt: stand ? answer.redeemed_at ?? null : ticket.redeemedAt,
        redeemedByDevice: stand ? answer.redeemed_by_device ?? null : ticket.redeemedByDevice,
      }]);
    }
  }

  return results;
}

/**
 * Nimmt eine Einlösung zurück — die wichtigste Korrekturmöglichkeit am Eingang.
 *
 * Wirkt sofort lokal und wandert wie jeder Scan in die Warteschlange. Ohne
 * Netz funktioniert sie damit genauso, was der Punkt ist: Fehlbuchungen fallen
 * genau dann auf, wenn jemand vor der Tür steht.
 */
export async function undo(code: string, reason: string, undoOf?: string): Promise<void> {
  // Erst einreihen, dann lokal freigeben. Andersherum stand nach einem
  // Fehler dazwischen ein freies Ticket auf dem Gerät, ohne dass der Server
  // je davon erfuhr — die Sichten liefen dauerhaft auseinander.
  await store.enqueue({
    scanId: crypto.randomUUID(),
    code,
    clientTs: new Date().toISOString(),
    action: "undo",
    undoOf,
    reason,
    // Auch eine Rücknahme kann im Funkloch entstehen. Fest auf `false` gesetzt
    // erschien sie im Protokoll als geprüft, obwohl sie es nicht war.
    offline: !(await hadContact()),
    attempts: 0,
  });

  const ticket = await store.getTicket(code);
  if (ticket) {
    await store.putTickets([{
      ...ticket, redeemedAt: null, redeemedByDevice: null, pending: true,
    }]);
  }
}

/** Bestand zuletzt wirklich Kontakt zum Server? Maßstab ist derselbe wie in
 *  der Statuszeile: der letzte erfolgreiche Abgleich, nicht navigator.onLine. */
export async function hadContact(): Promise<boolean> {
  const last = await store.get<string>("lastSyncAt");
  return last !== undefined && Date.now() - Date.parse(last) < CONTACT_WINDOW;
}

/** Nach so langer Stille gilt der Kontakt als weg. Drei ausgefallene
 *  Durchläufe bei acht Sekunden Takt, plus Reserve für einen langsamen. */
export const CONTACT_WINDOW = 30_000;

/** Ein Durchlauf: erst senden, dann holen. In dieser Reihenfolge, damit die
 *  eigenen Einlösungen nicht vom Server überschrieben werden, bevor sie dort
 *  angekommen sind. */
let laufend: Promise<api.ScanResult[]> | null = null;

export function syncOnce(session: Session): Promise<api.ScanResult[]> {
  // Nur ein Durchlauf gleichzeitig.
  //
  // Nach einer längeren Funklücke dauert das Leeren der Warteschlange länger
  // als der Acht-Sekunden-Takt. Zwei überlappende Läufe lasen dieselbe
  // Warteschlange und blätterten parallel durch die Änderungen — der
  // langsamere schrieb am Ende seine älteren Seiten über die neueren des
  // schnelleren, während der Zeiger schon dahinterstand. Einzelne Tickets
  // standen danach dauerhaft falsch auf „frei".
  laufend ??= durchlauf(session).finally(() => { laufend = null; });
  return laufend;
}

async function durchlauf(session: Session): Promise<api.ScanResult[]> {
  // Scheitert das Senden, trotzdem holen. Vorher brach der ganze Durchlauf
  // ab: Kam die Warteschlange nicht durch, erfuhr das Gerät auch nichts mehr
  // von fremden Einlösungen — genau dann, wenn es am meisten darauf ankommt.
  // Nur eine abgelaufene Anmeldung bricht sofort ab.
  let results: api.ScanResult[] = [];
  try {
    results = await flushQueue(session);
  } catch (err) {
    if (err instanceof api.Unauthorized) throw err;
    console.warn("Senden gescheitert, hole trotzdem:", err);
  }
  await pullChanges(session);

  // Erst hier, nach beiden Schritten: Der Zeitpunkt belegt tatsächlichen
  // Kontakt zum Server. navigator.onLine sagt dagegen nur, dass das Gerät
  // irgendeine Netzwerkschnittstelle hat — im Flugmodus mit eingeschaltetem
  // WLAN steht der Wert weiterhin auf online.
  await store.set("lastSyncAt", new Date().toISOString());
  return results;
}
