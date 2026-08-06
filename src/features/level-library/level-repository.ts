import type { LoadedLevel } from "../../domain/chart/types.ts";

export type LevelVisibility = "private" | "public";

export type StoredLevel = {
  level: LoadedLevel;
  updatedAt: number;
  visibility: LevelVisibility;
};

export type PublicLevelSummary = {
  id: string;
  title: string;
  difficulty: string;
  noteCount: number;
  updatedAt: number;
  ownerName: string;
};

const uploadedAudioTargets = new WeakMap<Blob, Set<string>>();

export async function loadStoredLevels(): Promise<StoredLevel[]> {
  const response = await fetch("/api/levels");
  if (!response.ok) throw new Error(await apiError(response, "Could not load your levels"));
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
  if (!response.ok) throw new Error(await apiError(response, "Could not save level"));

  const uploadedLevelIds = audioBlob ? uploadedAudioTargets.get(audioBlob) : undefined;
  if (!audioBlob || uploadedLevelIds?.has(level.song.id)) return;
  const audioResponse = await fetch(`${path}/audio`, {
    method: "PUT",
    headers: { "Content-Type": audioBlob.type || "application/octet-stream" },
    body: audioBlob,
  });
  if (!audioResponse.ok) throw new Error(await apiError(audioResponse, "Could not save level audio"));
  if (uploadedLevelIds) uploadedLevelIds.add(level.song.id);
  else uploadedAudioTargets.set(audioBlob, new Set([level.song.id]));
}

export async function deleteStoredLevel(id: string): Promise<void> {
  const response = await fetch(`/api/levels/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) throw new Error(await apiError(response, "Could not delete level"));
}

export async function changeLevelVisibility(id: string, visibility: LevelVisibility): Promise<void> {
  const response = await fetch(`/api/levels/${encodeURIComponent(id)}/visibility`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visibility }),
  });
  if (!response.ok) throw new Error(await apiError(response, "Could not change level visibility"));
}

export async function searchPublicLevels(query: string, difficulty: string): Promise<PublicLevelSummary[]> {
  const search = new URLSearchParams();
  if (query) search.set("q", query);
  if (difficulty) search.set("difficulty", difficulty);
  const response = await fetch(`/api/public-levels?${search}`);
  if (!response.ok) throw new Error(await apiError(response, "Could not search public levels"));
  return response.json() as Promise<PublicLevelSummary[]>;
}

export async function loadPublicLevel(id: string): Promise<LoadedLevel> {
  const response = await fetch(`/api/public-levels/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error(await apiError(response, "Could not load public level"));
  return response.json() as Promise<LoadedLevel>;
}

async function apiError(response: Response, fallback: string): Promise<string> {
  const contentType = response.headers.get("Content-Type") ?? "";
  if (!contentType.startsWith("application/json")) return fallback;
  const body = await response.json() as { error?: unknown };
  return typeof body.error === "string" ? body.error : fallback;
}
