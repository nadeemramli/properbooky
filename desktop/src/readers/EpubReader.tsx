import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import ePub, { Rendition } from "epubjs";
import HighlightsPanel from "./HighlightsPanel";
import { captureRange, rangeForQuote } from "./quote";
import { pageTurn, useReadingState, validPercent } from "./readingState";
import type { Highlight } from "../types";

const HIGHLIGHT_FILL = "rgba(200, 162, 63, 0.35)";

const COZY_LIGHT = {
  body: {
    "font-family":
      '"Charter", "Bitstream Charter", "Sitka Text", Cambria, Georgia, serif',
    color: "#1f2421",
    background: "#faf7f2",
    "line-height": "1.65",
  },
  a: { color: "#3f6b4f" },
};

const COZY_DARK = {
  body: {
    "font-family":
      '"Charter", "Bitstream Charter", "Sitka Text", Cambria, Georgia, serif',
    color: "#e8e6df",
    background: "#171a18",
    "line-height": "1.65",
  },
  a: { color: "#7fb08f" },
};

interface PendingSelection {
  cfiRange: string;
  text: string;
  /** Multi-selector fallbacks, in the section's own text space. */
  quote: { exact: string; prefix: string; suffix: string };
  position: { start: number; end: number };
  href: string | null;
}

type EpubBook = ReturnType<typeof ePub>;

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** The CFI to paint for a stored highlight: its own CFI when that still
 * covers the quoted text, otherwise the quote found again in its section
 * (TextQuote + TextPosition fallback), otherwise null. */
async function resolveCfi(book: EpubBook, highlight: Highlight): Promise<string | null> {
  const { cfi, quote, position, href } = highlight.anchor;
  if (cfi) {
    try {
      const range = await (book as any).getRange(cfi);
      if (range && (!quote || collapse(range.toString()) === collapse(quote.exact))) return cfi;
    } catch {
      /* unparsable or stale CFI: try the quote */
    }
  }
  // Older highlights carry only a CFI: paint it as before.
  if (!quote || !href) return cfi ?? null;
  try {
    const section: any = book.spine.get(href);
    if (!section) return null;
    await section.load((book as any).load.bind(book));
    const range = rangeForQuote(section.document.body, quote.exact, { quote, position });
    return range ? section.cfiFromRange(range) : null;
  } catch {
    return null;
  }
}

export default function EpubReader({
  path,
  onProgress,
}: {
  path: string;
  onProgress: (path: string, percent: number | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [percent, setPercent] = useState<number | null>(null);
  const [pending, setPending] = useState<PendingSelection | null>(null);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [showPanel, setShowPanel] = useState(false);
  const { load, save, attempt, notices } = useReadingState(path);
  const bookRef = useRef<EpubBook | null>(null);
  // Highlight id -> CFI actually painted (its own, or the quote fallback).
  const paintedRef = useRef(new Map<string, string>());

  // Keep the latest callback out of the load effect's dependencies —
  // a changing identity there re-loads the whole book (reload loop).
  const onProgressRef = useRef(onProgress);
  useEffect(() => {
    onProgressRef.current = onProgress;
  }, [onProgress]);

  // Deleting only happens from the panel — clicking a painted highlight
  // opens it (window.confirm is unreliable in the webview, and a click
  // on the text you just highlighted must never destroy it).
  const removeHighlight = useCallback(
    async (highlight: Highlight) => {
      const done = await attempt("remove the highlight", () =>
        invoke<boolean>("remove_highlight", { path, id: highlight.id }),
      );
      if (done === undefined) return;
      const painted = paintedRef.current.get(highlight.id);
      if (painted) (renditionRef.current?.annotations as any)?.remove(painted, "highlight");
      paintedRef.current.delete(highlight.id);
      setHighlights((current) => current.filter((h) => h.id !== highlight.id));
    },
    [path, attempt]
  );

  const noteHighlight = useCallback(
    async (highlight: Highlight, note: string) => {
      const done = await attempt("save the note", () =>
        invoke<boolean>("set_highlight_note", {
          path,
          id: highlight.id,
          note: note || null,
        }),
      );
      if (done === undefined) return;
      setHighlights((current) =>
        current.map((h) =>
          h.id === highlight.id ? { ...h, note: note || null } : h
        )
      );
    },
    [path, attempt]
  );


  const paintHighlight = useCallback(async (highlight: Highlight) => {
    // Listed even if it can't be painted, so it can still be removed.
    setHighlights((current) =>
      current.some((h) => h.id === highlight.id)
        ? current
        : [...current, highlight]
    );
    const book = bookRef.current;
    if (!book) return;
    const cfi = await resolveCfi(book, highlight);
    const rendition = renditionRef.current;
    if (!cfi || !rendition || bookRef.current !== book) return;
    paintedRef.current.set(highlight.id, cfi);
    (rendition.annotations as any).add(
      "highlight",
      cfi,
      { id: highlight.id },
      // A click on painted text opens the panel; it never deletes.
      () => setShowPanel(true),
      "pb-highlight",
      { fill: HIGHLIGHT_FILL, "fill-opacity": "1", "mix-blend-mode": "multiply" }
    );
  }, []);
  const paintHighlightRef = useRef(paintHighlight);
  useEffect(() => {
    paintHighlightRef.current = paintHighlight;
  }, [paintHighlight]);

  useEffect(() => {
    let disposed = false;
    let book: ReturnType<typeof ePub> | null = null;
    let selectionPoll = 0;
    // Resolves once epub.js has finished its own background loading.
    let settled: Promise<unknown> = Promise.resolve();

    const loading = (async () => {
      try {
        const sidecar = await load();
        const response = await fetch(convertFileSrc(path));
        if (!response.ok)
          throw new Error(`could not read file (${response.status})`);
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength === 0) throw new Error("the file is empty (0 bytes)");
        if (disposed || !containerRef.current) return;

        // Open explicitly: an invalid archive rejects here instead of
        // leaving the rendition waiting forever on "Opening…".
        const opened = ePub();
        book = opened;
        await opened.open(buffer, "binary");
        settled = opened.ready;
        bookRef.current = opened;
        if (disposed || !containerRef.current) return;

        // Until locations are generated epub.js reports no percentage; keep
        // the stored one rather than erasing it from the sidecar and ribbon.
        let known = validPercent(sidecar.percent);
        // epub.js fills locations incrementally and sets their total last, so
        // a fraction read mid-generation is 0; trust only finished locations.
        let locationsReady = false;
        setPercent(known);
        onProgressRef.current(path, known);

        const rendition = opened.renderTo(containerRef.current, {
          width: "100%",
          height: "100%",
          flow: "paginated",
          spread: "none",
          allowScriptedContent: false,
        });
        const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        rendition.themes.register("cozy", dark ? COZY_DARK : COZY_LIGHT);
        rendition.themes.select("cozy");
        rendition.themes.fontSize("112%");

        rendition.on("relocated", (location: any) => {
          if (disposed) return;
          const cfi: string | undefined = location?.start?.cfi;
          if (cfi && locationsReady) {
            known = validPercent(opened.locations.percentageFromCfi(cfi)) ?? known;
          }
          setPercent(known);
          onProgressRef.current(path, known);
          if (cfi) save(cfi, known);
        });
        // Book content renders in a sandboxed iframe without scripts (book
        // JavaScript must never reach the app). WebKit then runs no event
        // listeners for that document at all, so epub.js's "selected" event
        // (selectionchange) never fires on Linux. The app reads the
        // selection from its own side instead; "selected" stays for engines
        // where it works.
        const captureSelection = (contents: any) => {
          if (disposed) return;
          const selection = contents?.window?.getSelection();
          if (!selection || selection.isCollapsed || !selection.rangeCount) return;
          const range = selection.getRangeAt(0);
          const captured = captureRange(contents.document.body, range);
          if (!captured) return;
          let cfiRange: string;
          try {
            cfiRange = contents.cfiFromRange(range);
          } catch {
            return;
          }
          const href = opened.spine.get(contents.sectionIndex)?.href ?? null;
          setPending({
            cfiRange,
            text: captured.exact,
            quote: { exact: captured.exact, prefix: captured.prefix, suffix: captured.suffix },
            position: { start: captured.start, end: captured.end },
            href,
          });
        };
        rendition.on("selected", (_cfiRange: string, contents: any) => captureSelection(contents));
        let lastSelection: unknown[] = [];
        selectionPoll = window.setInterval(() => {
          for (const contents of (rendition.getContents() as unknown as any[]) ?? []) {
            const selection = contents?.window?.getSelection();
            if (!selection || selection.isCollapsed || !selection.rangeCount) {
              lastSelection = [];
              continue;
            }
            const r = selection.getRangeAt(0);
            const key = [r.startContainer, r.startOffset, r.endContainer, r.endOffset];
            if (key.every((part, i) => part === lastSelection[i])) continue;
            lastSelection = key;
            captureSelection(contents);
          }
        }, 250);
        rendition.on("keydown", (e: KeyboardEvent) => {
          const direction = pageTurn(e);
          if (direction === "next") rendition.next();
          if (direction === "prev") rendition.prev();
        });

        await rendition.display(sidecar.position || undefined);
        if (disposed) return;
        renditionRef.current = rendition;
        setReady(true);
        for (const highlight of sidecar.highlights) {
          paintHighlightRef.current(highlight);
        }
        // Percentages need generated locations; do it in the background,
        // then record the exact fraction for the page already on screen.
        opened.locations
          .generate(600)
          .then(() => {
            if (disposed) return;
            locationsReady = true;
            const cfi = (rendition.currentLocation() as any)?.start?.cfi;
            const exact = cfi
              ? validPercent(opened.locations.percentageFromCfi(cfi))
              : null;
            if (!cfi || exact === null) return;
            known = exact;
            setPercent(exact);
            onProgressRef.current(path, exact);
            save(cfi, exact);
          })
          .catch(() => {});
      } catch (e) {
        if (!disposed) setError(String(e));
      }
    })();

    return () => {
      disposed = true;
      window.clearInterval(selectionPoll);
      renditionRef.current = null;
      bookRef.current = null;
      paintedRef.current = new Map();
      // epub.js throws when destroyed mid-open/display, and an exception in
      // an effect cleanup unmounts the whole app; tear down once it settles.
      loading
        .then(() => settled)
        .catch(() => {})
        .finally(() => {
          try {
            book?.destroy();
          } catch {
            /* already torn down */
          }
        });
    };
  }, [path, load, save]);

  const saveHighlight = useCallback(async () => {
    if (!pending) return;
    const book = bookRef.current;
    const chapter = pending.href
      ? collapse((book?.navigation as any)?.get(pending.href)?.label ?? "") || null
      : null;
    const fraction =
      book && book.locations.length() > 0
        ? validPercent(book.locations.percentageFromCfi(pending.cfiRange))
        : null;
    const highlight = await attempt("save the highlight", () =>
      invoke<Highlight>("add_highlight", {
        path,
        text: pending.text,
        note: null,
        color: null,
        // One multi-selector envelope: CFI range primary, quote + position
        // (section text space) as fallbacks, plus labels for export.
        anchor: {
          type: "epub-cfi",
          cfi: pending.cfiRange,
          quote: pending.quote,
          position: pending.position,
          ...(pending.href ? { href: pending.href } : {}),
          ...(chapter ? { chapter } : {}),
          ...(fraction !== null ? { percent: fraction } : {}),
        },
      }),
    );
    setPending(null);
    if (!highlight) return;
    (renditionRef.current?.getContents() as unknown as any[] | undefined)?.forEach((c) =>
      c.window?.getSelection()?.removeAllRanges(),
    );
    paintHighlight(highlight);
  }, [pending, path, paintHighlight, attempt]);

  const turn = useCallback((direction: "prev" | "next") => {
    setPending(null);
    const rendition = renditionRef.current;
    if (!rendition) return;
    if (direction === "prev") rendition.prev();
    else rendition.next();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const direction = pageTurn(e);
      if (direction) turn(direction);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [turn]);

  if (error) {
    return (
      <div className="reader-error">
        <p>Couldn't open this book: {error}</p>
      </div>
    );
  }

  return (
    <div className="reader">
      {notices.map((notice) => (
        <p key={notice} className="reader-notice" role="alert">
          {notice}
        </p>
      ))}
      <div className="reader-page" ref={containerRef}>
        {!ready && <p className="reader-loading">Opening…</p>}
      </div>
      {pending && (
        <div className="highlight-pill">
          <span className="highlight-pill-text">
            “{pending.text.slice(0, 60)}
            {pending.text.length > 60 ? "…" : ""}”
          </span>
          <button onClick={saveHighlight}>Highlight</button>
          <button className="pill-dismiss" onClick={() => setPending(null)}>
            ×
          </button>
        </div>
      )}
      {showPanel && (
        <HighlightsPanel
          highlights={highlights}
          onJump={(h) => {
            const cfi = paintedRef.current.get(h.id) ?? h.anchor.cfi;
            if (cfi) renditionRef.current?.display(cfi);
          }}
          onDelete={removeHighlight}
          onNote={noteHighlight}
          onClose={() => setShowPanel(false)}
        />
      )}
      <footer className="reader-bar">
        <button onClick={() => turn("prev")} aria-label="Previous page">
          ← Previous
        </button>
        <span className="reader-progress">
          <button
            className="highlight-toggle"
            onClick={() => setShowPanel((s) => !s)}
            aria-label="Show highlights"
          >
            ✎ {highlights.length}
          </button>{" "}
          · {percent !== null ? `${Math.round(percent * 100)}%` : "—"}
        </span>
        <button onClick={() => turn("next")} aria-label="Next page">
          Next →
        </button>
      </footer>
    </div>
  );
}
