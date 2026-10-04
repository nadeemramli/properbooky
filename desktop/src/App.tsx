import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import LibraryView, { openablePath } from "./LibraryView";
import ArticleReader from "./readers/ArticleReader";
import EpubReader from "./readers/EpubReader";
import PdfReader from "./readers/PdfReader";
import ReaderBoundary from "./ReaderBoundary";
import type { Book, OpenTab } from "./types";
import "./App.css";

const LIBRARY_TAB = "__library__";

function percentLabel(percent: number | null) {
  return percent === null ? "not started" : `${Math.round(percent * 100)}% read`;
}

export default function App() {
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [active, setActive] = useState<string>(LIBRARY_TAB);
  // Keyboard focus to restore once the tab rail has re-rendered.
  const [focusTab, setFocusTab] = useState<string | null>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    if (focusTab === null) return;
    tabRefs.current.get(focusTab)?.focus();
    setFocusTab(null);
  }, [focusTab, tabs, active]);

  const openBook = useCallback((book: Book) => {
    const path = openablePath(book);
    if (!path) return;
    const format =
      book.assets.find((asset) => asset.path === path)?.format ??
      (book.kind === "article"
        ? "article"
        : path.toLowerCase().endsWith(".epub")
          ? "epub"
          : "pdf");
    setTabs((current) =>
      current.some((t) => t.path === path)
        ? current
        : [
            ...current,
            { path, title: book.title, format, percent: book.progress ?? null },
          ],
    );
    setActive(path);
  }, []);

  const closeTab = useCallback(
    (path: string, restoreFocus: boolean) => {
      setTabs((current) => current.filter((t) => t.path !== path));
      const next = active === path ? LIBRARY_TAB : active;
      setActive(next);
      // The focused control is about to disappear; keep keyboard users on a
      // live tab instead of dropping focus to the document body.
      if (restoreFocus) setFocusTab(next);
    },
    [active],
  );

  const reportProgress = useCallback((path: string, percent: number | null) => {
    setTabs((current) => {
      const tab = current.find((t) => t.path === path);
      if (!tab || tab.percent === percent) return current;
      return current.map((t) => (t.path === path ? { ...t, percent } : t));
    });
  }, []);

  // WAI-ARIA tabs: arrows/Home/End move focus, Enter/Space activate (the
  // tabs are buttons), Delete closes the focused book tab.
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const ids = [LIBRARY_TAB, ...tabs.map((t) => t.path)];
    const current = ids.findIndex(
      (id) => tabRefs.current.get(id) === document.activeElement,
    );
    if (current < 0) return;
    let target: number | null = null;
    if (e.key === "ArrowRight") target = (current + 1) % ids.length;
    if (e.key === "ArrowLeft") target = (current - 1 + ids.length) % ids.length;
    if (e.key === "Home") target = 0;
    if (e.key === "End") target = ids.length - 1;
    if (target !== null) {
      e.preventDefault();
      tabRefs.current.get(ids[target])?.focus();
    } else if (e.key === "Delete" && current > 0) {
      e.preventDefault();
      closeTab(ids[current], true);
    }
  };

  const setTabRef = (id: string) => (el: HTMLButtonElement | null) => {
    if (el) tabRefs.current.set(id, el);
    else tabRefs.current.delete(id);
  };

  const activeTab = tabs.find((t) => t.path === active) ?? null;
  const tabId = (index: number) => (index < 0 ? "tab-library" : `tab-book-${index}`);
  const activeIndex = activeTab ? tabs.indexOf(activeTab) : -1;

  return (
    <main className="app">
      <nav className="tab-rail" aria-label="Library and open books">
        <span className="brand">ProperBooky</span>
        <div
          className="tab-list"
          role="tablist"
          aria-label="Open books"
          onKeyDown={onTabKey}
        >
          <button
            ref={setTabRef(LIBRARY_TAB)}
            id={tabId(-1)}
            role="tab"
            aria-selected={!activeTab}
            aria-controls="tab-panel"
            tabIndex={!activeTab ? 0 : -1}
            className={`tab tab-library ${!activeTab ? "tab-active" : ""}`}
            onClick={() => setActive(LIBRARY_TAB)}
          >
            Library
          </button>
          {tabs.map((tab, index) => (
            <span
              key={tab.path}
              role="presentation"
              className={`tab tab-book ${active === tab.path ? "tab-active" : ""}`}
            >
              <button
                ref={setTabRef(tab.path)}
                id={tabId(index)}
                role="tab"
                aria-selected={active === tab.path}
                aria-controls="tab-panel"
                aria-keyshortcuts="Delete"
                tabIndex={active === tab.path ? 0 : -1}
                className="tab-title"
                title={`${tab.title} — ${percentLabel(tab.percent)}`}
                onClick={() => setActive(tab.path)}
              >
                {tab.title}
                <span className="sr-only">, {percentLabel(tab.percent)}</span>
              </button>
              <button
                className="tab-close"
                aria-label={`Close ${tab.title}`}
                onClick={(e) => closeTab(tab.path, e.detail === 0)}
              >
                ×
              </button>
              <span
                className="tab-ribbon"
                aria-hidden="true"
                data-percent={tab.percent ?? ""}
                style={{ width: `${Math.round((tab.percent ?? 0) * 100)}%` }}
              />
            </span>
          ))}
        </div>
      </nav>

      <section
        className="tab-panel"
        id="tab-panel"
        role="tabpanel"
        aria-labelledby={tabId(activeIndex)}
      >
        {!activeTab ? (
          <LibraryView onOpen={openBook} />
        ) : (
          <ReaderBoundary key={activeTab.path}>
            {activeTab.format === "epub" ? (
              <EpubReader path={activeTab.path} onProgress={reportProgress} />
            ) : activeTab.format === "article" ? (
              <ArticleReader path={activeTab.path} onProgress={reportProgress} />
            ) : (
              <PdfReader path={activeTab.path} onProgress={reportProgress} />
            )}
          </ReaderBoundary>
        )}
      </section>
    </main>
  );
}
