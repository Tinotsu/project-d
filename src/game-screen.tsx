import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CameraPanel } from "./camera-panel.tsx";
import { type CameraInput, type CameraSnapshot } from "./camera-input.ts";
import { GameSession, type GameSnapshot } from "./game-session.ts";
import type { InputFrame } from "./foot-pose.ts";
import type { LoadedLevel } from "./level.ts";
import { PixiPlayfield } from "./pixi-playfield.ts";

type GameScreenProps = {
  cameraInput: CameraInput;
  level: LoadedLevel;
  onExit: () => void;
  onFinish: (result: GameSnapshot) => void;
};

export function GameScreen({ cameraInput, level, onExit, onFinish }: GameScreenProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const playfieldRef = useRef<PixiPlayfield | undefined>(undefined);
  const started = useRef(false);
  const finished = useRef(false);
  const session = useMemo(() => new GameSession(level), [level]);
  const [ready, setReady] = useState(false);
  const [starting, setStarting] = useState(false);
  const [hud, setHud] = useState(() => session.snapshot());
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let playfield: PixiPlayfield | undefined;

    Promise.all([
      PixiPlayfield.create(mountRef.current!, level.chart).then((created) => {
        playfield = created;
        playfieldRef.current = created;
      }),
      session.load(),
    ]).then(() => {
      if (cancelled) playfield?.destroy();
      else setReady(true);
    }).catch((loadError: unknown) => {
      setError(loadError instanceof Error ? loadError.message : "Could not prepare the level");
    });

    return () => {
      cancelled = true;
      session.stop();
      playfield?.destroy();
      playfieldRef.current = undefined;
    };
  }, [level, session]);

  useEffect(() => {
    let frame = 0;
    let lastHudUpdate = 0;
    const tick = (now: number) => {
      const playfield = playfieldRef.current;
      if (playfield) {
        const snapshot = session.snapshot();
        playfield.render(snapshot.time, snapshot.running, (noteId) => session.judged(noteId));
        if (now - lastHudUpdate > 50) {
          setHud(snapshot);
          lastHudUpdate = now;
        }
        if (started.current && !snapshot.running && !finished.current) {
          finished.current = true;
          onFinish(snapshot);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [onFinish, session]);

  const receiveCameraSnapshot = useCallback((snapshot: CameraSnapshot) => {
    playfieldRef.current?.showTrackedFeet(
      snapshot.leftLane === null ? null : snapshot.leftPosition,
      snapshot.rightLane === null ? null : snapshot.rightPosition,
    );
  }, []);

  const receiveFrame = useCallback((frame: InputFrame) => {
    const results = session.submit(frame);
    if (results.length) {
      results.forEach((result) => playfieldRef.current?.showResult(result));
      setHud(session.snapshot());
    }
  }, [session]);

  const togglePause = useCallback(async () => {
    await session.togglePause();
    setHud(session.snapshot());
  }, [session]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat) return;
      event.preventDefault();
      void togglePause();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [togglePause]);

  async function startLevel(): Promise<void> {
    setStarting(true);
    try {
      await session.start();
      started.current = true;
      finished.current = false;
      setHud(session.snapshot());
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Could not start the level");
    } finally {
      setStarting(false);
    }
  }

  return (
    <main className="game-screen">
      <header className="game-hud">
        <div className="game-controls">
          <button className="text-button" onClick={onExit}>Exit</button>
          <button className="text-button" disabled={!hud.running || starting} onClick={() => void togglePause()}>
            {hud.paused ? "Resume" : "Pause"}
          </button>
          <button className="text-button restart-button" disabled={!ready || starting} onClick={() => void startLevel()}>Restart</button>
        </div>
        <div className="hud-track"><small>TRACK</small><strong>{level.song.title}</strong></div>
        <div><small>SCORE</small><strong className="accent">{hud.score.toString().padStart(6, "0")}</strong></div>
        <div><small>COMBO</small><strong>{hud.combo}</strong></div>
        <div><small>TIME</small><strong>{hud.time.toFixed(3)}</strong></div>
        <div className="judgements">P {hud.perfect} · G {hud.great} · OK {hud.good} · M {hud.miss}</div>
      </header>

      <div className="game-layout">
        <section className="playfield-shell">
          <div ref={mountRef} className="pixi-stage" />
          {!hud.running && (
            <div className="game-overlay">
              <p>{level.chart.level.difficulty.toUpperCase()} · RATING {level.chart.level.rating}</p>
              <h2>{error ? "Level unavailable" : ready ? "Ready?" : "Loading level…"}</h2>
              <span>{error || "Step on the matching lanes as notes cross the floor line."}</span>
              {!error && (
                <button disabled={!ready || starting} onClick={() => void startLevel()}>
                  {starting ? "Starting…" : "Start level"}
                </button>
              )}
            </div>
          )}
        </section>

        <CameraPanel
          compact
          input={cameraInput}
          onFrame={receiveFrame}
          onSnapshot={receiveCameraSnapshot}
        />
      </div>
    </main>
  );
}
