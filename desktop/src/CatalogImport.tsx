import { useCallback, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useLibrary } from "./library";
import type { CatalogImportResult } from "./types";

/** Long reports (a whole sheet) show their first rows and a count. */
const SHOWN = 100;

function Listed<T>({
  label,
  items,
  render,
}: {
  label: string;
  items: T[];
  render: (item: T) => string;
}) {
  if (!items.length) return null;
  return (
    <section className="import-section">
      <h4>
        {label} ({items.length})
      </h4>
      <ul aria-label={label}>
        {items.slice(0, SHOWN).map((item, i) => (
          <li key={i}>{render(item)}</li>
        ))}
        {items.length > SHOWN && <li>…and {items.length - SHOWN} more</li>}
      </ul>
    </section>
  );
}

export default function CatalogImport({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const { invoke } = useLibrary();
  const [csvPath, setCsvPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CatalogImportResult | null>(null);

  const pick = useCallback(async () => {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "CSV export", extensions: ["csv"] }],
    });
    if (typeof selected === "string") setCsvPath(selected);
  }, []);

  const run = useCallback(
    async (dryRun: boolean) => {
      setBusy(true);
      setError(null);
      setResult(null);
      try {
        const outcome = await invoke<CatalogImportResult>("import_catalog", {
          csvPath: csvPath.trim(),
          dryRun,
        });
        setResult(outcome);
        if (!dryRun) onImported();
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [csvPath, invoke, onImported],
  );

  const report = result?.report;
  const changed = report?.existing.filter((e) => e.differs.length) ?? [];
  return (
    <aside className="acquire-panel import-panel" aria-label="Import catalog">
      <header className="highlights-panel-head">
        <h3>Import catalog</h3>
        <button className="panel-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>
      <div className="acquire-drop">
        <p className="acquire-hint">
          Choose the Library of Books CSV export. Each book becomes one profile in
          this library's <code>Catalog/</code> folder. Books that already have a
          profile are left exactly as they are, so importing again is safe.
          Preview shows what would happen without writing anything.
        </p>
        <div className="path-form" style={{ marginTop: "0.6rem" }}>
          <input
            type="text"
            aria-label="CSV file"
            placeholder="/path/to/Library of Books.csv"
            value={csvPath}
            onChange={(e) => setCsvPath(e.currentTarget.value)}
          />
          <button onClick={pick} disabled={busy}>
            Choose CSV…
          </button>
        </div>
        <div className="import-actions">
          <button onClick={() => run(true)} disabled={busy || !csvPath.trim()}>
            Preview
          </button>
          <button
            className="import-run"
            onClick={() => run(false)}
            disabled={busy || !csvPath.trim()}
          >
            {busy ? "Working…" : "Import"}
          </button>
        </div>
        {error && (
          <p className="status" role="alert">
            {error}
          </p>
        )}
        {report && (
          <div className="import-report" role="status">
            <p className="import-summary">
              {report.dry_run ? "Preview: would create" : "Created"}{" "}
              {report.created.length}{" "}
              {report.created.length === 1 ? "profile" : "profiles"} ·{" "}
              {report.existing.length} already in the catalog ·{" "}
              {report.duplicates.length} duplicate rows ·{" "}
              {report.rejected.length} not imported
              {report.dry_run ? " · nothing was written" : ""}
            </p>
            <Listed
              label="Not imported"
              items={report.rejected}
              render={(r) => `Line ${r.line}: ${r.reason}`}
            />
            <Listed
              label="Kept unchanged, the sheet differs"
              items={changed}
              render={(e) => `Line ${e.line}: ${e.file} (${e.differs.join(", ")})`}
            />
            <Listed
              label="Duplicate rows skipped"
              items={report.duplicates}
              render={(d) => `Line ${d.line}: same book as line ${d.first_line}`}
            />
            <Listed
              label="Similar titles to review"
              items={report.near_duplicates}
              render={(n) => `Line ${n.line}: ${n.title} by ${n.author}, like ${n.similar_to}`}
            />
            <Listed
              label={report.dry_run ? "Would create" : "Created"}
              items={report.created}
              render={(c) => `Line ${c.line}: ${c.file}`}
            />
            <Listed
              label="Status"
              items={report.statuses}
              render={(s) => `${s.sheet || "(empty)"} → ${s.status}: ${s.rows}`}
            />
            {report.unreadable.length > 0 && (
              <p className="status">
                {report.unreadable.length} catalog files could not be read, so their
                books may be imported again: {report.unreadable.join(", ")}
              </p>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
