# PBK-15 + PBK-26 integration — plan (written before the merge)

Dispatch: Properbooky bounded integration review-repair, 4 October 2026. Worker lifetime task 2, applicable cap 2.
Runtime model verified with get_session: `claude-opus-5-5` (configured, session_context, last_served).
Sole Properbooky writer. Coordinator owns Direct PBK-15 and PBK-26 and the independent source review of both originals.

| Input | SHA |
|---|---|
| main (base of both) | `44e96b67d05213b53185d97d740f7d392e0c0c3f` |
| PR #21 PBK-15 head (branch start) | `0b83611ee9be09f3ccfe52f6a26ec4961bb7e434` |
| PR #20 PBK-26 head (merged in, exact) | `260da9fe7b1d09345964590afa8570c625be88ea` |

Branch: `claude/pbk15-pbk26-integration` (new). Original branches `claude/sweet-turing-shme1z` and
`claude/pbk-26-highlights-export` and PRs #21/#20 are left unchanged. Merge with `--no-ff` so both histories stay.

## Known merge surface (git merge-tree, before merging)

- Textual conflicts: `.github/workflows/ci.yml` and `desktop/package.json` (adjacent additions: keep both suites),
  `.agent-delivery/state.json` (evidence record: rewrite as the integrated state, keeping both batches).
- Auto-merged, to be checked: `App.css`, `ObsidianPanel.tsx`, `EpubReader.tsx`, `PdfReader.tsx`, `readingState.ts`, `types.ts`.
- `pr20-integration.patch` (2 lines in PR #20's `highlights.e2e.mjs`): re-check it applies exactly. It keeps the assertions
  but narrows them: the export listing counts only `.md` notes, and the app-data JSON check admits only the PBK-15 library list.
  The list must still not contain reading state, which the patched line checks.

## Criteria and evidence (one exact integrated build, Linux packaged debug .deb, Xvfb + tauri-driver)

| # | Criterion (from the dispatch) | Evidence |
|---|---|---|
| I1 | Both histories kept; adjacent CI/package changes keep both suites; no assertion weakened | merge commit with parents 0b83611 + 260da9f; diff review of the resolutions; CI runs every suite from both |
| I2 | PBK-15 shared-export protection survives PR #20's exporter, with colliding file names and book ids | libraries journey (beta = copy of alpha: same relative paths and identity UUIDs) on the integrated build: beta refused alpha's export folder; alpha's notes byte-identical |
| I3 | Marker and settings files coexist with PR #20 export | `.properbooky-library` ignored by the exporter (it reads `.md` only); highlights journey export listing and app-data check (patched) pass; library list holds no reading state |
| I4 | User-authored export content preserved across libraries | new integration step: user text written inside alpha's generated note and a user-owned `.md` in alpha's export folder; alpha re-export keeps both; beta refused; beta stale sync refused; all byte-identical where expected |
| I5 | Remove / re-add / restart keep the protection | after removing beta: alpha pointed at beta's folder is refused by the marker (removed library); after re-add beta exports to its own folder keeping its user text; after restart alpha re-export keeps user text |
| I6 | Missing folder | export bound to a library whose folder is missing is refused; its export folder unchanged |
| I7 | In-flight old-library operations | sync_obsidian bound to the previous library after a switch is refused ("not open any more"); stale download and late writes (existing steps) still refused |
| I8 | Private notes, highlights, progress and files never overwritten across libraries | sidecar and tree digests in the libraries journey; highlights journey sidecar/tombstone/anchor checks |
| I9 | PBK-26 behaviour unchanged by PBK-15 | PR #20 highlights journey (EPUB/PDF selection, anchors, panel, remove, restart, export idempotence and user content) on the same build |
| I10 | Reader regression and negative cases, with cleanup | smoke x2, PBK-24 reading journey, injected-failure verifier (PR #20's added cases included) on the same build |
| I11 | Upgrade/rollback boundary | PR #20 changes the exporter that a migrated library uses on its legacy export folder, so the upgrade rehearsal is re-run on the integrated build. It adds one step: after the upgrade, export into the folder the previous build wrote, which must keep user text and claim the folder for the migrated library. Base-build mode locally, seeder mode in CI. |
| I12 | Affected Rust/type/fixture/MCP checks | `cargo test`, `tsc --noEmit`, `npm run fixtures:check`, `mcp npm test` at the tested SHA |
| I13 | Final-head CI and retained evidence | CI on the integration PR head; commands/exits, tested SHA, deb/binary hashes in `.agent-delivery/batches/pbk15-pbk26-integration/report.json`; Windows gaps listed explicitly |

Out of scope (reported only): asset-protocol scope, any capability change, Windows native checks, merging or closing PRs,
Agent Pass, owner acceptance. A confirmed integration defect within these criteria is repaired here and the affected
checks are re-run.
