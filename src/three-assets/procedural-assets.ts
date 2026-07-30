import * as THREE from "three";
import { footBasePatternShader } from "./foot-base.ts";
import {
  normalStepColors,
  normalStepPatternShader,
  type StepFoot,
} from "./normal-step.ts";

export type ProceduralAssetKind =
  | "step"
  | "foot-base"
  | "foot"
  | "track"
  | "jump-base"
  | "jump"
  | "slide"
  | "stay"
  | "vertical-slide";

export type ProceduralAssetDefinition = {
  id: string;
  label: string;
  kind: ProceduralAssetKind;
  foot?: StepFoot;
  source: string;
  width: number;
  height: number;
};

export const proceduralAssets: ProceduralAssetDefinition[] = [
  { id: "left-step", label: "Left step", kind: "step", foot: "left", source: "left base.svg", width: 152, height: 102 },
  { id: "right-step", label: "Right step", kind: "step", foot: "right", source: "right base.svg", width: 152, height: 102 },
  { id: "foot-base", label: "Foot base", kind: "foot-base", source: "foot base.svg", width: 606, height: 104 },
  { id: "foot", label: "Tracked foot", kind: "foot", source: "foot.svg", width: 100, height: 100 },
  { id: "track", label: "Track", kind: "track", source: "pist.svg", width: 400, height: 1200 },
  { id: "jump-base", label: "Jump base", kind: "jump-base", source: "jump base.svg", width: 600, height: 100 },
  { id: "jump", label: "Jump indicator", kind: "jump", source: "jump.svg", width: 600, height: 200 },
  { id: "left-slide", label: "Left slide", kind: "slide", foot: "left", source: "left slide.svg", width: 200, height: 300 },
  { id: "right-slide", label: "Right slide", kind: "slide", foot: "right", source: "right slide.svg", width: 200, height: 300 },
  { id: "left-stay", label: "Left stay", kind: "stay", foot: "left", source: "left stay.svg", width: 150, height: 300 },
  { id: "right-stay", label: "Right stay", kind: "stay", foot: "right", source: "right stay.svg", width: 150, height: 300 },
  { id: "left-vertical-slide", label: "Left vertical slide", kind: "vertical-slide", foot: "left", source: "horizontal left slide.svg", width: 150, height: 300 },
  { id: "right-vertical-slide", label: "Right vertical slide", kind: "vertical-slide", foot: "right", source: "horizontal right slide.svg", width: 150, height: 300 },
];

const assetShaderHelpers = `
  float roundedBoxDistance(vec2 point, vec2 halfSize, float radius) {
    vec2 edge = abs(point) - halfSize + radius;
    return min(max(edge.x, edge.y), 0.0)
      + length(max(edge, 0.0))
      - radius;
  }

  float ellipseMask(
    vec2 point,
    vec2 center,
    vec2 radius,
    float rotation
  ) {
    float cosine = cos(rotation);
    float sine = sin(rotation);
    vec2 offset = point - center;
    vec2 rotated = vec2(
      cosine * offset.x + sine * offset.y,
      -sine * offset.x + cosine * offset.y
    );
    return 1.0 - smoothstep(0.91, 1.0, length(rotated / radius));
  }

  float footprintMask(vec2 assetUv) {
    vec2 point = vec2(assetUv.x, 1.0 - assetUv.y);
    float mask = ellipseMask(point, vec2(0.275, 0.285), vec2(0.048, 0.06), -0.35);
    mask = max(mask, ellipseMask(point, vec2(0.375, 0.225), vec2(0.06, 0.07), -0.12));
    mask = max(mask, ellipseMask(point, vec2(0.485, 0.205), vec2(0.068, 0.078), 0.0));
    mask = max(mask, ellipseMask(point, vec2(0.62, 0.22), vec2(0.088, 0.1), 0.3));
    mask = max(mask, ellipseMask(point, vec2(0.43, 0.46), vec2(0.16, 0.19), 0.2));
    mask = max(mask, ellipseMask(point, vec2(0.43, 0.61), vec2(0.115, 0.2), -0.28));
    mask = max(mask, ellipseMask(point, vec2(0.51, 0.77), vec2(0.105, 0.13), -0.3));
    return mask;
  }

  float chevronBand(
    vec2 assetUv,
    float center,
    float halfWidth,
    float rows,
    float scroll
  ) {
    float horizontal = abs(assetUv.x - center) / halfWidth;
    float cell = fract((assetUv.y + scroll) * rows);
    float target = 0.78 - horizontal * 0.58;
    float distanceToLine = abs(cell - target);
    distanceToLine = min(distanceToLine, 1.0 - distanceToLine);
    float line = 1.0 - smoothstep(0.045, 0.09, distanceToLine);
    return line * (1.0 - smoothstep(0.92, 1.0, horizontal));
  }

  ${footBasePatternShader}
  ${normalStepPatternShader}
`;

function assetFragmentBody(kind: ProceduralAssetKind): string {
  if (kind === "step") {
    return `
      vec2 assetPoint = (assetUv - 0.5) * vec2(1.49, 1.0);
      float outerDistance = roundedBoxDistance(assetPoint, vec2(0.745, 0.5), 0.045);
      if (outerDistance > 0.0) discard;

      float innerDistance = roundedBoxDistance(assetPoint, vec2(0.72, 0.475), 0.025);
      vec3 color = innerDistance > 0.0
        ? vec3(0.947)
        : normalStepPattern(assetUv, time, edgeColor, centerColor);
      assetColor = vec4(color, 1.0);
    `;
  }

  if (kind === "foot-base") {
    return `
      vec2 assetPoint = (assetUv - 0.5) * vec2(5.826923, 1.0);
      float outerDistance = roundedBoxDistance(assetPoint, vec2(2.913462, 0.5), 0.067);
      if (outerDistance > 0.0) discard;

      float innerDistance = roundedBoxDistance(assetPoint, vec2(2.884615, 0.471154), 0.038);
      vec3 color = innerDistance > 0.0
        ? vec3(0.976)
        : footBasePattern(assetUv);
      assetColor = vec4(color, 1.0);
    `;
  }

  if (kind === "foot") {
    return `
      vec2 ringPoint = (assetUv - vec2(0.5, 0.519)) * vec2(1.0, 1.04);
      float ring = 1.0 - smoothstep(0.008, 0.018, abs(length(ringPoint) - 0.48));
      float footprint = footprintMask(assetUv);
      float topToBottom = 1.0 - assetUv.y;
      vec3 footprintColor = mix(vec3(0.98, 0.965, 0.0), vec3(0.961, 0.635, 0.114), topToBottom);
      vec3 ringColor = mix(vec3(0.961, 0.635, 0.114), vec3(0.98, 0.965, 0.0), topToBottom);
      float alpha = max(ring, footprint);
      if (alpha < 0.01) discard;
      assetColor = vec4(mix(ringColor, footprintColor, footprint), alpha);
    `;
  }

  if (kind === "track") {
    return `
      float diamond = 1.0 - clamp(
        max(abs(assetUv.x - 0.5) * 1.5, abs(assetUv.y - 0.5) * 0.42),
        0.0,
        1.0
      );
      float alternatingLane = mod(floor(assetUv.x * 4.0), 2.0);
      vec3 color = mix(vec3(0.025, 0.075, 0.052), vec3(0.0, 0.27, 0.085), diamond * 0.38);
      color += vec3(0.025) * alternatingLane;

      float lanePosition = fract(assetUv.x * 4.0);
      float lineDistance = min(lanePosition, 1.0 - lanePosition);
      float laneLine = 1.0 - smoothstep(0.012, 0.025, lineDistance);
      color = mix(color, vec3(0.976), laneLine);
      assetColor = vec4(color, 1.0);
    `;
  }

  if (kind === "jump-base") {
    return `
      vec2 assetPoint = (assetUv - 0.5) * vec2(6.0, 1.0);
      float outerDistance = roundedBoxDistance(assetPoint, vec2(3.0, 0.5), 0.065);
      if (outerDistance > 0.0) discard;

      float innerDistance = roundedBoxDistance(assetPoint, vec2(2.95, 0.45), 0.04);
      float pulse = 0.5 + 0.5 * sin(time * 6.28318530718);
      vec3 faceColor = mix(secondaryColor, primaryColor, 0.35 + pulse * 0.55);
      vec2 dotCell = fract(assetUv * vec2(60.0, 10.0)) - 0.5;
      float dots = 1.0 - smoothstep(0.27, 0.32, length(dotCell));
      faceColor = mix(faceColor, primaryColor, dots * 0.3);
      vec3 color = innerDistance > 0.0 ? vec3(0.976) : faceColor;
      assetColor = vec4(color, 1.0);
    `;
  }

  if (kind === "jump") {
    return `
      float scroll = time * 0.16;
      float left = chevronBand(assetUv, 0.25, 0.095, 5.0, scroll);
      float right = chevronBand(assetUv, 0.75, 0.095, 5.0, scroll);
      float mask = max(left, right);
      float pulse = 0.55 + 0.35 * sin(time * 5.0);
      if (mask < 0.01) discard;
      assetColor = vec4(primaryColor, mask * pulse);
    `;
  }

  if (kind === "slide") {
    return `
      float arrows = chevronBand(assetUv, 0.5, 0.52, 6.0, time * 0.13);
      float edgeGlow = abs(assetUv.x - 0.5) * 2.0;
      vec3 color = mix(primaryColor, secondaryColor, edgeGlow * 0.24);
      color = mix(color, secondaryColor, arrows * 0.82);
      assetColor = vec4(color, 0.96);
    `;
  }

  if (kind === "stay") {
    return `
      float edgeFade = smoothstep(0.0, 0.25, assetUv.x)
        * smoothstep(0.0, 0.25, 1.0 - assetUv.x);
      float stripeCell = abs(fract((assetUv.x + time * 0.035) * 30.0) - 0.5);
      float stripes = 1.0 - smoothstep(0.14, 0.23, stripeCell);
      vec3 color = mix(secondaryColor, primaryColor, stripes * 0.75);
      assetColor = vec4(color, edgeFade * (0.68 + stripes * 0.24));
    `;
  }

  return `
    float arrows = chevronBand(assetUv, 0.5, 0.52, 5.0, time * 0.13);
    vec3 color = mix(secondaryColor, primaryColor, arrows * 0.94);
    assetColor = vec4(color, 0.96);
  `;
}

function footColors(foot: StepFoot): [number, number] {
  return foot === "left" ? [0xfaf600, 0xfc2500] : [0x00f7fa, 0x0532fa];
}

export function createProceduralMaterial(
  kind: ProceduralAssetKind,
  foot: StepFoot = "left",
  warped = false,
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
  };
  const vertexShader = warped
    ? `
      varying vec2 logicalPosition;

      void main() {
        logicalPosition = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `
    : `
      varying vec2 assetUv;

      void main() {
        assetUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;
  const uvSetup = warped
    ? `
      vec3 point = vec3(logicalPosition, 1.0);
      float denominator = dot(hW, point);
      vec2 assetUv = vec2(dot(hU, point), dot(hV, point)) / denominator;
      if (assetUv.x < 0.0 || assetUv.x > 1.0 || assetUv.y < 0.0 || assetUv.y > 1.0) discard;
    `
    : "";

  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader: `
      uniform vec3 primaryColor;
      uniform vec3 secondaryColor;
      uniform vec3 edgeColor;
      uniform vec3 centerColor;
      uniform float time;
      uniform vec3 hU;
      uniform vec3 hV;
      uniform vec3 hW;
      ${warped ? "varying vec2 logicalPosition;" : "varying vec2 assetUv;"}

      ${assetShaderHelpers}

      void main() {
        ${uvSetup}
        vec4 assetColor = vec4(0.0);
        ${assetFragmentBody(kind)}
        gl_FragColor = assetColor;

        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    side: THREE.DoubleSide,
    depthTest: !warped,
    depthWrite: false,
    toneMapped: false,
  });
}

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
