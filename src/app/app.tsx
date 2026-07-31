import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { CameraInput } from "../features/camera/camera-input.ts";
import { Button } from "../shared/ui/button.tsx";
import type { GameSnapshot } from "../features/gameplay/game-session.ts";
import { loadLevel, type LoadedLevel } from "../features/level-library/level-loader.ts";
import { deleteStoredLevel, loadStoredLevels, storeLevel } from "../features/level-library/level-repository.ts";
import { screenFromPath, screenPaths, type Screen } from "./routes.ts";
import { MenuScreen } from "./screens/menu-screen.tsx";
import { ResultsScreen } from "./screens/results-screen.tsx";

export { screenFromPath } from "./routes.ts";

const SetupScreen = lazy(() => import("../features/camera/setup-screen.tsx").then((module) => ({ default: module.SetupScreen })));
const GameScreen = lazy(() => import("../features/gameplay/game-screen.tsx").then((module) => ({ default: module.GameScreen })));
const LevelBuilder = lazy(() => import("../features/level-editor/level-builder-screen.tsx").then((module) => ({ default: module.LevelBuilder })));
const PlayfieldTestScreen = lazy(() => import("../features/playfield-test/playfield-test-screen.tsx").then((module) => ({ default: module.PlayfieldTestScreen })));
const MovementTestScreen = lazy(() => import("../features/movement-test/movement-test-screen.tsx").then((module) => ({ default: module.MovementTestScreen })));
const AssetsScreen = lazy(() => import("../features/asset-lab/assets-screen.tsx").then((module) => ({ default: module.AssetsScreen })));

export function App() {
  const [screen, setScreen] = useState<Screen>(() => screenFromPath(window.location.pathname));
  const [level, setLevel] = useState<LoadedLevel>();
  const [builderLevel, setBuilderLevel] = useState<LoadedLevel>();
  const [savedLevels, setSavedLevels] = useState<LoadedLevel[]>([]);
  const [storedLevelIds, setStoredLevelIds] = useState<Set<string>>(new Set());
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
      const stored = storedLevels.map((stored) => stored.level);
      const library = [
        ...stored,
        ...(!stored.some((saved) => saved.song.id === loadedLevel.song.id) ? [loadedLevel] : []),
      ];
      setLevel(stored[0] ?? loadedLevel);
      setSavedLevels(library);
      setStoredLevelIds(new Set(stored.map((saved) => saved.song.id)));
      if (window.location.pathname === screenPaths.builder) setBuilderLevel(stored[0] ?? loadedLevel);
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
	    void import("../features/camera/camera-input.ts").then(({ CameraInput }) => {
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
      const { CameraInput } = await import("../features/camera/camera-input.ts");
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
          canDelete={storedLevelIds.has(builderLevel.song.id)}
          onBack={() => navigate("menu")}
          onSave={async (savedLevel) => {
            await storeLevel(savedLevel);
            setBuilderLevel(savedLevel);
            setLevel(savedLevel);
            setStoredLevelIds((current) => new Set(current).add(savedLevel.song.id));
            setSavedLevels((current) => [
              savedLevel,
              ...current.filter((candidate) => candidate.song.id !== savedLevel.song.id),
            ]);
          }}
          onTest={(testLevel) => {
            setBuilderLevel(testLevel);
            setLevel(testLevel);
            setTrackReturn("builder");
            navigate("track");
          }}
          onPlay={(playLevel) => {
            setBuilderLevel(playLevel);
            setLevel(playLevel);
            if (cameraCalibrated && cameraInput) navigate("game");
            else void openSetup();
          }}
          onDelete={async () => {
            await deleteStoredLevel(builderLevel.song.id);
            const remainingLevels = savedLevels.filter((candidate) => candidate.song.id !== builderLevel.song.id);
            setSavedLevels(remainingLevels);
            setStoredLevelIds((current) => {
              const next = new Set(current);
              next.delete(builderLevel.song.id);
              return next;
            });
            if (level?.song.id === builderLevel.song.id) setLevel(remainingLevels[0]);
            setBuilderLevel(remainingLevels[0]);
            navigate("menu");
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
        <MenuScreen
          level={level}
          savedLevels={savedLevels}
          loadError={loadError}
          onPlay={play}
          onOpenCamera={() => void openSetup()}
          onOpenMovementTest={() => void openSetup("movement-setup")}
          onNewLevel={() => {
            if (!level) return;
            const draft = structuredClone(level);
            const id = `level-${crypto.randomUUID()}`;
            draft.song = { ...draft.song, id, title: "Untitled level", audio: "", duration: 60 };
            draft.chart = {
              ...draft.chart,
              song: "",
              level: { ...draft.chart.level, id, difficulty: "Normal", endTime: 60 },
              notes: [],
            };
            setBuilderLevel(draft);
            navigate("builder");
          }}
          onOpenPlayfieldTest={() => {
            setTrackReturn("menu");
            navigate("track");
          }}
          onOpenAssets={() => navigate("assets")}
          onPlayLevel={(libraryLevel) => {
            setLevel(libraryLevel);
            if (cameraCalibrated && cameraInput) navigate("game");
            else void openSetup();
          }}
          onEditLevel={(libraryLevel) => {
            setBuilderLevel(structuredClone(libraryLevel));
            navigate("builder");
          }}
        />
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

      {screen === "assets" && (
        <Suspense fallback={<LoadingScreen />}>
          <AssetsScreen />
        </Suspense>
      )}

      {screen === "results" && result && (
        <ResultsScreen
          result={result}
          onPlayAgain={() => navigate("game")}
          onMenu={() => navigate("menu")}
        />
      )}
    </div>
  );
}

function LoadingScreen() {
  return <main className="loading-screen">Loading…</main>;
}
