import type { LoadedLevel } from "../../domain/chart/types.ts";

export type StoredLevel = {
  level: LoadedLevel;
  updatedAt: number;
};

export async function loadStoredLevels(): Promise<StoredLevel[]> {
  const response = await fetch("/api/levels");
  if (!response.ok) throw new Error("Could not load saved levels from SQLite");
  return response.json() as Promise<StoredLevel[]>;
}

export async function storeLevel(level: LoadedLevel): Promise<void> {
  const { audioBlob, ...storedLevel } = level;
  const path = `/api/levels/${encodeURIComponent(level.song.id)}`;
  const response = await fetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(storedLevel),
  });
  if (!response.ok) throw new Error("Could not save level to SQLite");

  if (!audioBlob) return;
  const audioResponse = await fetch(`${path}/audio`, {
    method: "PUT",
    headers: { "Content-Type": audioBlob.type || "application/octet-stream" },
    body: audioBlob,
  });
  if (!audioResponse.ok) throw new Error("Could not save level audio to SQLite");
}
