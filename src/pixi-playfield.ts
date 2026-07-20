import {
  Application,
  Assets,
  Container,
  Graphics,
  PerspectiveMesh,
  Sprite,
  Text,
  Texture,
} from "pixi.js";
import blueSlideUrl from "../assets/blue slide.svg?url";
import footBaseUrl from "../assets/foot base.svg?url";
import footUrl from "../assets/foot.svg?url";
import jumpBaseUrl from "../assets/jump base.svg?url";
import jumpUrl from "../assets/jump.svg?url";
import leftStepUrl from "../assets/left base.svg?url";
import trackUrl from "../assets/pist.svg?url";
import redSlideUrl from "../assets/red slide.svg?url";
import rightStepUrl from "../assets/right base.svg?url";
import type { LevelChart } from "./level.ts";
import type { ChartNote, JudgementResult } from "./rhythm-engine.ts";

export const gameWidth = 1100;
export const gameHeight = 660;

const farLeft = 410;
const farRight = 690;
const nearLeft = 90;
const nearRight = 1010;
const horizonY = 70;
const hitY = 540;
const laneColors = [0x35dcff, 0x6c82ff, 0xff4fa2, 0xff9b45];
const assetUrls = [
  blueSlideUrl,
  footBaseUrl,
  footUrl,
  jumpBaseUrl,
  jumpUrl,
  leftStepUrl,
  trackUrl,
  redSlideUrl,
  rightStepUrl,
];

export class PixiPlayfield {
  private readonly app = new Application();
  private readonly noteViews = new Map<string, Container>();
  private readonly slideGroups = new Map<string, ChartNote[]>();
  private readonly slidePaths = new Map<string, Graphics>();
  private readonly laneGlow = new Graphics();
  private readonly laneGlowUntil = [0, 0, 0, 0];
  private readonly feedback = new Graphics();
  private readonly feedbackLabel = new Text({
    text: "",
    style: {
      fill: 0xffffff,
      fontFamily: "Space Grotesk",
      fontSize: 42,
      fontWeight: "700",
    },
  });
  private leftFootMarker!: Sprite;
  private rightFootMarker!: Sprite;
  private feedbackUntil = 0;

  private constructor(private readonly chart: LevelChart) {}

  static async create(mount: HTMLElement, chart: LevelChart): Promise<PixiPlayfield> {
    const playfield = new PixiPlayfield(chart);
    await playfield.init(mount);
    return playfield;
  }

  showTrackedFeet(leftLane: number | null, rightLane: number | null): void {
    const sameLane = leftLane !== null && leftLane === rightLane;
    for (const [marker, lane, offset] of [
      [this.leftFootMarker, leftLane, -30],
      [this.rightFootMarker, rightLane, 30],
    ] as const) {
      marker.visible = lane !== null;
      if (lane !== null) {
        const edges = this.laneEdges(lane, 1);
        marker.position.set((edges[0] + edges[1]) / 2 + (sameLane ? offset : 0), hitY + 3);
      }
    }
  }

  showResult(result: JudgementResult): void {
    this.feedback.clear();
    const color = result.judgement === "perfect" ? 0xffe640 : result.judgement === "great" ? 0x35dcff : result.judgement === "good" ? 0xffffff : 0xff4fa2;
    this.feedback
      .roundRect(gameWidth / 2 - 145, 275, 290, 82, 18)
      .fill({ color: 0x08090d, alpha: 0.82 })
      .stroke({ color, width: 5 });
    this.feedbackLabel.text = result.judgement.toUpperCase();
    this.feedbackLabel.visible = true;
    this.feedback.visible = true;
    this.feedbackUntil = performance.now() + 380;
    const lanes = result.note.lane ? [result.note.lane] : [1, 2, 3, 4];
    lanes.forEach((lane) => this.laneGlowUntil[lane - 1] = performance.now() + 180);
  }

  render(songTime: number, running: boolean, judged: (noteId: string) => boolean): void {
    this.renderSlides(songTime, running);

    for (const note of this.chart.notes) {
      const view = this.noteViews.get(note.id)!;
      if (note.slide && note.type !== "STEP") {
        view.visible = false;
        continue;
      }
      if (!running || judged(note.id)) {
        view.visible = false;
        continue;
      }
      const timeUntil = note.time - songTime;
      if (timeUntil > this.chart.playfield.travelTime || timeUntil < -0.2) {
        view.visible = false;
        continue;
      }

      const progress = Math.min(1, Math.max(0, 1 - timeUntil / this.chart.playfield.travelTime));
      const easedProgress = progress ** 1.45;
      const playfieldWidth = farRight - farLeft + (nearRight - nearLeft - farRight + farLeft) * easedProgress;
      const lane = note.lane ?? 2.5;
      const edges = Number.isInteger(lane) ? this.laneEdges(lane, easedProgress) : [gameWidth / 2, gameWidth / 2];
      view.position.set((edges[0] + edges[1]) / 2, horizonY + (hitY - horizonY) * easedProgress);
      view.scale.x = note.type === "JUMP" ? playfieldWidth / 480 : playfieldWidth / this.chart.playfield.lanes * 0.82 / 152;
      view.scale.y = (note.type === "JUMP" ? 0.48 : 0.55) + easedProgress * 0.65;
      view.visible = true;
    }

    this.laneGlow.clear();
    this.laneGlowUntil.forEach((until, index) => {
      if (performance.now() < until) this.drawLane(this.laneGlow, index + 1, laneColors[index], 0.35);
    });
    const pulse = 1 + Math.sin(performance.now() / 90) * 0.04;
    this.leftFootMarker.scale.set(0.72 * pulse);
    this.rightFootMarker.scale.set(-0.72 * pulse, 0.72 * pulse);
    if (this.feedback.visible && performance.now() > this.feedbackUntil) {
      this.feedback.visible = false;
      this.feedbackLabel.visible = false;
    }
  }

  destroy(): void {
    this.app.destroy({ removeView: true }, { children: true, texture: false });
  }

  private async init(mount: HTMLElement): Promise<void> {
    await Promise.all([
      this.app.init({
        width: gameWidth,
        height: gameHeight,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio, 2),
        backgroundAlpha: 0,
        preference: "webgl",
      }),
      Assets.load(assetUrls),
    ]);
    this.app.canvas.setAttribute("aria-label", "Four-lane rhythm game playfield");
    mount.append(this.app.canvas);

    const track = new PerspectiveMesh({ texture: Texture.from(trackUrl), verticesX: 12, verticesY: 12 });
    track.setCorners(farLeft, horizonY, farRight, horizonY, nearRight, hitY, nearLeft, hitY);
    track.alpha = 0.42;
    this.app.stage.addChild(track);

    const highway = new Graphics();
    for (let lane = 1; lane <= this.chart.playfield.lanes; lane++) this.drawLane(highway, lane, laneColors[lane - 1], 0.1);
    for (let boundary = 0; boundary <= this.chart.playfield.lanes; boundary++) {
      const farX = farLeft + (farRight - farLeft) * boundary / this.chart.playfield.lanes;
      const nearX = nearLeft + (nearRight - nearLeft) * boundary / this.chart.playfield.lanes;
      highway.moveTo(farX, horizonY).lineTo(nearX, hitY).stroke({ color: 0xffffff, alpha: 0.28, width: 2 });
    }
    this.app.stage.addChild(highway);

    const stepZone = Sprite.from(footBaseUrl);
    stepZone.anchor.set(0.5);
    stepZone.position.set(gameWidth / 2, hitY + 2);
    stepZone.width = nearRight - nearLeft + 36;
    stepZone.height = 112;
    this.app.stage.addChild(stepZone);

    for (const note of this.chart.notes) {
      if (note.slide) {
        const group = this.slideGroups.get(note.slide) ?? [];
        group.push(note);
        this.slideGroups.set(note.slide, group);
      }
      const view = this.createNoteView(note);
      this.noteViews.set(note.id, view);
      this.app.stage.addChild(view);
    }
    for (const slide of this.slideGroups.keys()) {
      const path = new Graphics();
      this.slidePaths.set(slide, path);
      this.app.stage.addChildAt(path, 2);
    }

    this.leftFootMarker = this.createFootMarker(false);
    this.rightFootMarker = this.createFootMarker(true);
    this.app.stage.addChild(this.leftFootMarker, this.rightFootMarker, this.laneGlow);
    this.feedback.visible = false;
    this.feedbackLabel.anchor.set(0.5);
    this.feedbackLabel.position.set(gameWidth / 2, 316);
    this.feedbackLabel.visible = false;
    this.app.stage.addChild(this.feedback, this.feedbackLabel);
  }

  private createNoteView(note: ChartNote): Container {
    const view = new Container();
    if (note.type === "JUMP") {
      const base = Sprite.from(jumpBaseUrl);
      base.anchor.set(0.5);
      base.width = 480;
      base.height = 76;
      const arrows = Sprite.from(jumpUrl);
      arrows.anchor.set(0.5);
      arrows.width = 470;
      arrows.height = 116;
      view.addChild(base, arrows);
    } else {
      const step = Sprite.from(note.foot === "left" ? leftStepUrl : rightStepUrl);
      step.anchor.set(0.5);
      step.width = 152;
      step.height = 54;
      view.addChild(step);
    }
    view.visible = false;
    return view;
  }

  private createFootMarker(mirrored: boolean): Sprite {
    const marker = Sprite.from(footUrl);
    marker.anchor.set(0.5);
    marker.scale.set(mirrored ? -0.72 : 0.72, 0.72);
    marker.visible = false;
    return marker;
  }

  private renderSlides(songTime: number, running: boolean): void {
    for (const [slide, path] of this.slidePaths) {
      path.clear();
      const notes = this.slideGroups.get(slide)!;
      const first = notes[0];
      const last = notes[notes.length - 1];
      if (!running || first.time - songTime > this.chart.playfield.travelTime || songTime >= last.time) continue;

      let pathNotes: Array<{ time: number; lane: number }> = notes.map((note) => ({ time: note.time, lane: note.lane! }));
      if (songTime > first.time) {
        const nextIndex = notes.findIndex((note) => note.time >= songTime);
        if (nextIndex < 1) continue;
        const previous = notes[nextIndex - 1];
        const next = notes[nextIndex];
        const progress = (songTime - previous.time) / (next.time - previous.time);
        pathNotes = [
          { time: songTime, lane: previous.lane! + (next.lane! - previous.lane!) * progress },
          ...notes.slice(nextIndex).map((note) => ({ time: note.time, lane: note.lane! })),
        ];
      }

      const points = pathNotes.map((note) => {
        const progress = Math.min(1, Math.max(0, 1 - (note.time - songTime) / this.chart.playfield.travelTime)) ** 1.45;
        const edges = this.laneEdges(note.lane, progress);
        const playfieldWidth = farRight - farLeft + (nearRight - nearLeft - farRight + farLeft) * progress;
        return {
          x: (edges[0] + edges[1]) / 2,
          y: horizonY + (hitY - horizonY) * progress,
          halfWidth: playfieldWidth / this.chart.playfield.lanes * 0.27,
        };
      });
      if (points.length < 2) continue;

      const polygon = points.flatMap((point) => [point.x - point.halfWidth, point.y]);
      for (let index = points.length - 1; index >= 0; index--) polygon.push(points[index].x + points[index].halfWidth, points[index].y);
      const texture = Texture.from(first.foot === "left" ? blueSlideUrl : redSlideUrl);
      path.poly(polygon, true).fill({ texture, textureSpace: "local", alpha: 0.82 }).stroke({ color: 0xffffff, alpha: 0.5, width: 2 });
    }
  }

  private laneEdges(lane: number, progress: number): [number, number] {
    const left = farLeft + (nearLeft - farLeft) * progress;
    const right = farRight + (nearRight - farRight) * progress;
    const laneWidth = (right - left) / this.chart.playfield.lanes;
    return [left + laneWidth * (lane - 1), left + laneWidth * lane];
  }

  private drawLane(graphics: Graphics, lane: number, color: number, alpha: number): void {
    const far = this.laneEdges(lane, 0);
    const near = this.laneEdges(lane, 1);
    graphics.poly([far[0], horizonY, far[1], horizonY, near[1], hitY, near[0], hitY], true).fill({ color, alpha });
  }
}
