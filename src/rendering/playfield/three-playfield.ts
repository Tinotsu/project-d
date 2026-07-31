import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import sceneModelUrl from "../../../assets/glb/scene.glb?url";
import type { LevelChart } from "../../domain/chart/types.ts";
import {
  horizontalSlideBounds,
  isSustainedNote,
  stepBounds,
} from "../../domain/chart/note-geometry.ts";
import type { ChartNote } from "../../domain/chart/types.ts";
import type { JudgementResult } from "../../domain/scoring/rhythm-engine.ts";
import type { ProceduralAssetKind } from "../procedural-assets/procedural-asset-definitions.ts";
import { createProceduralMaterial } from "../procedural-assets/procedural-material.ts";
import { PlayfieldEffects } from "./playfield-effects.ts";
import {
  createPlayfieldScene,
  type PlayfieldScene,
} from "./playfield-tv.ts";
import {
  createQuadGeometry,
  leftSlideUvs,
  mirroredUvs,
  normalUvs,
  rectangleQuad,
  rightSlideUvs,
  updateWarpedSprite,
  type LaneSpan,
  type Quad,
  type WarpedSprite,
} from "./warped-sprite.ts";

export const gameWidth = 1280;
export const gameHeight = 720;

const farLeft = 580;
const farRight = 700;
const nearLeft = 20;
const nearRight = 1260;
const horizonY = 200;
const hitY = 590;
const floorDepthScale = 1 / 3;

type NoteView = {
  note: ChartNote;
  warped: WarpedSprite;
  flat?: WarpedSprite;
};

export function noteTravelProgress(timeUntil: number, travelTime: number): number {
  return Math.max(0, 1 - timeUntil / travelTime) ** 1.65;
}

export class ThreePlayfield {
  private readonly scene = new THREE.Scene();
  private readonly backgroundScene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(0, gameWidth, 0, gameHeight, 0.1, 2000);
  private readonly backgroundCamera = new THREE.PerspectiveCamera(
    34.88,
    gameWidth / gameHeight,
    0.1,
    2000,
  );
  private readonly renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    precision: "highp",
  });
  private readonly environment: THREE.Texture;
  private readonly noteViews = new Map<string, NoteView>();
  private readonly effects: PlayfieldEffects;
  private readonly resizeObserver: ResizeObserver;
  private readonly leftFoot: WarpedSprite;
  private readonly rightFoot: WarpedSprite;
  private readonly playfieldScene: PlayfieldScene;
  private lastRenderAt = performance.now();

  private constructor(
    private readonly mount: HTMLElement,
    private readonly chart: LevelChart,
    gltf: GLTF,
  ) {
    this.camera.position.z = 10;
    this.backgroundCamera.position.set(0, 1.371, 5.532);
    this.backgroundCamera.lookAt(0, 0, -2.26);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.autoClear = false;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;

    const roomEnvironment = new RoomEnvironment();
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.environment = pmremGenerator.fromScene(roomEnvironment).texture;
    this.backgroundScene.environment = this.environment;
    this.backgroundScene.environmentIntensity = 0.3;
    roomEnvironment.dispose();
    pmremGenerator.dispose();

    this.renderer.domElement.setAttribute("aria-label", "Four-lane 3D rhythm game playfield");
    this.mount.append(this.renderer.domElement);

    this.effects = new PlayfieldEffects(
      this.scene,
      this.chart.playfield.lanes,
      (startLane, endLane, progress) => this.laneSpan(startLane, endLane, progress),
      horizonY,
      hitY,
      gameWidth / 2,
    );
    this.createFootZone();

    for (const note of this.chart.notes) {
      this.noteViews.set(note.id, this.createNoteView(note));
    }

    this.leftFoot = this.createProceduralSprite("foot", 100, 100, normalUvs, 5);
    this.rightFoot = this.createProceduralSprite("foot", 100, 100, mirroredUvs, 5);
    this.leftFoot.mesh.visible = false;
    this.rightFoot.mesh.visible = false;
    this.playfieldScene = createPlayfieldScene(this.backgroundScene, gltf);

    this.resizeObserver = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      this.renderer.setSize(width, height, false);
    });
    this.resizeObserver.observe(this.mount);
    const { width, height } = this.mount.getBoundingClientRect();
    this.renderer.setSize(width, height, false);
  }

  static async create(mount: HTMLElement, chart: LevelChart): Promise<ThreePlayfield> {
    const gltf = await new GLTFLoader().loadAsync(sceneModelUrl);
    return new ThreePlayfield(mount, chart, gltf);
  }

  showTrackedFeet(
    leftPosition: { x: number } | null,
    rightPosition: { x: number } | null,
  ): void {
    const bottom = this.laneSpan(1, this.chart.playfield.lanes, 1);
    const topY = hitY
      - bottom.width * 104 / 606 * floorDepthScale;
    const top = this.laneSpan(
      1,
      this.chart.playfield.lanes,
      (topY - horizonY) / (hitY - horizonY),
    );

    for (const [sprite, position] of [
      [this.leftFoot, leftPosition],
      [this.rightFoot, rightPosition],
    ] as const) {
      sprite.mesh.visible = position !== null;
      if (!position) continue;

      const bottomCenter = bottom.left + bottom.width * position.x;
      const topCenter = top.left + top.width * position.x;
      const bottomWidth = 100 * bottom.width / 606;
      const topWidth = 100 * top.width / 606;
      updateWarpedSprite(sprite, [
        [topCenter - topWidth / 2, topY],
        [topCenter + topWidth / 2, topY],
        [bottomCenter + bottomWidth / 2, hitY],
        [bottomCenter - bottomWidth / 2, hitY],
      ]);
    }
  }

  showResult(result: JudgementResult, combo = 0): void {
    this.effects.showResult(result, combo);
  }

  render(songTime: number, running: boolean, hidden: (noteId: string) => boolean): void {
    for (const note of this.chart.notes) {
      const view = this.noteViews.get(note.id)!;
      if (!running || hidden(note.id)) {
        this.setNoteVisible(view, false);
        continue;
      }

      if (isSustainedNote(note)) {
        this.renderSustainedNote(view, songTime);
      } else {
        this.renderNote(view, songTime);
      }
    }

    const now = performance.now();
    const delta = Math.min((now - this.lastRenderAt) / 1000, 1 / 20);
    this.lastRenderAt = now;
    this.effects.update(now, delta);
    this.playfieldScene.mixer.update(delta);
    this.renderer.clear();
    this.renderer.render(this.backgroundScene, this.backgroundCamera);
    this.renderer.clearDepth();
    this.renderer.render(this.scene, this.camera);
  }

  destroy(): void {
    this.resizeObserver.disconnect();
    this.playfieldScene.mixer.stopAllAction();
    this.playfieldScene.video.pause();
    this.playfieldScene.video.removeAttribute("src");
    this.playfieldScene.video.load();
    this.playfieldScene.texture.dispose();
    this.environment.dispose();
    this.renderer.dispose();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
        else object.material.dispose();
      } else if (object instanceof THREE.Sprite) {
        object.material.map?.dispose();
        object.material.dispose();
      }
    });
    this.backgroundScene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
      else object.material.dispose();
    });
    this.renderer.domElement.remove();
  }

  private createFootZone(): void {
    const footZone = this.createProceduralSprite("foot-base", 606, 104, normalUvs, 2);
    this.placeWarpedSprite(footZone, 1, this.chart.playfield.lanes, 1);
  }

  private createNoteView(note: ChartNote): NoteView {
    const foot = note.foot === "right" ? "right" : "left";
    if (note.type === "JUMP") {
      return {
        note,
        warped: this.createProceduralSprite("jump-base", 600, 100, normalUvs, 3),
        flat: this.createProceduralSprite("jump", 600, 200, normalUvs, 4),
      };
    }
    if (note.type === "HORIZONTAL_SLIDE") {
      const uvs = note.endLane! < note.lane! ? leftSlideUvs : rightSlideUvs;
      return {
        note,
        warped: this.createProceduralSprite("slide", 300, 200, uvs, 3, foot),
      };
    }
    if (note.type === "STAY") {
      return {
        note,
        warped: this.createProceduralSprite("stay", 150, 300, normalUvs, 3, foot),
      };
    }
    if (note.type === "VERTICAL_SLIDE") {
      return {
        note,
        warped: this.createProceduralSprite("vertical-slide", 150, 300, normalUvs, 3, foot),
      };
    }
    return {
      note,
      warped: this.createProceduralSprite("step", 152, 102, normalUvs, 3, foot),
    };
  }

  private createProceduralSprite(
    kind: ProceduralAssetKind,
    width: number,
    height: number,
    uvs: Quad,
    renderOrder: number,
    foot: "left" | "right" = "left",
  ): WarpedSprite {
    const mesh = new THREE.Mesh(createQuadGeometry(), createProceduralMaterial(kind, foot, true));
    mesh.renderOrder = renderOrder;
    this.scene.add(mesh);
    return { mesh, width, height, uvs };
  }

  private renderNote(view: NoteView, songTime: number): void {
    const timeUntil = view.note.time - songTime;
    if (
      timeUntil > this.chart.playfield.travelTime
      || timeUntil < -this.chart.playfield.travelTime
    ) {
      this.setNoteVisible(view, false);
      return;
    }

    const progress = noteTravelProgress(timeUntil, this.chart.playfield.travelTime);
    view.warped.mesh.material.uniforms.time.value = songTime;
    if (view.flat) view.flat.mesh.material.uniforms.time.value = songTime;
    const [startLane, endLane] = this.noteSpan(view.note);
    const bottom = this.placeWarpedSprite(view.warped, startLane, endLane, progress);
    view.warped.mesh.visible = bottom.topY < gameHeight;

    if (!view.flat) return;
    const scale = this.laneSpan(startLane, endLane, Math.min(1, progress)).width
      / view.warped.width;
    const centerX = (bottom.left + bottom.right) / 2;
    const width = view.flat.width * scale;
    const height = view.flat.height * scale;
    const arrowBaseY = (bottom.topY + bottom.y) / 2;
    updateWarpedSprite(
      view.flat,
      rectangleQuad(centerX - width / 2, arrowBaseY - height, width, height),
    );
    view.flat.mesh.visible = arrowBaseY - height < gameHeight;
  }

  private renderSustainedNote(view: NoteView, songTime: number): void {
    const note = view.note;
    const timeUntil = note.time - songTime;
    const endTimeUntil = note.time + (note.duration ?? 1) - songTime;
    if (
      timeUntil > this.chart.playfield.travelTime
      || endTimeUntil < -this.chart.playfield.travelTime
    ) {
      this.setNoteVisible(view, false);
      return;
    }

    const startProgress = noteTravelProgress(timeUntil, this.chart.playfield.travelTime);
    const endProgress = noteTravelProgress(endTimeUntil, this.chart.playfield.travelTime);
    const progress = Math.min(1, Math.max(0, (songTime - note.time) / (note.duration ?? 1)));
    const startLane = note.type === "VERTICAL_SLIDE"
      ? note.lane! + (note.endLane! - note.lane!) * progress
      : note.lane!;
    const endLane = note.type === "VERTICAL_SLIDE" ? note.endLane! : startLane;
    const top = this.laneSpan(endLane, endLane, endProgress);
    const bottom = this.laneSpan(startLane, startLane, startProgress);
    view.warped.mesh.material.uniforms.time.value = songTime;

    if (Math.abs(bottom.y - top.y) < 0.01) {
      this.setNoteVisible(view, false);
      return;
    }

    updateWarpedSprite(view.warped, [
      [top.left, top.y],
      [top.right, top.y],
      [bottom.right, bottom.y],
      [bottom.left, bottom.y],
    ]);
    view.warped.mesh.visible = Math.min(top.y, bottom.y) < gameHeight;
  }

  private placeWarpedSprite(
    sprite: WarpedSprite,
    startLane: number,
    endLane: number,
    progress: number,
  ): LaneSpan & { topY: number } {
    const bottom = this.laneSpan(startLane, endLane, progress);
    const topY = bottom.y
      - bottom.width * sprite.height / sprite.width * floorDepthScale;
    const top = this.laneSpan(
      startLane,
      endLane,
      (topY - horizonY) / (hitY - horizonY),
    );
    updateWarpedSprite(sprite, [
      [top.left, topY],
      [top.right, topY],
      [bottom.right, bottom.y],
      [bottom.left, bottom.y],
    ]);
    return { ...bottom, topY };
  }

  private setNoteVisible(view: NoteView, visible: boolean): void {
    view.warped.mesh.visible = visible;
    if (view.flat) view.flat.mesh.visible = visible;
  }

  private noteSpan(note: ChartNote): [number, number] {
    const { lanes } = this.chart.playfield;
    if (note.type === "JUMP") return [1, lanes];
    if (note.type === "HORIZONTAL_SLIDE") {
      const bounds = horizontalSlideBounds(note);
      return [bounds.left + 1, bounds.right];
    }
    if (note.type === "STEP" || note.type === "STAY") {
      const bounds = stepBounds(note);
      return [bounds.left + 1, bounds.right];
    }
    const lane = note.lane ?? (lanes + 1) / 2;
    return [lane, lane];
  }

  private laneSpan(startLane: number, endLane: number, progress: number): LaneSpan {
    const playLeft = farLeft + (nearLeft - farLeft) * progress;
    const playRight = farRight + (nearRight - farRight) * progress;
    const laneWidth = (playRight - playLeft) / this.chart.playfield.lanes;
    const left = playLeft + laneWidth * (startLane - 1);
    const right = playLeft + laneWidth * endLane;
    const y = horizonY + (hitY - horizonY) * progress;
    return { left, right, y, width: right - left };
  }

}
