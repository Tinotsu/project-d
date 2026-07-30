import { describe, expect, it } from "vitest";
import type { ChartNote } from "../../domain/chart/types.ts";
import {
  createTimelineNote,
  moveTimelineNotes,
  nextTimelineZoom,
  pasteTimelineNotes,
  resizeTimelineSustainedNote,
  sampleWaveform,
  timelineNavigationNotes,
  timelinePixelsPerSecond,
  timelineScrollTopAfterZoom,
  turnTimelineSlide,
  turnTimelineVerticalSlide,
} from "./editor-math.ts";

describe("level editor math", () => {
  it("creates each note family with its expected defaults", () => {
    expect(createTimelineNote("jump", "JUMP", 1, 2)).toEqual({
      id: "jump",
      time: 2,
      type: "JUMP",
      foot: "both",
    });
    expect(createTimelineNote("stay", "RIGHT_STAY", 2, 3, 0.5)).toMatchObject({
      type: "STAY",
      lane: 2,
      stepPosition: 1.5,
      duration: 1,
      foot: "right",
    });
    expect(createTimelineNote("slide", "HORIZONTAL_SLIDE_RIGHT", 2, 4)).toMatchObject({
      type: "HORIZONTAL_SLIDE",
      lane: 2,
      endLane: 4,
      foot: "right",
    });
  });

  it("moves a group without allowing it past the timeline or lane edges", () => {
    const notes: ChartNote[] = [
      { id: "a", time: 1, type: "STEP", lane: 1, foot: "left" },
      { id: "b", time: 2, type: "STEP", lane: 4, foot: "right" },
    ];
    expect(moveTimelineNotes(notes, 2, -5, 10)).toEqual([
      { ...notes[0], time: 0, stepPosition: 0 },
      { ...notes[1], time: 1, stepPosition: 3 },
    ]);
  });

  it("resizes, turns, pastes, samples, and navigates deterministically", () => {
    const stay: ChartNote = { id: "n2", time: 2, type: "STAY", lane: 2, duration: 2, foot: "left" };
    expect(resizeTimelineSustainedNote(stay, 100, 100, 10, "start")).toMatchObject({ time: 3, duration: 1 });

    const slide: ChartNote = { id: "n3", time: 3, type: "HORIZONTAL_SLIDE", lane: 1, endLane: 3, foot: "left" };
    expect(turnTimelineSlide(slide)).toMatchObject({ lane: 3, endLane: 1 });
    expect(turnTimelineVerticalSlide({ ...stay, type: "VERTICAL_SLIDE", endLane: 2 }, 5, "end").endLane).toBe(4);
    expect(pasteTimelineNotes([stay], [stay, slide], 0, 5, 10)[0]).toMatchObject({ id: "n004", time: 5, lane: 1 });

    expect(sampleWaveform(new Float32Array([0.1, -0.5, 0.25, -0.75]), 2)).toEqual([0.5, 0.75]);
    expect(timelineNavigationNotes([slide, stay])).toEqual({ first: stay, last: slide });
  });

  it("keeps the zoom anchor at the same song time", () => {
    expect(timelinePixelsPerSecond(1)).toBe(720);
    expect(nextTimelineZoom(1, "in")).toBe(1.25);
    expect(timelineScrollTopAfterZoom(7200, 3000, 200, 1, 9000, 1.25)).toBe(3800);
  });
});
