import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  defaultCalibrationSettings,
  loadCalibrationSettings,
  saveCalibrationSettings,
  type CalibrationSettings,
} from "./calibration-settings.ts";
import { CameraPanel } from "./camera-panel.tsx";
import { initialCameraSnapshot, type CameraInput, type CameraSnapshot } from "./camera-input.ts";
import type { InputAction, InputFrame } from "./foot-pose.ts";
import type { LoadedLevel } from "./level.ts";
import { PixiPlayfield } from "./pixi-playfield.ts";
import { judgementForOffset, type ChartNote, type Judgement, type NoteType } from "./rhythm-engine.ts";

const noteTime = 10;

type TestResult = {
  expected: ChartNote;
  actual: string;
  offsetMs?: number;
  status: Judgement | "outside" | "wrong";
};
type Attempt = {
  expected: ChartNote;
  hitAt: DOMHighResTimeStamp;
  settings: CalibrationSettings;
};
type MovementTestScreenProps = {
  cameraInput: CameraInput;
  level: LoadedLevel;
  onBack: () => void;
  onRecalibrate: () => void;
  onCalibrationChange: (calibrated: boolean) => void;
};

function actionType(action: InputAction): NoteType {
  if (action.type === "JUMP") return "JUMP";
  if (action.type.endsWith("_SLIDE")) return "SLIDE";
  return "STEP";
}

function actionDescription(action: InputAction): string {
  if (action.type === "JUMP") return "JUMP";
  const foot = action.type.startsWith("LEFT") ? "LEFT" : "RIGHT";
  return action.type === "LEFT_SLIDE" || action.type === "RIGHT_SLIDE"
    ? `${foot} SLIDE · ${action.lane} → ${action.endLane}`
    : `${foot} STEP · LANE ${action.lane}`;
}

function noteDescription(note: ChartNote): string {
  if (note.type === "JUMP") return "JUMP";
  if (note.type === "SLIDE") return `${note.foot.toUpperCase()} SLIDE · ${note.lane} → ${note.endLane}`;
  return `${note.foot.toUpperCase()} ${note.type} · LANE ${note.lane}`;
}

function actionMatches(action: InputAction, note: ChartNote): boolean {
  if (note.type === "JUMP") return action.type === "JUMP";
  if (note.type === "SLIDE") {
    if (action.type !== "LEFT_SLIDE" && action.type !== "RIGHT_SLIDE") return false;
    const expectedAction = `${note.foot.toUpperCase()}_SLIDE`;
    return action.type === expectedAction
      && action.lane === note.lane
      && action.endLane === note.endLane;
  }
  const expectedAction = `${note.foot.toUpperCase()}_STEP`;
  return action.type === expectedAction && action.lane === note.lane;
}

export function MovementTestScreen({
  cameraInput,
  level,
  onBack,
  onRecalibrate,
  onCalibrationChange,
}: MovementTestScreenProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const playfieldRef = useRef<PixiPlayfield | undefined>(undefined);
  const attemptRef = useRef<Attempt | null>(null);
  const [ready, setReady] = useState(false);
  const [snapshot, setSnapshot] = useState(initialCameraSnapshot);
  const [settings, setSettings] = useState(loadCalibrationSettings);
  const [foot, setFoot] = useState<"left" | "right">("left");
  const [lane, setLane] = useState(1);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [latest, setLatest] = useState<TestResult>();
  const [clock, setClock] = useState(0);
  const [error, setError] = useState("");

  const chart = useMemo(() => {
    const notes: ChartNote[] = [{ id: "JUMP", time: noteTime, type: "JUMP", foot: "both" }];
    for (const side of ["left", "right"] as const) {
      for (let targetLane = 1; targetLane <= level.chart.playfield.lanes; targetLane++) {
        notes.push({
          id: `STEP-${side}-${targetLane}`,
          time: noteTime,
          type: "STEP",
          foot: side,
          lane: targetLane,
        });
        notes.push({
          id: `SLIDE-${side}-${targetLane}`,
          time: noteTime,
          type: "SLIDE",
          foot: side,
          lane: targetLane,
          endLane: targetLane <= 2 ? targetLane + 2 : targetLane - 2,
        });
      }
    }
    return { ...level.chart, notes };
  }, [level]);

  useEffect(() => {
    cameraInput.setMovementSettings(settings);
  }, [cameraInput, settings]);

  useEffect(() => {
    let cancelled = false;
    let playfield: PixiPlayfield | undefined;
    PixiPlayfield.create(mountRef.current!, chart).then((created) => {
      if (cancelled) created.destroy();
      else {
        playfield = created;
        playfieldRef.current = created;
        setReady(true);
      }
    }).catch((loadError: unknown) => {
      setError(loadError instanceof Error ? loadError.message : "Could not load playfield");
    });
    return () => {
      cancelled = true;
      playfield?.destroy();
      playfieldRef.current = undefined;
    };
  }, [chart]);

  const completeAttempt = useCallback((result: TestResult) => {
    attemptRef.current = null;
    setAttempt(null);
    setLatest(result);
    if (result.status === "wrong" || result.status === "outside") return;
    playfieldRef.current?.showResult({
      note: result.expected,
      judgement: result.status,
      offset: (result.offsetMs ?? 0) / 1000,
    });
  }, []);

  useEffect(() => {
    let frame = 0;
    let lastUiUpdate = 0;
    const tick = (now: number) => {
      const active = attemptRef.current;
      const playfield = playfieldRef.current;
      if (playfield) {
        if (active) {
          const remaining = active.hitAt - now;
          const trackTime = noteTime
            - remaining / active.settings.cueDelayMs * chart.playfield.travelTime;
          playfield.render(trackTime, true, (id) => id !== active.expected.id);
          if (now > active.hitAt + active.settings.responseTimeoutMs) {
            completeAttempt({ expected: active.expected, actual: "NO MOVEMENT", status: "miss" });
          }
        } else {
          playfield.render(0, false, () => true);
        }
      }
      if (now - lastUiUpdate > 30) {
        setClock(now);
        lastUiUpdate = now;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [chart.playfield.travelTime, completeAttempt]);

  const receiveFrame = useCallback((frame: InputFrame) => {
    const active = attemptRef.current;
    if (!active) return;
    for (const action of frame.actions) {
      if (actionType(action) !== active.expected.type) continue;
      const offsetMs = (action.type === "LEFT_SLIDE" || action.type === "RIGHT_SLIDE" ? action.startedAt : frame.capturedAt) - active.hitAt;
      if (!actionMatches(action, active.expected)) {
        completeAttempt({
          expected: active.expected,
          actual: actionDescription(action),
          offsetMs,
          status: "wrong",
        });
        return;
      }
      completeAttempt({
        expected: active.expected,
        actual: actionDescription(action),
        offsetMs,
        status: judgementForOffset(active.expected.type, offsetMs, active.settings) ?? "outside",
      });
      return;
    }
  }, [completeAttempt]);

  const receiveSnapshot = useCallback((next: CameraSnapshot) => {
    setSnapshot(next);
    onCalibrationChange(next.calibrated);
    playfieldRef.current?.showTrackedFeet(
      next.leftLane === null ? null : next.leftPosition,
      next.rightLane === null ? null : next.rightPosition,
    );
  }, [onCalibrationChange]);

  function startAttempt(type: NoteType): void {
    const id = type === "JUMP" ? "JUMP" : `${type}-${foot}-${lane}`;
    const expected = chart.notes.find((note) => note.id === id)!;
    const nextAttempt = { expected, hitAt: performance.now() + settings.cueDelayMs, settings };
    cameraInput.resetActions();
    attemptRef.current = nextAttempt;
    setAttempt(nextAttempt);
    setLatest(undefined);
  }

  function updateSetting(key: keyof CalibrationSettings, value: number): void {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  const remaining = attempt ? attempt.hitAt - clock : 0;
  const cue = !attempt ? "READY" : remaining > 0 ? `${(remaining / 1000).toFixed(1)}s` : "HIT!";

  return (
    <main className="game-screen movement-game-screen">
      <header className="game-hud movement-game-hud">
        <div className="game-controls">
          <button className="text-button" onClick={onBack}>Back</button>
          <button className="text-button" onClick={onRecalibrate}>Recalibrate</button>
        </div>
        <div className="hud-track"><small>MOVEMENT TEST</small><strong>{level.song.title}</strong></div>
        <div><small>TARGET</small><strong>{attempt ? noteDescription(attempt.expected) : "Choose a move"}</strong></div>
        <div><small>STATUS</small><strong className="accent">{cue}</strong></div>
        <div className="judgements">
          {latest ? `${latest.status.toUpperCase()}${latest.offsetMs === undefined ? "" : ` · ${latest.offsetMs > 0 ? "+" : ""}${Math.round(latest.offsetMs)} ms`}` : "Send a note, then match it"}
        </div>
      </header>

      <div className="game-layout">
        <section className="playfield-shell">
          <div ref={mountRef} className="pixi-stage" />
          {!ready && (
            <div className="game-overlay">
              <h2>{error ? "Playfield unavailable" : "Loading playfield…"}</h2>
              <span>{error || "Preparing movement test."}</span>
            </div>
          )}
        </section>

        <aside className="movement-game-panel panel">
          <div className="movement-game-target">
            <label>Foot
              <select value={foot} onChange={(event) => setFoot(event.target.value as "left" | "right")}>
                <option value="left">Left</option>
                <option value="right">Right</option>
              </select>
            </label>
            <label>Lane
              <select value={lane} onChange={(event) => setLane(Number(event.target.value))}>
                {Array.from({ length: level.chart.playfield.lanes }, (_, index) => index + 1)
                  .map((value) => <option key={value}>{value}</option>)}
              </select>
            </label>
          </div>
          <div className="movement-game-buttons">
            {(["STEP", "JUMP", "SLIDE"] as const).map((type) => (
              <button
                key={type}
                disabled={!ready || !snapshot.calibrated || Boolean(attempt)}
                onClick={() => startAttempt(type)}
              >
                {type}
              </button>
            ))}
          </div>
          {latest && (
            <div className={`movement-game-result ${latest.status}`}>
              <strong>{latest.status.toUpperCase()}</strong>
              <span>{latest.actual}</span>
            </div>
          )}

          <div className="movement-game-settings">
            <div className="section-heading">
              <small>SETTINGS</small>
              <button onClick={() => {
                setSettings(defaultCalibrationSettings);
              }}>Reset</button>
            </div>
            <NumberSetting label="Note travel time" unit="ms" value={settings.cueDelayMs} min={500} step={100} onChange={(value) => updateSetting("cueDelayMs", value)} />
            <NumberSetting label="Listen after hit" unit="ms" value={settings.responseTimeoutMs} min={100} step={100} onChange={(value) => updateSetting("responseTimeoutMs", value)} />
            <NumberSetting label="Game miss grace" unit="ms" value={settings.missGraceMs} min={0} step={5} onChange={(value) => updateSetting("missGraceMs", value)} />
            <NumberSetting label="Step perfect" unit="ms" value={settings.stepPerfectMs} min={1} step={5} onChange={(value) => updateSetting("stepPerfectMs", value)} />
            <NumberSetting label="Step great" unit="ms" value={settings.stepGreatMs} min={1} step={5} onChange={(value) => updateSetting("stepGreatMs", value)} />
            <NumberSetting label="Step good" unit="ms" value={settings.stepGoodMs} min={1} step={5} onChange={(value) => updateSetting("stepGoodMs", value)} />
            <NumberSetting label="Jump perfect" unit="ms" value={settings.jumpPerfectMs} min={1} step={5} onChange={(value) => updateSetting("jumpPerfectMs", value)} />
            <NumberSetting label="Jump great" unit="ms" value={settings.jumpGreatMs} min={1} step={5} onChange={(value) => updateSetting("jumpGreatMs", value)} />
            <NumberSetting label="Jump good" unit="ms" value={settings.jumpGoodMs} min={1} step={5} onChange={(value) => updateSetting("jumpGoodMs", value)} />
            <NumberSetting label="Foot confidence" value={settings.minimumFootConfidence} min={0.1} max={1} step={0.05} onChange={(value) => updateSetting("minimumFootConfidence", value)} />
            <PercentSetting label="Step lift" value={settings.stepLift} onChange={(value) => updateSetting("stepLift", value)} />
            <PercentSetting label="Step near ground" value={settings.stepLanding} onChange={(value) => updateSetting("stepLanding", value)} />
            <PercentSetting label="Step descent" value={settings.stepDescent} onChange={(value) => updateSetting("stepDescent", value)} />
            <PercentSetting label="Jump lift" value={settings.jumpLift} onChange={(value) => updateSetting("jumpLift", value)} />
            <PercentSetting label="Jump near ground" value={settings.jumpLanding} onChange={(value) => updateSetting("jumpLanding", value)} />
            <PercentSetting label="Jump descent" value={settings.jumpDescent} onChange={(value) => updateSetting("jumpDescent", value)} />
            <button className="primary movement-save" onClick={() => {
              saveCalibrationSettings(settings);
            }}>Save settings</button>
          </div>
        </aside>

        <CameraPanel compact input={cameraInput} onFrame={receiveFrame} onSnapshot={receiveSnapshot} />
      </div>
    </main>
  );
}

type NumberSettingProps = {
  label: string;
  value: number;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
};

function NumberSetting({ label, value, unit, min, max, step, onChange }: NumberSettingProps) {
  return (
    <label className="number-setting">
      <span>{label}</span>
      <input type="number" value={value} min={min} max={max} step={step} onChange={(event) => {
        if (!Number.isNaN(event.target.valueAsNumber)) onChange(event.target.valueAsNumber);
      }} />
      {unit && <small>{unit}</small>}
    </label>
  );
}

function PercentSetting({ label, value, onChange }: Pick<NumberSettingProps, "label" | "value" | "onChange">) {
  return <NumberSetting label={label} unit="%" value={Number((value * 100).toFixed(2))} min={0.1} step={0.1} onChange={(next) => onChange(next / 100)} />;
}
