import { useEffect, useMemo } from "react";
import { CameraInput } from "./camera-input.ts";
import { GameScreen } from "./game-screen.tsx";
import type { LoadedLevel } from "./level.ts";

type Test3DGameScreenProps = {
  level: LoadedLevel;
  onBack: () => void;
};

export function Test3DGameScreen({ level, onBack }: Test3DGameScreenProps) {
  const cameraInput = useMemo(() => new CameraInput(), []);

  useEffect(() => () => cameraInput.destroy(), [cameraInput]);

  return (
    <GameScreen
      cameraInput={cameraInput}
      level={level}
      onExit={onBack}
      onFinish={() => undefined}
      showTv
    />
  );
}
