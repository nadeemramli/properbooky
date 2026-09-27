# Desktop library identities and corrections

The desktop index is disposable. Schema 9 stores stable IDs but reconstructs them from files inside the configured library. Upgrading the index preserves application settings, including the library folder. The first list request rebuilds an empty index.

## Persisted files

- `.properbooky/identities.json`: version 1 registry of profile and asset UUIDs, relative paths, previous paths, SHA-256 fingerprints and reading-state filenames.
- `.properbooky/identities.previous.json`: previous registry version, replaced only when the registry changes.
- `.properbooky/curation.json`: version 1 metadata/status overrides keyed by stable ID, search aliases and correction history for undo.
- `.properbooky/state/*.json`: existing positions and highlights. Existing sidecars stay in place; the registry records their filenames. New assets use `asset-<uuid>.json`.

Keep the entire `.properbooky` directory when moving or backing up a library. Imported Catalog Markdown, bodies, ebook bytes and filenames are not rewritten by the review UI. The existing acquisition workflow still files downloads and updates their Catalog links.

## Resolution and precedence

Scans import Catalog frontmatter and embedded metadata, then apply user corrections. Corrections override the editable field set (title, author, topics, content type, reading status, reading intent and up-next) as a complete snapshot. Later edits to those imported fields do not supersede a saved correction. Unknown frontmatter fields survive acquisition rendering.

The registry uses relative paths, so moving the whole library preserves identity. A unique missing source plus a unique new file with matching bytes is treated as a rename. Ambiguous moves retain separate identities and preserve old sidecars; they require investigation. A file replaced with different bytes gets a new asset ID so old anchors cannot attach to another edition. Catalog metadata edits retain profile IDs. A catalog renamed and edited externally at the same time cannot reliably be recognized.

Hashes are reused when size and modification time are unchanged. Tools that alter bytes while preserving both can defeat change detection. Symlinked files/directories are not followed by the scanner.

Reading state is independent of availability:

| Field | Values / meaning |
| --- | --- |
| availability | `local`, `missing`, `none`; computed from a linked file's existence |
| reading_status | `unread`, `reading`, `paused`, `finished`, `stopped` |
| want_to_read | Reading intention, retained after acquiring a file |
| up_next | Queue membership independent of file availability |
| content_type | `book`, `paper`, `report`, `manual`, `notes`, `article`, `other`, `unidentified` |
| format | PDF/EPUB/etc.; describes the linked asset, not acquisition status |

Wishlist means wanted without a local file. On the shelf means a local file exists, including books being read or already finished. Documents filters the document content types. Raw files linked by a profile are hidden using asset ID, including links imported with Windows separators. Distinct profiles remain distinct until an explicit merge feature is implemented.

## Failure behavior and recovery

Scanning replaces rows in a SQLite transaction. An invalid registry, invalid correction file, missing library root or traversal error aborts the scan and retains the prior index. JSON updates write and sync a temporary file before replacing the destination. The registry is saved before committing the index, allowing a rescan to reuse IDs after a failed database commit. Corrections are saved before updating the index and replayed when listing or scanning.

Malformed or newer registry/curation versions fail visibly rather than silently resetting identity. Restore a known-good backup of the library metadata before rescanning. Do not delete the registry as a repair step: corrections and reading-state pointers depend on it. Undo restores the previous editable-field snapshot without touching source files or asset bytes. It is a correction undo, not an asset migration/merge undo.

The MCP server reads corrected indexed metadata and resolves sidecars through the registry, with compatibility for older indexes. Obsidian export also resolves asset moves and corrected profile names. MCP FTS search does not yet include the correction alias history used by desktop search.

## Current boundary

This is one profile with one current linked asset, not yet the full work/edition/multiple-format model. Candidate review groups shared assets, byte-identical assets, and similar main-title/author pairs. It never merges profiles or deletes files. Author authorities, controlled topic taxonomy, automated enrichment, work merges and ordered roadmaps are subsequent features. Old state from a missing unlinked asset stays on disk even though the missing raw file has no card.

## Verification

Run `cargo test` in `desktop/src-tauri` and `npm run build` in `desktop`.

For the isolated Linux Tauri/WebKit correction flow, build the debug binary and example with `cargo build --bin desktop --example seed_index`, serve `desktop/dist` on localhost:1420, and run `xvfb-run -a npm run test:e2e:review` from `desktop`. Set `TAURI_BINARY` when using a custom Cargo target directory. The test creates a temporary library and XDG app-data directory, prints its artifact location, and leaves the fixtures/screenshots for inspection. It verifies independent states, candidate comparison, preview/save, search aliases, rescan persistence, document filtering, undo, unchanged source Markdown and article-reader navigation.
