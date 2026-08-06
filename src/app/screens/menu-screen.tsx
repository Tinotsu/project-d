import type { LoadedLevel } from "../../domain/chart/types.ts";
import type { LevelVisibility, StoredLevel } from "../../features/level-library/level-repository.ts";
import { Button } from "../../shared/ui/button.tsx";
import { useState } from "react";

type MenuScreenProps = {
  level?: LoadedLevel;
  savedLevels: StoredLevel[];
  authenticated: boolean;
  loadError: string;
  onPlay: () => void;
  onOpenCamera: () => void;
  onNewLevel: () => void;
  onBrowseLevels: () => void;
  onOpenAssets: () => void;
  onPlayLevel: (level: LoadedLevel) => void;
  onEditLevel: (level: LoadedLevel) => void;
  onVisibilityChange: (id: string, visibility: LevelVisibility) => Promise<void>;
};

export function MenuScreen({
  level,
  savedLevels,
  authenticated,
  loadError,
  onPlay,
  onOpenCamera,
  onNewLevel,
  onBrowseLevels,
  onOpenAssets,
  onPlayLevel,
  onEditLevel,
  onVisibilityChange,
}: MenuScreenProps) {
  const [changingId, setChangingId] = useState("");
  const [visibilityError, setVisibilityError] = useState("");

  async function changeVisibility(id: string, visibility: LevelVisibility): Promise<void> {
    setChangingId(id);
    setVisibilityError("");
    try {
      await onVisibilityChange(id, visibility);
    } catch (error) {
      setVisibilityError(error instanceof Error ? error.message : "Could not change level visibility");
    } finally {
      setChangingId("");
    }
  }

  return (
    <main className="menu-screen">
      <h1>Project D</h1>
      <div className="menu-grid">
        <Button className="menu-item" size="lg" disabled={!level} onClick={onPlay}>Play</Button>
        <Button className="menu-item" size="lg" variant="outline" onClick={onOpenCamera}>Camera</Button>
        <Button className="menu-item" size="lg" variant="outline" onClick={onBrowseLevels}>Public levels</Button>
        <Button className="menu-item" size="lg" variant="outline" disabled={!level} onClick={onNewLevel}>
          {authenticated ? "Create a level" : "Log in to create levels"}
        </Button>
        <Button className="menu-item" size="lg" variant="outline" onClick={onOpenAssets}>3D assets</Button>
      </div>

      {authenticated && (
        <section className="published-levels panel">
          <div className="section-heading">
            <strong>My levels</strong>
            <small>{savedLevels.length}</small>
          </div>
          {savedLevels.length === 0 && <p className="empty-message">You have not created a level yet.</p>}
          {savedLevels.map((stored) => (
            <div className="published-level" key={stored.level.song.id}>
              <div>
                <strong>{stored.level.song.title}</strong>
                <span>
                  {stored.level.chart.level.difficulty} · {stored.level.chart.notes.filter((note) => note.type !== "STAY").length} moves · {stored.visibility}
                </span>
              </div>
              <Button size="sm" onClick={() => onPlayLevel(stored.level)}>Play</Button>
              <Button size="sm" variant="outline" onClick={() => onEditLevel(stored.level)}>Edit</Button>
              <Button
                size="sm"
                variant="outline"
                disabled={changingId === stored.level.song.id}
                onClick={() => void changeVisibility(stored.level.song.id, stored.visibility === "public" ? "private" : "public")}
              >
                {changingId === stored.level.song.id
                  ? "Updating…"
                  : stored.visibility === "public" ? "Make private" : "Publish"}
              </Button>
            </div>
          ))}
        </section>
      )}
      {(loadError || visibilityError) && <p className="error-message">{loadError || visibilityError}</p>}
    </main>
  );
}
