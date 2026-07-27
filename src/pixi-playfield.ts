import {
  Application,
  Container,
  DOMContainer,
  Graphics,
  Text,
} from "pixi.js";
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
  isSustainedNote,
  slideBounds,
  stepBounds,
  type ChartNote,
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
const laneColors = [0x00f300, 0x00f7fa, 0x9c45fa, 0xd52ba2];
const floorDepthScale = 1 / 3;

export function noteTravelProgress(timeUntil: number, travelTime: number): number {
  return Math.max(0, 1 - timeUntil / travelTime) ** 1.65;
}

function mountJump(warped: HTMLElement, flat: HTMLElement): void {
  const base = document.createElement("img");
  base.src = jumpBaseUrl;
  warped.append(base);

  const jump = document.createElement("img");
  jump.src = jumpUrl;
  flat.append(jump);
}

function mountStep(note: ChartNote, warped: HTMLElement): void {
  const pad = document.createElement("img");
  pad.src = note.foot === "left" ? leftStepUrl : rightStepUrl;
  warped.append(pad);
}

function mountSlide(note: ChartNote, warped: HTMLElement): void {
  const slide = document.createElement("img");
  slide.src = note.foot === "left" ? leftSlideUrl : rightSlideUrl;
  slide.style.cssText = note.endLane! < note.lane!
    ? "display:block;transform:translateY(200px) rotate(-90deg);transform-origin:0 0"
    : "display:block;transform:translateX(300px) rotate(90deg);transform-origin:0 0";
  warped.style.width = "300px";
  warped.style.height = "200px";
  warped.append(slide);
}

function mountStay(note: ChartNote, warped: HTMLElement): void {
  const stay = document.createElement("img");
  stay.src = note.foot === "left" ? leftStayUrl : rightStayUrl;
  warped.append(stay);
}

function mountHorizontalSlide(note: ChartNote, warped: HTMLElement): void {
  const slide = document.createElement("img");
  slide.src = note.foot === "left" ? horizontalLeftSlideUrl : horizontalRightSlideUrl;
  warped.append(slide);
}

type Point = [number, number];

type WarpedView = {
  warped: HTMLElement;
};

type NoteView = WarpedView & {
  container: Container;
  flat: HTMLElement;
};

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
  private readonly laneGlow = new Graphics();
  private readonly laneGlowUntil = [0, 0, 0, 0];
  private readonly feedback = new Graphics();
  private readonly feedbackLabel = new Text({
    text: "",
    style: {
      fill: 0xf9f9f9,
      fontFamily: "Space Grotesk",
      fontSize: 42,
      fontWeight: "700",
    },
  });
  private leftFootMarker!: HTMLImageElement;
  private rightFootMarker!: HTMLImageElement;
  private footBase!: HTMLImageElement;
  private trackRoot?: HTMLDivElement;
  private footZoneRoot?: HTMLDivElement;
  private assetResizeObserver?: ResizeObserver;
  private feedbackUntil = 0;

  private constructor(private readonly chart: LevelChart) {}

  static async create(mount: HTMLElement, chart: LevelChart): Promise<PixiPlayfield> {
    const playfield = new PixiPlayfield(chart);
    await playfield.init(mount);
    return playfield;
  }

  showTrackedFeet(leftPosition: { x: number } | null, rightPosition: { x: number } | null): void {
    const bottom = this.laneSpan(1, this.chart.playfield.lanes, 1);
    for (const [marker, position, mirrored] of [
      [this.leftFootMarker, leftPosition, false],
      [this.rightFootMarker, rightPosition, true],
    ] as const) {
      marker.hidden = position === null;
      if (position) {
        const topY = hitY - bottom.width * this.footBase.naturalHeight / this.footBase.naturalWidth * floorDepthScale;
        const top = this.laneSpan(1, this.chart.playfield.lanes, (topY - horizonY) / (hitY - horizonY));
        const bottomCenter = bottom.left + bottom.width * position.x;
        const topCenter = top.left + top.width * position.x;
        const bottomWidth = marker.naturalWidth * bottom.width / this.footBase.naturalWidth;
        const topWidth = marker.naturalWidth * top.width / this.footBase.naturalWidth;
        const corners: [Point, Point, Point, Point] = [
          [topCenter - topWidth / 2, topY],
          [topCenter + topWidth / 2, topY],
          [bottomCenter + bottomWidth / 2, hitY],
          [bottomCenter - bottomWidth / 2, hitY],
        ];
        const [tl, tr, br, bl] = mirrored
          ? [corners[1], corners[0], corners[3], corners[2]]
          : corners;
        marker.style.transform = perspectiveMatrix3d(marker.naturalWidth, marker.naturalHeight, tl, tr, br, bl);
      }
    }
  }

  showResult(result: JudgementResult): void {
    this.feedback.clear();
    const color = result.judgement === "perfect" ? 0x00f300 : result.judgement === "great" ? 0x00f7fa : result.judgement === "good" ? 0xfaf600 : 0xfc2500;
    this.feedback
      .roundRect(gameWidth / 2 - 145, 275, 290, 82, 18)
      .fill({ color: 0x000000, alpha: 0.82 })
      .stroke({ color, width: 5 });
    this.feedbackLabel.text = result.judgement.toUpperCase();
    this.feedbackLabel.visible = true;
    this.feedback.visible = true;
    this.feedbackUntil = performance.now() + 380;
    const lanes = result.note.type === "SLIDE" || result.note.type === "HORIZONTAL_SLIDE"
      ? Array.from(
        { length: Math.abs(result.note.endLane! - result.note.lane!) + 1 },
        (_, index) => Math.min(result.note.lane!, result.note.endLane!) + index,
      )
      : result.note.lane ? [result.note.lane] : [1, 2, 3, 4];
    lanes.forEach((lane) => this.laneGlowUntil[lane - 1] = performance.now() + 180);
  }

  render(songTime: number, running: boolean, hidden: (noteId: string) => boolean): void {
    for (const note of this.chart.notes) {
      const view = this.noteViews.get(note.id)!;
      if (!running || hidden(note.id)) {
        view.container.visible = false;
        continue;
      }
      if (isSustainedNote(note)) {
        const timeUntil = note.time - songTime;
        const endTimeUntil = note.time + (note.duration ?? 1) - songTime;
        const startProgress = noteTravelProgress(timeUntil, this.chart.playfield.travelTime);
        const endProgress = noteTravelProgress(endTimeUntil, this.chart.playfield.travelTime);
        if (
          timeUntil > this.chart.playfield.travelTime
          || endTimeUntil < -this.chart.playfield.travelTime
        ) {
          view.container.visible = false;
          continue;
        }

        view.container.visible = true;
        if (view.warped.offsetWidth && view.warped.offsetHeight) {
          const progress = Math.min(1, Math.max(0, (songTime - note.time) / (note.duration ?? 1)));
          const startLane = note.type === "HORIZONTAL_SLIDE"
            ? note.lane! + (note.endLane! - note.lane!) * progress
            : note.lane!;
          const position = this.placeSustainedView(
            view,
            startLane,
            note.type === "HORIZONTAL_SLIDE" ? note.endLane! : startLane,
            endProgress,
            startProgress,
          );
          view.container.visible = Math.min(position.topY, position.bottomY) < gameHeight;
        }
        continue;
      }
      const timeUntil = note.time - songTime;
      const progress = noteTravelProgress(timeUntil, this.chart.playfield.travelTime);
      if (
        timeUntil > this.chart.playfield.travelTime
        || timeUntil < -this.chart.playfield.travelTime
      ) {
        view.container.visible = false;
        continue;
      }

      view.container.visible = true;
      if (!view.warped.offsetWidth || !view.warped.offsetHeight) continue;
      const [startLane, endLane] = this.noteSpan(note);
      const bottom = this.placeWarpedView(view, startLane, endLane, progress);
      const scale = this.laneSpan(startLane, endLane, Math.min(1, progress)).width / view.warped.offsetWidth;
      const centerX = (bottom.left + bottom.right) / 2;
      view.flat.style.transform = `translate(${centerX - (view.flat.offsetWidth * scale) / 2}px, ${bottom.y - view.flat.offsetHeight * scale}px) scale(${scale})`;
      const flatTop = view.flat.offsetHeight ? bottom.y - view.flat.offsetHeight * scale : bottom.topY;
      view.container.visible = Math.min(bottom.topY, flatTop) < gameHeight;
    }

    this.laneGlow.clear();
    this.laneGlowUntil.forEach((until, index) => {
      if (performance.now() < until) this.drawLane(this.laneGlow, index + 1, laneColors[index], 0.35);
    });
    const pulse = 1 + Math.sin(performance.now() / 90) * 0.04;
    if (this.feedback.visible && performance.now() > this.feedbackUntil) {
      this.feedback.visible = false;
      this.feedbackLabel.visible = false;
    }
  }

  destroy(): void {
    this.assetResizeObserver?.disconnect();
    this.trackRoot?.remove();
    this.footZoneRoot?.remove();
    this.app.destroy({ removeView: true }, { children: true, texture: false });
  }

  private async init(mount: HTMLElement): Promise<void> {
    await this.app.init({
      width: gameWidth,
      height: gameHeight,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio, 2),
      backgroundAlpha: 0,
      preference: "webgl",
    });
    this.app.canvas.setAttribute("aria-label", "Four-lane rhythm game playfield");
    mount.append(this.app.canvas);

    const trackRoot = document.createElement("div");
    trackRoot.style.cssText = `position:absolute;top:0;left:0;z-index:0;width:${gameWidth}px;height:${gameHeight}px;transform-origin:0 0;pointer-events:none`;
    this.trackRoot = trackRoot;
    const track = document.createElement("img");
    track.src = trackUrl;
    track.style.cssText = "position:absolute;top:0;left:0;transform-origin:0 0;pointer-events:none";
    trackRoot.append(track);
    mount.insertBefore(trackRoot, this.app.canvas);
    await track.decode();
    track.style.transform = perspectiveMatrix3d(
      track.naturalWidth,
      track.naturalHeight,
      [farLeft, horizonY],
      [farRight, horizonY],
      [1400, gameHeight],
      [-120, gameHeight],
    );

    const { lanes } = this.chart.playfield;

    const footZoneRoot = document.createElement("div");
    footZoneRoot.style.cssText = `position:absolute;top:0;left:0;z-index:1;width:${gameWidth}px;height:${gameHeight}px;transform-origin:0 0;pointer-events:none`;
    const sizeFootZone = () => {
      const scale = `${mount.clientWidth / gameWidth} ${mount.clientHeight / gameHeight}`;
      trackRoot.style.scale = scale;
      footZoneRoot.style.scale = scale;
    };
    sizeFootZone();
    this.assetResizeObserver = new ResizeObserver(sizeFootZone);
    this.assetResizeObserver.observe(mount);
    this.footZoneRoot = footZoneRoot;
    const footZone = document.createElement("img");
    footZone.src = footBaseUrl;
    footZone.style.cssText = "position:absolute;top:0;left:0;transform-origin:0 0;pointer-events:none";
    this.footBase = footZone;
    footZoneRoot.append(footZone);
    mount.append(footZoneRoot);
    await footZone.decode();
    this.placeWarpedView({ warped: footZone }, 1, lanes, 1);

    for (const note of this.chart.notes) {
      const view = this.createNoteView(note);
      this.noteViews.set(note.id, view);
      this.app.stage.addChild(view.container);
    }

    this.leftFootMarker = this.createFootMarker();
    this.rightFootMarker = this.createFootMarker();
    await Promise.all([this.leftFootMarker.decode(), this.rightFootMarker.decode()]);
    const footMarkerRoot = document.createElement("div");
    footMarkerRoot.style.cssText = "position:absolute;z-index:1;top:0;left:0;pointer-events:none";
    footMarkerRoot.append(this.leftFootMarker, this.rightFootMarker);
    this.app.stage.addChild(new DOMContainer({ element: footMarkerRoot, anchor: 0 }));
    this.app.stage.addChild(this.laneGlow);
    this.feedback.visible = false;
    this.feedbackLabel.anchor.set(0.5);
    this.feedbackLabel.position.set(gameWidth / 2, 316);
    this.feedbackLabel.visible = false;
    this.app.stage.addChild(this.feedback, this.feedbackLabel);
  }

  private createNoteView(note: ChartNote): NoteView {
    const root = document.createElement("div");
    root.style.cssText = "position:absolute;top:0;left:0;pointer-events:none";
    const warped = document.createElement("div");
    warped.style.cssText = "position:absolute;top:0;left:0;transform-origin:0 0;pointer-events:none";
    const flat = document.createElement("div");
    flat.style.cssText = "position:absolute;top:0;left:0;transform-origin:0 0;pointer-events:none";
    if (note.type === "JUMP") mountJump(warped, flat);
    else if (note.type === "SLIDE") mountSlide(note, warped);
    else if (note.type === "HORIZONTAL_SLIDE") mountHorizontalSlide(note, warped);
    else if (note.type === "STAY") mountStay(note, warped);
    else mountStep(note, warped);
    root.append(warped, flat);
    const container = new Container();
    container.addChild(new DOMContainer({ element: root, anchor: 0 }));
    container.visible = false;
    return { container, warped, flat };
  }

  private createFootMarker(): HTMLImageElement {
    const marker = document.createElement("img");
    marker.src = footUrl;
    marker.hidden = true;
    marker.style.cssText = "position:absolute;top:0;left:0;transform-origin:0 0;pointer-events:none";
    return marker;
  }

  private placeWarpedView(
    view: WarpedView,
    startLane: number,
    endLane: number,
    progress: number,
  ): ReturnType<typeof this.laneSpan> & { topY: number } {
    const bottom = this.laneSpan(startLane, endLane, progress);
    const topY = bottom.y - bottom.width * view.warped.offsetHeight / view.warped.offsetWidth * floorDepthScale;
    const top = this.laneSpan(startLane, endLane, (topY - horizonY) / (hitY - horizonY));
    view.warped.style.transform = perspectiveMatrix3d(
      view.warped.offsetWidth,
      view.warped.offsetHeight,
      [top.left, topY],
      [top.right, topY],
      [bottom.right, bottom.y],
      [bottom.left, bottom.y],
    );
    return { ...bottom, topY };
  }

  private placeSustainedView(
    view: WarpedView,
    startLane: number,
    endLane: number,
    endProgress: number,
    startProgress: number,
  ): { topY: number; bottomY: number } {
    const top = this.laneSpan(endLane, endLane, endProgress);
    const bottom = this.laneSpan(startLane, startLane, startProgress);
    view.warped.style.transform = perspectiveMatrix3d(
      view.warped.offsetWidth,
      view.warped.offsetHeight,
      [top.left, top.y],
      [top.right, top.y],
      [bottom.right, bottom.y],
      [bottom.left, bottom.y],
    );
    return { topY: top.y, bottomY: bottom.y };
  }

  private noteSpan(note: ChartNote): [number, number] {
    const { lanes } = this.chart.playfield;
    if (note.type === "JUMP") return [1, lanes];
    if (note.type === "SLIDE") {
      const bounds = slideBounds(note);
      return [bounds.left + 1, bounds.right];
    }
    if (note.type === "STEP" || note.type === "STAY") {
      const bounds = stepBounds(note);
      return [bounds.left + 1, bounds.right];
    }
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
