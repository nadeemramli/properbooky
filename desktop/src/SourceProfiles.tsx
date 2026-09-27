import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SourceProfile } from "./types";

export default function SourceProfiles({
  sources,
}: {
  sources: SourceProfile[];
}) {
  const [text, setText] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      const raw = await invoke<string>("get_profile_source", { id });
      setText((current) => ({ ...current, [id]: raw }));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="source-profiles">
      <h3>Source profiles and edition context</h3>
      <p>Original notes, recommendations and metadata stay with each source.</p>
      {error && <p role="alert">{error}</p>}
      {sources.map((source) => (
        <details key={source.id}>
          <summary>
            {source.title} · {source.year ?? "Year unknown"}
          </summary>
          <p>
            {source.author ?? "Unknown author"} · {source.reading_status} ·{" "}
            {source.rating ? `Rating ${source.rating}` : "Unrated"}
            {source.recommended ? " · Recommended" : ""}
            {source.want_to_read ? " · Want to read" : ""}
            {source.up_next ? " · Up next" : ""}
          </p>
          <p>{source.category}</p>
          <small>{source.path}</small>
          {source.kind !== "file" && (
            <div>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => load(source.id)}
              >
                {busy === source.id
                  ? "Loading…"
                  : "Read original notes and metadata"}
              </button>
            </div>
          )}
          {text[source.id] !== undefined && <pre>{text[source.id]}</pre>}
        </details>
      ))}
    </section>
  );
}
