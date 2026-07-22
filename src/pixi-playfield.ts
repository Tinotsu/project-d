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

const slideArt = { width: 86, height: 316, laneRatio: 0.27 };
const noteArt = {
  JUMP: { width: 830, height: 200 },
  STEP: { width: 152, height: 54 },
} as const;

const assetUrls = [footBaseUrl, footUrl, trackUrl];

const jumpBaseHeight = 130;
const jumpLabelArt = { width: 800, height: 200 };

function mountJump(warped: HTMLElement, flat: HTMLElement): void {
  const base = document.createElement("img");
  base.src = jumpBaseUrl;
  base.width = noteArt.JUMP.width;
  base.height = jumpBaseHeight;
  warped.style.width = `${noteArt.JUMP.width}px`;
  warped.style.height = `${jumpBaseHeight}px`;
  warped.append(base);

  const jump = document.createElement("img");
  jump.src = jumpUrl;
  jump.width = jumpLabelArt.width;
  jump.height = jumpLabelArt.height;
  flat.style.width = `${jumpLabelArt.width}px`;
  flat.style.height = `${jumpLabelArt.height}px`;
  flat.append(jump);
}

function mountStep(note: ChartNote, warped: HTMLElement, flat: HTMLElement): void {
  const stepUrl = note.foot === "left" ? leftStepUrl : rightStepUrl;
  const letterId = note.foot === "left" ? "L" : "R";
  const stepHeight = note.foot === "left" ? 53 : 54;

  const pad = document.createElement("object");
  pad.data = stepUrl;
  pad.type = "image/svg+xml";
  pad.width = String(noteArt.STEP.width);
  pad.height = String(stepHeight);
  pad.addEventListener("load", () => {
    const doc = pad.contentDocument!;
    (doc.querySelector("svg > rect") as SVGElement).style.display = "none";
    doc.getElementById(letterId)!.style.display = "none";
    doc.getElementById("Rectangle 4")!.animate(
      [{ transform: "translateY(0)" }, { transform: "translateY(-175px)" }],
      { duration: 500, iterations: Infinity },
    );
  });
  warped.style.width = `${noteArt.STEP.width}px`;
  warped.style.height = `${stepHeight}px`;
  warped.append(pad);

  const label = document.createElement("object");
  label.data = stepUrl;
  label.type = "image/svg+xml";
  label.width = String(noteArt.STEP.width);
  label.height = String(stepHeight);
  label.addEventListener("load", () => {
    const doc = label.contentDocument!;
    (doc.querySelector("svg > rect") as SVGElement).style.display = "none";
    doc.querySelector(`[id$=" base"]`)!.setAttribute("display", "none");
    doc.getElementById(letterId)!.style.display = "";
  });
  flat.style.width = `${noteArt.STEP.width}px`;
  flat.style.height = `${stepHeight}px`;
  flat.append(label);
}

const noteMount = {
  JUMP: (_note: ChartNote, warped: HTMLElement, flat: HTMLElement) => mountJump(warped, flat),
  STEP: mountStep,
} as const;

type Point = [number, number];

type NoteView = {
  container: Container;
  warped: HTMLElement;
  flat: HTMLElement;
  warpedWidth: number;
  warpedHeightRatio: number;
  flatWidth: number;
  flatHeight: number;
};

function flatTransform(centerX: number, bottomY: number, scale: number, width: number, height: number): string {
  return `translate(${centerX - (width * scale) / 2}px, ${bottomY - height * scale}px) scale(${scale})`;
}

function perspectiveMatrix3d(width: number, height: number, tl: Point, tr: Point, br: Point, bl: Point): string {
  const h = solveHomography(
    [[0, 0], [width, 0], [width, height], [0, height]],
    [tl, tr, br, bl],
  );
  const [a, b, c, d, e, f, g, h21] = h;
  return `matrix3d(${a},${d},0,${g},${b},${e},0,${h21},0,0,1,0,${c},${f},0,1)`;
}

function solveHomography(from: Point[], to: Point[]): number[] {
  const size = 8;
  const matrix = Array.from({ length: size }, () => Array<number>(size + 1).fill(0));
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i];
    const [u, v] = to[i];
    matrix[i * 2] = [x, y, 1, 0, 0, 0, -u * x, -u * y, u];
    matrix[i * 2 + 1] = [0, 0, 0, x, y, 1, -v * x, -v * y, v];
  }
  for (let col = 0; col < size; col++) {
    let pivot = col;
    for (let row = col + 1; row < size; row++) {
      if (Math.abs(matrix[row][col]) > Math.abs(matrix[pivot][col])) pivot = row;
    }
    [matrix[col], matrix[pivot]] = [matrix[pivot], matrix[col]];
    const div = matrix[col][col] || 1e-12;
    for (let j = col; j <= size; j++) matrix[col][j] /= div;
    for (let row = 0; row < size; row++) {
      if (row === col) continue;
      const factor = matrix[row][col];
      for (let j = col; j <= size; j++) matrix[row][j] -= factor * matrix[col][j];
    }
  }
  return matrix.map((row) => row[size]);
}

export class PixiPlayfield {
  private readonly app = new Application();
  private readonly noteViews = new Map<string, NoteView>();
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
        const edges = this.laneSpan(lane, lane, 1);
        marker.position.set((edges.left + edges.right) / 2 + (sameLane ? offset : 0), hitY + 3);
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
        view.container.visible = false;
        continue;
      }
      if (!running || judged(note.id)) {
        view.container.visible = false;
        continue;
      }
      const timeUntil = note.time - songTime;
      if (timeUntil > this.chart.playfield.travelTime || timeUntil < -0.2) {
        view.container.visible = false;
        continue;
      }

      const progress = Math.min(1, Math.max(0, 1 - timeUntil / this.chart.playfield.travelTime)) ** 1.65;
      const [startLane, endLane] = this.noteSpan(note);
      const bottom = this.laneSpan(startLane, endLane, progress);
      const topY = bottom.y - bottom.width * view.warpedHeightRatio;
      const top = this.laneSpan(startLane, endLane, this.progressAtY(topY));
      view.warped.style.transform = perspectiveMatrix3d(
        view.warpedWidth,
        view.warpedWidth * view.warpedHeightRatio,
        [top.left, topY],
        [top.right, topY],
        [bottom.right, bottom.y],
        [bottom.left, bottom.y],
      );
      const scale = bottom.width / view.warpedWidth;
      view.flat.style.transform = flatTransform(
        (bottom.left + bottom.right) / 2,
        bottom.y,
        scale,
        view.flatWidth,
        view.flatHeight,
      );
      view.container.visible = true;
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
    const { lanes } = this.chart.playfield;
    for (let lane = 1; lane <= lanes; lane++) this.drawLane(highway, lane, laneColors[lane - 1], 0.06);
    for (let boundary = 0; boundary <= lanes; boundary++) {
      const farX = farLeft + (farRight - farLeft) * boundary / lanes;
      const nearX = nearLeft + (nearRight - nearLeft) * boundary / lanes;
      highway.moveTo(farX, horizonY).lineTo(nearX, hitY).stroke({ color: 0xffffff, alpha: 0.38, width: 2 });
    }
    for (let depth = 0.14; depth < 1; depth += 0.14) {
      const span = this.laneSpan(1, lanes, depth);
      const y = horizonY + (hitY - horizonY) * depth;
      highway.moveTo(span.left, y).lineTo(span.right, y).stroke({ color: 0xffffff, alpha: 0.16, width: 2 });
    }
    this.app.stage.addChild(highway);

    const stepZone = new PerspectiveMesh({ texture: Texture.from(footBaseUrl), verticesX: 10, verticesY: 2 });
    const stepTop = hitY - 32;
    const stepBottom = hitY + 60;
    const top = this.laneSpan(1, lanes, this.progressAtY(stepTop));
    const bottom = this.laneSpan(1, lanes, this.progressAtY(stepBottom));
    stepZone.setCorners(top.left, stepTop, top.right, stepTop, bottom.right, stepBottom, bottom.left, stepBottom);
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
      element.width = slideArt.width;
      element.height = slideArt.height;
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
      this.app.stage.addChild(view.container);
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

  private createNoteView(note: ChartNote): NoteView {
    const kind = note.type === "JUMP" ? "JUMP" : "STEP";
    const root = document.createElement("div");
    root.style.cssText = "position:absolute;top:0;left:0;pointer-events:none";
    const warped = document.createElement("div");
    warped.style.cssText = "position:absolute;top:0;left:0;transform-origin:0 0;pointer-events:none";
    const flat = document.createElement("div");
    flat.style.cssText = "position:absolute;top:0;left:0;transform-origin:0 0;pointer-events:none";
    noteMount[kind](note, warped, flat);
    root.append(warped, flat);
    const container = new Container();
    container.addChild(new DOMContainer({ element: root, anchor: 0 }));
    container.visible = false;
    const stepHeight = note.foot === "left" ? 53 : 54;
    if (kind === "JUMP") {
      return {
        container,
        warped,
        flat,
        warpedWidth: noteArt.JUMP.width,
        warpedHeightRatio: jumpBaseHeight / noteArt.JUMP.width,
        flatWidth: jumpLabelArt.width,
        flatHeight: jumpLabelArt.height,
      };
    }
    return {
      container,
      warped,
      flat,
      warpedWidth: noteArt.STEP.width,
      warpedHeightRatio: stepHeight / noteArt.STEP.width,
      flatWidth: noteArt.STEP.width,
      flatHeight: stepHeight,
    };
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

      const points = pathNotes.map((point) => {
        const progress = Math.min(1, Math.max(0, 1 - (point.time - songTime) / this.chart.playfield.travelTime)) ** 1.65;
        const layout = this.laneSpan(point.lane, point.lane, progress);
        return {
          x: (layout.left + layout.right) / 2,
          y: layout.y,
          halfWidth: layout.width * slideArt.laneRatio,
        };
      });
      if (points.length < 2) continue;

      const start = points[0];
      const end = points[points.length - 1];
      path.position.set(start.x, start.y);
      path.rotation = Math.atan2(end.y - start.y, end.x - start.x) + Math.PI / 2;
      path.scale.set((start.halfWidth + end.halfWidth) / slideArt.width, Math.hypot(end.x - start.x, end.y - start.y) / slideArt.height);
      path.visible = true;
    }
  }

  private progressAtY(y: number): number {
    return (y - horizonY) / (hitY - horizonY);
  }

  private noteSpan(note: ChartNote): [number, number] {
    const { lanes } = this.chart.playfield;
    if (note.type === "JUMP") return [1, lanes];
    const lane = note.lane ?? (lanes + 1) / 2;
    return [lane, lane];
  }

  private laneSpan(startLane: number, endLane: number, progress: number): { left: number; right: number; y: number; width: number } {
    const playLeft = farLeft + (nearLeft - farLeft) * progress;
    const playRight = farRight + (nearRight - farRight) * progress;
    const laneWidth = (playRight - playLeft) / this.chart.playfield.lanes;
    const left = playLeft + laneWidth * (startLane - 1);
    const right = playLeft + laneWidth * endLane;
    const y = horizonY + (hitY - horizonY) * progress;
    return { left, right, y, width: right - left };
  }

  private drawLane(graphics: Graphics, lane: number, color: number, alpha: number): void {
    const far = this.laneSpan(lane, lane, 0);
    const near = this.laneSpan(lane, lane, 1);
    graphics.poly([far.left, horizonY, far.right, horizonY, near.right, hitY, near.left, hitY], true).fill({ color, alpha });
  }
}
