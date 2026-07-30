import * as THREE from "three";
import type { ChartNote } from "../../domain/chart/types.ts";
import type { Judgement, JudgementResult } from "../../domain/scoring/rhythm-engine.ts";
import type { LaneSpan } from "./warped-sprite.ts";

const laneColors = [0x00f300, 0x00f7fa, 0x9c45fa, 0xd52ba2];

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

export class PlayfieldEffects {
  private readonly laneFlashes: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] = [];
  private readonly laneFlashUntil: number[];
  private readonly bursts: Burst[] = [];
  private readonly feedback: Feedback[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly lanes: number,
    private readonly laneSpan: (startLane: number, endLane: number, progress: number) => LaneSpan,
    private readonly horizonY: number,
    private readonly hitY: number,
    private readonly feedbackX: number,
  ) {
    this.laneFlashUntil = Array(lanes).fill(0);
    this.createLaneFlashes();
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
      for (let lane = 1; lane <= this.lanes; lane++) {
        this.createBurst(lane, judgement, strength * 1.35);
      }
    }
  }

  update(now: number, delta: number): void {
    this.laneFlashes.forEach((flash, index) => {
      flash.material.opacity = now < this.laneFlashUntil[index] ? 0.35 : 0;
    });
    this.updateBursts(delta);
    this.updateFeedback(delta);
  }

  private createLaneFlashes(): void {
    for (let lane = 1; lane <= this.lanes; lane++) {
      const far = this.laneSpan(lane, lane, 0);
      const near = this.laneSpan(lane, lane, 1);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
        far.left, this.horizonY, 0,
        far.right, this.horizonY, 0,
        near.right, this.hitY, 0,
        near.left, this.hitY, 0,
      ]), 3));
      geometry.setIndex([0, 1, 2, 0, 2, 3]);
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

  private resultLanes(note: ChartNote): number[] {
    if (note.type === "JUMP") {
      return Array.from({ length: this.lanes }, (_, index) => index + 1);
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
      particle.position.set(centerX, this.hitY - 8, 0);
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
    ring.position.set(centerX, this.hitY - 5, 0);
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
    sprite.position.set(this.feedbackX, 316, 0);
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
