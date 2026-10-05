import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import LibraryView, { openablePath } from "./LibraryView";
import Libraries from "./Libraries";
import type { LibraryActions } from "./Libraries";
import ArticleReader from "./readers/ArticleReader";
import EpubReader from "./readers/EpubReader";
import PdfReader from "./readers/PdfReader";
import ReaderBoundary from "./ReaderBoundary";
import { LibraryProvider, boundInvoke } from "./library";
import type { KnownLibrary, LibrariesView, LibraryHandle } from "./library";
import type { Book, OpenTab, ScanResult } from "./types";
import "./App.css";

const LIBRARY_TAB = "__library__";

function percentLabel(percent: number | null) {
  return percent === null ? "not started" : `${Math.round(percent * 100)}% read`;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function Switcher({
  library,
  expanded,
  onClick,
}: {
  library: KnownLibrary | null;
  expanded: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="library-switcher"
      aria-haspopup="dialog"
      aria-expanded={expanded}
      title={library ? `${library.name} — ${library.path}` : "Libraries"}
      onClick={onClick}
    >
      <span className="sr-only">Library: </span>
      {library?.name ?? "No library open"}
      <span className="sr-only">. Switch or manage libraries</span>
      <span aria-hidden="true"> ▾</span>
    </button>
  );
}

/** One open library: its Library tab, its reader tabs and every panel. Keyed
 * by library id, so switching discards all of it and nothing rendered for one
 * library can act on another. */
function Workspace({
  library,
  handle,
  initialStatus,
  notices,
  dialogOpen,
  onManage,
  onUnmount,
}: {
  library: KnownLibrary;
  handle: LibraryHandle;
  initialStatus: string | null;
  /** Library-list recovery notices, shown even when a library opens directly. */
  notices: string[];
  dialogOpen: boolean;
  onManage: () => void;
  onUnmount: () => void;
}) {
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [active, setActive] = useState<string>(LIBRARY_TAB);
  // Keyboard focus to restore once the tab rail has re-rendered.
  const [focusTab, setFocusTab] = useState<string | null>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => onUnmount, [onUnmount]);

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
    <LibraryProvider value={handle}>
      <nav className="tab-rail" aria-label="Library and open books">
        <span className="brand">ProperBooky</span>
        <Switcher library={library} expanded={dialogOpen} onClick={onManage} />
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
          <LibraryView onOpen={openBook} initialStatus={initialStatus} listNotices={notices} />
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
    </LibraryProvider>
  );
}

export default function App() {
  const [view, setView] = useState<LibrariesView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState(false);
  const [initialStatus, setInitialStatus] = useState<string | null>(null);
  const inFlight = useRef(new Set<Promise<unknown>>());
  const unmounted = useRef<(() => void) | null>(null);
  const switcher = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    setView(await invoke<LibrariesView>("list_libraries"));
  }, []);

  useEffect(() => {
    refresh().catch((e) => setError(String(e)));
  }, [refresh]);

  const active = view?.libraries.find((l) => l.active) ?? null;
  const open = active?.status === "available" && busy === null ? active : null;
  const activeId = open?.id ?? null;
  const handle = useMemo<LibraryHandle | null>(
    () =>
      open ? { id: open.id, name: open.name, path: open.path, invoke: boundInvoke(open.id, inFlight.current) } : null,
    // Bound to the id only; a rename keeps the workspace and its tabs.
    [activeId],
  );
  const handleWithName = useMemo(
    () => (handle && open ? { ...handle, name: open.name, path: open.path } : null),
    [handle, open?.name, open?.path],
  );

  const onUnmount = useCallback(() => {
    unmounted.current?.();
    unmounted.current = null;
  }, []);

  /**
   * Change which library is open with no workspace mounted: unmount the open
   * one, let its last calls finish against the library that issued them,
   * then change the backend. Late results go to unmounted components and
   * late writes carry the old id, which the backend refuses.
   */
  const transition = useCallback(
    async (label: string, change: () => Promise<LibrariesView>) => {
      const gone = activeId
        ? new Promise<void>((resolve) => (unmounted.current = resolve))
        : Promise.resolve();
      setBusy(label);
      setError(null);
      await Promise.race([gone, delay(1000)]);
      await Promise.race([Promise.allSettled([...inFlight.current]), delay(1500)]);
      try {
        let next = await change();
        const opened = next.libraries.find((l) => l.active);
        let status: string | null = null;
        if (opened && opened.status === "available" && opened.book_count === null) {
          setBusy(`Indexing ${opened.name}…`);
          const result = await invoke<ScanResult>("scan_library", { libraryId: opened.id });
          status =
            `Indexed ${result.indexed} books` +
            (result.skipped ? ` (${result.skipped} skipped)` : "");
          next = await invoke<LibrariesView>("list_libraries");
        }
        inFlight.current.clear();
        setInitialStatus(status);
        setView(next);
        setDialog(false);
      } catch (e) {
        // The previous library stays open; the dialog (or page) shows why.
        setError(String(e));
        await refresh().catch(() => {});
      } finally {
        setBusy(null);
      }
    },
    [activeId, refresh],
  );

  const actions: LibraryActions = useMemo(
    () => ({
      refresh,
      add: async (path) => {
        const added = await invoke<{ id: string; view: LibrariesView }>("add_library", { path });
        if (added.id === activeId) {
          setView(added.view);
          setDialog(false);
          return;
        }
        const name = added.view.libraries.find((l) => l.id === added.id)?.name ?? "library";
        await transition(`Opening ${name}…`, () =>
          invoke<LibrariesView>("switch_library", { id: added.id }),
        );
      },
      open: (id) => {
        const name = view?.libraries.find((l) => l.id === id)?.name ?? "library";
        return transition(`Opening ${name}…`, () => invoke<LibrariesView>("switch_library", { id }));
      },
      rename: async (id, name) => {
        setView(await invoke<LibrariesView>("rename_library", { id, name }));
      },
      remove: async (id) => {
        if (id === activeId)
          await transition("Closing library…", () => invoke<LibrariesView>("remove_library", { id }));
        else setView(await invoke<LibrariesView>("remove_library", { id }));
      },
      relocate: async (id, path) => {
        if (id === active?.id)
          await transition("Opening library…", () =>
            invoke<LibrariesView>("relocate_library", { id, path }),
          );
        else setView(await invoke<LibrariesView>("relocate_library", { id, path }));
      },
    }),
    [active?.id, activeId, refresh, transition, view],
  );

  const closeDialog = useCallback(() => {
    setDialog(false);
    setError(null);
    setTimeout(() => switcher.current?.querySelector<HTMLElement>(".library-switcher")?.focus(), 0);
  }, []);

  return (
    <main className="app" ref={switcher}>
      {open && handleWithName ? (
        <Workspace
          key={open.id}
          library={open}
          handle={handleWithName}
          initialStatus={initialStatus}
          notices={view?.notices ?? []}
          dialogOpen={dialog}
          onManage={() => {
            setDialog(true);
            // Folders may have moved or changed access since the last look.
            refresh().catch((e) => setError(String(e)));
          }}
          onUnmount={onUnmount}
        />
      ) : (
        <>
          <nav className="tab-rail" aria-label="Library and open books">
            <span className="brand">ProperBooky</span>
            <div className="tab-list" role="tablist" aria-label="Open books">
              <button
                id="tab-library"
                role="tab"
                aria-selected="true"
                aria-controls="tab-panel"
                className="tab tab-library tab-active"
              >
                Libraries
              </button>
            </div>
          </nav>
          <section className="tab-panel" id="tab-panel" role="tabpanel" aria-labelledby="tab-library">
            <div className="library">
              {view === null && error === null ? (
                // Not the first-run page: the saved list has not loaded yet.
                <p className="launcher-progress" role="status">
                  Loading your libraries…
                </p>
              ) : (
                <Libraries view={view} actions={actions} busy={busy} error={error} dialog={false} />
              )}
            </div>
          </section>
        </>
      )}
      {open && dialog && (
        <Libraries
          view={view}
          actions={actions}
          busy={busy}
          error={error}
          dialog
          onClose={closeDialog}
        />
      )}
    </main>
  );
}
