# PBK-26 highlights and export — criterion → evidence map (written before edits)

Dispatch: pbk26-highlights-20261004-0940 (PBK-26 Doing v7, coordinator claim codex-product-coordinator).
Objective 2 of 3 for this worker. Base: main 44e96b67d05213b53185d97d740f7d392e0c0c3f
(PR #19 merge; tree equal to 0c13553). Branch: claude/pbk-26-highlights-export (new, per coordinator).
PBK-27 is used only to clarify intended UX; its human verdict is not prefilled.

Entry point: packaged Linux debug binary (tauri build --debug --bundles deb), driven through
tauri-driver/WebKitWebDriver with the existing guarded harness (harness.mjs: marked processes,
watchdog, launch bound, cleanup), fresh temp XDG app-data, temp copy of committed synthetic
fixtures, temp Obsidian "vault" directory. Assertions read sidecars and export files on disk.

| # | Criterion | Action | Expected visible | Persisted | Failure / recovery |
|---|---|---|---|---|---|
| E1 | EPUB selection → pill → paint → persist | select a repeated phrase in ch.2 (not ch.1) in the epub iframe; press pill "Highlight" | painted mark over that exact passage | sidecar highlight: UUID id, created/updated ts, anchor {type epub-cfi, cfi, quote{exact,prefix,suffix}, position, chapter} | unwritable sidecar: notice, nothing lost; corrupt sidecar: set aside |
| E2 | EPUB paint survives close/reopen + restart; removal stays removed | close tab/reopen, restart app; Remove via panel; restart again | mark repainted at same text; removed one not painted | tombstone (deleted=true, updated_at≥) kept on disk | CFI fallback: a stale CFI with valid quote still paints at the quote |
| P1 | PDF text-layer selection → quote overlay on exact line | select 2nd occurrence of a repeated phrase on a multi-line page | overlay rects inside the selected line's span, not the 1st occurrence | anchor {type pdf, page, quote exact/prefix/suffix, position start/end in page text space} | — |
| P2 | Same after page switch / restart / fit-width vs fit-page | switch pages, toggle zoom, restart | overlay still on the exact line in both zoom modes | unchanged | — |
| P3 | Removable | Remove in panel | overlay gone, stays gone after restart | tombstone | — |
| U1 | Click painted highlight opens panel, never deletes | click EPUB mark / PDF rect | panel opens; highlight still listed; sidecar unchanged | — | — |
| U2 | Explicit Remove deletes; quote click navigates | click quote in panel from another page/chapter; keyboard activation | reader shows the highlight's page/CFI | — | — |
| S1 | UUID/LWW/tombstones; files are truth across index rebuild | delete app-data index, re-index | highlights repaint | sidecar unchanged by re-index | — |
| X1 | Export via existing export_highlights entrypoint (Obsidian panel → sync_obsidian) | set temp vault, Sync | per-book md: title/author frontmatter, locations, quotes, notes, ^pb- markers | — | — |
| X2 | Preserve user content, idempotent rerun | rerun → byte-identical; add user text; rerun; remove a highlight; rerun | user text kept; removed highlight gone | — | only <vault>/Properbooky touched |
| R | Rust sidecar add/list/remove/export tests + PBK-18/PBK-24 E2E stay green | cargo test, run-packaged, reading journey, verify-failures | all green | — | — |

Platform boundary: Linux/WebKitGTK only; Windows/WebView2 installed app remains coordinator work.
