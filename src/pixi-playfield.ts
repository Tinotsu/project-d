import {
  Application,
  Assets,
  Container,
  DOMContainer,
  Graphics,
  PerspectiveMesh,
  Text,
  Texture,
} from "pixi.js";
import footBaseUrl from "../assets/foot base.svg?url";
import footUrl from "../assets/foot.svg?url";
import jumpBaseUrl from "../assets/jump base.svg?url";
import jumpUrl from "../assets/jump.svg?url";
import leftStepUrl from "../assets/left base.svg?url";
import trackUrl from "../assets/pist.svg?url";
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

const noteArt = {
  JUMP: { width: 630, height: 130 },
  STEP: { width: 152, height: 102 },
} as const;

const footZoneArt = { width: 606, height: 104, depth: 1 };
const footMarkerScale = 0.55;

const assetUrls = [trackUrl];

const jumpLabelArt = { width: 600, height: 200 };

function mountJump(warped: HTMLElement, flat: HTMLElement): void {
  const base = document.createElement("img");
  base.src = jumpBaseUrl;
  base.width = noteArt.JUMP.width;
  base.height = noteArt.JUMP.height;
  warped.style.width = `${noteArt.JUMP.width}px`;
  warped.style.height = `${noteArt.JUMP.height}px`;
  warped.append(base);

  const jump = document.createElement("img");
  jump.src = jumpUrl;
  jump.width = jumpLabelArt.width;
  jump.height = jumpLabelArt.height;
  flat.style.width = `${jumpLabelArt.width}px`;
  flat.style.height = `${jumpLabelArt.height}px`;
  flat.append(jump);
}

function mountStep(note: ChartNote, warped: HTMLElement): void {
  const stepUrl = note.foot === "left" ? leftStepUrl : rightStepUrl;

  const pad = document.createElement("object");
  pad.data = stepUrl;
  pad.type = "image/svg+xml";
  pad.width = String(noteArt.STEP.width);
  pad.height = String(noteArt.STEP.height);
  pad.addEventListener("load", () => {
    const doc = pad.contentDocument!;
    doc.documentElement.querySelectorAll(":scope > g").forEach((group, index) => {
      if (index > 0) (group as SVGElement).style.display = "none";
    });
  });
  warped.style.width = `${noteArt.STEP.width}px`;
  warped.style.height = `${noteArt.STEP.height}px`;
  warped.append(pad);
}

type Point = [number, number];

type WarpedView = {
  warped: HTMLElement;
  warpedWidth: number;
  warpedHeight: number;
};

type NoteView = WarpedView & {
  container: Container;
  flat: HTMLElement;
  flatWidth: number;
  flatHeight: number;
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
      fill: 0xffffff,
      fontFamily: "Space Grotesk",
      fontSize: 42,
      fontWeight: "700",
    },
  });
  private leftFootMarker!: HTMLImageElement;
  private rightFootMarker!: HTMLImageElement;
  private footZoneRoot?: HTMLDivElement;
  private footZoneResizeObserver?: ResizeObserver;
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
      marker.hidden = lane === null;
      if (lane !== null) {
        const baseBottom = this.laneSpan(1, this.chart.playfield.lanes, footZoneArt.depth);
        const markerY = baseBottom.y - baseBottom.width * footZoneArt.height / footZoneArt.width / 2;
        const markerDepth = (markerY - horizonY) / (hitY - horizonY);
        const edges = this.laneSpan(lane, lane, markerDepth);
        marker.style.left = `${(edges.left + edges.right) / 2 + (sameLane ? offset : 0)}px`;
        marker.style.top = `${markerY}px`;
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
    for (const note of this.chart.notes) {
      const view = this.noteViews.get(note.id)!;
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
      const bottom = this.placeWarpedView(view, startLane, endLane, progress);
      const scale = bottom.width / view.warpedWidth;
      const centerX = (bottom.left + bottom.right) / 2;
      view.flat.style.transform = `translate(${centerX - (view.flatWidth * scale) / 2}px, ${bottom.y - view.flatHeight * scale}px) scale(${scale})`;
      view.container.visible = true;
    }

    this.laneGlow.clear();
    this.laneGlowUntil.forEach((until, index) => {
      if (performance.now() < until) this.drawLane(this.laneGlow, index + 1, laneColors[index], 0.35);
    });
    const pulse = 1 + Math.sin(performance.now() / 90) * 0.04;
    this.leftFootMarker.style.transform = `translate(-50%, -50%) scale(${footMarkerScale * pulse})`;
    this.rightFootMarker.style.transform = `translate(-50%, -50%) scale(${-footMarkerScale * pulse}, ${footMarkerScale * pulse})`;
    if (this.feedback.visible && performance.now() > this.feedbackUntil) {
      this.feedback.visible = false;
      this.feedbackLabel.visible = false;
    }
  }

  destroy(): void {
    this.footZoneResizeObserver?.disconnect();
    this.footZoneRoot?.remove();
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

    const footZoneRoot = document.createElement("div");
    footZoneRoot.style.cssText = `position:absolute;top:0;left:0;z-index:1;width:${gameWidth}px;height:${gameHeight}px;transform-origin:0 0;pointer-events:none`;
    const sizeFootZone = () => {
      footZoneRoot.style.scale = `${mount.clientWidth / gameWidth} ${mount.clientHeight / gameHeight}`;
    };
    sizeFootZone();
    this.footZoneResizeObserver = new ResizeObserver(sizeFootZone);
    this.footZoneResizeObserver.observe(mount);
    this.footZoneRoot = footZoneRoot;
    const footZone = document.createElement("img");
    footZone.src = footBaseUrl;
    footZone.width = footZoneArt.width;
    footZone.height = footZoneArt.height;
    footZone.style.cssText = "position:absolute;top:0;left:0;transform-origin:0 0;pointer-events:none";
    footZoneRoot.append(footZone);
    this.placeWarpedView(
      { warped: footZone, warpedWidth: footZoneArt.width, warpedHeight: footZoneArt.height },
      1,
      lanes,
      footZoneArt.depth,
    );
    mount.append(footZoneRoot);

    for (const note of this.chart.notes) {
      const view = this.createNoteView(note);
      this.noteViews.set(note.id, view);
      this.app.stage.addChild(view.container);
    }

    this.leftFootMarker = this.createFootMarker(false);
    this.rightFootMarker = this.createFootMarker(true);
    footZoneRoot.append(this.leftFootMarker, this.rightFootMarker);
    this.app.stage.addChild(this.laneGlow);
    this.feedback.visible = false;
    this.feedbackLabel.anchor.set(0.5);
    this.feedbackLabel.position.set(gameWidth / 2, 316);
    this.feedbackLabel.visible = false;
    this.app.stage.addChild(this.feedback, this.feedbackLabel);
  }

  private createNoteView(note: ChartNote): NoteView {
    const isJump = note.type === "JUMP";
    const root = document.createElement("div");
    root.style.cssText = "position:absolute;top:0;left:0;pointer-events:none";
    const warped = document.createElement("div");
    warped.style.cssText = "position:absolute;top:0;left:0;transform-origin:0 0;pointer-events:none";
    const flat = document.createElement("div");
    flat.style.cssText = "position:absolute;top:0;left:0;transform-origin:0 0;pointer-events:none";
    if (isJump) mountJump(warped, flat);
    else mountStep(note, warped);
    root.append(warped, flat);
    const container = new Container();
    container.addChild(new DOMContainer({ element: root, anchor: 0 }));
    container.visible = false;
    if (isJump) {
      return {
        container,
        warped,
        flat,
        warpedWidth: noteArt.JUMP.width,
        warpedHeight: noteArt.JUMP.height,
        flatWidth: jumpLabelArt.width,
        flatHeight: jumpLabelArt.height,
      };
    }
    return {
      container,
      warped,
      flat,
      warpedWidth: noteArt.STEP.width,
      warpedHeight: noteArt.STEP.height,
      flatWidth: noteArt.STEP.width,
      flatHeight: noteArt.STEP.height,
    };
  }

  private createFootMarker(mirrored: boolean): HTMLImageElement {
    const marker = document.createElement("img");
    marker.src = footUrl;
    marker.width = 100;
    marker.height = 104;
    marker.hidden = true;
    marker.style.cssText = `position:absolute;top:0;left:0;transform:translate(-50%, -50%) scale(${mirrored ? -footMarkerScale : footMarkerScale}, ${footMarkerScale});pointer-events:none`;
    return marker;
  }

  private placeWarpedView(
    view: WarpedView,
    startLane: number,
    endLane: number,
    progress: number,
  ): ReturnType<typeof this.laneSpan> {
    const bottom = this.laneSpan(startLane, endLane, progress);
    const topY = bottom.y - bottom.width * view.warpedHeight / view.warpedWidth;
    const top = this.laneSpan(startLane, endLane, (topY - horizonY) / (hitY - horizonY));
    view.warped.style.transform = perspectiveMatrix3d(
      view.warpedWidth,
      view.warpedHeight,
      [top.left, topY],
      [top.right, topY],
      [bottom.right, bottom.y],
      [bottom.left, bottom.y],
    );
    return bottom;
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
