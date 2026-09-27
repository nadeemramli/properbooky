import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { bookEdit, combinedTopics } from "./bookMetadata";
import SourceProfiles from "./SourceProfiles";
import type { Book, BookEdit } from "./types";

export default function MergeReview({
  primary,
  secondary,
  onClose,
  onSaved,
}: {
  primary: Book;
  secondary: Book;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [edit, setEdit] = useState<BookEdit>(() => ({
    ...bookEdit(primary),
    category: combinedTopics([primary, secondary]),
    reading_status:
      (["reading", "paused", "finished", "stopped", "unread"] as const).find(
        (status) =>
          [primary.reading_status, secondary.reading_status].includes(status),
      ) ?? "unread",
    want_to_read: primary.want_to_read || secondary.want_to_read,
    up_next: primary.up_next || secondary.up_next,
  }));
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    if (dialog.current) dialog.current.scrollTop = 0;
    if (preview) dialog.current?.querySelector("h2")?.focus();
  }, [preview]);
  const sources = [...primary.source_profiles, ...secondary.source_profiles];
  const assets = [
    ...new Map(
      [...primary.assets, ...secondary.assets].map((a) => [a.id ?? a.path, a]),
    ).values(),
  ];
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await invoke("merge_books", {
        keep: primary.stable_id,
        absorb: secondary.stable_id,
        edit,
      });
      await onSaved();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="book-review merge-review"
      aria-labelledby="merge-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header className="review-header">
        <div>
          <p className="eyebrow">Duplicate review</p>
          <h2 id="merge-title" tabIndex={-1}>
            {preview
              ? "Preview combined profile"
              : "Choose the combined details"}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          aria-label="Back to profile review"
        >
          ×
        </button>
      </header>
      <p>
        Combine “{secondary.title}” into “{primary.title}”. Both sources and
        every file remain available. Only the number of library cards changes.
      </p>
      {error && <p role="alert">{error}</p>}
      <table>
        <thead>
          <tr>
            <th>Detail</th>
            <th>Primary profile</th>
            <th>Other profile</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>Title</th>
            <td>{primary.title}</td>
            <td>{secondary.title}</td>
          </tr>
          <tr>
            <th>Author</th>
            <td>{primary.author ?? "Unknown"}</td>
            <td>{secondary.author ?? "Unknown"}</td>
          </tr>
          <tr>
            <th>Publication year</th>
            <td>{primary.year ?? "Unknown"}</td>
            <td>{secondary.year ?? "Unknown"}</td>
          </tr>
          <tr>
            <th>Reading status</th>
            <td>{primary.reading_status}</td>
            <td>{secondary.reading_status}</td>
          </tr>
        </tbody>
      </table>
      {primary.year && secondary.year && primary.year !== secondary.year && (
        <p className="merge-notice">
          Publication years differ. This can group editions of the same work;
          their source details and reading positions stay separate.
        </p>
      )}
      {preview ? (
        <section>
          <h3>Result: {edit.title}</h3>
          <p>
            {edit.author ?? "Unknown author"} · {edit.content_type} ·{" "}
            {edit.reading_status}
            {edit.want_to_read ? " · Want to read" : ""}
            {edit.up_next ? " · Up next" : ""}
          </p>
          <p>Topics: {edit.category || "None"}</p>
          <p>
            {sources.length} source profiles and {assets.length} linked file
            {assets.length === 1 ? "" : "s"}{" "}
            will be kept. The primary profile's publication year and rating stay
            on its card; other values remain in source details.
          </p>
          {assets.map((asset) => (
            <p className="review-context" key={asset.id ?? asset.path}>
              {asset.format.toUpperCase()} ·{" "}
              {asset.available ? "On the shelf" : "Missing"} · {asset.path}
            </p>
          ))}
          <p>
            Undo last correction restores the separate cards. No files, notes or
            highlights are deleted.
          </p>
          <footer>
            <button disabled={busy} onClick={() => setPreview(false)}>
              Back to choices
            </button>
            <button className="primary" disabled={busy} onClick={save}>
              {busy ? "Combining…" : "Combine profiles"}
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
              Combined title
              <input
                required
                maxLength={500}
                value={edit.title}
                onChange={(e) => setEdit({ ...edit, title: e.target.value })}
              />
            </label>
            <label className="wide">
              Combined author
              <input
                value={edit.author ?? ""}
                onChange={(e) =>
                  setEdit({ ...edit, author: e.target.value || null })
                }
              />
            </label>
            <label className="wide">
              Combined topics
              <input
                value={edit.category ?? ""}
                onChange={(e) =>
                  setEdit({ ...edit, category: e.target.value || null })
                }
              />
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
                    <option key={v}>{v}</option>
                  ),
                )}
              </select>
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
                  "book",
                  "paper",
                  "report",
                  "manual",
                  "notes",
                  "article",
                  "other",
                  "unidentified",
                ].map((v) => (
                  <option key={v}>{v}</option>
                ))}
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
          <SourceProfiles sources={sources} />
          <footer>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button
              className="primary"
              type="submit"
              disabled={!edit.title.trim()}
            >
              Preview combination
            </button>
          </footer>
        </form>
      )}
    </dialog>
  );
}
