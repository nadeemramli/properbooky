import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Book, BookEdit, MetadataCandidate } from "./types";
import MetadataLookup from "./MetadataLookup";

import { bookEdit } from "./bookMetadata";
import MergeReview from "./MergeReview";
import SourceProfiles from "./SourceProfiles";

const labels: Record<keyof BookEdit, string> = {
  title: "Title",
  author: "Author",
  category: "Topics",
  content_type: "Content type",
  reading_status: "Reading status",
  want_to_read: "Want to read",
  up_next: "Up next",
};

export default function BookReview({
  book,
  onClose,
  onSaved,
}: {
  book: Book;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [edit, setEdit] = useState<BookEdit>(() => bookEdit(book));
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Book[]>([]);
  const [candidateQuery, setCandidateQuery] = useState("");
  const [mergeTarget, setMergeTarget] = useState<Book | null>(null);
  const [metadata, setMetadata] = useState<{
    candidate: MetadataCandidate;
    cover: boolean;
  } | null>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, [mergeTarget]);
  useEffect(() => {
    let cancelled = false;
    {
      invoke<Book[]>("list_books", { query: null })
        .then((books) => {
          if (!cancelled)
            setCandidates(books.filter((b) => b.stable_id !== book.stable_id));
        })
        .catch((e) => {
          if (!cancelled) setError(String(e));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [book.stable_id]);
  const original = bookEdit(book);
  const changed = (Object.keys(labels) as (keyof BookEdit)[]).filter(
    (key) => original[key] !== edit[key],
  );
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (metadata)
        await invoke("accept_metadata", {
          id: book.stable_id,
          expected: original,
          edit,
          candidate: metadata.candidate,
          useCover: metadata.cover,
        });
      else await invoke("update_book", { id: book.stable_id, edit });
      await onSaved();
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  if (mergeTarget)
    return (
      <MergeReview
        primary={book}
        secondary={mergeTarget}
        onClose={() => setMergeTarget(null)}
        onSaved={async () => {
          await onSaved();
          onClose();
        }}
      />
    );
  const matchingCandidates = candidates
    .filter((candidate) =>
      candidateQuery.trim()
        ? `${candidate.title} ${candidate.author ?? ""}`
            .toLocaleLowerCase()
            .includes(candidateQuery.trim().toLocaleLowerCase())
        : book.duplicate_candidates.includes(candidate.stable_id),
    )
    .slice(0, 12);
  return (
    <dialog
      ref={dialog}
      className="book-review"
      aria-labelledby="review-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header className="review-header">
        <div>
          <p className="eyebrow">Library cleanup</p>
          <h2 id="review-title">Review details</h2>
        </div>
        <button onClick={onClose} disabled={busy} aria-label="Close review">
          ×
        </button>
      </header>
      <p className="review-context">
        {book.issues.join(" · ") || "Edit your library profile"}
      </p>
      {error && (
        <p role="alert" className="status">
          {error}
        </p>
      )}
      {preview ? (
        <section>
          <h3>Review your changes</h3>
          <table>
            <thead>
              <tr>
                <th>Field</th>
                <th>Current</th>
                <th>New</th>
              </tr>
            </thead>
            <tbody>
              {changed.map((key) => (
                <tr key={key}>
                  <th>{labels[key]}</th>
                  <td>{String(original[key] ?? "—")}</td>
                  <td>{String(edit[key] ?? "—")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {metadata && (
            <p>
              Metadata source:{" "}
              <a
                href={`https://openlibrary.org${metadata.candidate.key}`}
                onClick={(e) => {
                  e.preventDefault();
                  openUrl(
                    `https://openlibrary.org${metadata.candidate.key}`,
                  ).catch((error) => setError(String(error)));
                }}
                target="_blank"
                rel="noreferrer"
              >
                {metadata.candidate.title} · Open Library
              </a>
              .{" "}
              {metadata.cover
                ? "Download and use this result’s cover."
                : "Keep the current cover."}{" "}
              Edition year and ISBN stay unchanged.
            </p>
          )}
          <p>
            These corrections stay with your library. Original files and
            filenames are preserved. You can undo the change from Library
            cleanup.
          </p>
          <footer>
            <button onClick={() => setPreview(false)} disabled={busy}>
              Back to editing
            </button>
            <button className="primary" onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save changes"}
            </button>
          </footer>
        </section>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setPreview(true);
          }}
        >
          <div className="review-fields">
            <label className="wide">
              Title
              <input
                value={edit.title}
                required
                maxLength={500}
                onChange={(e) => setEdit({ ...edit, title: e.target.value })}
              />
            </label>
            <label className="wide">
              Author
              <input
                value={edit.author ?? ""}
                placeholder="Unknown"
                onChange={(e) =>
                  setEdit({ ...edit, author: e.target.value || null })
                }
              />
            </label>
            <label className="wide">
              Topics
              <input
                value={edit.category ?? ""}
                placeholder="Psychology, Decision-making"
                onChange={(e) =>
                  setEdit({ ...edit, category: e.target.value || null })
                }
              />
            </label>
            <label>
              Content type
              <select
                value={edit.content_type}
                onChange={(e) =>
                  setEdit({ ...edit, content_type: e.target.value })
                }
              >
                {[
                  "unidentified",
                  "book",
                  "paper",
                  "report",
                  "manual",
                  "notes",
                  "article",
                  "other",
                ].map((v) => (
                  <option key={v} value={v}>
                    {v[0].toUpperCase() + v.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Reading status
              <select
                value={edit.reading_status}
                onChange={(e) =>
                  setEdit({
                    ...edit,
                    reading_status: e.target.value as Book["reading_status"],
                  })
                }
              >
                {["unread", "reading", "paused", "finished", "stopped"].map(
                  (v) => (
                    <option key={v} value={v}>
                      {v[0].toUpperCase() + v.slice(1)}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={edit.want_to_read}
                onChange={(e) =>
                  setEdit({ ...edit, want_to_read: e.target.checked })
                }
              />
              Want to read
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={edit.up_next}
                onChange={(e) =>
                  setEdit({ ...edit, up_next: e.target.checked })
                }
              />
              Up next
            </label>
          </div>
          {book.content_type === "book" ||
          book.content_type === "unidentified" ? (
            <MetadataLookup
              edit={edit}
              hasCover={Boolean(book.cover)}
              onSelect={(candidate, nextEdit, cover) => {
                setEdit(nextEdit);
                setMetadata({ candidate, cover });
              }}
            />
          ) : null}
          {metadata && (
            <p role="status">
              Suggestions selected from {metadata.candidate.title}. Preview
              changes to save them.
            </p>
          )}
          {book.metadata_source && (
            <p>
              Last accepted metadata:{" "}
              <a
                href={book.metadata_source.source_url}
                onClick={(e) => {
                  e.preventDefault();
                  openUrl(book.metadata_source!.source_url).catch((error) =>
                    setError(String(error)),
                  );
                }}
                target="_blank"
                rel="noreferrer"
              >
                {book.metadata_source.suggested_title} · Open Library
              </a>
              ,{" "}
              {new Date(
                book.metadata_source.accepted_at * 1000,
              ).toLocaleDateString()}
              .
            </p>
          )}
          <details className="review-source">
            <summary>Original location and edition context</summary>
            <p>{book.path}</p>
            {book.file_link && <p>File: {book.file_link}</p>}
            <p>
              {book.year
                ? `Publication year: ${book.year}`
                : "Publication year unknown"}{" "}
              · {book.format.toUpperCase() || "No linked format"}
            </p>
            <p>
              Availability:{" "}
              {book.availability === "local"
                ? "On the shelf"
                : book.availability === "missing"
                  ? "File missing"
                  : "No local file"}
            </p>
          </details>
          <SourceProfiles sources={book.source_profiles} />
          {
            <section className="review-candidates">
              <h3>Possible duplicates</h3>
              <p>
                These profiles share a linked file, identical file content, or a
                similar title and author. Compare edition details before
                combining. Sources and files are preserved, and the combination
                can be undone.
              </p>
              <label className="candidate-search">
                Find another profile
                <input
                  type="search"
                  placeholder="Search another title or author"
                  value={candidateQuery}
                  onChange={(e) => setCandidateQuery(e.target.value)}
                />
              </label>
              {matchingCandidates.map((candidate) => (
                <article key={candidate.stable_id}>
                  <strong>{candidate.title}</strong>
                  <p>
                    {candidate.author ?? "Unknown author"} ·{" "}
                    {candidate.year ?? "Year unknown"} ·{" "}
                    {candidate.format.toUpperCase() || "No file"}
                  </p>
                  <small>{candidate.file_link ?? candidate.path}</small>
                  <div>
                    <button
                      type="button"
                      onClick={() => setMergeTarget(candidate)}
                      disabled={changed.length > 0 || metadata !== null}
                    >
                      Review combination
                    </button>
                  </div>
                </article>
              ))}
              {(changed.length > 0 || metadata !== null) && (
                <p>
                  Save or cancel your metadata edits before combining profiles.
                </p>
              )}
              {candidateQuery && matchingCandidates.length === 0 && (
                <p>No matching profiles.</p>
              )}
            </section>
          }
          <footer>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button
              className="primary"
              type="submit"
              disabled={
                !edit.title.trim() || (changed.length === 0 && !metadata)
              }
            >
              Preview changes
            </button>
          </footer>
        </form>
      )}
    </dialog>
  );
}
