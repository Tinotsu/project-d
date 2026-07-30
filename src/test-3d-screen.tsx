import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import tvModelUrl from "../assets/glb/tv.glb?url";
import { Button } from "./components/ui/button.tsx";

const VIDEO_URL = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";

type Test3DScreenProps = {
  onBack: () => void;
};

export function Test3DScreen({ onBack }: Test3DScreenProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const [status, setStatus] = useState("Loading TV…");
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050505);
    scene.fog = new THREE.Fog(0x050505, 5.5, 10);

    const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
    camera.position.set(4.5, 0.25, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    stage.append(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.minDistance = 2.6;
    controls.maxDistance = 8;
    controls.target.set(0.4, 0, 0);
    controls.update();

    scene.add(new THREE.HemisphereLight(0xb7c9ff, 0x16100b, 1.7));
    const keyLight = new THREE.DirectionalLight(0xffffff, 3.5);
    keyLight.position.set(4, 5, 3);
    keyLight.castShadow = true;
    scene.add(keyLight);

    const rimLight = new THREE.PointLight(0x6747ff, 25, 7);
    rimLight.position.set(-1.5, 1.7, -2.7);
    scene.add(rimLight);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(18, 18),
      new THREE.MeshStandardMaterial({ color: 0x0d0d11, roughness: 0.78, metalness: 0.18 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1.03;
    floor.receiveShadow = true;
    scene.add(floor);

    const video = document.createElement("video");
    videoRef.current = video;
    video.src = VIDEO_URL;
    video.crossOrigin = "anonymous";
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";

    const videoTexture = new THREE.VideoTexture(video);
    videoTexture.colorSpace = THREE.SRGBColorSpace;
    videoTexture.minFilter = THREE.LinearFilter;
    videoTexture.magFilter = THREE.LinearFilter;

    const handlePlay = () => {
      mixerRef.current && (mixerRef.current.timeScale = 1);
      setPlaying(true);
    };
    const handlePause = () => {
      mixerRef.current && (mixerRef.current.timeScale = 0);
      setPlaying(false);
    };
    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);

    let tv: THREE.Object3D | undefined;
    let disposed = false;
    const loader = new GLTFLoader();

    void loader.loadAsync(tvModelUrl).then((gltf) => {
      if (disposed) return;

      tv = gltf.scene;
      tv.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.castShadow = true;
          object.receiveShadow = true;
        }
      });

      const screen = tv.getObjectByName("screen");
      if (!(screen instanceof THREE.Mesh)) {
        throw new Error('The model does not contain a mesh named "screen".');
      }

      const oldScreenMaterial = screen.material;
      screen.material = new THREE.MeshBasicMaterial({
        map: videoTexture,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      if (Array.isArray(oldScreenMaterial)) oldScreenMaterial.forEach((material) => material.dispose());
      else oldScreenMaterial.dispose();

      scene.add(tv);
      const mixer = new THREE.AnimationMixer(tv);
      mixerRef.current = mixer;
      gltf.animations.forEach((clip) => mixer.clipAction(clip).play());
      mixer.timeScale = video.paused ? 0 : 1;

      setStatus(`${gltf.animations.length} speaker animations active`);
      return video.play();
    }).catch((error: unknown) => {
      setStatus(error instanceof Error ? error.message : "Could not load the 3D TV");
    });

    const timer = new THREE.Timer();
    timer.connect(document);
    renderer.setAnimationLoop((time) => {
      timer.update(time);
      mixerRef.current?.update(timer.getDelta());
      controls.update();
      renderer.render(scene, camera);
    });

    const resize = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
    });
    resize.observe(stage);

    return () => {
      disposed = true;
      resize.disconnect();
      renderer.setAnimationLoop(null);
      timer.dispose();
      controls.dispose();
      video.pause();
      video.removeAttribute("src");
      video.load();
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
      videoTexture.dispose();
      mixerRef.current?.stopAllAction();
      mixerRef.current = null;
      videoRef.current = null;
      tv?.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      });
      floor.geometry.dispose();
      (floor.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  function togglePlayback(): void {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => setStatus("The browser blocked video playback"));
    else video.pause();
  }

  return (
    <main className="test-3d-screen">
      <div className="test-3d-stage" ref={stageRef} />
      <div className="test-3d-toolbar">
        <Button variant="outline" size="sm" onClick={onBack}>Back</Button>
        <div>
          <strong>TV / Three.js test</strong>
          <span>{status}</span>
        </div>
        <Button size="sm" onClick={togglePlayback}>{playing ? "Pause" : "Play"}</Button>
      </div>
      <p className="test-3d-hint">Drag to orbit · scroll to zoom</p>
    </main>
  );
}
