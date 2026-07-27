export type CalibrationSettings = {
  cueDelayMs: number;
  responseTimeoutMs: number;
  minimumFootConfidence: number;
  stepLift: number;
  stepLanding: number;
  stepDescent: number;
  stepPerfectMs: number;
  stepGreatMs: number;
  stepGoodMs: number;
  missGraceMs: number;
};

export const defaultCalibrationSettings: CalibrationSettings = {
  cueDelayMs: 2000,
  responseTimeoutMs: 1200,
  minimumFootConfidence: 0.5,
  stepLift: 0.01,
  stepLanding: 0.006,
  stepDescent: 0.01,
  stepPerfectMs: 60,
  stepGreatMs: 120,
  stepGoodMs: 200,
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
