import { defaultCalibrationSettings, type CalibrationSettings } from "../calibration/settings.ts";
import { isSustainedNote } from "../chart/note-geometry.ts";
import type { ChartNote, Foot, NoteType } from "../chart/types.ts";

export type { ChartNote, Foot, NoteType } from "../chart/types.ts";

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
  if (type === "STAY") return null;
  const offset = Math.abs(offsetMs);
  if (offset <= settings.stepPerfectMs + Number.EPSILON) return "perfect";
  if (offset <= settings.stepGreatMs + Number.EPSILON) return "great";
  if (offset <= settings.stepGoodMs + Number.EPSILON) return "good";
  if (type === "HORIZONTAL_SLIDE" && offsetMs < 0 && offset <= settings.stepGoodMs + settings.stepGreatMs + Number.EPSILON) return "good";
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
      ...this.judgeHorizontalSlides(),
      ...this.judgeVerticalSlides(),
      ...this.trackSustainedNotes(frame),
    ];
    results.push(...this.collectMisses(time, finish));
    const historyWindow = Math.max(
      (this.settings.stepGoodMs * 2 + this.settings.missGraceMs) / 1000,
      (this.settings.responseTimeoutMs + this.settings.stepGoodMs + this.settings.stepGreatMs) / 1000,
      ...this.notes
        .filter((note) => note.type === "VERTICAL_SLIDE")
        .map((note) => (note.duration ?? 1) + (this.settings.stepGoodMs * 2 + this.settings.missGraceMs) / 1000),
    );
    this.frames = this.frames.filter((candidate) => time - candidate.time <= historyWindow);
    return results;
  }

  private collectMisses(songTime: number, finish: boolean): JudgementResult[] {
    const misses: JudgementResult[] = [];
    for (const note of this.notes) {
      const goodWindow = note.type === "HORIZONTAL_SLIDE"
          ? this.settings.stepGoodMs + this.settings.responseTimeoutMs
          : note.type === "VERTICAL_SLIDE"
            ? (note.duration ?? 1) * 1000 + this.settings.stepGoodMs
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
    const goodWindow = this.settings.stepGoodMs / 1000;
    const judgingDelay = (this.settings.stepGoodMs + this.settings.missGraceMs) / 1000;

    for (const note of this.notes) {
      if (note.type !== "JUMP" || this.judgements.has(note.id) || time - note.time <= judgingDelay) continue;
      const frames = this.frames.filter((frame) => Math.abs(frame.time - note.time) <= goodWindow);
      const frame = jumpFrame(frames, note.time, this.settings);
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

  private judgeHorizontalSlides(): JudgementResult[] {
    const results: JudgementResult[] = [];
    for (const note of this.notes) {
      if (note.type !== "HORIZONTAL_SLIDE" || this.judgements.has(note.id)) continue;
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
            || !judgementForOffset(note.type, (start.time - note.time) * 1000, this.settings)
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
        judgementForOffset(note.type, (closest.time - note.time) * 1000, this.settings)!,
        closest.time - note.time,
      ));
    }
    return results;
  }

  private judgeVerticalSlides(): JudgementResult[] {
    const results: JudgementResult[] = [];
    const goodWindow = this.settings.stepGoodMs / 1000;

    for (const note of this.notes) {
      if (note.type !== "VERTICAL_SLIDE" || this.judgements.has(note.id)) continue;
      const endTime = note.time + (note.duration ?? 1);
      const feet: ("leftLane" | "rightLane")[] = note.foot === "right"
        ? ["rightLane"]
        : note.foot === "either"
          ? ["leftLane", "rightLane"]
          : ["leftLane"];
      let closest: { start: CameraFrame; end: CameraFrame } | undefined;

      for (const foot of feet) {
        for (const start of this.frames) {
          if (start[foot] !== note.lane || Math.abs(start.time - note.time) > goodWindow) continue;
          const end = this.frames
            .filter((candidate) => candidate[foot] === note.endLane && Math.abs(candidate.time - endTime) <= goodWindow)
            .sort((left, right) => Math.abs(left.time - endTime) - Math.abs(right.time - endTime))[0];
          if (!end) continue;
          if (
            !closest
            || Math.max(Math.abs(start.time - note.time), Math.abs(end.time - endTime))
              < Math.max(Math.abs(closest.start.time - note.time), Math.abs(closest.end.time - endTime))
          ) closest = { start, end };
        }
      }

      if (!closest) continue;
      const offset = Math.abs(closest.start.time - note.time) >= Math.abs(closest.end.time - endTime)
        ? closest.start.time - note.time
        : closest.end.time - endTime;
      results.push(this.applyJudgement(
        note,
        judgementForOffset("VERTICAL_SLIDE", offset * 1000, this.settings)!,
        offset,
      ));
    }
    return results;
  }

  private trackSustainedNotes(frame: CameraFrame): JudgementResult[] {
    const results: JudgementResult[] = [];
    for (const note of this.notes) {
      if (note.type !== "STAY" || this.judgements.has(note.id) || frame.time < note.time) continue;
      const duration = note.duration ?? 1;
      const expectedLane = note.lane!;
      const tracked = this.trackedSustainedNotes.get(note.id) ?? { onPath: true, started: false };
      if (footIsTracked(note.foot, frame)) tracked.onPath &&= footOccupiesLane(note.foot, expectedLane, frame);
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

function jumpFrame(
  frames: CameraFrame[],
  noteTime: number,
  settings: CalibrationSettings,
): CameraFrame | undefined {
  const leftSamples = frames.flatMap((frame) => frame.leftPoints ? [frame.leftPoints] : []);
  const rightSamples = frames.flatMap((frame) => frame.rightPoints ? [frame.rightPoints] : []);
  if (leftSamples.length < 2 || rightSamples.length < 2) return undefined;

  const leftGround = highestFootPosition(leftSamples);
  const rightGround = highestFootPosition(rightSamples);
  return frames
    .filter((frame) => (
      footIsRaised(frame.leftPoints, leftGround, settings.stepLift)
      && footIsRaised(frame.rightPoints, rightGround, settings.stepLift)
    ))
    .sort((a, b) => Math.abs(a.time - noteTime) - Math.abs(b.time - noteTime))[0];
}

function highestFootPosition(samples: number[][]): number[] {
  return [0, 1, 2].map((point) => Math.max(...samples.map((sample) => sample[point])));
}

function footIsRaised(points: number[] | null, ground: number[], lift: number): boolean {
  return points !== null && points.filter((point, index) => ground[index] - point > lift).length >= 2;
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
): boolean {
  const samples = frames.flatMap((frame) => frame[foot] ? [frame[foot]] : []);
  if (samples.length < 2) return false;
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
    return ground - peak > settings.stepLift
      && samples.slice(peakAt + 1).some((sample) => (
        sample[point] > ground - settings.stepLanding
        || sample[point] - peak > settings.stepDescent
      ));
  }).length >= 2;
}

function footOccupiesLane(foot: Foot, lane: number, frame: CameraFrame): boolean {
  if (foot === "left") return frame.leftLane === lane;
  if (foot === "right") return frame.rightLane === lane;
  if (foot === "both") return frame.leftLane === lane && frame.rightLane === lane;
  return frame.leftLane === lane || frame.rightLane === lane;
}

function footIsTracked(foot: Foot, frame: CameraFrame): boolean {
  if (foot === "left") return frame.leftLane !== null;
  if (foot === "right") return frame.rightLane !== null;
  if (foot === "both") return frame.leftLane !== null && frame.rightLane !== null;
  return frame.leftLane !== null || frame.rightLane !== null;
}
