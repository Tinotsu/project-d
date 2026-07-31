import { describe, expect, it } from "vitest";
import { levelHistoryShortcut } from "./editor-history.ts";

function keyboardEvent(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    altKey: false,
    ctrlKey: false,
    isComposing: false,
    key: "z",
    metaKey: false,
    shiftKey: false,
    ...overrides,
  } as KeyboardEvent;
}

describe("levelHistoryShortcut", () => {
  it("recognizes Ctrl+Z and Command+Z as undo", () => {
    expect(levelHistoryShortcut(keyboardEvent({ ctrlKey: true }))).toBe("undo");
    expect(levelHistoryShortcut(keyboardEvent({ metaKey: true }))).toBe("undo");
  });

  it("recognizes shifted shortcuts as redo", () => {
    expect(levelHistoryShortcut(keyboardEvent({ ctrlKey: true, key: "Z", shiftKey: true }))).toBe("redo");
    expect(levelHistoryShortcut(keyboardEvent({ metaKey: true, shiftKey: true }))).toBe("redo");
  });

  it("ignores unrelated and composing shortcuts", () => {
    expect(levelHistoryShortcut(keyboardEvent({ ctrlKey: true, key: "y" }))).toBeUndefined();
    expect(levelHistoryShortcut(keyboardEvent({ ctrlKey: true, altKey: true }))).toBeUndefined();
    expect(levelHistoryShortcut(keyboardEvent({ ctrlKey: true, isComposing: true }))).toBeUndefined();
  });
});
