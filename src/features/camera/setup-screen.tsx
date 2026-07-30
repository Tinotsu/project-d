import { useCallback, useState } from "react";
import { CameraPanel } from "./camera-panel.tsx";
import { initialCameraSnapshot, type CameraInput, type CameraSnapshot } from "./camera-input.ts";
import { Button } from "../../shared/ui/button.tsx";

type SetupScreenProps = {
  cameraInput: CameraInput;
  levelReady: boolean;
  mode?: "play" | "movement-test";
  onCalibrationChange: (calibrated: boolean) => void;
  onContinue: () => void;
};

export function SetupScreen({ cameraInput, levelReady, mode = "play", onCalibrationChange, onContinue }: SetupScreenProps) {
  const [snapshot, setSnapshot] = useState(initialCameraSnapshot);
  const receiveSnapshot = useCallback((next: CameraSnapshot) => {
    setSnapshot(next);
    onCalibrationChange(next.calibrated);
  }, [onCalibrationChange]);

  return (
    <main className="setup-screen">
      <div className="page-toolbar">
        <strong>{mode === "play" ? "Camera" : "Movement test"}</strong>
        <Button disabled={!snapshot.calibrated || !levelReady} onClick={onContinue}>
          {mode === "play" ? "Continue to level" : "Continue to playfield"}
        </Button>
      </div>
      <CameraPanel input={cameraInput} onSnapshot={receiveSnapshot} />
    </main>
  );
}
