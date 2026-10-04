# PBK-24 desktop reading journey — criterion → check map (written before implementation)

Dispatch: pbk-fresh-reader-20261004 (coordinator claim codex-product-coordinator, PBK-24 v6).
Base: main f2672f289a2972ce88e1ba0a01173271b8de97ae. Branch: claude/jolly-wright-dxg02n
(session-designated branch name; it carries no issue key — PR title/body carry PBK-24).

Entry point for every check: the packaged Linux debug binary extracted from
`tauri build --debug --bundles deb`, driven through tauri-driver/WebKitWebDriver
against a fresh temp app-data + a temp copy of the committed synthetic fixtures.
UI actions are real DOM clicks/key events in the webview; persistence assertions
read the sidecar JSON files on disk from Node (not only through the app).

| # | Criterion | Action | Expected visible result | Persistence result | Failure/recovery |
|---|---|---|---|---|---|
| 1 | Open EPUB + PDF from the actual grid and paginate | click card Read buttons; Next/Prev buttons; ArrowRight/Left; PDF page input; Fit width | EPUB iframe renders, CFI advances; PDF page counter/canvas changes, fit-width widens canvas | sidecar `position` changes on disk | corrupt PDF and 0-byte EPUB open to an actionable error; app stays usable |
| 2 | Non-initial positions survive close/reopen, restart of same binary, index rebuild | save EPUB CFI (page>1) + PDF page 3; close tab, reopen; quit + relaunch; delete app-data index (library.db) + re-index same folder; in-app Rescan | reader reopens at the exact saved CFI / page | `<library>/.properbooky/state/*.json` holds same position; app-data contains only the index | corrupt sidecar preserved (not clobbered), unwritable sidecar surfaces an error and the reader keeps working |
| 3 | Ribbon and filters reflect state; keyboard tab/close/navigation | ribbon width vs sidecar percent; shelf chips (Wishlist, Up next, Continue reading, Finished, On the shelf); keyboard focus tab rail, arrows between tabs, Enter activates, close by keyboard | ribbon width ≈ percent; filter counts/titles match catalog statuses | ribbon restored from sidecar percent after restart | closing the active tab by keyboard leaves focus on a live tab |
| 4 | Linked catalog/file entry rendered once, opens correct file | catalog md with `file:` link to a fixture PDF | one card (catalog title), no duplicate file card; Read opens the linked PDF | position written to that file's sidecar | catalog entry whose file is missing shows "File missing" and no Read |

Rapid switch/close: open both books, switch tabs repeatedly and close a tab while
it is still loading; assert no reader error, no position written to the wrong book.

Platform boundary: Linux (Xvfb, WebKitGTK) only. Windows installed-app (WebView2,
NSIS/MSI, known-folder app-data) remains coordinator work.
