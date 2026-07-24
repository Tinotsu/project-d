import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { CameraInput } from "./camera-input.ts";
import { Button } from "./components/ui/button.tsx";
import type { GameSnapshot } from "./game-session.ts";
import { loadLevel, type LoadedLevel } from "./level.ts";

type Screen = "menu" | "camera" | "game" | "results" | "editor" | "track" | "movement-setup" | "movement-test";

const screenPaths: Record<Screen, string> = {
  menu: "/",
  camera: "/camera",
  game: "/game",
  results: "/results",
  editor: "/editor",
  track: "/track",
  "movement-setup": "/movement/setup",
  "movement-test": "/movement/test",
};

export function screenFromPath(pathname: string): Screen {
  return (Object.entries(screenPaths).find(([, path]) => path === pathname)?.[0] as Screen | undefined) ?? "menu";
}

const SetupScreen = lazy(() => import("./setup-screen.tsx").then((module) => ({ default: module.SetupScreen })));
const GameScreen = lazy(() => import("./game-screen.tsx").then((module) => ({ default: module.GameScreen })));
const ChartEditor = lazy(() => import("./chart-editor.tsx").then((module) => ({ default: module.ChartEditor })));
const PlayfieldTestScreen = lazy(() => import("./playfield-test-screen.tsx").then((module) => ({ default: module.PlayfieldTestScreen })));
const MovementTestScreen = lazy(() => import("./movement-test-screen.tsx").then((module) => ({ default: module.MovementTestScreen })));

export function App() {
  const [screen, setScreen] = useState<Screen>(() => screenFromPath(window.location.pathname));
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

  useEffect(() => {
    const followBrowserNavigation = () => setScreen(screenFromPath(window.location.pathname));
    window.addEventListener("popstate", followBrowserNavigation);
    return () => window.removeEventListener("popstate", followBrowserNavigation);
  }, []);

  useEffect(() => {
    if (cameraInput || !["camera", "game", "movement-setup", "movement-test"].includes(screen)) return;
    void import("./camera-input.ts").then(({ CameraInput }) => {
      const input = new CameraInput();
      cameraInputRef.current = input;
      setCameraInput(input);
    });
  }, [cameraInput, screen]);

  useEffect(() => () => cameraInputRef.current?.destroy(), []);

  const navigate = useCallback((destination: Screen) => {
    window.history.pushState({}, "", screenPaths[destination]);
    setScreen(destination);
  }, []);

  useEffect(() => {
    if (screen === "results" && !result) navigate("menu");
  }, [navigate, result, screen]);

  const finishGame = useCallback((gameResult: GameSnapshot) => {
    setResult(gameResult);
    navigate("results");
  }, [navigate]);

  async function openSetup(destination: "camera" | "movement-setup" = "camera"): Promise<void> {
    if (!cameraInput) {
      const { CameraInput } = await import("./camera-input.ts");
      const input = new CameraInput();
      cameraInputRef.current = input;
      setCameraInput(input);
    }
    navigate(destination);
  }

  function play(): void {
    if (cameraCalibrated && cameraInput) navigate("game");
    else void openSetup();
  }

  if (screen === "game") {
    if (!level || !cameraInput) return <LoadingScreen />;
    return (
      <Suspense fallback={<LoadingScreen />}>
        <GameScreen cameraInput={cameraInput} level={level} onExit={() => navigate("menu")} onFinish={finishGame} />
      </Suspense>
    );
  }

  if (screen === "editor") {
    if (!level) return <LoadingScreen />;
    return <Suspense fallback={<LoadingScreen />}><ChartEditor level={level} onBack={() => navigate("menu")} /></Suspense>;
  }

  if (screen === "track") {
    if (!level) return <LoadingScreen />;
    return (
      <Suspense fallback={<LoadingScreen />}>
        <PlayfieldTestScreen level={level} onBack={() => navigate("menu")} />
      </Suspense>
    );
  }

  if (screen === "movement-test") {
    if (!level || !cameraInput) return <LoadingScreen />;
    return (
      <Suspense fallback={<LoadingScreen />}>
        <MovementTestScreen
          cameraInput={cameraInput}
          level={level}
          onBack={() => navigate("menu")}
          onRecalibrate={() => navigate("movement-setup")}
          onCalibrationChange={setCameraCalibrated}
        />
      </Suspense>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <Button className="brand" variant="ghost" onClick={() => navigate("menu")}>Project D</Button>
        {screen !== "menu" && <Button variant="outline" size="sm" onClick={() => navigate("menu")}>Menu</Button>}
      </header>

      {screen === "menu" && (
        <main className="menu-screen">
          <h1>Project D</h1>
          <div className="menu-grid">
            <Button className="menu-item" size="lg" disabled={!level} onClick={play}>Play</Button>
            <Button className="menu-item" size="lg" variant="outline" onClick={() => void openSetup()}>Camera</Button>
            <Button className="menu-item" size="lg" variant="outline" onClick={() => void openSetup("movement-setup")}>Movement test</Button>
            <Button className="menu-item" size="lg" variant="outline" disabled={!level} onClick={() => navigate("editor")}>Chart editor</Button>
            <Button className="menu-item" size="lg" variant="outline" disabled={!level} onClick={() => navigate("track")}>Track test</Button>
          </div>
          {loadError && <p className="error-message">{loadError}</p>}
        </main>
      )}

      {(screen === "camera" || screen === "movement-setup") && cameraInput && (
        <Suspense fallback={<LoadingScreen />}>
          <SetupScreen
            cameraInput={cameraInput}
            levelReady={Boolean(level)}
            mode={screen === "movement-setup" ? "movement-test" : "play"}
            onCalibrationChange={setCameraCalibrated}
            onContinue={() => navigate(screen === "movement-setup" ? "movement-test" : "game")}
          />
        </Suspense>
      )}

      {screen === "results" && result && (
        <main className="results-screen">
          <section className="results-card panel">
            <h1>{result.score.toString().padStart(6, "0")}</h1>
            <p>Max combo <strong>{result.maxCombo}</strong></p>
            <div className="result-grid">
              <div><span>Perfect</span><strong>{result.perfect}</strong></div>
              <div><span>Great</span><strong>{result.great}</strong></div>
              <div><span>Good</span><strong>{result.good}</strong></div>
              <div><span>Miss</span><strong>{result.miss}</strong></div>
            </div>
            <div className="hero-actions">
              <Button size="lg" onClick={() => navigate("game")}>Play again</Button>
              <Button size="lg" variant="outline" onClick={() => navigate("menu")}>Menu</Button>
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
