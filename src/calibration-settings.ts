export type CalibrationSettings = {
  cueDelayMs: number;
  responseTimeoutMs: number;
  minimumFootConfidence: number;
  stepLift: number;
  stepLanding: number;
  stepDescent: number;
  jumpLift: number;
  jumpLanding: number;
  jumpDescent: number;
  stepPerfectMs: number;
  stepGreatMs: number;
  stepGoodMs: number;
  jumpPerfectMs: number;
  jumpGreatMs: number;
  jumpGoodMs: number;
  missGraceMs: number;
};

export const defaultCalibrationSettings: CalibrationSettings = {
  cueDelayMs: 2000,
  responseTimeoutMs: 1200,
  minimumFootConfidence: 0.5,
  stepLift: 0.01,
  stepLanding: 0.006,
  stepDescent: 0.01,
  jumpLift: 0.035,
  jumpLanding: 0.015,
  jumpDescent: 0.025,
  stepPerfectMs: 60,
  stepGreatMs: 120,
  stepGoodMs: 200,
  jumpPerfectMs: 50,
  jumpGreatMs: 100,
  jumpGoodMs: 160,
  missGraceMs: 40,
};

const storageKey = "floorrush-calibration-settings";

export function loadCalibrationSettings(): CalibrationSettings {
  if (typeof localStorage === "undefined" || typeof localStorage.getItem !== "function") {
    return defaultCalibrationSettings;
  }
  const saved = localStorage.getItem(storageKey);
  if (!saved) return defaultCalibrationSettings;
  try {
    return { ...defaultCalibrationSettings, ...JSON.parse(saved) as Partial<CalibrationSettings> };
  } catch {
    return defaultCalibrationSettings;
  }
}

export function saveCalibrationSettings(settings: CalibrationSettings): void {
  localStorage.setItem(storageKey, JSON.stringify(settings));
}
