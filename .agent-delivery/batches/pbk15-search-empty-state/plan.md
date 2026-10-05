# PBK-15 search empty-state review repair — plan (written before implementation)

Dispatch: coordinator, 5 Oct 2026 MYT. Objective 2 of 2 (final) of this chat; PBK-19 (PR #24) was objective 1, and review
feedback set the cap to 2. Coordinator owns the Direct PBK-15/PBK-19 claims. Runtime re-verified with `get_session`: configured,
`session_context.model` and `last_served_model` all `claude-opus-5-5` (worker epoch 3).

Base: `fee7d17c1f4831b4b36f3c2a4b6b1235ebb409d4` (PR #22 head, `claude/pbk15-pbk26-integration`). New branch
`claude/pbk15-search-empty-state`; draft PR against PR #22's branch, explicitly stacked and unmerged. PR #22 and PR #24 branches
are not modified.

## Finding (coordinator-confirmed; reproduced here before the fix)

`LibraryView` fills `books` from the server-filtered `list_books(query)`. A non-empty query with no match returns `[]`:

- the empty-library note requires `!query`;
- the no-results line requires `visible.length === 0 && books.length > 0`.

Both are false, so the grid is blank and only "0 items" shows. The same code is in PR #24 (`LibraryView.tsx` around lines
458/593 there).

## Repair (bounded to this view; no new features)

The view records which query the shown listing answers (`listedQuery`) and whether that request failed (`listError`). The
states are then decided from that result only:

| State | Condition | Shown |
|---|---|---|
| Loading / typing | the request for the current query has not completed | "Loading your library…" (as before); no empty or no-results message |
| Empty library | settled, no query, 0 books | existing note "No books were found in … yet" (unchanged) |
| Search, no match | settled, query, 0 books | "No books match “q”." with a Clear search button |
| Filters hide everything | settled, books > 0, 0 visible | existing "Nothing here…" line (unchanged) |
| Failed request | the latest request for the current query failed | alert naming the search/library and the error; no "no results"; previous cards are not shown as if they matched |

Clearing or replacing the query issues a new request and recovers. Library isolation, filters, chips and the debounce are
unchanged; the workspace remounts per library as before.

## Action -> expected -> evidence

| # | Action | Expected | Evidence |
|---|---|---|---|
| R1 | Packaged app (fee7d17 build), search a term with no match | blank grid: the defect reproduces | new journey `search-states.e2e.mjs` fails against the base build (exit 1, step and screenshot) |
| R2 | Same journey on the repaired build: zero-match search | "No books match “q”", "0 items", no empty-library note | journey pass |
| R3 | Clear search (button and emptied field); then a valid search | full grid back; matching cards only | journey |
| R4 | Valid -> zero -> valid while observing the DOM | no-results never shown during loading or for a query other than the settled one | MutationObserver record in the journey |
| R5 | Shelf chip with no members (facet-filtered zero) | existing "Nothing here" line, distinct from search no-results | journey |
| R6 | Empty library folder: no query, then a query, then clear | empty-library note; then "No books match"; then the note again | journey |
| R7 | Two libraries: zero-match in A, switch to B, search in B, back to A | each library shows only its own results/messages; query does not leak | journey |
| R8 | List request fails (library folder made unreadable) during a search | alert names the failed search; no "No books match"; restoring access and searching again recovers | journey (non-root or capsh) |
| R9 | No regression | `tsc`, `cargo test`, `fixtures:check`, packaged smoke x2, reading, highlights, libraries, upgrade, failures on the same build | logs with exits; exact-head CI |

Non-goals: search ranking, new filters, backend search changes, PR #24 features.
