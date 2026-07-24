import { describe, expect, it } from "vitest";
import { createTimelineNote, sampleWaveform } from "./level-builder.tsx";

describe("level builder", () => {
  it("creates the requested move at an exact lane and time", () => {
    expect(createTimelineNote("n004", "RIGHT_STEP", 3, 12.375)).toEqual({
      id: "n004",
      time: 12.375,
      type: "STEP",
      lane: 3,
      foot: "right",
    });
    expect(createTimelineNote("n005", "SLIDE_LEFT", 3, 13)).toMatchObject({
      lane: 3,
      endLane: 2,
      type: "SLIDE",
    });
  });

  it("reduces audio samples to visible amplitude peaks", () => {
    expect(sampleWaveform(new Float32Array([0, 0.5, -1, 0.25]), 2)).toEqual([0.5, 1]);
  });
});
