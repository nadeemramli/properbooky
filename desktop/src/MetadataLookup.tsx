import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { BookEdit, MetadataCandidate } from "./types";

export default function MetadataLookup({
  edit,
  hasCover,
  onSelect,
}: {
  edit: BookEdit;
  hasCover: boolean;
  onSelect: (
    candidate: MetadataCandidate,
    edit: BookEdit,
    cover: boolean,
  ) => void;
}) {
  const [title, setTitle] = useState(edit.title);
  const [author, setAuthor] = useState(edit.author ?? "");
  const [result, setResult] = useState<{
    docs: MetadataCandidate[];
    fetched_at: number;
    stale: boolean;
  } | null>(null);
  const [selected, setSelected] = useState<MetadataCandidate | null>(null);
  const [useTitle, setUseTitle] = useState(true);
  const [useAuthor, setUseAuthor] = useState(!edit.author);
  const [useCover, setUseCover] = useState(!hasCover);
  const [topics, setTopics] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function lookup(refresh: boolean) {
    setBusy(true);
    setError("");
    setSelected(null);
    try {
      setResult(await invoke("lookup_metadata", { title, author, refresh }));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="metadata-lookup">
      <h3>Find book details and a cover</h3>
      <p>
        Search Open Library, then choose the fields to use. Check the author and
        title against your copy. Suggested subjects are optional; publication
        years describe the work, not necessarily your edition.
      </p>
      <div className="review-fields">
        <label>
          Search title
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={500}
          />
        </label>
        <label>
          Search author
          <input
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            maxLength={250}
          />
        </label>
      </div>
      <button
        type="button"
        disabled={busy || !title.trim()}
        onClick={() => lookup(false)}
      >
        {busy ? "Looking up…" : "Look up metadata"}
      </button>
      {result && (
        <button
          type="button"
          disabled={busy || !title.trim()}
          onClick={() => lookup(true)}
        >
          Refresh online results
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      {result && (
        <p role="status">
          {result.stale
            ? "Online lookup failed. Showing saved results from "
            : "Results fetched "}
          {new Date(result.fetched_at * 1000).toLocaleDateString()}.{" "}
          {result.docs.length === 0
            ? "No matches. Try a clearer title or edit manually."
            : ""}
        </p>
      )}
      <div className="metadata-results">
        {result?.docs.map((candidate) => (
          <article key={candidate.key}>
            <strong>{candidate.title}</strong>
            <p>
              {candidate.author_name.join(", ") || "Author unknown"} · First
              published {candidate.first_publish_year ?? "unknown"}
            </p>
            <a
              href={`https://openlibrary.org${candidate.key}`}
              onClick={(e) => {
                e.preventDefault();
                openUrl(`https://openlibrary.org${candidate.key}`).catch(
                  (error) => setError(String(error)),
                );
              }}
              target="_blank"
              rel="noreferrer"
            >
              Open Library source
            </a>{" "}
            <button
              type="button"
              onClick={() => {
                setSelected(candidate);
                setTopics([]);
              }}
            >
              Choose this result
            </button>
          </article>
        ))}
      </div>
      {selected && (
        <fieldset className="metadata-selection">
          <legend>Suggested fields for {selected.title}</legend>
          {selected.cover_i && (
            <img
              className="suggested-cover"
              src={`https://covers.openlibrary.org/b/id/${selected.cover_i}-M.jpg?default=false`}
              alt={`Suggested cover for ${selected.title}`}
              loading="lazy"
            />
          )}
          <label className="check">
            <input
              type="checkbox"
              checked={useTitle}
              onChange={(e) => setUseTitle(e.target.checked)}
            />
            Title: {selected.title}
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={useAuthor}
              disabled={!selected.author_name.length}
              onChange={(e) => setUseAuthor(e.target.checked)}
            />
            Author: {selected.author_name.join(", ") || "Unknown"}
          </label>
          {selected.cover_i && (
            <label className="check">
              <input
                type="checkbox"
                checked={useCover}
                onChange={(e) => setUseCover(e.target.checked)}
              />
              {hasCover ? "Replace existing cover" : "Download cover"} from this
              result
            </label>
          )}
          <p>Select subjects to add to your topics:</p>
          <div className="topic-suggestions">
            {selected.subject
              .filter((t) => !t.includes(","))
              .map((topic, i) => (
                <label className="check" key={`${topic}-${i}`}>
                  <input
                    type="checkbox"
                    checked={topics.includes(topic)}
                    onChange={(e) =>
                      setTopics(
                        e.target.checked
                          ? [...topics, topic]
                          : topics.filter((t) => t !== topic),
                      )
                    }
                  />
                  {topic}
                </label>
              ))}
          </div>
          <button
            type="button"
            onClick={() =>
              onSelect(
                selected,
                {
                  ...edit,
                  title: useTitle ? selected.title : edit.title,
                  author:
                    useAuthor && selected.author_name.length
                      ? selected.author_name.join(", ")
                      : edit.author,
                  category:
                    [
                      ...new Set([
                        ...(edit.category ?? "")
                          .split(",")
                          .map((t) => t.trim())
                          .filter(Boolean),
                        ...topics,
                      ]),
                    ].join(", ") || null,
                },
                Boolean(useCover && selected.cover_i),
              )
            }
          >
            Use selected fields
          </button>
        </fieldset>
      )}
    </section>
  );
}
