import * as THREE from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import floorFragmentShader from "./shaders/scene-floor.frag.glsl?raw";
import floorVertexShader from "./shaders/scene-floor.vert.glsl?raw";
import starsFragmentShader from "./shaders/scene-stars.frag.glsl?raw";
import starsVertexShader from "./shaders/scene-stars.vert.glsl?raw";

const tvVideoUrl = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";

export type PlayfieldScene = {
  video: HTMLVideoElement;
  texture: THREE.VideoTexture;
  mixer: THREE.AnimationMixer;
};

export function createPlayfieldScene(
  scene: THREE.Scene,
  gltf: GLTF,
): PlayfieldScene {
  const video = document.createElement("video");
  video.src = tvVideoUrl;
  video.crossOrigin = "anonymous";
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";

  const texture = new THREE.VideoTexture(video);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  const model = gltf.scene;
  removeDuplicateGroups(model);
  setFloorShader(model);

  const tv = requireObject(model, "TV");
  const videoScreen = requireObject(model, "video_screen");
  replaceMaterial(
    requireDirectMesh(tv, "screen"),
    new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, toneMapped: false }),
  );
  replaceMaterial(
    requireDirectMesh(videoScreen, "screen_video"),
    new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, toneMapped: false }),
  );

  setScreenColor(requireObject(model, "screen_text"), "screen", 0xff4fd8);
  setScreenColor(requireObject(model, "wave_screen"), "screen", 0x22d3ee);
  const verticalScreen = requireObject(model, "vertical_screen");
  setScreenColor(verticalScreen, "screen1", 0xa855f7);
  setScreenColor(verticalScreen, "screen2", 0x22d3ee);
  setScreenColor(verticalScreen, "screen3", 0xff4fd8);

  scene.add(model, createStarfield(), new THREE.HemisphereLight(0xffffff, 0x30274a, 1.2));
  const light = new THREE.DirectionalLight(0xffffff, 2);
  light.position.set(-8, 12, 8);
  light.target.position.set(0, 0, -18);
  scene.add(light, light.target);

  const mixer = new THREE.AnimationMixer(tv);
  gltf.animations.forEach((clip) => {
    const tracks = clip.tracks.filter((track) => (
      tv.getObjectByName(track.name.slice(0, track.name.indexOf("."))) !== undefined
    ));
    mixer.clipAction(new THREE.AnimationClip(clip.name, clip.duration, tracks)).play();
  });
  void video.play().catch(() => undefined);
  return { video, texture, mixer };
}

function setFloorShader(model: THREE.Object3D): void {
  const material = new THREE.ShaderMaterial({
    vertexShader: floorVertexShader,
    fragmentShader: floorFragmentShader,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  for (let lane = 1; lane <= 4; lane++) {
    const mesh = requireObject(model, `lane${lane}`);
    if (!(mesh instanceof THREE.Mesh)) throw new Error(`The scene lane${lane} is not a mesh.`);
    mesh.material = material;
  }
}

function createStarfield(): THREE.Mesh {
  const stars = new THREE.Mesh(
    new THREE.SphereGeometry(500, 64, 32),
    new THREE.ShaderMaterial({
      vertexShader: starsVertexShader,
      fragmentShader: starsFragmentShader,
      side: THREE.BackSide,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  stars.renderOrder = -1;
  return stars;
}

function removeDuplicateGroups(model: THREE.Object3D): void {
  const tv = requireObject(model, "TV");
  tv.remove(...tv.children.filter(
    (child) => child instanceof THREE.Mesh && child.name.startsWith("speeker"),
  ));

  for (const name of ["screen_text", "vertical_screen", "video_screen", "wave_screen"]) {
    const root = requireObject(model, name);
    root.remove(...root.children.filter((child) => child.children.length > 0));
  }
}

function requireObject(model: THREE.Object3D, name: string): THREE.Object3D {
  const object = model.getObjectByName(name);
  if (!object) throw new Error(`The scene has no object named "${name}".`);
  return object;
}

function requireDirectMesh(model: THREE.Object3D, name: string): THREE.Mesh {
  const mesh = model.children.find(
    (child): child is THREE.Mesh => child instanceof THREE.Mesh && child.name.startsWith(name),
  );
  if (!mesh) throw new Error(`The scene object "${model.name}" has no mesh named "${name}".`);
  return mesh;
}

function replaceMaterial(mesh: THREE.Mesh, material: THREE.Material): void {
  mesh.material = material;
}

function setScreenColor(model: THREE.Object3D, name: string, color: number): void {
  replaceMaterial(requireDirectMesh(model, name), new THREE.MeshBasicMaterial({
    color,
    side: THREE.DoubleSide,
    toneMapped: false,
  }));
}
