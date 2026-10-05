# PBK-21 acquisition queue and Drop loop: bounded design and synthetic gap reproduction

This is a design and probe batch. No product code, schema, Tauri capabilities or CI changed. The coordinator adjudicates the
decisions in section 5 and then dispatches implementation (section 6). This is not an Agent Pass, a Windows result or human
acceptance.

- Dispatch: coordinator, Direct PBK-21 Doing (live claim actor `codex-product-coordinator`, held locally; this cloud chat
  cannot reach Direct). New chat, lifetime objective 1 of cap 3 (cap 2 if review feedback arrives).
- Runtime model: `get_session` at start reported configured_model, session_context.model and last_served_model all
  `claude-opus-5-5`.
- Base: `82c573a26ce2c9a5e79a2f2ce3c176e3f9a06411`. This is the integrated PR #24 head, i.e. branch
  `claude/gallant-darwin-bbt4jb` after PR #26 merged into it. It is not main.
- Branch: `claude/admiring-cannon-rzrojv` (this session's designated branch), fast-forwarded from main 44e96b6 to the base.
  Draft PR targets `claude/gallant-darwin-bbt4jb`. No other branch was touched.
- Probe tested against product code at the base. The batch only adds files under `.agent-delivery/`.

## 1. Sources read

| Source | What it settles |
|---|---|
| `desktop/src-tauri/src/acquire.rs` (`QUEUE_SQL`, `set_status`, `process_drop`) | The Drop implementation. It also holds a SQL queue that the shipped command does not use. |
| `desktop/src-tauri/src/lib.rs` 621-671 `acquisition_queue`, 729-743 `process_drop` command | The queue the UI actually shows (Rust over `library::list`), and the command shape: scan, then process, then scan. |
| `desktop/src-tauri/src/matcher.rs` | Confidence rule. Auto when score ≥ 0.85 with a margin ≥ 0.12, or when the title is fully covered with ≥ 4 tokens and a margin ≥ 0.10. Review when score ≥ 0.5. The proposed name comes from `catalog::entry_filename` plus the lower-cased extension. |
| `desktop/src/AcquirePanel.tsx` | `QUEUE_SIZE = 10`. "Search & queue" opens `https://z-library.sk/s/<title author>` and sets `up_next` through `update_book`. "Process Drop folder" is a manual button. |
| `desktop/src-tauri/src/scanner.rs`, `identity.rs`, `library.rs` | The index converges on disk state. The registry keeps an asset id across a unique move by hash. Profile `availability` is computed. `up_next`/`want_to_read` edits live in `.properbooky/curation.json`. |
| `desktop/src-tauri/src/catalog_import.rs` | Statuses: "need to read now" → `queued`, "downloaded" → `available`, everything else → `wishlist`. "Topic Category" → `topics` (comma list). `import_filename` already does the safe naming that Drop lacks. |
| `docs/library-identities.md` | Already decided: `up_next` is "queue membership independent of file availability", `want_to_read` is kept after acquiring, and "the existing acquisition workflow still files downloads and updates their Catalog links". |
| Git history | `731e8a4`/`d75afd6`/`0728cac`/`cc26925` (2026-07-13, PBK-21): original queue ordering was queued > recommended > rating. Arrivals go to `Library/00 Inbox` on purpose ("the user sorts them into their own taxonomy, and relink-by-hash follows the move"). The z-library search was added then. `be6e895`/`4c9da63` (PBK-29): the v2 weighted score replaced that ordering. `0740bce` (2026-09-27): "queued" moved from markdown `status` to the `up_next` flag. `676498a`: the command stopped using `QUEUE_SQL`. |
| `.agent-delivery/current-release.txt` | PBK-21, PBK-28 and PBK-29 briefs. PBK-29 records the deterministic score `0.35 lindy + 0.25 rec + 0.25 rating + 0.15 spectrum`, with queued pinned first. |
| Tests | `tests/acquire_test.rs` (3) and `tests/matcher_test.rs` (5) pass at the base. No desktop E2E touches the Acquire panel or Drop. The queue test exercises `QUEUE_SQL`, which the UI does not use. |

The product vault and live Direct record were not reachable from this container. The live criteria below are the ones in the
coordinator's dispatch text. The coordinator should check them against Direct before adjudicating.

## 2. Criterion → source → current behaviour (probe at 82c573a)

Probe verdicts describe the existing code on synthetic fixtures. They are not delivery verdicts.

| # | Live criterion | Where it lives | Probe | Today |
|---|---|---|---|---|
| C1 | Queue shows **today's** top 10 wishlist | `AcquirePanel.tsx` `QUEUE_SIZE`, `lib.rs` `acquisition_queue` | Q2, Q4 | **Partial.** Top 10 holds. The list is recomputed on every open, so filing one book pulls the 11th in (Q4). No daily snapshot exists. |
| C2 | Sorted by **recommendation weight × rating**, descending | `lib.rs` 640-669 (PBK-29 v2) | Q1 | **Fail.** A recommended ★3 (2020) entry scores 0.492 and an unrecommended ★5 (1900) entry scores 0.675. v2 ranks the ★5 first; rec × rating ranks it last. |
| C3 | Clickable search links | `AcquirePanel.tsx` `search()` | Q5 (static) | **Present, unverified at runtime.** Hard-coded shadow-library domain. An opener failure is swallowed and the entry is still marked queued. |
| C4 | Queued status | `update_book` → `curation.json` `up_next`; `· queued` label | Q3 | **Holds** in the shipped command, which pins `up_next`. The markdown `status` stays `wishlist`, and `QUEUE_SQL` (the only tested queue) does not pin it. |
| C5 | Excludes lower-ranked entries | `books.truncate(limit)` | Q2 | **Holds.** 12 wishlist rows give 10; the two lowest, plus owned and done rows, are excluded. |
| C6 | Drop matches **queued before other wishlist** | `process_drop` candidate set | D3, D3b | **Fail.** The candidate set ignores status and `up_next`. A queued/wishlist title tie is left ambiguous. Profiles marked `done` without a file are also linked. |
| C7 | Rename `Author - Title.ext`, preserving the extension | `matcher::match_file` `proposed_name` | D1, D1x, D7b, D8b | **Holds for ordinary names**, with the extension lower-cased (`.EPUB` → `.epub`). A 311-byte name aborts the batch (D7b). A leading-dot title becomes a hidden file the index skips (D8b). |
| C8 | Move to the **category folder** | `process_drop` `dest_dir` | D2 | **Fail.** Every file goes to `Library/00 Inbox`, a deliberate choice made 2026-07-13. |
| C9 | Link the file and set available, no manual bookkeeping | `process_drop` catalog write + rescan | D1, D10, D5b, D5c, D7, D7c, D9, D14 | **Holds on the happy path.** The file is linked, hashed and set to available, the original name is kept, and restart/rescan keeps one card with the same asset id. It **fails on failure paths** (section 3). |
| brief | Ambiguous/unmatched files kept for review | `left-*` outcomes | D12, D13 | **Holds** for epub/pdf. Unsupported formats are silently omitted from the report. Files waiting in Drop show up as Library cards. |
| brief | No automated external download | panel only opens a browser URL | Q5 | **Holds.** Nothing downloads. |

## 3. Synthetic gap reproduction (quantified)

`probe/` is a standalone Cargo package with its own `[workspace]`. It drives the real `desktop_lib` against throwaway libraries
and is not in the test suite or CI. Result at the base: **27 checks: 8 HOLDS, 13 GAP, 5 INFO, 1 STATIC**, with identical
verdicts on two fresh runs. Full output: `probe-results.txt` / `probe-results.json`.

| Invariant | Check | Observed |
|---|---|---|
| No overwrite | D4 | HOLDS. Occupant and dropped file are both byte-identical, and the dropped file is left as `left-conflict`. The guard is an `exists()` check followed by `fs::rename`. `std::fs::rename` replaces an existing destination on both Unix and Windows, so anything that creates the target between the check and the rename is overwritten. That is static reasoning, unverified on Windows. |
| Traversal | D8 | HOLDS. `../../x`, `..\..\x` and `/abs/x` titles all stay in the destination, because separators become spaces. Names come out cosmetically odd: `Trav One - .. .. Escaped…`. |
| Hidden or unsafe names | D8b, D7b | GAP. A title starting with `.` is filed as `.hidden…pdf`, which the index skips (0 asset rows). A 311-byte UTF-8 name returns `Err(File name too long)` and the whole batch report is lost. Windows reserved names are unverified. `catalog_import::import_filename` already handles all of these. |
| Library binding | D9 | GAP. A symlink in Drop pointing outside the library is moved and linked; the profile now resolves to bytes outside the library. |
| Partial arrival | D5a, D5b, D5c | `.part`/`.crdownload` are ignored (HOLDS). A `.pdf` still being written in place is filed, and the recorded hash goes stale once the write completes (GAP). A zero-byte `.epub` is filed as the book (GAP). |
| Failure mid-batch | D7, D7b | GAP. A post-move error (a dangling symlink that fails to hash) returns `Err`. The file has already left Drop, its profile is unlinked, later files are not processed (directory order), and the report is lost. |
| Crash/restart | D7c | GAP. Kill between the move and the catalog write, then run again: `filed=0`, the profile stays unlinked (`availability none`), the original name is recorded nowhere, and an unlinked file card appears in Inbox. Nothing journals the move. |
| Duplicate event / re-run | D6 | HOLDS. A second run files nothing. An identical second download is `left-conflict`, then `left-unmatched` on the next run, and stays in Drop indefinitely. |
| Restart persistence | D10 | HOLDS. After a new connection and rescan the profile is available/local, there is no Drop card, and the asset id is kept through the registry's unique-move rule. |
| Reversible original name | D11 | INFO. `original_filename` is recorded, but the original folder is not (Drop is implied) and there is no undo for a filing. |
| Queue/Drop consistency | D14 | GAP. A profile whose linked file is missing appears in the queue (`availability missing`), but Drop cannot file a re-download because profiles with any `file:` are excluded. |
| Confidence | M1 | GAP. On a 22-file / 12-entry synthetic corpus: auto-correct 9, **auto-wrong 1** ("Frank Herbert - Children of Dune.epub" → *Dune*, score 1.00), review 8 (including the obvious "Frank Herbert - Dune Messiah.epub", a 1.00 tie with *Dune*), missed 1 ("Antifragile (Nassim Taleb)": a long subtitle dilutes coverage), correctly unmatched 3. The score only measures how much of the *entry* the filename covers, never how much of the *filename* the entry explains. |
| Every file reported | D13 | GAP. A `.mobi` in Drop is left there and is missing from the report. |

## 4. Already decided (no question needed)

- Queued is the `up_next` flag (docs/library-identities.md; `0740bce`). `want_to_read` is kept after acquisition. Markdown
  `status: queued` from the sheet import seeds `up_next`. The UI keeps using `update_book`, not `set_catalog_status`.
- Files and Catalog markdown are the truth. The SQLite index is rebuilt by rescan. Acquisition may write `file`/`hash`/
  `original_filename`/`status` into Catalog frontmatter (docs/library-identities.md). Unknown frontmatter fields survive.
- Drop is `<library>/Drop/`. Arrivals are matched only against Catalog profiles of the bound library.
- Ambiguous or unmatched files stay in Drop for review. Adopting unmatched files as new profiles is PBK-23 (out of scope).
- No download automation. The app only opens a search page.
- Relink by content hash already exists (the identity registry's unique-move rule plus the scanner link pass), so the
  "user sorts later" path works.
- N = 10 (criterion text and `QUEUE_SIZE`).

## 5. Decisions the coordinator must adjudicate (options, impact, recommendation)

Each one changes behaviour the owner will notice. None is decided in this batch.

### D-A Ranking rule (conflict between two recorded requirements)
The live PBK-21 text says "recommendation weight × rating". PBK-29 (later commit `be6e895`; current-release brief) records
`0.35 lindy + 0.25 rec + 0.25 rating + 0.15 spectrum` with queued pinned, and that is what ships. They disagree (Q1). Also,
"recommendation weight" has no source: `recommendation` is free text such as a person's name, and the scanner reduces it to
a boolean.
- A1: keep PBK-29 v2 and amend the PBK-21 criterion to "ranked by the PBK-29 score". Zero code risk; matches the latest
  recorded decision.
- A2: rec × rating with weight ∈ {0,1}. Every unrecommended entry ties at 0, so a tiebreak rule is needed (all 12 rows of the
  Q2 fixture would tie, since none is recommended). It also contradicts PBK-29.
- A3: a defined weight table (for example per recommender). Needs owner data; new config.
- **Recommend A1.** Either way, replace `QUEUE_SQL` (or make the command use it) so the tested code is the shipped code.

### D-B Category folder (conflict with a recorded design choice)
The 2026-07-13 code files everything into `Library/00 Inbox` on purpose. The live criterion says "category folder". The
category source is the profile's `topics` (comma list from "Topic Category"); shelves on disk are folders such as
`Library/05 Trading & Markets`, and no topic→shelf mapping exists.
- B1: first topic → `Library/<sanitized topic>/`, creating the folder if needed. This invents a parallel taxonomy next to the
  owner's numbered shelves.
- B2: first topic matched against an **existing** `Library/*` folder name (case/space-insensitive, ignoring a leading
  `NN ` prefix and organisation topic aliases). Exactly one match → that folder. No topic, no match, or several matches →
  `Library/00 Inbox` with a reason. Never create top-level shelves.
- B3: explicit `shelves: {topic: folder}` in `.properbooky/curation.json` organisation (new UI). Deterministic, but needs
  owner setup.
- B4: keep Inbox and amend the criterion.
- **Recommend B2** (B3 can follow later). Missing category → Inbox, reported.

### D-C Confidence, queued preference and unmatched files
- Queued-first: pass 1 matches only profiles with `up_next` and no local file. Pass 2 matches the rest of the eligible set.
  A pass-1 Auto wins even when a pass-2 profile ties (this is what D3 needs). Two queued profiles tying stay in review.
- Auto guard (fixes M1): also require **file-side coverage**. After removing junk tokens, years and bracketed
  publisher/site segments, ≥ 80% of the filename's tokens must come from the candidate's title+author. For example,
  "Children of Dune" would no longer auto-file to *Dune*. The exact 0.8 is a tunable; the proposal is to fix it with a
  matcher corpus test.
- Eligible profiles: `want_to_read` profiles with no local file, **including** linked-but-missing ones (fixes D14). A `done`
  or `available` profile without a file is not eligible for auto-filing (D3b); it can only be picked manually.
- Unmatched or ambiguous: stay in Drop, listed with reason and top candidates. Review rows allow "File as <profile>"
  (explicit user choice, same safe path). No adoption (PBK-23).
- **Recommend all four.** Question for the coordinator: is a queued-over-wishlist tie win acceptable, or should a tie always
  go to review (stricter, but fails the literal C6)?

### D-D Day rollover, carry-over and N
- D1: live recompute (today's code). Simple, but the list changes during the day (Q4).
- D2: a daily snapshot `.properbooky/acquisition/today.json` `{date (local), items:[stable_id, rank, score]}` created on the
  first open of a local calendar day. Acquired items stay listed as "acquired ✓" and are not replaced. The next day
  recomputes from the current ranking, so un-acquired queued items carry over automatically because they are pinned.
  N = 10. The snapshot is per library and travels with the folder.
- **Recommend D2.** Question for the coordinator: should un-acquired, non-queued items from yesterday carry over ahead of new
  ranking? The recommendation is no; only queued items carry over.

### D-E Collision handling
- E1: keep `left-conflict` (safe; identical duplicates pile up in Drop).
- E2: auto-suffix ` (2)` (as catalog_import does). Two different files can then claim one profile; not recommended.
- E3: compare hashes. If the occupant is byte-identical and not linked by another profile, link the profile to the occupant
  and leave the Drop copy reported as `duplicate of <path>` (never delete). If the content differs, `left-conflict` for
  review. Either way the move itself is **no-clobber**: `hard_link(src, dst)` (atomically fails if `dst` exists) then
  `remove_file(src)`; across volumes, copy to a temp file, `persist_noclobber`, verify the hash, then remove the source.
- **Recommend E3.**

### D-F Search target (product/legal; not ours to choose)
`AcquirePanel.tsx` hard-codes `https://z-library.sk/s/…`, a shadow-library domain.
- F1: keep it.
- F2: a per-library search URL template (setting) with no default. The button is disabled with "Set a search link" until
  set.
- F3: a neutral default (catalogue search such as Open Library) plus F2.
- **Recommend F2 or F3, decided by the owner.** Implementation keeps today's behaviour until decided. Either way, report an
  opener failure and do not mark the entry queued when the opener fails.

### D-G Trigger: manual versus automatic
"Without manual bookkeeping" means no hand edits to links and statuses. It does not require a background watcher, and a
watcher would be an automatic filesystem mutation the dispatch says not to activate silently.
- **Recommend:** an explicit Check Drop (dry-run plan) → File N confident matches (apply) flow, and no watcher in this slice.
  A watcher, if wanted later, is a separately approved opt-in on top of the same plan/apply service.

### D-H Smaller choices (recommendation in brackets)
- Extension case: lower-case it [keep today's normalisation; the extension type is preserved].
- Files waiting in Drop appear as Library cards today (D12): [exclude `Drop/` from the index scan; it is an inbox, not a
  shelf].
- Unsupported formats in Drop (mobi/azw3/djvu): [report `left-unsupported`; filing them is out of scope].

## 6. Implementable design (desktop UI → service → filesystem/index)

**UI (`AcquirePanel.tsx`)**
- Today: `acquisition_today(library_id)` → `{date, items:[{stable_id,title,author,rank,score,queued,acquired}]}`. Rows show
  rank, score, `queued`/`acquired ✓`, and the search link button (D-F). Search → `update_book` sets `up_next` (existing
  path), only after the opener succeeds.
- Drop: **Check Drop** → `drop_plan(library_id)` (no writes) → rows with file, decision (`auto`/`review`/`unmatched`/
  `unsafe`/`partial`/`conflict`/`duplicate`/`unsupported`), target profile, destination, reason. **File N** →
  `drop_apply(library_id, plan_id, choices)` applies the auto rows plus explicit review choices. The result lists
  per-file outcomes; the panel refreshes the library and today's list. **Undo** per filed row → `drop_undo(library_id,
  op_id)`.

**Service (`acquire.rs`, library crate; Tauri commands stay thin)**
- `plan(conn, root)`: candidates from `library::list`, so curation `up_next`/`want_to_read` are effective (fixes the
  markdown-only blindness). For each Drop entry: `symlink_metadata` must show a regular file (D9). The canonicalized Drop
  must lie inside the canonicalized root. Supported extension; non-empty; magic sniff (`%PDF-`; zip with `mimetype` =
  `application/epub+zip`) (D5c). Record `(size, mtime)` for the stability check (D5b). Match with the two-pass guard
  (D-C). Destination = `safe_join(root, "Library/<shelf>/<safe name>")` (D-B), where the safe name reuses
  `import_filename` rules (D7b/D8b). Collision pre-check by hash (D-E).
- `apply(conn, root, plan, choices)`: per file, in isolation, never `?` across the batch (D7/D7b):
  1. re-stat: size/mtime unchanged since the plan and older than a quiet period (e.g. 10 s); otherwise `partial`;
  2. hash; append a journal record `planned {op_id, from, to, profile, hash, original_name, prior status/up_next/want}`
     (fsync);
  3. no-clobber move (D-E); re-hash at the destination, must equal (D5b); journal `moved`;
  4. rewrite the profile with `identity::atomic_write` (file, hash, original_filename, status available); journal
     `linked`.
  After the batch, one `scanner::scan_library` (the asset id is kept through the registry move rule, D10).
- `recover(conn, root)`, run before every plan/apply and at library open: replay `.properbooky/acquisition/journal.jsonl`.
  `planned` with the source present → nothing happened. `moved` with the destination present and hash equal → finish the
  link. `moved` with the destination missing → report. `linked` → done. Fixes D7c; restart and re-run are idempotent.
- `undo(op_id)`: no-clobber move back to `Drop/<original_name>`, restore the prior frontmatter fields from the journal,
  rescan (D11).

**Filesystem and index**
- New: `.properbooky/acquisition/journal.jsonl` and `today.json`. They live inside `.properbooky`, so they travel with the
  library and the index skips them.
- No SQLite schema change. No Catalog field changes (uses existing `file`, `hash`, `original_filename`). No new Tauri
  capability or plugin. No fs watcher.

**Rollback:** the change is confined to acquire.rs/matcher.rs/AcquirePanel.tsx plus two new commands. Reverting the PR
restores today's button. Journal/snapshot files are inert to older builds, which skip dot-folders.

## 7. Verification plan for the implementation batch (each gap becomes a test)

- Rust (`tests/acquire_test.rs`, `matcher_test.rs`):
  - one test per probe row: D2–D9, D13, D14, M1;
  - queue order through the **command's** code path (Q1/Q3) and the daily snapshot across a simulated date change (Q4);
  - journal recovery for each crash point (planned/moved/linked) and undo round-trip.
- Packaged desktop E2E `acquisition.e2e.mjs` (Linux, the CI `desktop-e2e` job, committed synthetic fixtures, fresh
  app-data):
  1. open Acquire → 10 rows in expected order;
  2. the search link's href is asserted without launching a browser;
  3. queue one → `queued` survives an app restart;
  4. copy synthetic files into Drop → Check Drop shows auto/review/unmatched/unsafe rows → File;
  5. disk, Catalog frontmatter and the library card agree;
  6. restart → still filed;
  7. fault hook (env, like the PBK-24 wrong-restore fault) kills after `moved` → restart → recovery links the file;
  8. Undo returns the original name to Drop.
- PBK-28 rows (reported success versus persisted state, ambiguous retention, relink after a user moves the file, category
  update) reuse the same fixtures.
- Windows: no-clobber rename semantics, reserved names, the hard-link fallback across volumes, and the installed-app
  walkthrough all remain coordinator-local and deferred.

## 8. Precise coordinator questions

1. **D-A:** Should PBK-21's ranking criterion be amended to the PBK-29 v2 score (recommended)? If not, what is a
   "recommendation weight" for a free-text recommender field, and how are the zero-weight ties ordered?
2. **D-B:** The 2026-07-13 design files arrivals into `Library/00 Inbox` deliberately. Is "first topic → existing matching
   shelf, else Inbox, never create shelves" (B2) the intended "category folder"?
3. **D-C:** Is a queued profile allowed to win a title tie over a wishlist profile (literal C6), and is the file-side
   coverage guard acceptable even though it sends some of today's auto-matches to review?
4. **D-D:** Daily snapshot with only queued carry-over (recommended), or live recompute?
5. **D-E:** For identical-content collisions, should the profile link to the existing file and leave the Drop copy reported
   (recommended)?
6. **D-F (owner):** Which search target ships: the current hard-coded shadow-library domain, a user-set template, or a neutral
   default?
7. **D-G:** Confirm there is no background Drop watcher in this release (explicit plan → apply only).

## 9. Out of scope / not claimed
- No product, schema, permission or CI change. No downloads, no real files, no owner library or exports.
- No Windows evidence, no AgentPass, no human acceptance. Native access is deferred.
- The live Direct criterion text and the product vault were not readable here. The coordinator must reconcile them before
  dispatch.
