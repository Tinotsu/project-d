import { describe, expect, it } from "vitest";
import { decodeFootPose, InputActionState, JumpDetector } from "./foot-pose.ts";

describe("InputActionState", () => {
  it("emits lane changes and jumps only on transitions", () => {
    const state = new InputActionState();
    state.update(2, 3, 0.8, 0.8, false);
    expect(state.update(1, 4, 0.8, 0.8, false)).toEqual([
      { type: "LEFT_ENTER_LANE", lane: 1 },
      { type: "RIGHT_ENTER_LANE", lane: 4 },
    ]);
    expect(state.update(1, 4, 0.74, 0.74, true)).toEqual([{ type: "JUMP" }]);
    expect(state.update(1, 4, 0.72, 0.72, true)).toEqual([]);
  });
});

describe("JumpDetector", () => {
  it("detects both feet taking off and landing", () => {
    const detector = new JumpDetector();

    expect(detector.update(0.8, 0.8)).toBe(false);
    expect(detector.update(0.78, 0.78)).toBe(false);
    expect(detector.update(0.74, 0.74)).toBe(true);
    expect(detector.update(0.72, 0.72)).toBe(true);
    expect(detector.update(0.8, 0.8)).toBe(false);
  });

  it("ignores a one-foot step", () => {
    const detector = new JumpDetector();
    detector.update(0.8, 0.8);
    expect(detector.update(0.74, 0.8)).toBe(false);
  });
});

describe("decodeFootPose", () => {
  it("selects the strongest pose and removes letterbox padding", () => {
    const output = new Float32Array(48);
    output[4] = 0.4;
    output[28] = 0.8;
    for (let point = 0; point < 6; point++) {
      const offset = 30 + point * 3;
      output[offset] = 110 + point * 10;
      output[offset + 1] = 220 + point * 10;
      output[offset + 2] = 0.9;
    }

    const pose = decodeFootPose(output, 2, 10, 20);

    expect(pose?.score).toBeCloseTo(0.8);
    expect(pose?.left[0]).toEqual({ x: 50, y: 100, confidence: expect.closeTo(0.9) });
    expect(pose?.right[2]).toEqual({ x: 75, y: 125, confidence: expect.closeTo(0.9) });
  });

  it("rejects weak detections", () => {
    const output = new Float32Array(24);
    output[4] = 0.2;
    expect(decodeFootPose(output, 1, 0, 0)).toBeNull();
  });
});
