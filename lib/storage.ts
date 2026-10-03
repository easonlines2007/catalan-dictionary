import type {
  CacheRecord,
  FoundLookup,
  HistoryRecord,
  SavedRecord,
  StoredDictionaryShard,
} from "./types.ts";
import { primaryChinese, primarySpanish } from "./types.ts";

const DATABASE_NAME = "catala-pocket-dictionary";
const DATABASE_VERSION = 2;
const HISTORY_STORE = "history";
const SAVED_STORE = "savedWords";
const CACHE_STORE = "dictionaryCache";
const SHARD_STORE = "dictionaryShards";
const META_STORE = "dictionaryMeta";

interface MetadataRecord<T = unknown> {
  key: string;
  value: T;
  updatedAt: number;
}

let databasePromise: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(HISTORY_STORE)) {
        database.createObjectStore(HISTORY_STORE, { keyPath: "normalizedQuery" });
      }
      if (!database.objectStoreNames.contains(SAVED_STORE)) {
        database.createObjectStore(SAVED_STORE, { keyPath: "lemma" });
      }
      if (!database.objectStoreNames.contains(CACHE_STORE)) {
        database.createObjectStore(CACHE_STORE, { keyPath: "query" });
      }
      if (!database.objectStoreNames.contains(SHARD_STORE)) {
        const store = database.createObjectStore(SHARD_STORE, { keyPath: "key" });
        store.createIndex("dataVersion", "dataVersion", { unique: false });
        store.createIndex("lastAccess", "lastAccess", { unique: false });
      }
      if (!database.objectStoreNames.contains(META_STORE)) {
        database.createObjectStore(META_STORE, { keyPath: "key" });
      }
    };

    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        databasePromise = undefined;
      };
      resolve(database);
    };
    request.onerror = () => {
      databasePromise = undefined;
      reject(request.error);
    };
    request.onblocked = () => {
      databasePromise = undefined;
      reject(new Error("IndexedDB upgrade is blocked by another app window."));
    };
  });

  return databasePromise;
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) {
    return false;
  }

  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function getStorageEstimate(): Promise<StorageEstimate | undefined> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) {
    return undefined;
  }
  try {
    return await navigator.storage.estimate();
  } catch {
    return undefined;
  }
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, mode);
  // Register completion handlers before awaiting the request. A fast
  // IndexedDB implementation is allowed to complete the transaction as soon
  // as the request callback returns, which would otherwise leave this promise
  // waiting forever.
  const completion =
    mode === "readwrite"
      ? new Promise<void>((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
        })
      : undefined;
  const result = await requestToPromise(action(transaction.objectStore(storeName)));
  await completion;
  return result;
}

export async function getHistory(): Promise<HistoryRecord[]> {
  const records = await withStore<HistoryRecord[]>(HISTORY_STORE, "readonly", (store) =>
    store.getAll(),
  );
  return records.sort((a, b) => b.timestamp - a.timestamp).slice(0, 20);
}

export async function addHistory(result: FoundLookup): Promise<HistoryRecord> {
  const record: HistoryRecord = {
    query: result.searchedForm,
    normalizedQuery: result.normalizedQuery,
    lemma: result.lemma,
    meaning:
      primaryChinese(result.entry) ||
      primarySpanish(result.entry) ||
      result.entry.definitions?.ca?.[0] ||
      "",
    timestamp: Date.now(),
  };
  await withStore<IDBValidKey>(HISTORY_STORE, "readwrite", (store) => store.put(record));
  return record;
}

export async function clearHistory(): Promise<void> {
  await withStore<undefined>(HISTORY_STORE, "readwrite", (store) => store.clear());
}

export async function getSavedWords(): Promise<SavedRecord[]> {
  const records = await withStore<SavedRecord[]>(SAVED_STORE, "readonly", (store) =>
    store.getAll(),
  );
  return records.sort((a, b) => b.savedAt - a.savedAt);
}

export async function saveWord(
  result: FoundLookup,
  dataVersion?: string,
): Promise<SavedRecord> {
  const record: SavedRecord = {
    lemma: result.lemma,
    entry: result.entry,
    savedAt: Date.now(),
    dataVersion,
  };
  await withStore<IDBValidKey>(SAVED_STORE, "readwrite", (store) => store.put(record));
  return record;
}

export async function removeSavedWord(lemma: string): Promise<void> {
  await withStore<undefined>(SAVED_STORE, "readwrite", (store) => store.delete(lemma));
}

export async function cacheLookup(
  result: FoundLookup,
  dataVersion?: string,
): Promise<void> {
  const record: CacheRecord = {
    query: result.normalizedQuery,
    lemma: result.lemma,
    result,
    cachedAt: Date.now(),
    dataVersion,
  };
  await withStore<IDBValidKey>(CACHE_STORE, "readwrite", (store) => store.put(record));
}

export async function getCachedLookup(query: string): Promise<CacheRecord | undefined> {
  const cached = await withStore<CacheRecord | undefined>(
    CACHE_STORE,
    "readonly",
    (store) => store.get(query),
  );
  // Ignore v1 records after the canonical schema migration.
  if (cached && !cached.result.entry.normalizedLemma) return undefined;
  return cached;
}

export async function getDictionaryShard(
  key: string,
): Promise<StoredDictionaryShard | undefined> {
  return withStore<StoredDictionaryShard | undefined>(SHARD_STORE, "readonly", (store) =>
    store.get(key),
  );
}

export async function putDictionaryShard(record: StoredDictionaryShard): Promise<void> {
  await withStore<IDBValidKey>(SHARD_STORE, "readwrite", (store) => store.put(record));
}

export async function deleteDictionaryShardsExcept(
  activeDataVersion: string,
): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(SHARD_STORE, "readwrite");
  const completion = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
  const store = transaction.objectStore(SHARD_STORE);
  await new Promise<void>((resolve, reject) => {
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      const record = cursor.value as StoredDictionaryShard;
      if (record.dataVersion !== activeDataVersion) cursor.delete();
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
  await completion;
}

export async function getDictionaryMetadata<T>(key: string): Promise<T | undefined> {
  const record = await withStore<MetadataRecord<T> | undefined>(
    META_STORE,
    "readonly",
    (store) => store.get(key),
  );
  return record?.value;
}

export async function setDictionaryMetadata<T>(key: string, value: T): Promise<void> {
  await withStore<IDBValidKey>(META_STORE, "readwrite", (store) =>
    store.put({ key, value, updatedAt: Date.now() } satisfies MetadataRecord<T>),
  );
}

export async function countDictionaryShards(dataVersion: string): Promise<number> {
  const database = await openDatabase();
  const transaction = database.transaction(SHARD_STORE, "readonly");
  const index = transaction.objectStore(SHARD_STORE).index("dataVersion");
  return requestToPromise(index.count(IDBKeyRange.only(dataVersion)));
}

