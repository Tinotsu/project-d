import type { GameSnapshot } from "../../features/gameplay/game-session.ts";
import { Button } from "../../shared/ui/button.tsx";

type ResultsScreenProps = {
  result: GameSnapshot;
  onPlayAgain: () => void;
  onMenu: () => void;
};

export function ResultsScreen({ result, onPlayAgain, onMenu }: ResultsScreenProps) {
  return (
    <main className="results-screen">
      <section className="results-card panel">
        <h1>{result.score.toString().padStart(6, "0")}</h1>
        <p>Max combo <strong>{result.maxCombo}</strong></p>
        <div className="result-grid">
          <div><span>Perfect</span><strong>{result.perfect}</strong></div>
          <div><span>Great</span><strong>{result.great}</strong></div>
          <div><span>Good</span><strong>{result.good}</strong></div>
          <div><span>Miss</span><strong>{result.miss}</strong></div>
        </div>
        <div className="hero-actions">
          <Button size="lg" onClick={onPlayAgain}>Play again</Button>
          <Button size="lg" variant="outline" onClick={onMenu}>Menu</Button>
        </div>
      </section>
    </main>
  );
}
