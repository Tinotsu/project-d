import { afterEach, describe, expect, it, vi } from "vitest";
import { GameSession, playerEventForAction } from "./game-session.ts";
import { InputActionState } from "./foot-pose.ts";
import type { LoadedLevel } from "./level.ts";
import { judgementForOffset } from "./rhythm-engine.ts";

const level: LoadedLevel = {
  path: "/level.json",
  song: { version: 1, id: "song", title: "Song", audio: "/song.mp3", duration: 2 },
  chart: {
    version: 1,
    song: "/song.json",
    level: { id: "test", difficulty: "test", rating: 1, speed: 1, endTime: 2 },
    timing: { bpm: 120, offset: 0 },
    playfield: { lanes: 4, travelTime: 1 },
    notes: [{ id: "n1", time: 0.9, type: "STEP", lane: 2, foot: "left" }],
    visualEffects: { hitBurst: true, laneGlow: true },
  },
};

let context: FakeAudioContext;

class FakeAudioContext {
  currentTime = 0;
  destination = {};
  outputPerformanceTime = 0;

  constructor() {
    context = this;
  }

  decodeAudioData = () => Promise.resolve({} as AudioBuffer);
  createBufferSource = () => ({
    buffer: null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  });
  getOutputTimestamp = () => ({
    contextTime: this.currentTime,
    performanceTime: this.outputPerformanceTime,
  });
  resume = vi.fn();
  suspend = vi.fn();
}

async function startSession(): Promise<GameSession> {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  }));
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.spyOn(performance, "now").mockReturnValue(1000);
  const session = new GameSession(level);
  await session.load();
  await session.start();
  return session;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("camera timestamp propagation", () => {
  it("judges an action at camera capture time instead of inference completion", async () => {
    const session = await startSession();
    context.currentTime = 1.08;
    context.outputPerformanceTime = 1300;
    vi.spyOn(performance, "now").mockReturnValue(1300);

    const results = session.submit({
      capturedAt: 1200,
      actions: [{ type: "LEFT_STEP", lane: 2 }],
    });

    expect(results[0]?.judgement).toBe("perfect");
    expect(results[0]?.offset).toBeCloseTo(0);
    expect(session.snapshot().perfect).toBe(1);
  });

  it("advances misses only through frames that have finished inference", async () => {
    const session = await startSession();
    context.currentTime = 1.48;
    context.outputPerformanceTime = 1500;
    vi.spyOn(performance, "now").mockReturnValue(1500);

    expect(session.submit({ capturedAt: 1200, actions: [] })).toEqual([]);
    expect(session.snapshot().miss).toBe(0);

    expect(session.submit({ capturedAt: 1330, actions: [] })[0]?.judgement).toBe("miss");
    expect(session.snapshot().miss).toBe(1);
  });

  it("rejects frames captured before a start or resume boundary", async () => {
    const session = await startSession();
    context.currentTime = 1.08;
    context.outputPerformanceTime = 1300;
    vi.spyOn(performance, "now").mockReturnValue(1300);

    expect(session.submit({
      capturedAt: 999,
      actions: [{ type: "LEFT_STEP", lane: 2 }],
    })).toEqual([]);

    await session.togglePause();
    vi.spyOn(performance, "now").mockReturnValue(1400);
    await session.togglePause();
    expect(session.submit({
      capturedAt: 1399,
      actions: [{ type: "LEFT_STEP", lane: 2 }],
    })).toEqual([]);
    expect(session.snapshot().perfect).toBe(0);
  });

  it("judges a slide from its starting step after the foot reaches the next lane", async () => {
    const previousNotes = level.chart.notes;
    level.chart.notes = [{ id: "slide", time: 0.9, type: "SLIDE", lane: 1, endLane: 3, foot: "left" }];
    const session = await startSession();
    level.chart.notes = previousNotes;
    context.currentTime = 1.5;
    context.outputPerformanceTime = 1700;
    vi.spyOn(performance, "now").mockReturnValue(1700);

    expect(session.submit({ capturedAt: 1200, actions: [{ type: "LEFT_STEP", lane: 1 }] })).toEqual([]);
    expect(session.submit({ capturedAt: 1500, actions: [] })).toEqual([]);
    expect(session.submit({ capturedAt: 1600, actions: [{ type: "LEFT_SLIDE", lane: 1, endLane: 3, startedAt: 1200 }] })[0]?.judgement).toBe("perfect");
  });
});

describe("slide movement", () => {
  it("accepts slides slightly before the normal step window", () => {
    expect(judgementForOffset("SLIDE", -320)).toBe("good");
    expect(judgementForOffset("SLIDE", -321)).toBeNull();
    expect(judgementForOffset("STEP", -320)).toBeNull();
  });

  it("emits a slide after a landed foot moves two lanes", () => {
    const state = new InputActionState();
    state.update(1, 4, 0.8, 0.8, false, 0);
    state.update(1, 4, 0.7, 0.8, false, 100);
    expect(state.update(1, 4, 0.8, 0.8, false, 200)).toContainEqual({ type: "LEFT_STEP", lane: 1 });
    expect(state.update(2, 4, 0.8, 0.8, false, 300)).toEqual([]);
    expect(state.update(3, 4, 0.8, 0.8, false, 400)).toContainEqual({ type: "LEFT_SLIDE", lane: 1, endLane: 3, startedAt: 200 });

    const leftward = new InputActionState();
    leftward.update(3, 4, 0.8, 0.8, false, 0);
    leftward.update(3, 4, 0.7, 0.8, false, 100);
    expect(leftward.update(1, 4, 0.8, 0.8, false, 200)).toContainEqual({ type: "LEFT_SLIDE", lane: 3, endLane: 1, startedAt: 100 });

    const noisyRight = new InputActionState();
    noisyRight.update(4, 1, 0.8, 0.8, false, 0);
    noisyRight.update(4, 1, 0.8, 0.7, false, 100);
    expect(noisyRight.update(4, 2, 0.8, 0.8, false, 200)).toContainEqual({ type: "RIGHT_STEP", lane: 2 });
    expect(noisyRight.update(4, 3, 0.8, 0.8, false, 300)).toContainEqual({ type: "RIGHT_SLIDE", lane: 1, endLane: 3, startedAt: 100 });
  });
});
