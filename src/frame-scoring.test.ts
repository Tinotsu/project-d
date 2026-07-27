import { describe, expect, it } from "vitest";
import { RhythmEngine, type ChartNote, type JudgementResult } from "./rhythm-engine.ts";

const ground = [0.8, 0.8, 0.8];
const stepLifted = [0.78, 0.78, 0.78];
const jumpLifted = [0.75, 0.75, 0.75];

function frame(
  engine: RhythmEngine,
  time: number,
  leftLane: number | null,
  rightLane: number | null,
  leftPoints = ground,
  rightPoints = ground,
) {
  return engine.trackFrame(time, leftLane, rightLane, leftPoints, rightPoints);
}

describe("camera frame scoring", () => {
  it("scores a same-lane step from its buffered point trajectory", () => {
    const engine = new RhythmEngine([
      { id: "step", time: 1, type: "STEP", lane: 2, foot: "left" },
    ]);

    frame(engine, 0.9, 2, 4);
    frame(engine, 0.98, 2, 4, stepLifted);
    frame(engine, 1.05, 2, 4);

    expect(frame(engine, 1.25, 2, 4)[0]?.judgement).toBe("perfect");
  });

  it("does not score a stationary step", () => {
    const engine = new RhythmEngine([
      { id: "step", time: 1, type: "STEP", lane: 2, foot: "left" },
    ]);

    frame(engine, 0.9, 2, 4);
    frame(engine, 1, 2, 4);

    expect(frame(engine, 1.25, 2, 4)[0]?.judgement).toBe("miss");
  });

  it("scores a jump from both buffered foot trajectories", () => {
    const engine = new RhythmEngine([
      { id: "jump", time: 1, type: "JUMP", foot: "both" },
    ]);

    frame(engine, 0.9, 1, 4);
    frame(engine, 0.98, 1, 4, jumpLifted, jumpLifted);
    frame(engine, 1.05, 1, 4);

    expect(frame(engine, 1.21, 1, 4)[0]?.judgement).toBe("perfect");
  });

  it("scores a slide from buffered start and end lanes", () => {
    const engine = new RhythmEngine([
      { id: "slide", time: 1, type: "SLIDE", lane: 1, endLane: 3, foot: "left" },
    ]);

    expect(frame(engine, 1, 1, 4)).toEqual([]);
    expect(frame(engine, 1.3, 3, 4)[0]?.judgement).toBe("perfect");
  });

  it.each([
    {
      note: { id: "stay", time: 1, type: "STAY", lane: 2, duration: 0.2, foot: "left" },
      frames: [[1, 2], [1.1, 2], [1.2, 2]],
    },
    {
      note: { id: "horizontal", time: 1, type: "HORIZONTAL_SLIDE", lane: 1, endLane: 3, duration: 1, foot: "left" },
      frames: [[1, 1], [1.5, 2], [2, 3]],
    },
  ] as { note: ChartNote; frames: [number, number][] }[])("scores $note.type from camera frames", ({ note, frames }) => {
    const engine = new RhythmEngine([note]);
    let results: JudgementResult[] = [];

    for (const [time, leftLane] of frames) results = frame(engine, time, leftLane, 4);

    expect(results[0]?.judgement).toBe("perfect");
  });
});
