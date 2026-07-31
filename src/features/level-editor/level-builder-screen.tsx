import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Button } from "../../shared/ui/button.tsx";
import type { ChartNote, LoadedLevel, LevelChart, SongMetadata } from "../../domain/chart/types.ts";
import {
  horizontalSlideBounds,
  isSustainedNote,
  stepBounds,
  verticalSlideBounds,
} from "../../domain/chart/note-geometry.ts";
import {
  createTimelineNote,
  moveTimelineNotes,
  nextTimelineZoom,
  pasteTimelineNotes,
  resizeTimelineSustainedNote,
  sampleWaveform,
  timelineNavigationNotes,
  timelineNotesInSelection,
  timelinePixelsPerSecond,
  timelineScrollTopAfterZoom,
  turnTimelineSlide,
  turnTimelineVerticalSlide,
  type AddNoteType,
  type TimelineSelection,
} from "./editor-math.ts";

type LevelBuilderProps = {
  level: LoadedLevel;
  onBack: () => void;
  onSave: (level: LoadedLevel) => Promise<void>;
  onTest: (level: LoadedLevel) => void;
  onPlay: (level: LoadedLevel) => void;
};

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

type VerticalSlideTurn = {
  edge: "start" | "end";
  note: ChartNote;
  pointerId: number;
  x: number;
  laneWidth: number;
};

type SelectionDrag = TimelineSelection & {
  pointerId: number;
  startX: number;
  startY: number;
};

const timelineWheelZoomThreshold = 25;
const timelineZoomStorageKey = "floorrush-level-builder-zoom";
const timelineZoomLevels = [0.02, 0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3];

function loadTimelineZoom(): number {
  if (typeof localStorage === "undefined") return 1;
  const savedZoom = Number(localStorage.getItem(timelineZoomStorageKey));
  return timelineZoomLevels.includes(savedZoom) ? savedZoom : 1;
}

export function LevelBuilder({ level, onBack, onSave, onTest, onPlay }: LevelBuilderProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const wheelZoomDeltaRef = useRef(0);
  const noteDragRef = useRef<NoteDrag | undefined>(undefined);
  const sustainedNoteResizeRef = useRef<SustainedNoteResize | undefined>(undefined);
  const verticalSlideTurnRef = useRef<VerticalSlideTurn | undefined>(undefined);
  const selectionDragRef = useRef<SelectionDrag | undefined>(undefined);
  const [chart, setChart] = useState<LevelChart>(() => structuredClone(level.chart));
  const [song, setSong] = useState<SongMetadata>(() => ({ ...level.song }));
  const [audioBlob, setAudioBlob] = useState(level.audioBlob);
  const [title, setTitle] = useState(level.song.title);
  const [endTime, setEndTime] = useState(() => level.chart.level.endTime || Math.max(30, Math.ceil(level.song.duration || 60)));
  const [peaks, setPeaks] = useState<number[]>([]);
  const [playhead, setPlayhead] = useState(0);
  const [zoom, setZoom] = useState(loadTimelineZoom);
  const zoomRef = useRef(zoom);
  const [menu, setMenu] = useState<BuilderMenu>();
  const [selectedNoteIds, setSelectedNoteIds] = useState<string[]>([]);
  const [draggingNoteIds, setDraggingNoteIds] = useState<string[]>([]);
  const [selectionBox, setSelectionBox] = useState<TimelineSelection>();
  const [clipboard, setClipboard] = useState<ChartNote[]>([]);
  const [status, setStatus] = useState("");
  const [leftPanelWidth, setLeftPanelWidth] = useState(250);
  const [rightPanelWidth, setRightPanelWidth] = useState(320);

  const duration = endTime;
  const pixelsPerSecond = timelinePixelsPerSecond(zoom);
  const timelineHeight = Math.max(1500, duration * pixelsPerSecond);
  const notes = useMemo(() => [...chart.notes].sort((left, right) => right.time - left.time), [chart.notes]);
  const moveCount = notes.filter((note) => note.type !== "STAY").length;
  const stayCount = notes.length - moveCount;
  const navigationNotes = useMemo(() => timelineNavigationNotes(chart.notes), [chart.notes]);
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
      wheelZoomDeltaRef.current += event.deltaY;
      if (Math.abs(wheelZoomDeltaRef.current) < timelineWheelZoomThreshold) return;

      const pointerY = event.clientY - timeline.getBoundingClientRect().top;
      changeTimelineZoom(wheelZoomDeltaRef.current < 0 ? "in" : "out", pointerY);
      wheelZoomDeltaRef.current = 0;
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
    const turn = (event: PointerEvent) => turnVerticalSlide(event);
    const endTurn = (event: PointerEvent) => endVerticalSlideTurn(event);
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
        level: { ...chart.level, id, endTime },
        notes: [...chart.notes].sort((left, right) => left.time - right.time),
      },
    };
  }

  function startPanelResize(event: React.PointerEvent<HTMLDivElement>, panel: "left" | "right"): void {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = panel === "left" ? leftPanelWidth : rightPanelWidth;
    const resize = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      const nextWidth = panel === "left" ? startWidth + delta : startWidth - delta;
      (panel === "left" ? setLeftPanelWidth : setRightPanelWidth)(Math.max(180, Math.min(520, nextWidth)));
    };
    const stop = () => {
      window.removeEventListener("pointermove", resize);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }

  async function uploadMusic(file: File): Promise<void> {
    const audioUrl = URL.createObjectURL(file);
    const context = new AudioContext();
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    const nextTitle = title === "Untitled level" ? file.name.replace(/\.[^.]+$/, "") : title;
    setSong((current) => ({ ...current, title: nextTitle, audio: audioUrl, duration: buffer.duration }));
    setAudioBlob(file);
    setTitle(nextTitle);
    setEndTime(Math.max(30, Math.ceil(buffer.duration)));
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

  function changeTimelineZoom(direction: "in" | "out", anchorY?: number): void {
    const timeline = timelineRef.current;
    if (!timeline) return;
    const currentZoom = zoomRef.current;
    const nextZoom = nextTimelineZoom(currentZoom, direction);
    if (nextZoom === currentZoom) return;

    const oldScrollHeight = timeline.scrollHeight;
    const oldScrollTop = timeline.scrollTop;
    const zoomAnchorY = anchorY ?? timeline.clientHeight / 2;

    zoomRef.current = nextZoom;
    localStorage.setItem(timelineZoomStorageKey, String(nextZoom));
    flushSync(() => setZoom(nextZoom));
    timeline.scrollTop = timelineScrollTopAfterZoom(
      oldScrollHeight,
      oldScrollTop,
      zoomAnchorY,
      currentZoom,
      timeline.scrollHeight,
      nextZoom,
    );
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

  function startVerticalSlideTurn(
    event: React.PointerEvent<HTMLSpanElement>,
    note: ChartNote,
    edge: "start" | "end",
  ): void {
    event.preventDefault();
    event.stopPropagation();
    const lanes = event.currentTarget.closest(".timeline-lanes")!;
    verticalSlideTurnRef.current = {
      edge,
      note,
      pointerId: event.pointerId,
      x: event.clientX,
      laneWidth: lanes.getBoundingClientRect().width / 4,
    };
    setSelectedNoteIds([note.id]);
    setMenu(undefined);
  }

  function turnVerticalSlide(event: { pointerId: number; clientX: number }): void {
    const turn = verticalSlideTurnRef.current;
    if (!turn || turn.pointerId !== event.pointerId) return;
    const turned = turnTimelineVerticalSlide(
      turn.note,
      Math.round((event.clientX - turn.x) / turn.laneWidth),
      turn.edge,
    );
    updateNote(turn.note.id, turn.edge === "start" ? { lane: turned.lane } : { endLane: turned.endLane });
  }

  function endVerticalSlideTurn(event: { pointerId: number; clientX: number }): void {
    if (verticalSlideTurnRef.current?.pointerId !== event.pointerId) return;
    turnVerticalSlide(event);
    verticalSlideTurnRef.current = undefined;
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
        <aside className="builder-side builder-audio" style={{ width: leftPanelWidth }}>
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
          </section>

        </aside>

        <div className="panel-resizer" role="separator" aria-orientation="vertical" onPointerDown={(event) => startPanelResize(event, "left")} />

        <section className="timeline-panel">
          <div className="timeline-toolbar">
            <div>
              <strong>LEVEL TIMELINE</strong>
              <span>{moveCount} moves · {stayCount} stays · {selectedNoteIds.length} selected · {formatTime(duration)}</span>
            </div>
            <div className="timeline-toolbar-actions">
              <div className="zoom-controls" aria-label="Timeline zoom">
                <button type="button" aria-label="Zoom out" onClick={() => changeTimelineZoom("out")}>−</button>
                <output>{Math.round(zoom * 100)}%</output>
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
                  let verticalSlideClipPath: string | undefined;
                  let verticalSlideTop = 50;
                  let verticalSlideBottom = 50;
                  if (note.type === "STEP" || note.type === "STAY") {
                    const bounds = stepBounds(note);
                    left = bounds.left * 25;
                    width = (bounds.right - bounds.left) * 25;
                  } else if (note.type === "HORIZONTAL_SLIDE") {
                    const bounds = horizontalSlideBounds(note);
                    left = bounds.left * 25;
                    width = (bounds.right - bounds.left) * 25;
                  } else if (note.type === "VERTICAL_SLIDE") {
                    const bounds = verticalSlideBounds(note);
                    const span = bounds.right - bounds.left;
                    left = bounds.left * 25;
                    width = span * 25;
                    const bottomLeft = note.lane! - 1 - bounds.left;
                    const topLeft = note.endLane! - 1 - bounds.left;
                    verticalSlideTop = (topLeft + 0.5) / span * 100;
                    verticalSlideBottom = (bottomLeft + 0.5) / span * 100;
                    const halfLane = 50 / span;
                    verticalSlideClipPath = `polygon(
                      ${verticalSlideTop - halfLane}% 0%,
                      ${verticalSlideTop + halfLane}% 0%,
                      ${verticalSlideBottom + halfLane}% 100%,
                      ${verticalSlideBottom - halfLane}% 100%
                    )`;
                  }
                  return (
                    <button
                      type="button"
                      aria-label={`${note.type} at ${note.time.toFixed(1)} seconds`}
                      className={`timeline-note ${note.type.toLowerCase()} ${note.foot} ${selectedNoteIds.includes(note.id) ? "selected" : ""} ${draggingNoteIds.includes(note.id) ? "dragging" : ""}`}
                      data-direction={note.type === "HORIZONTAL_SLIDE" && note.endLane! < note.lane! ? "left" : "right"}
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
                      <span
                        className="timeline-note-asset"
                        style={{ clipPath: verticalSlideClipPath }}
                        aria-hidden="true"
                      />
                      {note.type === "VERTICAL_SLIDE" && (
                        <>
                          <span
                            className="horizontal-slide-turn-handle top"
                            style={{ left: `${verticalSlideTop}%` }}
                            title="Drag to turn the end lane"
                            onPointerDown={(event) => startVerticalSlideTurn(event, note, "end")}
                          />
                          <span
                            className="horizontal-slide-turn-handle bottom"
                            style={{ left: `${verticalSlideBottom}%` }}
                            title="Drag to turn the start lane"
                            onPointerDown={(event) => startVerticalSlideTurn(event, note, "start")}
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
                      {note.type === "HORIZONTAL_SLIDE" && (
                        <span className="slide-direction">{note.endLane! < note.lane! ? "↖" : "↗"}</span>
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="timeline-start"><span>START</span><b>0:00</b></div>
            </div>
          </div>
        </section>

        <div className="panel-resizer" role="separator" aria-orientation="vertical" onPointerDown={(event) => startPanelResize(event, "right")} />

        <aside className="builder-side note-inspector" style={{ width: rightPanelWidth }}>
          <div className="builder-section-heading">
            <span>ALL ITEMS</span>
            <small>{notes.length}</small>
          </div>
          <label className="level-end-time">
            LEVEL END (SECONDS)
            <input type="number" min="1" step="0.1" value={endTime} onChange={(event) => setEndTime(event.target.valueAsNumber)} />
          </label>
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
                      : `Lane ${note.lane}${note.type === "HORIZONTAL_SLIDE" || note.type === "VERTICAL_SLIDE" ? ` → ${note.endLane}` : ""}`}
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
                {note.type === "HORIZONTAL_SLIDE" && (
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
                {note.type === "VERTICAL_SLIDE" && (
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
          <button onClick={() => addNote("LEFT_STEP", menu.lane, menu.laneOffset, menu.time)}>Left step</button>
          <button onClick={() => addNote("RIGHT_STEP", menu.lane, menu.laneOffset, menu.time)}>Right step</button>
          <button onClick={() => addNote("LEFT_STAY", menu.lane, menu.laneOffset, menu.time)}>Left stay</button>
          <button onClick={() => addNote("RIGHT_STAY", menu.lane, menu.laneOffset, menu.time)}>Right stay</button>
          <button onClick={() => addNote("LEFT_VERTICAL_SLIDE", menu.lane, menu.laneOffset, menu.time)}>Left vertical slide</button>
          <button onClick={() => addNote("RIGHT_VERTICAL_SLIDE", menu.lane, menu.laneOffset, menu.time)}>Right vertical slide</button>
          <button onClick={() => addNote("JUMP", menu.lane, menu.laneOffset, menu.time)}>Jump</button>
          <button onClick={() => addNote("HORIZONTAL_SLIDE_LEFT", menu.lane, menu.laneOffset, menu.time)}>Horizontal slide left</button>
          <button onClick={() => addNote("HORIZONTAL_SLIDE_RIGHT", menu.lane, menu.laneOffset, menu.time)}>Horizontal slide right</button>
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
          {selectedNoteIds.length === 1 && menuNote.type === "HORIZONTAL_SLIDE" && <button onClick={() => turnSlide(menuNote)}>↻ Turn 180°</button>}
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
