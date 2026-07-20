import type { ChartNote } from "./rhythm-engine.ts";

export type SongMetadata = {
  version: number;
  id: string;
  title: string;
  audio: string;
  duration: number;
};

export type LevelChart = {
  version: number;
  song: string;
  level: { id: string; difficulty: string; rating: number; speed: number; endTime: number };
  timing: { bpm: number; offset: number };
  playfield: { lanes: number; travelTime: number };
  notes: ChartNote[];
  visualEffects: { hitBurst: boolean; laneGlow: boolean };
};

export type LoadedLevel = {
  path: string;
  chart: LevelChart;
  song: SongMetadata;
};

export async function loadLevel(path: string): Promise<LoadedLevel> {
  const chartResponse = await fetch(path);
  if (!chartResponse.ok) throw new Error("Could not load the level chart");
  const chart = await chartResponse.json() as LevelChart;

  const songResponse = await fetch(chart.song);
  if (!songResponse.ok) throw new Error("Could not load the song metadata");
  const song = await songResponse.json() as SongMetadata;

  return { path, chart, song };
}
