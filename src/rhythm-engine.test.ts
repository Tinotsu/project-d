import { describe, expect, it } from "vitest";
import { RhythmEngine, type ChartNote } from "./rhythm-engine.ts";

const note: ChartNote = { id: "n1", time: 1, type: "STEP", lane: 1, foot: "left" };

describe("RhythmEngine", () => {
  it.each([
    [1.05, "perfect", 1000],
    [1.1, "great", 700],
    [1.16, "good", 400],
  ] as const)("judges an event at %s seconds as %s", (time, judgement, score) => {
    const engine = new RhythmEngine([note]);

    expect(engine.submit({ time, type: "STEP", lane: 1, foot: "left" })?.judgement).toBe(judgement);
    expect(engine.score.total).toBe(score);
    expect(engine.score.combo).toBe(1);
  });

  it("ignores mismatched and out-of-window events, then marks a late note missed", () => {
    const engine = new RhythmEngine([note]);

    expect(engine.submit({ time: 1, type: "STEP", lane: 2, foot: "left" })).toBeNull();
    expect(engine.submit({ time: 1.23, type: "STEP", lane: 1, foot: "left" })).toBeNull();
    expect(engine.update(1.24)).toEqual([]);
    expect(engine.update(1.241)[0]?.judgement).toBe("miss");
    expect(engine.score.miss).toBe(1);
    expect(engine.score.combo).toBe(0);
  });

  it("matches the closest compatible note and maintains combo", () => {
    const second = { ...note, id: "n2", time: 1.08 };
    const engine = new RhythmEngine([note, second]);

    expect(engine.submit({ time: 1.07, type: "STEP", lane: 1, foot: "left" })?.note.id).toBe("n2");
    expect(engine.submit({ time: 1, type: "STEP", lane: 1, foot: "left" })?.note.id).toBe("n1");
    expect(engine.score.combo).toBe(2);
    expect(engine.score.maxCombo).toBe(2);
  });
});
