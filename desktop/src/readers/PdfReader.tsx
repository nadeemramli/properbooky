import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { ReadingProgress } from "../types";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export default function PdfReader({
  path,
  onProgress,
}: {
  path: string;
  onProgress: (percent: number | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pageWrapRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const loadingTaskRef = useRef<{ destroy: () => Promise<void> } | null>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  const [page, setPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        const saved = await invoke<ReadingProgress | null>("get_progress", {
          path,
        });
        const loadingTask = pdfjs.getDocument({ url: convertFileSrc(path) });
        loadingTaskRef.current = loadingTask;
        const doc = await loadingTask.promise;
        if (disposed) {
          loadingTask.destroy().catch(() => {});
          return;
        }
        docRef.current = doc;
        setNumPages(doc.numPages);
        const savedPage = saved ? parseInt(saved.position, 10) : NaN;
        setPage(
          Number.isFinite(savedPage) && savedPage >= 1 && savedPage <= doc.numPages
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
    };
  }, [path]);

  useEffect(() => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    const wrap = pageWrapRef.current;
    if (!doc || !canvas || !wrap || numPages === 0) return;
    let cancelled = false;

    (async () => {
      try {
        const pdfPage = await doc.getPage(page);
        if (cancelled) return;
        const base = pdfPage.getViewport({ scale: 1 });
        const fit = (wrap.clientWidth - 32) / base.width;
        const dpr = window.devicePixelRatio || 1;
        const viewport = pdfPage.getViewport({ scale: fit });
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        const ctx = canvas.getContext("2d")!;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        renderTaskRef.current?.cancel();
        const task = pdfPage.render({ canvas, canvasContext: ctx, viewport });
        renderTaskRef.current = task;
        await task.promise.catch(() => {});
      } catch {
        /* page render cancelled or failed; keep previous frame */
      }
    })();

    const percent = numPages > 0 ? page / numPages : null;
    onProgress(percent);
    invoke("save_progress", {
      path,
      position: String(page),
      percent,
    }).catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [page, numPages, path, onProgress]);

  const go = useCallback(
    (delta: number) => {
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
      <div className="reader-page reader-page-pdf" ref={pageWrapRef}>
        <canvas ref={canvasRef} />
      </div>
      <footer className="reader-bar">
        <button onClick={() => go(-1)} aria-label="Previous page">
          ← Previous
        </button>
        <span className="reader-progress">
          Page{" "}
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
        <button onClick={() => go(1)} aria-label="Next page">
          Next →
        </button>
      </footer>
    </div>
  );
}
