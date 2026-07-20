import { AudioClock } from "./audio-clock.ts";
import type { LoadedLevel } from "./level.ts";
import { RhythmEngine, type JudgementResult, type PlayerEvent } from "./rhythm-engine.ts";
import type { InputAction } from "./foot-pose.ts";

export type GameSnapshot = {
  running: boolean;
  time: number;
  score: number;
  combo: number;
  maxCombo: number;
  perfect: number;
  great: number;
  good: number;
  miss: number;
};

export function playerEventForAction(action: InputAction, time: number): PlayerEvent | null {
  if (action.type === "LEFT_STEP") return { time, type: "STEP", foot: "left", lane: action.lane };
  if (action.type === "RIGHT_STEP") return { time, type: "STEP", foot: "right", lane: action.lane };
  if (action.type === "JUMP") return { time, type: "JUMP", foot: "both" };
  if (action.type === "SLIDE_LEFT") return { time, type: "SLIDE_LEFT", foot: action.foot ?? "either", lane: action.lane };
  if (action.type === "SLIDE_RIGHT") return { time, type: "SLIDE_RIGHT", foot: action.foot ?? "either", lane: action.lane };
  return null;
}

export class GameSession {
  private readonly clock = new AudioClock();
  private engine: RhythmEngine;
  private running = false;

  constructor(readonly level: LoadedLevel) {
    this.engine = new RhythmEngine(level.chart.notes);
  }

  async load(): Promise<void> {
    await this.clock.load(this.level.song.audio);
  }

  async start(): Promise<void> {
    this.engine = new RhythmEngine(this.level.chart.notes);
    await this.clock.start();
    this.running = true;
  }

  submit(action: InputAction): JudgementResult | null {
    if (!this.running) return null;
    const event = playerEventForAction(action, this.currentTime());
    return event ? this.engine.submit(event) : null;
  }

  update(): JudgementResult[] {
    if (!this.running) return [];
    const time = this.currentTime();
    const misses = this.engine.update(time);
    if (time >= this.level.chart.level.endTime) this.stop();
    return misses;
  }

  currentTime(): number {
    return this.clock.currentTime(this.level.chart.level.endTime);
  }

  judged(noteId: string): boolean {
    return this.engine.judgements.has(noteId);
  }

  snapshot(): GameSnapshot {
    return {
      running: this.running,
      time: this.currentTime(),
      score: this.engine.score.total,
      combo: this.engine.score.combo,
      maxCombo: this.engine.score.maxCombo,
      perfect: this.engine.score.perfect,
      great: this.engine.score.great,
      good: this.engine.score.good,
      miss: this.engine.score.miss,
    };
  }

  stop(): void {
    this.running = false;
    this.clock.stop();
  }
}
