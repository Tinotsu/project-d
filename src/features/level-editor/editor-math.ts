import {
  horizontalSlideBounds,
  isSustainedNote,
  stepBounds,
  verticalSlideBounds,
} from "../../domain/chart/note-geometry.ts";
import type { ChartNote } from "../../domain/chart/types.ts";

export type AddNoteType =
  | "LEFT_STEP"
  | "RIGHT_STEP"
  | "LEFT_STAY"
  | "RIGHT_STAY"
  | "LEFT_VERTICAL_SLIDE"
  | "RIGHT_VERTICAL_SLIDE"
  | "JUMP"
  | "HORIZONTAL_SLIDE_LEFT"
  | "HORIZONTAL_SLIDE_RIGHT";

export type TimelineSelection = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const normalPixelsPerSecond = 720;
const timelineZoomLevels = [0.02, 0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3];

export function sampleWaveform(channel: Float32Array, barCount: number): number[] {
  const blockSize = Math.max(1, Math.floor(channel.length / barCount));
  return Array.from({ length: barCount }, (_, index) => {
    let peak = 0;
    const end = Math.min(channel.length, (index + 1) * blockSize);
    for (let sample = index * blockSize; sample < end; sample++) peak = Math.max(peak, Math.abs(channel[sample]));
    return peak;
  });
}

export function createTimelineNote(
  id: string,
  type: AddNoteType,
  lane: number,
  time: number,
  laneOffset?: 0 | 0.5,
): ChartNote {
  if (type === "JUMP") return { id, time, type: "JUMP", foot: "both" };
  if (type === "HORIZONTAL_SLIDE_LEFT" || type === "HORIZONTAL_SLIDE_RIGHT") {
    const pointsRight = type === "HORIZONTAL_SLIDE_RIGHT";
    const slidePosition = Math.max(0, Math.min(2, lane - 1 + (laneOffset ?? 0.5) - (pointsRight ? 0 : 2)));
    const firstLane = Math.min(2, Math.floor(slidePosition + 1));
    return {
      id,
      time,
      type: "HORIZONTAL_SLIDE",
      lane: pointsRight ? firstLane : firstLane + 2,
      endLane: pointsRight ? firstLane + 2 : firstLane,
      slidePosition,
      foot: pointsRight ? "right" : "left",
    };
  }
  if (type === "LEFT_VERTICAL_SLIDE" || type === "RIGHT_VERTICAL_SLIDE") {
    return {
      id,
      time,
      type: "VERTICAL_SLIDE",
      lane,
      endLane: lane,
      duration: 1,
      foot: type === "LEFT_VERTICAL_SLIDE" ? "left" : "right",
    };
  }
  const stepPosition = Math.max(0, Math.min(3, lane - 1 + (laneOffset ?? 0)));
  if (type === "LEFT_STAY" || type === "RIGHT_STAY") {
    return {
      id,
      time,
      type: "STAY",
      lane: Math.min(4, Math.floor(stepPosition + 1)),
      stepPosition,
      duration: 1,
      foot: type === "LEFT_STAY" ? "left" : "right",
    };
  }
  return {
    id,
    time,
    type: "STEP",
    lane: Math.min(4, Math.floor(stepPosition + 1)),
    stepPosition,
    foot: type === "LEFT_STEP" ? "left" : "right",
  };
}

export function moveTimelineNote(note: ChartNote, laneDelta: number, timeDelta: number, duration: number): ChartNote {
  const lastTime = isSustainedNote(note) ? duration - (note.duration ?? 1) : duration;
  const time = Number(Math.max(0, Math.min(lastTime, note.time + timeDelta)).toFixed(1));
  if (note.type === "JUMP") return { ...note, time };

  if (note.type === "VERTICAL_SLIDE") {
    const appliedLaneDelta = Math.sign(laneDelta) * Math.round(Math.abs(laneDelta));
    return {
      ...note,
      time,
      lane: note.lane! + appliedLaneDelta,
      endLane: note.endLane! + appliedLaneDelta,
    };
  }

  if (note.type === "HORIZONTAL_SLIDE") {
    const slidePosition = Math.max(0, Math.min(2, horizontalSlideBounds(note).left + laneDelta));
    const firstLane = Math.min(2, Math.floor(slidePosition + 1));
    return note.endLane! < note.lane!
      ? { ...note, time, lane: firstLane + 2, endLane: firstLane, slidePosition }
      : { ...note, time, lane: firstLane, endLane: firstLane + 2, slidePosition };
  }

  const stepPosition = Math.max(0, Math.min(3, stepBounds(note).left + laneDelta));
  return { ...note, time, lane: Math.min(4, Math.floor(stepPosition + 1)), stepPosition };
}

export function moveTimelineNotes(
  notes: ChartNote[],
  laneDelta: number,
  timeDelta: number,
  duration: number,
): ChartNote[] {
  if (!notes.length) return [];
  const minTime = Math.min(...notes.map((note) => note.time));
  const maxTime = Math.max(...notes.map((note) => note.time + (isSustainedNote(note) ? note.duration ?? 1 : 0)));
  const boundedTimeDelta = Math.max(-minTime, Math.min(duration - maxTime, timeDelta));
  const laneBounds = notes
    .filter((note) => note.type !== "JUMP")
    .map((note) => note.type === "HORIZONTAL_SLIDE"
      ? horizontalSlideBounds(note)
      : note.type === "VERTICAL_SLIDE" ? verticalSlideBounds(note) : stepBounds(note));
  const boundedLaneDelta = laneBounds.length
    ? Math.max(
      -Math.min(...laneBounds.map((bounds) => bounds.left)),
      Math.min(4 - Math.max(...laneBounds.map((bounds) => bounds.right)), laneDelta),
    )
    : 0;
  return notes.map((note) => moveTimelineNote(note, boundedLaneDelta, boundedTimeDelta, duration));
}

export function resizeTimelineSustainedNote(
  note: ChartNote,
  pixelDelta: number,
  pixelsPerSecond: number,
  levelDuration: number,
  edge: "start" | "end",
): ChartNote {
  if (edge === "start") {
    const endTime = note.time + (note.duration ?? 1);
    const time = Math.max(0, Math.min(endTime - 0.1, note.time + pixelDelta / pixelsPerSecond));
    const roundedTime = Number(time.toFixed(1));
    return {
      ...note,
      time: roundedTime,
      duration: Number((endTime - roundedTime).toFixed(1)),
    };
  }
  const duration = Math.max(
    0.1,
    Math.min(levelDuration - note.time, (note.duration ?? 1) + pixelDelta / pixelsPerSecond),
  );
  return { ...note, duration: Number(duration.toFixed(1)) };
}

export function timelineNotesInSelection(
  notes: ChartNote[],
  selection: TimelineSelection,
  timelineWidth: number,
  timelineHeight: number,
  pixelsPerSecond: number,
): string[] {
  return notes.filter((note) => {
    const bounds = note.type === "STEP" || note.type === "STAY"
      ? stepBounds(note)
      : note.type === "HORIZONTAL_SLIDE"
        ? horizontalSlideBounds(note)
        : note.type === "VERTICAL_SLIDE" ? verticalSlideBounds(note) : { left: 0, right: 4 };
    const x = (bounds.left + bounds.right) / 8 * timelineWidth;
    const y = timelineHeight - note.time * pixelsPerSecond;
    return x >= selection.left
      && x <= selection.left + selection.width
      && y >= selection.top
      && y <= selection.top + selection.height;
  }).map((note) => note.id);
}

export function pasteTimelineNotes(
  copiedNotes: ChartNote[],
  existingNotes: ChartNote[],
  lanePosition: number,
  time: number,
  duration: number,
): ChartNote[] {
  if (!copiedNotes.length) return [];
  const laneBounds = copiedNotes
    .filter((note) => note.type !== "JUMP")
    .map((note) => note.type === "HORIZONTAL_SLIDE"
      ? horizontalSlideBounds(note)
      : note.type === "VERTICAL_SLIDE" ? verticalSlideBounds(note) : stepBounds(note));
  const left = laneBounds.length ? Math.min(...laneBounds.map((bounds) => bounds.left)) : lanePosition;
  const firstTime = Math.min(...copiedNotes.map((note) => note.time));
  const movedNotes = moveTimelineNotes(copiedNotes, lanePosition - left, time - firstTime, duration);
  let nextNumber = Math.max(0, ...existingNotes.map((note) => Number(note.id.match(/\d+/)?.[0] ?? 0))) + 1;
  return movedNotes.map((note) => ({
    ...note,
    id: `n${String(nextNumber++).padStart(3, "0")}`,
  }));
}

export function turnTimelineSlide(note: ChartNote): ChartNote {
  return { ...note, lane: note.endLane, endLane: note.lane };
}

export function turnTimelineVerticalSlide(
  note: ChartNote,
  laneDelta: number,
  edge: "start" | "end",
): ChartNote {
  const lane = Math.max(1, Math.min(4, (edge === "start" ? note.lane! : note.endLane!) + laneDelta));
  return edge === "start" ? { ...note, lane } : { ...note, endLane: lane };
}

export function timelinePixelsPerSecond(zoom: number): number {
  return normalPixelsPerSecond * zoom;
}

export function nextTimelineZoom(zoom: number, direction: "in" | "out"): number {
  const index = timelineZoomLevels.indexOf(zoom);
  return timelineZoomLevels[Math.max(0, Math.min(timelineZoomLevels.length - 1, index + (direction === "in" ? 1 : -1)))];
}

export function timelineScrollTopAfterZoom(
  scrollHeight: number,
  scrollTop: number,
  anchorY: number,
  currentZoom: number,
  nextScrollHeight: number,
  nextZoom: number,
): number {
  const anchorTime = (scrollHeight - scrollTop - anchorY) / timelinePixelsPerSecond(currentZoom);
  return nextScrollHeight - anchorTime * timelinePixelsPerSecond(nextZoom) - anchorY;
}

export function timelineNavigationNotes(notes: ChartNote[]): {
  first: ChartNote | undefined;
  last: ChartNote | undefined;
} {
  const chronological = [...notes].sort((left, right) => left.time - right.time);
  return { first: chronological[0], last: chronological.at(-1) };
}
