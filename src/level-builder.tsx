import { useEffect, useMemo, useRef, useState } from "react";
import jumpUrl from "../assets/jump base.svg?url";
import leftStepUrl from "../assets/left base.svg?url";
import leftSlideUrl from "../assets/left slide.svg?url";
import rightStepUrl from "../assets/right base.svg?url";
import rightSlideUrl from "../assets/right slide.svg?url";
import { Button } from "./components/ui/button.tsx";
import type { LoadedLevel, LevelChart, SongMetadata } from "./level.ts";
import type { ChartNote } from "./rhythm-engine.ts";

type LevelBuilderProps = {
  level: LoadedLevel;
  onBack: () => void;
  onPublish: (level: LoadedLevel) => Promise<void>;
  onSave: (level: LoadedLevel) => Promise<void>;
  onTest: (level: LoadedLevel) => void;
};

type AddNoteType = "LEFT_STEP" | "RIGHT_STEP" | "JUMP" | "SLIDE_LEFT" | "SLIDE_RIGHT";

type BuilderMenu =
  | { x: number; y: number; mode: "lane"; lane: number; laneOffset: 0 | 0.5; time: number }
  | { x: number; y: number; mode: "note"; noteId: string };

type NoteDrag = {
  note: ChartNote;
  pointerId: number;
  x: number;
  y: number;
};

const basePixelsPerSecond = 30;

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
  laneOffset: 0 | 0.5 = 0.5,
): ChartNote {
  if (type === "JUMP") return { id, time, type: "JUMP", foot: "both" };
  if (type === "SLIDE_LEFT") return { id, time, type: "SLIDE", lane, laneOffset, endLane: lane - 2, foot: "left" };
  if (type === "SLIDE_RIGHT") return { id, time, type: "SLIDE", lane, laneOffset, endLane: lane + 2, foot: "right" };
  return {
    id,
    time,
    type: "STEP",
    lane,
    foot: type === "LEFT_STEP" ? "left" : "right",
  };
}

export function moveTimelineNote(note: ChartNote, laneDelta: number, timeDelta: number, duration: number): ChartNote {
  const time = Number(Math.max(0, Math.min(duration, note.time + timeDelta)).toFixed(3));
  if (note.type === "JUMP") return { ...note, time };

  let lane = Math.max(1, Math.min(4, note.lane! + laneDelta));
  if (note.type === "SLIDE") {
    const direction = note.endLane! < note.lane! ? -2 : 2;
    lane = Math.max(direction < 0 ? 3 : 1, Math.min(direction < 0 ? 4 : 2, lane));
    return { ...note, time, lane, endLane: lane + direction };
  }

  return { ...note, time, lane };
}

export function LevelBuilder({ level, onBack, onPublish, onSave, onTest }: LevelBuilderProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const noteDragRef = useRef<NoteDrag | undefined>(undefined);
  const [chart, setChart] = useState<LevelChart>(() => structuredClone(level.chart));
  const [song, setSong] = useState<SongMetadata>(() => ({ ...level.song }));
  const [audioBlob, setAudioBlob] = useState(level.audioBlob);
  const [title, setTitle] = useState(level.song.title);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [playhead, setPlayhead] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [menu, setMenu] = useState<BuilderMenu>();
  const [selectedNoteId, setSelectedNoteId] = useState<string>();
  const [draggingNoteId, setDraggingNoteId] = useState<string>();
  const [status, setStatus] = useState("");

  const duration = Math.max(30, Math.ceil(song.duration || chart.level.endTime || 60));
  const pixelsPerSecond = basePixelsPerSecond * zoom;
  const timelineHeight = Math.max(1500, duration * pixelsPerSecond);
  const notes = useMemo(() => [...chart.notes].sort((left, right) => right.time - left.time), [chart.notes]);
  const selectedNote = chart.notes.find((note) => note.id === selectedNoteId);
  const markers = Array.from({ length: Math.floor(duration / 5) + 1 }, (_, index) => index * 5);

  useEffect(() => {
    if (timelineRef.current) timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
  }, [duration]);

  useEffect(() => {
    const dismissMenu = () => setMenu(undefined);
    window.addEventListener("click", dismissMenu);
    return () => window.removeEventListener("click", dismissMenu);
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
    const nextTitle = title === "Untitled level" ? file.name.replace(/\.mp3$/i, "") : title;
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
      Number(time.toFixed(3)),
      laneOffset,
    );
    setChart((current) => ({ ...current, notes: [...current.notes, note] }));
    setSelectedNoteId(note.id);
    setMenu(undefined);
  }

  function updateNote(id: string, patch: Partial<ChartNote>): void {
    setChart((current) => ({
      ...current,
      notes: current.notes.map((note) => note.id === id ? { ...note, ...patch } : note),
    }));
  }

  function removeNote(id: string): void {
    setChart((current) => ({ ...current, notes: current.notes.filter((note) => note.id !== id) }));
    if (selectedNoteId === id) setSelectedNoteId(undefined);
    setMenu(undefined);
  }

  function changeSlideDirection(note: ChartNote, direction: "left" | "right"): void {
    const change = direction === "left" ? -2 : 2;
    updateNote(note.id, {
      endLane: note.lane! + change,
      foot: direction,
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
    setSelectedNoteId(noteId);
    setMenu({ x: event.clientX, y: event.clientY, mode: "note", noteId });
  }

  function selectNote(note: ChartNote): void {
    setSelectedNoteId(note.id);
    if (audioRef.current) audioRef.current.currentTime = note.time;
    setPlayhead(note.time);
  }

  function startNoteDrag(event: React.PointerEvent<HTMLButtonElement>, note: ChartNote): void {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    noteDragRef.current = {
      note,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
    setSelectedNoteId(note.id);
    setDraggingNoteId(note.id);
    setMenu(undefined);
  }

  function dragNote(event: React.PointerEvent<HTMLButtonElement>): void {
    const drag = noteDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const laneWidth = event.currentTarget.parentElement!.getBoundingClientRect().width / 4;
    const movedNote = moveTimelineNote(
      drag.note,
      Math.round((event.clientX - drag.x) / laneWidth),
      (drag.y - event.clientY) / pixelsPerSecond,
      duration,
    );
    setChart((current) => ({
      ...current,
      notes: current.notes.map((note) => note.id === movedNote.id ? movedNote : note),
    }));
  }

  function endNoteDrag(event: React.PointerEvent<HTMLButtonElement>): void {
    if (noteDragRef.current?.pointerId !== event.pointerId) return;
    noteDragRef.current = undefined;
    setDraggingNoteId(undefined);
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

  async function publish(): Promise<void> {
    setStatus("Publishing…");
    try {
      await onPublish(builtLevel());
      setStatus("Published to your level library");
    } catch {
      setStatus("Could not publish");
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
          <Button variant="outline" onClick={save}>Save</Button>
          <Button onClick={publish}>Publish</Button>
        </div>
      </header>

      <div className="builder-workspace">
        <aside className="builder-side builder-audio">
          <section>
            <div className="builder-section-heading">
              <span>MUSIC</span>
              <small>MP3</small>
            </div>
            <label className="music-drop">
              <input
                type="file"
                accept=".mp3,audio/mpeg"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void uploadMusic(file);
                }}
              />
              <strong>＋ Upload music</strong>
              <span>Choose an MP3 from your computer</span>
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
            <p><strong>Right-click</strong> any lane to add a move.</p>
            <p><strong>Drag</strong> a move to change its lane and time.</p>
            <p><strong>Right-click</strong> a move to edit or delete it.</p>
            <div><i className="legend-left" />Left <i className="legend-right" />Right <i className="legend-jump" />Jump</div>
          </section>
        </aside>

        <section className="timeline-panel">
          <div className="timeline-toolbar">
            <div>
              <strong>LEVEL TIMELINE</strong>
              <span>{notes.length} moves · {formatTime(duration)}</span>
            </div>
            <div className="timeline-toolbar-actions">
              <span className="scroll-hint">SCROLL ↑ TO MOVE FORWARD</span>
              <div className="zoom-controls" aria-label="Timeline zoom">
                <button type="button" aria-label="Zoom out" onClick={() => setZoom((current) => Math.max(0.5, current - 0.25))}>−</button>
                <output>{Math.round(zoom * 100)}%</output>
                <button type="button" aria-label="Zoom in" onClick={() => setZoom((current) => Math.min(3, current + 0.25))}>＋</button>
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

              <div className="timeline-lanes">
                {markers.map((time) => <i className="time-gridline" key={time} style={{ bottom: time * pixelsPerSecond }} />)}
                <div className="timeline-playhead" style={{ bottom: playhead * pixelsPerSecond }}><span>{formatTime(playhead)}</span></div>
                {[1, 2, 3, 4].map((lane) => (
                  <div className="timeline-lane" key={lane} onContextMenu={(event) => openLaneMenu(event, lane)} />
                ))}
                {notes.map((note) => {
                  let left = 0;
                  let width = 100;
                  if (note.type === "STEP") {
                    left = (note.lane! - 1) * 25;
                    width = 25;
                  } else if (note.type === "SLIDE") {
                    const start = note.lane! - 1 + (note.laneOffset ?? 0.5);
                    const end = note.endLane! - 0.5;
                    left = Math.min(start, end) * 25;
                    width = Math.abs(start - end) * 25;
                  }
                  const asset = note.type === "JUMP"
                    ? jumpUrl
                    : note.type === "SLIDE"
                      ? note.foot === "left" ? leftSlideUrl : rightSlideUrl
                      : note.foot === "left" ? leftStepUrl : rightStepUrl;
                  return (
                    <button
                      type="button"
                      aria-label={`${note.type} at ${note.time.toFixed(3)} seconds`}
                      className={`timeline-note ${note.type.toLowerCase()} ${note.foot} ${selectedNoteId === note.id ? "selected" : ""} ${draggingNoteId === note.id ? "dragging" : ""}`}
                      data-direction={note.type === "SLIDE" && note.endLane! < note.lane! ? "left" : "right"}
                      key={note.id}
                      style={{
                        bottom: note.time * pixelsPerSecond,
                        left: `calc(${left}% + 4px)`,
                        width: `calc(${width}% - 8px)`,
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        selectNote(note);
                      }}
                      onContextMenu={(event) => openNoteMenu(event, note.id)}
                      onPointerDown={(event) => startNoteDrag(event, note)}
                      onPointerMove={dragNote}
                      onPointerUp={endNoteDrag}
                      onPointerCancel={endNoteDrag}
                    >
                      <img src={asset} alt="" />
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
            <span>ALL MOVES</span>
            <small>{notes.length}</small>
          </div>
          <div className="note-list">
            {notes.length === 0 && <p className="empty-notes">Right-click the timeline to add your first move.</p>}
            {notes.map((note, index) => (
              <article className={selectedNoteId === note.id ? "selected" : ""} key={note.id} onClick={() => selectNote(note)}>
                <div className={`note-index ${note.type.toLowerCase()} ${note.foot}`}>{String(notes.length - index).padStart(2, "0")}</div>
                <div>
                  <strong>{note.type === "STEP" ? `${note.foot} step` : note.type.toLowerCase()}</strong>
                  <span>{note.type === "JUMP" ? "All lanes" : `Lane ${note.lane}${note.type === "SLIDE" ? ` → ${note.endLane}` : ""}`}</span>
                </div>
                <label>
                  <span>TIME</span>
                  <input
                    aria-label={`Time for ${note.id}`}
                    type="number"
                    min="0"
                    max={duration}
                    step="0.001"
                    value={note.time}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => updateNote(note.id, { time: event.target.valueAsNumber })}
                  />
                </label>
                {note.type === "SLIDE" && (
                  <>
                    <label>
                      <span>START</span>
                      <select
                        value={note.laneOffset ?? 0.5}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => updateNote(note.id, { laneOffset: Number(event.target.value) as 0 | 0.5 })}
                      >
                        <option value={0}>Lane edge · 0</option>
                        <option value={0.5}>Lane center · 0.5</option>
                      </select>
                    </label>
                    <label>
                      <span>DIRECTION</span>
                      <select
                        value={note.endLane! < note.lane! ? "left" : "right"}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => changeSlideDirection(note, event.target.value as "left" | "right")}
                      >
                        {note.lane! > 2 && <option value="left">Left</option>}
                        {note.lane! < 3 && <option value="right">Right</option>}
                      </select>
                    </label>
                  </>
                )}
              </article>
            ))}
          </div>
          {selectedNote && (
            <Button className="inspector-delete" variant="destructive" size="sm" onClick={() => removeNote(selectedNote.id)}>
              Delete selected move
            </Button>
          )}
        </aside>
      </div>

      {menu?.mode === "lane" && (
        <div className="builder-context-menu" style={{ left: menu.x, top: menu.y }} onClick={(event) => event.stopPropagation()}>
          <small>ADD AT {formatTime(menu.time)} · LANE {menu.lane} + {menu.laneOffset}</small>
          <button onClick={() => addNote("LEFT_STEP", menu.lane, menu.laneOffset, menu.time)}><i className="left" /> Left step</button>
          <button onClick={() => addNote("RIGHT_STEP", menu.lane, menu.laneOffset, menu.time)}><i className="right" /> Right step</button>
          <button onClick={() => addNote("JUMP", menu.lane, menu.laneOffset, menu.time)}><i className="jump" /> Jump</button>
          <button disabled={menu.lane < 3} onClick={() => addNote("SLIDE_LEFT", menu.lane, menu.laneOffset, menu.time)}>↙ Slide left</button>
          <button disabled={menu.lane > 2} onClick={() => addNote("SLIDE_RIGHT", menu.lane, menu.laneOffset, menu.time)}>↗ Slide right</button>
        </div>
      )}

      {menuNote && (
        <div className="builder-context-menu" style={{ left: menu!.x, top: menu!.y }} onClick={(event) => event.stopPropagation()}>
          <small>{menuNote.type} · {formatTime(menuNote.time)}</small>
          {menuNote.type === "SLIDE" && menuNote.lane! > 2 && <button onClick={() => changeSlideDirection(menuNote, "left")}>↙ Point slide left</button>}
          {menuNote.type === "SLIDE" && menuNote.lane! < 3 && <button onClick={() => changeSlideDirection(menuNote, "right")}>↗ Point slide right</button>}
          <button className="danger" onClick={() => removeNote(menuNote.id)}>× Delete move</button>
        </div>
      )}
    </main>
  );
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${Math.floor(seconds % 60).toString().padStart(2, "0")}.${Math.floor(seconds % 1 * 10)}`;
}
