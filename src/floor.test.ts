import { describe, expect, it } from "vitest";
import { calibrateFloor, floorLane, projectFloorPoint, projectFoot, projectPoint, type Point } from "./floor.ts";

const corners: [Point, Point, Point, Point] = [
  { x: 100, y: 100 },
  { x: 500, y: 150 },
  { x: 550, y: 450 },
  { x: 50, y: 400 },
];

describe("floor calibration", () => {
  it("maps the four camera corners to a normalized floor", () => {
    const transform = calibrateFloor(corners);

    expect(projectPoint(corners[0], transform).x).toBeCloseTo(0);
    expect(projectPoint(corners[0], transform).y).toBeCloseTo(0);
    expect(projectPoint(corners[1], transform).x).toBeCloseTo(1);
    expect(projectPoint(corners[2], transform).x).toBeCloseTo(1);
    expect(projectPoint(corners[2], transform).y).toBeCloseTo(1);
    expect(projectPoint(corners[3], transform).y).toBeCloseTo(1);
    expect(projectFloorPoint({ x: 1, y: 1 }, transform).x).toBeCloseTo(corners[2].x);
    expect(projectFloorPoint({ x: 1, y: 1 }, transform).y).toBeCloseTo(corners[2].y);
  });

  it("uses ankle, heel, and toe to find the foot center", () => {
    const transform = calibrateFloor([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ]);

    expect(projectFoot([{ x: 20, y: 40 }, { x: 30, y: 50 }, { x: 40, y: 60 }], transform)).toEqual({
      x: 0.3,
      y: 0.5,
    });
  });

  it("returns one of four lanes only while a foot is on the floor", () => {
    expect(floorLane({ x: 0, y: 0.5 })).toBe(1);
    expect(floorLane({ x: 0.25, y: 0.5 })).toBe(2);
    expect(floorLane({ x: 0.75, y: 0.5 })).toBe(4);
    expect(floorLane({ x: 1, y: 1 })).toBe(4);
    expect(floorLane({ x: 1.01, y: 0.5 })).toBeNull();
  });
});
