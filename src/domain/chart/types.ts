export type NoteType = "STEP" | "JUMP" | "HORIZONTAL_SLIDE" | "STAY" | "VERTICAL_SLIDE";
export type Foot = "left" | "right" | "both" | "either";

export type ChartNote = {
  id: string;
  time: number;
  type: NoteType;
  lane?: number;
  laneOffset?: 0 | 0.5;
  endLane?: number;
  slidePosition?: number;
  stepPosition?: number;
  duration?: number;
  foot: Foot;
};

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
  audioBlob?: Blob;
};
