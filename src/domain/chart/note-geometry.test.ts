import { describe, expect, it } from "vitest";
import {
  horizontalSlideBounds,
  isSustainedNote,
  stepBounds,
  verticalSlideBounds,
} from "./note-geometry.ts";
import type { ChartNote } from "./types.ts";

describe("note geometry", () => {
  it("calculates horizontal, vertical, and step bounds", () => {
    expect(horizontalSlideBounds({
      id: "slide",
      time: 1,
      type: "HORIZONTAL_SLIDE",
      lane: 1,
      endLane: 3,
      foot: "left",
    })).toEqual({ left: 0.5, right: 2.5 });
    expect(verticalSlideBounds({
      id: "vertical",
      time: 1,
      type: "VERTICAL_SLIDE",
      lane: 4,
      endLane: 2,
      foot: "right",
    })).toEqual({ left: 1, right: 4 });
    expect(stepBounds({
      id: "step",
      time: 1,
      type: "STEP",
      lane: 2,
      stepPosition: 1.5,
      foot: "left",
    })).toEqual({ left: 1.5, right: 2.5 });
  });

  it("identifies only timed sustained notes", () => {
    const note = (type: ChartNote["type"]): ChartNote => ({ id: type, time: 0, type, foot: "left" });
    expect(isSustainedNote(note("STAY"))).toBe(true);
    expect(isSustainedNote(note("VERTICAL_SLIDE"))).toBe(true);
    expect(isSustainedNote(note("STEP"))).toBe(false);
  });
});
