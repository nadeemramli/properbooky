# PBK-15 multiple libraries — plan (written before code edits)

Dispatch: `pbk15-libraries-20261004-queue` (coordinator claim codex-product-coordinator, Direct PBK-15 Doing v8).
Base: `44e96b67d05213b53185d97d740f7d392e0c0c3f` (main after PR #19). Branch: `claude/sweet-turing-shme1z`
(session-designated branch; the PR title carries the PBK-15 key). Worker: cloud Claude Code, runtime model
`claude-opus-5-5` (get_session), lifetime objective 1 of cap 3, sole Properbooky implementation writer.

## What exists today (inspected at base)

| Concern | Where | Fact |
|---|---|---|
| Settings | `app_data/library.db` table `settings` | keys `library_path`, `obsidian_vault_path`; one library only |
| Index | same `library.db` (`books`, `chunks`, FTS) | disposable; `scan_library` does `DELETE FROM books` and rebuilds from the folder |
| Reading state | `<library>/.properbooky/state/*.json` | UUID highlights, LWW `updated_at`, tombstones (`deleted`) |
| Identity | `<library>/.properbooky/identities.json` (+ `.previous`) | UUIDs per asset; copied folders carry the same UUIDs |
| Curation / undo | `<library>/.properbooky/curation.json` | in-folder; index re-applies it on every scan |
| Picker | `@tauri-apps/plugin-dialog` `open({directory:true})` (Rust plugin, `dialog:default`) | renderer receives the path, passes it to `scan_library(path)` |
| Paste path | first-run `.path-form` | renderer-typed path, used by every packaged E2E suite |
| Library lock | global static `LIBRARY_LOCK` | serialises every library command |
| Export | `sync_obsidian` → `<vault>/Properbooky/` | one global vault; PR #20 keys notes by library-relative `source:` |
| MCP | `mcp/server.mjs` | reads `app_data/library.db` + its `library_path` |
| Asset protocol | `tauri.conf.json` `assetProtocol.scope: ["**"]` | already unrestricted (pre-existing; not widened, reported) |

Everything except the app-data index is already files-as-truth inside the library folder, so isolation of
progress/highlights/curation follows from isolating *which folder* a command resolves, and the index is safe
to rebuild.

## Design (chosen with evidence)

- **Registry in settings**: `app_data/settings.json` `{version:1, active, libraries:[{id, name, path, canonical,
  obsidian_vault_path, added_at, removed_at?, migrated_from?}]}`, atomic write with `settings.previous.json`
  backup (same convention as `identities.json`). Removed entries become tombstones (hidden; folder untouched),
  so re-adding the same canonical folder revives the same id, name, export setting and index.
- **Per-library index DB**: `app_data/libraries/<id>/library.db` (unchanged schema via `db::open`), with
  `settings.library_path` mirrored for the MCP server. Chosen over library-scoped rows because the books/chunks
  queries in `library.rs`, `acquire.rs`, `catalog`, MCP stay untouched; a stale scan of A physically cannot write
  B's rows; per-library counts are a plain `COUNT(*)`; and the migration needs no row rewrite.
- **Library-bound commands**: every library-scoped command takes `libraryId`; the backend accepts it only when
  it is the active, available library and resolves root + index from that id. Renderer book paths must sit inside
  that root (existing `identity::relative`), and a missing/inaccessible root is refused before any write so
  `create_dir_all` can never recreate `.properbooky` at a vanished path. `set_catalog_status` gains the same
  root check (today it accepts any path).
- **Per-library locks** replace the single global lock, so switching never waits for another library's scan.
- **Renderer lifecycle**: the whole workspace (Library view + reader tabs + panels) is keyed by library id.
  Switching unmounts it, waits for its tracked in-flight writes to settle (they still target the old library,
  which is active until the switch), then switches. Late results from the old workspace land in unmounted
  components; late writes carry the old id and are refused.
- **Export isolation**: export target stays `<vault>/Properbooky/` (legacy links unchanged), the vault setting is
  per library, and export refuses a target already configured for, or marked (`.properbooky-library`) by, another
  registered library. No change to `export.rs` (PR #20 rewrites it).
- **Overlap**: a folder inside, or containing, another listed library is refused with an explanation (otherwise
  A's index would contain B's books and B's book paths would pass A's boundary check).
- **Migration**: on first start without `settings.json`, read the legacy `library.db` read-only; register its
  `library_path` (+ vault) as the active library; never modify or delete `library.db`. Rollback = run the previous
  build: it reads the untouched `library.db`; reading state/highlights live in the folders and are shared.
  Unreadable legacy settings: empty registry + visible notice, legacy file kept.
- **Recovery**: corrupt `settings.json` is moved aside (`.unreadable-<ts>`) and `settings.previous.json` restored
  if valid, else empty registry, each with a visible notice. Corrupt index DB is moved aside and rebuilt from the
  folder with a notice. Unwritable settings: the action fails visibly, registry unchanged on disk and in memory.

## Criterion → evidence map

Platform for all E2E: Linux packaged debug .deb under Xvfb/tauri-driver, fresh temp XDG dirs, synthetic fixtures.
Evidence: `desktop-e2e-artifacts/libraries/report.json` (+ screenshots) locally and in CI.

| # | Criterion | Entry point / fixture | Action | Expected visible | Persistence | Failure / recovery |
|---|---|---|---|---|---|---|
| 1a | Launcher shows name, path, actual indexed count | Libraries dialog from tab rail; libraries A (fixture library + catalog) and B (copy of A with colliding relative paths, copied `identities.json` UUIDs, one different-content same-name file, one extra book) | open A (first-run form), open B (launcher) | rows show folder names, full paths, counts = files indexed by each scan | `settings.json` has both; each `libraries/<id>/library.db` count | count for a never-indexed library says "not indexed yet" |
| 1b | Open folder as library adds/selects; no duplicate for same canonical folder | native GTK picker driven with xdotool; paste path | pick B; re-open A via `A/` and via a symlink to A | A selected, still 2 rows | registry length 2 | canceled picker (Escape) changes nothing |
| 1c | Location never predetermined | fresh app-data | first run | no default path; only user-chosen folders listed | — | — |
| 2a | Rename | launcher row, keyboard only | rename B → "Archive shelf" | new name in rail + list | survives restart | empty name refused |
| 2b | Remove registry entry, never data | launcher row | remove B (confirmation text explains) | B gone from list | B tree hashes identical (books, `.properbooky`, sidecars, notes), `libraries/<id>/` kept | removing the active library opens nothing else |
| 2c | Re-add with data preserved | paste B again | | same name, progress % and highlights shown | same id revived | — |
| 3a | Index/search/details isolation | colliding fixtures | search in A and B; Review details | each library shows only its own titles/metadata | separate index files | — |
| 3b | Reader tabs / progress / highlights isolation | same relative EPUB/PDF in A and B | read A's PDF to page 3, add highlight; switch to B | B's copy "not started", no A highlight; tabs reset | A sidecar page 3 + highlight; B sidecar absent/unchanged | — |
| 3c | Stale async + dirty reader state | local slow HTTP server; IPC with old id | start Save URL in A, switch to B before reply; send A-bound write after switch | B unaffected; no article in A or B | trees unchanged | old-id write refused with "library is not open" |
| 3d | Export isolation | two vault folders + shared vault | export A; set B to A's vault; export B; set B own vault | B refused with explanation; A notes byte-identical | marker file | — |
| 3e | Files-as-truth / UUID / LWW / tombstones preserved | existing Rust tests + E2E sidecar reads | remove highlight in A | tombstone in A sidecar only | — | — |
| 3f | Migrate single-library settings safely | (i) Rust tests on temp dirs; (ii) CI: legacy `library.db` seeded by `examples/seed_index` (base writer); (iii) local: real base build `44e96b6` packaged, run, then new build on a *copy* of its app-data, then base build again on the copy | | library listed and active, progress intact, vault kept | `library.db` sha256 unchanged; rollback run reads it | corrupt legacy db → notice, file kept |
| 4a | Restart restores registry + active | same app-data, relaunch | | same active library, names, counts | — | — |
| 4b | Missing/moved | rename A's folder on disk, relaunch | | "Folder not found" with path; nothing else opened; Locate/Check again/Remove | nothing created at old path; B untouched | Locate → moved folder, data intact |
| 4c | Inaccessible | chmod 000 folder (app run without DAC override) | | "can't be read" state | no writes | Check again after chmod restore |
| 4d | Empty folder | empty dir | open | "no books found" message, count 0 | | |
| 4e | Corrupt/unwritable settings & index | garbage `settings.json` (with/without backup), read-only settings dir, garbage index db | relaunch / rename | visible notices; registry restored from backup; index rebuilt | quarantined files kept | rename on unwritable settings fails visibly, unchanged |
| 4f | Renderer paths beyond boundary | IPC | `get_sidecar`/`save_progress`/`set_catalog_status` with a path outside the active root; unknown/removed library id | refused | no file created | — |
| 5 | Packaged E2E + regressions + CI | `npm run test:e2e:libraries` + existing packaged/reading/failures suites + Rust/TS checks + `cargo test` + `tsc` + build | | all exit 0 | | injected faults still exit nonzero |

## Non-goals

Catalog/file matching (PBK-20/21), cloud auth/sync/AI, deletion of libraries or files, narrowing the asset
protocol scope (reported instead), Windows native checks (coordinator-owned, deferred), PR #20 export changes.

## Rollback

Revert the PR. Data: previous build ignores `settings.json`/`libraries/` and reads the untouched legacy
`library.db`; per-folder reading state is format-compatible in both directions.
