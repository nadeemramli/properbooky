import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import ePub, { Rendition } from "epubjs";
import type { ReadingProgress } from "../types";

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

  // Keep the latest callback out of the load effect's dependencies —
  // a changing identity there re-loads the whole book (reload loop).
  const onProgressRef = useRef(onProgress);
  useEffect(() => {
    onProgressRef.current = onProgress;
  }, [onProgress]);

  useEffect(() => {
    let disposed = false;
    let book: ReturnType<typeof ePub> | null = null;

    (async () => {
      try {
        const saved = await invoke<ReadingProgress | null>("get_progress", {
          path,
        });
        const response = await fetch(convertFileSrc(path));
        if (!response.ok) throw new Error(`could not read file (${response.status})`);
        const buffer = await response.arrayBuffer();
        if (disposed || !containerRef.current) return;

        book = ePub(buffer);
        const rendition = book.renderTo(containerRef.current, {
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
          const cfi: string | undefined = location?.start?.cfi;
          const pct: number | undefined = location?.start?.percentage;
          const percentValue =
            typeof pct === "number" && pct > 0 ? Math.min(pct, 1) : null;
          setPercent(percentValue);
          onProgressRef.current(path, percentValue);
          if (cfi) {
            invoke("save_progress", {
              path,
              position: cfi,
              percent: percentValue,
            }).catch(() => {});
          }
        });
        rendition.on("keydown", (e: KeyboardEvent) => {
          if (e.key === "ArrowRight") rendition.next();
          if (e.key === "ArrowLeft") rendition.prev();
        });

        await rendition.display(saved?.position || undefined);
        if (disposed) return;
        renditionRef.current = rendition;
        setReady(true);
        // Percentages need generated locations; do it in the background.
        book.locations.generate(600).catch(() => {});
      } catch (e) {
        if (!disposed) setError(String(e));
      }
    })();

    return () => {
      disposed = true;
      renditionRef.current = null;
      book?.destroy();
    };
  }, [path]);

  const turn = useCallback((direction: "prev" | "next") => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    if (direction === "prev") rendition.prev();
    else rendition.next();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") turn("next");
      if (e.key === "ArrowLeft") turn("prev");
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
      <div className="reader-page" ref={containerRef}>
        {!ready && <p className="reader-loading">Opening…</p>}
      </div>
      <footer className="reader-bar">
        <button onClick={() => turn("prev")} aria-label="Previous page">
          ← Previous
        </button>
        <span className="reader-progress">
          {percent !== null ? `${Math.round(percent * 100)}%` : "—"}
        </span>
        <button onClick={() => turn("next")} aria-label="Next page">
          Next →
        </button>
      </footer>
    </div>
  );
}
