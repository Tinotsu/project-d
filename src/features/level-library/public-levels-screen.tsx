import { useEffect, useState, type FormEvent } from "react";
import { Button } from "../../shared/ui/button.tsx";
import { searchPublicLevels, type PublicLevelSummary } from "./level-repository.ts";

type PublicLevelsScreenProps = {
  onPlay: (id: string) => Promise<void>;
};

const difficulties = ["", "Easy", "Normal", "Hard", "Expert"];

export function PublicLevelsScreen({ onPlay }: PublicLevelsScreenProps) {
  const [query, setQuery] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [levels, setLevels] = useState<PublicLevelSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [playingId, setPlayingId] = useState("");
  const [error, setError] = useState("");

  async function search(): Promise<void> {
    setLoading(true);
    setError("");
    try {
      setLevels(await searchPublicLevels(query.trim(), difficulty));
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "Could not search public levels");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void search();
  }, []);

  async function play(id: string): Promise<void> {
    setPlayingId(id);
    setError("");
    try {
      await onPlay(id);
    } catch (playError) {
      setError(playError instanceof Error ? playError.message : "Could not load public level");
      setPlayingId("");
    }
  }

  return (
    <main className="levels-page">
      <div className="page-heading">
        <div>
          <h1>Public levels</h1>
          <p>Browse levels published by the community.</p>
        </div>
      </div>

      <form className="level-search panel" onSubmit={(event: FormEvent) => {
        event.preventDefault();
        void search();
      }}>
        <label>
          Title
          <input maxLength={100} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by title" />
        </label>
        <label>
          Difficulty
          <select value={difficulty} onChange={(event) => setDifficulty(event.target.value)}>
            {difficulties.map((value) => <option key={value} value={value}>{value || "All difficulties"}</option>)}
          </select>
        </label>
        <Button disabled={loading}>{loading ? "Searching…" : "Search"}</Button>
      </form>

      {error && <p className="error-message">{error}</p>}
      {!loading && !error && levels.length === 0 && <p className="empty-message">No public levels found.</p>}
      <section className="level-results" aria-live="polite">
        {levels.map((level) => (
          <article className="level-card panel" key={level.id}>
            <div>
              <strong>{level.title}</strong>
              <span>{level.difficulty} · {level.noteCount} moves · by {level.ownerName}</span>
            </div>
            <Button size="sm" disabled={Boolean(playingId)} onClick={() => void play(level.id)}>
              {playingId === level.id ? "Loading…" : "Play"}
            </Button>
          </article>
        ))}
      </section>
    </main>
  );
}
