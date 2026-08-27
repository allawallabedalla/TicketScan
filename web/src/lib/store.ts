// Lokaler Speicher. Drei Bereiche: Einstellungen, die Ticketliste und die
// Ausgangswarteschlange.
//
// Bewusst ohne Bibliothek: Die App braucht genau diese drei, und alles, was
// nicht im Bundle liegt, muss auch nicht offline vorgehalten werden.

const DB = "ticketscan";
const VERSION = 2;

export type StoreName = "kv" | "tickets" | "outbox";

let handle: Promise<IDBDatabase> | null = null;

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
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((err) => {
    // Sonst bliebe ein einmaliger Fehler für die ganze Sitzung hängen.
    handle = null;
    throw err;
  });
  return handle;
}

function run<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  work: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then((db) =>
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
      if (mode === "readonly") tx.oncomplete = () => resolve(result);
      else {
        tx.oncomplete = () => resolve(result);
        tx.onabort = () => reject(tx.error ?? new Error("Transaktion abgebrochen"));
      }
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
  const db = await open();
  // Alle in einer Transaktion: 2305 einzelne Transaktionen wären auf einem
  // Telefon spürbar langsam.
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("tickets", "readwrite");
    const store = tx.objectStore("tickets");
    for (const ticket of tickets) store.put(ticket);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
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

export const dequeue = (scanId: string) =>
  run("outbox", "readwrite", (s) => s.delete(scanId) as unknown as IDBRequest<undefined>);

// ---------------------------------------------------------------- Verlauf --

export interface HistoryEntry {
  scanId: string;
  code: string;
  at: string;
  verdict: "ok" | "duplicate" | "unknown";
  /** Zurückgenommen, samt Begründung. */
  undoneAt?: string;
  reason?: string;
}

const HISTORY_MAX = 200;

/** Die letzten Vorgänge dieses Geräts. Grundlage für Rücknahme und Klärung. */
export async function history(): Promise<HistoryEntry[]> {
  return await get<HistoryEntry[]>("history") ?? [];
}

export async function remember(entry: HistoryEntry): Promise<void> {
  const all = await history();
  all.unshift(entry);
  await set("history", all.slice(0, HISTORY_MAX));
}

export async function amend(scanId: string, patch: Partial<HistoryEntry>): Promise<void> {
  const all = await history();
  const at = all.findIndex((e) => e.scanId === scanId);
  if (at === -1) return;
  all[at] = { ...all[at], ...patch };
  await set("history", all);
}

// ---------------------------------------------------------------- Sitzung --

export interface Session {
  token: string;
  deviceId: string;
  label: string;
  expiresAt: number; // Unix-Sekunden, Tagesgrenze
}

export async function loadSession(): Promise<Session | null> {
  const session = await get<Session>("session");
  if (!session) return null;
  // Abgelaufen heißt: neu anmelden. Die Gerätekennung bleibt erhalten, damit
  // das Protokoll über alle Festivaltage zusammenbleibt.
  if (session.expiresAt * 1000 <= Date.now()) return null;
  return session;
}
