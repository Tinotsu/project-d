import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import footUrl from "../assets/foot.svg?url";
import jumpUrl from "../assets/jump.svg?url";
import type { CameraInput } from "./camera-input.ts";
import type { GameSnapshot } from "./game-session.ts";
import { loadLevel, type LoadedLevel } from "./level.ts";

type Screen = "home" | "setup" | "game" | "results" | "editor" | "playfield-test" | "movement-setup" | "movement-test";

const SetupScreen = lazy(() => import("./setup-screen.tsx").then((module) => ({ default: module.SetupScreen })));
const GameScreen = lazy(() => import("./game-screen.tsx").then((module) => ({ default: module.GameScreen })));
const ChartEditor = lazy(() => import("./chart-editor.tsx").then((module) => ({ default: module.ChartEditor })));
const PlayfieldTestScreen = lazy(() => import("./playfield-test-screen.tsx").then((module) => ({ default: module.PlayfieldTestScreen })));
const MovementTestScreen = lazy(() => import("./movement-test-screen.tsx").then((module) => ({ default: module.MovementTestScreen })));

export function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [level, setLevel] = useState<LoadedLevel>();
  const [loadError, setLoadError] = useState("");
  const [cameraCalibrated, setCameraCalibrated] = useState(false);
  const [result, setResult] = useState<GameSnapshot>();
  const [cameraInput, setCameraInput] = useState<CameraInput>();
  const cameraInputRef = useRef<CameraInput | undefined>(undefined);

  useEffect(() => {
    loadLevel("/levels/second-heaven/test.json").then(setLevel).catch((error: unknown) => {
      setLoadError(error instanceof Error ? error.message : "Could not load levels");
    });
  }, []);

  useEffect(() => () => cameraInputRef.current?.destroy(), []);

  const finishGame = useCallback((gameResult: GameSnapshot) => {
    setResult(gameResult);
    setScreen("results");
  }, []);

  async function openSetup(destination: "setup" | "movement-setup" = "setup"): Promise<void> {
    if (!cameraInput) {
      const { CameraInput } = await import("./camera-input.ts");
      const input = new CameraInput();
      cameraInputRef.current = input;
      setCameraInput(input);
    }
    setScreen(destination);
  }

  function play(): void {
    if (cameraCalibrated && cameraInput) setScreen("game");
    else void openSetup();
  }

  if (screen === "game" && level) {
    return (
      <Suspense fallback={<LoadingScreen />}>
        <GameScreen cameraInput={cameraInput!} level={level} onExit={() => setScreen("home")} onFinish={finishGame} />
      </Suspense>
    );
  }

  if (screen === "editor" && level) {
    return <Suspense fallback={<LoadingScreen />}><ChartEditor level={level} onBack={() => setScreen("home")} /></Suspense>;
  }

  if (screen === "playfield-test" && level) {
    return (
      <Suspense fallback={<LoadingScreen />}>
        <PlayfieldTestScreen level={level} onBack={() => setScreen("home")} />
      </Suspense>
    );
  }

  if (screen === "movement-test" && cameraInput) {
    return (
      <Suspense fallback={<LoadingScreen />}>
        <MovementTestScreen
          cameraInput={cameraInput}
          level={level!}
          onBack={() => setScreen("home")}
          onRecalibrate={() => setScreen("movement-setup")}
          onCalibrationChange={setCameraCalibrated}
        />
      </Suspense>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <button className="brand" onClick={() => setScreen("home")}>
          <small>FLOOR</small><strong>RUSH</strong>
        </button>
        <nav>
          <button className={screen === "home" ? "active" : ""} onClick={() => setScreen("home")}>Play</button>
          <button className={screen === "setup" ? "active" : ""} onClick={() => void openSetup()}>Camera</button>
          <button className={screen === "movement-setup" ? "active" : ""} onClick={() => void openSetup("movement-setup")}>Movement test</button>
          <button onClick={() => setScreen("editor")} disabled={!level}>Chart editor</button>
          <button onClick={() => setScreen("playfield-test")} disabled={!level}>Track test</button>
        </nav>
      </header>

      {screen === "home" && (
        <main className="home-screen">
          <section className="hero">
            <p className="eyebrow">BROWSER RHYTHM GAME</p>
            <h1>Move fast.<br /><span>Hit the floor.</span></h1>
            <p>Camera-tracked footwork, four lanes, and one test chart ready to play.</p>
            <div className="hero-actions">
              <button className="primary large" disabled={!level} onClick={play}>Play now</button>
              <button className="secondary large" disabled={!level} onClick={() => setScreen("editor")}>Open chart editor</button>
              <button className="secondary large" disabled={!level} onClick={() => setScreen("playfield-test")}>Test track</button>
              <button className="secondary large" onClick={() => void openSetup("movement-setup")}>Test movements</button>
            </div>
            {loadError && <p className="error-message">{loadError}</p>}
          </section>

          <section className="song-card panel">
            <div className="song-art">
              <img className="jump-art" src={jumpUrl} alt="" />
              <img className="foot-art" src={footUrl} alt="" />
            </div>
            <div className="song-info">
              <p className="eyebrow">AVAILABLE CHART</p>
              <h2>{level?.song.title ?? "Loading…"}</h2>
              <div className="song-meta">
                <span>{level?.chart.level.difficulty ?? "—"}</span>
                <span>Rating {level?.chart.level.rating ?? "—"}</span>
                <span>{level?.chart.notes.length ?? 0} notes</span>
              </div>
              <button className="primary" disabled={!level} onClick={play}>Select level</button>
            </div>
          </section>
        </main>
      )}

      {(screen === "setup" || screen === "movement-setup") && cameraInput && (
        <Suspense fallback={<LoadingScreen />}>
          <SetupScreen
            cameraInput={cameraInput}
            levelReady={Boolean(level)}
            mode={screen === "movement-setup" ? "movement-test" : "play"}
            onCalibrationChange={setCameraCalibrated}
            onContinue={() => setScreen(screen === "movement-setup" ? "movement-test" : "game")}
          />
        </Suspense>
      )}

      {screen === "results" && result && (
        <main className="results-screen">
          <section className="results-card panel">
            <p className="eyebrow">LEVEL COMPLETE</p>
            <h1>{result.score.toString().padStart(6, "0")}</h1>
            <p>MAX COMBO <strong>{result.maxCombo}</strong></p>
            <div className="result-grid">
              <div><span>Perfect</span><strong>{result.perfect}</strong></div>
              <div><span>Great</span><strong>{result.great}</strong></div>
              <div><span>Good</span><strong>{result.good}</strong></div>
              <div><span>Miss</span><strong>{result.miss}</strong></div>
            </div>
            <div className="hero-actions">
              <button className="primary large" onClick={() => setScreen("game")}>Play again</button>
              <button className="secondary large" onClick={() => setScreen("home")}>Level select</button>
            </div>
          </section>
        </main>
      )}
    </div>
  );
}

function LoadingScreen() {
  return <main className="loading-screen">Loading…</main>;
}
