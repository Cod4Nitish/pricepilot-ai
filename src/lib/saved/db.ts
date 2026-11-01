// Tiny hand-written IndexedDB wrapper for saved products and reports (browser only, local to this device).
// DB "pricepilot", versioned schema; each record also carries its own schemaVersion.
// Nothing here touches the network.
import { canClaimCheck, SNAPSHOT_SCHEMA_VERSION, type SavedProduct, type SavedReport } from "./snapshot";

export const DB_NAME = "pricepilot";
export const DB_VERSION = 1;
export const STORES = { products: "products", reports: "reports" } as const;
type StoreName = (typeof STORES)[keyof typeof STORES];

/** Ordered migrations: index i upgrades from version i to i+1. Never edit a shipped step; append new ones. */
const MIGRATIONS: ((db: IDBDatabase, tx: IDBTransaction) => void)[] = [
  // v0 -> v1
  (db) => {
    if (!db.objectStoreNames.contains(STORES.products)) {
      const s = db.createObjectStore(STORES.products, { keyPath: "id" });
      s.createIndex("updatedAt", "updatedAt");
    }
    if (!db.objectStoreNames.contains(STORES.reports)) {
      const s = db.createObjectStore(STORES.reports, { keyPath: "id" });
      s.createIndex("savedAt", "savedAt");
    }
  },
];

export function idbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (!idbAvailable()) return Promise.reject(new Error("Local storage (IndexedDB) is not available in this browser."));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      const tx = req.transaction!;
      for (let v = e.oldVersion; v < DB_VERSION; v++) MIGRATIONS[v]?.(db, tx);
    };
    req.onsuccess = () => {
      const db = req.result;
      // another tab upgraded the schema: close so it can proceed; next call reopens
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error ?? new Error("Could not open local storage."));
    };
    req.onblocked = () => reject(new Error("Local storage is busy in another tab. Close other PricePilot tabs and retry."));
  });
  return dbPromise;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
  });
}

async function getAll<T>(store: StoreName): Promise<T[]> {
  const db = await openDb();
  return wrap(db.transaction(store, "readonly").objectStore(store).getAll() as IDBRequest<T[]>);
}
async function getOne<T>(store: StoreName, id: string): Promise<T | null> {
  const db = await openDb();
  const r = await wrap(db.transaction(store, "readonly").objectStore(store).get(id) as IDBRequest<T | undefined>);
  return r ?? null;
}
async function putOne<T>(store: StoreName, rec: T): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(store, "readwrite");
  tx.objectStore(store).put(rec);
  await done(tx);
  notify();
}
async function delOne(store: StoreName, id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(store, "readwrite");
  tx.objectStore(store).delete(id);
  await done(tx);
  notify();
}

/** Records written by a newer app version are hidden rather than misread. */
const compatible = (r: { schemaVersion?: number }) => typeof r.schemaVersion === "number" && r.schemaVersion <= SNAPSHOT_SCHEMA_VERSION;

export const savedDb = {
  listProducts: async () => (await getAll<SavedProduct>(STORES.products)).filter(compatible).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  getProduct: async (id: string) => {
    const r = await getOne<SavedProduct>(STORES.products, id);
    return r && compatible(r) ? r : null;
  },
  putProduct: (p: SavedProduct) => putOne(STORES.products, p),
  deleteProduct: (id: string) => delOne(STORES.products, id),
  listReports: async () => (await getAll<SavedReport>(STORES.reports)).filter(compatible).sort((a, b) => b.savedAt.localeCompare(a.savedAt)),
  getReport: async (id: string) => {
    const r = await getOne<SavedReport>(STORES.reports, id);
    return r && compatible(r) ? r : null;
  },
  putReport: (r: SavedReport) => putOne(STORES.reports, r),
  deleteReport: (id: string) => delOne(STORES.reports, id),

  /**
   * Atomically claim a monitor check: inside ONE readwrite transaction, re-read the product and, if it is still due,
   * write lastCheckedAt = now before any network call. IndexedDB serialises readwrite transactions on a store,
   * so two tabs cannot both claim the same product. Returns the claimed product or null.
   */
  claimCheck: async (id: string, now: Date): Promise<SavedProduct | null> => {
    const db = await openDb();
    const tx = db.transaction(STORES.products, "readwrite");
    const store = tx.objectStore(STORES.products);
    const cur = await wrap(store.get(id) as IDBRequest<SavedProduct | undefined>);
    let claimed: SavedProduct | null = null;
    if (cur && compatible(cur) && canClaimCheck(cur, now.getTime())) {
      claimed = { ...cur, monitor: { ...cur.monitor, lastCheckedAt: now.toISOString() } };
      store.put(claimed);
    }
    await done(tx);
    if (claimed) notify();
    return claimed;
  },
};

// ---------- change notification (this tab + other tabs) ----------
const EVENT = "pricepilot:saved-changed";
let channel: BroadcastChannel | null = null;
function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  channel ??= new BroadcastChannel("pricepilot-saved");
  return channel;
}
function notify() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(EVENT));
  getChannel()?.postMessage("changed");
}
/** Subscribe to saved-data changes from this tab and other tabs. Returns an unsubscribe function. */
export function onSavedChange(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, cb);
  const ch = getChannel();
  const onMsg = () => cb();
  ch?.addEventListener("message", onMsg);
  return () => {
    window.removeEventListener(EVENT, cb);
    ch?.removeEventListener("message", onMsg);
  };
}
