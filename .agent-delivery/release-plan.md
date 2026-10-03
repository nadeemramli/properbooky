# Current-release coverage map and batch plan (cloud worker)

Snapshot: Direct cursor 1029 (4 Oct 2026 MYT issue evidence, embedded by the coordinator).
Base: `origin/main` = `9c850168b35c2545bbe7ba88fac27f908960366d`; CI run 33 on that SHA succeeded.
This is execution evidence and a proposal for coordinator dispatch, not an issue tracker,
and it does not record readiness, claims or acceptance.

## Release boundary (as interpreted from repo + issue evidence)

Current release = the **desktop local-first reader** (Tauri app in `desktop/`) over a
files-as-truth library, plus **verification debt on the legacy web app** against a
*local* Supabase stack. Remote Supabase stays paused. Out of this release: PBK-7 remote/mobile
sync, PBK-10 research, PBK-12 phases 2-3 (embeddings, groups, chat), public distribution/signing.

## Coverage matrix

| Journey | Issues | Code on main | Automated evidence on main | Classification |
|---|---|---|---|---|
| Build/CI confidence | PBK-4, PBK-18 | `ci.yml`: mcp, web (lint non-blocking), web-e2e smoke, desktop tsc + `cargo test` | green on 9c85016 | **Partial**: no packaged-desktop E2E in CI (PBK-18 branch has it, no PR yet); branch protection is a repo setting (owner) |
| Library open / index / settings | PBK-14 (legacy), PBK-15 | `scan_library`, `get_library_state`, `list_books`; SQLite at app-data `library.db` | `tests/library_scan.rs`, `tests/library_identity.rs` (10) | Single library **implemented**; multi-library picker PBK-15 **missing** (needs owner scope decision) |
| Catalog import + facets | PBK-19 | `examples/import_catalog.rs`, `catalog.rs`, chips in `LibraryView.tsx` | indirect via scan tests only | **Implemented, insufficiently verified** (no import idempotency test) |
| Match / rename / adopt / relink | PBK-20, PBK-23 | `matcher.rs::apply_match`, examples `match_library`, `adopt_library`, `relink_library` | `matcher_test.rs` = scoring only | **Implemented, insufficiently verified; data-integrity gaps**: rename-before-catalog-write with no rollback, non-atomic `.md` writes, `adopt` aborts mid-batch, no apply/adopt/relink/collision tests. Remaining PBK-20/23 bullets are owner triage of the owner's library (not agent work) |
| Acquisition + Drop | PBK-21, PBK-29 | `acquisition_queue`, `acquire.rs::process_drop` | `acquire_test.rs` (3) | **Implemented, partially verified**; same partial-failure gap (file moved, catalog parse fails → counted filed but unlinked) |
| Reader + positions | PBK-24 | `EpubReader`/`PdfReader`, `get_sidecar`/`save_progress`, sidecars in `<library>/.properbooky/state/` | packaged E2E on PBK-18 branch covers EPUB+PDF restart restore | **Implemented**; restart proof pending PBK-18 merge. Sidecar write is plain `fs::write` (not atomic); tabs not restored across restart (not in criteria) |
| Highlights + export | PBK-26, PBK-6 | `annotations.rs` (UUID, `updated_at`, tombstones), `export.rs`, `sync_obsidian` | `annotations_test`, `export_test`, `consolidation_test` | **Implemented, insufficiently verified**: no UI-level create→restart→painted→remove→export E2E; no LWW merge (single writer today) |
| Enrichment | PBK-22 | `enrich.rs` (Open Library via ureq, 7-day cache) | pure + seeded-cache tests; live smoke `#[ignore]` | Implemented; remaining tail (Google Books) is a **real external integration** needing separate approval |
| Full text + MCP | PBK-12 ph.1, PBK-13 | `extract.rs`, FTS5 chunks, `mcp/server.mjs` | extract tests, `mcp/library.test.mjs` in CI | Phase 1 implemented; phases 2-3 **next release** |
| Web app runtime (local Supabase) | PBK-30, PBK-1, PBK-9 | PR #13 fixes on main | Playwright smoke = 3 route-level tests only | **Unverified at runtime** (PBK-30 debt) |
| Dead stats cluster | PBK-31 | see `pbk-31-options.md` | none | **Decision** (owner) — evidence shows one *reachable* broken query |
| Architecture cleanup | PBK-5 | NextAuth remnants, two Database types, 3 client factories | lint non-blocking (legacy debt) | Missing; lower priority than integrity/verification |

## Proposed batches (need coordinator dispatch unless noted)

### Batch 1 — `pbk18-packaged-desktop-e2e` (PBK-18; closes PBK-4 "desktop E2E in CI" bullet)
- Reuse `claude/pbk-18-packaged-desktop-e2e` @ `48b659a5c4eacb9ae29a5385db60a2bd3b761efa` (base = main 9c85016, fast-forwardable). **Claimed by actor `claude-pipeline-properbooky-20261004`; needs explicit handoff** before this worker pushes to it or opens its PR.
- Remaining work: open draft PR from that branch, observe current-head CI (`desktop-e2e` job), fix CI-only failures, attach build identity + `report.json` artifacts. Independent Linux rerun by this worker is recorded in `batches/pbk18-independent-linux-rerun/report.json`.
- Non-goals: Windows native run (coordinator, after proper known-folder isolation), web/PBK-30.
- Rollback: drop the `desktop-e2e` job; no product code changes.

### Batch 2 — `pbk30-web-local-supabase-verification` (PBK-30)
- Isolated local Supabase in the container (Docker Hub images, `SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io`; ECR pulls are 403 here), synthetic users/books/files only, remote stays paused.
- Criterion → test: Playwright specs under `e2e/local-supabase/` gated on a local stack env, seeding via service-role against **127.0.0.1 only** (guard refuses non-local URLs).
  1. metadata edit → reload → highlights/bookmarks/toc/recommendations intact (DB assertion + UI); sliders/wishlist persist; second recommendation appends.
  2. manual upload EPUB/PDF → retrievable from storage; bulk queue with one forced failure → toast counts match DB rows, failed item stays queued; CSV wishlist import → rows after reload.
  3. auth: signup → `/auth/verify-email`; reset email captured from local Inbucket/Mailpit → `/auth/reset-password` → new password works; invalid/expired link → explained error, other account unchanged. Note: `next dev` forces dev-mode auth bypass (`FLAGS.FORCE_DEV_MODE` when `NODE_ENV=development`), so auth flows must run against `next build && next start` with `NEXT_PUBLIC_DEVELOPMENT` unset.
  4. restart Next + `supabase stop`/`start` (no reset) → all data intact.
- Suspected defects to reproduce first (not yet confirmed): reset page calls `updateUser` with no explicit code exchange/session check; sliders persist on every drag tick (`onValueChange`) and render stored `0` as default (`|| 0.5`); `updateBook` drops keys passed as `undefined`; dashboard `ActivityFeed` queries dropped table `reading_activities`.
- Non-goals: PBK-5 cleanup, PBK-31 decision, remote restore.

### Batch 3 — `desktop-file-ops-integrity` (PBK-20, PBK-23, PBK-21 integrity; **proposed new issue** for the gap)
- Make catalog writes atomic (temp+fsync+rename, as `identity.rs` already does) and order `apply_match`/`adopt`/`process_drop` so a failure after a rename rolls the rename back (or never reports "filed" when unlinked). Continue per-item in adopt rather than abort mid-batch.
- Tests on synthetic temp libraries: collision (never clobber), injected write failure → original filename restored and catalog unchanged, relink by hash after a move, idempotent re-run, `import_catalog` idempotency (PBK-19 criterion 3).
- Non-goals: running any bulk op on the owner's library; triaging the owner's 305 review rows.
- Independent of Batch 1/2.

### Batch 4 — `reader-highlights-restart-e2e` (PBK-24, PBK-26)
- Extend the packaged desktop runner: create EPUB + PDF highlight through the UI, restart, assert painted + sidecar UUID/anchor, remove → tombstone persists across restart, run `export_highlights` on the fixture library and assert markdown. Atomic sidecar write.
- **Depends on Batch 1 merge** (reuses its runner); stacked only if the queue permits.

### Owner decisions / next release (not implementation queue)
- PBK-31 delete vs revive: options in `pbk-31-options.md`.
- PBK-15 multi-library picker: in or out of current release?
- PBK-4: branch protection + Vercel integration are repo-settings decisions.
- PBK-22 Google Books fallback: real external API, needs approval and real-integration validation.
- Next release: PBK-7 sync/mobile (blocked by PBK-10), PBK-12 phases 2-3, PBK-5 cleanup.
