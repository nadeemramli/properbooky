# ProperBooky Desktop

Local-first desktop app (Tauri 2 + Vite + React TS + Rust). The library folder
(EPUB/PDF/Markdown files) is the source of truth; the app keeps a rebuildable
SQLite index (FTS5) in the OS app-data directory.

## Develop

```bash
npm install
npm run tauri dev    # opens the app (WSLg window under WSL)
```

Linux/WSL build deps: `libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev libssl-dev pkg-config`.

## Layout

- `src/` — React frontend (library grid, search)
- `src-tauri/src/lib.rs` — Tauri commands (`scan_library`, `list_books`, `get_library_state`)
- `src-tauri/src/scanner.rs` — folder walk + metadata extraction
- `src-tauri/src/db.rs` — SQLite schema (books + FTS5 + settings)

Windows installers are built by CI, not locally (see repo AGENTS.md).
