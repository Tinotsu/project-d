import { defaultCalibrationSettings, type CalibrationSettings } from "./calibration-settings.ts";

export type NoteType = "STEP" | "JUMP" | "SLIDE" | "STAY" | "HORIZONTAL_SLIDE";
export type Foot = "left" | "right" | "both" | "either";

export type ChartNote = {
  id: string;
  time: number;
  type: NoteType;
  lane?: number;
  laneOffset?: 0 | 0.5;
  endLane?: number;
  slidePosition?: number;
  stepPosition?: number;
  duration?: number;
  foot: Foot;
};

export type Judgement = "perfect" | "great" | "good" | "miss";

export type JudgementResult = {
  note: ChartNote;
  judgement: Judgement;
  offset: number;
};

type CameraFrame = {
  time: number;
  leftLane: number | null;
  rightLane: number | null;
  leftPoints: number[] | null;
  rightPoints: number[] | null;
};

export function slideBounds(note: ChartNote): { left: number; right: number } {
  const start = note.lane! - 1 + (note.laneOffset ?? 0.5);
  const end = note.endLane! - 0.5;
  const left = Math.max(0, Math.min(2, note.slidePosition ?? Math.min(start, end)));
  return { left, right: left + 2 };
}

export function horizontalSlideBounds(note: ChartNote): { left: number; right: number } {
  return {
    left: Math.min(note.lane!, note.endLane!) - 1,
    right: Math.max(note.lane!, note.endLane!),
  };
}

export function isSustainedNote(note: ChartNote): boolean {
  return note.type === "STAY" || note.type === "HORIZONTAL_SLIDE";
}

export function stepBounds(note: ChartNote): { left: number; right: number } {
  const left = Math.max(0, Math.min(3, note.stepPosition ?? note.lane! - 1));
  return { left, right: left + 1 };
}

const points: Record<Judgement, number> = {
  perfect: 800,
  great: 400,
  good: 50,
  miss: 0,
};

export function judgementForOffset(
  type: NoteType,
  offsetMs: number,
  settings = defaultCalibrationSettings,
): Exclude<Judgement, "miss"> | null {
  if (type === "STAY" || type === "HORIZONTAL_SLIDE") return null;
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
  private frames: CameraFrame[] = [];
  private readonly trackedSustainedNotes = new Map<string, { onPath: boolean; started: boolean }>();
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

  trackFrame(
    time: number,
    leftLane: number | null,
    rightLane: number | null,
    leftPoints: number[] | null,
    rightPoints: number[] | null,
    finish = false,
  ): JudgementResult[] {
    const frame = { time, leftLane, rightLane, leftPoints, rightPoints };
    this.frames.push(frame);
    const results = [
      ...this.judgeSteps(time),
      ...this.judgeJumps(time),
      ...this.judgeSlides(),
      ...this.trackSustainedNotes(frame),
    ];
    results.push(...this.collectMisses(time, finish));
    const historyWindow = Math.max(
      (this.settings.stepGoodMs * 2 + this.settings.missGraceMs) / 1000,
      (this.settings.jumpGoodMs * 2 + this.settings.missGraceMs) / 1000,
      (this.settings.responseTimeoutMs + this.settings.stepGoodMs + this.settings.stepGreatMs) / 1000,
    );
    this.frames = this.frames.filter((candidate) => time - candidate.time <= historyWindow);
    return results;
  }

  private collectMisses(songTime: number, finish: boolean): JudgementResult[] {
    const misses: JudgementResult[] = [];
    for (const note of this.notes) {
      const goodWindow = note.type === "JUMP"
        ? this.settings.jumpGoodMs
        : note.type === "SLIDE"
          ? this.settings.responseTimeoutMs
          : isSustainedNote(note)
            ? (note.duration ?? 1) * 1000
            : this.settings.stepGoodMs;
      if (!this.judgements.has(note.id) && (finish || (songTime - note.time) * 1000 > goodWindow + this.settings.missGraceMs)) {
        misses.push(this.applyJudgement(note, "miss", songTime - note.time));
      }
    }
    return misses;
  }

  private judgeSteps(time: number): JudgementResult[] {
    const results: JudgementResult[] = [];
    const goodWindow = this.settings.stepGoodMs / 1000;
    const judgingDelay = (this.settings.stepGoodMs + this.settings.missGraceMs) / 1000;

    for (const note of this.notes) {
      if (note.type !== "STEP" || this.judgements.has(note.id) || time - note.time <= judgingDelay) continue;
      const frames = this.frames.filter((frame) => Math.abs(frame.time - note.time) <= goodWindow);
      const leftMoved = footMoved(frames, "leftPoints", this.settings);
      const rightMoved = footMoved(frames, "rightPoints", this.settings);
      const frame = frames
        .filter((candidate) => stepMatchesFrame(note, candidate, leftMoved, rightMoved))
        .sort((a, b) => Math.abs(a.time - note.time) - Math.abs(b.time - note.time))[0];
      results.push(frame
        ? this.applyJudgement(
            note,
            judgementForOffset("STEP", (frame.time - note.time) * 1000, this.settings)!,
            frame.time - note.time,
          )
        : this.applyJudgement(note, "miss", time - note.time));
    }
    return results;
  }

  private judgeJumps(time: number): JudgementResult[] {
    const results: JudgementResult[] = [];
    const goodWindow = this.settings.jumpGoodMs / 1000;
    const judgingDelay = (this.settings.jumpGoodMs + this.settings.missGraceMs) / 1000;

    for (const note of this.notes) {
      if (note.type !== "JUMP" || this.judgements.has(note.id) || time - note.time <= judgingDelay) continue;
      const frames = this.frames.filter((frame) => Math.abs(frame.time - note.time) <= goodWindow);
      const moved = footMoved(frames, "leftPoints", this.settings, "jump")
        && footMoved(frames, "rightPoints", this.settings, "jump");
      const frame = moved
        ? frames
            .filter((candidate) => candidate.leftPoints !== null && candidate.rightPoints !== null)
            .sort((a, b) => Math.abs(a.time - note.time) - Math.abs(b.time - note.time))[0]
        : undefined;
      results.push(frame
        ? this.applyJudgement(
            note,
            judgementForOffset("JUMP", (frame.time - note.time) * 1000, this.settings)!,
            frame.time - note.time,
          )
        : this.applyJudgement(note, "miss", time - note.time));
    }
    return results;
  }

  private judgeSlides(): JudgementResult[] {
    const results: JudgementResult[] = [];
    for (const note of this.notes) {
      if (note.type !== "SLIDE" || this.judgements.has(note.id)) continue;
      const feet: ("leftLane" | "rightLane")[] = note.foot === "right"
        ? ["rightLane"]
        : note.foot === "either"
          ? ["leftLane", "rightLane"]
          : ["leftLane"];
      let closest: CameraFrame | undefined;
      for (const foot of feet) {
        for (const start of this.frames) {
          if (
            start[foot] !== note.lane
            || !judgementForOffset("SLIDE", (start.time - note.time) * 1000, this.settings)
            || !this.frames.some((end) => (
              end.time >= start.time
              && (end.time - start.time) * 1000 <= this.settings.responseTimeoutMs
              && end[foot] === note.endLane
            ))
          ) continue;
          if (!closest || Math.abs(start.time - note.time) < Math.abs(closest.time - note.time)) closest = start;
        }
      }
      if (!closest) continue;
      results.push(this.applyJudgement(
        note,
        judgementForOffset("SLIDE", (closest.time - note.time) * 1000, this.settings)!,
        closest.time - note.time,
      ));
    }
    return results;
  }

  private trackSustainedNotes(frame: CameraFrame): JudgementResult[] {
    const results: JudgementResult[] = [];
    for (const note of this.notes) {
      if (!isSustainedNote(note) || this.judgements.has(note.id) || frame.time < note.time) continue;
      const duration = note.duration ?? 1;
      const progress = Math.min(1, (frame.time - note.time) / duration);
      const expectedLane = note.type === "HORIZONTAL_SLIDE"
        ? Math.round(note.lane! + (note.endLane! - note.lane!) * progress)
        : note.lane!;
      const tracked = this.trackedSustainedNotes.get(note.id) ?? { onPath: true, started: false };
      tracked.onPath &&= footOccupiesLane(note.foot, expectedLane, frame);
      tracked.started ||= frame.time < note.time + duration;
      this.trackedSustainedNotes.set(note.id, tracked);
      if (frame.time < note.time + duration) continue;
      results.push(this.applyJudgement(note, tracked.started && tracked.onPath ? "perfect" : "miss", 0));
    }
    return results;
  }

  private applyJudgement(note: ChartNote, judgement: Judgement, offset: number): JudgementResult {
    const result = { note, judgement, offset };
    this.trackedSustainedNotes.delete(note.id);
    this.judgements.set(note.id, result);
    this.score[judgement]++;
    this.score.total += points[judgement];
    this.score.combo = judgement === "miss" ? 0 : this.score.combo + 1;
    this.score.maxCombo = Math.max(this.score.maxCombo, this.score.combo);
    return result;
  }
}

function stepMatchesFrame(
  note: ChartNote,
  frame: CameraFrame,
  leftMoved: boolean,
  rightMoved: boolean,
): boolean {
  const leftMatches = leftMoved && frame.leftLane === note.lane && frame.leftPoints !== null;
  const rightMatches = rightMoved && frame.rightLane === note.lane && frame.rightPoints !== null;
  if (note.foot === "left") return leftMatches;
  if (note.foot === "right") return rightMatches;
  if (note.foot === "both") return leftMatches && rightMatches;
  return leftMatches || rightMatches;
}

function footMoved(
  frames: CameraFrame[],
  foot: "leftPoints" | "rightPoints",
  settings: CalibrationSettings,
  type: "step" | "jump" = "step",
): boolean {
  const samples = frames.flatMap((frame) => frame[foot] ? [frame[foot]] : []);
  if (samples.length < 2) return false;
  const lift = type === "jump" ? settings.jumpLift : settings.stepLift;
  const landing = type === "jump" ? settings.jumpLanding : settings.stepLanding;
  const descent = type === "jump" ? settings.jumpDescent : settings.stepDescent;
  return [0, 1, 2].filter((point) => {
    let peak = Infinity;
    let peakAt = -1;
    let ground = -Infinity;
    samples.forEach((sample, index) => {
      ground = Math.max(ground, sample[point]);
      if (sample[point] < peak) {
        peak = sample[point];
        peakAt = index;
      }
    });
    return ground - peak > lift
      && samples.slice(peakAt + 1).some((sample) => (
        sample[point] > ground - landing
        || sample[point] - peak > descent
      ));
  }).length >= 2;
}

function footOccupiesLane(foot: Foot, lane: number, frame: CameraFrame): boolean {
  if (foot === "left") return frame.leftLane === lane;
  if (foot === "right") return frame.rightLane === lane;
  if (foot === "both") return frame.leftLane === lane && frame.rightLane === lane;
  return frame.leftLane === lane || frame.rightLane === lane;
}
