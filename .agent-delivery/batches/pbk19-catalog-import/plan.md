# PBK-19 catalog CSV import — plan (written before implementation)

Dispatch: coordinator, Direct PBK-19 Doing v7 (coordinator claim `codex-product-coordinator`). New chat, objective 1 of cap 3
(no review feedback yet). Runtime model verified with `get_session`: configured `claude-opus-5-5`, `session_context.model`
`claude-opus-5-5`, `last_served_model` `claude-opus-5-5`.

Base: `94faa40b50104380bc942dad3b45fc50c7601673` (PR #23 head, `claude/sharp-archimedes-s3rdeu`, successful CI). This branch
(`claude/gallant-darwin-bbt4jb`) is explicitly stacked on it, so it carries the unmerged PR #20/#21/#22/#23 ancestry. Those
branches stay unchanged: no merge, no force push, and main is not assumed to contain them.

## What exists (read before changing anything)

- `src/catalog.rs`: `CatalogEntry` frontmatter, `parse`/`render`, `entry_filename` ("Author - Title.md", 120 chars),
  `normalize_key` (lowercased alphanumeric tokens: **drops all punctuation**).
- `examples/import_catalog.rs` (dev-only CLI, not in the packaged app): CSV columns Book Title, Author, Date Releases, Types,
  Topic Category, Recommendation, Rating, Status, Date Input, Latticework. It dedupes in-run with `normalize_key`, detects
  "existing" only by the generated filename, and never overwrites.
- `scanner.rs` indexes `.md` with catalog frontmatter as `kind=catalog` (status, rating, topics as category) beside files.
  `library::list` searches title/author/topic. `library.rs` uses `normalize_key` (title before ':') for **duplicate
  candidates** in Library cleanup, where a person reviews them.
- UI history: PBK-19 added status badges (6b9464c). 0740bce later replaced the card badge with file availability ("On the
  shelf"/"File missing"/"No local file"), so catalog status is no longer visible as a badge. There has never been a status
  or rating filter (only `★n`/"unrated" text). Shelf chips are reading shelves (want_to_read/up_next), not catalog status.
- Tests: `library_scan.rs` covers one catalog frontmatter; there are no importer tests.

## Gaps found (to fill)

| Gap | Observed in the existing importer/UI |
|---|---|
| G1 packaged path | import only via `cargo run --example`; nothing in the packaged app |
| G2 status mapping | substring match: "Not downloaded" -> available, "Don't need to read" -> queued |
| G3 identity | `normalize_key` drops punctuation: "C++ Primer"/"C Primer", "It"/"It!" merge silently (false merges); a second row is just counted as a dupe |
| G4 existing detection | by filename only: a different book whose sanitized name collides is skipped as "existing", silently |
| G5 rejected rows | a malformed CSV record aborts with `?` after earlier files were written (partial import, no row named); blank author imported; non-integer rating silently dropped; empty topics kept as `""` |
| G6 files | non-atomic `fs::write`; title starting with `.` gives a hidden file the scanner never indexes; 120 *chars* can exceed 255 *bytes* (Unicode); control characters/Windows reserved names not handled |
| G7 visible status | no catalog status badge (regressed by 0740bce); no status or rating filter |

## Identity convention (described before changing)

The existing `normalize_key` is incompatible with "avoid false merges" (it deletes punctuation and so merges distinct
titles). It stays unchanged for Library cleanup's duplicate *candidates*, which a person reviews and can undo. The frontend's
`authorKey` (trim, collapse whitespace, lowercase) is the compatible convention; the importer's identity key mirrors it in
Rust: title and author each trimmed, inner whitespace collapsed, Unicode-lowercased, joined with a separator that cannot
occur in either part. Punctuation, subtitles and name order are kept. Rows/files that match only under the old loose key are
reported as near-duplicates (not merged) so the owner can review them in Library cleanup.

`entry_filename` is also used by the Obsidian export (note names) and the matcher, so it is not changed. The importer's
filename starts from it (identical for ordinary titles, so files from the old importer are recognised by name too) and then
applies only extra safety: leading dots, control characters, Windows reserved names, trailing dots/spaces, a 200-byte bound,
and ` (2)`, ` (3)` … when the name is taken by a different entry.

## Design

- `src/catalog_import.rs` (library crate): parse the whole CSV first; file-level problems (unreadable, not UTF-8 header,
  missing `Book Title`/`Author` header) reject the import with nothing written. Row-level problems (field-count mismatch,
  invalid UTF-8, blank title, blank author, non-integer rating) are named with their CSV line and skipped.
- Existing entries = every `.md` under the catalog folder with catalog frontmatter. A row whose identity matches one is
  `existing` and the file is never touched (byte-for-byte), reported as `unchanged` or `kept (row differs)`.
- New files are written to a temporary file in the catalog folder and published with no-clobber
  (`tempfile::persist_noclobber`), so a file appears complete or not at all and is never overwritten. Leftover temp files of
  an interrupted run are removed on the next run. The destination must be a single plain file name inside the catalog folder;
  the app refuses a `Catalog` folder that is a symlink or resolves outside the library.
- Status mapping exact (case/whitespace-insensitive): `Downloaded` -> available, `Need to read now` -> queued, anything else
  or empty -> wishlist. The sheet's raw status is kept as `source_status` when present (no source information lost).
- Fields: title, author, `published` (Date Releases), `type`, `topics` (comma list, empties dropped), `recommendation`,
  `rating` (integer), `status`, `added` (Date Input), `source`; body = Latticework verbatim (outer whitespace trimmed only).
- Report: created / existing (unchanged, differs) / duplicate rows / near-duplicates / renamed for collision / rejected rows
  (line + reason) / status mapping counts per distinct raw value. Dry run computes the same report and writes nothing.
- CLI: `examples/import_catalog.rs` becomes a thin wrapper (`[--dry-run] <csv> <catalog-dir>`), for the coordinator's local
  real-export reconciliation. App: `import_catalog` Tauri command (library-bound, under the library lock, catalog =
  `<library>/Catalog`), then a rescan. UI: "Import catalog" panel (path or native picker, Preview, Import, report).
- Library view: catalog status badge on catalog cards (Wishlist / Queued / Available / Reading / Done) beside the existing
  availability badge; Status and Rating facets (with counts, plus "Unrated") in the browse filters.

## Criteria -> evidence

| # | Criterion | Executable check |
|---|---|---|
| C1 | CSV -> `Catalog/*.md`, one per unique normalized title+author, all YAML valid | `tests/catalog_import_test.rs` on a representative synthetic CSV: file count == unique identities; every file re-parsed with `serde_yaml` and `catalog::parse`; packaged journey asserts the same on disk |
| C2 | title, author, date, type, topics, recommendation, rating, status match the row; Latticework body complete | per-row roundtrip equality incl. multiline/quoted/Unicode/`---`/YAML-special values, missing optionals |
| C3 | Downloaded -> available, Need to read now -> queued, other/empty -> wishlist | table test incl. near-miss values ("Not downloaded", "Need to read") -> wishlist |
| C4 | normalized duplicate detection; second import creates nothing, existing files unchanged | same-run duplicates (case/space variants) -> one file; rerun: 0 created, bytes + mtime unchanged; rerun with changed rows -> kept, reported; journey repeats import after restart |
| C5 | rescan indexes catalog with files; status/rating filters, title/author search, correct status badges | Rust: scan + `library::list` (kinds, status, rating, search); packaged journey: UI import -> rescan -> Status/Rating facets with counts, search by title and by author, badge text per card, restart persistence |
| S1 | rejected input: no partial or destructive write | missing header / unreadable / directory input -> error, catalog byte-identical; malformed rows named and skipped while valid rows import; interrupted run (injected fault) leaves no partial file and the rerun completes without duplicates |
| S2 | filenames collision-safe and confined | sanitized-name collision -> ` (2)`, traversal/leading-dot/reserved/long Unicode names stay one plain file in `Catalog/`; symlinked `Catalog` refused by the app |
| S3 | cross-library boundary | journey: import bound to library A writes only A; B's files and list unchanged; call bound to the non-open library refused |
| S4 | deliberate covered break fails | negative control: reintroduce substring status mapping and loose-key merging -> unit tests and the packaged journey fail; restored -> pass |
| S5 | no regression | `cargo test`, `tsc`, `fixtures:check`, `mcp` tests, existing packaged journeys (smoke x2, reading, highlights, libraries, upgrade, injected failures) on the same tested build; exact-head CI |

Local pending (not claimed here): the owner's real export (~1700 rows/files) reconciliation, Windows install, owner
acceptance. Cloud checks use synthetic CSVs only; no real-export compatibility or count is asserted.

Non-goals: bulk rename/adopt of library files, matching/linking files, enrichment, AI, sync, changing `entry_filename` or
Library cleanup's duplicate grouping, Agent Pass, Direct writes.
