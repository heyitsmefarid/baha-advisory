/**
 * Minimal IndexedDB helper (no dependency). Stores:
 *  - report_drafts: community reports waiting to be sent (offline queue)
 *  - kv: last-known snapshots for offline safety mode
 * All calls reject gracefully when IndexedDB is unavailable.
 */
const DB_NAME = "bahadvisory";
const VERSION = 1;
export type StoreName = "report_drafts" | "kv";

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB unavailable"));
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("report_drafts")) db.createObjectStore("report_drafts", { keyPath: "id" });
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  dbPromise.catch(() => (dbPromise = null));
  return dbPromise;
}

function run<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

export const idbGetAll = <T>(store: StoreName) => run<T[]>(store, "readonly", (s) => s.getAll() as IDBRequest<T[]>);
export const idbGet = <T>(store: StoreName, key: IDBValidKey) => run<T | undefined>(store, "readonly", (s) => s.get(key) as IDBRequest<T | undefined>);
export const idbPut = (store: StoreName, value: unknown, key?: IDBValidKey) => run(store, "readwrite", (s) => s.put(value, key));
export const idbDelete = (store: StoreName, key: IDBValidKey) => run(store, "readwrite", (s) => s.delete(key));
