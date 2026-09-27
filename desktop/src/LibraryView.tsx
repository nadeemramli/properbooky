import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import AcquirePanel from "./AcquirePanel";
import ObsidianPanel from "./ObsidianPanel";
import BookReview from "./BookReview";
import type { Book, LibraryState, ScanResult } from "./types";

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

const SHELF_FILTERS = [
  { key: "all", label: "Everything" },
  { key: "on-shelf", label: "On the shelf" },
  { key: "wishlist", label: "Wishlist" },
  { key: "queued", label: "Up next" },
  { key: "wanted", label: "Want to read" },
  { key: "reading", label: "Continue reading" },
  { key: "finished", label: "Finished" },
  { key: "documents", label: "Documents" },
  { key: "cleanup", label: "Library cleanup" },
] as const;

type ShelfFilter = (typeof SHELF_FILTERS)[number]["key"];

function matchesFilter(book: Book, filter: ShelfFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "on-shelf":
      return book.availability === "local";
    case "wishlist":
      return book.want_to_read && book.availability !== "local";
    case "queued":
      return book.up_next;
    case "wanted":
      return book.want_to_read;
    case "reading":
      return (
        book.reading_status === "reading" || book.reading_status === "paused"
      );
    case "finished":
      return book.reading_status === "finished";
    case "documents":
      return ["paper", "report", "manual", "notes", "other"].includes(
        book.content_type,
      );
    case "cleanup":
      return book.issues.length > 0;
  }
}

const READABLE = new Set(["epub", "pdf"]);

/** A book is openable when a real, readable file backs it. Legacy formats
 * (mobi/chm/…) are indexed for availability but have no reader yet. */
export function openablePath(book: Book): string | null {
  if (book.availability !== "local") return null;
  if (book.kind === "article") return book.file_link ?? book.path;
  const path = book.kind === "file" ? book.path : book.file_link;
  if (!path) return null;
  const ext = path.toLowerCase().split(".").pop() ?? "";
  return READABLE.has(ext) ? path : null;
}

export default function LibraryView({
  onOpen,
}: {
  onOpen: (book: Book) => void;
}) {
  const [libraryPath, setLibraryPath] = useState<string | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ShelfFilter>("all");
  const [pathInput, setPathInput] = useState("");
  const [scanning, setScanning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [showAcquire, setShowAcquire] = useState(false);
  const [showSaveUrl, setShowSaveUrl] = useState(false);
  const [showObsidian, setShowObsidian] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [savingUrl, setSavingUrl] = useState(false);
  const [review, setReview] = useState<Book | null>(null);
  const [cleanupReason, setCleanupReason] = useState("");
  const [loading, setLoading] = useState(false);
  const request = useRef(0);

  const refreshBooks = useCallback(async (search: string) => {
    const sequence = ++request.current;
    setLoading(true);
    try {
      const result = await invoke<Book[]>("list_books", {
        query: search || null,
      });
      if (sequence === request.current) setBooks(result);
    } finally {
      if (sequence === request.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    invoke<LibraryState>("get_library_state")
      .then((state) => {
        setLibraryPath(state.library_path);
      })
      .catch((e) => setStatus(String(e)));
  }, [refreshBooks]);

  useEffect(() => {
    const handle = setTimeout(() => {
      refreshBooks(query).catch((e) => setStatus(String(e)));
    }, 150);
    return () => clearTimeout(handle);
  }, [query, refreshBooks]);

  const scan = useCallback(
    async (path: string) => {
      setScanning(true);
      setStatus(null);
      try {
        const result = await invoke<ScanResult>("scan_library", { path });
        setLibraryPath(path);
        setStatus(
          `Indexed ${result.indexed} books` +
            (result.skipped ? ` (${result.skipped} skipped)` : ""),
        );
        await refreshBooks(query);
      } catch (e) {
        setStatus(String(e));
      } finally {
        setScanning(false);
      }
    },
    [query, refreshBooks],
  );

  const chooseFolder = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") await scan(selected);
  }, [scan]);

  const saveUrl = useCallback(
    async (url: string) => {
      setSavingUrl(true);
      setStatus(null);
      try {
        const saved = await invoke<Book>("save_article", { url });
        setStatus(`Saved “${saved.title}” to the library`);
        setUrlInput("");
        setShowSaveUrl(false);
        await refreshBooks(query);
      } catch (e) {
        setStatus(String(e));
      } finally {
        setSavingUrl(false);
      }
    },
    [query, refreshBooks],
  );

  const visible = books.filter(
    (b) =>
      matchesFilter(b, filter) &&
      (filter !== "cleanup" ||
        !cleanupReason ||
        b.issues.includes(cleanupReason)),
  );
  const undo = async () => {
    try {
      await invoke("undo_library_edit");
      await refreshBooks(query);
      setStatus("Last correction undone.");
    } catch (e) {
      setStatus(String(e));
    }
  };

  return (
    <div className="library">
      <header className="toolbar">
        <input
          type="search"
          placeholder="Search title, author, topic…"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          disabled={!libraryPath}
        />
        <button onClick={chooseFolder} disabled={scanning}>
          {libraryPath ? "Change folder" : "Choose library folder"}
        </button>
        {libraryPath && (
          <>
            <button onClick={() => scan(libraryPath)} disabled={scanning}>
              {scanning ? "Scanning…" : "Rescan"}
            </button>
            <button
              className="acquire-open"
              onClick={() => setShowAcquire(true)}
            >
              Acquire
            </button>
            <button onClick={() => setShowSaveUrl((s) => !s)}>Save URL</button>
            <button onClick={() => setShowObsidian(true)}>Obsidian</button>
          </>
        )}
      </header>

      {showSaveUrl && (
        <form
          className="path-form url-form"
          onSubmit={(e) => {
            e.preventDefault();
            const url = urlInput.trim();
            if (url) saveUrl(url);
          }}
        >
          <input
            type="url"
            placeholder="https://… — the article is cleaned and saved as markdown, forever"
            value={urlInput}
            onChange={(e) => setUrlInput(e.currentTarget.value)}
            autoFocus
          />
          <button type="submit" disabled={savingUrl || !urlInput.trim()}>
            {savingUrl ? "Saving…" : "Save article"}
          </button>
        </form>
      )}

      {libraryPath && (
        <div className="chips" role="tablist" aria-label="Shelf filter">
          {SHELF_FILTERS.map((f) => (
            <button
              key={f.key}
              className={`chip ${filter === f.key ? "chip-active" : ""}`}
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
          <span className="chip-count">{visible.length} items</span>
        </div>
      )}

      {status && <p className="status">{status}</p>}
      {loading && <p role="status">Loading your library…</p>}
      {filter === "cleanup" && (
        <div className="cleanup-toolbar">
          <div>
            <h2>Make your library easier to find</h2>
            <p>
              Review uncertain details and duplicate candidates. Every
              correction can be undone.
            </p>
          </div>
          <label>
            Show
            <select
              value={cleanupReason}
              onChange={(e) => setCleanupReason(e.target.value)}
            >
              <option value="">All issues</option>
              {[
                "Check title",
                "Missing author",
                "Missing file",
                "Classify item",
                "Missing cover",
                "Possible duplicate",
              ].map((reason) => (
                <option key={reason}>{reason}</option>
              ))}
            </select>
          </label>
          <button onClick={undo} disabled={loading}>
            Undo last correction
          </button>
        </div>
      )}

      {!libraryPath ? (
        <div className="empty">
          <p>
            Point ProperBooky at your book folder (EPUB, PDF, Markdown). The
            folder stays the source of truth — the index is rebuilt from it on
            every scan.
          </p>
          <form
            className="path-form"
            onSubmit={(e) => {
              e.preventDefault();
              const path = pathInput.trim();
              if (path) scan(path);
            }}
          >
            <input
              type="text"
              placeholder="…or paste a folder path (e.g. /mnt/c/Users/Nadeem/Desktop/All Books Inside Here)"
              value={pathInput}
              onChange={(e) => setPathInput(e.currentTarget.value)}
            />
            <button type="submit" disabled={scanning || !pathInput.trim()}>
              Index this path
            </button>
          </form>
        </div>
      ) : (
        <section className="grid">
          {visible.map((book) => {
            const openable = openablePath(book) !== null;
            return (
              <article
                key={book.stable_id}
                className={`card ${openable ? "card-openable" : ""}`}
              >
                <div className="card-top">
                  <span
                    className={`badge badge-${book.availability === "local" ? "available" : "wishlist"}`}
                  >
                    {book.availability === "local"
                      ? "On the shelf"
                      : book.availability === "missing"
                        ? "File missing"
                        : "No local file"}
                  </span>
                  {book.cover && (
                    <img
                      className="card-cover"
                      src={convertFileSrc(book.cover)}
                      alt=""
                      loading="lazy"
                    />
                  )}
                </div>
                <h2>{book.title}</h2>
                <p className="book-state">
                  {book.format ? `${book.format.toUpperCase()} · ` : ""}
                  {book.reading_status}
                  {book.up_next ? " · Up next" : ""}
                  {book.content_type !== "book"
                    ? ` · ${book.content_type}`
                    : ""}
                </p>
                {book.author && <p className="author">{book.author}</p>}
                <p className="meta">
                  {book.year ? `${book.year} · ` : ""}
                  {book.category ? `${book.category} · ` : ""}
                  {book.kind === "catalog"
                    ? book.rating
                      ? `★${book.rating}`
                      : "unrated"
                    : formatSize(book.size_bytes)}
                </p>
                {filter === "cleanup" && (
                  <p className="review-context">{book.issues.join(" · ")}</p>
                )}
                <div className="card-actions">
                  {openable && (
                    <button className="read-book" onClick={() => onOpen(book)}>
                      Read
                    </button>
                  )}
                  <button onClick={() => setReview(book)}>
                    Review details
                  </button>
                </div>
                {!openable && book.availability === "local" && (
                  <small className="review-context">
                    This format needs an external reader.
                  </small>
                )}
              </article>
            );
          })}
          {visible.length === 0 && (
            <p className="empty">
              Nothing here{query ? ` for “${query}”` : ""}.
            </p>
          )}
        </section>
      )}
      {showAcquire && libraryPath && (
        <AcquirePanel
          libraryPath={libraryPath}
          onClose={() => setShowAcquire(false)}
          onLibraryChanged={() => refreshBooks(query).catch(() => {})}
        />
      )}
      {showObsidian && <ObsidianPanel onClose={() => setShowObsidian(false)} />}
      {review && (
        <BookReview
          key={review.stable_id}
          book={review}
          onClose={() => setReview(null)}
          onSaved={async () => {
            await refreshBooks(query);
            setStatus(
              "Correction saved. Undo is available in Library cleanup.",
            );
          }}
        />
      )}
    </div>
  );
}
