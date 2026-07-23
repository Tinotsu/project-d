import { useCallback, useState } from "react";
import { CameraPanel } from "./camera-panel.tsx";
import { initialCameraSnapshot, type CameraInput, type CameraSnapshot } from "./camera-input.ts";

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
      <div className="screen-heading">
        <div>
          <p className="eyebrow">{mode === "play" ? "CAMERA INPUT" : "MOVEMENT LAB · STEP 1 OF 2"}</p>
          <h2>Calibrate your floor</h2>
          <p>{mode === "play"
            ? "Keep the full play area and both feet visible, then mark its corners."
            : "Use the same floor setup as Play Now. The next page lets you send movements down the game track."}</p>
        </div>
        <button className="primary" disabled={!snapshot.calibrated || !levelReady} onClick={onContinue}>
          {mode === "play" ? "Continue to level" : "Continue to playfield"}
        </button>
      </div>
      <CameraPanel input={cameraInput} onSnapshot={receiveSnapshot} />
    </main>
  );
}
