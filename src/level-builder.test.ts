import { describe, expect, it } from "vitest";
import {
  createTimelineNote,
  moveTimelineNote,
  moveTimelineNotes,
  nextTimelineZoom,
  pasteTimelineNotes,
  sampleWaveform,
  timelineNavigationNotes,
  timelineNotesInSelection,
  timelinePixelsPerSecond,
  timelineScrollTopAfterZoom,
  turnTimelineSlide,
} from "./level-builder.tsx";
import { slideBounds, stepBounds } from "./rhythm-engine.ts";

describe("level builder", () => {
  it("creates the requested move at an exact lane and time", () => {
    expect(createTimelineNote("n004", "RIGHT_STEP", 3, 12.375)).toEqual({
      id: "n004",
      time: 12.375,
      type: "STEP",
      lane: 3,
      stepPosition: 2,
      foot: "right",
    });
    expect(createTimelineNote("n005", "SLIDE_LEFT", 3, 13, 0)).toMatchObject({
      lane: 3,
      endLane: 1,
      slidePosition: 0,
      type: "SLIDE",
    });
  });

  it("reduces audio samples to visible amplitude peaks", () => {
    expect(sampleWaveform(new Float32Array([0, 0.5, -1, 0.25]), 2)).toEqual([0.5, 1]);
  });

  it("moves steps across lanes and time while keeping slides valid", () => {
    expect(moveTimelineNote(
      createTimelineNote("n001", "LEFT_STEP", 2, 4),
      2,
      1.25,
      30,
    )).toMatchObject({ lane: 4, time: 5.3 });

    expect(moveTimelineNote(
      createTimelineNote("n002", "SLIDE_LEFT", 3, 8),
      -2,
      -10,
      30,
    )).toMatchObject({ lane: 3, endLane: 1, time: 0 });
  });

  it("moves selected moves together without crushing their spacing at an edge", () => {
    const first = createTimelineNote("n001", "LEFT_STEP", 1, 4);
    const second = createTimelineNote("n002", "RIGHT_STEP", 3, 6);
    const moved = moveTimelineNotes([first, second], -4, -10, 30);

    expect(moved[0]).toMatchObject({ stepPosition: 0, time: 0 });
    expect(moved[1]).toMatchObject({ stepPosition: 2, time: 2 });
  });

  it("selects every move whose center is inside the drawn timeline box", () => {
    const first = createTimelineNote("n001", "LEFT_STEP", 1, 4);
    const second = createTimelineNote("n002", "RIGHT_STEP", 3, 6);

    expect(timelineNotesInSelection(
      [first, second],
      { left: 0, top: 350, width: 300, height: 300 },
      400,
      1000,
      100,
    )).toEqual(["n001", "n002"]);
  });

  it("pastes a copied group at a new lane and time with new IDs", () => {
    const copied = [
      createTimelineNote("n001", "LEFT_STEP", 1, 4),
      createTimelineNote("n002", "RIGHT_STEP", 2, 6),
    ];
    const pasted = pasteTimelineNotes(copied, copied, 2, 10, 30);

    expect(pasted).toMatchObject([
      { id: "n003", stepPosition: 2, time: 10 },
      { id: "n004", stepPosition: 3, time: 12 },
    ]);
  });

  it("moves steps in half-lane steps and keeps the whole step inside the track", () => {
    const step = createTimelineNote("n001", "LEFT_STEP", 2, 4);

    expect(stepBounds(moveTimelineNote(step, 0.5, 0, 30))).toEqual({ left: 1.5, right: 2.5 });
    expect(stepBounds(moveTimelineNote(step, 10, 0, 30))).toEqual({ left: 3, right: 4 });
  });

  it("keeps every slide the same size and inside the lane borders", () => {
    const leftAtStart = createTimelineNote("n001", "SLIDE_LEFT", 1, 1, 0);
    const rightAtEnd = createTimelineNote("n002", "SLIDE_RIGHT", 4, 1, 0.5);

    expect(slideBounds(leftAtStart)).toEqual({ left: 0, right: 2 });
    expect(slideBounds(rightAtEnd)).toEqual({ left: 2, right: 4 });
    expect(rightAtEnd).toMatchObject({ lane: 2, endLane: 4 });
  });

  it("moves slides in half-lane steps without changing their size", () => {
    const slide = createTimelineNote("n001", "SLIDE_RIGHT", 1, 4);
    const moved = moveTimelineNote(slide, 0.5, 0, 30);

    expect(slideBounds(moved)).toEqual({ left: 1, right: 3 });
    expect(moved).toMatchObject({ lane: 2, endLane: 4, slidePosition: 1 });
  });

  it("turns a slide around without moving or changing its foot", () => {
    const slide = createTimelineNote("n001", "SLIDE_RIGHT", 2, 4);
    const turned = turnTimelineSlide(slide);

    expect(turned).toMatchObject({ lane: 4, endLane: 2, foot: "right" });
    expect(slideBounds(turned)).toEqual(slideBounds(slide));
  });

  it("keeps timestamp distance proportional while zooming", () => {
    expect(timelinePixelsPerSecond(0.5)).toBe(360);
    expect(timelinePixelsPerSecond(1)).toBe(720);
    expect(timelinePixelsPerSecond(2)).toBe(1440);
  });

  it("zooms out through the compact timeline levels", () => {
    expect(nextTimelineZoom(0.5, "out")).toBe(0.25);
    expect(nextTimelineZoom(0.25, "out")).toBe(0.1);
    expect(nextTimelineZoom(0.1, "out")).toBe(0.05);
    expect(nextTimelineZoom(0.05, "out")).toBe(0.02);
    expect(nextTimelineZoom(0.02, "in")).toBe(0.05);
  });

  it("keeps the same timeline time under the zoom anchor", () => {
    expect(timelineScrollTopAfterZoom(
      7200,
      3300,
      300,
      1,
      3600,
      0.5,
    )).toBe(1500);
  });

  it("navigates to the first and last chronological notes", () => {
    const middle = createTimelineNote("n002", "LEFT_STEP", 2, 10);
    const last = createTimelineNote("n003", "RIGHT_STEP", 3, 20);
    const first = createTimelineNote("n001", "LEFT_STEP", 1, 5);

    expect(timelineNavigationNotes([middle, last, first])).toEqual({ first, last });
    expect(timelineNavigationNotes([])).toEqual({ first: undefined, last: undefined });
  });
});
