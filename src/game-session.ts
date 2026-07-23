import { AudioClock } from "./audio-clock.ts";
import { loadCalibrationSettings, type CalibrationSettings } from "./calibration-settings.ts";
import type { LoadedLevel } from "./level.ts";
import { RhythmEngine, type JudgementResult, type PlayerEvent } from "./rhythm-engine.ts";
import type { InputAction, InputFrame } from "./foot-pose.ts";

export type GameSnapshot = {
  running: boolean;
  paused: boolean;
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
  return null;
}

export class GameSession {
  private readonly clock = new AudioClock();
  private engine: RhythmEngine;
  private running = false;
  private paused = false;

  constructor(readonly level: LoadedLevel, private readonly settings: CalibrationSettings = loadCalibrationSettings()) {
    this.engine = new RhythmEngine(level.chart.notes, settings);
  }

  async load(): Promise<void> {
    await this.clock.load(this.level.song.audio);
  }

  async start(): Promise<void> {
    this.engine = new RhythmEngine(this.level.chart.notes, this.settings);
    await this.clock.start();
    this.running = true;
    this.paused = false;
  }

  async togglePause(): Promise<void> {
    if (!this.running) return;
    if (this.paused) await this.clock.resume();
    else await this.clock.pause();
    this.paused = !this.paused;
  }

  submit(frame: InputFrame): JudgementResult[] {
    if (!this.running || this.paused) return [];
    const time = this.clock.timeAt(frame.capturedAt, this.level.chart.level.endTime);
    if (time === null) return [];
    const results = frame.actions.flatMap((action) => {
      const event = playerEventForAction(action, time);
      const result = event ? this.engine.submit(event) : null;
      return result ? [result] : [];
    });
    results.push(...this.engine.update(time));
    if (time >= this.level.chart.level.endTime) this.stop();
    return results;
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
      paused: this.paused,
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
    this.paused = false;
    this.clock.stop();
  }
}
