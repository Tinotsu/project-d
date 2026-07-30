import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Button } from "./components/ui/button.tsx";
import {
  proceduralAssets,
  type ProceduralAssetDefinition,
} from "./three-assets/procedural-asset-definitions.ts";
import {
  createProceduralAssetPreview,
  type ProceduralAssetPreview,
} from "./three-assets/procedural-asset-preview.ts";

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

  return (
    <main className="assets-screen">
      <div className="assets-heading">
        <div>
          <small>ASSET LAB · {String(proceduralAssets.indexOf(selected) + 1).padStart(2, "0")}</small>
          <h1>{selected.label}</h1>
        </div>
        <span className="asset-status"><i /> THREE.JS</span>
      </div>

      <section className="asset-preview panel">
        <div className="asset-preview-meta">
          <div>
            <small>OBJECT</small>
            <strong>{selected.label}</strong>
          </div>
          <div>
            <small>SIZE</small>
            <strong>{selected.width} × {selected.height}</strong>
          </div>
        </div>

        <div className="asset-canvas" ref={mountRef} />

        <div className="asset-controls">
          <div className="asset-variant-controls" aria-label="Procedural asset">
            {proceduralAssets.map((definition) => (
              <Button
                key={definition.id}
                size="sm"
                variant={definition.id === selected.id ? "default" : "outline"}
                onClick={() => chooseAsset(definition)}
              >
                {definition.label}
              </Button>
            ))}
          </div>
          <Button size="sm" variant="outline" onClick={togglePlayback}>
            {playing ? "Pause" : "Play"}
          </Button>
        </div>
      </section>

      <p className="asset-progress">{proceduralAssets.length} procedural variants</p>
    </main>
  );
}
