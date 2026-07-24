import { describe, expect, it } from "vitest";
import { screenFromPath } from "./app.tsx";

describe("screenFromPath", () => {
  it("opens each menu destination as its own SPA page", () => {
    expect(screenFromPath("/camera")).toBe("camera");
    expect(screenFromPath("/builder")).toBe("builder");
    expect(screenFromPath("/track")).toBe("track");
    expect(screenFromPath("/movement/setup")).toBe("movement-setup");
    expect(screenFromPath("/movement/test")).toBe("movement-test");
  });

  it("returns to the menu for an unknown path", () => {
    expect(screenFromPath("/not-a-page")).toBe("menu");
  });
});
