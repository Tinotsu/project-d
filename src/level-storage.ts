import type { LoadedLevel } from "./level.ts";

export type StoredLevel = {
  level: LoadedLevel;
  published: boolean;
  updatedAt: number;
};

const databaseName = "project-d-levels";
const storeName = "levels";

function openLevelDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName, { keyPath: "key" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadStoredLevels(): Promise<StoredLevel[]> {
  const database = await openLevelDatabase();
  const records = await new Promise<Array<StoredLevel & { key: string }>>((resolve, reject) => {
    const request = database.transaction(storeName).objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  database.close();

  return records
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map(({ level, published, updatedAt }) => ({
      level: level.audioBlob
        ? { ...level, song: { ...level.song, audio: URL.createObjectURL(level.audioBlob) } }
        : level,
      published,
      updatedAt,
    }));
}

export async function storeLevel(level: LoadedLevel, published: boolean): Promise<void> {
  const database = await openLevelDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    store.put({
      key: `${published ? "published" : "draft"}:${level.song.id}`,
      level: level.audioBlob ? { ...level, song: { ...level.song, audio: "" } } : level,
      published,
      updatedAt: Date.now(),
    });
    if (published) store.delete(`draft:${level.song.id}`);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}
