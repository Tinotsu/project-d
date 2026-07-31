export type LevelHistoryShortcut = "undo" | "redo";

type HistoryKeyboardEvent = Pick<
  KeyboardEvent,
  "altKey" | "ctrlKey" | "isComposing" | "key" | "metaKey" | "shiftKey"
>;

export function levelHistoryShortcut(event: HistoryKeyboardEvent): LevelHistoryShortcut | undefined {
  if (event.isComposing || event.altKey || (!event.ctrlKey && !event.metaKey) || event.key.toLowerCase() !== "z") {
    return undefined;
  }
  return event.shiftKey ? "redo" : "undo";
}
