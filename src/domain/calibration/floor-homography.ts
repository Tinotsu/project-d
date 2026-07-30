export type Point = {
  x: number;
  y: number;
};
export type Homography = [number, number, number, number, number, number, number, number];

export function calibrateFloor([a, b, c, d]: [Point, Point, Point, Point]): Homography {
  const rows = [
    [a, 0, 0],
    [b, 1, 0],
    [c, 1, 1],
    [d, 0, 1],
  ].flatMap(([point, u, v]) => {
    const { x, y } = point as Point;
    return [
      [x, y, 1, 0, 0, 0, -(u as number) * x, -(u as number) * y, u],
      [0, 0, 0, x, y, 1, -(v as number) * x, -(v as number) * y, v],
    ];
  }) as number[][];

  for (let column = 0; column < 8; column++) {
    let pivot = column;
    for (let row = column + 1; row < 8; row++) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    }
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    if (Math.abs(rows[column][column]) < 1e-10) throw new Error("Floor corners do not form a usable area");

    const scale = rows[column][column];
    for (let item = column; item < 9; item++) rows[column][item] /= scale;
    for (let row = 0; row < 8; row++) {
      if (row === column) continue;
      const factor = rows[row][column];
      for (let item = column; item < 9; item++) rows[row][item] -= factor * rows[column][item];
    }
  }

  return rows.map((row) => row[8]) as Homography;
}

export function projectPoint(point: Point, h: Homography): Point {
  const denominator = h[6] * point.x + h[7] * point.y + 1;
  return {
    x: (h[0] * point.x + h[1] * point.y + h[2]) / denominator,
    y: (h[3] * point.x + h[4] * point.y + h[5]) / denominator,
  };
}

export function projectFloorPoint(point: Point, h: Homography): Point {
  const [a, b, c, d, e, f, g, i] = h;
  const inverse = [
    e - f * i,
    c * i - b,
    b * f - c * e,
    f * g - d,
    a - c * g,
    c * d - a * f,
    d * i - e * g,
    b * g - a * i,
    a * e - b * d,
  ];
  const denominator = inverse[6] * point.x + inverse[7] * point.y + inverse[8];
  return {
    x: (inverse[0] * point.x + inverse[1] * point.y + inverse[2]) / denominator,
    y: (inverse[3] * point.x + inverse[4] * point.y + inverse[5]) / denominator,
  };
}

export function projectFoot(points: [Point, Point, Point], h: Homography): Point {
  const projected = points.map((point) => projectPoint(point, h));
  return {
    x: projected.reduce((sum, point) => sum + point.x, 0) / 3,
    y: projected.reduce((sum, point) => sum + point.y, 0) / 3,
  };
}

export function floorLane(point: Point): number | null {
  if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) return null;
  return Math.min(4, Math.floor(point.x * 4) + 1);
}
