# Desktop library identities and corrections

The desktop index is disposable. Schema 10 stores stable IDs and profile redirects but reconstructs them from files inside the configured library. Upgrading the index preserves application settings, including the library folder. The first list request rebuilds an empty index.

## Persisted files

- `.properbooky/identities.json`: version 1 registry of profile and asset UUIDs, relative paths, previous paths, SHA-256 fingerprints and reading-state filenames.
- `.properbooky/identities.previous.json`: previous registry version, replaced only when the registry changes.
- `.properbooky/curation.json`: version 2 metadata/status overrides keyed by stable ID, search aliases, source-to-primary profile redirects and correction/combination history for undo. Version 1 remains readable; the next change writes version 2 so older clients cannot silently discard grouping information.
- `.properbooky/curation.previous.json`: the previous correction file, saved before replacement.
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

Wishlist means wanted without a local file. On the shelf means any attached local file exists, including books being read or already finished. Documents filters the document content types. Raw files linked by a profile are hidden using asset ID, including links imported with Windows separators. A raw profile explicitly participating in a combination remains available to that grouping.

## Profile consolidation

User-confirmed combinations persist redirects between stable profile IDs. They do not rewrite or delete Catalog sources, assets, positions or highlights. The primary profile keeps the explicitly selected title/author/topics/content type/reading state/intent; its year and rating remain on the card. Other values are exposed in source profiles, including recommendations, ratings, years, topics and reading-state labels. Original notes/frontmatter can be loaded on demand (a bounded 100 KB preview).

`list_books` returns the primary profile with `assets` and `source_profiles`. Attached assets are deduplicated by asset ID, never by hash. Each copy keeps its own reading sidecar. The first accessible supported asset is the default reader target; multiple files have individual reader buttons. A later download linked to a retained source joins the same visible work on rescan. Search indexes remain source-specific; desktop and MCP map matching source titles to the visible primary.

The correction journal stores the previous redirect map and primary editable-field snapshot as one operation. Undo reverses the latest correction or combination, including chained combinations. Redirect cycles fail validation. If the primary source disappears externally, surviving sources become visible with a cleanup issue instead of disappearing with it. SQLite mirrors flattened redirects in `merged_into`; updates use a savepoint so readers do not observe partially applied grouping.

Author filters group case/spacing variants of the imported contributor string. They do not guess whether `Family, Given` is a list of people. Topic filters also group terminal-period and hyphen/space variants, while keeping original labels in source metadata. These are browsing keys, not author authority records or automatic changes to the source taxonomy.

## Failure behavior and recovery

Scanning replaces rows in a SQLite transaction. An invalid registry, invalid correction file, missing library root or traversal error aborts the scan and retains the prior index. JSON updates write and sync a temporary file before replacing the destination. The registry is saved before committing the index, allowing a rescan to reuse IDs after a failed database commit. Corrections are saved before updating the index and replayed when listing or scanning.

Malformed or newer registry/curation versions fail visibly rather than silently resetting identity. Restore a known-good backup of the library metadata before rescanning. Do not delete the registry as a repair step: corrections and reading-state pointers depend on it. Undo restores the previous correction/combination without touching source files or asset bytes. It cannot undo external physical file moves or deletions.

The MCP server reads corrected indexed metadata and resolves sidecars through the registry, with compatibility for older indexes. It exposes retained sources and all attached formats, and redirects searches for combined source titles. Obsidian export also resolves asset moves and corrected primary names; when names collide, stable state-derived suffixes preserve separate exports rather than overwriting another asset's highlights. Previously exported notes are not deleted automatically. MCP FTS search does not yet include the correction alias history used by desktop search.

## Current boundary

Each imported profile still has one current file link, while a consolidated visible work can contain several source profiles and assets. Edition evidence remains on source profiles rather than a separate verified edition authority. Candidate review groups shared assets, byte-identical assets, and similar main-title/author pairs; grouping is always an explicit previewed action. Physical file deletion, author authorities, controlled taxonomy editing, automated enrichment and ordered roadmaps remain outside this implementation. Old state from a missing unlinked asset stays on disk even though the missing raw file has no card.

## Verification

Run `cargo test` in `desktop/src-tauri` and `npm run build` in `desktop`.

For the isolated Linux Tauri/WebKit correction flow, build the debug binary and example with `cargo build --bin desktop --example seed_index`, serve `desktop/dist` on localhost:1420, and run `xvfb-run -a npm run test:e2e:review` from `desktop`. Set `TAURI_BINARY` when using a custom Cargo target directory. The test creates a temporary library and XDG app-data directory, prints its artifact location, and leaves the fixtures/screenshots for inspection. It verifies independent states, correction and combination previews, source-note inspection, author/topic filters, search aliases, rescan persistence, later file attachment, multi-format controls, undo, unchanged source Markdown and article-reader navigation. Run `npm test` in `mcp` for compatibility across index schemas 8–10.

The optional Rust preservation test accepts `PB_MERGE_PILOT` pointing to an isolated representative copy. It requires `.properbooky/pilot-only`, combines up to three shared-file pairs, rebuilds the index, undoes those combinations, and verifies every source/state hash. Never point this test at the live collection.
