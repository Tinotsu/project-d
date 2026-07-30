import * as THREE from "three";
import type { ProceduralAssetDefinition } from "./procedural-asset-definitions.ts";
import { createProceduralMaterial } from "./procedural-material.ts";

export type ProceduralAssetPreview = {
  group: THREE.Group;
  dispose: () => void;
  update: (elapsed: number) => void;
};

export function createProceduralAssetPreview(
  definition: ProceduralAssetDefinition,
): ProceduralAssetPreview {
  const group = new THREE.Group();
  const scale = 3.5 / Math.max(definition.width / definition.height, 1);
  const width = definition.width / definition.height * scale;
  const height = scale;
  const faceGeometry = new THREE.PlaneGeometry(width, height);
  const faceMaterial = createProceduralMaterial(definition.kind, definition.foot);
  const face = new THREE.Mesh(faceGeometry, faceMaterial);
  face.position.z = 0.071;
  group.add(face);

  const hasBody = !["foot", "jump", "stay"].includes(definition.kind);
  const bodyGeometry = hasBody ? new THREE.BoxGeometry(width, height, 0.14) : undefined;
  const bodyMaterial = hasBody
    ? new THREE.MeshStandardMaterial({
      color: definition.kind === "track" ? 0x07130d : 0xf9f9f9,
      metalness: 0.05,
      roughness: 0.3,
    })
    : undefined;
  if (bodyGeometry && bodyMaterial) group.add(new THREE.Mesh(bodyGeometry, bodyMaterial));

  return {
    group,
    update(elapsed) {
      faceMaterial.uniforms.time.value = elapsed;
      group.position.y = Math.sin(elapsed * 1.35) * 0.07;
      group.rotation.x = -0.1 + Math.sin(elapsed * 0.65) * 0.025;
      group.rotation.y = Math.sin(elapsed * 0.5) * 0.14;
    },
    dispose() {
      faceGeometry.dispose();
      faceMaterial.dispose();
      bodyGeometry?.dispose();
      bodyMaterial?.dispose();
    },
  };
}
