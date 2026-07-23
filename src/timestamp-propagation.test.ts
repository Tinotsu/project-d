import { afterEach, describe, expect, it, vi } from "vitest";
import { GameSession, playerEventForAction } from "./game-session.ts";
import type { LoadedLevel } from "./level.ts";

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
});
