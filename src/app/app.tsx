import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { CameraInput } from "../features/camera/camera-input.ts";
import { Button } from "../shared/ui/button.tsx";
import type { GameSnapshot } from "../features/gameplay/game-session.ts";
import { loadLevel, type LoadedLevel } from "../features/level-library/level-loader.ts";
import {
  changeLevelVisibility,
  deleteStoredLevel,
  loadPublicLevel,
  loadStoredLevels,
  storeLevel,
  type LevelVisibility,
  type StoredLevel,
} from "../features/level-library/level-repository.ts";
import { authClient } from "../features/auth/auth-client.ts";
import { AuthScreen, type AuthScreenMode } from "../features/auth/auth-screen.tsx";
import { AccountScreen } from "../features/auth/account-screen.tsx";
import { PublicLevelsScreen } from "../features/level-library/public-levels-screen.tsx";
import { screenFromPath, screenPaths, type Screen } from "./routes.ts";
import { MenuScreen } from "./screens/menu-screen.tsx";
import { ResultsScreen } from "./screens/results-screen.tsx";

export { screenFromPath } from "./routes.ts";

const SetupScreen = lazy(() => import("../features/camera/setup-screen.tsx").then((module) => ({ default: module.SetupScreen })));
const GameScreen = lazy(() => import("../features/gameplay/game-screen.tsx").then((module) => ({ default: module.GameScreen })));
const LevelBuilder = lazy(() => import("../features/level-editor/level-builder-screen.tsx").then((module) => ({ default: module.LevelBuilder })));
const PlayfieldTestScreen = lazy(() => import("../features/playfield-test/playfield-test-screen.tsx").then((module) => ({ default: module.PlayfieldTestScreen })));
const AssetsScreen = lazy(() => import("../features/asset-lab/assets-screen.tsx").then((module) => ({ default: module.AssetsScreen })));

const authScreens: AuthScreenMode[] = ["login", "signup", "forgot-password", "reset-password"];

export function App() {
  const [screen, setScreen] = useState<Screen>(() => screenFromPath(window.location.pathname));
  const { data: session, isPending: sessionPending, refetch: refreshSession } = authClient.useSession();
  const [bundledLevel, setBundledLevel] = useState<LoadedLevel>();
  const [level, setLevel] = useState<LoadedLevel>();
  const [builderLevel, setBuilderLevel] = useState<LoadedLevel>();
  const [builderVisibility, setBuilderVisibility] = useState<LevelVisibility>("private");
  const [savedLevels, setSavedLevels] = useState<StoredLevel[]>([]);
  const [savedLevelsLoaded, setSavedLevelsLoaded] = useState(false);
  const [trackReturn, setTrackReturn] = useState<"menu" | "builder">("menu");
  const [loadError, setLoadError] = useState("");
  const [cameraCalibrated, setCameraCalibrated] = useState(false);
  const [result, setResult] = useState<GameSnapshot>();
  const [cameraInput, setCameraInput] = useState<CameraInput>();
  const cameraInputRef = useRef<CameraInput | undefined>(undefined);

  const navigate = useCallback((destination: Screen) => {
    window.history.pushState({}, "", screenPaths[destination]);
    setScreen(destination);
  }, []);

  useEffect(() => {
    loadLevel("/levels/second-heaven/test.json").then((loadedLevel) => {
      setBundledLevel(loadedLevel);
      setLevel((current) => current ?? loadedLevel);
    }).catch((error: unknown) => {
      setLoadError(error instanceof Error ? error.message : "Could not load the bundled level");
    });
  }, []);

  useEffect(() => {
    if (sessionPending) return;
    if (!session?.user) {
      setSavedLevels([]);
      setSavedLevelsLoaded(true);
      return;
    }

    let cancelled = false;
    setSavedLevels([]);
    setSavedLevelsLoaded(false);
    setLoadError("");
    loadStoredLevels().then((storedLevels) => {
      if (cancelled) return;
      setSavedLevels(storedLevels);
    }).catch((error: unknown) => {
      if (!cancelled) setLoadError(error instanceof Error ? error.message : "Could not load your levels");
    }).finally(() => {
      if (!cancelled) setSavedLevelsLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [navigate, session?.user.id, sessionPending]);

  useEffect(() => {
    if (sessionPending || !session?.user || !savedLevelsLoaded || screen !== "builder" || builderLevel) return;
    const stored = savedLevels[0];
    if (!stored) {
      navigate("menu");
      return;
    }
    setBuilderLevel(stored.level);
    setBuilderVisibility(stored.visibility);
  }, [builderLevel, navigate, savedLevels, savedLevelsLoaded, screen, session?.user.id, sessionPending]);

  useEffect(() => {
    const followBrowserNavigation = () => setScreen(screenFromPath(window.location.pathname));
    window.addEventListener("popstate", followBrowserNavigation);
    return () => window.removeEventListener("popstate", followBrowserNavigation);
  }, []);

  useEffect(() => {
    if (sessionPending) return;
    if (!session?.user && (screen === "builder" || screen === "account")) navigate("login");
    if (session?.user && authScreens.includes(screen as AuthScreenMode)) navigate("menu");
  }, [navigate, screen, session?.user.id, sessionPending]);

  useEffect(() => {
    if (cameraInput || !["camera", "game"].includes(screen)) return;
    void import("../features/camera/camera-input.ts").then(({ CameraInput }) => {
      const input = new CameraInput();
      cameraInputRef.current = input;
      setCameraInput(input);
    });
  }, [cameraInput, screen]);

  useEffect(() => () => cameraInputRef.current?.destroy(), []);

  useEffect(() => {
    if (screen === "results" && !result) navigate("menu");
  }, [navigate, result, screen]);

  const finishGame = useCallback((gameResult: GameSnapshot) => {
    setResult(gameResult);
    navigate("results");
  }, [navigate]);

  async function openSetup(): Promise<void> {
    if (!cameraInput) {
      const { CameraInput } = await import("../features/camera/camera-input.ts");
      const input = new CameraInput();
      cameraInputRef.current = input;
      setCameraInput(input);
    }
    navigate("camera");
  }

  function play(): void {
    if (cameraCalibrated && cameraInput) navigate("game");
    else void openSetup();
  }

  async function playPublicLevel(id: string): Promise<void> {
    const publicLevel = await loadPublicLevel(id);
    setLevel(publicLevel);
    if (cameraCalibrated && cameraInput) navigate("game");
    else await openSetup();
  }

  async function updateVisibility(id: string, visibility: LevelVisibility): Promise<void> {
    await changeLevelVisibility(id, visibility);
    setSavedLevels((current) => current.map((stored) => (
      stored.level.song.id === id ? { ...stored, visibility, updatedAt: Date.now() } : stored
    )));
    if (builderLevel?.song.id === id) setBuilderVisibility(visibility);
  }

  function openNewLevel(): void {
    if (!session?.user) {
      navigate("login");
      return;
    }
    if (!level) return;
    const draft = structuredClone(level);
    const id = `level-${crypto.randomUUID()}`;
    draft.path = "";
    draft.audioBlob = undefined;
    draft.song = { ...draft.song, id, title: "Untitled level", audio: "", duration: 60 };
    draft.chart = {
      ...draft.chart,
      song: "",
      level: { ...draft.chart.level, id, difficulty: "Normal", endTime: 60 },
      notes: [],
    };
    setBuilderLevel(draft);
    setBuilderVisibility("private");
    navigate("builder");
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
    if (sessionPending || !session?.user || !builderLevel) return <LoadingScreen />;
    return (
      <Suspense fallback={<LoadingScreen />}>
        <LevelBuilder
          level={builderLevel}
          canDelete={savedLevels.some((stored) => stored.level.song.id === builderLevel.song.id)}
          visibility={builderVisibility}
          onBack={() => navigate("menu")}
          onSave={async (savedLevel) => {
            await storeLevel(savedLevel);
            const existing = savedLevels.find((stored) => stored.level.song.id === savedLevel.song.id);
            const visibility = existing?.visibility ?? builderVisibility;
            setBuilderLevel(savedLevel);
            setLevel(savedLevel);
            setSavedLevels((current) => [
              { level: savedLevel, visibility, updatedAt: Date.now() },
              ...current.filter((stored) => stored.level.song.id !== savedLevel.song.id),
            ]);
          }}
          onVisibilityChange={async (savedLevel, visibility) => {
            await updateVisibility(savedLevel.song.id, visibility);
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
            const remainingLevels = savedLevels.filter((stored) => stored.level.song.id !== builderLevel.song.id);
            setSavedLevels(remainingLevels);
            if (level?.song.id === builderLevel.song.id) setLevel(remainingLevels[0]?.level ?? bundledLevel);
            setBuilderLevel(undefined);
            setBuilderVisibility("private");
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

  return (
    <div className="app-shell">
      <header className="app-header">
        <Button className="brand" variant="ghost" onClick={() => navigate("menu")}>
          <img src="/icon-d.png" alt="Project D" />
        </Button>
        <div className="app-header-actions">
          {screen !== "levels" && <Button variant="outline" size="sm" onClick={() => navigate("levels")}>Public levels</Button>}
          {screen !== "menu" && <Button variant="outline" size="sm" onClick={() => navigate("menu")}>Menu</Button>}
          {!sessionPending && (
            session?.user
              ? <Button size="sm" onClick={() => navigate("account")}>{session.user.name}</Button>
              : <Button size="sm" onClick={() => navigate("login")}>Log in</Button>
          )}
        </div>
      </header>

      {screen === "menu" && (
        <MenuScreen
          level={level}
          savedLevels={savedLevels}
          authenticated={Boolean(session?.user)}
          loadError={loadError}
          onPlay={play}
          onOpenCamera={() => void openSetup()}
          onNewLevel={openNewLevel}
          onBrowseLevels={() => navigate("levels")}
          onOpenAssets={() => navigate("assets")}
          onPlayLevel={(libraryLevel) => {
            setLevel(libraryLevel);
            if (cameraCalibrated && cameraInput) navigate("game");
            else void openSetup();
          }}
          onEditLevel={(libraryLevel) => {
            const stored = savedLevels.find((candidate) => candidate.level.song.id === libraryLevel.song.id);
            if (!stored) return;
            setBuilderLevel(structuredClone(stored.level));
            setBuilderVisibility(stored.visibility);
            navigate("builder");
          }}
          onVisibilityChange={updateVisibility}
        />
      )}

      {screen === "levels" && <PublicLevelsScreen onPlay={playPublicLevel} />}

      {authScreens.includes(screen as AuthScreenMode) && (
        <AuthScreen
          key={screen}
          mode={screen as AuthScreenMode}
          onAuthenticated={async () => {
            await refreshSession();
            navigate("menu");
          }}
          onNavigate={(destination) => navigate(destination)}
          onHome={() => navigate("menu")}
        />
      )}

      {screen === "account" && session?.user && (
        <AccountScreen
          name={session.user.name}
          email={session.user.email}
          onBack={() => navigate("menu")}
          onSignedOut={async () => {
            await refreshSession();
            setSavedLevels([]);
            setBuilderLevel(undefined);
            setLevel(bundledLevel);
            navigate("menu");
          }}
        />
      )}

      {screen === "camera" && cameraInput && (
        <Suspense fallback={<LoadingScreen />}>
          <SetupScreen
            cameraInput={cameraInput}
            levelReady={Boolean(level)}
            onCalibrationChange={setCameraCalibrated}
            onContinue={() => navigate("game")}
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
