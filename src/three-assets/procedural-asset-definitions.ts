export type StepFoot = "left" | "right";

export type ProceduralAssetKind =
  | "step"
  | "foot-base"
  | "foot"
  | "track"
  | "jump-base"
  | "jump"
  | "slide"
  | "stay"
  | "vertical-slide";

export type ProceduralAssetDefinition = {
  id: string;
  label: string;
  kind: ProceduralAssetKind;
  foot?: StepFoot;
  width: number;
  height: number;
};

export const proceduralAssets: ProceduralAssetDefinition[] = [
  { id: "left-step", label: "Left step", kind: "step", foot: "left", width: 152, height: 102 },
  { id: "right-step", label: "Right step", kind: "step", foot: "right", width: 152, height: 102 },
  { id: "foot-base", label: "Foot base", kind: "foot-base", width: 606, height: 104 },
  { id: "foot", label: "Tracked foot", kind: "foot", width: 100, height: 100 },
  { id: "track", label: "Track", kind: "track", width: 400, height: 1200 },
  { id: "jump-base", label: "Jump base", kind: "jump-base", width: 600, height: 100 },
  { id: "jump", label: "Jump indicator", kind: "jump", width: 600, height: 200 },
  { id: "left-slide", label: "Left slide", kind: "slide", foot: "left", width: 200, height: 300 },
  { id: "right-slide", label: "Right slide", kind: "slide", foot: "right", width: 200, height: 300 },
  { id: "left-stay", label: "Left stay", kind: "stay", foot: "left", width: 150, height: 300 },
  { id: "right-stay", label: "Right stay", kind: "stay", foot: "right", width: 150, height: 300 },
  { id: "left-vertical-slide", label: "Left vertical slide", kind: "vertical-slide", foot: "left", width: 150, height: 300 },
  { id: "right-vertical-slide", label: "Right vertical slide", kind: "vertical-slide", foot: "right", width: 150, height: 300 },
];
