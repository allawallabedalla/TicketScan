// Schmaler Zugriff auf IndexedDB. Bewusst ohne Bibliothek: die App braucht
// genau einen Objektspeicher, und alles, was nicht im Bundle liegt, muss auch
// nicht offline vorgehalten werden.

const DB = "ticketscan";
const STORE = "kv";

let handle: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  handle ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return handle;
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((db) =>
    new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = work(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    })
  );
}

export const get = <T>(key: string) => run<T | undefined>("readonly", (s) => s.get(key));
export const set = (key: string, value: unknown) =>
  run("readwrite", (s) => s.put(value, key) as IDBRequest<IDBValidKey>);
export const remove = (key: string) =>
  run("readwrite", (s) => s.delete(key) as unknown as IDBRequest<undefined>);

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
