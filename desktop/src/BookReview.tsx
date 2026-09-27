import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Book, BookEdit } from "./types";

export function bookEdit(book: Book): BookEdit {
  return {
    title: book.title,
    author: book.author,
    category: book.category,
    content_type: book.content_type,
    reading_status: book.reading_status,
    want_to_read: book.want_to_read,
    up_next: book.up_next,
  };
}

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
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    let cancelled = false;
    if (book.duplicate_candidates.length) {
      invoke<Book[]>("list_books", { query: null })
        .then((books) => {
          if (!cancelled)
            setCandidates(
              books.filter((b) =>
                book.duplicate_candidates.includes(b.stable_id),
              ),
            );
        })
        .catch((e) => {
          if (!cancelled) setError(String(e));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [book.duplicate_candidates]);
  const original = bookEdit(book);
  const changed = (Object.keys(labels) as (keyof BookEdit)[]).filter(
    (key) => original[key] !== edit[key],
  );
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await invoke("update_book", { id: book.stable_id, edit });
      await onSaved();
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
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
          {book.duplicate_candidates.length > 0 && (
            <section className="review-candidates">
              <h3>Possible duplicates</h3>
              <p>
                These profiles share a linked file, identical file content, or a
                similar title and author. Compare edition details before
                merging. This release keeps candidates separate.
              </p>
              {candidates.map((candidate) => (
                <article key={candidate.stable_id}>
                  <strong>{candidate.title}</strong>
                  <p>
                    {candidate.author ?? "Unknown author"} ·{" "}
                    {candidate.year ?? "Year unknown"} ·{" "}
                    {candidate.format.toUpperCase() || "No file"}
                  </p>
                  <small>{candidate.file_link ?? candidate.path}</small>
                </article>
              ))}
            </section>
          )}
          <footer>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button
              className="primary"
              type="submit"
              disabled={!edit.title.trim() || changed.length === 0}
            >
              Preview changes
            </button>
          </footer>
        </form>
      )}
    </dialog>
  );
}
