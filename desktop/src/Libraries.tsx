import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { countLabel } from "./library";
import type { KnownLibrary, LibrariesView } from "./library";

export interface LibraryActions {
  /** Add the folder (or find it when already listed) and open it. */
  add: (path: string) => Promise<void>;
  open: (id: string) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  relocate: (id: string, path: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const STATUS_LABEL: Record<KnownLibrary["status"], string> = {
  available: "Available",
  missing: "Folder not found",
  inaccessible: "Folder can't be read",
  not_folder: "Not a folder",
};

async function pickFolder(title: string): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false, title });
  return typeof selected === "string" ? selected : null;
}

function LibraryRow({
  library,
  actions,
  busy,
  report,
}: {
  library: KnownLibrary;
  actions: LibraryActions;
  busy: boolean;
  report: (message: string | null, isError?: boolean) => void;
}) {
  const [mode, setMode] = useState<"idle" | "rename" | "remove">("idle");
  const [name, setName] = useState(library.name);
  const nameInput = useRef<HTMLInputElement>(null);
  const firstAction = useRef<HTMLButtonElement>(null);
  const available = library.status === "available";
  const headingId = `library-${library.id}`;

  useEffect(() => {
    if (mode === "rename") nameInput.current?.select();
  }, [mode]);

  const run = async (what: () => Promise<void>) => {
    report(null);
    try {
      await what();
      return true;
    } catch (e) {
      report(String(e), true);
      return false;
    }
  };

  const back = () => {
    setMode("idle");
    setTimeout(() => firstAction.current?.focus(), 0);
  };

  return (
    <li
      className={`library-row ${library.active ? "library-row-active" : ""}`}
      aria-labelledby={headingId}
      aria-current={library.active ? "true" : undefined}
      data-library-id={library.id}
    >
      <div className="library-row-main">
        <h3 id={headingId} className="library-name">
          {library.name}
          {library.active && <span className="library-badge">Open now</span>}
        </h3>
        <code className="library-path">{library.path}</code>
        <p className="library-facts">
          <span className={`library-state library-state-${library.status}`}>
            {STATUS_LABEL[library.status]}
          </span>
          {" · "}
          <span className="library-count">{countLabel(library)}</span>
        </p>
        {library.problem && <p className="library-problem">{library.problem}</p>}
      </div>

      {mode === "rename" && (
        <form
          className="library-rename"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run(() => actions.rename(library.id, name))) back();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setName(library.name);
              back();
            }
          }}
        >
          <label>
            New name for {library.name}
            <input
              ref={nameInput}
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.currentTarget.value)}
            />
          </label>
          <button type="submit" disabled={busy || !name.trim()}>
            Save name
          </button>
          <button
            type="button"
            onClick={() => {
              setName(library.name);
              back();
            }}
          >
            Cancel
          </button>
        </form>
      )}

      {mode === "remove" && (
        <div className="library-remove-confirm" role="group" aria-label={`Remove ${library.name}`}>
          <p>
            Remove “{library.name}” from this list? ProperBooky only forgets it. The folder{" "}
            <code>{library.path}</code> and everything in it — books, reading progress, highlights
            and notes — stays on disk untouched. Open the folder again any time to bring the
            library back as it was.
          </p>
          <button
            className="library-remove-yes"
            autoFocus
            disabled={busy}
            onClick={async () => {
              if (await run(() => actions.remove(library.id))) setMode("idle");
            }}
          >
            Remove from list
          </button>
          <button onClick={back}>Keep it</button>
        </div>
      )}

      {mode === "idle" && (
        <div className="library-row-actions">
          {available && !library.active && (
            <button
              ref={firstAction}
              className="library-open"
              disabled={busy}
              aria-label={`Open ${library.name}`}
              onClick={() => run(() => actions.open(library.id))}
            >
              Open
            </button>
          )}
          {!available && (
            <>
              <button
                ref={firstAction}
                disabled={busy}
                aria-label={`Check ${library.name} again`}
                onClick={() => run(actions.refresh)}
              >
                Check again
              </button>
              <button
                disabled={busy}
                aria-label={`Locate the folder for ${library.name}`}
                onClick={async () => {
                  const path = await pickFolder(`Locate the folder for ${library.name}`);
                  if (path === null) {
                    report("No folder was chosen; nothing changed.");
                    return;
                  }
                  await run(() => actions.relocate(library.id, path));
                }}
              >
                Locate folder…
              </button>
            </>
          )}
          <button
            ref={available && library.active ? firstAction : undefined}
            disabled={busy}
            aria-label={`Rename ${library.name}`}
            onClick={() => setMode("rename")}
          >
            Rename
          </button>
          <button
            disabled={busy}
            aria-label={`Remove ${library.name} from the list`}
            onClick={() => setMode("remove")}
          >
            Remove from list
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * Known libraries: open, add, rename, forget, locate. Shown as the whole page
 * when no library is open (first run, or the open one is unavailable), and as
 * a dialog from the tab rail otherwise.
 */
export default function Libraries({
  view,
  actions,
  busy,
  error,
  dialog,
  onClose,
}: {
  view: LibrariesView | null;
  actions: LibraryActions;
  /** Progress text while opening/indexing; disables actions. */
  busy: string | null;
  error: string | null;
  dialog: boolean;
  onClose?: () => void;
}) {
  const [pathInput, setPathInput] = useState("");
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const libraries = view?.libraries ?? [];
  const active = libraries.find((l) => l.active) ?? null;

  useEffect(() => {
    if (!dialog) return;
    panel.current?.querySelector<HTMLElement>("button, input")?.focus();
  }, [dialog]);

  const report = (text: string | null, isError = false) =>
    setMessage(text ? { text, error: isError } : null);

  const add = async (path: string) => {
    report(null);
    try {
      await actions.add(path);
      setPathInput("");
    } catch (e) {
      report(String(e), true);
    }
  };

  // Dialog: Escape closes, Tab stays inside.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!dialog) return;
    if (e.key === "Escape" && onClose) {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !panel.current) return;
    const focusable = Array.from(
      panel.current.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)"),
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const shownError = message?.error ? message.text : error;
  const content = (
    <>
      {dialog && (
        <header className="libraries-head">
          <h2 id="libraries-title">Libraries</h2>
          <button className="panel-close" onClick={onClose} aria-label="Close libraries">
            ×
          </button>
        </header>
      )}
      {view?.error && (
        <p className="launcher-error" role="alert">
          {view.error}
        </p>
      )}
      {view?.notices.map((notice) => (
        <p key={notice} className="launcher-notice" role="note">
          {notice}
        </p>
      ))}
      {!dialog && active && active.status !== "available" && (
        <p className="launcher-error" role="alert">
          {active.problem}
        </p>
      )}
      {!dialog && !libraries.length && (
        <p>
          Point ProperBooky at your book folder (EPUB, PDF, Markdown). The folder stays the source
          of truth — the index is rebuilt from it on every scan. You can add more folders later as
          separate libraries.
        </p>
      )}
      {libraries.length > 0 && (
        <section aria-labelledby="known-libraries-title">
          <h3 id="known-libraries-title" className="libraries-subtitle">
            {dialog ? "Your libraries" : "Choose a library"}
          </h3>
          <ul className="library-list">
            {libraries.map((library) => (
              <LibraryRow
                key={library.id}
                library={library}
                actions={actions}
                busy={Boolean(busy)}
                report={report}
              />
            ))}
          </ul>
        </section>
      )}
      <section className="library-add" aria-label="Add a library">
        <button
          className="library-open-folder"
          disabled={Boolean(busy)}
          onClick={async () => {
            const path = await pickFolder("Open folder as library");
            if (path === null) report("No folder was chosen; nothing changed.");
            else await add(path);
          }}
        >
          Open folder as library…
        </button>
        <form
          className="path-form"
          onSubmit={(e) => {
            e.preventDefault();
            const path = pathInput.trim();
            if (path) add(path);
          }}
        >
          <input
            type="text"
            aria-label="Folder path"
            placeholder="…or paste a folder path (e.g. /home/you/Books)"
            value={pathInput}
            onChange={(e) => setPathInput(e.currentTarget.value)}
          />
          <button type="submit" disabled={Boolean(busy) || !pathInput.trim()}>
            Index this path
          </button>
        </form>
      </section>
      {busy && (
        <p className="launcher-progress" role="status">
          {busy}
        </p>
      )}
      {message && !message.error && (
        <p className="launcher-message" role="status">
          {message.text}
        </p>
      )}
      {shownError && (
        <p className="launcher-error" role="alert">
          {shownError}
        </p>
      )}
    </>
  );

  if (!dialog)
    return (
      <div className="empty launcher" ref={panel}>
        {content}
      </div>
    );
  return (
    <div className="libraries-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div
        className="libraries-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="libraries-title"
        ref={panel}
        onKeyDown={onKeyDown}
      >
        {content}
      </div>
    </div>
  );
}
