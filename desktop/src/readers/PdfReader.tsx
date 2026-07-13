import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { TextLayer } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";
import HighlightsPanel from "./HighlightsPanel";
import { captureQuoteSelection, rangeForQuote } from "./quote";
import type { Highlight, Sidecar } from "../types";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

interface PendingSelection {
  exact: string;
  prefix: string;
  suffix: string;
  start: number;
  end: number;
}

export default function PdfReader({
  path,
  onProgress,
}: {
  path: string;
  onProgress: (path: string, percent: number | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const textDivRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const pageWrapRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const loadingTaskRef = useRef<{ destroy: () => Promise<void> } | null>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  const highlightsRef = useRef<Map<string, Highlight>>(new Map());
  const [page, setPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [fitTick, setFitTick] = useState(0);
  const [fitMode, setFitMode] = useState<"page" | "width">("page");
  const [pending, setPending] = useState<PendingSelection | null>(null);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [showPanel, setShowPanel] = useState(false);

  // Latest callback via ref so render/save effects depend only on paging
  // state — a changing identity would re-render and re-save in a loop.
  const onProgressRef = useRef(onProgress);
  useEffect(() => {
    onProgressRef.current = onProgress;
  }, [onProgress]);

  const paintPageHighlights = useCallback(() => {
    const overlay = overlayRef.current;
    const textDiv = textDivRef.current;
    const stage = stageRef.current;
    if (!overlay || !textDiv || !stage) return;
    overlay.replaceChildren();
    const stageBox = stage.getBoundingClientRect();
    for (const highlight of highlightsRef.current.values()) {
      if (highlight.anchor.page !== page || !highlight.anchor.quote) continue;
      const range = rangeForQuote(textDiv, highlight.anchor.quote.exact);
      if (!range) continue;
      for (const rect of Array.from(range.getClientRects())) {
        if (rect.width < 1 || rect.height < 1) continue;
        const mark = document.createElement("div");
        mark.className = "pdf-highlight";
        mark.title = "Highlighted — manage in the highlights panel (✎)";
        mark.style.left = `${rect.left - stageBox.left}px`;
        mark.style.top = `${rect.top - stageBox.top}px`;
        mark.style.width = `${rect.width}px`;
        mark.style.height = `${rect.height}px`;
        // Deletion lives in the panel only; a click here just opens it.
        mark.addEventListener("click", () => setShowPanel(true));
        overlay.appendChild(mark);
      }
    }
  }, [page, path]);
  const paintRef = useRef(paintPageHighlights);
  useEffect(() => {
    paintRef.current = paintPageHighlights;
  }, [paintPageHighlights]);

  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        const sidecar = await invoke<Sidecar>("get_sidecar", { path });
        const loadingTask = pdfjs.getDocument({ url: convertFileSrc(path) });
        loadingTaskRef.current = loadingTask;
        const doc = await loadingTask.promise;
        if (disposed) {
          loadingTask.destroy().catch(() => {});
          return;
        }
        docRef.current = doc;
        highlightsRef.current = new Map(
          sidecar.highlights.map((h) => [h.id, h])
        );
        setHighlights(sidecar.highlights);
        setNumPages(doc.numPages);
        const savedPage = sidecar.position
          ? parseInt(sidecar.position, 10)
          : NaN;
        setPage(
          Number.isFinite(savedPage) &&
            savedPage >= 1 &&
            savedPage <= doc.numPages
            ? savedPage
            : 1
        );
      } catch (e) {
        if (!disposed) setError(String(e));
      }
    })();
    return () => {
      disposed = true;
      renderTaskRef.current?.cancel();
      loadingTaskRef.current?.destroy().catch(() => {});
      loadingTaskRef.current = null;
      docRef.current = null;
      highlightsRef.current = new Map();
    };
  }, [path]);

  useEffect(() => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    const wrap = pageWrapRef.current;
    const stage = stageRef.current;
    const textDiv = textDivRef.current;
    if (!doc || !canvas || !wrap || !stage || !textDiv || numPages === 0)
      return;
    let cancelled = false;

    (async () => {
      try {
        const pdfPage = await doc.getPage(page);
        if (cancelled) return;
        const base = pdfPage.getViewport({ scale: 1 });
        const widthFit = (wrap.clientWidth - 32) / base.width;
        const fit =
          fitMode === "width"
            ? widthFit
            : Math.min(widthFit, (wrap.clientHeight - 16) / base.height);
        const dpr = window.devicePixelRatio || 1;
        const viewport = pdfPage.getViewport({ scale: Math.max(fit, 0.1) });
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        stage.style.width = `${viewport.width}px`;
        stage.style.height = `${viewport.height}px`;
        stage.style.setProperty("--scale-factor", String(viewport.scale));
        const ctx = canvas.getContext("2d")!;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        renderTaskRef.current?.cancel();
        const task = pdfPage.render({ canvas, canvasContext: ctx, viewport });
        renderTaskRef.current = task;
        await task.promise.catch(() => {});
        if (cancelled) return;

        // Text layer enables selection; highlights paint over it.
        textDiv.replaceChildren();
        const textLayer = new TextLayer({
          textContentSource: pdfPage.streamTextContent(),
          container: textDiv,
          viewport,
        });
        await textLayer.render();
        if (!cancelled) paintRef.current();
      } catch {
        /* page render cancelled or failed; keep previous frame */
      }
    })();

    const percent = numPages > 0 ? page / numPages : null;
    onProgressRef.current(path, percent);
    invoke("save_progress", {
      path,
      position: String(page),
      percent,
    }).catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [page, numPages, path, fitTick, fitMode]);

  // Re-fit when the window/panel resizes.
  useEffect(() => {
    const wrap = pageWrapRef.current;
    if (!wrap) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setFitTick((t) => t + 1));
    });
    observer.observe(wrap);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  // Capture selections made on the text layer.
  const captureSelection = useCallback(() => {
    const textDiv = textDivRef.current;
    if (!textDiv) return;
    const captured = captureQuoteSelection(textDiv);
    if (captured) setPending(captured);
  }, []);

  const saveHighlight = useCallback(async () => {
    if (!pending) return;
    try {
      const highlight = await invoke<Highlight>("add_highlight", {
        path,
        text: pending.exact,
        note: null,
        color: null,
        anchor: {
          type: "pdf",
          page,
          quote: {
            exact: pending.exact,
            prefix: pending.prefix,
            suffix: pending.suffix,
          },
          position: { start: pending.start, end: pending.end },
        },
      });
      highlightsRef.current.set(highlight.id, highlight);
      setHighlights((current) => [...current, highlight]);
      window.getSelection()?.removeAllRanges();
      paintRef.current();
    } catch (e) {
      setError(String(e));
    } finally {
      setPending(null);
    }
  }, [pending, path, page]);

  const removeHighlight = useCallback(
    async (highlight: Highlight) => {
      await invoke("remove_highlight", { path, id: highlight.id }).catch(
        () => {}
      );
      highlightsRef.current.delete(highlight.id);
      setHighlights((current) => current.filter((h) => h.id !== highlight.id));
      paintRef.current();
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


  const go = useCallback(
    (delta: number) => {
      setPending(null);
      setPage((current) =>
        Math.min(Math.max(current + delta, 1), numPages || 1)
      );
    },
    [numPages]
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [go]);

  if (error) {
    return (
      <div className="reader-error">
        <p>Couldn't open this book: {error}</p>
      </div>
    );
  }

  return (
    <div className="reader">
      <div
        className={`reader-page reader-page-pdf ${
          fitMode === "width" ? "fit-width" : ""
        }`}
        ref={pageWrapRef}
        onMouseUp={captureSelection}
      >
        <div className="pdf-stage" ref={stageRef}>
          <canvas ref={canvasRef} />
          <div className="textLayer" ref={textDivRef} />
          <div className="pdf-overlay" ref={overlayRef} />
        </div>
      </div>
      {pending && (
        <div className="highlight-pill">
          <span className="highlight-pill-text">
            “{pending.exact.slice(0, 60)}
            {pending.exact.length > 60 ? "…" : ""}”
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
            if (h.anchor.page != null) setPage(h.anchor.page);
          }}
          onDelete={removeHighlight}
          onNote={noteHighlight}
          onClose={() => setShowPanel(false)}
        />
      )}
      <footer className="reader-bar">
        <button onClick={() => go(-1)} aria-label="Previous page">
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
          · Page{" "}
          <input
            type="number"
            min={1}
            max={numPages || 1}
            value={page}
            onChange={(e) => {
              const n = parseInt(e.currentTarget.value, 10);
              if (Number.isFinite(n) && n >= 1 && n <= numPages) setPage(n);
            }}
          />{" "}
          of {numPages || "…"}
        </span>
        <span>
          <button
            onClick={() =>
              setFitMode((m) => (m === "page" ? "width" : "page"))
            }
            aria-label="Toggle zoom mode"
          >
            {fitMode === "page" ? "Fit width" : "Fit page"}
          </button>{" "}
          <button onClick={() => go(1)} aria-label="Next page">
            Next →
          </button>
        </span>
      </footer>
    </div>
  );
}
