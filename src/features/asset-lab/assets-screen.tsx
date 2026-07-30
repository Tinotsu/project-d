import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Button } from "../../shared/ui/button.tsx";
import {
  proceduralAssets,
  type ProceduralAssetDefinition,
} from "../../rendering/procedural-assets/procedural-asset-definitions.ts";
import {
  createProceduralAssetPreview,
  type ProceduralAssetPreview,
} from "../../rendering/procedural-assets/procedural-asset-preview.ts";

export function AssetsScreen() {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene>(null);
  const previewRef = useRef<ProceduralAssetPreview>(null);
  const playingRef = useRef(true);
  const [selected, setSelected] = useState(proceduralAssets[0]);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    sceneRef.current = scene;
    scene.background = new THREE.Color(0x050505);

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 0.1, 7);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.domElement.setAttribute("aria-label", "Animated procedural Three.js asset preview");
    mount.append(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x171717, 2.4));
    const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
    keyLight.position.set(3, 4, 6);
    scene.add(keyLight);

    const preview = createProceduralAssetPreview(proceduralAssets[0]);
    previewRef.current = preview;
    scene.add(preview.group);

    let animationFrame = 0;
    let elapsed = 0;
    let previous = performance.now();

    const render = (now: number) => {
      const delta = Math.min((now - previous) / 1000, 0.1);
      previous = now;
      if (playingRef.current) elapsed += delta;
      previewRef.current?.update(elapsed);
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
      previewRef.current?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      previewRef.current = null;
      sceneRef.current = null;
    };
  }, []);

  function chooseAsset(definition: ProceduralAssetDefinition): void {
    const scene = sceneRef.current;
    if (!scene) return;
    const current = previewRef.current;
    if (current) {
      scene.remove(current.group);
      current.dispose();
    }
    const next = createProceduralAssetPreview(definition);
    previewRef.current = next;
    scene.add(next.group);
    setSelected(definition);
  }

  function togglePlayback(): void {
    const nextPlaying = !playing;
    playingRef.current = nextPlaying;
    setPlaying(nextPlaying);
  }

  function cycleAsset(offset: number): void {
    const currentIndex = proceduralAssets.indexOf(selected);
    const nextIndex = (currentIndex + offset + proceduralAssets.length) % proceduralAssets.length;
    chooseAsset(proceduralAssets[nextIndex]);
  }

  return (
    <main className="assets-screen">
      <section className="asset-preview">
        <div className="asset-canvas" ref={mountRef} />

        <div className="asset-controls">
          <Button
            aria-label="Previous asset"
            className="asset-control"
            variant="ghost"
            onClick={() => cycleAsset(-1)}
          >
            ‹
          </Button>
          <Button
            aria-label={playing ? "Pause animation" : "Play animation"}
            className="asset-control"
            variant="ghost"
            onClick={togglePlayback}
          >
            {playing ? "Ⅱ" : "▶"}
          </Button>
          <Button
            aria-label="Next asset"
            className="asset-control"
            variant="ghost"
            onClick={() => cycleAsset(1)}
          >
            ›
          </Button>
        </div>
      </section>
    </main>
  );
}
