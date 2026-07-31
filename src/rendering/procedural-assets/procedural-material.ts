import * as THREE from "three";
import fragmentShader from "./shaders/procedural-asset.frag.glsl?raw";
import vertexShader from "./shaders/procedural-asset.vert.glsl?raw";
import type {
  ProceduralAssetKind,
  StepFoot,
} from "./procedural-asset-definitions.ts";

const assetKindIds: Record<ProceduralAssetKind, number> = {
  step: 0,
  "foot-base": 1,
  foot: 2,
  track: 3,
  "jump-base": 4,
  jump: 5,
  slide: 6,
  stay: 7,
  "vertical-slide": 8,
};

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
      ASSET_KIND: assetKindIds[kind],
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
