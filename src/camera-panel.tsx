import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import {
  initialCameraSnapshot,
  type CameraInput,
  type CameraSnapshot,
} from "./camera-input.ts";
import { Button } from "./components/ui/button.tsx";
import type { InputFrame } from "./foot-pose.ts";

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

  const receiveSnapshot = useCallback((next: CameraSnapshot) => {
    setSnapshot(next);
    onSnapshot?.(next);
  }, [onSnapshot]);

  const receiveFrame = useCallback((frame: InputFrame) => {
    onFrame?.(frame);
  }, [onFrame]);

  useEffect(() => {
    input.attach(videoRef.current!, canvasRef.current!, receiveSnapshot, receiveFrame);
    return () => input.detach();
  }, [input, receiveFrame, receiveSnapshot]);

  function markCorner(event: MouseEvent<HTMLCanvasElement>): void {
    input.markCorner(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect());
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
      </div>

      <div className="camera-details">
        <div className={`camera-status${snapshot.active ? " active" : ""}`}>
          <i />
          <span>{snapshot.status}</span>
        </div>
        <p className="camera-hint">{snapshot.hint}</p>
        <div className="camera-actions">
          {!snapshot.started && (
            <Button disabled={snapshot.starting} onClick={() => void input.start()}>
              {snapshot.starting ? "Loading model…" : "Start camera"}
            </Button>
          )}
          {snapshot.started && (
            <Button variant="outline" disabled={snapshot.calibrating} onClick={() => input.beginCalibration()}>
              Recalibrate
            </Button>
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
      </div>
    </section>
  );
}
