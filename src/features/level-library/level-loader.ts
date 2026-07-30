import type { LevelChart, LoadedLevel, SongMetadata } from "../../domain/chart/types.ts";

export type { LevelChart, LoadedLevel, SongMetadata } from "../../domain/chart/types.ts";

export async function loadLevel(path: string): Promise<LoadedLevel> {
  const chartResponse = await fetch(path);
  if (!chartResponse.ok) throw new Error("Could not load the level chart");
  const chart = await chartResponse.json() as LevelChart;

  const songResponse = await fetch(chart.song);
  if (!songResponse.ok) throw new Error("Could not load the song metadata");
  const song = await songResponse.json() as SongMetadata;

  return { path, chart, song };
}
