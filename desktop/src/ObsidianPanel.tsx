import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

interface ExportReport {
  books: number;
  highlights: number;
  target: string;
}

export default function ObsidianPanel({ onClose }: { onClose: () => void }) {
  const [vault, setVault] = useState<string>("");
  const [report, setReport] = useState<ExportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    invoke<{ obsidian_vault_path: string | null }>("get_app_settings")
      .then((s) => setVault(s.obsidian_vault_path ?? ""))
      .catch(() => {});
  }, []);

  const saveVault = useCallback(async (path: string) => {
    setVault(path);
    await invoke("set_obsidian_vault", { path }).catch((e) =>
      setStatus(String(e))
    );
  }, []);

  const pickVault = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") await saveVault(selected);
  }, [saveVault]);

  const sync = useCallback(async () => {
    setBusy(true);
    setStatus(null);
    try {
      if (vault.trim()) await invoke("set_obsidian_vault", { path: vault.trim() });
      setReport(await invoke<ExportReport>("sync_obsidian"));
    } catch (e) {
      setStatus(String(e));
    } finally {
      setBusy(false);
    }
  }, [vault]);

  return (
    <aside className="acquire-panel" aria-label="Obsidian sync">
      <header className="highlights-panel-head">
        <h3>Obsidian sync</h3>
        <button className="panel-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>
      <div className="acquire-drop">
        <p className="acquire-hint">
          Highlights export as one note per book into{" "}
          <code>&lt;vault&gt;/Properbooky/</code>. That folder is regenerated on
          every sync — keep your own notes outside it and link to the{" "}
          <code>^pb-…</code> block ids.
        </p>
        <div className="path-form" style={{ marginTop: "0.6rem" }}>
          <input
            type="text"
            placeholder="/mnt/c/Users/Nadeem/Desktop/Obsidian/…"
            value={vault}
            onChange={(e) => setVault(e.currentTarget.value)}
          />
          <button onClick={pickVault} disabled={busy}>
            Pick folder
          </button>
        </div>
        <div style={{ marginTop: "0.6rem" }}>
          <button onClick={sync} disabled={busy || !vault.trim()}>
            {busy ? "Syncing…" : "Sync highlights now"}
          </button>
        </div>
        {report && (
          <p className="acquire-report">
            Exported {report.highlights} highlights across {report.books}{" "}
            {report.books === 1 ? "note" : "notes"}.
          </p>
        )}
        {status && <p className="status">{status}</p>}
      </div>
    </aside>
  );
}
