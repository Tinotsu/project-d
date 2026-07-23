import { defaultCalibrationSettings, type CalibrationSettings } from "./calibration-settings.ts";

export type NoteType = "STEP" | "JUMP" | "SLIDE";
export type Foot = "left" | "right" | "both" | "either";

export type ChartNote = {
  id: string;
  time: number;
  type: NoteType;
  lane?: number;
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
  return null;
}

export class RhythmEngine {
  readonly judgements = new Map<string, JudgementResult>();
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

  update(songTime: number): JudgementResult[] {
    const misses: JudgementResult[] = [];
    for (const note of this.notes) {
      const goodWindow = note.type === "JUMP"
        ? this.settings.jumpGoodMs
        : note.type === "SLIDE" ? this.settings.responseTimeoutMs : this.settings.stepGoodMs;
      if (!this.judgements.has(note.id) && (songTime - note.time) * 1000 > goodWindow + this.settings.missGraceMs) {
        misses.push(this.applyJudgement(note, "miss", songTime - note.time));
      }
    }
    return misses;
  }

  private applyJudgement(note: ChartNote, judgement: Judgement, offset: number): JudgementResult {
    const result = { note, judgement, offset };
    this.judgements.set(note.id, result);
    this.score[judgement]++;
    this.score.total += points[judgement];
    this.score.combo = judgement === "miss" ? 0 : this.score.combo + 1;
    this.score.maxCombo = Math.max(this.score.maxCombo, this.score.combo);
    return result;
  }
}
