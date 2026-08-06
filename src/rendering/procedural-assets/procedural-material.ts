import * as THREE from "three";
import fragmentShader from "./shaders/procedural-asset.frag.glsl?raw";
import vertexShader from "./shaders/procedural-asset.vert.glsl?raw";
import type {
  ProceduralAssetKind,
  StepFoot,
} from "./procedural-asset-definitions.ts";

function assetKindDefine(kind: ProceduralAssetKind): string {
  return `ASSET_${kind.toUpperCase().replaceAll("-", "_")}`;
}

function footColors(foot: StepFoot): [number, number] {
  return foot === "left" ? [0xfaf600, 0xfc2500] : [0x00f7fa, 0x0532fa];
}

function normalStepColors(foot: StepFoot): [number, number] {
  return foot === "left" ? [0xfaf600, 0xfc2500] : [0x0532fa, 0x00f7fa];
}

export function createProceduralMaterial(
  kind: ProceduralAssetKind,
  foot: StepFoot = "left",
  warped = false,
  clipY?: [number, number],
): THREE.ShaderMaterial {
  const colorFoot = kind === "jump" || kind === "jump-base" ? "right" : foot;
  const [primaryColor, secondaryColor] = footColors(colorFoot);
  const [edgeColor, centerColor] = normalStepColors(colorFoot);
  const uniforms = {
    primaryColor: { value: new THREE.Color(primaryColor) },
    secondaryColor: { value: new THREE.Color(secondaryColor) },
    edgeColor: { value: new THREE.Color(edgeColor) },
    centerColor: { value: new THREE.Color(centerColor) },
    time: { value: 0 },
    hU: { value: new THREE.Vector3() },
    hV: { value: new THREE.Vector3() },
    hW: { value: new THREE.Vector3() },
    clipY: { value: new THREE.Vector2(...(clipY ?? [0, 0])) },
  };
  return new THREE.ShaderMaterial({
    defines: {
      [assetKindDefine(kind)]: 1,
      ...(warped ? { WARPED: 1 } : {}),
      ...(clipY ? { TRACK_CLIPPED: 1 } : {}),
    },
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    side: THREE.DoubleSide,
    depthTest: !warped,
    depthWrite: false,
    toneMapped: false,
  });
}
