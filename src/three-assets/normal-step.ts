import * as THREE from "three";

export type StepFoot = "left" | "right";

export const normalStepPatternShader = `
  vec3 normalStepPattern(
    vec2 assetUv,
    float time,
    vec3 edgeColor,
    vec3 centerColor
  ) {
    float wave = 0.5 + 0.5 * cos((assetUv.y + time * 0.3) * 6.28318530718);
    wave = smoothstep(0.12, 0.88, wave);

    vec2 dotCell = fract(assetUv * vec2(10.0, 7.0)) - 0.5;
    float dotMask = 1.0 - smoothstep(0.16, 0.23, length(dotCell));

    vec3 color = mix(edgeColor, centerColor, wave);
    return mix(color, vec3(0.976), dotMask * 0.2);
  }
`;

export function normalStepColors(foot: StepFoot): [number, number] {
  return foot === "left" ? [0xfaf600, 0xfc2500] : [0x0532fa, 0x00f7fa];
}

export type NormalStepAsset = {
  group: THREE.Group;
  dispose: () => void;
  setFoot: (foot: StepFoot) => void;
  update: (elapsed: number) => void;
};

function roundedRectangle(width: number, height: number, radius: number): THREE.Shape {
  const left = -width / 2;
  const right = width / 2;
  const bottom = -height / 2;
  const top = height / 2;
  const shape = new THREE.Shape();

  shape.moveTo(left + radius, bottom);
  shape.lineTo(right - radius, bottom);
  shape.quadraticCurveTo(right, bottom, right, bottom + radius);
  shape.lineTo(right, top - radius);
  shape.quadraticCurveTo(right, top, right - radius, top);
  shape.lineTo(left + radius, top);
  shape.quadraticCurveTo(left, top, left, top - radius);
  shape.lineTo(left, bottom + radius);
  shape.quadraticCurveTo(left, bottom, left + radius, bottom);

  return shape;
}

export function createNormalStep(foot: StepFoot): NormalStepAsset {
  const group = new THREE.Group();
  const bodyGeometry = new THREE.ExtrudeGeometry(roundedRectangle(3, 2, 0.14), {
    depth: 0.14,
    bevelEnabled: true,
    bevelSegments: 4,
    bevelSize: 0.045,
    bevelThickness: 0.045,
    curveSegments: 8,
  });
  bodyGeometry.center();

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0xf9f9f9,
    metalness: 0.05,
    roughness: 0.28,
  });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  group.add(body);

  const faceGeometry = new THREE.ShapeGeometry(roundedRectangle(2.9, 1.9, 0.1), 8);
  const faceMaterial = new THREE.ShaderMaterial({
    uniforms: {
      edgeColor: { value: new THREE.Color() },
      centerColor: { value: new THREE.Color() },
      time: { value: 0 },
    },
    vertexShader: `
      varying vec2 assetUv;

      void main() {
        assetUv = vec2(position.x / 2.9 + 0.5, position.y / 1.9 + 0.5);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 edgeColor;
      uniform vec3 centerColor;
      uniform float time;
      varying vec2 assetUv;

      ${normalStepPatternShader}

      void main() {
        gl_FragColor = vec4(
          normalStepPattern(assetUv, time, edgeColor, centerColor),
          1.0
        );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const face = new THREE.Mesh(faceGeometry, faceMaterial);
  face.position.z = 0.118;
  group.add(face);

  function setFoot(nextFoot: StepFoot): void {
    const [edgeColor, centerColor] = normalStepColors(nextFoot);
    faceMaterial.uniforms.edgeColor.value.set(edgeColor);
    faceMaterial.uniforms.centerColor.value.set(centerColor);
  }

  setFoot(foot);

  return {
    group,
    setFoot,
    update(elapsed) {
      faceMaterial.uniforms.time.value = elapsed;
      group.position.y = Math.sin(elapsed * 1.5) * 0.08;
      group.rotation.x = -0.12 + Math.sin(elapsed * 0.7) * 0.035;
      group.rotation.y = Math.sin(elapsed * 0.55) * 0.18;
    },
    dispose() {
      bodyGeometry.dispose();
      bodyMaterial.dispose();
      faceGeometry.dispose();
      faceMaterial.dispose();
    },
  };
}
