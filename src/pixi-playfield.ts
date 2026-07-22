import {
  Application,
  Assets,
  Container,
  DOMContainer,
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

export const gameWidth = 1280;
export const gameHeight = 720;

const farLeft = 580;
const farRight = 700;
const nearLeft = 20;
const nearRight = 1260;
const horizonY = 100;
const hitY = 590;
const laneColors = [0x35dcff, 0x6c82ff, 0xff4fa2, 0xff9b45];
const assetUrls = [
  footBaseUrl,
  footUrl,
  trackUrl,
];

export class PixiPlayfield {
  private readonly app = new Application();
  private readonly noteViews = new Map<string, Container>();
  private readonly slideGroups = new Map<string, ChartNote[]>();
  private readonly slidePaths = new Map<string, DOMContainer>();
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
      const easedProgress = progress ** 1.65;
      const playfieldWidth = farRight - farLeft + (nearRight - nearLeft - farRight + farLeft) * easedProgress;
      const lane = note.lane ?? 2.5;
      const edges = Number.isInteger(lane) ? this.laneEdges(lane, easedProgress) : [gameWidth / 2, gameWidth / 2];
      view.position.set((edges[0] + edges[1]) / 2, horizonY + (hitY - horizonY) * easedProgress);
      const scale = note.type === "JUMP"
        ? playfieldWidth * 0.72 / 830
        : playfieldWidth / this.chart.playfield.lanes * 0.82 / 152;
      view.scale.set(scale);
      view.visible = true;
    }

    this.laneGlow.clear();
    this.laneGlowUntil.forEach((until, index) => {
      if (performance.now() < until) this.drawLane(this.laneGlow, index + 1, laneColors[index], 0.35);
    });
    const pulse = 1 + Math.sin(performance.now() / 90) * 0.04;
    this.leftFootMarker.scale.set(0.9 * pulse);
    this.rightFootMarker.scale.set(-0.9 * pulse, 0.9 * pulse);
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

    const track = new PerspectiveMesh({ texture: Texture.from(trackUrl), verticesX: 16, verticesY: 16 });
    track.setCorners(farLeft, horizonY, farRight, horizonY, 1400, gameHeight, -120, gameHeight);
    track.alpha = 0.78;
    this.app.stage.addChild(track);

    const highway = new Graphics();
    for (let lane = 1; lane <= this.chart.playfield.lanes; lane++) this.drawLane(highway, lane, laneColors[lane - 1], 0.06);
    for (let boundary = 0; boundary <= this.chart.playfield.lanes; boundary++) {
      const farX = farLeft + (farRight - farLeft) * boundary / this.chart.playfield.lanes;
      const nearX = nearLeft + (nearRight - nearLeft) * boundary / this.chart.playfield.lanes;
      highway.moveTo(farX, horizonY).lineTo(nearX, hitY).stroke({ color: 0xffffff, alpha: 0.38, width: 2 });
    }
    for (let depth = 0.14; depth < 1; depth += 0.14) {
      const outerLeft = this.laneEdges(1, depth)[0];
      const outerRight = this.laneEdges(this.chart.playfield.lanes, depth)[1];
      const y = horizonY + (hitY - horizonY) * depth;
      highway.moveTo(outerLeft, y).lineTo(outerRight, y).stroke({ color: 0xffffff, alpha: 0.16, width: 2 });
    }
    this.app.stage.addChild(highway);

    const stepZone = new PerspectiveMesh({ texture: Texture.from(footBaseUrl), verticesX: 10, verticesY: 2 });
    stepZone.setCorners(55, 558, 1225, 558, 1310, 650, -30, 650);
    this.app.stage.addChild(stepZone);

    for (const note of this.chart.notes) {
      if (note.slide) {
        const group = this.slideGroups.get(note.slide) ?? [];
        group.push(note);
        this.slideGroups.set(note.slide, group);
      }
    }
    for (const [slide, notes] of this.slideGroups) {
      const element = document.createElement("img");
      element.src = notes[0].foot === "left" ? blueSlideUrl : redSlideUrl;
      element.width = 86;
      element.height = 316;
      element.alt = "";
      element.style.pointerEvents = "none";
      const path = new DOMContainer({ element, anchor: { x: 0.5, y: 1 } });
      path.visible = false;
      this.slidePaths.set(slide, path);
      this.app.stage.addChild(path);
    }
    for (const note of this.chart.notes) {
      const view = this.createNoteView(note);
      this.noteViews.set(note.id, view);
      this.app.stage.addChild(view);
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
      const element = document.createElement("div");
      element.style.cssText = "position:relative;width:830px;height:200px;pointer-events:none";
      const base = document.createElement("img");
      base.src = jumpBaseUrl;
      base.width = 830;
      base.height = 130;
      base.alt = "";
      base.style.cssText = "position:absolute;left:0;top:35px";
      const jump = document.createElement("img");
      jump.src = jumpUrl;
      jump.width = 800;
      jump.height = 200;
      jump.alt = "";
      jump.style.cssText = "position:absolute;left:15px;top:0";
      element.append(base, jump);
      view.addChild(new DOMContainer({ element, anchor: 0.5 }));
    } else {
      const element = document.createElement("div");
      element.style.cssText = "position:relative;width:152px;height:54px;pointer-events:none;perspective:260px";
      const step = document.createElement("object");
      step.data = note.foot === "left" ? leftStepUrl : rightStepUrl;
      step.type = "image/svg+xml";
      step.width = "152";
      step.height = note.foot === "left" ? "53" : "54";
      step.style.cssText = "position:absolute;left:0;bottom:0;pointer-events:none;transform:rotateX(62deg);transform-origin:50% 100%";
      step.addEventListener("load", () => {
        const document = step.contentDocument!;
        (document.querySelector("svg > rect") as SVGElement).style.display = "none";
        document.getElementById("Rectangle 4")!.animate(
          [{ transform: "translateY(0)" }, { transform: "translateY(-175px)" }],
          { duration: 500, iterations: Infinity },
        );
      });
      element.append(step);
      view.addChild(new DOMContainer({ element, anchor: 0.5 }));
    }
    view.visible = false;
    return view;
  }

  private createFootMarker(mirrored: boolean): Sprite {
    const marker = Sprite.from(footUrl);
    marker.anchor.set(0.5);
    marker.scale.set(mirrored ? -0.9 : 0.9, 0.9);
    marker.visible = false;
    return marker;
  }

  private renderSlides(songTime: number, running: boolean): void {
    for (const [slide, path] of this.slidePaths) {
      path.visible = false;
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
        const progress = Math.min(1, Math.max(0, 1 - (note.time - songTime) / this.chart.playfield.travelTime)) ** 1.65;
        const edges = this.laneEdges(note.lane, progress);
        const playfieldWidth = farRight - farLeft + (nearRight - nearLeft - farRight + farLeft) * progress;
        return {
          x: (edges[0] + edges[1]) / 2,
          y: horizonY + (hitY - horizonY) * progress,
          halfWidth: playfieldWidth / this.chart.playfield.lanes * 0.27,
        };
      });
      if (points.length < 2) continue;

      const start = points[0];
      const end = points[points.length - 1];
      path.position.set(start.x, start.y);
      path.rotation = Math.atan2(end.y - start.y, end.x - start.x) + Math.PI / 2;
      path.scale.set((start.halfWidth + end.halfWidth) / 86, Math.hypot(end.x - start.x, end.y - start.y) / 316);
      path.visible = true;
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
