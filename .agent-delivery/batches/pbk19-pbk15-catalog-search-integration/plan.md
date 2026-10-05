# PBK-19 + PBK-15 catalog/search integration — plan (written before the merge)

Dispatch: coordinator assignment, 5 Oct 2026 MYT, recorded on Direct PBK-19/PBK-15 heartbeat 2202. New chat, two issue
objectives (PBK-19 catalog integration, PBK-15 search repair integration), lifetime count 2/cap 2: this batch fills the cap. The
previous session `session_01JbygKhhQHafSKbabnod2K8` finished/stopped at 2/2; the coordinator keeps the Direct claims. Runtime
model verified with `get_session` at start: `configured_model`, `session_context.model` and `external_metadata.last_served_model`
all `claude-opus-5-5`.

## Sources (exact SHAs, verified against origin before any change)

| Source | Branch | Head | Tested | Base |
|---|---|---|---|---|
| PR #24 PBK-19 catalog import | `claude/gallant-darwin-bbt4jb` | `103510130c25161fa0df2e15d3c6828bc4826959` (evidence only) | `58aebe4e91e8985a7313ca3c1f1f8d06059beeb7` | `94faa40b50104380bc942dad3b45fc50c7601673` (PR #23 head) |
| PR #25 PBK-15 search empty-state repair | `claude/pbk15-search-empty-state` | `5f4fc33ad654d6b860f8986df236082e9d423296` (evidence only) | `c2e157ff0a9829ba427372dcfc592d3bcd16653d` | `fee7d17c1f4831b4b36f3c2a4b6b1235ebb409d4` (PR #22 head) |

This branch: `claude/bold-ritchie-1xa5z8` (the session's designated branch, which had no commits beyond main `44e96b6`), reset to
the exact PR #24 head `1035101`. Draft PR stacked on `claude/gallant-darwin-bbt4jb`. PR #22/#24/#25 branches are not modified;
main is not merged.

## Graph and diff inspection (before the merge)

- `merge-base(PR24, PR25) = 94faa40`. `fee7d17` is the merge of PR #23 (`94faa40`) into PR #22 (`cfb40a5`), and
  `tree(fee7d17) == tree(94faa40)` (`06c36f3c…`). So PR #25's four commits (`ba71447` plan, `344fc39` product, `c2e157f` journey,
  `5f4fc33` evidence) apply to the same content PR #24 started from. Upstream assumptions in the brief hold (no change found).
- Files both sides change: `desktop/src/LibraryView.tsx`, `desktop/package.json`, `.github/workflows/ci.yml`. Trial merge:
  `package.json` conflicts textually (adjacent script lines); `LibraryView.tsx` and `ci.yml` merge without a textual conflict.
- Method: `git merge --no-ff 5f4fc33` (not a cherry-pick), so PR #25's exact commits are ancestors. Provenance is the commit graph
  itself, and the merge order PR #22 → PR #25 → … → this PR does not produce duplicate patches. The merge also brings `fee7d17`
  (tree-identical to `94faa40`) into the ancestry.

## Overlap in LibraryView (semantic, not only textual)

| Point | PR #24 | PR #25 | Integrated rule (both kept) |
|---|---|---|---|
| Grid | `visible` (adds Status/Rating facets) | `shown = failed ? [] : visible` | `shown` filters through every facet, including status/rating; a failed listing shows no cards |
| Zero results | (blank grid for an unmatched query: the confirmed baseline bug) | settled + query + 0 books → "No books match “q”." + Clear search | unchanged; status/rating facets never produce this message |
| Facet zero | Status/Rating facets can hide everything | settled + books > 0 + 0 visible → "Nothing here…" | status/rating-filtered zero shows "Nothing here…", distinct from no-match and empty-library |
| Count | `visible.length` | `shown.length` | `shown.length` |
| Badges | availability + catalog status badge | unchanged cards | both badges on every catalog card |
| Import refresh | `onImported → refreshBooks(query)` | listing failures recorded in `listError` | the post-import listing goes through the same settled/failed state. Its `.catch(setStatus)` stays, the same as the other non-search callers PR #25 left alone (known risk: a failed listing there can show two messages) |
| Facet options | counts from `books` | (author/topic options also from `books`) | unchanged: options count the last successful listing (known risk under a failed listing) |

No product edit is planned beyond the merge. If a check below finds a defect in the combination, it is fixed in its own commit
and every affected check reruns on the final head.

## Criteria → evidence

Packaged = the debug `.deb` built from the tested head, binary extracted and driven by tauri-driver/WebKitWebDriver under Xvfb,
fresh XDG app-data per run, temp synthetic libraries. Linux only.

| # | Criterion (source) | Check | Evidence |
|---|---|---|---|
| B1 | Baseline bug reproduces: server-filtered `books=[]` for a non-empty unmatched query leaves a blank grid (coordinator-confirmed) | new combined journey against the PR #24 build (`1035101`, product = `58aebe4`) | exit 1 at the zero-match step, view JSON, screenshot |
| B2 | Neither source alone delivers the combined journey | same journey against the PR #25 build (`5f4fc33`, product = `c2e157f`) | exit 1 at the catalog import step (no Import catalog) |
| I1 | PBK-19 C1: one Markdown entry per normalized unique title+author | combined journey: ~1700-row synthetic sheet imported through the panel; file count = unique identities; Rust test on a ~1700-row representative sheet | journey report, `cargo test` |
| I2 | PBK-19 C2: YAML keeps title/author/date/type/topics/recommendation/rating/status; Latticework body kept | journey parses sampled profiles on disk; Rust test round-trips every row | as above |
| I3 | PBK-19 C3: Downloaded→available, Need to read now→queued, other/empty→wishlist | journey status counts (panel Status table, facet counts, on-disk frontmatter); Rust test | as above |
| I4 | PBK-19 C4: duplicate normalized title+author collapses; rerun creates nothing, existing bytes and mtimes unchanged | journey: in-sheet case/space duplicates, rerun before and after restart, digest of the library | as above |
| I5 | PBK-19 C5: rescan indexes catalog beside files; status/rating filters; title/author search; card badges match frontmatter | journey: Rescan, facets with counts, search by title and by author, badge text vs frontmatter for sampled cards | as above |
| I6 | PBK-15 search: zero match → "No books match “q”." + Clear search; Clear search recovers | journey after the catalog import (large library) | as above |
| I7 | Distinct states: empty library, query no-match, status/rating/shelf facet zero | journey; facet zero shows "Nothing here…", never the no-match message | as above |
| I8 | Restart/readback | journey relaunches the same binary: profiles, badges, facets, search and no-match state after restart | as above |
| I9 | Two libraries / isolation | journey: second library has no catalog; alpha's catalog titles are a no-match there; facets show no alpha statuses; alpha intact after switching back; alpha bytes unchanged | as above |
| I10 | Rapid query cancellation/replacement | journey types a burst of queries without waiting; the final view answers the final query; a DOM observer records every state; no-match is never shown for a query other than the field's or while loading | as above |
| I11 | Failed listing and recovery | journey (DAC capabilities dropped): unreadable library during a search → alert naming the search, no no-match, no cards; access back → recovers with catalog results | as above |
| I12 | Loading message truthfulness | observer: "Loading your library…" never shown with a no-match/empty/failure state, and gone once settled (also after the large listing and the post-import refresh); panel shows "Working…" only while the import runs | as above |
| I13 | Overlap negative control | integrated build with one plausible wrong resolution (no-match decided from `visible` instead of `books`, which merges facet zero into search zero) | combined journey exits 1 at the facet-zero step; restored → pass |
| R1 | Prior protections keep passing (library isolation, annotations/export source bytes/locations, legacy-metadata no-clobber) | existing packaged journeys on the same final binary: catalog import, search states, smoke ×2, reading, highlights, libraries, upgrade, injected failures | logs with exit codes |
| R2 | Rust/frontend/MCP/build checks | `cargo test`, `tsc --noEmit`, `fixtures:check`, `mcp npm test`, `tauri build --debug --bundles deb`; exact-head CI | logs, CI run |

Unsupported here (reported, not claimed): native Windows installer/WebView2/access (coordinator-owned, deferred); the owner's
actual export and the existing real-library migration (never run; no count or compatibility asserted). No real data. No new
identity or migration policy.

Non-goals: new features, search ranking, changes to import identity/status mapping, decisions D1-D6 (left to the coordinator as
reported in PR #24), Direct writes, Agent Pass.
