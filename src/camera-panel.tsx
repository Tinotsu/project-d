import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import {
  initialCameraSnapshot,
  type CameraInput,
  type CameraSnapshot,
} from "./camera-input.ts";
import type { InputAction, InputFrame } from "./foot-pose.ts";

type CameraPanelProps = {
  input: CameraInput;
  compact?: boolean;
  onFrame?: (frame: InputFrame) => void;
  onSnapshot?: (snapshot: CameraSnapshot) => void;
};

export function CameraPanel({ input, compact = false, onFrame, onSnapshot }: CameraPanelProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [snapshot, setSnapshot] = useState(initialCameraSnapshot);
  const [actions, setActions] = useState<InputAction[]>([]);

  const receiveSnapshot = useCallback((next: CameraSnapshot) => {
    setSnapshot(next);
    onSnapshot?.(next);
  }, [onSnapshot]);

  const receiveFrame = useCallback((frame: InputFrame) => {
    if (frame.actions.length) setActions((current) => [...current, ...frame.actions].slice(-8));
    onFrame?.(frame);
  }, [onFrame]);

  useEffect(() => {
    input.attach(videoRef.current!, canvasRef.current!, receiveSnapshot, receiveFrame);
    return () => input.detach();
  }, [input, receiveFrame, receiveSnapshot]);

  function markCorner(event: MouseEvent<HTMLCanvasElement>): void {
    input.markCorner(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect());
  }

  function resetActions(): void {
    input.resetActions();
    setActions([]);
  }

  return (
    <section className={`camera-panel${compact ? " compact" : ""}`}>
      <div className="camera-stage">
        <video ref={videoRef} autoPlay playsInline muted />
        <canvas
          ref={canvasRef}
          className={snapshot.calibrating ? "calibrating" : ""}
          onClick={markCorner}
        />
        {!snapshot.started && (
          <div className="camera-empty">
            <div className="camera-icon" />
            <strong>Camera offline</strong>
            <span>Start tracking to calibrate your floor</span>
          </div>
        )}
        {snapshot.cornerPrompt && <div className="corner-prompt">{snapshot.cornerPrompt}</div>}
      </div>

      <div className="camera-details">
        <div className={`camera-status${snapshot.active ? " active" : ""}`}>
          <i />
          <span>{snapshot.status}</span>
        </div>
        <p className="camera-hint">{snapshot.hint}</p>
        <div className="camera-actions">
          {!snapshot.started && (
            <button className="primary" disabled={snapshot.starting} onClick={() => void input.start()}>
              {snapshot.starting ? "Loading model…" : "Start camera"}
            </button>
          )}
          {snapshot.started && (
            <button className="secondary" disabled={snapshot.calibrating} onClick={() => input.beginCalibration()}>
              Recalibrate
            </button>
          )}
        </div>
      </div>

      <div className="camera-readout">
        <div className="foot-readout left">
          <i />
          <span>LEFT</span>
          <strong>{snapshot.leftLane ? `LANE ${snapshot.leftLane}` : "—"}</strong>
          {!compact && <code>{snapshot.leftPosition ? `x ${snapshot.leftPosition.x.toFixed(2)}  y ${snapshot.leftPosition.y.toFixed(2)}` : "x —  y —"}</code>}
        </div>
        <div className="foot-readout right">
          <i />
          <span>RIGHT</span>
          <strong>{snapshot.rightLane ? `LANE ${snapshot.rightLane}` : "—"}</strong>
          {!compact && <code>{snapshot.rightPosition ? `x ${snapshot.rightPosition.x.toFixed(2)}  y ${snapshot.rightPosition.y.toFixed(2)}` : "x —  y —"}</code>}
        </div>
        <div className={`jump-readout${snapshot.jumping ? " active" : ""}`}>
          {snapshot.jumping ? "JUMP" : "GROUNDED"}
        </div>
      </div>

      {!compact && (
        <div className="input-events">
          <div className="section-heading">
            <small>INPUT EVENTS</small>
            <button onClick={resetActions}>Reset</button>
          </div>
          <div className="event-log" aria-live="polite">
            {actions.length === 0
              ? <p className="event-empty">Waiting for movement…</p>
              : actions.map((action, index) => (
                <p key={`${action.type}-${action.lane ?? "none"}-${index}`}>
                  {action.type}{action.lane ? ` · LANE ${action.lane}` : ""}
                </p>
              ))}
          </div>
        </div>
      )}
    </section>
  );
}
