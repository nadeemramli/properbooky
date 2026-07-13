import { useCallback, useEffect, useState } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import AcquirePanel from "./AcquirePanel";
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
] as const;

type ShelfFilter = (typeof SHELF_FILTERS)[number]["key"];

function matchesFilter(book: Book, filter: ShelfFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "on-shelf":
      return book.kind === "file" || book.status === "available";
    case "wishlist":
      return book.status === "wishlist";
    case "queued":
      return book.status === "queued";
  }
}

/** A book is openable when a real file backs it. */
export function openablePath(book: Book): string | null {
  if (book.kind === "file") return book.path;
  if (book.file_link) return book.file_link;
  return null;
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

  const refreshBooks = useCallback(async (search: string) => {
    const result = await invoke<Book[]>("list_books", {
      query: search || null,
    });
    setBooks(result);
  }, []);

  useEffect(() => {
    invoke<LibraryState>("get_library_state")
      .then((state) => {
        setLibraryPath(state.library_path);
        if (state.book_count > 0) refreshBooks("");
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
            (result.skipped ? ` (${result.skipped} skipped)` : "")
        );
        await refreshBooks(query);
      } catch (e) {
        setStatus(String(e));
      } finally {
        setScanning(false);
      }
    },
    [query, refreshBooks]
  );

  const chooseFolder = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") await scan(selected);
  }, [scan]);

  const visible = books.filter((b) => matchesFilter(b, filter));

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
          </>
        )}
      </header>

      {libraryPath && (
        <div className="chips" role="tablist" aria-label="Shelf filter">
          {SHELF_FILTERS.map((f) => (
            <button
              key={f.key}
              className={`chip ${filter === f.key ? "chip-active" : ""}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
          <span className="chip-count">{visible.length} books</span>
        </div>
      )}

      {status && <p className="status">{status}</p>}

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
                key={book.id}
                className={`card ${openable ? "card-openable" : ""}`}
                title={openable ? `Open ${book.title}` : `${book.title} — not on the shelf yet`}
                tabIndex={openable ? 0 : -1}
                onClick={() => openable && onOpen(book)}
                onKeyDown={(e) => {
                  if (openable && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    onOpen(book);
                  }
                }}
              >
                <div className="card-top">
                  {book.kind === "catalog" ? (
                    <span className={`badge badge-${book.status ?? "wishlist"}`}>
                      {(book.status ?? "wishlist").toUpperCase()}
                    </span>
                  ) : (
                    <span className={`badge badge-${book.format}`}>
                      {book.format.toUpperCase()}
                    </span>
                  )}
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
              </article>
            );
          })}
          {visible.length === 0 && (
            <p className="empty">Nothing here{query ? ` for “${query}”` : ""}.</p>
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
    </div>
  );
}
