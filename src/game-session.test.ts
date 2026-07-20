import { afterEach, describe, expect, it, vi } from "vitest";
import { GameSession, playerEventForAction } from "./game-session.ts";
import type { LoadedLevel } from "./level.ts";

const level: LoadedLevel = {
  path: "/level.json",
  song: { version: 1, id: "song", title: "Song", audio: "/song.mp3", duration: 10 },
  chart: {
    version: 1,
    song: "/song.json",
    level: { id: "test", difficulty: "test", rating: 1, speed: 1, endTime: 10 },
    timing: { bpm: 120, offset: 0 },
    playfield: { lanes: 4, travelTime: 1 },
    notes: [],
    visualEffects: { hitBurst: true, laneGlow: true },
  },
};

afterEach(() => vi.unstubAllGlobals());

describe("playerEventForAction", () => {
  it("maps scored camera actions to rhythm events", () => {
    expect(playerEventForAction({ type: "LEFT_STEP", lane: 2 }, 1.25)).toEqual({
      time: 1.25,
      type: "STEP",
      foot: "left",
      lane: 2,
    });
    expect(playerEventForAction({ type: "JUMP" }, 2)).toEqual({ time: 2, type: "JUMP", foot: "both" });
    expect(playerEventForAction({ type: "LEFT_ENTER_LANE", lane: 1 }, 3)).toBeNull();
  });

  it("pauses, resumes, and clears pause when restarted", async () => {
    const suspend = vi.fn();
    const resume = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    }));
    vi.stubGlobal("AudioContext", class {
      currentTime = 0;
      destination = {};
      decodeAudioData = () => Promise.resolve({} as AudioBuffer);
      createBufferSource = () => ({
        buffer: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      });
      resume = resume;
      suspend = suspend;
    });

    const session = new GameSession(level);
    await session.load();
    await session.start();
    await session.togglePause();
    expect(session.snapshot()).toMatchObject({ running: true, paused: true });
    expect(suspend).toHaveBeenCalledOnce();

    await session.togglePause();
    expect(session.snapshot().paused).toBe(false);
    await session.togglePause();
    await session.start();
    expect(session.snapshot()).toMatchObject({ running: true, paused: false });
  });
});
