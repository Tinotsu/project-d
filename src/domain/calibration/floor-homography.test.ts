import { describe, expect, it } from "vitest";
import {
  calibrateFloor,
  floorLane,
  projectFloorPoint,
  projectPoint,
} from "./floor-homography.ts";

describe("floor homography", () => {
  it("projects a calibrated quadrilateral in both directions", () => {
    const corners = [
      { x: 100, y: 50 },
      { x: 300, y: 50 },
      { x: 350, y: 250 },
      { x: 50, y: 250 },
    ] as const;
    const transform = calibrateFloor([...corners]);

    corners.forEach((point, index) => {
      const normalized = [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ][index];
      expect(projectPoint(point, transform).x).toBeCloseTo(normalized.x);
      expect(projectPoint(point, transform).y).toBeCloseTo(normalized.y);
      expect(projectFloorPoint(normalized, transform).x).toBeCloseTo(point.x);
      expect(projectFloorPoint(normalized, transform).y).toBeCloseTo(point.y);
    });
  });

  it("maps normalized positions to four lanes", () => {
    expect(floorLane({ x: 0, y: 0.5 })).toBe(1);
    expect(floorLane({ x: 0.5, y: 0.5 })).toBe(3);
    expect(floorLane({ x: 1, y: 1 })).toBe(4);
    expect(floorLane({ x: 1.01, y: 0.5 })).toBeNull();
  });
});
