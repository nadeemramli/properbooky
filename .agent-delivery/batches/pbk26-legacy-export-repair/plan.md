# PBK-26 legacy export preservation — review repair plan (written before implementation)

Dispatch: Properbooky PBK-26 legacy export preservation review repair, 4 October 2026. New chat; lifetime task 1 of cap 2
(feedback involved). Runtime model verified with get_session: `claude-opus-5-5` (configured_model, session_context.model,
last_served_model). Sole Properbooky implementation writer; the coordinator owns Direct PBK-26 (Doing v11) and its claim.

| Input | SHA |
|---|---|
| Base: PR #22 exact head (`claude/pbk15-pbk26-integration`) | `cfb40a529ba132a461b101251c5a32cc5dbd5b51` |
| PR #20 head (also affected) | `260da9fe7b1d09345964590afa8570c625be88ea` |

Branch: `claude/sharp-archimedes-s3rdeu` (stacked on PR #22; PR #20/#21/#22 and their branches untouched; no force push,
merge or main change). Not independently mergeable: it carries PR #22's history.

## Defect (confirmed by the coordinator, reproduced here before any change)

`export::legacy_user_lines` decides ownership of a pre-marker note's lines by Markdown shape (`>`, `**Note:** `, first
`# `, `## Highlights`, blank lines) and deletes every line of that shape. A user-authored blockquote or `**Note:**` line
in a legacy note is deleted on the first sync with the current exporter; `written=1, skipped=[]` reports success.
Existing I11 only used plain user text, so green CI did not cover it.

## Repair design (deterministic, conservative)

A legacy note (ours by `generated_by: properbooky`, no markers) is migrated only by **proof**, never by syntax:

1. The legacy exporter's output is a pure function of (title, highlights). Its body was exactly
   `\n# {title}\n\n## Highlights\n\n` followed by one entry per highlight:
   `> {line}\n`… `> — {legacy location} ^pb-{id[..8]}\n\n` and, with a note, `**Note:** {note}\n\n`
   (byte-identical in every exporter version before markers: 72ca43c, 676498a, 2f17383, 44e96b6).
2. The header is proven when its title equals the note's own frontmatter title or the current title.
   An entry is proven when its bytes equal exactly what the legacy exporter writes for a highlight in this book's
   sidecar (live **or tombstoned**, each used once); a note line only when it equals that highlight's note exactly.
3. The proven prefix is replaced by the managed block. Everything after it is the user's and is kept **byte for byte**
   (CRLF, blank lines, headings, quotes, `**Note:**` lines, missing final newline) after the block.
4. Refusal (file byte-identical, not counted, actionable reason in `skipped`) when ownership cannot be proven:
   header changed; a generated entry of this book appears after unproven text (user text between highlights, an edited
   or duplicated quote); highlight block markers incomplete (one marker without its pair). The reason says how to
   resolve it (move own text below the last highlight / restore the markers / remove `generated_by: properbooky` to keep
   the file as the user's own, after which a fresh note is written beside it).
5. Unchanged: marker notes (outside the block kept verbatim), generated updates/removal (`_No highlights._`),
   frontmatter merge, foreign files never written, unreadable sidecars never empty a note, PBK-15 cross-library
   ownership refusals, rollback limitation (the previous build regenerates notes wholesale if used to sync).

## Criteria and evidence (one exact tested build; Linux packaged debug .deb, Xvfb + tauri-driver)

| # | Criterion | Evidence |
|---|---|---|
| L1 | Reproduce first: the unchanged synthetic regression fails at exact base cfb40a5 and at PR #20 260da9f | `cargo test --test export_legacy_repro` logs at both SHAs (exit 101, `written=1, skipped=[]`, both user lines absent) |
| L2 | Public API regression passes after the repair, unchanged | coordinator test kept verbatim in `tests/export_legacy_repro.rs` |
| L3 | Safe migration: user quotes, `**Note:**` lines, headings, blank lines, multiline notes, mixed CRLF/LF, no final newline all survive byte-for-byte; generated content appears once; repeated exports are byte-identical and not rewritten; later highlight add/remove update only the block | new `tests/export_legacy_test.rs` through `export::export_highlights` |
| L4 | Ambiguous legacy notes are refused with no write (bytes and mtime unchanged), an actionable `skipped` reason, other notes still exported; re-sync refuses again; after the user follows the advice the next sync migrates | same test file: interleaved text, edited heading, edited quote, duplicated entry, damaged markers, opt-out via `generated_by` removal |
| L5 | Old assertions kept: existing `export_test.rs` unchanged and passing; tombstoned entries proven; foreign/CRLF-converted files never written | `git diff` of `export_test.rs` empty; `cargo test` |
| L6 | Packaged seeded-upgrade journey: legacy notes (previous build through its UI locally; seeder mode in CI, its legacy-note writer proven byte-identical to the previous build's output) with user quotes, notes, headings, blank lines, mixed newlines; migration via the Obsidian panel; refusal shown in the panel with the file unchanged; fix then sync; repeated exports; restart; library switch (second library refused on the shared folder, own folder exported); switch back and re-export unchanged | `library-upgrade.e2e.mjs` (base-build mode + seeder mode) |
| L7 | Affected regressions on the same build: smoke x2, PBK-24 reading, PBK-26 highlights, PBK-15 libraries (capsh, non-root equivalent), injected failures; `cargo test`, `tsc --noEmit`, `fixtures:check`, `mcp npm test` | command logs with exit codes |
| L8 | Exact-head CI and delivery manifest | CI on the PR head; `.agent-delivery/batches/pbk26-legacy-export-repair/report.json` |

Non-goals: new export features, frontmatter formatting changes, Windows claims, merging, Agent Pass, human verdict.
Adjacent findings outside this criterion are reported to the coordinator, not fixed here.
