# ProperBooky Desktop

Local-first desktop app (Tauri 2 + Vite + React TS + Rust). Each library folder
(EPUB/PDF/Markdown files) is the source of truth; the app keeps a rebuildable
SQLite index (FTS5) per library in the OS app-data directory.

## Libraries and app-data (PBK-15)

- `settings.json` — the known libraries (name, chosen path, Obsidian folder),
  the open one, and tombstones for removed entries; written atomically with
  `settings.previous.json` as the previous copy. An unreadable list is moved
  aside (`settings.json.unreadable-<time>`), never overwritten.
- `libraries/<id>/library.db` — that library's disposable index; set aside and
  rebuilt from the folder if unreadable.
- Inside each library folder, `.properbooky/` keeps identities, reading state,
  highlights and corrections. Removing a library from the list never touches
  its folder; re-adding the folder restores the same entry.
- `library.db` — the single-library settings/index of builds before PBK-15.
  It is imported once (from a copy) and left unchanged, so the previous build
  still works if you roll back.

Every library-scoped command carries the id of the library it was issued for
and is refused unless that library is open and its folder readable.

## Develop

```bash
npm install
npm run tauri dev    # opens the app (WSLg window under WSL)
```

Linux/WSL build deps: `libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev libssl-dev pkg-config`.

## Layout

- `src/` — React frontend (library grid, search)
- `src-tauri/src/lib.rs` — Tauri commands (library list, `scan_library`, `list_books`, reading state, export)
- `src-tauri/src/libraries.rs` — known-library list, recovery and the pre-PBK-15 import
- `src-tauri/src/scanner.rs` — folder walk + metadata extraction
- `src-tauri/src/db.rs` — SQLite schema (books + FTS5 + settings)

Windows installers are built by CI, not locally (see repo AGENTS.md).
