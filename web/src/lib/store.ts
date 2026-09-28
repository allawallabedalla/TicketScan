// Lokaler Speicher. Vier Bereiche: Einstellungen, die Ticketliste, die
// Ausgangswarteschlange und der Verlauf.
//
// Bewusst ohne Bibliothek: Die App braucht genau diese vier, und alles, was
// nicht im Bundle liegt, muss auch nicht offline vorgehalten werden.

const DB = "ticketscan";
// 3: Verlauf als eigener Bereich statt als ein Feld im kv-Bereich.
const VERSION = 3;

export type StoreName = "kv" | "tickets" | "outbox" | "history";

let handle: Promise<IDBDatabase> | null = null;
/** Die Verbindung, auf die `handle` gerade zeigt. */
let current: IDBDatabase | null = null;

function open(): Promise<IDBDatabase> {
  handle ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      // Die Ticketliste liegt nach Nummer, damit ein Scan ein direkter
      // Schlüsselzugriff ist und keine Suche.
      if (!db.objectStoreNames.contains("tickets")) db.createObjectStore("tickets", { keyPath: "code" });
      if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox", { keyPath: "scanId" });

      // Der Verlauf lag als EIN Feld im kv-Bereich: lesen, ändern, schreiben,
      // in zwei getrennten Transaktionen. Zwei schnelle Vorgänge
      // hintereinander — Duplikat angezeigt, sofort „Trotzdem einlassen" —
      // überschrieben sich gegenseitig, und ein Eintrag war weg. Dazu die
      // Grenze von 200: Am Haupteingang ließen sich frühere Einlösungen
      // danach nicht mehr zurücknehmen. Jetzt ein Eintrag je Vorgang.
      if (!db.objectStoreNames.contains("history")) {
        const history = db.createObjectStore("history", { keyPath: "scanId" });
        const kv = req.transaction?.objectStore("kv");
        const alt = kv?.get("history");
        if (alt) {
          alt.onsuccess = () => {
            for (const entry of (alt.result as HistoryEntry[] | undefined) ?? []) history.put(entry);
            kv?.delete("history");
          };
        }
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // Eine geschlossene Verbindung nicht weiter ausgeben. Das Betriebssystem
      // darf sie jederzeit kappen; der nächste Zugriff öffnet dann neu.
      //
      // Nur zurücksetzen, wenn `handle` noch auf DIESE Verbindung zeigt —
      // sonst verwirft eine alte, tote Verbindung beim Schließen die frisch
      // geöffnete eines parallelen Aufrufs.
      db.onclose = () => { if (current === db) { handle = null; current = null; } };
      db.onversionchange = () => {
        db.close();
        if (current === db) { handle = null; current = null; }
      };
      current = db;
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  }).catch((err) => {
    // Sonst bliebe ein einmaliger Fehler für die ganze Sitzung hängen.
    handle = null;
    throw err;
  });
  return handle;
}

/**
 * Einmal neu verbinden, wenn die Verbindung tot ist.
 *
 * Bekannter WebKit-Fehler: Nach Hintergrund oder Sperre meldet Safari
 * „Connection to Indexed Database server lost" (UnknownError) oder wirft beim
 * Anlegen der Transaktion einen InvalidStateError — und zwar bei JEDEM
 * weiteren Zugriff über dieselbe Verbindung. Weil `handle` die Verbindung
 * zwischenspeichert, war das Gerät damit bis zum Neuladen taub: keine
 * Entscheidung, keine Buchung, kein Abgleich, nur „Das hat nicht geklappt".
 *
 * Wiederholen ist hier ungefährlich. Alle Schreibvorgänge sind put oder
 * delete über einen festen Schlüssel und damit idempotent.
 */
function isDeadConnection(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  return name === "InvalidStateError" || name === "UnknownError";
}

async function withReconnect<T>(attempt: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await open();
  try {
    return await attempt(db);
  } catch (err) {
    if (!isDeadConnection(err)) throw err;
    // Nur die eigene, tote Verbindung verwerfen. Hat ein paralleler Aufruf
    // schon neu geöffnet, wird dessen gesunde Verbindung mitbenutzt.
    if (current === db) {
      try { db.close(); } catch { /* ohnehin tot */ }
      handle = null;
      current = null;
    }
    return await attempt(await open());
  }
}

function run<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  work: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return withReconnect((db) =>
    new Promise<T>((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = work(tx.objectStore(store));
      let result: T;
      req.onsuccess = () => { result = req.result; };
      req.onerror = () => reject(req.error);
      // Auf oncomplete warten, nicht auf onsuccess.
      //
      // Ein Schreibvorgang meldet Erfolg, bevor die Transaktion festgeschrieben
      // ist. Bricht sie danach ab — voller Speicher auf einem Telefon mit 300
      // Fotos vom Abend —, hätte `enqueue` Erfolg gemeldet und die Einlösung
      // wäre trotzdem nicht in der Warteschlange. Ohne jede Meldung.
      //
      // `onabort` gilt für BEIDE Betriebsarten. Bricht eine lesende
      // Transaktion ab, ohne dass vorher onerror gefeuert hat — die Datenbank
      // wird durch ein versionchange geschlossen, iOS räumt im laufenden
      // Betrieb —, käme sonst weder oncomplete noch onerror, und die Zusage
      // bliebe für immer offen. Mitten im Abgleich hieße das: kein Abgleich
      // mehr bis zum Neustart, ohne dass jemand ahnt, dass Neuladen hilft.
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error ?? new Error("Transaktion abgebrochen"));
    })
  );
}

export const get = <T>(key: string) => run<T | undefined>("kv", "readonly", (s) => s.get(key));
export const set = (key: string, value: unknown) =>
  run("kv", "readwrite", (s) => s.put(value, key) as IDBRequest<IDBValidKey>);
export const remove = (key: string) =>
  run("kv", "readwrite", (s) => s.delete(key) as unknown as IDBRequest<undefined>);

// ------------------------------------------------------------------ Tickets --

export interface Ticket {
  code: string;
  /** Name auf der Ticketliste, sofern hinterlegt. Nicht jedes Ticket hat
   *  einen — Abendkasse, Gästeliste, weitergegebene Tickets. */
  holderName: string | null;
  category: string;
  note: string | null;
  /**
   * Sperrvermerk mit Grund, oder leer. Ein gesperrtes Ticket wird
   * abgewiesen, egal ob eingelöst oder nicht. Löschen wäre der naheliegende
   * Weg gewesen — aber ein gelöschtes Ticket erreicht die Geräte nie, der
   * Abgleich überträgt nur Änderungen.
   */
  gesperrt?: string | null;
  redeemedAt: string | null;
  redeemedByDevice: string | null;
  /** Auf diesem Gerät eingelöst und noch nicht bestätigt. */
  pending?: boolean;
}

export const getTicket = (code: string) =>
  run<Ticket | undefined>("tickets", "readonly", (s) => s.get(code));

export const allTickets = () =>
  run<Ticket[]>("tickets", "readonly", (s) => s.getAll() as IDBRequest<Ticket[]>);

export const countTickets = () =>
  run<number>("tickets", "readonly", (s) => s.count());

export async function putTickets(tickets: Ticket[]): Promise<void> {
  // Alle in einer Transaktion: 2305 einzelne Transaktionen wären auf einem
  // Telefon spürbar langsam.
  await withReconnect((db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction("tickets", "readwrite");
    const store = tx.objectStore("tickets");
    for (const ticket of tickets) store.put(ticket);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("Transaktion abgebrochen"));
  }));
}

// ---------------------------------------------------------- Warteschlange --

export interface QueuedScan {
  scanId: string;
  code: string;
  /** Laufende Nummer der Einreihung. Der Schlüssel der Warteschlange ist eine
   *  Zufalls-UUID, `getAll()` liefert also in Zufallsreihenfolge — und eine
   *  Rücknahme konnte vor der Einlösung ankommen, die sie zurücknehmen
   *  sollte. Danach war das Ticket auf dem Server eingelöst und lokal frei. */
  seq?: number;
  clientTs: string;
  action: "redeem" | "undo";
  /** Bei einer Rücknahme: die scanId der Einlösung, die gemeint ist. Ohne
   *  sie nimmt der Server zurück, was gerade eingelöst ist — richtig beim
   *  bewussten Freigeben, falsch bei einer verspätet zugestellten eigenen
   *  Rücknahme, die sonst eine fremde Einlösung träfe. */
  undoOf?: string;
  reason?: string;
  /** Entstand ohne Verbindung, war also im Moment der Entscheidung nicht
   *  gegen die anderen Geräte prüfbar. */
  offline: boolean;
  attempts: number;
}

let lastSeq = 0;

/** Reiht einen Vorgang ein, in nachvollziehbarer Reihenfolge. */
export async function enqueue(scan: QueuedScan): Promise<void> {
  const open = await queued();
  lastSeq = Math.max(lastSeq, ...open.map((s) => s.seq ?? 0)) + 1;
  await run("outbox", "readwrite", (s) =>
    s.put({ ...scan, seq: lastSeq }) as IDBRequest<IDBValidKey>);
}

/** Ändert einen wartenden Vorgang, etwa um Fehlversuche mitzuzählen. */
export const requeue = (scan: QueuedScan) =>
  run("outbox", "readwrite", (s) => s.put(scan) as IDBRequest<IDBValidKey>);

export const queued = () =>
  run<QueuedScan[]>("outbox", "readonly", (s) => s.getAll() as IDBRequest<QueuedScan[]>);

export const queueSize = () => run<number>("outbox", "readonly", (s) => s.count());

/** Wie viele Vorgänge sich festgefahren haben. Sie bleiben in der
 *  Warteschlange — weggeworfen wird nichts —, aber die Statuszeile soll den
 *  Unterschied zwischen „noch unterwegs" und „kommt nicht durch" zeigen. */
export async function stuckCount(after = 5): Promise<number> {
  return (await queued()).filter((s) => (s.attempts ?? 0) >= after).length;
}

export const dequeue = (scanId: string) =>
  run("outbox", "readwrite", (s) => s.delete(scanId) as unknown as IDBRequest<undefined>);

// ---------------------------------------------------------------- Verlauf --

export interface HistoryEntry {
  scanId: string;
  code: string;
  at: string;
  verdict: "ok" | "duplicate" | "unknown" | "gesperrt";
  /** Zurückgenommen, samt Begründung. */
  undoneAt?: string;
  reason?: string;
  /**
   * Was der Server später dazu gesagt hat, sofern es von der lokalen
   * Entscheidung abweicht.
   *
   * - `conflict`: Ein anderes Gerät hat dasselbe Ticket vorher eingelöst.
   *   Diese Einlösung hat auf dem Server nie gegolten — eine Rücknahme würde
   *   ins Leere gehen, der Knopf entfällt.
   * - `ruecknahme-abgelehnt`: Die Rücknahme kam an, aber das Ticket war
   *   inzwischen anders eingelöst. Es ist NICHT frei.
   * - `gesperrt`: Das Ticket war auf dem Server gesperrt, als die Einlösung
   *   ankam — das Gerät hatte die Sperre noch nicht (Funkloch).
   */
  server?: "conflict" | "ruecknahme-abgelehnt" | "gesperrt";
}

/** Die Vorgänge dieses Geräts, neueste zuerst. Grundlage für Rücknahme und
 *  Klärung. */
export async function history(): Promise<HistoryEntry[]> {
  const all = await run<HistoryEntry[]>("history", "readonly",
    (s) => s.getAll() as IDBRequest<HistoryEntry[]>);
  return all.sort((a, b) => b.at.localeCompare(a.at));
}

export const remember = (entry: HistoryEntry) =>
  run("history", "readwrite", (s) => s.put(entry) as IDBRequest<IDBValidKey>);

/** Ändert einen Eintrag — Lesen und Schreiben in EINER Transaktion. */
export function amend(scanId: string, patch: Partial<HistoryEntry>): Promise<void> {
  return withReconnect((db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction("history", "readwrite");
    const s = tx.objectStore("history");
    const req = s.get(scanId);
    req.onsuccess = () => {
      if (req.result) s.put({ ...req.result, ...patch });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("Transaktion abgebrochen"));
  }));
}

// ---------------------------------------------------------------- Sitzung --

export interface Session {
  token: string;
  deviceId: string;
  label: string;
  expiresAt: number; // Unix-Sekunden, Tagesgrenze
  /** Darf die Ticketliste ändern. Nur mit dem Verwaltungspasswort. */
  admin?: boolean;
}

export async function loadSession(): Promise<Session | null> {
  const session = await get<Session>("session");
  if (!session) return null;
  // Abgelaufen heißt: neu anmelden. Die Gerätekennung bleibt erhalten, damit
  // das Protokoll über alle Festivaltage zusammenbleibt.
  if (session.expiresAt * 1000 <= Date.now()) return null;
  return session;
}
