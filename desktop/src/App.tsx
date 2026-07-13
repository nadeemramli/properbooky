import { useCallback, useState } from "react";
import LibraryView, { openablePath } from "./LibraryView";
import ArticleReader from "./readers/ArticleReader";
import EpubReader from "./readers/EpubReader";
import PdfReader from "./readers/PdfReader";
import type { Book, OpenTab } from "./types";
import "./App.css";

const LIBRARY_TAB = "__library__";

export default function App() {
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [active, setActive] = useState<string>(LIBRARY_TAB);

  const openBook = useCallback((book: Book) => {
    const path = openablePath(book);
    if (!path) return;
    const format =
      book.kind === "article"
        ? "article"
        : path.toLowerCase().endsWith(".epub")
          ? "epub"
          : "pdf";
    setTabs((current) =>
      current.some((t) => t.path === path)
        ? current
        : [...current, { path, title: book.title, format, percent: null }]
    );
    setActive(path);
  }, []);

  const closeTab = useCallback(
    (path: string) => {
      setTabs((current) => current.filter((t) => t.path !== path));
      setActive((current) => (current === path ? LIBRARY_TAB : current));
    },
    []
  );

  const reportProgress = useCallback((path: string, percent: number | null) => {
    setTabs((current) => {
      const tab = current.find((t) => t.path === path);
      if (!tab || tab.percent === percent) return current;
      return current.map((t) => (t.path === path ? { ...t, percent } : t));
    });
  }, []);

  const activeTab = tabs.find((t) => t.path === active) ?? null;

  return (
    <main className="app">
      <nav className="tab-rail" role="tablist" aria-label="Open books">
        <span className="brand">ProperBooky</span>
        <button
          role="tab"
          aria-selected={active === LIBRARY_TAB}
          className={`tab tab-library ${active === LIBRARY_TAB ? "tab-active" : ""}`}
          onClick={() => setActive(LIBRARY_TAB)}
        >
          Library
        </button>
        {tabs.map((tab) => (
          <span
            key={tab.path}
            role="tab"
            aria-selected={active === tab.path}
            className={`tab tab-book ${active === tab.path ? "tab-active" : ""}`}
          >
            <button
              className="tab-title"
              title={tab.title}
              onClick={() => setActive(tab.path)}
            >
              {tab.title}
            </button>
            <button
              className="tab-close"
              aria-label={`Close ${tab.title}`}
              onClick={() => closeTab(tab.path)}
            >
              ×
            </button>
            <span
              className="tab-ribbon"
              style={{ width: `${Math.round((tab.percent ?? 0) * 100)}%` }}
            />
          </span>
        ))}
      </nav>

      <section className="tab-panel">
        {active === LIBRARY_TAB || !activeTab ? (
          <LibraryView onOpen={openBook} />
        ) : activeTab.format === "epub" ? (
          <EpubReader
            key={activeTab.path}
            path={activeTab.path}
            onProgress={reportProgress}
          />
        ) : activeTab.format === "article" ? (
          <ArticleReader
            key={activeTab.path}
            path={activeTab.path}
            onProgress={reportProgress}
          />
        ) : (
          <PdfReader
            key={activeTab.path}
            path={activeTab.path}
            onProgress={reportProgress}
          />
        )}
      </section>
    </main>
  );
}
