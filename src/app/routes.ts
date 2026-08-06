export type Screen =
  | "menu"
  | "camera"
  | "game"
  | "results"
  | "builder"
  | "track"
  | "assets";

export const screenPaths: Record<Screen, string> = {
  menu: "/",
  camera: "/camera",
  game: "/game",
  results: "/results",
  builder: "/builder",
  track: "/track",
  assets: "/assets",
};

export function screenFromPath(pathname: string): Screen {
  return (Object.entries(screenPaths).find(([, path]) => path === pathname)?.[0] as Screen | undefined) ?? "menu";
}
