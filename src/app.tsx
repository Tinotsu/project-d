import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { CameraInput } from "./camera-input.ts";
import { Button } from "./components/ui/button.tsx";
import type { GameSnapshot } from "./game-session.ts";
import { loadLevel, type LoadedLevel } from "./level.ts";

type Screen = "menu" | "camera" | "game" | "results" | "builder" | "track" | "movement-setup" | "movement-test";

const screenPaths: Record<Screen, string> = {
  menu: "/",
  camera: "/camera",
  game: "/game",
  results: "/results",
  builder: "/builder",
  track: "/track",
  "movement-setup": "/movement/setup",
  "movement-test": "/movement/test",
};

export function screenFromPath(pathname: string): Screen {
  return (Object.entries(screenPaths).find(([, path]) => path === pathname)?.[0] as Screen | undefined) ?? "menu";
}

const SetupScreen = lazy(() => import("./setup-screen.tsx").then((module) => ({ default: module.SetupScreen })));
const GameScreen = lazy(() => import("./game-screen.tsx").then((module) => ({ default: module.GameScreen })));
const LevelBuilder = lazy(() => import("./level-builder.tsx").then((module) => ({ default: module.LevelBuilder })));
const PlayfieldTestScreen = lazy(() => import("./playfield-test-screen.tsx").then((module) => ({ default: module.PlayfieldTestScreen })));
const MovementTestScreen = lazy(() => import("./movement-test-screen.tsx").then((module) => ({ default: module.MovementTestScreen })));

export function App() {
  const [screen, setScreen] = useState<Screen>(() => screenFromPath(window.location.pathname));
  const [level, setLevel] = useState<LoadedLevel>();
  const [builderLevel, setBuilderLevel] = useState<LoadedLevel>();
  const [publishedLevels, setPublishedLevels] = useState<LoadedLevel[]>([]);
  const [trackReturn, setTrackReturn] = useState<"menu" | "builder">("menu");
  const [loadError, setLoadError] = useState("");
  const [cameraCalibrated, setCameraCalibrated] = useState(false);
  const [result, setResult] = useState<GameSnapshot>();
  const [cameraInput, setCameraInput] = useState<CameraInput>();
  const cameraInputRef = useRef<CameraInput | undefined>(undefined);

  useEffect(() => {
    loadLevel("/levels/second-heaven/test.json").then((loadedLevel) => {
      setLevel(loadedLevel);
      setPublishedLevels([loadedLevel]);
      if (window.location.pathname === screenPaths.builder) setBuilderLevel(loadedLevel);
    }).catch((error: unknown) => {
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

  if (screen === "game") {
    if (!level || !cameraInput) return <LoadingScreen />;
    return (
      <Suspense fallback={<LoadingScreen />}>
        <GameScreen cameraInput={cameraInput} level={level} onExit={() => navigate("menu")} onFinish={finishGame} />
      </Suspense>
    );
  }

  if (screen === "builder") {
    if (!builderLevel) return <LoadingScreen />;
    return (
      <Suspense fallback={<LoadingScreen />}>
        <LevelBuilder
          level={builderLevel}
          onBack={() => navigate("menu")}
          onSave={setBuilderLevel}
          onPublish={(publishedLevel) => {
            setBuilderLevel(publishedLevel);
            setLevel(publishedLevel);
            setPublishedLevels((current) => [
              publishedLevel,
              ...current.filter((candidate) => candidate.song.id !== publishedLevel.song.id),
            ]);
          }}
          onTest={(testLevel) => {
            setBuilderLevel(testLevel);
            setLevel(testLevel);
            setTrackReturn("builder");
            navigate("track");
          }}
        />
      </Suspense>
    );
  }

  if (screen === "track") {
    if (!level) return <LoadingScreen />;
    return (
      <Suspense fallback={<LoadingScreen />}>
        <PlayfieldTestScreen level={level} onBack={() => navigate(trackReturn)} />
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
        <main className="home-screen">
          <section className="home-hero">
            <div>
              <small>RHYTHM · MOVEMENT · CREATION</small>
              <h1>Build the beat.<br /><span>Move the room.</span></h1>
              <p>Create four-lane movement levels, shape every step against the music, then play them with your whole body.</p>
            </div>
            <Button
              size="lg"
              disabled={!level}
              onClick={() => {
                if (!level) return;
                const draft = structuredClone(level);
                draft.song = { ...draft.song, id: "untitled-level", title: "Untitled level", audio: "", duration: 60 };
                draft.chart = {
                  ...draft.chart,
                  song: "",
                  level: { ...draft.chart.level, id: "untitled-level", difficulty: "Normal", endTime: 60 },
                  notes: [],
                };
                setBuilderLevel(draft);
                navigate("builder");
              }}
            >
              ＋ Build a new level
            </Button>
          </section>

          <section className="level-library">
            <div className="library-heading">
              <div>
                <small>YOUR LIBRARY</small>
                <h2>Published levels</h2>
              </div>
              <span>{publishedLevels.length} LEVEL{publishedLevels.length === 1 ? "" : "S"}</span>
            </div>
            <div className="level-cards">
              {publishedLevels.map((libraryLevel, index) => (
                <article className="level-card" key={`${libraryLevel.song.id}-${index}`}>
                  <div className="level-art" aria-hidden="true">
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <i />
                    <i />
                    <i />
                    <i />
                  </div>
                  <div className="level-card-copy">
                    <span className="level-status"><i /> PUBLISHED</span>
                    <h3>{libraryLevel.song.title}</h3>
                    <p>{libraryLevel.chart.level.difficulty} · {libraryLevel.chart.notes.length} moves · {Math.ceil(libraryLevel.song.duration)} sec</p>
                  </div>
                  <div className="level-card-actions">
                    <Button size="sm" onClick={() => {
                      setLevel(libraryLevel);
                      if (cameraCalibrated && cameraInput) navigate("game");
                      else void openSetup();
                    }}>Play</Button>
                    <Button size="sm" variant="outline" onClick={() => {
                      setBuilderLevel(structuredClone(libraryLevel));
                      navigate("builder");
                    }}>Edit</Button>
                  </div>
                </article>
              ))}
              {!publishedLevels.length && !loadError && <div className="library-loading">Loading your levels…</div>}
            </div>
          </section>

          <nav className="home-tools" aria-label="Developer tools">
            <Button variant="ghost" onClick={() => void openSetup()}>Camera setup</Button>
            <Button variant="ghost" onClick={() => void openSetup("movement-setup")}>Movement test</Button>
            <Button variant="ghost" disabled={!level} onClick={() => {
              setTrackReturn("menu");
              navigate("track");
            }}>Playfield test</Button>
          </nav>
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
