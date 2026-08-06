import { describe, expect, it } from "vitest";
import { LevelInputError, readLevelDocument } from "./level-validation.ts";

const validLevel = {
  path: "",
  song: { version: 1, id: "level-one", title: "Level one", audio: "", duration: 30 },
  chart: {
    version: 1,
    song: "",
    level: { id: "level-one", difficulty: "Normal", rating: 1, speed: 1, endTime: 30 },
    timing: { bpm: 120, offset: 0 },
    playfield: { lanes: 4, travelTime: 1 },
    notes: [{ id: "move-one", time: 2, type: "STEP", lane: 1, foot: "left" }],
    visualEffects: { hitBurst: true, laneGlow: true },
  },
};

describe("readLevelDocument", () => {
  it("accepts a valid level with the request ID", () => {
    expect(readLevelDocument(validLevel, "level-one")).toEqual(validLevel);
  });

  it("rejects a level whose IDs do not match the request", () => {
    expect(() => readLevelDocument(validLevel, "another-level")).toThrow(LevelInputError);
  });

  it("rejects invalid notes instead of coercing them", () => {
    const invalid = structuredClone(validLevel);
    invalid.chart.notes[0].time = 31;
    expect(() => readLevelDocument(invalid, "level-one")).toThrow("Time for move-one must be between 0 and 30");
  });
});
