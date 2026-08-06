export type Screen =
  | "menu"
  | "levels"
  | "login"
  | "signup"
  | "forgot-password"
  | "reset-password"
  | "account"
  | "camera"
  | "game"
  | "results"
  | "builder"
  | "track"
  | "assets";

export const screenPaths: Record<Screen, string> = {
  menu: "/",
  levels: "/levels",
  login: "/login",
  signup: "/signup",
  "forgot-password": "/forgot-password",
  "reset-password": "/reset-password",
  account: "/account",
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
