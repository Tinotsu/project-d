import * as THREE from "three";
import footBaseUrl from "../assets/foot base.svg?url";
import footUrl from "../assets/foot.svg?url";
import horizontalLeftSlideUrl from "../assets/horizontal left slide.svg?url";
import horizontalRightSlideUrl from "../assets/horizontal right slide.svg?url";
import jumpBaseUrl from "../assets/jump base.svg?url";
import jumpUrl from "../assets/jump.svg?url";
import leftSlideUrl from "../assets/left slide.svg?url";
import leftStayUrl from "../assets/left stay.svg?url";
import leftStepUrl from "../assets/left base.svg?url";
import trackUrl from "../assets/pist.svg?url";
import rightSlideUrl from "../assets/right slide.svg?url";
import rightStayUrl from "../assets/right stay.svg?url";
import rightStepUrl from "../assets/right base.svg?url";
import type { LevelChart } from "./level.ts";
import {
  horizontalSlideBounds,
  isSustainedNote,
  stepBounds,
  type ChartNote,
  type Judgement,
  type JudgementResult,
} from "./rhythm-engine.ts";

export const gameWidth = 1280;
export const gameHeight = 720;

const farLeft = 580;
const farRight = 700;
const nearLeft = 20;
const nearRight = 1260;
const horizonY = 100;
const hitY = 590;
const floorDepthScale = 1 / 3;
const laneColors = [0x00f300, 0x00f7fa, 0x9c45fa, 0xd52ba2];

type Point = [number, number];
type Quad = [Point, Point, Point, Point];
type LaneSpan = { left: number; right: number; y: number; width: number };

type Textures = {
  foot: THREE.Texture;
  footBase: THREE.Texture;
  track: THREE.Texture;
  jumpBase: THREE.Texture;
  jump: THREE.Texture;
  leftStep: THREE.Texture;
  rightStep: THREE.Texture;
  leftSlide: THREE.Texture;
  rightSlide: THREE.Texture;
  leftStay: THREE.Texture;
  rightStay: THREE.Texture;
  horizontalLeftSlide: THREE.Texture;
  horizontalRightSlide: THREE.Texture;
};

type WarpedSprite = {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  width: number;
  height: number;
  uvs: Quad;
};

type NoteView = {
  note: ChartNote;
  warped: WarpedSprite;
  flat?: WarpedSprite;
};

type Burst = {
  particles: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>[];
  velocities: THREE.Vector2[];
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  age: number;
  duration: number;
};

type Feedback = {
  sprite: THREE.Sprite;
  age: number;
  duration: number;
};

const normalUvs: Quad = [[0, 1], [1, 1], [1, 0], [0, 0]];
const mirroredUvs: Quad = [[1, 1], [0, 1], [0, 0], [1, 0]];
const leftSlideUvs: Quad = [[1, 1], [1, 0], [0, 0], [0, 1]];
const rightSlideUvs: Quad = [[0, 0], [0, 1], [1, 1], [1, 0]];

const textureUrls: Record<keyof Textures, string> = {
  foot: footUrl,
  footBase: footBaseUrl,
  track: trackUrl,
  jumpBase: jumpBaseUrl,
  jump: jumpUrl,
  leftStep: leftStepUrl,
  rightStep: rightStepUrl,
  leftSlide: leftSlideUrl,
  rightSlide: rightSlideUrl,
  leftStay: leftStayUrl,
  rightStay: rightStayUrl,
  horizontalLeftSlide: horizontalLeftSlideUrl,
  horizontalRightSlide: horizontalRightSlideUrl,
};

export function noteTravelProgress(timeUntil: number, travelTime: number): number {
  return Math.max(0, 1 - timeUntil / travelTime) ** 1.65;
}

function solveHomography(from: Quad, to: Quad): number[] {
  const size = 8;
  const matrix = Array.from({ length: size }, () => Array<number>(size + 1).fill(0));

  for (let index = 0; index < 4; index++) {
    const [x, y] = from[index];
    const [u, v] = to[index];
    matrix[index * 2] = [x, y, 1, 0, 0, 0, -u * x, -u * y, u];
    matrix[index * 2 + 1] = [0, 0, 0, x, y, 1, -v * x, -v * y, v];
  }

  for (let column = 0; column < size; column++) {
    let pivot = column;
    for (let row = column + 1; row < size; row++) {
      if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) pivot = row;
    }
    [matrix[column], matrix[pivot]] = [matrix[pivot], matrix[column]];
    if (Math.abs(matrix[column][column]) < 1e-10) {
      throw new Error("Cannot project a zero-area playfield asset");
    }

    const divisor = matrix[column][column];
    for (let item = column; item <= size; item++) matrix[column][item] /= divisor;
    for (let row = 0; row < size; row++) {
      if (row === column) continue;
      const factor = matrix[row][column];
      for (let item = column; item <= size; item++) {
        matrix[row][item] -= factor * matrix[column][item];
      }
    }
  }

  return matrix.map((row) => row[size]);
}

function createQuadGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(12), 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}

function setQuadGeometry(geometry: THREE.BufferGeometry, quad: Quad): void {
  const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
  quad.forEach(([x, y], index) => positions.setXYZ(index, x, y, 0));
  positions.needsUpdate = true;
}

function createWarpMaterial(texture: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: texture },
      opacity: { value: 1 },
      hU: { value: new THREE.Vector3() },
      hV: { value: new THREE.Vector3() },
      hW: { value: new THREE.Vector3() },
    },
    vertexShader: `
      varying vec2 logicalPosition;

      void main() {
        logicalPosition = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D map;
      uniform float opacity;
      uniform vec3 hU;
      uniform vec3 hV;
      uniform vec3 hW;
      varying vec2 logicalPosition;

      void main() {
        vec3 point = vec3(logicalPosition, 1.0);
        float denominator = dot(hW, point);
        vec2 uv = vec2(dot(hU, point), dot(hV, point)) / denominator;
        if (uv.x < -0.001 || uv.x > 1.001 || uv.y < -0.001 || uv.y > 1.001) discard;
        vec4 color = texture2D(map, uv);
        color.a *= opacity;
        if (color.a < 0.01) discard;
        gl_FragColor = color;
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}

function updateWarpedSprite(sprite: WarpedSprite, quad: Quad): void {
  setQuadGeometry(sprite.mesh.geometry, quad);
  const homography = solveHomography(quad, sprite.uvs);
  sprite.mesh.material.uniforms.hU.value.set(homography[0], homography[1], homography[2]);
  sprite.mesh.material.uniforms.hV.value.set(homography[3], homography[4], homography[5]);
  sprite.mesh.material.uniforms.hW.value.set(homography[6], homography[7], 1);
}

function rectangleQuad(left: number, top: number, width: number, height: number): Quad {
  return [
    [left, top],
    [left + width, top],
    [left + width, top + height],
    [left, top + height],
  ];
}

export class ThreePlayfield {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(0, gameWidth, 0, gameHeight, 0.1, 100);
  private readonly renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    precision: "highp",
  });
  private readonly noteViews = new Map<string, NoteView>();
  private readonly laneFlashes: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] = [];
  private readonly laneFlashUntil = [0, 0, 0, 0];
  private readonly bursts: Burst[] = [];
  private readonly feedback: Feedback[] = [];
  private readonly resizeObserver: ResizeObserver;
  private readonly textures: Textures;
  private readonly leftFoot: WarpedSprite;
  private readonly rightFoot: WarpedSprite;
  private lastRenderAt = performance.now();

  private constructor(
    private readonly mount: HTMLElement,
    private readonly chart: LevelChart,
    textures: Textures,
  ) {
    this.textures = textures;
    this.camera.position.z = 10;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.setAttribute("aria-label", "Four-lane 3D rhythm game playfield");
    this.mount.append(this.renderer.domElement);

    this.createTrack();
    this.createLaneFlashes();
    this.createFootZone();

    for (const note of this.chart.notes) {
      this.noteViews.set(note.id, this.createNoteView(note));
    }

    this.leftFoot = this.createWarpedSprite(this.textures.foot, 100, 100, normalUvs, 5);
    this.rightFoot = this.createWarpedSprite(this.textures.foot, 100, 100, mirroredUvs, 5);
    this.leftFoot.mesh.visible = false;
    this.rightFoot.mesh.visible = false;

    this.resizeObserver = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      this.renderer.setSize(width, height, false);
    });
    this.resizeObserver.observe(this.mount);
    const { width, height } = this.mount.getBoundingClientRect();
    this.renderer.setSize(width, height, false);
  }

  static async create(mount: HTMLElement, chart: LevelChart): Promise<ThreePlayfield> {
    const loader = new THREE.TextureLoader();
    const entries = await Promise.all(
      Object.entries(textureUrls).map(async ([key, url]) => {
        const texture = await loader.loadAsync(url);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        return [key, texture] as const;
      }),
    );
    return new ThreePlayfield(mount, chart, Object.fromEntries(entries) as Textures);
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
    const judgement = result.judgement;
    this.createFeedback(judgement);
    if (judgement === "miss") return;

    const lanes = this.resultLanes(result.note);
    const strength = 1 + Math.min(combo, 40) / 30;
    const now = performance.now();
    lanes.forEach((lane) => {
      this.laneFlashUntil[lane - 1] = now + 180;
      this.createBurst(lane, judgement, strength);
    });

    if (combo > 0 && combo % 5 === 0) {
      for (let lane = 1; lane <= this.chart.playfield.lanes; lane++) {
        this.createBurst(lane, judgement, strength * 1.35);
      }
    }
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
    this.laneFlashes.forEach((flash, index) => {
      flash.material.opacity = now < this.laneFlashUntil[index] ? 0.35 : 0;
    });
    this.updateBursts(delta);
    this.updateFeedback(delta);
    this.renderer.render(this.scene, this.camera);
  }

  destroy(): void {
    this.resizeObserver.disconnect();
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
    Object.values(this.textures).forEach((texture) => texture.dispose());
    this.renderer.domElement.remove();
  }

  private createTrack(): void {
    const bottomProgress = (gameHeight - horizonY) / (hitY - horizonY);
    for (let lane = 1; lane <= this.chart.playfield.lanes; lane++) {
      const top = this.laneSpan(lane, lane, 0);
      const bottom = this.laneSpan(lane, lane, bottomProgress);
      const firstU = (lane - 1) / this.chart.playfield.lanes;
      const lastU = lane / this.chart.playfield.lanes;
      const sprite = this.createWarpedSprite(
        this.textures.track,
        100,
        1200,
        [[firstU, 1], [lastU, 1], [lastU, 0], [firstU, 0]],
        0,
      );
      updateWarpedSprite(sprite, [
        [top.left, horizonY],
        [top.right, horizonY],
        [bottom.right, gameHeight],
        [bottom.left, gameHeight],
      ]);
    }
  }

  private createLaneFlashes(): void {
    for (let lane = 1; lane <= this.chart.playfield.lanes; lane++) {
      const far = this.laneSpan(lane, lane, 0);
      const near = this.laneSpan(lane, lane, 1);
      const geometry = createQuadGeometry();
      setQuadGeometry(geometry, [
        [far.left, horizonY],
        [far.right, horizonY],
        [near.right, hitY],
        [near.left, hitY],
      ]);
      const material = new THREE.MeshBasicMaterial({
        color: laneColors[lane - 1],
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      });
      const flash = new THREE.Mesh(geometry, material);
      flash.renderOrder = 1;
      this.scene.add(flash);
      this.laneFlashes.push(flash);
    }
  }

  private createFootZone(): void {
    const footZone = this.createWarpedSprite(this.textures.footBase, 606, 104, normalUvs, 2);
    this.placeWarpedSprite(footZone, 1, this.chart.playfield.lanes, 1);
  }

  private createNoteView(note: ChartNote): NoteView {
    if (note.type === "JUMP") {
      return {
        note,
        warped: this.createWarpedSprite(this.textures.jumpBase, 600, 100, normalUvs, 3),
        flat: this.createWarpedSprite(this.textures.jump, 600, 200, normalUvs, 4),
      };
    }
    if (note.type === "HORIZONTAL_SLIDE") {
      const texture = note.foot === "right" ? this.textures.rightSlide : this.textures.leftSlide;
      const uvs = note.endLane! < note.lane! ? leftSlideUvs : rightSlideUvs;
      return { note, warped: this.createWarpedSprite(texture, 300, 200, uvs, 3) };
    }
    if (note.type === "STAY") {
      const texture = note.foot === "right" ? this.textures.rightStay : this.textures.leftStay;
      return { note, warped: this.createWarpedSprite(texture, 150, 300, normalUvs, 3) };
    }
    if (note.type === "VERTICAL_SLIDE") {
      const texture = note.foot === "right"
        ? this.textures.horizontalRightSlide
        : this.textures.horizontalLeftSlide;
      return { note, warped: this.createWarpedSprite(texture, 150, 300, normalUvs, 3) };
    }
    const texture = note.foot === "right" ? this.textures.rightStep : this.textures.leftStep;
    return { note, warped: this.createWarpedSprite(texture, 152, 102, normalUvs, 3) };
  }

  private createWarpedSprite(
    texture: THREE.Texture,
    width: number,
    height: number,
    uvs: Quad,
    renderOrder: number,
  ): WarpedSprite {
    const mesh = new THREE.Mesh(createQuadGeometry(), createWarpMaterial(texture));
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
    const [startLane, endLane] = this.noteSpan(view.note);
    const bottom = this.placeWarpedSprite(view.warped, startLane, endLane, progress);
    view.warped.mesh.visible = bottom.topY < gameHeight;

    if (!view.flat) return;
    const scale = this.laneSpan(startLane, endLane, Math.min(1, progress)).width
      / view.warped.width;
    const centerX = (bottom.left + bottom.right) / 2;
    const width = view.flat.width * scale;
    const height = view.flat.height * scale;
    updateWarpedSprite(
      view.flat,
      rectangleQuad(centerX - width / 2, bottom.y - height, width, height),
    );
    view.flat.mesh.visible = bottom.y - height < gameHeight;
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

  private resultLanes(note: ChartNote): number[] {
    if (note.type === "JUMP") {
      return Array.from({ length: this.chart.playfield.lanes }, (_, index) => index + 1);
    }
    if (note.type === "HORIZONTAL_SLIDE" || note.type === "VERTICAL_SLIDE") {
      const first = Math.min(note.lane!, note.endLane!);
      const last = Math.max(note.lane!, note.endLane!);
      return Array.from({ length: last - first + 1 }, (_, index) => first + index);
    }
    return [note.lane ?? 1];
  }

  private createBurst(
    lane: number,
    judgement: Exclude<Judgement, "miss">,
    strength: number,
  ): void {
    const color = judgement === "perfect"
      ? 0x00f300
      : judgement === "great"
        ? 0x00f7fa
        : 0xfaf600;
    const span = this.laneSpan(lane, lane, 1);
    const centerX = (span.left + span.right) / 2;
    const particleGeometry = new THREE.CircleGeometry(5, 8);
    const particles: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>[] = [];
    const velocities: THREE.Vector2[] = [];
    const count = Math.round(9 * strength);

    for (let index = 0; index < count; index++) {
      const particle = new THREE.Mesh(
        particleGeometry,
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          side: THREE.DoubleSide,
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      particle.position.set(centerX, hitY - 8, 0);
      particle.renderOrder = 7;
      this.scene.add(particle);
      particles.push(particle);
      velocities.push(new THREE.Vector2(
        (Math.random() - 0.5) * 210 * strength,
        -(70 + Math.random() * 190 * strength),
      ));
    }

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(18, 25, 32),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    ring.position.set(centerX, hitY - 5, 0);
    ring.scale.y = 0.32;
    ring.renderOrder = 6;
    this.scene.add(ring);
    this.bursts.push({ particles, velocities, ring, age: 0, duration: 0.52 });
  }

  private updateBursts(delta: number): void {
    for (let burstIndex = this.bursts.length - 1; burstIndex >= 0; burstIndex--) {
      const burst = this.bursts[burstIndex];
      burst.age += delta;
      const progress = burst.age / burst.duration;
      const ringScale = 1 + progress * 4;
      burst.ring.scale.set(ringScale, ringScale * 0.32, 1);
      burst.ring.material.opacity = 1 - progress;

      burst.particles.forEach((particle, index) => {
        const velocity = burst.velocities[index];
        velocity.y += 420 * delta;
        particle.position.x += velocity.x * delta;
        particle.position.y += velocity.y * delta;
        particle.material.opacity = 1 - progress;
      });

      if (progress < 1) continue;
      burst.particles.forEach((particle) => {
        this.scene.remove(particle);
        particle.material.dispose();
      });
      burst.particles[0]?.geometry.dispose();
      this.scene.remove(burst.ring);
      burst.ring.geometry.dispose();
      burst.ring.material.dispose();
      this.bursts.splice(burstIndex, 1);
    }
  }

  private createFeedback(judgement: Judgement): void {
    const color = judgement === "perfect"
      ? "#00f300"
      : judgement === "great"
        ? "#00f7fa"
        : judgement === "good"
          ? "#faf600"
          : "#fc2500";
    const canvas = document.createElement("canvas");
    canvas.width = 580;
    canvas.height = 164;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "rgba(0, 0, 0, .82)";
    context.strokeStyle = color;
    context.lineWidth = 10;
    context.beginPath();
    context.roundRect(5, 5, 570, 154, 30);
    context.fill();
    context.stroke();
    context.font = "700 72px Space Grotesk, Arial";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = "#f9f9f9";
    context.fillText(judgement.toUpperCase(), 290, 84);

    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }));
    sprite.position.set(gameWidth / 2, 316, 0);
    sprite.scale.set(290, 82, 1);
    sprite.renderOrder = 20;
    this.scene.add(sprite);
    this.feedback.push({ sprite, age: 0, duration: 0.42 });
  }

  private updateFeedback(delta: number): void {
    for (let index = this.feedback.length - 1; index >= 0; index--) {
      const feedback = this.feedback[index];
      feedback.age += delta;
      const progress = feedback.age / feedback.duration;
      feedback.sprite.material.opacity = 1 - Math.max(0, (progress - 0.55) / 0.45);
      if (progress < 1) continue;
      this.scene.remove(feedback.sprite);
      feedback.sprite.material.map?.dispose();
      feedback.sprite.material.dispose();
      this.feedback.splice(index, 1);
    }
  }
}
