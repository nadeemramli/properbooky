import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { marked } from "marked";
import DOMPurify from "dompurify";
import HighlightsPanel from "./HighlightsPanel";
import { captureQuoteSelection, rangeForQuote } from "./quote";
import type { Highlight, Sidecar } from "../types";

interface PendingSelection {
  exact: string;
  prefix: string;
  suffix: string;
  start: number;
  end: number;
}

export default function ArticleReader({
  path,
  onProgress,
}: {
  path: string;
  onProgress: (path: string, percent: number | null) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingSelection | null>(null);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [showPanel, setShowPanel] = useState(false);
  const savedPositionRef = useRef<number | null>(null);

  const onProgressRef = useRef(onProgress);
  useEffect(() => {
    onProgressRef.current = onProgress;
  }, [onProgress]);

  const paint = useCallback(() => {
    const overlay = overlayRef.current;
    const content = contentRef.current;
    if (!overlay || !content) return;
    overlay.replaceChildren();
    const contentBox = content.getBoundingClientRect();
    for (const highlight of highlights) {
      if (!highlight.anchor.quote) continue;
      const range = rangeForQuote(content, highlight.anchor.quote.exact);
      if (!range) continue;
      for (const rect of Array.from(range.getClientRects())) {
        if (rect.width < 1 || rect.height < 1) continue;
        const mark = document.createElement("div");
        mark.className = "pdf-highlight";
        mark.title = "Highlighted — manage in the highlights panel (✎)";
        mark.style.left = `${rect.left - contentBox.left}px`;
        mark.style.top = `${rect.top - contentBox.top}px`;
        mark.style.width = `${rect.width}px`;
        mark.style.height = `${rect.height}px`;
        mark.addEventListener("click", () => setShowPanel(true));
        overlay.appendChild(mark);
      }
    }
  }, [highlights]);
  useEffect(() => {
    paint();
  }, [paint, html]);

  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        const sidecar = await invoke<Sidecar>("get_sidecar", { path });
        const response = await fetch(convertFileSrc(path));
        if (!response.ok)
          throw new Error(`could not read the article (${response.status})`);
        const raw = await response.text();
        if (disposed) return;

        const match = raw.match(/^---\n([\s\S]*?)\n---\n?/);
        const body = match ? raw.slice(match[0].length) : raw;
        const source = match?.[1].match(/^source_url:\s*(.+)$/m)?.[1]?.trim();
        setSourceUrl(source ?? null);
        setHighlights(sidecar.highlights);
        savedPositionRef.current = sidecar.position
          ? parseFloat(sidecar.position)
          : null;

        const rendered = await marked.parse(body);
        if (!disposed) setHtml(DOMPurify.sanitize(rendered));
      } catch (e) {
        if (!disposed) setError(String(e));
      }
    })();
    return () => {
      disposed = true;
    };
  }, [path]);

  // Restore scroll after render.
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!html || !scroll) return;
    const saved = savedPositionRef.current;
    if (saved && saved > 0 && saved <= 1) {
      scroll.scrollTop = saved * (scroll.scrollHeight - scroll.clientHeight);
    }
  }, [html]);

  const onScroll = useCallback(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const max = scroll.scrollHeight - scroll.clientHeight;
    const percent = max > 0 ? Math.min(scroll.scrollTop / max, 1) : 1;
    onProgressRef.current(path, percent);
    invoke("save_progress", {
      path,
      position: String(percent),
      percent,
    }).catch(() => {});
  }, [path]);
  const scrollTimer = useRef<number>(0);
  const debouncedScroll = useCallback(() => {
    window.clearTimeout(scrollTimer.current);
    scrollTimer.current = window.setTimeout(onScroll, 300);
  }, [onScroll]);

  const captureSelection = useCallback(() => {
    const content = contentRef.current;
    if (!content) return;
    const captured = captureQuoteSelection(content);
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
          type: "article",
          quote: {
            exact: pending.exact,
            prefix: pending.prefix,
            suffix: pending.suffix,
          },
          position: { start: pending.start, end: pending.end },
        },
      });
      setHighlights((current) => [...current, highlight]);
      window.getSelection()?.removeAllRanges();
    } catch (e) {
      setError(String(e));
    } finally {
      setPending(null);
    }
  }, [pending, path]);

  const removeHighlight = useCallback(
    async (highlight: Highlight) => {
      await invoke("remove_highlight", { path, id: highlight.id }).catch(
        () => {}
      );
      setHighlights((current) => current.filter((h) => h.id !== highlight.id));
    },
    [path]
  );

  if (error) {
    return (
      <div className="reader-error">
        <p>Couldn't open this article: {error}</p>
      </div>
    );
  }

  return (
    <div className="reader">
      <div
        className="reader-page article-scroll"
        ref={scrollRef}
        onScroll={debouncedScroll}
        onMouseUp={captureSelection}
      >
        <div className="article-content" ref={contentRef}>
          {html === null ? (
            <p className="reader-loading">Opening…</p>
          ) : (
            <div dangerouslySetInnerHTML={{ __html: html }} />
          )}
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
            const content = contentRef.current;
            if (!content || !h.anchor.quote) return;
            const range = rangeForQuote(content, h.anchor.quote.exact);
            range?.startContainer.parentElement?.scrollIntoView({
              block: "center",
            });
          }}
          onDelete={removeHighlight}
          onClose={() => setShowPanel(false)}
        />
      )}
      <footer className="reader-bar">
        <span className="reader-progress">
          <button
            className="highlight-toggle"
            onClick={() => setShowPanel((s) => !s)}
            aria-label="Show highlights"
          >
            ✎ {highlights.length}
          </button>
        </span>
        {sourceUrl && (
          <a className="article-source" href={sourceUrl} target="_blank" rel="noreferrer">
            {sourceUrl.replace(/^https?:\/\//, "").slice(0, 60)}
          </a>
        )}
      </footer>
    </div>
  );
}
