import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import ePub, { Rendition } from "epubjs";
import HighlightsPanel from "./HighlightsPanel";
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
  const { load, save, notices } = useReadingState(path);

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
      const rendition = renditionRef.current;
      if (!rendition || !highlight.anchor.cfi) return;
      await invoke("remove_highlight", { path, id: highlight.id }).catch(
        () => {}
      );
      (rendition.annotations as any).remove(highlight.anchor.cfi, "highlight");
      setHighlights((current) => current.filter((h) => h.id !== highlight.id));
    },
    [path]
  );

  const noteHighlight = useCallback(
    async (highlight: Highlight, note: string) => {
      await invoke("set_highlight_note", {
        path,
        id: highlight.id,
        note: note || null,
      }).catch(() => {});
      setHighlights((current) =>
        current.map((h) =>
          h.id === highlight.id ? { ...h, note: note || null } : h
        )
      );
    },
    [path]
  );


  const paintHighlight = useCallback((highlight: Highlight) => {
    const rendition = renditionRef.current;
    if (!rendition || !highlight.anchor.cfi) return;
    (rendition.annotations as any).add(
      "highlight",
      highlight.anchor.cfi,
      {},
      () => setShowPanel(true),
      "pb-highlight",
      { fill: HIGHLIGHT_FILL, "fill-opacity": "1", "mix-blend-mode": "multiply" }
    );
    setHighlights((current) =>
      current.some((h) => h.id === highlight.id)
        ? current
        : [...current, highlight]
    );
  }, []);
  const paintHighlightRef = useRef(paintHighlight);
  useEffect(() => {
    paintHighlightRef.current = paintHighlight;
  }, [paintHighlight]);

  useEffect(() => {
    let disposed = false;
    let book: ReturnType<typeof ePub> | null = null;
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
        rendition.on("selected", (cfiRange: string, contents: any) => {
          const text = contents?.window?.getSelection()?.toString() ?? "";
          if (text.trim()) setPending({ cfiRange, text: text.trim() });
        });
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
      renditionRef.current = null;
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
    try {
      const highlight = await invoke<Highlight>("add_highlight", {
        path,
        text: pending.text,
        note: null,
        color: null,
        anchor: { type: "epub-cfi", cfi: pending.cfiRange },
      });
      paintHighlight(highlight);
    } catch (e) {
      setError(String(e));
    } finally {
      setPending(null);
    }
  }, [pending, path, paintHighlight]);

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
            if (h.anchor.cfi) renditionRef.current?.display(h.anchor.cfi);
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
