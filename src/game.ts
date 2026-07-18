import { Application, Container, Graphics, Text } from "pixi.js";
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
playButton.disabled = false;
playButton.textContent = "Start test level";

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

const laneGlow = new Graphics();
app.stage.addChild(laneGlow);
const laneGlowUntil = [0, 0, 0, 0];

const noteViews = new Map<string, Container>();
for (const note of chart.notes) {
  const view = new Container();
  const noteWidth = note.type === "JUMP" ? 480 : 120;
  const body = new Graphics()
    .roundRect(-noteWidth / 2, -13, noteWidth, 26, 8)
    .fill(note.type === "JUMP" ? 0xffe640 : note.foot === "left" ? 0x35dcff : 0xff4fa2)
    .stroke({ color: 0xffffff, alpha: 0.8, width: 2 });
  const label = new Text({
    text: note.type === "JUMP" ? "JUMP" : note.foot === "left" ? "L" : "R",
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

const keys: Record<string, { lane: number; foot: Foot }> = {
  KeyA: { lane: 1, foot: "left" },
  KeyS: { lane: 2, foot: "left" },
  KeyK: { lane: 3, foot: "right" },
  KeyL: { lane: 4, foot: "right" },
};
window.addEventListener("keydown", (event) => {
  if (event.repeat) return;
  if (event.code === "Space") {
    event.preventDefault();
    submitPlayerEvent("JUMP", "both");
  } else if (keys[event.code]) {
    submitPlayerEvent("STEP", keys[event.code].foot, keys[event.code].lane);
  }
});

for (const [eventName, type, foot] of [
  ["LEFT_STEP", "STEP", "left"],
  ["RIGHT_STEP", "STEP", "right"],
  ["SLIDE_LEFT", "SLIDE_LEFT", "either"],
  ["SLIDE_RIGHT", "SLIDE_RIGHT", "either"],
  ["JUMP", "JUMP", "both"],
] as const) {
  window.addEventListener(eventName, (event) => {
    submitPlayerEvent(type, foot, (event as CustomEvent<{ lane?: number }>).detail?.lane);
  });
}

playButton.addEventListener("click", async () => {
  playButton.disabled = true;
  playButton.textContent = "Starting…";
  audioContext ??= new AudioContext();
  audioBuffer ??= await audioContext.decodeAudioData(audioData.slice(0));
  await audioContext.resume();

  engine = new RhythmEngine(chart.notes);
  noteViews.forEach((view) => view.visible = false);
  laneGlowUntil.fill(0);
  feedback.visible = false;
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

  for (const note of chart.notes) {
    const view = noteViews.get(note.id)!;
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
    overlay.classList.remove("hidden");
  }
});
