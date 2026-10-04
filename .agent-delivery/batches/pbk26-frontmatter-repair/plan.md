# PBK-26 frontmatter preservation — review repair plan (task 2 of 2, written before implementation)

Dispatch: coordinator confirmed this chat's escalation (Direct PBK-26 Doing v13, coordinator claim). Second and final scoped
task of this chat (lifetime 2 / cap 2, feedback involved). Runtime model re-verified with get_session: `claude-opus-5-5`.

Checkpoint of task 1: tested `9e7ad7f67e92549fd57f90edafdaf5e432161424`, evidence-only handoff `e20d8664fe9fc95a03834b3c1d04948a298ebe97`
(see `../pbk26-legacy-export-repair/`). Same branch `claude/sharp-archimedes-s3rdeu` and draft PR #23 continue, stacked on PR #22
`cfb40a5`; no merge, no force push, PR #20/#21/#22 untouched.

## Defect (confirmed by the coordinator; reproduced here before any change)

`export::merge_frontmatter` deserializes the frontmatter and, whenever one of Properbooky's keys (`title`, `author`,
`source`, `generated_by`) differs, re-serializes the whole mapping with serde_yaml: user comments are deleted and the
user's other properties are reformatted (`tags: [a, b]` becomes a block list). `written=1, skipped=[]` reports success.
Reproduced with the coordinator's regression at e20d866 (product = 9e7ad7f): exit 101, `user_comment_present=false`.

## Repair design (conservative line edit, verified; refusal when unsafe)

- Unchanged values: frontmatter kept verbatim (as before).
- New note: generated as before.
- Otherwise only Properbooky's own top-level lines are edited; every other byte of the frontmatter is kept:
  replace `key: value` (one line, plain or fully quoted scalar, no comment), insert a missing key next to the other
  owned keys, remove a key that no longer applies (author). New values are rendered by serde_yaml (quoted as needed).
- An owned line is only touched when provably ours to rewrite: exactly one top-level occurrence, a single-line scalar
  with no comment, no other syntax. The edited frontmatter is re-parsed and must equal the old properties with only
  Properbooky's keys changed; otherwise nothing is written.
- Refusal (note byte-identical, not counted, actionable reason in `skipped`): owned key duplicated or written in a form
  Properbooky did not write; owned line with a comment, multi-line or flow value; CRLF in the properties; verification
  mismatch. The highlights block is not updated for a refused note (the note is left exactly as is), other notes are.
- Unchanged: task-1 legacy-body proof/refusal, marker handling, idempotence, foreign files, PBK-15 ownership refusals.

## Criteria and evidence (one exact tested build; Linux packaged debug .deb, Xvfb + tauri-driver)

| # | Criterion | Evidence |
|---|---|---|
| F1 | Reproduce first | coordinator regression `tests/export_frontmatter_repro.rs` (verbatim) fails at e20d866; log kept |
| F2 | Public API regression passes unchanged | same test at the tested SHA |
| F3 | Metadata update keeps user comments, unknown properties (flow/block lists, nested maps, quoted values, block scalars), blank lines and order byte for byte; owned title/author/source updated, author inserted/removed; highlights block still updated; repeated exports byte-identical | new `tests/export_frontmatter_test.rs` through `export::export_highlights` |
| F4 | Unsafe shapes refused: comment on an owned line, duplicated owned key, multi-line/block owned value, quoted/spaced key form, CRLF properties; file bytes+mtime unchanged, actionable reason, other notes still written; fix then sync succeeds | same file |
| F5 | Earlier protections not weakened: all export tests incl. task-1 legacy suite and the coordinator's first regression unchanged and passing | `cargo test`; `git diff` of existing test files empty |
| F6 | Packaged journey: user comment + own properties in a migrated legacy note survive the real metadata update at upgrade (legacy stem title → current title, author inserted), a later title edit through the `update_book` command boundary, repeated sync, restart; controlled failure: inline comment on the owned `title:` line is refused in the panel with the file byte-identical, then fixed and synced | `library-upgrade.e2e.mjs` (previous-build mode and seeder mode) |
| F7 | Affected regressions on the same build: smoke x2, reading, highlights, libraries, upgrade (both modes), injected failures; cargo test, tsc, fixtures:check, mcp test | logs with exit codes |
| F8 | Exact-head CI, criterion report, handoff; subscriptions removed | CI on PR #23 head; `report.json` |

Non-goals: frontmatter features, key renames, YAML library change, new dependencies, Windows claims, merge, Agent Pass.
