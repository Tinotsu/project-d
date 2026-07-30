import * as THREE from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";

const tvVideoUrl = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";

export type PlayfieldTv = {
  video: HTMLVideoElement;
  texture: THREE.VideoTexture;
  mixer: THREE.AnimationMixer;
};

export function createPlayfieldTv(scene: THREE.Scene, gltf: GLTF, gameWidth: number): PlayfieldTv {
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

  const tv = gltf.scene;
  tv.rotation.y = -Math.PI / 2;
  tv.scale.set(6, 75, 75);

  const screen = tv.getObjectByName("screen");
  if (!(screen instanceof THREE.Mesh)) {
    throw new Error('The TV model has no mesh named "screen".');
  }
  const oldMaterial = screen.material;
  screen.material = new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  if (Array.isArray(oldMaterial)) oldMaterial.forEach((material) => material.dispose());
  else oldMaterial.dispose();

  tv.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(tv);
  const center = bounds.getCenter(new THREE.Vector3());
  tv.position.set(gameWidth / 2 - center.x, 80 - center.y, 1 - center.z);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x30274a, 2.4));
  const light = new THREE.DirectionalLight(0xffffff, 2.2);
  light.position.set(gameWidth / 2 - 300, -200, 500);
  light.target.position.set(gameWidth / 2, 80, 0);
  scene.add(light, light.target, tv);

  const mixer = new THREE.AnimationMixer(tv);
  gltf.animations.forEach((clip) => mixer.clipAction(clip).play());
  void video.play().catch(() => undefined);
  return { video, texture, mixer };
}
