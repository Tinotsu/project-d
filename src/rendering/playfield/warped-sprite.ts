import * as THREE from "three";

export type Point = [number, number];
export type Quad = [Point, Point, Point, Point];
export type LaneSpan = { left: number; right: number; y: number; width: number };

export type WarpedSprite = {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  width: number;
  height: number;
  uvs: Quad;
};

export const normalUvs: Quad = [[0, 1], [1, 1], [1, 0], [0, 0]];
export const mirroredUvs: Quad = [[1, 1], [0, 1], [0, 0], [1, 0]];
export const leftSlideUvs: Quad = [[1, 1], [1, 0], [0, 0], [0, 1]];
export const rightSlideUvs: Quad = [[0, 0], [0, 1], [1, 1], [1, 0]];

function solveHomography(from: Quad, to: Quad): number[] {
  const size = 8;
  const matrix = Array.from({ length: size }, () => Array<number>(size + 1).fill(0));

  for (let index = 0; index < 4; index++) {
    const [x, y] = from[index];
    const [u, v] = to[index];
    matrix[index * 2] = [x, y, 1, 0, 0, 0, -u * x, -u * y, u];
    matrix[index * 2 + 1] = [0, 0, 0, x, y, 1, -v * x, -v * y, v];
  }

  for (let column = 0; column < size; column++) {
    let pivot = column;
    for (let row = column + 1; row < size; row++) {
      if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) pivot = row;
    }
    [matrix[column], matrix[pivot]] = [matrix[pivot], matrix[column]];
    if (Math.abs(matrix[column][column]) < 1e-10) {
      throw new Error("Cannot project a zero-area playfield asset");
    }

    const divisor = matrix[column][column];
    for (let item = column; item <= size; item++) matrix[column][item] /= divisor;
    for (let row = 0; row < size; row++) {
      if (row === column) continue;
      const factor = matrix[row][column];
      for (let item = column; item <= size; item++) {
        matrix[row][item] -= factor * matrix[column][item];
      }
    }
  }

  return matrix.map((row) => row[size]);
}

export function createQuadGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(12), 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}

export function setQuadGeometry(geometry: THREE.BufferGeometry, quad: Quad): void {
  const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
  quad.forEach(([x, y], index) => positions.setXYZ(index, x, y, 0));
  positions.needsUpdate = true;
}

export function updateWarpedSprite(sprite: WarpedSprite, quad: Quad): void {
  setQuadGeometry(sprite.mesh.geometry, quad);
  const homography = solveHomography(quad, sprite.uvs);
  sprite.mesh.material.uniforms.hU.value.set(homography[0], homography[1], homography[2]);
  sprite.mesh.material.uniforms.hV.value.set(homography[3], homography[4], homography[5]);
  sprite.mesh.material.uniforms.hW.value.set(homography[6], homography[7], 1);
}

export function rectangleQuad(left: number, top: number, width: number, height: number): Quad {
  return [
    [left, top],
    [left + width, top],
    [left + width, top + height],
    [left, top + height],
  ];
}
