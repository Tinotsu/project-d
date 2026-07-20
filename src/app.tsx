import { useCallback, useEffect, useState } from "react";
import footUrl from "../assets/foot.svg?url";
import jumpUrl from "../assets/jump.svg?url";
import { CameraPanel } from "./camera-panel.tsx";
import { CameraInput, initialCameraSnapshot, type CameraSnapshot } from "./camera-input.ts";
import { ChartEditor } from "./chart-editor.tsx";
import { GameScreen } from "./game-screen.tsx";
import type { GameSnapshot } from "./game-session.ts";
import { loadLevel, type LoadedLevel } from "./level.ts";

type Screen = "home" | "setup" | "game" | "results" | "editor";

export function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [level, setLevel] = useState<LoadedLevel>();
  const [loadError, setLoadError] = useState("");
  const [cameraSnapshot, setCameraSnapshot] = useState<CameraSnapshot>(initialCameraSnapshot);
  const [result, setResult] = useState<GameSnapshot>();
  const [cameraInput] = useState(() => new CameraInput());

  useEffect(() => {
    loadLevel("/levels/second-heaven/test.json").then(setLevel).catch((error: unknown) => {
      setLoadError(error instanceof Error ? error.message : "Could not load levels");
    });
    return () => cameraInput.destroy();
  }, [cameraInput]);

  const finishGame = useCallback((gameResult: GameSnapshot) => {
    setResult(gameResult);
    setScreen("results");
  }, []);

  function play(): void {
    setScreen(cameraSnapshot.calibrated ? "game" : "setup");
  }

  if (screen === "game" && level) {
    return <GameScreen cameraInput={cameraInput} level={level} onExit={() => setScreen("home")} onFinish={finishGame} />;
  }

  if (screen === "editor" && level) {
    return <ChartEditor level={level} onBack={() => setScreen("home")} />;
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <button className="brand" onClick={() => setScreen("home")}>
          <small>FLOOR</small><strong>RUSH</strong>
        </button>
        <nav>
          <button className={screen === "home" ? "active" : ""} onClick={() => setScreen("home")}>Play</button>
          <button className={screen === "setup" ? "active" : ""} onClick={() => setScreen("setup")}>Camera</button>
          <button onClick={() => setScreen("editor")} disabled={!level}>Chart editor</button>
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

      {screen === "setup" && (
        <main className="setup-screen">
          <div className="screen-heading">
            <div>
              <p className="eyebrow">CAMERA INPUT</p>
              <h2>Calibrate your floor</h2>
              <p>Keep the full play area and both feet visible, then mark its corners.</p>
            </div>
            <button className="primary" disabled={!cameraSnapshot.calibrated || !level} onClick={() => setScreen("game")}>
              Continue to level
            </button>
          </div>
          <CameraPanel input={cameraInput} onSnapshot={setCameraSnapshot} />
        </main>
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
