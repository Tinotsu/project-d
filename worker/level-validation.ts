import type { ChartNote, LoadedLevel } from "../src/domain/chart/types.ts";

export type LevelDocument = Omit<LoadedLevel, "audioBlob">;

const noteTypes = new Set(["STEP", "JUMP", "HORIZONTAL_SLIDE", "STAY", "VERTICAL_SLIDE"]);
const feet = new Set(["left", "right", "both", "either"]);

export class LevelInputError extends Error {}

export function readLevelDocument(value: unknown, expectedId: string): LevelDocument {
  if (!isRecord(value)) throw new LevelInputError("Level must be a JSON object");
  if (typeof value.path !== "string") throw new LevelInputError("Level path must be a string");
  if (!isRecord(value.song)) throw new LevelInputError("Level song is required");
  if (!isRecord(value.chart)) throw new LevelInputError("Level chart is required");

  const song = value.song;
  requireInteger(song.version, "Song version");
  requireId(song.id, expectedId, "Song ID");
  requireText(song.title, "Song title", 1, 120);
  requireText(song.audio, "Song audio", 0, 2_000);
  requireNumberInRange(song.duration, "Song duration", 0, 14_400);

  const chart = value.chart;
  requireInteger(chart.version, "Chart version");
  requireText(chart.song, "Chart song", 0, 2_000);

  if (!isRecord(chart.level)) throw new LevelInputError("Chart level settings are required");
  const level = chart.level;
  requireId(level.id, expectedId, "Chart level ID");
  requireText(level.difficulty, "Difficulty", 1, 40);
  requireNumberInRange(level.rating, "Rating", 0, 100);
  requireNumberInRange(level.speed, "Speed", 0.01, 100);
  requireNumberInRange(level.endTime, "Level end time", 0.1, 14_400);

  if (!isRecord(chart.timing)) throw new LevelInputError("Timing settings are required");
  requireNumberInRange(chart.timing.bpm, "BPM", 0.01, 1_000);
  requireFiniteNumber(chart.timing.offset, "Timing offset");

  if (!isRecord(chart.playfield)) throw new LevelInputError("Playfield settings are required");
  if (chart.playfield.lanes !== 4) throw new LevelInputError("Playfield must have four lanes");
  requireNumberInRange(chart.playfield.travelTime, "Travel time", 0.01, 60);

  if (!Array.isArray(chart.notes)) throw new LevelInputError("Chart notes must be an array");
  if (chart.notes.length > 20_000) throw new LevelInputError("Chart has too many notes");
  const noteIds = new Set<string>();
  for (const note of chart.notes) {
    readNote(note, level.endTime, noteIds);
  }

  if (!isRecord(chart.visualEffects)) throw new LevelInputError("Visual effect settings are required");
  if (typeof chart.visualEffects.hitBurst !== "boolean" || typeof chart.visualEffects.laneGlow !== "boolean") {
    throw new LevelInputError("Visual effect settings must be boolean values");
  }

  return value as LevelDocument;
}

function readNote(value: unknown, endTime: number, noteIds: Set<string>): ChartNote {
  if (!isRecord(value)) throw new LevelInputError("Every note must be an object");
  requireText(value.id, "Note ID", 1, 100);
  if (noteIds.has(value.id)) throw new LevelInputError(`Duplicate note ID: ${value.id}`);
  noteIds.add(value.id);
  requireNumberInRange(value.time, `Time for ${value.id}`, 0, endTime);
  if (typeof value.type !== "string" || !noteTypes.has(value.type)) throw new LevelInputError(`Invalid note type for ${value.id}`);
  if (typeof value.foot !== "string" || !feet.has(value.foot)) throw new LevelInputError(`Invalid foot for ${value.id}`);
  if (value.type !== "JUMP" && value.lane === undefined) throw new LevelInputError(`Lane for ${value.id} is required`);
  optionalLane(value.lane, `Lane for ${value.id}`);
  if (value.laneOffset !== undefined && value.laneOffset !== 0 && value.laneOffset !== 0.5) {
    throw new LevelInputError(`Invalid lane offset for ${value.id}`);
  }
  if ((value.type === "HORIZONTAL_SLIDE" || value.type === "VERTICAL_SLIDE") && value.endLane === undefined) {
    throw new LevelInputError(`End lane for ${value.id} is required`);
  }
  optionalLane(value.endLane, `End lane for ${value.id}`);
  optionalFiniteNumber(value.slidePosition, `Slide position for ${value.id}`);
  optionalFiniteNumber(value.stepPosition, `Step position for ${value.id}`);
  if ((value.type === "STAY" || value.type === "VERTICAL_SLIDE") && value.duration === undefined) {
    throw new LevelInputError(`Duration for ${value.id} is required`);
  }
  if (value.duration !== undefined) {
    requireNumberInRange(value.duration, `Duration for ${value.id}`, 0.01, endTime);
    if (value.time + value.duration > endTime + 0.001) throw new LevelInputError(`Note ${value.id} ends after the level`);
  }
  return value as ChartNote;
}

function optionalLane(value: unknown, name: string): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 4) throw new LevelInputError(`${name} must be between 1 and 4`);
}

function optionalFiniteNumber(value: unknown, name: string): void {
  if (value !== undefined) requireFiniteNumber(value, name);
}

function requireId(value: unknown, expected: string, name: string): void {
  if (value !== expected) throw new LevelInputError(`${name} does not match the request path`);
}

function requireText(value: unknown, name: string, minimumLength: number, maximumLength: number): asserts value is string {
  if (typeof value !== "string" || value.trim().length < minimumLength || value.length > maximumLength) {
    throw new LevelInputError(`${name} must contain ${minimumLength}-${maximumLength} characters`);
  }
}

function requireInteger(value: unknown, name: string): asserts value is number {
  if (!Number.isInteger(value)) throw new LevelInputError(`${name} must be an integer`);
}

function requireFiniteNumber(value: unknown, name: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new LevelInputError(`${name} must be a finite number`);
}

function requireNumberInRange(value: unknown, name: string, minimum: number, maximum: number): asserts value is number {
  requireFiniteNumber(value, name);
  if (value < minimum || value > maximum) throw new LevelInputError(`${name} must be between ${minimum} and ${maximum}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
