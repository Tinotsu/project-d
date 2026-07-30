import * as THREE from "three";

export function createPlayfieldCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(48, 1, 0.01, 100);
  camera.position.set(0, 4.15, 8.6);
  camera.lookAt(0, -0.65, -1.5);
  return camera;
}

export function resizePlayfieldCamera(
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
): void {
  camera.aspect = width / Math.max(height, 1);
  camera.updateProjectionMatrix();
}
