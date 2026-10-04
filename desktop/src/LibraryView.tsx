import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import AcquirePanel from "./AcquirePanel";
import ObsidianPanel from "./ObsidianPanel";
import BookReview from "./BookReview";
import OrganizeLibrary from "./OrganizeLibrary";
import { authorKey, authorLabels, topicKey, topicLabels } from "./bookMetadata";
import { useLibrary } from "./library";
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
      // Explicitly reading/paused, or opened and partly read (sidecar
      // progress) without a status recorded yet.
      return (
        book.reading_status === "reading" ||
        book.reading_status === "paused" ||
        (book.reading_status === "unread" && (book.progress ?? 0) > 0)
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

function browseOptions(
  books: Book[],
  labels: (book: Book) => string[],
  key: (value: string) => string,
) {
  const options = new Map<string, { label: string; count: number }>();
  for (const book of books) {
    const seen = new Set<string>();
    for (const label of labels(book)) {
      const id = key(label);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const current = options.get(id);
      options.set(id, {
        label: current?.label ?? label,
        count: (current?.count ?? 0) + 1,
      });
    }
  }
  return [...options].sort((a, b) => a[1].label.localeCompare(b[1].label));
}

/** A book is openable when a real, readable file backs it. Legacy formats
 * (mobi/chm/…) are indexed for availability but have no reader yet. */
export function openablePath(book: Book): string | null {
  if (book.assets.length)
    return (
      book.assets.find(
        (asset) =>
          asset.available && ["pdf", "epub", "article"].includes(asset.format),
      )?.path ?? null
    );
  if (book.availability !== "local") return null;
  if (book.kind === "article") return book.file_link ?? book.path;
  const path = book.kind === "file" ? book.path : book.file_link;
  if (!path) return null;
  const ext = path.toLowerCase().split(".").pop() ?? "";
  return READABLE.has(ext) ? path : null;
}

export default function LibraryView({
  onOpen,
  initialStatus,
  listNotices,
}: {
  onOpen: (book: Book) => void;
  /** Result of indexing a library that was just opened. */
  initialStatus: string | null;
  /** Recovery notices about the library list itself. */
  listNotices: string[];
}) {
  const { path: libraryPath, invoke } = useLibrary();
  const [books, setBooks] = useState<Book[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ShelfFilter>("all");
  const [scanning, setScanning] = useState(false);
  const [status, setStatus] = useState<string | null>(initialStatus);
  const [notices, setNotices] = useState<string[]>([]);
  const [showAcquire, setShowAcquire] = useState(false);
  const [showSaveUrl, setShowSaveUrl] = useState(false);
  const [showObsidian, setShowObsidian] = useState(false);
  const [showOrganize, setShowOrganize] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [savingUrl, setSavingUrl] = useState(false);
  const [review, setReview] = useState<Book | null>(null);
  const [cleanupReason, setCleanupReason] = useState("");
  const [loading, setLoading] = useState(false);
  // The search the shown listing answers, and whether the latest listing
  // failed: empty and no-results states are decided from these, never from
  // a request still in flight (PBK-15).
  const [listedQuery, setListedQuery] = useState<string | null>(null);
  const [listError, setListError] = useState<{ query: string; message: string } | null>(null);
  const [authorFilter, setAuthorFilter] = useState("");
  const [topicFilter, setTopicFilter] = useState("");
  const request = useRef(0);

  const refreshBooks = useCallback(async (search: string) => {
    const sequence = ++request.current;
    setLoading(true);
    try {
      const result = await invoke<Book[]>("list_books", {
        query: search || null,
      });
      if (sequence === request.current) {
        setBooks(result);
        setLoaded(true);
        setListedQuery(search);
        setListError(null);
      }
    } catch (e) {
      if (sequence === request.current) setListError({ query: search, message: String(e) });
      throw e;
    } finally {
      if (sequence === request.current) setLoading(false);
    }
    // Recovery notices (e.g. a rebuilt index) are known once a listing ran.
    const state = await invoke<LibraryState>("get_library_state");
    if (sequence === request.current) setNotices(state.notices);
  }, [invoke]);

  useEffect(() => {
    const handle = setTimeout(() => {
      // A failed listing is shown by the search-error alert below.
      refreshBooks(query).catch(() => {});
    }, 150);
    return () => clearTimeout(handle);
  }, [query, refreshBooks]);

  const scan = useCallback(
    async () => {
      setScanning(true);
      setStatus(null);
      try {
        const result = await invoke<ScanResult>("scan_library");
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
    [invoke, query, refreshBooks],
  );

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
    [invoke, query, refreshBooks],
  );

  const authorOptions = browseOptions(books, authorLabels, authorKey);
  const topicOptions = browseOptions(books, topicLabels, topicKey);
  const visible = books.filter(
    (b) =>
      matchesFilter(b, filter) &&
      (!authorFilter ||
        authorLabels(b).some((a) => authorKey(a) === authorFilter)) &&
      (!topicFilter ||
        topicLabels(b).some((t) => topicKey(t) === topicFilter)) &&
      (filter !== "cleanup" ||
        !cleanupReason ||
        b.issues.includes(cleanupReason)),
  );
  // The listing for the current search has completed (successfully).
  const settled = loaded && !loading && !listError && listedQuery === query;
  const failed = !loading && listError?.query === query ? listError : null;
  const shown = failed ? [] : visible;
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
        {libraryPath && (
          <>
            <button onClick={() => scan()} disabled={scanning}>
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
            <button onClick={() => setShowOrganize(true)}>
              Organize library
            </button>
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
          <span className="chip-count">{shown.length} items</span>
        </div>
      )}

      {status && <p className="status">{status}</p>}
      {[...listNotices, ...notices].map((notice) => (
        <p key={notice} className="launcher-notice" role="note">
          {notice}
        </p>
      ))}
      {libraryPath && (
        <section className="browse-filters" aria-label="Browse your library">
          <label>
            Author
            <select
              aria-label="Filter by author"
              value={authorFilter}
              onChange={(e) => setAuthorFilter(e.target.value)}
            >
              <option value="">All authors</option>
              {authorOptions.map(([key, value]) => (
                <option key={key} value={key}>
                  {value.label} ({value.count})
                </option>
              ))}
            </select>
          </label>
          <label>
            Topic
            <select
              aria-label="Filter by topic"
              value={topicFilter}
              onChange={(e) => setTopicFilter(e.target.value)}
            >
              <option value="">All topics</option>
              {topicOptions.map(([key, value]) => (
                <option key={key} value={key}>
                  {value.label} ({value.count})
                </option>
              ))}
            </select>
          </label>
          {(authorFilter || topicFilter) && (
            <button
              onClick={() => {
                setAuthorFilter("");
                setTopicFilter("");
              }}
            >
              Clear browse filters
            </button>
          )}
        </section>
      )}
      {/* Nothing to load before a folder is chosen; showing this above the
          first-run form only shifts its button under the pointer. */}
      {loading && libraryPath && <p role="status">Loading your library…</p>}
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
                "Missing primary profile",
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

      {failed && (
        <p className="status search-error" role="alert">
          {failed.query
            ? `Searching for “${failed.query}” failed: ${failed.message}`
            : `Your library could not be listed: ${failed.message}`}
        </p>
      )}
      {settled && books.length === 0 && !query.trim() && (
        <div className="empty library-empty" role="note">
          <p>
            No books were found in <code>{libraryPath}</code> yet. Add EPUB, PDF or
            Markdown files to this folder, then press Rescan.
          </p>
        </div>
      )}
      <section className="grid">
        {shown.map((book) => {
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
                {book.assets.length
                  ? `${[...new Set(book.assets.map((a) => a.format.toUpperCase()))].join(" / ")} · `
                  : book.format
                    ? `${book.format.toUpperCase()} · `
                    : ""}
                {book.reading_status}
                {book.up_next ? " · Up next" : ""}
                {book.content_type !== "book"
                  ? ` · ${book.content_type}`
                  : ""}
                {book.progress !== null
                  ? ` · ${Math.round(book.progress * 100)}% read`
                  : ""}
              </p>
              {book.progress !== null && (
                <div
                  className="card-progress"
                  role="progressbar"
                  aria-label={`${book.title} reading progress`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(book.progress * 100)}
                >
                  <span style={{ width: `${Math.round(book.progress * 100)}%` }} />
                </div>
              )}
              {book.author && <p className="author">{book.author}</p>}
              {book.source_profiles.length > 1 && (
                <p className="review-context">
                  {book.source_profiles.length} source profiles ·{" "}
                  {book.assets.length} linked files
                </p>
              )}
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
                {openable && book.assets.length <= 1 && (
                  <button className="read-book" onClick={() => onOpen(book)}>
                    Read
                  </button>
                )}
                {book.assets.length > 1 &&
                  book.assets.map((asset, i) => (
                    <span key={asset.id ?? asset.path}>
                      {asset.available &&
                      ["pdf", "epub", "article"].includes(asset.format) ? (
                        <button
                          className="read-book"
                          title={asset.path}
                          onClick={() => onOpen({ ...book, assets: [asset] })}
                        >
                          Read {asset.format.toUpperCase()}
                          {asset.year
                            ? ` (${asset.year})`
                            : ` · Copy ${i + 1}`}
                        </button>
                      ) : (
                        <small>
                          {asset.format.toUpperCase()} ·{" "}
                          {asset.available
                            ? "External reader"
                            : "Missing file"}
                        </small>
                      )}
                    </span>
                  ))}
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
        {settled && books.length === 0 && query.trim() && (
          <div className="empty search-empty" role="status">
            <p>No books match “{query}”.</p>
            <button onClick={() => setQuery("")}>Clear search</button>
          </div>
        )}
        {settled && visible.length === 0 && books.length > 0 && (
          <p className="empty">
            Nothing here{query ? ` for “${query}”` : ""}.
          </p>
        )}
      </section>
      {showAcquire && libraryPath && (
        <AcquirePanel
          libraryPath={libraryPath}
          onClose={() => setShowAcquire(false)}
          onLibraryChanged={() => refreshBooks(query).catch(() => {})}
        />
      )}
      {showObsidian && <ObsidianPanel onClose={() => setShowObsidian(false)} />}
      {showOrganize && (
        <OrganizeLibrary
          onClose={() => setShowOrganize(false)}
          onOpen={onOpen}
          onSaved={async () => {
            setAuthorFilter("");
            setTopicFilter("");
            await refreshBooks(query);
            setStatus(
              "Organization saved. Undo is available in Library cleanup.",
            );
          }}
        />
      )}
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
