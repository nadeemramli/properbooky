import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Sidecar } from "../types";

/** A stored fraction is only trusted when it is a real 0..1 value. */
export function validPercent(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}

/** Arrow keys turn pages unless they belong to a field or the tab rail. */
export function pageTurn(e: KeyboardEvent): "next" | "prev" | null {
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return null;
  const target = e.target;
  if (
    target instanceof Element &&
    target.closest('input, textarea, select, [contenteditable="true"], [role="tablist"]')
  )
    return null;
  if (e.key === "ArrowRight") return "next";
  if (e.key === "ArrowLeft") return "prev";
  return null;
}

/**
 * Reading state lives in the library's sidecar files. A sidecar that cannot be
 * read still opens the book (from the start) with a visible notice, and a save
 * that fails is reported until a later save succeeds — never swallowed.
 */
export function useReadingState(path: string) {
  const [loadNotice, setLoadNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<Sidecar> => {
    try {
      const sidecar = await invoke<Sidecar>("get_sidecar", { path });
      setLoadNotice(sidecar.notice ?? null);
      return sidecar;
    } catch (e) {
      setLoadNotice(`Saved reading position could not be loaded: ${String(e)}`);
      return { position: null, percent: null, updated_at: 0, highlights: [] };
    }
  }, [path]);

  const save = useCallback(
    (position: string, percent: number | null) =>
      invoke("save_progress", { path, position, percent }).then(
        () => setSaveError(null),
        (e) => setSaveError(`Reading position is not being saved: ${String(e)}`),
      ),
    [path],
  );

  const notices = [loadNotice, saveError].filter((n): n is string => Boolean(n));
  return { load, save, notices };
}
