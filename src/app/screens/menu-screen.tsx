import type { LoadedLevel } from "../../domain/chart/types.ts";
import { Button } from "../../shared/ui/button.tsx";

type MenuScreenProps = {
  level?: LoadedLevel;
  savedLevels: LoadedLevel[];
  loadError: string;
  onPlay: () => void;
  onOpenCamera: () => void;
  onOpenMovementTest: () => void;
  onNewLevel: () => void;
  onOpenPlayfieldTest: () => void;
  onOpenAssets: () => void;
  onPlayLevel: (level: LoadedLevel) => void;
  onEditLevel: (level: LoadedLevel) => void;
};

export function MenuScreen({
  level,
  savedLevels,
  loadError,
  onPlay,
  onOpenCamera,
  onOpenMovementTest,
  onNewLevel,
  onOpenPlayfieldTest,
  onOpenAssets,
  onPlayLevel,
  onEditLevel,
}: MenuScreenProps) {
  return (
    <main className="menu-screen">
      <h1>Project D</h1>
      <div className="menu-grid">
        <Button className="menu-item" size="lg" disabled={!level} onClick={onPlay}>Play</Button>
        <Button className="menu-item" size="lg" variant="outline" onClick={onOpenCamera}>Camera</Button>
        <Button className="menu-item" size="lg" variant="outline" onClick={onOpenMovementTest}>Movement test</Button>
        <Button className="menu-item" size="lg" variant="outline" disabled={!level} onClick={onNewLevel}>Level builder</Button>
        <Button className="menu-item" size="lg" variant="outline" disabled={!level} onClick={onOpenPlayfieldTest}>Playfield test</Button>
        <Button className="menu-item" size="lg" variant="outline" onClick={onOpenAssets}>3D assets</Button>
      </div>

      <section className="published-levels panel">
        <div className="section-heading">
          <strong>Saved levels</strong>
          <small>{savedLevels.length}</small>
        </div>
        {savedLevels.map((libraryLevel) => (
          <div className="published-level" key={libraryLevel.song.id}>
            <div>
              <strong>{libraryLevel.song.title}</strong>
              <span>{libraryLevel.chart.level.difficulty} · {libraryLevel.chart.notes.filter((note) => note.type !== "STAY").length} moves</span>
            </div>
            <Button size="sm" onClick={() => onPlayLevel(libraryLevel)}>Play</Button>
            <Button size="sm" variant="outline" onClick={() => onEditLevel(libraryLevel)}>Edit</Button>
          </div>
        ))}
      </section>
      {loadError && <p className="error-message">{loadError}</p>}
    </main>
  );
}
