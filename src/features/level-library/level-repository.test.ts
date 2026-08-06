import { afterEach, describe, expect, it, vi } from "vitest";
import type { LoadedLevel } from "../../domain/chart/types.ts";
import { changeLevelVisibility, deleteStoredLevel, searchPublicLevels, storeLevel } from "./level-repository.ts";

const level: LoadedLevel = {
  path: "",
  song: { version: 1, id: "level-one", title: "Level one", audio: "blob:level-one", duration: 30 },
  chart: {
    version: 1,
    song: "",
    level: { id: "level-one", difficulty: "Normal", rating: 1, speed: 1, endTime: 30 },
    timing: { bpm: 120, offset: 0 },
    playfield: { lanes: 4, travelTime: 1 },
    notes: [],
    visualEffects: { hitBurst: true, laneGlow: true },
  },
};

describe("deleteStoredLevel", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("deletes the encoded level ID", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await deleteStoredLevel("level/one");

    expect(fetchMock).toHaveBeenCalledWith("/api/levels/level%2Fone", { method: "DELETE" });
  });

  it("reports a failed deletion", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })));

    await expect(deleteStoredLevel("level-one")).rejects.toThrow("Could not delete level");
  });
});

describe("level visibility", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("publishes the encoded owned level ID", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await changeLevelVisibility("level one", "public");

    expect(fetchMock).toHaveBeenCalledWith("/api/levels/level%20one/visibility", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visibility: "public" }),
    });
  });

  it("encodes public search filters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json([]));
    vi.stubGlobal("fetch", fetchMock);

    await searchPublicLevels("summer mix", "Hard");

    expect(fetchMock).toHaveBeenCalledWith("/api/public-levels?q=summer+mix&difficulty=Hard");
  });
});

describe("storeLevel", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("does not upload an unchanged audio blob on every autosave", async () => {
    const audioBlob = new Blob(["audio"], { type: "audio/mpeg" });
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await storeLevel({ ...level, audioBlob });
    await storeLevel({ ...level, audioBlob });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toBe("/api/levels/level-one/audio");
  });

  it("uploads a reused audio blob for each different level", async () => {
    const audioBlob = new Blob(["audio"], { type: "audio/mpeg" });
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const secondLevel: LoadedLevel = {
      ...level,
      song: { ...level.song, id: "level-two" },
      chart: { ...level.chart, level: { ...level.chart.level, id: "level-two" } },
    };

    await storeLevel({ ...level, audioBlob });
    await storeLevel({ ...secondLevel, audioBlob });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[3][0]).toBe("/api/levels/level-two/audio");
  });
});
