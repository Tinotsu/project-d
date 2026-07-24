import { defaultCalibrationSettings, type CalibrationSettings } from "./calibration-settings.ts";

export type NoteType = "STEP" | "JUMP" | "SLIDE";
export type Foot = "left" | "right" | "both" | "either";

export type ChartNote = {
  id: string;
  time: number;
  type: NoteType;
  lane?: number;
  laneOffset?: 0 | 0.5;
  endLane?: number;
  foot: Foot;
};

export type PlayerEvent = {
  time: number;
  type: NoteType;
  lane?: number;
  endLane?: number;
  foot: Foot;
};

export type Judgement = "perfect" | "great" | "good" | "miss";

export type JudgementResult = {
  note: ChartNote;
  judgement: Judgement;
  offset: number;
};

const points: Record<Judgement, number> = {
  perfect: 1000,
  great: 700,
  good: 400,
  miss: 0,
};

export function judgementForOffset(
  type: NoteType,
  offsetMs: number,
  settings = defaultCalibrationSettings,
): Exclude<Judgement, "miss"> | null {
  const offset = Math.abs(offsetMs);
  const prefix = type === "JUMP" ? "jump" : "step";
  if (offset <= settings[`${prefix}PerfectMs`] + Number.EPSILON) return "perfect";
  if (offset <= settings[`${prefix}GreatMs`] + Number.EPSILON) return "great";
  if (offset <= settings[`${prefix}GoodMs`] + Number.EPSILON) return "good";
  if (type === "SLIDE" && offsetMs < 0 && offset <= settings.stepGoodMs + settings.stepGreatMs + Number.EPSILON) return "good";
  return null;
}

export class RhythmEngine {
  readonly judgements = new Map<string, JudgementResult>();
  private readonly pendingSlides = new Map<string, {
    note: ChartNote;
    time: number;
    foot: "left" | "right";
    otherFootAtEnd: boolean;
  }>();
  readonly score = {
    total: 0,
    combo: 0,
    maxCombo: 0,
    perfect: 0,
    great: 0,
    good: 0,
    miss: 0,
  };

  constructor(readonly notes: ChartNote[], private readonly settings: CalibrationSettings = defaultCalibrationSettings) {}

  trackSlides(time: number, leftLane: number | null, rightLane: number | null): JudgementResult[] {
    const results: JudgementResult[] = [];
    for (const [id, pending] of this.pendingSlides) {
      const expectedLane = pending.foot === "left" ? leftLane : rightLane;
      const eitherLane = leftLane === pending.note.endLane || rightLane === pending.note.endLane;
      if (expectedLane !== pending.note.endLane && (pending.otherFootAtEnd || !eitherLane)) continue;
      this.pendingSlides.delete(id);
      results.push(this.applyJudgement(
        pending.note,
        judgementForOffset("SLIDE", (pending.time - pending.note.time) * 1000, this.settings)!,
        pending.time - pending.note.time,
      ));
    }

    for (const note of this.notes) {
      if (note.type !== "SLIDE" || this.judgements.has(note.id) || this.pendingSlides.has(note.id)) continue;
      const foot = note.foot === "right" ? "right" : "left";
      const lane = foot === "left" ? leftLane : rightLane;
      const offset = time - note.time;
      if (lane !== note.lane || !judgementForOffset("SLIDE", offset * 1000, this.settings)) continue;
      const otherLane = foot === "left" ? rightLane : leftLane;
      this.pendingSlides.set(note.id, { note, time, foot, otherFootAtEnd: otherLane === note.endLane });
    }
    return results;
  }

  submit(event: PlayerEvent): JudgementResult | null {
    let closest: ChartNote | undefined;
    let closestOffset = Infinity;

    for (const note of this.notes) {
      const offset = event.time - note.time;
      if (
        this.judgements.has(note.id)
        || !judgementForOffset(note.type, offset * 1000, this.settings)
        || note.type !== event.type
        || (note.lane !== undefined && note.lane !== event.lane)
        || (note.endLane !== undefined && note.endLane !== event.endLane)
        || (note.foot !== "either" && note.foot !== event.foot)
      ) continue;
      if (Math.abs(offset) < Math.abs(closestOffset)) {
        closest = note;
        closestOffset = offset;
      }
    }

    if (!closest) return null;
    return this.applyJudgement(
      closest,
      judgementForOffset(closest.type, closestOffset * 1000, this.settings)!,
      closestOffset,
    );
  }

  update(songTime: number, finish = false): JudgementResult[] {
    const misses: JudgementResult[] = [];
    for (const note of this.notes) {
      if (!finish && this.pendingSlides.has(note.id)) continue;
      const goodWindow = note.type === "JUMP"
        ? this.settings.jumpGoodMs
        : note.type === "SLIDE" ? this.settings.responseTimeoutMs : this.settings.stepGoodMs;
      if (!this.judgements.has(note.id) && (finish || (songTime - note.time) * 1000 > goodWindow + this.settings.missGraceMs)) {
        this.pendingSlides.delete(note.id);
        misses.push(this.applyJudgement(note, "miss", songTime - note.time));
      }
    }
    return misses;
  }

  private applyJudgement(note: ChartNote, judgement: Judgement, offset: number): JudgementResult {
    const result = { note, judgement, offset };
    this.pendingSlides.delete(note.id);
    this.judgements.set(note.id, result);
    this.score[judgement]++;
    this.score.total += points[judgement];
    this.score.combo = judgement === "miss" ? 0 : this.score.combo + 1;
    this.score.maxCombo = Math.max(this.score.maxCombo, this.score.combo);
    return result;
  }
}
