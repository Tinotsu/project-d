import { describe, expect, it } from "vitest";
import { defaultCalibrationSettings } from "./calibration-settings.ts";
import { InputActionState, JumpDetector } from "./foot-pose.ts";
import { judgementForOffset, RhythmEngine } from "./rhythm-engine.ts";

describe("movement calibration", () => {
  it("uses the configured step lift threshold", () => {
    const normal = new InputActionState(defaultCalibrationSettings);
    normal.update(1, null, 0.5, null, false);
    normal.update(1, null, 0.47, null, false);
    expect(normal.update(1, null, 0.5, null, false)).toContainEqual({ type: "LEFT_STEP", lane: 1 });

    const strict = new InputActionState({ ...defaultCalibrationSettings, stepLift: 0.04 });
    strict.update(1, null, 0.5, null, false);
    strict.update(1, null, 0.47, null, false);
    expect(strict.update(1, null, 0.5, null, false)).toEqual([]);
  });

  it("uses the configured jump lift threshold", () => {
    const normal = new JumpDetector(defaultCalibrationSettings);
    normal.update(0.5, 0.5);
    expect(normal.update(0.46, 0.46)).toBe(true);

    const strict = new JumpDetector({ ...defaultCalibrationSettings, jumpLift: 0.05 });
    strict.update(0.5, 0.5);
    expect(strict.update(0.46, 0.46)).toBe(false);
  });

  it("uses separate timing windows for steps and jumps", () => {
    expect(judgementForOffset("STEP", 55, defaultCalibrationSettings)).toBe("perfect");
    expect(judgementForOffset("JUMP", 55, defaultCalibrationSettings)).toBe("great");
    expect(judgementForOffset("JUMP", 170, defaultCalibrationSettings)).toBeNull();
  });

  it("applies configured timing windows to game notes", () => {
    const engine = new RhythmEngine(
      [{ id: "step", time: 1, type: "STEP", foot: "left", lane: 1 }],
      {
        ...defaultCalibrationSettings,
        stepPerfectMs: 20,
        stepGreatMs: 35,
        stepGoodMs: 50,
      },
    );

    expect(engine.submit({ time: 1.06, type: "STEP", foot: "left", lane: 1 })).toBeNull();
    expect(engine.update(1.091)[0]?.judgement).toBe("miss");
  });
});
