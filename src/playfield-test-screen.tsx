import { useEffect, useRef, useState } from "react";
import type { LoadedLevel } from "./level.ts";
import { PixiPlayfield } from "./pixi-playfield.ts";

type PlayfieldTestScreenProps = {
  level: LoadedLevel;
  onBack: () => void;
};

const leftLaneKeys: Record<string, number> = { Digit1: 1, Digit2: 2, Digit3: 3, Digit4: 4 };
const rightLaneKeys: Record<string, number> = { KeyQ: 1, KeyW: 2, KeyE: 3, KeyR: 4 };

export function PlayfieldTestScreen({ level, onBack }: PlayfieldTestScreenProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const playfieldRef = useRef<PixiPlayfield | undefined>(undefined);
  const timeRef = useRef(0);
  const playingRef = useRef(true);
  const leftLaneRef = useRef<number | null>(null);
  const rightLaneRef = useRef<number | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [time, setTime] = useState(0);
  const [leftLane, setLeftLane] = useState<number | null>(null);
  const [rightLane, setRightLane] = useState<number | null>(null);
  const [error, setError] = useState("");

  const endTime = level.chart.level.endTime;

  useEffect(() => {
    let cancelled = false;
    let playfield: PixiPlayfield | undefined;

    PixiPlayfield.create(mountRef.current!, level.chart)
      .then((created) => {
        if (cancelled) {
          created.destroy();
          return;
        }
        playfield = created;
        playfieldRef.current = created;
        setReady(true);
      })
      .catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : "Could not load playfield");
      });

    return () => {
      cancelled = true;
      playfield?.destroy();
      playfieldRef.current = undefined;
    };
  }, [level]);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    timeRef.current = time;
  }, [time]);

  useEffect(() => {
    leftLaneRef.current = leftLane;
  }, [leftLane]);

  useEffect(() => {
    rightLaneRef.current = rightLane;
  }, [rightLane]);

  useEffect(() => {
    let frame = 0;
    let lastTick = performance.now();
    let lastUiUpdate = 0;

    const tick = (now: number) => {
      const delta = (now - lastTick) / 1000;
      lastTick = now;
      const playfield = playfieldRef.current;
      if (playfield) {
        if (playingRef.current) {
          timeRef.current = Math.min(endTime, timeRef.current + delta);
          if (timeRef.current >= endTime) playingRef.current = false;
        }

        playfield.showTrackedFeet(leftLaneRef.current, rightLaneRef.current);
        playfield.render(timeRef.current, true, () => false);

        if (now - lastUiUpdate > 80) {
          setTime(timeRef.current);
          setPlaying(playingRef.current);
          lastUiUpdate = now;
        }
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [endTime]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        if (event.repeat) return;
        event.preventDefault();
        playingRef.current = !playingRef.current;
        setPlaying(playingRef.current);
        return;
      }

      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement) return;

      if (leftLaneKeys[event.code]) {
        event.preventDefault();
        const lane = leftLaneKeys[event.code];
        setLeftLane((current) => (current === lane ? null : lane));
        return;
      }

      if (rightLaneKeys[event.code]) {
        event.preventDefault();
        const lane = rightLaneKeys[event.code];
        setRightLane((current) => (current === lane ? null : lane));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  function reset(): void {
    timeRef.current = 0;
    setTime(0);
    playingRef.current = true;
    setPlaying(true);
  }

  return (
    <main className="game-screen playfield-test-screen">
      <header className="game-hud playfield-test-hud">
        <div className="game-controls">
          <button className="text-button" onClick={onBack}>Back</button>
          <button className="text-button" onClick={() => {
            playingRef.current = !playingRef.current;
            setPlaying(playingRef.current);
          }}>
            {playing ? "Pause" : "Play"}
          </button>
          <button className="text-button restart-button" onClick={reset}>Reset</button>
        </div>
        <div className="hud-track"><small>PLAYFIELD TEST</small><strong>{level.song.title}</strong></div>
        <div><small>TIME</small><strong>{time.toFixed(2)}s</strong></div>
        <div><small>LEFT</small><strong>{leftLane ?? "—"}</strong></div>
        <div><small>RIGHT</small><strong>{rightLane ?? "—"}</strong></div>
        <div className="judgements">No camera · No model</div>
      </header>

      <div className="game-layout">
        <section className="playfield-shell">
          <div ref={mountRef} className="pixi-stage" />
          {!ready && (
            <div className="game-overlay">
              <h2>{error ? "Playfield unavailable" : "Loading playfield…"}</h2>
              <span>{error || "Track, lanes, and chart notes only."}</span>
            </div>
          )}
        </section>

        <aside className="playfield-test-panel panel">
          <p className="eyebrow">CONTROLS</p>
          <h3>Preview the track</h3>
          <p className="playfield-test-copy">
            Scrub time or press Space to play and pause. Notes scroll without audio, webcam, or pose model.
          </p>
          <label className="playfield-test-slider">
            <span>Time</span>
            <input
              type="range"
              min={0}
              max={endTime}
              step={0.01}
              value={time}
              onChange={(event) => {
                const next = Number(event.target.value);
                timeRef.current = next;
                setTime(next);
              }}
            />
            <output>{time.toFixed(2)}s / {endTime.toFixed(0)}s</output>
          </label>
          <div className="playfield-test-keys">
            <div>
              <strong>Left foot</strong>
              <span>1 · 2 · 3 · 4</span>
            </div>
            <div>
              <strong>Right foot</strong>
              <span>Q · W · E · R</span>
            </div>
            <div>
              <strong>Playback</strong>
              <span>Space</span>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
