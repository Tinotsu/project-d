import type { ChartNote } from "./types.ts";

export function horizontalSlideBounds(note: ChartNote): { left: number; right: number } {
  const start = note.lane! - 1 + (note.laneOffset ?? 0.5);
  const end = note.endLane! - 0.5;
  const left = Math.max(0, Math.min(2, note.slidePosition ?? Math.min(start, end)));
  return { left, right: left + 2 };
}

export function verticalSlideBounds(note: ChartNote): { left: number; right: number } {
  return {
    left: Math.min(note.lane!, note.endLane!) - 1,
    right: Math.max(note.lane!, note.endLane!),
  };
}

export function isSustainedNote(note: ChartNote): boolean {
  return note.type === "STAY" || note.type === "VERTICAL_SLIDE";
}

export function stepBounds(note: ChartNote): { left: number; right: number } {
  const left = Math.max(0, Math.min(3, note.stepPosition ?? note.lane! - 1));
  return { left, right: left + 1 };
}
