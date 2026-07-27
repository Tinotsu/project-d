import { useEffect, useMemo, useRef, useState } from "react";
import horizontalLeftSlideUrl from "../assets/horizontal left slide.svg?url";
import horizontalRightSlideUrl from "../assets/horizontal right slide.svg?url";
import jumpUrl from "../assets/jump base.svg?url";
import leftStepUrl from "../assets/left base.svg?url";
import leftSlideUrl from "../assets/left slide.svg?url";
import leftStayUrl from "../assets/left stay.svg?url";
import rightStepUrl from "../assets/right base.svg?url";
import rightSlideUrl from "../assets/right slide.svg?url";
import rightStayUrl from "../assets/right stay.svg?url";
import { Button } from "./components/ui/button.tsx";
import type { LoadedLevel, LevelChart, SongMetadata } from "./level.ts";
import {
  horizontalSlideBounds,
  isSustainedNote,
  slideBounds,
  stepBounds,
  type ChartNote,
} from "./rhythm-engine.ts";

type LevelBuilderProps = {
  level: LoadedLevel;
  onBack: () => void;
  onSave: (level: LoadedLevel) => Promise<void>;
  onTest: (level: LoadedLevel) => void;
  onPlay: (level: LoadedLevel) => void;
};

type AddNoteType =
  | "LEFT_STEP"
  | "RIGHT_STEP"
  | "LEFT_STAY"
  | "RIGHT_STAY"
  | "LEFT_HORIZONTAL_SLIDE"
  | "RIGHT_HORIZONTAL_SLIDE"
  | "JUMP"
  | "SLIDE_LEFT"
  | "SLIDE_RIGHT";

type BuilderMenu =
  | { x: number; y: number; mode: "lane"; lane: number; laneOffset: 0 | 0.5; time: number }
  | { x: number; y: number; mode: "note"; noteId: string };

type NoteDrag = {
  notes: ChartNote[];
  pointerId: number;
  x: number;
  y: number;
};

type SustainedNoteResize = {
  edge: "start" | "end";
  note: ChartNote;
  pointerId: number;
  y: number;
};

type HorizontalSlideTurn = {
  edge: "start" | "end";
  note: ChartNote;
  pointerId: number;
  x: number;
  laneWidth: number;
};

type TimelineSelection = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type SelectionDrag = TimelineSelection & {
  pointerId: number;
  startX: number;
  startY: number;
};

const normalPixelsPerSecond = 720;
const timelineZoomLevels = [0.02, 0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3];

export function sampleWaveform(channel: Float32Array, barCount: number): number[] {
  const blockSize = Math.max(1, Math.floor(channel.length / barCount));
  return Array.from({ length: barCount }, (_, index) => {
    let peak = 0;
    const end = Math.min(channel.length, (index + 1) * blockSize);
    for (let sample = index * blockSize; sample < end; sample++) peak = Math.max(peak, Math.abs(channel[sample]));
    return peak;
  });
}

export function createTimelineNote(
  id: string,
  type: AddNoteType,
  lane: number,
  time: number,
  laneOffset?: 0 | 0.5,
): ChartNote {
  if (type === "JUMP") return { id, time, type: "JUMP", foot: "both" };
  if (type === "SLIDE_LEFT" || type === "SLIDE_RIGHT") {
    const pointsRight = type === "SLIDE_RIGHT";
    const slidePosition = Math.max(0, Math.min(2, lane - 1 + (laneOffset ?? 0.5) - (pointsRight ? 0 : 2)));
    const firstLane = Math.min(2, Math.floor(slidePosition + 1));
    return {
      id,
      time,
      type: "SLIDE",
      lane: pointsRight ? firstLane : firstLane + 2,
      endLane: pointsRight ? firstLane + 2 : firstLane,
      slidePosition,
      foot: pointsRight ? "right" : "left",
    };
  }
  if (type === "LEFT_HORIZONTAL_SLIDE" || type === "RIGHT_HORIZONTAL_SLIDE") {
    return {
      id,
      time,
      type: "HORIZONTAL_SLIDE",
      lane,
      endLane: lane,
      duration: 1,
      foot: type === "LEFT_HORIZONTAL_SLIDE" ? "left" : "right",
    };
  }
  const stepPosition = Math.max(0, Math.min(3, lane - 1 + (laneOffset ?? 0)));
  if (type === "LEFT_STAY" || type === "RIGHT_STAY") {
    return {
      id,
      time,
      type: "STAY",
      lane: Math.min(4, Math.floor(stepPosition + 1)),
      stepPosition,
      duration: 1,
      foot: type === "LEFT_STAY" ? "left" : "right",
    };
  }
  return {
    id,
    time,
    type: "STEP",
    lane: Math.min(4, Math.floor(stepPosition + 1)),
    stepPosition,
    foot: type === "LEFT_STEP" ? "left" : "right",
  };
}

export function moveTimelineNote(note: ChartNote, laneDelta: number, timeDelta: number, duration: number): ChartNote {
  const lastTime = isSustainedNote(note) ? duration - (note.duration ?? 1) : duration;
  const time = Number(Math.max(0, Math.min(lastTime, note.time + timeDelta)).toFixed(1));
  if (note.type === "JUMP") return { ...note, time };

  if (note.type === "HORIZONTAL_SLIDE") {
    const appliedLaneDelta = Math.sign(laneDelta) * Math.round(Math.abs(laneDelta));
    return {
      ...note,
      time,
      lane: note.lane! + appliedLaneDelta,
      endLane: note.endLane! + appliedLaneDelta,
    };
  }

  if (note.type === "SLIDE") {
    const slidePosition = Math.max(0, Math.min(2, slideBounds(note).left + laneDelta));
    const firstLane = Math.min(2, Math.floor(slidePosition + 1));
    return note.endLane! < note.lane!
      ? { ...note, time, lane: firstLane + 2, endLane: firstLane, slidePosition }
      : { ...note, time, lane: firstLane, endLane: firstLane + 2, slidePosition };
  }

  const stepPosition = Math.max(0, Math.min(3, stepBounds(note).left + laneDelta));
  return { ...note, time, lane: Math.min(4, Math.floor(stepPosition + 1)), stepPosition };
}

export function moveTimelineNotes(
  notes: ChartNote[],
  laneDelta: number,
  timeDelta: number,
  duration: number,
): ChartNote[] {
  if (!notes.length) return [];
  const minTime = Math.min(...notes.map((note) => note.time));
  const maxTime = Math.max(...notes.map((note) => note.time + (isSustainedNote(note) ? note.duration ?? 1 : 0)));
  const boundedTimeDelta = Math.max(-minTime, Math.min(duration - maxTime, timeDelta));
  const laneBounds = notes
    .filter((note) => note.type !== "JUMP")
    .map((note) => note.type === "SLIDE"
      ? slideBounds(note)
      : note.type === "HORIZONTAL_SLIDE" ? horizontalSlideBounds(note) : stepBounds(note));
  const boundedLaneDelta = laneBounds.length
    ? Math.max(
      -Math.min(...laneBounds.map((bounds) => bounds.left)),
      Math.min(4 - Math.max(...laneBounds.map((bounds) => bounds.right)), laneDelta),
    )
    : 0;
  return notes.map((note) => moveTimelineNote(note, boundedLaneDelta, boundedTimeDelta, duration));
}

export function resizeTimelineSustainedNote(
  note: ChartNote,
  pixelDelta: number,
  pixelsPerSecond: number,
  levelDuration: number,
  edge: "start" | "end",
): ChartNote {
  if (edge === "start") {
    const endTime = note.time + (note.duration ?? 1);
    const time = Math.max(0, Math.min(endTime - 0.1, note.time + pixelDelta / pixelsPerSecond));
    const roundedTime = Number(time.toFixed(1));
    return {
      ...note,
      time: roundedTime,
      duration: Number((endTime - roundedTime).toFixed(1)),
    };
  }
  const duration = Math.max(
    0.1,
    Math.min(levelDuration - note.time, (note.duration ?? 1) + pixelDelta / pixelsPerSecond),
  );
  return { ...note, duration: Number(duration.toFixed(1)) };
}

export function timelineNotesInSelection(
  notes: ChartNote[],
  selection: TimelineSelection,
  timelineWidth: number,
  timelineHeight: number,
  pixelsPerSecond: number,
): string[] {
  return notes.filter((note) => {
    const bounds = note.type === "STEP" || note.type === "STAY"
      ? stepBounds(note)
      : note.type === "SLIDE"
        ? slideBounds(note)
        : note.type === "HORIZONTAL_SLIDE" ? horizontalSlideBounds(note) : { left: 0, right: 4 };
    const x = (bounds.left + bounds.right) / 8 * timelineWidth;
    const y = timelineHeight - note.time * pixelsPerSecond;
    return x >= selection.left
      && x <= selection.left + selection.width
      && y >= selection.top
      && y <= selection.top + selection.height;
  }).map((note) => note.id);
}

export function pasteTimelineNotes(
  copiedNotes: ChartNote[],
  existingNotes: ChartNote[],
  lanePosition: number,
  time: number,
  duration: number,
): ChartNote[] {
  if (!copiedNotes.length) return [];
  const laneBounds = copiedNotes
    .filter((note) => note.type !== "JUMP")
    .map((note) => note.type === "SLIDE"
      ? slideBounds(note)
      : note.type === "HORIZONTAL_SLIDE" ? horizontalSlideBounds(note) : stepBounds(note));
  const left = laneBounds.length ? Math.min(...laneBounds.map((bounds) => bounds.left)) : lanePosition;
  const firstTime = Math.min(...copiedNotes.map((note) => note.time));
  const movedNotes = moveTimelineNotes(copiedNotes, lanePosition - left, time - firstTime, duration);
  let nextNumber = Math.max(0, ...existingNotes.map((note) => Number(note.id.match(/\d+/)?.[0] ?? 0))) + 1;
  return movedNotes.map((note) => ({
    ...note,
    id: `n${String(nextNumber++).padStart(3, "0")}`,
  }));
}

export function turnTimelineSlide(note: ChartNote): ChartNote {
  return { ...note, lane: note.endLane, endLane: note.lane };
}

export function turnTimelineHorizontalSlide(
  note: ChartNote,
  laneDelta: number,
  edge: "start" | "end",
): ChartNote {
  const lane = Math.max(1, Math.min(4, (edge === "start" ? note.lane! : note.endLane!) + laneDelta));
  return edge === "start" ? { ...note, lane } : { ...note, endLane: lane };
}

export function timelinePixelsPerSecond(zoom: number): number {
  return normalPixelsPerSecond * zoom;
}

export function nextTimelineZoom(zoom: number, direction: "in" | "out"): number {
  const index = timelineZoomLevels.indexOf(zoom);
  return timelineZoomLevels[Math.max(0, Math.min(timelineZoomLevels.length - 1, index + (direction === "in" ? 1 : -1)))];
}

export function timelineScrollTopAfterZoom(
  scrollHeight: number,
  scrollTop: number,
  anchorY: number,
  currentZoom: number,
  nextScrollHeight: number,
  nextZoom: number,
): number {
  const anchorTime = (scrollHeight - scrollTop - anchorY) / timelinePixelsPerSecond(currentZoom);
  return nextScrollHeight - anchorTime * timelinePixelsPerSecond(nextZoom) - anchorY;
}

export function timelineNavigationNotes(notes: ChartNote[]): {
  first: ChartNote | undefined;
  last: ChartNote | undefined;
} {
  const chronological = [...notes].sort((left, right) => left.time - right.time);
  return { first: chronological[0], last: chronological.at(-1) };
}

export function LevelBuilder({ level, onBack, onSave, onTest, onPlay }: LevelBuilderProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const noteDragRef = useRef<NoteDrag | undefined>(undefined);
  const sustainedNoteResizeRef = useRef<SustainedNoteResize | undefined>(undefined);
  const horizontalSlideTurnRef = useRef<HorizontalSlideTurn | undefined>(undefined);
  const selectionDragRef = useRef<SelectionDrag | undefined>(undefined);
  const [chart, setChart] = useState<LevelChart>(() => structuredClone(level.chart));
  const [song, setSong] = useState<SongMetadata>(() => ({ ...level.song }));
  const [audioBlob, setAudioBlob] = useState(level.audioBlob);
  const [title, setTitle] = useState(level.song.title);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [playhead, setPlayhead] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [menu, setMenu] = useState<BuilderMenu>();
  const [selectedNoteIds, setSelectedNoteIds] = useState<string[]>([]);
  const [draggingNoteIds, setDraggingNoteIds] = useState<string[]>([]);
  const [selectionBox, setSelectionBox] = useState<TimelineSelection>();
  const [clipboard, setClipboard] = useState<ChartNote[]>([]);
  const [status, setStatus] = useState("");

  const duration = Math.max(30, Math.ceil(song.duration || chart.level.endTime || 60));
  const pixelsPerSecond = timelinePixelsPerSecond(zoom);
  const timelineHeight = Math.max(1500, duration * pixelsPerSecond);
  const notes = useMemo(() => [...chart.notes].sort((left, right) => right.time - left.time), [chart.notes]);
  const moveCount = notes.filter((note) => note.type !== "STAY").length;
  const stayCount = notes.length - moveCount;
  const navigationNotes = useMemo(() => timelineNavigationNotes(chart.notes), [chart.notes]);
  const selectedNote = chart.notes.find((note) => note.id === selectedNoteIds.at(-1));
  const markers = Array.from({ length: Math.floor(duration / 5) + 1 }, (_, index) => index * 5);

  useEffect(() => {
    navigateToNote(navigationNotes.first);
  }, []);

  useEffect(() => {
    const dismissMenu = () => setMenu(undefined);
    window.addEventListener("click", dismissMenu);
    return () => window.removeEventListener("click", dismissMenu);
  }, []);

  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline) return;
    const zoomTimeline = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const pointerY = event.clientY - timeline.getBoundingClientRect().top;
      changeTimelineZoom(event.deltaY < 0 ? "in" : "out", pointerY);
    };
    timeline.addEventListener("wheel", zoomTimeline, { passive: false });
    return () => timeline.removeEventListener("wheel", zoomTimeline);
  }, []);

  useEffect(() => {
    if (!song.audio) return;
    let cancelled = false;
    (audioBlob ? audioBlob.arrayBuffer() : fetch(song.audio).then((response) => response.arrayBuffer()))
      .then(async (data) => {
        const context = new AudioContext();
        const buffer = await context.decodeAudioData(data);
        if (!cancelled) setPeaks(sampleWaveform(buffer.getChannelData(0), 240));
        await context.close();
      })
      .catch(() => setPeaks([]));
    return () => {
      cancelled = true;
    };
  }, [audioBlob, song.audio]);

  useEffect(() => {
    const resize = (event: PointerEvent) => resizeSustainedNote(event);
    const endResize = (event: PointerEvent) => endSustainedNoteResize(event);
    const turn = (event: PointerEvent) => turnHorizontalSlide(event);
    const endTurn = (event: PointerEvent) => endHorizontalSlideTurn(event);
    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", endResize);
    window.addEventListener("pointercancel", endResize);
    window.addEventListener("pointermove", turn);
    window.addEventListener("pointerup", endTurn);
    window.addEventListener("pointercancel", endTurn);
    return () => {
      window.removeEventListener("pointermove", resize);
      window.removeEventListener("pointerup", endResize);
      window.removeEventListener("pointercancel", endResize);
      window.removeEventListener("pointermove", turn);
      window.removeEventListener("pointerup", endTurn);
      window.removeEventListener("pointercancel", endTurn);
    };
  }, [duration, pixelsPerSecond]);

  function builtLevel(): LoadedLevel {
    const id = title.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "untitled-level";
    return {
      path: level.path,
      song: { ...song, id, title },
      audioBlob,
      chart: {
        ...chart,
        level: { ...chart.level, id, endTime: song.duration || chart.level.endTime },
        notes: [...chart.notes].sort((left, right) => left.time - right.time),
      },
    };
  }

  async function uploadMusic(file: File): Promise<void> {
    const audioUrl = URL.createObjectURL(file);
    const context = new AudioContext();
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    const nextTitle = title === "Untitled level" ? file.name.replace(/\.[^.]+$/, "") : title;
    setSong((current) => ({ ...current, title: nextTitle, audio: audioUrl, duration: buffer.duration }));
    setAudioBlob(file);
    setTitle(nextTitle);
    setChart((current) => ({ ...current, level: { ...current.level, endTime: buffer.duration } }));
    setPeaks(sampleWaveform(buffer.getChannelData(0), 240));
    setStatus(`${file.name} ready`);
    await context.close();
  }

  function addNote(type: AddNoteType, lane: number, laneOffset: 0 | 0.5, time: number): void {
    const nextNumber = Math.max(0, ...chart.notes.map((note) => Number(note.id.match(/\d+/)?.[0] ?? 0))) + 1;
    const note = createTimelineNote(
      `n${String(nextNumber).padStart(3, "0")}`,
      type,
      lane,
      Number(time.toFixed(1)),
      laneOffset,
    );
    setChart((current) => ({ ...current, notes: [...current.notes, note] }));
    setSelectedNoteIds([note.id]);
    setMenu(undefined);
  }

  function updateNote(id: string, patch: Partial<ChartNote>): void {
    setChart((current) => ({
      ...current,
      notes: current.notes.map((note) => note.id === id ? { ...note, ...patch } : note),
    }));
  }

  function removeSelectedNotes(): void {
    setChart((current) => ({
      ...current,
      notes: current.notes.filter((note) => !selectedNoteIds.includes(note.id)),
    }));
    setSelectedNoteIds([]);
    setMenu(undefined);
  }

  function turnSlide(note: ChartNote): void {
    const turned = turnTimelineSlide(note);
    updateNote(note.id, {
      lane: turned.lane,
      endLane: turned.endLane,
    });
    setMenu(undefined);
  }

  function openLaneMenu(event: React.MouseEvent, lane: number): void {
    event.preventDefault();
    const laneBox = event.currentTarget.getBoundingClientRect();
    const time = Math.max(0, Math.min(duration, (laneBox.bottom - event.clientY) / pixelsPerSecond));
    const laneOffset = event.clientX - laneBox.left < laneBox.width / 2 ? 0 : 0.5;
    setMenu({ x: event.clientX, y: event.clientY, mode: "lane", lane, laneOffset, time });
  }

  function openNoteMenu(event: React.MouseEvent, noteId: string): void {
    event.preventDefault();
    event.stopPropagation();
    if (!selectedNoteIds.includes(noteId)) {
      setSelectedNoteIds([noteId]);
    }
    setMenu({ x: event.clientX, y: event.clientY, mode: "note", noteId });
  }

  function selectNote(note: ChartNote): void {
    setSelectedNoteIds([note.id]);
    if (audioRef.current) audioRef.current.currentTime = note.time;
    setPlayhead(note.time);
  }

  function navigateToNote(note: ChartNote | undefined): void {
    const timeline = timelineRef.current;
    if (!timeline) return;
    if (!note) {
      timeline.scrollTop = timeline.scrollHeight;
      return;
    }

    selectNote(note);
    timeline.scrollTop = timeline.scrollHeight - note.time * pixelsPerSecond - timeline.clientHeight / 2;
  }

  function changeTimelineZoom(direction: "in" | "out" | "normal", anchorY?: number): void {
    const timeline = timelineRef.current;
    if (!timeline) return;
    const oldScrollHeight = timeline.scrollHeight;
    const oldScrollTop = timeline.scrollTop;
    const zoomAnchorY = anchorY ?? timeline.clientHeight / 2;

    setZoom((current) => {
      const nextZoom = direction === "normal" ? 1 : nextTimelineZoom(current, direction);
      requestAnimationFrame(() => {
        timeline.scrollTop = timelineScrollTopAfterZoom(
          oldScrollHeight,
          oldScrollTop,
          zoomAnchorY,
          current,
          timeline.scrollHeight,
          nextZoom,
        );
      });
      return nextZoom;
    });
  }

  function startNoteDrag(event: React.PointerEvent<HTMLButtonElement>, note: ChartNote): void {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const draggedIds = selectedNoteIds.includes(note.id) ? selectedNoteIds : [note.id];
    noteDragRef.current = {
      notes: chart.notes.filter((candidate) => draggedIds.includes(candidate.id)),
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
    setSelectedNoteIds(draggedIds);
    setDraggingNoteIds(draggedIds);
    setMenu(undefined);
  }

  function dragNote(event: React.PointerEvent<HTMLDivElement>): void {
    const drag = noteDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const laneWidth = event.currentTarget.getBoundingClientRect().width / 4;
    const laneDelta = Math.round((event.clientX - drag.x) / (laneWidth / 2)) * 0.5;
    const movedNotes = moveTimelineNotes(
      drag.notes,
      laneDelta,
      (drag.y - event.clientY) / pixelsPerSecond,
      duration,
    );
    const movedById = new Map(movedNotes.map((note) => [note.id, note]));
    setChart((current) => ({
      ...current,
      notes: current.notes.map((note) => movedById.get(note.id) ?? note),
    }));
  }

  function endNoteDrag(event: React.PointerEvent<HTMLDivElement>): void {
    if (noteDragRef.current?.pointerId !== event.pointerId) return;
    noteDragRef.current = undefined;
    setDraggingNoteIds([]);
  }

  function startSustainedNoteResize(
    event: React.PointerEvent<HTMLSpanElement>,
    note: ChartNote,
    edge: "start" | "end",
  ): void {
    event.preventDefault();
    event.stopPropagation();
    sustainedNoteResizeRef.current = { edge, note, pointerId: event.pointerId, y: event.clientY };
    setSelectedNoteIds([note.id]);
    setMenu(undefined);
  }

  function resizeSustainedNote(event: { pointerId: number; clientY: number }): void {
    const resize = sustainedNoteResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    const resized = resizeTimelineSustainedNote(
      resize.note,
      resize.y - event.clientY,
      pixelsPerSecond,
      duration,
      resize.edge,
    );
    updateNote(resize.note.id, { time: resized.time, duration: resized.duration });
  }

  function endSustainedNoteResize(event: { pointerId: number; clientY: number }): void {
    if (sustainedNoteResizeRef.current?.pointerId !== event.pointerId) return;
    resizeSustainedNote(event);
    sustainedNoteResizeRef.current = undefined;
  }

  function startHorizontalSlideTurn(
    event: React.PointerEvent<HTMLSpanElement>,
    note: ChartNote,
    edge: "start" | "end",
  ): void {
    event.preventDefault();
    event.stopPropagation();
    const lanes = event.currentTarget.closest(".timeline-lanes")!;
    horizontalSlideTurnRef.current = {
      edge,
      note,
      pointerId: event.pointerId,
      x: event.clientX,
      laneWidth: lanes.getBoundingClientRect().width / 4,
    };
    setSelectedNoteIds([note.id]);
    setMenu(undefined);
  }

  function turnHorizontalSlide(event: { pointerId: number; clientX: number }): void {
    const turn = horizontalSlideTurnRef.current;
    if (!turn || turn.pointerId !== event.pointerId) return;
    const turned = turnTimelineHorizontalSlide(
      turn.note,
      Math.round((event.clientX - turn.x) / turn.laneWidth),
      turn.edge,
    );
    updateNote(turn.note.id, turn.edge === "start" ? { lane: turned.lane } : { endLane: turned.endLane });
  }

  function endHorizontalSlideTurn(event: { pointerId: number; clientX: number }): void {
    if (horizontalSlideTurnRef.current?.pointerId !== event.pointerId) return;
    turnHorizontalSlide(event);
    horizontalSlideTurnRef.current = undefined;
  }

  function startTimelineSelection(event: React.PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const startX = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left));
    const startY = Math.max(0, Math.min(bounds.height, event.clientY - bounds.top));
    event.currentTarget.setPointerCapture(event.pointerId);
    selectionDragRef.current = {
      pointerId: event.pointerId,
      startX,
      startY,
      left: startX,
      top: startY,
      width: 0,
      height: 0,
    };
    setSelectedNoteIds([]);
    setSelectionBox({ left: startX, top: startY, width: 0, height: 0 });
    setMenu(undefined);
  }

  function dragTimelineSelection(event: React.PointerEvent<HTMLDivElement>): void {
    const drag = selectionDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left));
    const y = Math.max(0, Math.min(bounds.height, event.clientY - bounds.top));
    const selection = {
      left: Math.min(drag.startX, x),
      top: Math.min(drag.startY, y),
      width: Math.abs(x - drag.startX),
      height: Math.abs(y - drag.startY),
    };
    selectionDragRef.current = { ...drag, ...selection };
    const selectedIds = timelineNotesInSelection(
      chart.notes,
      selection,
      bounds.width,
      bounds.height,
      pixelsPerSecond,
    );
    setSelectionBox(selection);
    setSelectedNoteIds(selectedIds);
  }

  function endTimelineSelection(event: React.PointerEvent<HTMLDivElement>): void {
    if (selectionDragRef.current?.pointerId !== event.pointerId) return;
    dragTimelineSelection(event);
    selectionDragRef.current = undefined;
    setSelectionBox(undefined);
  }

  function copySelectedNotes(cut: boolean): void {
    const copiedNotes = chart.notes.filter((note) => selectedNoteIds.includes(note.id));
    setClipboard(structuredClone(copiedNotes));
    if (cut) {
      setChart((current) => ({
        ...current,
        notes: current.notes.filter((note) => !selectedNoteIds.includes(note.id)),
      }));
      setSelectedNoteIds([]);
    }
    setMenu(undefined);
  }

  function pasteNotes(lane: number, laneOffset: 0 | 0.5, time: number): void {
    const pastedNotes = pasteTimelineNotes(clipboard, chart.notes, lane - 1 + laneOffset, time, duration);
    setChart((current) => ({ ...current, notes: [...current.notes, ...pastedNotes] }));
    setSelectedNoteIds(pastedNotes.map((note) => note.id));
    setMenu(undefined);
  }

  async function save(): Promise<void> {
    setStatus("Saving…");
    try {
      await onSave(builtLevel());
      setStatus("Saved just now");
    } catch {
      setStatus("Could not save");
    }
  }

  const menuNote = menu?.mode === "note" ? chart.notes.find((note) => note.id === menu.noteId) : undefined;

  return (
    <main className="builder-screen">
      <header className="builder-header">
        <div className="builder-title">
          <Button variant="ghost" size="sm" onClick={onBack}>← Home</Button>
          <span>LEVEL BUILDER</span>
          <input aria-label="Level title" value={title} onChange={(event) => setTitle(event.target.value)} />
          {status && <small>{status}</small>}
        </div>
        <div className="builder-actions">
          <Button variant="outline" onClick={() => onTest(builtLevel())}>▶ Test level</Button>
          <Button variant="outline" onClick={() => onPlay(builtLevel())}>▶ Play level</Button>
          <Button onClick={save}>Save</Button>
        </div>
      </header>

      <div className="builder-workspace">
        <aside className="builder-side builder-audio">
          <section>
            <div className="builder-section-heading">
              <span>MUSIC</span>
              <small>MP3</small>
            </div>
            <label
              className="music-drop"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const file = event.dataTransfer.files[0];
                if (file) void uploadMusic(file);
              }}
            >
              <input
                type="file"
                accept="audio/*"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void uploadMusic(file);
                }}
              />
              <strong>＋ Upload music</strong>
              <span>Drop an audio file or click to choose</span>
            </label>
            {song.audio && (
              <audio
                ref={audioRef}
                src={song.audio}
                controls
                onTimeUpdate={(event) => setPlayhead(event.currentTarget.currentTime)}
              />
            )}
          </section>

          <section>
            <div className="builder-section-heading"><span>AMPLITUDE</span><small>{formatTime(playhead)}</small></div>
            <div className="waveform-overview" aria-label="Music amplitude overview">
              {(peaks.length ? peaks.slice(0, 72) : Array(72).fill(0.08)).map((peak, index) => (
                <i key={index} style={{ height: `${Math.max(8, peak * 100)}%` }} />
              ))}
              <b style={{ left: `${Math.min(100, playhead / duration * 100)}%` }} />
            </div>
          </section>

          <section className="builder-details">
            <div className="builder-section-heading"><span>LEVEL DETAILS</span></div>
            <label>BPM<input type="number" min="1" value={chart.timing.bpm} onChange={(event) => setChart({ ...chart, timing: { ...chart.timing, bpm: event.target.valueAsNumber } })} /></label>
            <label>Offset<input type="number" step="0.001" value={chart.timing.offset} onChange={(event) => setChart({ ...chart, timing: { ...chart.timing, offset: event.target.valueAsNumber } })} /></label>
            <label>Difficulty
              <select value={chart.level.difficulty} onChange={(event) => setChart({ ...chart, level: { ...chart.level, difficulty: event.target.value } })}>
                <option>Easy</option>
                <option>Normal</option>
                <option>Hard</option>
                <option>Expert</option>
              </select>
            </label>
          </section>

          <section className="builder-legend">
            <div className="builder-section-heading"><span>QUICK GUIDE</span></div>
            <p><strong>Drag empty space</strong> to select multiple moves.</p>
            <p><strong>Right-click</strong> any lane to add a move.</p>
            <p><strong>Drag a selected move</strong> to move the group.</p>
            <p><strong>Right-click selected moves</strong> to copy, cut, or delete.</p>
            <div><i className="legend-left" />Left <i className="legend-right" />Right <i className="legend-jump" />Jump</div>
          </section>
        </aside>

        <section className="timeline-panel">
          <div className="timeline-toolbar">
            <div>
              <strong>LEVEL TIMELINE</strong>
              <span>{moveCount} moves · {stayCount} stays · {selectedNoteIds.length} selected · {formatTime(duration)}</span>
            </div>
            <div className="timeline-toolbar-actions">
              <span className="scroll-hint">CTRL + SCROLL TO ZOOM</span>
              <div className="zoom-controls" aria-label="Timeline zoom">
                <button type="button" aria-label="Zoom out" onClick={() => changeTimelineZoom("out")}>−</button>
                <output>{Math.round(zoom * 100)}%</output>
                <button type="button" className="zoom-normal" onClick={() => changeTimelineZoom("normal")}>Normal</button>
                <button type="button" aria-label="Zoom in" onClick={() => changeTimelineZoom("in")}>＋</button>
              </div>
              <div className="timeline-navigation" aria-label="Timeline navigation">
                <button type="button" disabled={!navigationNotes.first} onClick={() => navigateToNote(navigationNotes.first)}>Start</button>
                <button type="button" disabled={!navigationNotes.last} onClick={() => navigateToNote(navigationNotes.last)}>End</button>
              </div>
            </div>
          </div>
          <div className="lane-headings">
            <span>WAVE</span>
            {[1, 2, 3, 4].map((lane) => <span key={lane}>LANE {lane}</span>)}
          </div>
          <div ref={timelineRef} className="timeline-scroll">
            <div className="timeline-canvas" style={{ height: timelineHeight }}>
              <div className="timeline-wave">
                {(peaks.length ? peaks : Array(240).fill(0.08)).map((peak, index) => (
                  <i
                    key={index}
                    style={{
                      bottom: `${index / 239 * 100}%`,
                      width: `${Math.max(8, peak * 100)}%`,
                    }}
                  />
                ))}
                {markers.map((time) => <span key={time} style={{ bottom: time * pixelsPerSecond }}>{formatTime(time)}</span>)}
              </div>

              <div
                className="timeline-lanes"
                onPointerDown={startTimelineSelection}
                onPointerMove={(event) => {
                  dragNote(event);
                  dragTimelineSelection(event);
                }}
                onPointerUp={(event) => {
                  endNoteDrag(event);
                  endTimelineSelection(event);
                }}
                onPointerCancel={(event) => {
                  endNoteDrag(event);
                  endTimelineSelection(event);
                }}
              >
                {markers.map((time) => <i className="time-gridline" key={time} style={{ bottom: time * pixelsPerSecond }} />)}
                <div className="timeline-playhead" style={{ bottom: playhead * pixelsPerSecond }}><span>{formatTime(playhead)}</span></div>
                {[1, 2, 3, 4].map((lane) => (
                  <div className="timeline-lane" key={lane} onContextMenu={(event) => openLaneMenu(event, lane)} />
                ))}
                {selectionBox && (
                  <div
                    className="timeline-selection"
                    style={{
                      left: selectionBox.left,
                      top: selectionBox.top,
                      width: selectionBox.width,
                      height: selectionBox.height,
                    }}
                  />
                )}
                {notes.map((note) => {
                  let left = 0;
                  let width = 100;
                  let horizontalSlideSpan = 1;
                  let horizontalSlideTransform: string | undefined;
                  let horizontalSlideTop = 50;
                  let horizontalSlideBottom = 50;
                  if (note.type === "STEP" || note.type === "STAY") {
                    const bounds = stepBounds(note);
                    left = bounds.left * 25;
                    width = (bounds.right - bounds.left) * 25;
                  } else if (note.type === "SLIDE") {
                    const bounds = slideBounds(note);
                    left = bounds.left * 25;
                    width = (bounds.right - bounds.left) * 25;
                  } else if (note.type === "HORIZONTAL_SLIDE") {
                    const bounds = horizontalSlideBounds(note);
                    const span = bounds.right - bounds.left;
                    left = bounds.left * 25;
                    width = span * 25;
                    const bottomLeft = note.lane! - 1 - bounds.left;
                    const topLeft = note.endLane! - 1 - bounds.left;
                    horizontalSlideSpan = span;
                    horizontalSlideTransform = `matrix(1 0 ${bottomLeft - topLeft} 1 ${topLeft} 0)`;
                    horizontalSlideTop = (topLeft + 0.5) / span * 100;
                    horizontalSlideBottom = (bottomLeft + 0.5) / span * 100;
                  }
                  const asset = note.type === "JUMP"
                    ? jumpUrl
                    : note.type === "SLIDE"
                      ? note.foot === "left" ? leftSlideUrl : rightSlideUrl
                      : note.type === "HORIZONTAL_SLIDE"
                        ? note.foot === "left" ? horizontalLeftSlideUrl : horizontalRightSlideUrl
                      : note.type === "STAY"
                        ? note.foot === "left" ? leftStayUrl : rightStayUrl
                        : note.foot === "left" ? leftStepUrl : rightStepUrl;
                  return (
                    <button
                      type="button"
                      aria-label={`${note.type} at ${note.time.toFixed(1)} seconds`}
                      className={`timeline-note ${note.type.toLowerCase()} ${note.foot} ${selectedNoteIds.includes(note.id) ? "selected" : ""} ${draggingNoteIds.includes(note.id) ? "dragging" : ""}`}
                      data-direction={note.type === "SLIDE" && note.endLane! < note.lane! ? "left" : "right"}
                      key={note.id}
                      style={{
                        bottom: note.time * pixelsPerSecond,
                        left: `${left}%`,
                        width: `${width}%`,
                        height: isSustainedNote(note) ? (note.duration ?? 1) * pixelsPerSecond : undefined,
                        transform: isSustainedNote(note) ? undefined : `translateY(50%) scaleY(${zoom})`,
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (!selectedNoteIds.includes(note.id)) selectNote(note);
                      }}
                      onContextMenu={(event) => openNoteMenu(event, note.id)}
                      onPointerDown={(event) => startNoteDrag(event, note)}
                    >
                      {horizontalSlideTransform
                        ? (
                          <svg viewBox={`0 0 ${horizontalSlideSpan} 1`} preserveAspectRatio="none" aria-hidden="true">
                            <image
                              href={asset}
                              width="1"
                              height="1"
                              preserveAspectRatio="none"
                              transform={horizontalSlideTransform}
                            />
                          </svg>
                        )
                        : <img src={asset} alt="" />}
                      {note.type === "HORIZONTAL_SLIDE" && (
                        <>
                          <span
                            className="horizontal-slide-turn-handle top"
                            style={{ left: `${horizontalSlideTop}%` }}
                            title="Drag to turn the end lane"
                            onPointerDown={(event) => startHorizontalSlideTurn(event, note, "end")}
                          />
                          <span
                            className="horizontal-slide-turn-handle bottom"
                            style={{ left: `${horizontalSlideBottom}%` }}
                            title="Drag to turn the start lane"
                            onPointerDown={(event) => startHorizontalSlideTurn(event, note, "start")}
                          />
                        </>
                      )}
                      {isSustainedNote(note) && (
                        <>
                          <span
                            className="stay-resize-handle top"
                            title="Drag to change end time"
                            onPointerDown={(event) => startSustainedNoteResize(event, note, "end")}
                          />
                          <span
                            className="stay-resize-handle bottom"
                            title="Drag to change start time"
                            onPointerDown={(event) => startSustainedNoteResize(event, note, "start")}
                          />
                        </>
                      )}
                      {note.type === "SLIDE" && <span>{note.endLane! < note.lane! ? "↖" : "↗"}</span>}
                    </button>
                  );
                })}
              </div>
              <div className="timeline-start"><span>START</span><b>0:00</b></div>
            </div>
          </div>
        </section>

        <aside className="builder-side note-inspector">
          <div className="builder-section-heading">
            <span>ALL ITEMS</span>
            <small>{notes.length}</small>
          </div>
          <div className="note-list">
            {notes.length === 0 && <p className="empty-notes">Right-click the timeline to add your first move.</p>}
            {notes.map((note, index) => (
              <article className={selectedNoteIds.includes(note.id) ? "selected" : ""} key={note.id} onClick={() => selectNote(note)}>
                <div className={`note-index ${note.type.toLowerCase()} ${note.foot}`}>{String(notes.length - index).padStart(2, "0")}</div>
                <div>
                  <strong>
                    {note.type === "STEP" || isSustainedNote(note)
                      ? `${note.foot} ${note.type.toLowerCase().replace("_", " ")}`
                      : note.type.toLowerCase()}
                  </strong>
                  <span>
                    {note.type === "JUMP"
                      ? "All lanes"
                      : `Lane ${note.lane}${note.type === "SLIDE" || note.type === "HORIZONTAL_SLIDE" ? ` → ${note.endLane}` : ""}`}
                  </span>
                </div>
                <label>
                  <span>TIME</span>
                  <input
                    aria-label={`Time for ${note.id}`}
                    type="number"
                    min="0"
                    max={duration}
                    step="0.1"
                    value={note.time}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => updateNote(note.id, { time: event.target.valueAsNumber })}
                  />
                </label>
                {note.type === "SLIDE" && (
                  <>
                    <label>
                      <span>DIRECTION</span>
                      <select
                        value={note.endLane! < note.lane! ? "left" : "right"}
                        onClick={(event) => event.stopPropagation()}
                        onChange={() => turnSlide(note)}
                      >
                        <option value="left">Left</option>
                        <option value="right">Right</option>
                      </select>
                    </label>
                  </>
                )}
                {note.type === "HORIZONTAL_SLIDE" && (
                  <label>
                    <span>END LANE</span>
                    <select
                      value={note.endLane}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => updateNote(note.id, { endLane: Number(event.target.value) })}
                    >
                      {[1, 2, 3, 4].map((lane) => <option value={lane} key={lane}>{lane}</option>)}
                    </select>
                  </label>
                )}
                {isSustainedNote(note) && (
                  <label>
                    <span>DURATION</span>
                    <input
                      aria-label={`Duration for ${note.id}`}
                      type="number"
                      min="0.1"
                      max={duration - note.time}
                      step="0.1"
                      value={note.duration ?? 1}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => updateNote(note.id, { duration: event.target.valueAsNumber })}
                    />
                  </label>
                )}
              </article>
            ))}
          </div>
          {selectedNote && (
            <Button className="inspector-delete" variant="destructive" size="sm" onClick={removeSelectedNotes}>
              Delete {selectedNoteIds.length} selected {selectedNoteIds.length === 1 ? "item" : "items"}
            </Button>
          )}
        </aside>
      </div>

      {menu?.mode === "lane" && (
        <div
          className="builder-context-menu"
          style={{
            left: Math.max(8, Math.min(menu.x, window.innerWidth - 198)),
            top: Math.max(8, Math.min(menu.y, window.innerHeight - (clipboard.length ? 420 : 380))),
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <small>ADD AT {formatTime(menu.time)} · LANE {menu.lane} + {menu.laneOffset}</small>
          {clipboard.length > 0 && (
            <button onClick={() => pasteNotes(menu.lane, menu.laneOffset, menu.time)}>
              Paste {clipboard.length} {clipboard.length === 1 ? "move" : "moves"}
            </button>
          )}
          <button onClick={() => addNote("LEFT_STEP", menu.lane, menu.laneOffset, menu.time)}><i className="left" /> Left step</button>
          <button onClick={() => addNote("RIGHT_STEP", menu.lane, menu.laneOffset, menu.time)}><i className="right" /> Right step</button>
          <button onClick={() => addNote("LEFT_STAY", menu.lane, menu.laneOffset, menu.time)}><i className="left" /> Left stay</button>
          <button onClick={() => addNote("RIGHT_STAY", menu.lane, menu.laneOffset, menu.time)}><i className="right" /> Right stay</button>
          <button onClick={() => addNote("LEFT_HORIZONTAL_SLIDE", menu.lane, menu.laneOffset, menu.time)}><i className="left" /> Left horizontal slide</button>
          <button onClick={() => addNote("RIGHT_HORIZONTAL_SLIDE", menu.lane, menu.laneOffset, menu.time)}><i className="right" /> Right horizontal slide</button>
          <button onClick={() => addNote("JUMP", menu.lane, menu.laneOffset, menu.time)}><i className="jump" /> Jump</button>
          <button onClick={() => addNote("SLIDE_LEFT", menu.lane, menu.laneOffset, menu.time)}>↙ Slide left</button>
          <button onClick={() => addNote("SLIDE_RIGHT", menu.lane, menu.laneOffset, menu.time)}>↗ Slide right</button>
        </div>
      )}

      {menuNote && (
        <div
          className="builder-context-menu"
          style={{
            left: Math.max(8, Math.min(menu!.x, window.innerWidth - 198)),
            top: Math.max(8, Math.min(menu!.y, window.innerHeight - 190)),
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <small>{selectedNoteIds.length} SELECTED · {formatTime(menuNote.time)}</small>
          {selectedNoteIds.length === 1 && menuNote.type === "SLIDE" && <button onClick={() => turnSlide(menuNote)}>↻ Turn 180°</button>}
          <button onClick={() => copySelectedNotes(false)}>Copy</button>
          <button onClick={() => copySelectedNotes(true)}>Cut</button>
          <button className="danger" onClick={removeSelectedNotes}>× Delete</button>
        </div>
      )}
    </main>
  );
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${Math.floor(seconds % 60).toString().padStart(2, "0")}.${Math.floor(seconds % 1 * 10)}`;
}
