import { Application, Container, Graphics, Text } from "pixi.js";
import {
  calibrateFloor,
  floorLane,
  projectFloorPoint,
  projectFoot,
  type Homography,
  type Point,
} from "./floor.ts";
import {
  FootPoseDetector,
  InputActionState,
  JumpDetector,
  type InputAction,
  type Keypoint,
} from "./foot-pose.ts";
import {
  RhythmEngine,
  type ChartNote,
  type Foot,
  type JudgementResult,
  type NoteType,
} from "./rhythm-engine.ts";
import "./game.css";

type SongMetadata = {
  version: number;
  id: string;
  title: string;
  audio: string;
  duration: number;
};

type LevelChart = {
  version: number;
  song: string;
  level: { id: string; difficulty: string; rating: number; speed: number; endTime: number };
  timing: { bpm: number; offset: number };
  playfield: { lanes: number; travelTime: number };
  notes: ChartNote[];
  visualEffects: { hitBurst: boolean; laneGlow: boolean };
};

const width = 1100;
const height = 660;
const farLeft = 410;
const farRight = 690;
const nearLeft = 90;
const nearRight = 1010;
const horizonY = 70;
const hitY = 540;
const laneColors = [0x35dcff, 0x6c82ff, 0xff4fa2, 0xff9b45];
const cornerNames = ["A · FAR LEFT", "B · FAR RIGHT", "C · NEAR RIGHT", "D · NEAR LEFT"];
const footColors = { left: "#35dcff", right: "#ff4fa2" };

const stageElement = document.querySelector<HTMLElement>("#game-stage")!;
const overlay = document.querySelector<HTMLElement>("#game-overlay")!;
const overlayTitle = document.querySelector<HTMLElement>("#overlay-title")!;
const overlayCopy = document.querySelector<HTMLElement>("#overlay-copy")!;
const playButton = document.querySelector<HTMLButtonElement>("#play")!;
const songTitle = document.querySelector<HTMLElement>("#song-title")!;
const scoreElement = document.querySelector<HTMLElement>("#score")!;
const comboElement = document.querySelector<HTMLElement>("#combo")!;
const timeElement = document.querySelector<HTMLElement>("#song-time")!;
const judgementsElement = document.querySelector<HTMLElement>("#judgements")!;
const cameraVideo = document.querySelector<HTMLVideoElement>("#camera")!;
const cameraCanvas = document.querySelector<HTMLCanvasElement>("#camera-overlay")!;
const cameraContext = cameraCanvas.getContext("2d")!;
const cameraEmpty = document.querySelector<HTMLElement>("#camera-empty")!;
const cameraStatus = document.querySelector<HTMLElement>("#camera-status")!;
const cameraHint = document.querySelector<HTMLElement>("#camera-hint")!;
const cornerPrompt = document.querySelector<HTMLElement>("#corner-prompt")!;
const startCameraButton = document.querySelector<HTMLButtonElement>("#start-camera")!;
const recalibrateButton = document.querySelector<HTMLButtonElement>("#recalibrate")!;
const cameraEventLog = document.querySelector<HTMLElement>("#camera-event-log")!;
const resetCameraEventsButton = document.querySelector<HTMLButtonElement>("#reset-camera-events")!;

const chartResponse = await fetch("/levels/second-heaven/test.json");
if (!chartResponse.ok) throw new Error("Could not load the test chart");
const chart = await chartResponse.json() as LevelChart;
const songResponse = await fetch(chart.song);
if (!songResponse.ok) throw new Error("Could not load the song metadata");
const song = await songResponse.json() as SongMetadata;
const audioResponse = await fetch(song.audio);
if (!audioResponse.ok) throw new Error("Could not load the music file");
const audioData = await audioResponse.arrayBuffer();

songTitle.textContent = song.title;

const app = new Application();
await app.init({
  width,
  height,
  antialias: true,
  autoDensity: true,
  resolution: Math.min(window.devicePixelRatio, 2),
  backgroundAlpha: 0,
});
app.canvas.setAttribute("aria-label", "Four-lane rhythm game playfield");
stageElement.prepend(app.canvas);

function laneEdges(lane: number, progress: number): [number, number] {
  const left = farLeft + (nearLeft - farLeft) * progress;
  const right = farRight + (nearRight - farRight) * progress;
  const laneWidth = (right - left) / chart.playfield.lanes;
  return [left + laneWidth * (lane - 1), left + laneWidth * lane];
}

function drawLane(graphics: Graphics, lane: number, color: number, alpha: number): void {
  const far = laneEdges(lane, 0);
  const near = laneEdges(lane, 1);
  graphics.poly([far[0], horizonY, far[1], horizonY, near[1], hitY, near[0], hitY], true).fill({ color, alpha });
}

const highway = new Graphics();
for (let lane = 1; lane <= chart.playfield.lanes; lane++) drawLane(highway, lane, laneColors[lane - 1], 0.11);
for (let boundary = 0; boundary <= chart.playfield.lanes; boundary++) {
  const farX = farLeft + (farRight - farLeft) * boundary / chart.playfield.lanes;
  const nearX = nearLeft + (nearRight - nearLeft) * boundary / chart.playfield.lanes;
  highway.moveTo(farX, horizonY).lineTo(nearX, hitY).stroke({ color: 0xffffff, alpha: 0.35, width: 2 });
}
highway.moveTo(nearLeft, hitY).lineTo(nearRight, hitY).stroke({ color: 0xffe640, width: 8 });
app.stage.addChild(highway);

const stepZone = new Graphics()
  .roundRect(nearLeft - 18, hitY - 36, nearRight - nearLeft + 36, 78, 10)
  .fill({ color: 0x090a0f, alpha: 0.92 })
  .stroke({ color: 0xffffff, alpha: 0.65, width: 3 });
for (let lane = 1; lane <= chart.playfield.lanes; lane++) {
  const edges = laneEdges(lane, 1);
  stepZone.rect(edges[0], hitY - 34, edges[1] - edges[0], 74).fill({ color: laneColors[lane - 1], alpha: 0.1 });
  if (lane > 1) stepZone.moveTo(edges[0], hitY - 34).lineTo(edges[0], hitY + 40).stroke({ color: 0xffffff, alpha: 0.18, width: 2 });
}
stepZone.moveTo(nearLeft - 18, hitY).lineTo(nearRight + 18, hitY).stroke({ color: 0xffe640, alpha: 0.85, width: 3 });
app.stage.addChild(stepZone);

const slideGroups = new Map<string, ChartNote[]>();
for (const note of chart.notes) {
  if (!note.slide) continue;
  const group = slideGroups.get(note.slide) ?? [];
  group.push(note);
  slideGroups.set(note.slide, group);
}
const slidePaths = new Map<string, Graphics>();
for (const slide of slideGroups.keys()) {
  const path = new Graphics();
  slidePaths.set(slide, path);
  app.stage.addChild(path);
}

function createFootMarker(side: "left" | "right"): Container {
  const marker = new Container();
  const halo = new Graphics()
    .circle(0, 0, 32)
    .fill({ color: 0xff8a00, alpha: 0.2 })
    .stroke({ color: 0xff9c18, alpha: 0.9, width: 3 });
  const foot = new Graphics()
    .ellipse(0, 8, 11, 21)
    .circle(-9, -16, 4)
    .circle(-4, -20, 4.5)
    .circle(2, -22, 4.5)
    .circle(8, -21, 4)
    .fill(0xff9c18);
  foot.rotation = side === "left" ? -0.2 : 0.2;
  marker.addChild(halo, foot);
  marker.visible = false;
  app.stage.addChild(marker);
  return marker;
}

const leftFootMarker = createFootMarker("left");
const rightFootMarker = createFootMarker("right");

function showTrackedFeet(leftLane: number | null, rightLane: number | null): void {
  const sameLane = leftLane !== null && leftLane === rightLane;
  for (const [marker, lane, offset] of [
    [leftFootMarker, leftLane, -30],
    [rightFootMarker, rightLane, 30],
  ] as const) {
    marker.visible = lane !== null;
    if (lane !== null) {
      const edges = laneEdges(lane, 1);
      marker.position.set((edges[0] + edges[1]) / 2 + (sameLane ? offset : 0), hitY + 3);
    }
  }
}

const laneGlow = new Graphics();
app.stage.addChild(laneGlow);
const laneGlowUntil = [0, 0, 0, 0];

const noteViews = new Map<string, Container>();
for (const note of chart.notes) {
  const view = new Container();
  const noteWidth = note.type === "JUMP" ? 480 : 120;
  const isSlide = note.type === "SLIDE_LEFT" || note.type === "SLIDE_RIGHT";
  const body = new Graphics()
    .roundRect(-noteWidth / 2, -13, noteWidth, 26, 8)
    .fill(note.type === "JUMP" ? 0xffe640 : isSlide ? 0xff9c18 : note.foot === "left" ? 0x35dcff : 0xff4fa2)
    .stroke({ color: 0xffffff, alpha: 0.8, width: 2 });
  const label = new Text({
    text: note.type === "JUMP" ? "JUMP" : note.type === "SLIDE_LEFT" ? "←" : note.type === "SLIDE_RIGHT" ? "→" : note.foot === "left" ? "L" : "R",
    style: { fill: 0x08090d, fontFamily: "DM Mono", fontSize: 15, fontWeight: "700" },
  });
  label.anchor.set(0.5);
  view.addChild(body, label);
  view.visible = false;
  noteViews.set(note.id, view);
  app.stage.addChild(view);
}

const feedback = new Text({
  text: "",
  style: {
    fill: 0xffffff,
    fontFamily: "Space Grotesk",
    fontSize: 62,
    fontWeight: "700",
    stroke: { color: 0x08090d, width: 7 },
  },
});
feedback.anchor.set(0.5);
feedback.position.set(width / 2, 310);
feedback.visible = false;
app.stage.addChild(feedback);
let feedbackUntil = 0;

let engine = new RhythmEngine(chart.notes);
let audioContext: AudioContext | undefined;
let audioBuffer: AudioBuffer | undefined;
let source: AudioBufferSourceNode | undefined;
let startedAt = 0;
let running = false;
let poseDetector: FootPoseDetector;
let cameraFrame = 0;
let lastVideoTime = -1;
let floorTransform: Homography | undefined;
let corners: Point[] = [];
let smoothedFeet: Partial<Record<"left" | "right", [Point, Point, Point]>> = {};
const lastFootTime = { left: 0, right: 0 };
const jumpDetector = new JumpDetector();
const inputActions = new InputActionState();

function currentSongTime(): number {
  const elapsed = audioContext && startedAt ? audioContext.currentTime - startedAt : 0;
  return Math.min(chart.level.endTime, Math.max(0, elapsed));
}

function showResult(result: JudgementResult): void {
  feedback.text = result.judgement.toUpperCase();
  feedback.visible = true;
  feedbackUntil = performance.now() + 380;
  const lanes = result.note.lane ? [result.note.lane] : [1, 2, 3, 4];
  lanes.forEach((lane) => laneGlowUntil[lane - 1] = performance.now() + 180);
  scoreElement.textContent = engine.score.total.toString().padStart(6, "0");
  comboElement.textContent = engine.score.combo.toString();
  judgementsElement.textContent = `Perfect ${engine.score.perfect} · Great ${engine.score.great} · Good ${engine.score.good} · Miss ${engine.score.miss}`;
}

function submitPlayerEvent(type: NoteType, foot: Foot, lane?: number): void {
  if (!running) return;
  const result = engine.submit({ time: currentSongTime(), type, lane, foot });
  if (result) showResult(result);
}

function setCameraStatus(message: string, active = false): void {
  cameraStatus.textContent = message;
  cameraStatus.parentElement!.classList.toggle("active", active);
}

function beginCalibration(): void {
  corners = [];
  floorTransform = undefined;
  smoothedFeet = {};
  jumpDetector.reset();
  inputActions.reset();
  showTrackedFeet(null, null);
  cameraCanvas.classList.add("calibrating");
  recalibrateButton.disabled = true;
  cornerPrompt.hidden = false;
  cornerPrompt.textContent = `CLICK ${cornerNames[0]}`;
  cameraHint.textContent = "Click the far-left corner of your play area.";
  overlayTitle.textContent = "Ready?";
  overlayCopy.textContent = "Calibrate the camera below to enable the level.";
  playButton.textContent = "Calibrate camera first";
  playButton.disabled = true;
}

function drawCameraFloor(occupiedLanes: Set<number>): void {
  if (!floorTransform) return;
  for (let lane = 0; lane < 4; lane++) {
    const start = lane / 4;
    const end = (lane + 1) / 4;
    const points = [
      projectFloorPoint({ x: start, y: 0 }, floorTransform),
      projectFloorPoint({ x: end, y: 0 }, floorTransform),
      projectFloorPoint({ x: end, y: 1 }, floorTransform),
      projectFloorPoint({ x: start, y: 1 }, floorTransform),
    ];
    cameraContext.beginPath();
    points.forEach((point, index) => index ? cameraContext.lineTo(point.x, point.y) : cameraContext.moveTo(point.x, point.y));
    cameraContext.closePath();
    cameraContext.fillStyle = occupiedLanes.has(lane + 1) ? "rgba(255, 230, 64, .24)" : "rgba(10, 13, 19, .18)";
    cameraContext.strokeStyle = occupiedLanes.has(lane + 1) ? "#ffe640" : "rgba(255, 255, 255, .55)";
    cameraContext.lineWidth = occupiedLanes.has(lane + 1) ? 4 : 2;
    cameraContext.fill();
    cameraContext.stroke();
  }
}

function drawCalibrationPoints(): void {
  corners.forEach((point, index) => {
    cameraContext.beginPath();
    cameraContext.arc(cameraCanvas.width - point.x, point.y, 11, 0, Math.PI * 2);
    cameraContext.fillStyle = "#ffe640";
    cameraContext.fill();
    cameraContext.fillStyle = "#08090d";
    cameraContext.font = "700 12px sans-serif";
    cameraContext.textAlign = "center";
    cameraContext.textBaseline = "middle";
    cameraContext.fillText(String.fromCharCode(65 + index), cameraCanvas.width - point.x, point.y + 1);
  });
}

function readFoot(
  points: [Keypoint, Keypoint, Keypoint] | null,
  side: "left" | "right",
): [Point, Point, Point] | null {
  const now = performance.now();
  let pixels = smoothedFeet[side];
  if (points?.every((point) => point.confidence >= 0.5)) {
    pixels = points.map((point, index) => {
      const previous = smoothedFeet[side]?.[index];
      return previous
        ? { x: previous.x + (point.x - previous.x) * 0.35, y: previous.y + (point.y - previous.y) * 0.35 }
        : point;
    }) as [Point, Point, Point];
    smoothedFeet[side] = pixels;
    lastFootTime[side] = now;
  }
  if (!pixels || now - lastFootTime[side] > 250) return null;

  cameraContext.beginPath();
  pixels.forEach((point, index) => index ? cameraContext.lineTo(point.x, point.y) : cameraContext.moveTo(point.x, point.y));
  cameraContext.closePath();
  cameraContext.fillStyle = `${footColors[side]}55`;
  cameraContext.strokeStyle = footColors[side];
  cameraContext.lineWidth = 4;
  cameraContext.fill();
  cameraContext.stroke();
  return pixels;
}

function submitCameraAction(action: InputAction): void {
  cameraEventLog.querySelector(".event-empty")?.remove();
  const message = document.createElement("p");
  message.textContent = action.lane ? `${action.type} · LANE ${action.lane}` : action.type;
  cameraEventLog.append(message);
  if (cameraEventLog.children.length > 10) cameraEventLog.firstElementChild?.remove();
  cameraEventLog.scrollTop = cameraEventLog.scrollHeight;

  if (action.type === "LEFT_STEP") submitPlayerEvent("STEP", "left", action.lane);
  if (action.type === "RIGHT_STEP") submitPlayerEvent("STEP", "right", action.lane);
  if (action.type === "JUMP") submitPlayerEvent("JUMP", "both");
  if (action.type === "SLIDE_LEFT") submitPlayerEvent("SLIDE_LEFT", action.foot ?? "either", action.lane);
  if (action.type === "SLIDE_RIGHT") submitPlayerEvent("SLIDE_RIGHT", action.foot ?? "either", action.lane);
}

resetCameraEventsButton.addEventListener("click", () => {
  inputActions.reset();
  jumpDetector.reset();
  const empty = document.createElement("p");
  empty.className = "event-empty";
  empty.textContent = "Waiting for movement…";
  cameraEventLog.replaceChildren(empty);
});

async function renderCamera(): Promise<void> {
  if (!poseDetector || cameraVideo.readyState < 2 || cameraVideo.currentTime === lastVideoTime) {
    cameraFrame = requestAnimationFrame(renderCamera);
    return;
  }
  lastVideoTime = cameraVideo.currentTime;
  const pose = await poseDetector.detect(cameraVideo);
  cameraContext.clearRect(0, 0, cameraCanvas.width, cameraCanvas.height);
  const occupiedLanes = new Set<number>();
  cameraContext.save();
  cameraContext.translate(cameraCanvas.width, 0);
  cameraContext.scale(-1, 1);

  const left = readFoot(pose?.left ?? null, "left");
  const right = readFoot(pose?.right ?? null, "right");
  if (!left || !right) jumpDetector.reset();
  const leftY = left ? left.reduce((sum, point) => sum + point.y, 0) / (left.length * cameraCanvas.height) : null;
  const rightY = right ? right.reduce((sum, point) => sum + point.y, 0) / (right.length * cameraCanvas.height) : null;
  const jumping = leftY !== null && rightY !== null
    ? jumpDetector.update(leftY, rightY)
    : false;

  if (floorTransform) {
    const leftLane = left ? floorLane(projectFoot(left, floorTransform)) : null;
    const rightLane = right ? floorLane(projectFoot(right, floorTransform)) : null;
    showTrackedFeet(leftLane, rightLane);
    inputActions.update(leftLane, rightLane, leftY, rightY, jumping).forEach(submitCameraAction);
    if (leftLane) occupiedLanes.add(leftLane);
    if (rightLane) occupiedLanes.add(rightLane);
    setCameraStatus(left && right ? "Tracking both feet" : "Move both feet into view", Boolean(left && right));
  } else {
    showTrackedFeet(null, null);
    inputActions.reset();
  }

  drawCameraFloor(occupiedLanes);
  cameraContext.restore();
  drawCalibrationPoints();
  cameraFrame = requestAnimationFrame(renderCamera);
}

cameraCanvas.addEventListener("click", (event) => {
  if (!cameraCanvas.classList.contains("calibrating") || corners.length >= 4) return;
  const bounds = cameraCanvas.getBoundingClientRect();
  const x = ((event.clientX - bounds.left) / bounds.width) * cameraCanvas.width;
  corners.push({
    x: cameraCanvas.width - x,
    y: ((event.clientY - bounds.top) / bounds.height) * cameraCanvas.height,
  });

  if (corners.length < 4) {
    cornerPrompt.textContent = `CLICK ${cornerNames[corners.length]}`;
    cameraHint.textContent = `Click ${cornerNames[corners.length].split(" · ")[1].toLowerCase()}.`;
    return;
  }

  try {
    floorTransform = calibrateFloor(corners as [Point, Point, Point, Point]);
    cameraCanvas.classList.remove("calibrating");
    cornerPrompt.hidden = true;
    recalibrateButton.disabled = false;
    cameraHint.textContent = "Blue and pink markers show the detected feet.";
    setCameraStatus("Floor calibrated", true);
    overlayCopy.textContent = "Step on the matching lanes as notes cross the yellow line.";
    playButton.textContent = "Start test level";
    playButton.disabled = false;
  } catch (error) {
    beginCalibration();
    cameraHint.textContent = error instanceof Error ? error.message : "Mark the floor again.";
  }
});

recalibrateButton.addEventListener("click", beginCalibration);

startCameraButton.addEventListener("click", async () => {
  startCameraButton.disabled = true;
  setCameraStatus("Loading foot model…");
  cameraHint.textContent = "Allow camera access when your browser asks.";

  try {
    const [detector, stream] = await Promise.all([
      FootPoseDetector.create("/models/foot-pose.onnx"),
      navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, aspectRatio: { ideal: 16 / 9 }, frameRate: { ideal: 30 } },
        audio: false,
      }),
    ]);
    poseDetector = detector;
    cameraVideo.srcObject = stream;
    await new Promise<void>((resolve) => cameraVideo.addEventListener("loadedmetadata", () => resolve(), { once: true }));
    await cameraVideo.play();
    cameraCanvas.width = cameraVideo.videoWidth;
    cameraCanvas.height = cameraVideo.videoHeight;
    cameraEmpty.hidden = true;
    startCameraButton.hidden = true;
    beginCalibration();
    setCameraStatus("Mark four floor corners");
    cancelAnimationFrame(cameraFrame);
    renderCamera();
  } catch (error) {
    startCameraButton.disabled = false;
    setCameraStatus("Could not start camera");
    cameraHint.textContent = error instanceof Error ? error.message : "Check camera permission and try again.";
  }
});

playButton.addEventListener("click", async () => {
  playButton.disabled = true;
  playButton.textContent = "Starting…";
  recalibrateButton.disabled = true;
  audioContext ??= new AudioContext();
  audioBuffer ??= await audioContext.decodeAudioData(audioData.slice(0));
  await audioContext.resume();

  engine = new RhythmEngine(chart.notes);
  noteViews.forEach((view) => view.visible = false);
  laneGlowUntil.fill(0);
  feedback.visible = false;
  inputActions.reset();
  scoreElement.textContent = "000000";
  comboElement.textContent = "0";
  judgementsElement.textContent = "Perfect 0 · Great 0 · Good 0 · Miss 0";

  source = audioContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(audioContext.destination);
  startedAt = audioContext.currentTime + 0.08;
  source.start(startedAt);
  running = true;
  overlay.classList.add("hidden");
});

app.ticker.add(() => {
  const songTime = currentSongTime();
  timeElement.textContent = Math.max(0, songTime).toFixed(3);
  engine.update(songTime).forEach(showResult);

  for (const [slide, path] of slidePaths) {
    path.clear();
    const notes = slideGroups.get(slide)!;
    const first = notes[0];
    const last = notes[notes.length - 1];
    if (!running || first.time - songTime > chart.playfield.travelTime || songTime >= last.time) continue;

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
      const progress = Math.min(1, Math.max(0, 1 - (note.time - songTime) / chart.playfield.travelTime)) ** 1.45;
      const edges = laneEdges(note.lane, progress);
      const playfieldWidth = farRight - farLeft + (nearRight - nearLeft - farRight + farLeft) * progress;
      return {
        x: (edges[0] + edges[1]) / 2,
        y: horizonY + (hitY - horizonY) * progress,
        halfWidth: playfieldWidth / chart.playfield.lanes * 0.27,
      };
    });
    if (points.length < 2) continue;

    const polygon = points.flatMap((point) => [point.x - point.halfWidth, point.y]);
    for (let index = points.length - 1; index >= 0; index--) polygon.push(points[index].x + points[index].halfWidth, points[index].y);
    const color = first.foot === "left" ? 0x35dcff : 0xff4fa2;
    path.poly(polygon, true).fill({ color, alpha: 0.52 }).stroke({ color: 0xffffff, alpha: 0.55, width: 2 });
    path.moveTo(points[0].x, points[0].y);
    for (const point of points.slice(1)) path.lineTo(point.x, point.y);
    path.stroke({ color, alpha: 0.95, width: 5 });
  }

  for (const note of chart.notes) {
    const view = noteViews.get(note.id)!;
    if (note.slide && note.type !== "STEP") {
      view.visible = false;
      continue;
    }
    if (!running || engine.judgements.has(note.id)) {
      view.visible = false;
      continue;
    }
    const timeUntil = note.time - songTime;
    if (timeUntil > chart.playfield.travelTime || timeUntil < -0.2) {
      view.visible = false;
      continue;
    }
    const progress = Math.min(1, Math.max(0, 1 - timeUntil / chart.playfield.travelTime));
    const easedProgress = progress ** 1.45;
    const playfieldWidth = farRight - farLeft + (nearRight - nearLeft - farRight + farLeft) * easedProgress;
    const lane = note.lane ?? 2.5;
    const edges = Number.isInteger(lane) ? laneEdges(lane, easedProgress) : [width / 2, width / 2];
    view.position.set((edges[0] + edges[1]) / 2, horizonY + (hitY - horizonY) * easedProgress);
    view.scale.x = note.type === "JUMP" ? playfieldWidth / 480 : playfieldWidth / chart.playfield.lanes * 0.82 / 120;
    view.scale.y = 0.55 + easedProgress * 0.65;
    view.visible = true;
  }

  laneGlow.clear();
  laneGlowUntil.forEach((until, index) => {
    if (performance.now() < until) drawLane(laneGlow, index + 1, laneColors[index], 0.35);
  });
  if (feedback.visible && performance.now() > feedbackUntil) feedback.visible = false;

  if (running && songTime >= chart.level.endTime) {
    running = false;
    source?.stop();
    overlayTitle.textContent = "Test complete";
    overlayCopy.textContent = `Score ${engine.score.total.toString().padStart(6, "0")} · Max combo ${engine.score.maxCombo}`;
    playButton.textContent = "Play again";
    playButton.disabled = false;
    recalibrateButton.disabled = false;
    overlay.classList.remove("hidden");
  }
});
