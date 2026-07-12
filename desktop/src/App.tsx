import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import "./App.css";

interface Book {
  id: number;
  path: string;
  filename: string;
  title: string;
  author: string | null;
  format: string;
  size_bytes: number;
}

interface LibraryState {
  library_path: string | null;
  book_count: number;
}

interface ScanResult {
  indexed: number;
  skipped: number;
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

export default function App() {
  const [libraryPath, setLibraryPath] = useState<string | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [query, setQuery] = useState("");
  const [scanning, setScanning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

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

  return (
    <main className="app">
      <header className="toolbar">
        <h1>ProperBooky</h1>
        <input
          type="search"
          placeholder="Search title, author, filename…"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          disabled={!libraryPath}
        />
        <button onClick={chooseFolder} disabled={scanning}>
          {libraryPath ? "Change folder" : "Choose library folder"}
        </button>
        {libraryPath && (
          <button onClick={() => scan(libraryPath)} disabled={scanning}>
            {scanning ? "Scanning…" : "Rescan"}
          </button>
        )}
      </header>

      {libraryPath && <p className="library-path">{libraryPath}</p>}
      {status && <p className="status">{status}</p>}

      {!libraryPath ? (
        <div className="empty">
          <p>
            Point ProperBooky at your book folder (EPUB, PDF, Markdown). The
            folder stays the source of truth — the index is rebuilt from it on
            every scan.
          </p>
        </div>
      ) : (
        <section className="grid">
          {books.map((book) => (
            <article key={book.id} className="card" title={book.path}>
              <span className={`badge badge-${book.format}`}>
                {book.format.toUpperCase()}
              </span>
              <h2>{book.title}</h2>
              {book.author && <p className="author">{book.author}</p>}
              <p className="meta">{formatSize(book.size_bytes)}</p>
            </article>
          ))}
          {books.length === 0 && (
            <p className="empty">No books match “{query}”.</p>
          )}
        </section>
      )}
    </main>
  );
}
