import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { CameraInput } from "./camera-input.ts";
import { Button } from "./components/ui/button.tsx";
import type { GameSnapshot } from "./game-session.ts";
import { loadLevel, type LoadedLevel } from "./level.ts";
import { loadStoredLevels, storeLevel } from "./level-storage.ts";

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
  const [savedDrafts, setSavedDrafts] = useState<LoadedLevel[]>([]);
  const [trackReturn, setTrackReturn] = useState<"menu" | "builder">("menu");
  const [loadError, setLoadError] = useState("");
  const [cameraCalibrated, setCameraCalibrated] = useState(false);
  const [result, setResult] = useState<GameSnapshot>();
  const [cameraInput, setCameraInput] = useState<CameraInput>();
  const cameraInputRef = useRef<CameraInput | undefined>(undefined);

  useEffect(() => {
    Promise.all([
      loadLevel("/levels/second-heaven/test.json"),
      loadStoredLevels().catch(() => []),
    ]).then(([loadedLevel, storedLevels]) => {
      const storedPublished = storedLevels.filter((stored) => stored.published).map((stored) => stored.level);
      const drafts = storedLevels.filter((stored) => !stored.published).map((stored) => stored.level);
      const library = [
        ...storedPublished,
        ...(!storedPublished.some((stored) => stored.song.id === loadedLevel.song.id) ? [loadedLevel] : []),
      ];
      setLevel(storedPublished[0] ?? loadedLevel);
      setPublishedLevels(library);
      setSavedDrafts(drafts);
      if (window.location.pathname === screenPaths.builder) setBuilderLevel(drafts[0] ?? storedPublished[0] ?? loadedLevel);
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

  if (screen === "builder") {
    if (!builderLevel) return <LoadingScreen />;
    return (
      <Suspense fallback={<LoadingScreen />}>
        <LevelBuilder
          level={builderLevel}
          onBack={() => navigate("menu")}
          onSave={async (savedLevel) => {
            await storeLevel(savedLevel, false);
            setBuilderLevel(savedLevel);
            setSavedDrafts((current) => [
              savedLevel,
              ...current.filter((candidate) => candidate.song.id !== savedLevel.song.id),
            ]);
          }}
          onPublish={async (publishedLevel) => {
            await storeLevel(publishedLevel, true);
            setBuilderLevel(publishedLevel);
            setLevel(publishedLevel);
            setSavedDrafts((current) => current.filter((candidate) => candidate.song.id !== publishedLevel.song.id));
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
        <Button className="brand" variant="ghost" onClick={() => navigate("menu")}>
          <img src="/icon-d.png" alt="Project D" />
        </Button>
        {screen !== "menu" && <Button variant="outline" size="sm" onClick={() => navigate("menu")}>Menu</Button>}
      </header>

      {screen === "menu" && (
        <main className="menu-screen">
          <h1>Project D</h1>
          <div className="menu-grid">
            <Button className="menu-item" size="lg" disabled={!level} onClick={play}>Play</Button>
            <Button className="menu-item" size="lg" variant="outline" onClick={() => void openSetup()}>Camera</Button>
            <Button className="menu-item" size="lg" variant="outline" onClick={() => void openSetup("movement-setup")}>Movement test</Button>
            <Button className="menu-item" size="lg" variant="outline" disabled={!level} onClick={() => {
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
            }}>Level builder</Button>
            <Button className="menu-item" size="lg" variant="outline" disabled={!level} onClick={() => {
              setTrackReturn("menu");
              navigate("track");
            }}>Playfield test</Button>
          </div>

          <section className="published-levels panel">
            <div className="section-heading">
              <strong>Published levels</strong>
              <small>{publishedLevels.length}</small>
            </div>
            {publishedLevels.map((libraryLevel) => (
              <div className="published-level" key={libraryLevel.song.id}>
                <div>
                  <strong>{libraryLevel.song.title}</strong>
                  <span>{libraryLevel.chart.level.difficulty} · {libraryLevel.chart.notes.length} moves</span>
                </div>
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
            ))}
          </section>
          {savedDrafts.length > 0 && (
            <section className="published-levels panel saved-drafts">
              <div className="section-heading">
                <strong>Saved drafts</strong>
                <small>{savedDrafts.length}</small>
              </div>
              {savedDrafts.map((draft) => (
                <div className="published-level" key={draft.song.id}>
                  <div>
                    <strong>{draft.song.title}</strong>
                    <span>{draft.chart.notes.length} moves</span>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => {
                    setBuilderLevel(draft);
                    navigate("builder");
                  }}>Edit</Button>
                </div>
              ))}
            </section>
          )}
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
