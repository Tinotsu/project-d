import { useRef, useState } from "react";
import type { LoadedLevel, LevelChart } from "./level.ts";
import type { ChartNote, Foot, NoteType } from "./rhythm-engine.ts";

type ChartEditorProps = {
  level: LoadedLevel;
  onBack: () => void;
};

export function ChartEditor({ level, onBack }: ChartEditorProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [chart, setChart] = useState<LevelChart>(() => structuredClone(level.chart));
  const [time, setTime] = useState(0);
  const [type, setType] = useState<NoteType>("STEP");
  const [lane, setLane] = useState(1);
  const [foot, setFoot] = useState<Foot>("left");
  const [slide, setSlide] = useState("");

  function updateNote(id: string, patch: Partial<ChartNote>): void {
    setChart((current) => ({
      ...current,
      notes: current.notes.map((note) => note.id === id ? { ...note, ...patch } : note),
    }));
  }

  function addNote(): void {
    const nextNumber = Math.max(0, ...chart.notes.map((note) => Number(note.id.match(/\d+/)?.[0] ?? 0))) + 1;
    const note: ChartNote = type === "JUMP"
      ? { id: `n${String(nextNumber).padStart(3, "0")}`, time, type, foot: "both" }
      : {
          id: `n${String(nextNumber).padStart(3, "0")}`,
          time,
          type,
          lane,
          foot,
          ...(slide.trim() ? { slide: slide.trim() } : {}),
        };
    setChart((current) => ({
      ...current,
      notes: [...current.notes, note].sort((left, right) => left.time - right.time),
    }));
  }

  function downloadChart(): void {
    const url = URL.createObjectURL(new Blob([`${JSON.stringify(chart, null, 2)}\n`], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${chart.level.id}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="editor-screen">
      <div className="screen-heading">
        <div>
          <p className="eyebrow">CHART EDITOR</p>
          <h2>{level.song.title}</h2>
        </div>
        <div className="heading-actions">
          <button className="secondary" onClick={onBack}>Back</button>
          <button className="primary" onClick={downloadChart}>Download JSON</button>
        </div>
      </div>

      <section className="editor-transport panel">
        <audio ref={audioRef} src={level.song.audio} controls />
        <button className="secondary" onClick={() => setTime(Number((audioRef.current?.currentTime ?? 0).toFixed(3)))}>
          Capture current time
        </button>
        <label>Time<input type="number" min="0" step="0.001" value={time} onChange={(event) => setTime(event.target.valueAsNumber)} /></label>
        <label>BPM<input type="number" min="1" value={chart.timing.bpm} onChange={(event) => setChart({ ...chart, timing: { ...chart.timing, bpm: event.target.valueAsNumber } })} /></label>
        <label>Offset<input type="number" step="0.001" value={chart.timing.offset} onChange={(event) => setChart({ ...chart, timing: { ...chart.timing, offset: event.target.valueAsNumber } })} /></label>
        <label>Travel<input type="number" min="0.1" step="0.1" value={chart.playfield.travelTime} onChange={(event) => setChart({ ...chart, playfield: { ...chart.playfield, travelTime: event.target.valueAsNumber } })} /></label>
      </section>

      <section className="note-composer panel">
        <label>Type
          <select value={type} onChange={(event) => setType(event.target.value as NoteType)}>
            <option value="STEP">Step</option>
            <option value="JUMP">Jump</option>
            <option value="SLIDE_LEFT">Slide left</option>
            <option value="SLIDE_RIGHT">Slide right</option>
          </select>
        </label>
        <label>Lane<select disabled={type === "JUMP"} value={lane} onChange={(event) => setLane(Number(event.target.value))}>{[1, 2, 3, 4].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>Foot
          <select disabled={type === "JUMP"} value={foot} onChange={(event) => setFoot(event.target.value as Foot)}>
            <option value="left">Left</option>
            <option value="right">Right</option>
            <option value="either">Either</option>
          </select>
        </label>
        <label>Slide group<input disabled={type === "JUMP"} placeholder="optional, e.g. s1" value={slide} onChange={(event) => setSlide(event.target.value)} /></label>
        <button className="primary" onClick={addNote}>Add note at {time.toFixed(3)}s</button>
      </section>

      <section className="chart-table panel">
        <div className="section-heading">
          <small>{chart.notes.length} NOTES</small>
          <button onClick={() => setChart(structuredClone(level.chart))}>Reset chart</button>
        </div>
        <div className="chart-rows">
          <div className="chart-row chart-labels"><span>ID</span><span>Time</span><span>Type</span><span>Lane</span><span>Foot</span><span>Slide</span><span /></div>
          {chart.notes.map((note) => (
            <div className="chart-row" key={note.id}>
              <code>{note.id}</code>
              <input type="number" step="0.001" value={note.time} onChange={(event) => updateNote(note.id, { time: event.target.valueAsNumber })} />
              <select value={note.type} onChange={(event) => {
                const nextType = event.target.value as NoteType;
                updateNote(note.id, nextType === "JUMP" ? { type: nextType, foot: "both", lane: undefined, slide: undefined } : { type: nextType });
              }}>
                <option value="STEP">STEP</option>
                <option value="JUMP">JUMP</option>
                <option value="SLIDE_LEFT">SLIDE LEFT</option>
                <option value="SLIDE_RIGHT">SLIDE RIGHT</option>
              </select>
              <select disabled={note.type === "JUMP"} value={note.lane ?? ""} onChange={(event) => updateNote(note.id, { lane: Number(event.target.value) })}>
                {note.type === "JUMP" && <option value="">—</option>}
                {[1, 2, 3, 4].map((value) => <option key={value}>{value}</option>)}
              </select>
              <select disabled={note.type === "JUMP"} value={note.foot} onChange={(event) => updateNote(note.id, { foot: event.target.value as Foot })}>
                {note.type === "JUMP" && <option value="both">Both</option>}
                <option value="left">Left</option>
                <option value="right">Right</option>
                <option value="either">Either</option>
              </select>
              <input disabled={note.type === "JUMP"} value={note.slide ?? ""} onChange={(event) => updateNote(note.id, { slide: event.target.value || undefined })} />
              <button className="danger" onClick={() => setChart((current) => ({ ...current, notes: current.notes.filter((candidate) => candidate.id !== note.id) }))}>Remove</button>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
