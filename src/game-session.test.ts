import { describe, expect, it } from "vitest";
import { playerEventForAction } from "./game-session.ts";

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
});
