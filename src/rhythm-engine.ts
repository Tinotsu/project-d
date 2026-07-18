export type NoteType = "STEP" | "JUMP" | "SLIDE_LEFT" | "SLIDE_RIGHT";
export type Foot = "left" | "right" | "both" | "either";

export type ChartNote = {
  id: string;
  time: number;
  type: NoteType;
  lane?: number;
  foot: Foot;
};

export type PlayerEvent = {
  time: number;
  type: NoteType;
  lane?: number;
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

  constructor(readonly notes: ChartNote[]) {}

  submit(event: PlayerEvent): JudgementResult | null {
    let closest: ChartNote | undefined;
    let closestOffset = Infinity;

    for (const note of this.notes) {
      const offset = event.time - note.time;
      if (
        this.judgements.has(note.id)
        || Math.abs(offset) > 0.16
        || note.type !== event.type
        || (note.lane !== undefined && note.lane !== event.lane)
        || (note.foot !== "either" && note.foot !== event.foot)
      ) continue;
      if (Math.abs(offset) < Math.abs(closestOffset)) {
        closest = note;
        closestOffset = offset;
      }
    }

    if (!closest) return null;
    const absoluteOffset = Math.abs(closestOffset);
    const judgement = absoluteOffset <= 0.05 + Number.EPSILON
      ? "perfect"
      : absoluteOffset <= 0.1 + Number.EPSILON ? "great" : "good";
    return this.applyJudgement(closest, judgement, closestOffset);
  }

  update(songTime: number): JudgementResult[] {
    const misses: JudgementResult[] = [];
    for (const note of this.notes) {
      if (!this.judgements.has(note.id) && songTime - note.time > 0.2) {
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
