import { useCallback, useEffect, useState } from "react";
import { useLibrary } from "./library";
import { openUrl } from "@tauri-apps/plugin-opener";
import { bookEdit } from "./bookMetadata";
import type { Book } from "./types";

interface DropOutcome {
  filename: string;
  result: string;
  title: string | null;
  destination: string | null;
}

interface DropReport {
  filed: number;
  left: number;
  outcomes: DropOutcome[];
}

const QUEUE_SIZE = 10;

export default function AcquirePanel({
  libraryPath,
  onClose,
  onLibraryChanged,
}: {
  libraryPath: string;
  onClose: () => void;
  onLibraryChanged: () => void;
}) {
  const { invoke } = useLibrary();
  const [queue, setQueue] = useState<Book[]>([]);
  const [report, setReport] = useState<DropReport | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setQueue(
        await invoke<Book[]>("acquisition_queue", { limit: QUEUE_SIZE }),
      );
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const search = useCallback(
    async (book: Book) => {
      const query = encodeURIComponent(
        [book.title, book.author].filter(Boolean).join(" "),
      );
      openUrl(`https://z-library.sk/s/${query}`).catch(() => {});
      if (!book.up_next) {
        await invoke("update_book", {
          id: book.stable_id,
          edit: { ...bookEdit(book), want_to_read: true, up_next: true },
        }).catch((e) => {
          setError(String(e));
          throw e;
        });
        setQueue((current) =>
          current.map((b) =>
            b.stable_id === book.stable_id ? { ...b, up_next: true } : b,
          ),
        );
        onLibraryChanged();
      }
    },
    [onLibraryChanged],
  );

  const runDrop = useCallback(async () => {
    setProcessing(true);
    setError(null);
    try {
      const result = await invoke<DropReport>("process_drop");
      setReport(result);
      if (result.filed > 0) {
        onLibraryChanged();
        refresh();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setProcessing(false);
    }
  }, [onLibraryChanged, refresh]);

  return (
    <aside className="acquire-panel" aria-label="Acquisition queue">
      <header className="highlights-panel-head">
        <h3>Acquire — today's {QUEUE_SIZE}</h3>
        <button className="panel-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>

      <div className="acquire-drop">
        <button onClick={runDrop} disabled={processing}>
          {processing ? "Filing…" : "Process Drop folder"}
        </button>
        <p className="acquire-hint">
          Save downloads into <code>{libraryPath}/Drop</code> — processing
          matches, renames, and shelves them automatically.
        </p>
        {report && (
          <p className="acquire-report">
            Filed {report.filed}, left {report.left} in Drop
            {report.outcomes
              .filter((o) => o.result === "filed")
              .slice(0, 5)
              .map((o) => (
                <span key={o.filename} className="acquire-filed">
                  ✓ {o.title ?? o.filename}
                </span>
              ))}
          </p>
        )}
        {error && <p className="status">{error}</p>}
      </div>

      <ul>
        {queue.map((book) => (
          <li key={book.id}>
            <div className="acquire-title">
              <strong>{book.title}</strong>
              {book.author && <span className="author"> — {book.author}</span>}
            </div>
            <div className="highlight-row-meta">
              <span>
                {book.priority != null && (
                  <strong className="priority-score">
                    {book.priority.toFixed(2)}
                  </strong>
                )}
                {book.up_next ? " · queued" : ""}
                {book.year ? ` · ${book.year}` : ""}
                {book.rating ? ` · ★${book.rating}` : " · unrated"}
                {book.recommended ? " · rec" : ""}
                {book.spectrum ? ` · ${book.spectrum}` : ""}
              </span>
              <button
                className="acquire-search"
                onClick={() => search(book).catch(() => {})}
              >
                {book.up_next ? "Search again" : "Search & queue"}
              </button>
            </div>
          </li>
        ))}
        {queue.length === 0 && (
          <p className="highlights-empty">
            Nothing left to acquire — the wishlist is on the shelf.
          </p>
        )}
      </ul>
    </aside>
  );
}
