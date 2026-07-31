import { describe, expect, it } from "vitest";
import type { ChartNote } from "../../domain/chart/types.ts";
import {
  noteTravelProgress,
  verticalSlideLaneAtTime,
  verticalSlideUvsAtTime,
} from "./three-playfield.ts";

describe("note travel", () => {
  it("keeps notes between the far and hit edges of the track", () => {
    expect(noteTravelProgress(2, 2)).toBe(0);
    expect(noteTravelProgress(1, 2)).toBeGreaterThan(0);
    expect(noteTravelProgress(0, 2)).toBe(1);
    expect(noteTravelProgress(-1, 2)).toBe(1);
  });

  it("spawns vertical slides from their starting lane", () => {
    const note: ChartNote = {
      id: "slide",
      time: 10,
      type: "VERTICAL_SLIDE",
      lane: 1,
      endLane: 4,
      duration: 2,
      foot: "left",
    };

    expect(verticalSlideLaneAtTime(note, 10)).toBe(1);
    expect(verticalSlideLaneAtTime(note, 11)).toBe(2.5);
    expect(verticalSlideLaneAtTime(note, 12)).toBe(4);

    expect(verticalSlideUvsAtTime(note, 9, 2)).toEqual([
      [0, 0.5], [1, 0.5], [1, 0], [0, 0],
    ]);
    expect(verticalSlideUvsAtTime(note, 11.5, 2)).toEqual([
      [0, 1], [1, 1], [1, 0.75], [0, 0.75],
    ]);
  });
});
