import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPixelatedPass } from "three/addons/postprocessing/RenderPixelatedPass.js";
import tvModelUrl from "../assets/glb/tv.glb?url";
import { CameraInput } from "./camera-input.ts";
import { GameScreen } from "./game-screen.tsx";
import type { LoadedLevel } from "./level.ts";
import { createPlayfieldCamera, resizePlayfieldCamera } from "./playfield-camera.ts";

const VIDEO_URL = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";

type Test3DGameScreenProps = {
  level: LoadedLevel;
  onBack: () => void;
};

export function Test3DGameScreen({ level, onBack }: Test3DGameScreenProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const cameraInput = useMemo(() => new CameraInput(), []);

  useEffect(() => () => cameraInput.destroy(), [cameraInput]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05030b);
    scene.fog = new THREE.Fog(0x05030b, 8, 18);

    const camera = createPlayfieldCamera();

    const renderer = new THREE.WebGLRenderer({ antialias: false, precision: "mediump" });
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.BasicShadowMap;
    stage.append(renderer.domElement);

    const composer = new EffectComposer(renderer);
    composer.setPixelRatio(1);
    const pixelatedPass = new RenderPixelatedPass(4, scene, camera, {
      normalEdgeStrength: 0.22,
      depthEdgeStrength: 0.28,
    });
    const outputPass = new OutputPass();
    composer.addPass(pixelatedPass);
    composer.addPass(outputPass);

    scene.add(new THREE.HemisphereLight(0xb7c9ff, 0x16100b, 1.8));
    const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
    keyLight.position.set(4, 7, 5);
    keyLight.castShadow = true;
    scene.add(keyLight);

    const tvLight = new THREE.PointLight(0x6747ff, 24, 9);
    tvLight.position.set(0, 2, -3.8);
    scene.add(tvLight);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(24, 24),
      new THREE.MeshStandardMaterial({ color: 0x0b0a10, roughness: 0.82, metalness: 0.12 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1.03;
    floor.receiveShadow = true;
    scene.add(floor);

    const grid = new THREE.GridHelper(24, 32, 0x6850d8, 0x211942);
    grid.position.y = -1.015;
    scene.add(grid);

    const video = document.createElement("video");
    video.src = VIDEO_URL;
    video.crossOrigin = "anonymous";
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";

    const videoTexture = new THREE.VideoTexture(video);
    videoTexture.colorSpace = THREE.SRGBColorSpace;
    videoTexture.minFilter = THREE.NearestFilter;
    videoTexture.magFilter = THREE.NearestFilter;
    videoTexture.generateMipmaps = false;

    let tv: THREE.Object3D | undefined;
    let mixer: THREE.AnimationMixer | undefined;
    let disposed = false;
    void new GLTFLoader().loadAsync(tvModelUrl).then((gltf) => {
      if (disposed) return;

      tv = gltf.scene;
      tv.rotation.y = -Math.PI / 2;
      tv.scale.setScalar(1.55);
      tv.position.set(0, 0.57, -4.15);
      tv.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.castShadow = true;
        object.receiveShadow = true;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => {
          if (material instanceof THREE.MeshStandardMaterial) material.flatShading = true;
          material.dithering = true;
          material.needsUpdate = true;
        });
      });

      const screen = tv.getObjectByName("screen");
      if (!(screen instanceof THREE.Mesh)) throw new Error('The TV model has no mesh named "screen".');
      const oldMaterial = screen.material;
      screen.material = new THREE.MeshBasicMaterial({
        map: videoTexture,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      if (Array.isArray(oldMaterial)) oldMaterial.forEach((material) => material.dispose());
      else oldMaterial.dispose();

      scene.add(tv);
      mixer = new THREE.AnimationMixer(tv);
      gltf.animations.forEach((clip) => mixer!.clipAction(clip).play());
      void video.play().catch(() => undefined);
    }).catch((error: unknown) => {
      console.error(error);
    });

    const timer = new THREE.Timer();
    timer.connect(document);
    renderer.setAnimationLoop((time) => {
      timer.update(time);
      mixer?.update(timer.getDelta());
      composer.render();
    });

    const resize = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      renderer.setSize(width, height, false);
      composer.setSize(width, height);
      resizePlayfieldCamera(camera, width, height);
    });
    resize.observe(stage);

    return () => {
      disposed = true;
      resize.disconnect();
      renderer.setAnimationLoop(null);
      timer.dispose();
      mixer?.stopAllAction();
      video.pause();
      video.removeAttribute("src");
      video.load();
      videoTexture.dispose();
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      });
      pixelatedPass.dispose();
      outputPass.dispose();
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <main className="test-3d-game-screen">
      <div className="test-3d-game-stage" ref={stageRef} />
      <div className="test-3d-game-playfield">
        <GameScreen
          cameraInput={cameraInput}
          level={level}
          onExit={onBack}
          onFinish={() => undefined}
        />
      </div>
    </main>
  );
}
