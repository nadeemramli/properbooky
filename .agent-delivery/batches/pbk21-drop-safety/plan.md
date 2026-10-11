# PBK-21 Drop safety repair: plan (committed before any code change)

## Dispatch, runtime and base

- Dispatch: coordinator, Direct PBK-21 v12. Live claim `codex-product-coordinator` is held locally; this cloud chat cannot reach Direct.
- Approval covers a bounded Drop safety repair only.
- Chat count: lifetime objective 2 of 2 (the review repair after the PR #27 design). This chat stops after the handoff.
- Runtime model, checked with `get_session` before any edit: configured_model, session_context.model and last_served_model are all `claude-opus-5-5`.
- Base: merged main `561881958b7552b62d7bf409789b1da892ca501c`.
  - Its tree is identical to `82c573a` (`git diff 82c573a 5618819` is empty), so every PR #27 probe finding applies unchanged.
- Branch: `claude/pbk-21-drop-safety`, new and created from that base. The draft PR targets `main`.
- PR #27 is left untouched: branch `claude/admiring-cannon-rzrojv`, design `.agent-delivery/batches/pbk21-acquisition-design/`.

## In scope: safety guards

PR #27 probe IDs are given in brackets.

| Guard | Defect today | Repair |
|---|---|---|
| G1 regular files only | A symlink in Drop is moved and linked to bytes outside the library [D9]. A dangling symlink aborts the batch after the move [D7]. | `symlink_metadata` must report a regular file. Symlinks, directories and other non-regular entries are left in Drop as `left-unsafe`. |
| G2 complete, non-empty content | A 0-byte `.epub` is filed [D5c]. A half-written `.pdf` is filed and its recorded hash goes stale [D5b]. | Content must be structurally complete before filing. A PDF needs `%PDF-` at the start and `%%EOF` in the last 1024 bytes. An EPUB needs a zip local header at the start and an end-of-central-directory record in the tail. Size and mtime must be identical before and after hashing. Otherwise the file is left in Drop as `left-incomplete`. The hash is re-checked after publication. |
| G3 confined paths | `process_drop` walks a linked `Catalog/` and follows a linked `Drop/` (both are followed today). The destination folder is not checked. | Refuse the run, before any file is touched, when `Drop`, `Catalog`, `Library` or `Library/00 Inbox` is a link or resolves outside the library. `Catalog` reuses `catalog_import::catalog_dir`. |
| G4 safe names | A leading-dot title becomes a hidden file the index skips [D8b]. A 311-byte name fails with ENAMETOOLONG and aborts the batch [D7b]. | Build the name with the existing `catalog_import::import_filename` rules: no leading dot or control characters, no reserved names, a 200-byte bound. They are identical to today's `Author - Title` for ordinary names. Keep the dropped file's extension, lower-cased as today. |
| G5 no-clobber publication | An `exists()` check followed by `fs::rename` replaces any target created in between, on both Unix and Windows [D4 static]. | Publish with `hard_link(src, dst)`, which fails atomically if `dst` exists, then remove `src`. If hard links fail for a reason other than "exists", copy to a hidden temp file in the destination, `persist_noclobber`, verify the hash, then remove `src`. An existing target leaves the file in Drop as `left-conflict`. |
| G6 per-file errors | Any I/O error returns `Err` for the whole batch. The report is lost and later files are not processed [D7, D7b]. | Each file is handled in isolation and an error becomes that file's outcome (`error` plus a reason). The run always returns a report. The batch is refused only for G3. |
| G7 crash and retry recovery | A crash or failed catalog write after the move leaves the file in Inbox unlinked. The original name is recorded nowhere and no later run recovers it [D7c]. | Before publishing, write an intent record with `atomic_write` to `.properbooky/acquisition/drop/<uuid>.json`. It holds source, target, catalog entry, hash and original name. Delete it only after the catalog entry is written. Every run first replays pending records (see recovery rules below). A catalog write that fails keeps its record, and the outcome is `pending` with a reason. |
| G8 no double link | Two formats of one book in one run each link the same entry; the second overwrites the first link and orphans the first file. This follows from the code and is reproduced red/green in this batch. | A profile that received a file earlier in this run, or that has a pending intent, is not linked again: `left-conflict` with a reason. The catalog entry is re-read before writing, and an entry that already has a `file` is never overwritten. |

**Recovery rules (roll forward)**

| On-disk state | Action |
|---|---|
| Target has the recorded hash and the entry is unlinked | Remove the source if it is a leftover hard link with the same hash, write the catalog entry, delete the record. Outcome `recovered`. |
| Entry already linked to this target | Delete the record. |
| Source still in Drop, nothing published | Delete the record; the file is processed normally in the same run. |
| Entry now linked elsewhere, or entry gone | Move the target back to `Drop/<original name>` (no-clobber). Outcome `returned`. |
| Anything else: target hash differs, both files missing, or the record is unreadable or escapes the library | Touch nothing, keep the record. Outcome `error` with a reason, reported on every run until resolved. |

Every recovery path is validated with `identity::safe_join`.

**UI:** the Acquire panel's report lists every non-filed outcome with its reason, not only filed ones. Today it shows only filed titles, so per-file errors and left-unsafe/incomplete files are invisible.

## Out of scope: unapproved policy, unchanged

These stay exactly as they are; the matcher, scanner and lib.rs commands are not modified:

- ranking and queue order (`QUEUE_SQL` and the `acquisition_queue` command);
- the destination folder (`Library/00 Inbox`), not a category folder;
- matcher scores, thresholds and the candidate set: any profile without `file:`, regardless of status or queue. So D3, D3b, D14 and M1 stay as they are;
- search target, day rollover and N;
- no background watcher (the explicit "Process Drop folder" button stays the only trigger);
- unsupported formats in Drop, which are not reported [D13];
- no Catalog field, SQLite schema, Tauri capability or permission change.

New outcome strings and an optional `reason` field are added to the existing serialized report (an additive JSON change).

## Verification plan

1. **Red first.** Write the new Rust tests (`tests/acquire_safety_test.rs`) against the unchanged code and record the failures.
   - Crash tests need a step hook that does not exist yet; their "red" is the PR #27 probe D7c and a compile failure, recorded as such.
2. **Green.** Implement in `acquire.rs` (plus a minimal `AcquirePanel.tsx` change). The same tests then pass.
   - Crash points are exercised through a `#[doc(hidden)] pub fn process_drop_observed(conn, root, &dyn Fn(Step))`. `process_drop` is the same function with a no-op observer.
   - Tests panic at each step (after intent, after link, after publish, after catalog write), then restart: new connection, rerun, rescan.
3. **Existing suites.** Run `cargo test` (all), `npx tsc --noEmit -p .` in `desktop/`, and `npm run fixtures:check`.
   - `acquire_test`'s Drop fixture `%PDF-1.4 x` is not a complete PDF under G2. It gets a `%%EOF` trailer; the assertions are unchanged.
4. **Packaged E2E** (`e2e-desktop/acquisition.e2e.mjs`, Linux, a new CI step in `desktop-e2e`). It uses the built debug `.deb` binary with fresh app-data and a temp copy of the synthetic fixture library plus synthetic catalog entries, copying fixture EPUB/PDF bytes into Drop under download-style names.
   - Clicking **Process Drop folder** in the real UI files the confident match. The test checks the file on disk, the catalog frontmatter (`file`, `hash`, `original_filename`, `status: available`) and the card availability after the rescan. The symlink, empty, truncated and colliding files stay byte-identical in Drop, and the panel names each one with its reason.
   - **Restart:** close and relaunch, then check the state survives (card still available, Drop unchanged).
   - **Failure, then restart and retry:** make `Catalog/` read-only (a real write failure; CI runs as non-root) and process. The file is published, the outcome is `pending` with a reason, and the intent record exists. Restore permissions, restart the app and process again: the outcome is `recovered`, the entry is linked, the original name is recorded and the record is gone.
   - **Retry idempotency:** a third Process files nothing and changes nothing on disk.
5. Record the exact tested head, commands and exit codes, then CI on the final head.

## Windows gaps (left for coordinator-local verification)

- `hard_link` on NTFS, and the copy fallback on FAT/exFAT or cross-volume Drop.
- Deleting a source the browser still holds open (sharing violation, which leaves both names; the next run's recovery finishes it).
- Reserved names, junctions as links, and the installed-app walkthrough.

## Rollback

All changes are confined to `acquire.rs`, `AcquirePanel.tsx`, the new tests, the E2E journey and one CI step. Reverting the PR restores today's behaviour. Older builds ignore the intent records, which live under `.properbooky/` and are skipped by the index.
