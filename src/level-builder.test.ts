import { describe, expect, it } from "vitest";
import { createTimelineNote, moveTimelineNote, sampleWaveform, timelinePixelsPerSecond } from "./level-builder.tsx";

describe("level builder", () => {
  it("creates the requested move at an exact lane and time", () => {
    expect(createTimelineNote("n004", "RIGHT_STEP", 3, 12.375)).toEqual({
      id: "n004",
      time: 12.375,
      type: "STEP",
      lane: 3,
      foot: "right",
    });
    expect(createTimelineNote("n005", "SLIDE_LEFT", 3, 13, 0)).toMatchObject({
      lane: 3,
      laneOffset: 0,
      endLane: 1,
      type: "SLIDE",
    });
  });

  it("reduces audio samples to visible amplitude peaks", () => {
    expect(sampleWaveform(new Float32Array([0, 0.5, -1, 0.25]), 2)).toEqual([0.5, 1]);
  });

  it("moves steps across lanes and time while keeping slides valid", () => {
    expect(moveTimelineNote(
      createTimelineNote("n001", "LEFT_STEP", 2, 4),
      2,
      1.25,
      30,
    )).toMatchObject({ lane: 4, time: 5.25 });

    expect(moveTimelineNote(
      createTimelineNote("n002", "SLIDE_LEFT", 3, 8),
      -2,
      -10,
      30,
    )).toMatchObject({ lane: 3, endLane: 1, time: 0 });
  });

  it("keeps timestamp distance proportional while zooming", () => {
    expect(timelinePixelsPerSecond(0.5)).toBe(360);
    expect(timelinePixelsPerSecond(1)).toBe(720);
    expect(timelinePixelsPerSecond(2)).toBe(1440);
  });
});
