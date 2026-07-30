import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Button } from "./components/ui/button.tsx";
import {
  createNormalStep,
  type NormalStepAsset,
  type StepFoot,
} from "./three-assets/normal-step.ts";

export function AssetsScreen() {
  const mountRef = useRef<HTMLDivElement>(null);
  const stepRef = useRef<NormalStepAsset | undefined>(undefined);
  const playingRef = useRef(true);
  const [foot, setFoot] = useState<StepFoot>("left");
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050505);

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 0.1, 7);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.domElement.setAttribute("aria-label", "Animated Three.js normal step preview");
    mount.append(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x171717, 2.4));
    const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
    keyLight.position.set(3, 4, 6);
    scene.add(keyLight);

    const step = createNormalStep("left");
    stepRef.current = step;
    scene.add(step.group);

    let animationFrame = 0;
    let elapsed = 0;
    let previous = performance.now();

    const render = (now: number) => {
      const delta = Math.min((now - previous) / 1000, 0.1);
      previous = now;
      if (playingRef.current) elapsed += delta;
      step.update(elapsed);
      renderer.render(scene, camera);
      animationFrame = requestAnimationFrame(render);
    };

    const resizeObserver = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width === 0 || height === 0) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    });
    resizeObserver.observe(mount);
    animationFrame = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      step.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      stepRef.current = undefined;
    };
  }, []);

  function chooseFoot(nextFoot: StepFoot): void {
    setFoot(nextFoot);
    stepRef.current?.setFoot(nextFoot);
  }

  function togglePlayback(): void {
    const nextPlaying = !playing;
    playingRef.current = nextPlaying;
    setPlaying(nextPlaying);
  }

  return (
    <main className="assets-screen">
      <div className="assets-heading">
        <div>
          <small>ASSET LAB · 01</small>
          <h1>Normal step</h1>
        </div>
        <span className="asset-status"><i /> THREE.JS</span>
      </div>

      <section className="asset-preview panel">
        <div className="asset-preview-meta">
          <div>
            <small>OBJECT</small>
            <strong>Step / {foot}</strong>
          </div>
          <div>
            <small>SOURCE</small>
            <strong>Procedural geometry + shader</strong>
          </div>
        </div>

        <div className="asset-canvas" ref={mountRef} />

        <div className="asset-controls">
          <div className="asset-variant-controls" aria-label="Step variant">
            <Button
              size="sm"
              variant={foot === "left" ? "default" : "outline"}
              onClick={() => chooseFoot("left")}
            >
              Left
            </Button>
            <Button
              size="sm"
              variant={foot === "right" ? "default" : "outline"}
              onClick={() => chooseFoot("right")}
            >
              Right
            </Button>
          </div>
          <Button size="sm" variant="outline" onClick={togglePlayback}>
            {playing ? "Pause" : "Play"}
          </Button>
        </div>
      </section>

      <p className="asset-progress">1 Three.js object · 2 of 13 SVG source variants represented</p>
    </main>
  );
}
