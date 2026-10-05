//! PBK-21 synthetic gap probe (design evidence only; not a product test).
//!
//! Every scenario builds a fresh synthetic library under the directory given
//! as the first argument (default: the OS temp dir), drives the real
//! `desktop_lib` code exactly as the Tauri commands do, and records what it
//! observed. Verdicts:
//!   HOLDS  - the criterion/invariant holds today for this scenario
//!   GAP    - it does not hold (an expected finding, not a probe failure)
//!   INFO   - a measured behaviour that needs a decision, not a pass/fail
//!   STATIC - established by source inspection, not by execution
//! The probe exits 0 when every scenario ran; nonzero only if a scenario
//! could not be executed at all. Results go to stdout and `results.json`.
//!
//! The `acquisition_queue` Tauri command is a private fn in lib.rs that needs
//! an AppHandle, so `queue_mirror` below re-states its body (lib.rs 625-671 at
//! 82c573a) line for line over the public `library::list`. That mirror is
//! labelled as such in every queue result.

use anyhow::{Context, Result};
use desktop_lib::{acquire, catalog, db, library, matcher};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
struct Check {
    id: &'static str,
    area: &'static str,
    criterion: &'static str,
    expected: String,
    observed: String,
    verdict: &'static str,
}

struct Probe {
    base: PathBuf,
    checks: Vec<Check>,
}

struct Lib {
    root: PathBuf,
    db: PathBuf,
}

impl Probe {
    fn lib(&self, name: &str) -> Result<Lib> {
        let dir = self.base.join(name);
        let _ = fs::remove_dir_all(&dir);
        let root = dir.join("library");
        fs::create_dir_all(root.join("Catalog"))?;
        fs::create_dir_all(root.join("Drop"))?;
        Ok(Lib {
            root,
            // The index lives outside the library folder, as app-data does.
            db: dir.join("index.db"),
        })
    }

    fn record(
        &mut self,
        id: &'static str,
        area: &'static str,
        criterion: &'static str,
        expected: impl Into<String>,
        observed: impl Into<String>,
        verdict: &'static str,
    ) {
        let c = Check {
            id,
            area,
            criterion,
            expected: expected.into(),
            observed: observed.into(),
            verdict,
        };
        println!("[{:6}] {} {}: {}", c.verdict, c.id, c.criterion, c.observed);
        self.checks.push(c);
    }
}

fn entry(root: &Path, file: &str, front: &str) -> Result<PathBuf> {
    let path = root.join("Catalog").join(file);
    fs::write(&path, format!("---\n{front}---\n"))?;
    Ok(path)
}

fn drop_file(root: &Path, name: &str, bytes: &[u8]) -> Result<PathBuf> {
    let path = root.join("Drop").join(name);
    fs::write(&path, bytes)?;
    Ok(path)
}

/// The `process_drop` Tauri command: scan, process, scan.
fn process_command(lib: &Lib) -> Result<acquire::DropReport> {
    let conn = db::open(&lib.db)?;
    desktop_lib::scanner::scan_library(&conn, &lib.root)?;
    let report = acquire::process_drop(&conn, &lib.root)?;
    desktop_lib::scanner::scan_library(&conn, &lib.root)?;
    Ok(report)
}

fn outcomes(r: &acquire::DropReport) -> String {
    r.outcomes
        .iter()
        .map(|o| {
            format!(
                "{} -> {}{}",
                o.filename,
                o.result,
                o.destination
                    .as_deref()
                    .map(|d| format!(" ({d})"))
                    .unwrap_or_default()
            )
        })
        .collect::<Vec<_>>()
        .join("; ")
}

/// Mirror of the `acquisition_queue` command body (lib.rs 631-669 @ 82c573a).
fn queue_mirror(conn: &rusqlite::Connection, root: &Path, limit: i64) -> Result<Vec<library::Book>> {
    let mut books = library::list(conn, root, None)?;
    books.retain(|b| {
        b.kind == "catalog" && b.details.want_to_read && b.details.availability != "local"
    });
    let year: i64 = conn.query_row("SELECT CAST(strftime('%Y','now') AS INTEGER)", [], |r| {
        r.get(0)
    })?;
    for b in &mut books {
        let age = b
            .year
            .map(|y| ((year - y).clamp(0, 120) as f64) / 120.0)
            .unwrap_or(0.3);
        b.priority = Some(
            0.35 * age
                + 0.25 * (b.recommended as u8 as f64)
                + 0.25 * (b.rating.unwrap_or(3) as f64) / 5.0
                + 0.15
                    * match b.spectrum.as_deref() {
                        Some("original") => 1.0,
                        Some("novel") => 0.6,
                        Some("collection") => 0.3,
                        _ => 0.5,
                    },
        );
    }
    books.sort_by(|a, b| {
        b.details
            .up_next
            .cmp(&a.details.up_next)
            .then_with(|| {
                b.priority
                    .partial_cmp(&a.priority)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .then_with(|| a.title.cmp(&b.title))
    });
    books.truncate(limit.clamp(1, 100) as usize);
    Ok(books)
}

fn queue_sql(conn: &rusqlite::Connection, limit: i64) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(acquire::QUEUE_SQL)?;
    let rows = stmt
        .query_map([limit], |r| r.get::<_, String>(3))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

fn titles(books: &[library::Book]) -> Vec<String> {
    books.iter().map(|b| b.title.clone()).collect()
}

fn parsed(path: &Path) -> Result<catalog::CatalogEntry> {
    Ok(catalog::parse(&fs::read_to_string(path)?)
        .context("entry no longer parses")?
        .0)
}

// ---------------------------------------------------------------- queue --

fn queue_checks(p: &mut Probe) -> Result<()> {
    // Q1: ranking rule. Live criterion: recommendation weight x rating, desc.
    let lib = p.lib("q1-rank")?;
    entry(&lib.root, "A.md", "title: Alpha Recommended Three\nauthor: Synthetic A\nstatus: wishlist\nrating: 3\nrecommendation: friend\nyear: 2020\n")?;
    entry(&lib.root, "B.md", "title: Beta Classic Five\nauthor: Synthetic B\nstatus: wishlist\nrating: 5\nyear: 1900\n")?;
    let conn = db::open(&lib.db)?;
    desktop_lib::scanner::scan_library(&conn, &lib.root)?;
    let mirror = queue_mirror(&conn, &lib.root, 10)?;
    let sql = queue_sql(&conn, 10)?;
    let shown: Vec<String> = mirror
        .iter()
        .map(|b| format!("{} {:.3}", b.title, b.priority.unwrap_or(-1.0)))
        .collect();
    let first = mirror.first().map(|b| b.title.as_str()).unwrap_or("");
    p.record(
        "Q1",
        "queue",
        "sorted by recommendation weight x rating, descending",
        "Alpha (rec 1 x 3 = 3) before Beta (rec 0 x 5 = 0)",
        format!("command mirror order: {shown:?}; QUEUE_SQL order: {sql:?} (PBK-29 v2 formula: 0.35 lindy + 0.25 rec + 0.25 rating + 0.15 spectrum)"),
        if first == "Alpha Recommended Three" { "HOLDS" } else { "GAP" },
    );

    // Q2: top 10 and exclusion of lower-ranked + non-wishlist entries.
    let lib = p.lib("q2-top10")?;
    for i in 0..12 {
        // Exactly two rating-1 rows (00, 01); the rest 2..5. Everything else
        // equal, so rating decides and 00/01 are the two lowest-ranked.
        let rating = if i < 2 { 1 } else { (i % 4) + 2 };
        entry(
            &lib.root,
            &format!("W{i:02}.md"),
            &format!("title: Wish {i:02}\nauthor: Synthetic W\nstatus: wishlist\nrating: {rating}\nyear: 2000\n"),
        )?;
    }
    fs::create_dir_all(lib.root.join("Library/Owned"))?;
    fs::write(lib.root.join("Library/Owned/Synthetic O - Owned Book.pdf"), b"%PDF-1.4 owned")?;
    entry(&lib.root, "O.md", "title: Owned Book\nauthor: Synthetic O\nstatus: available\nrating: 5\nfile: Library/Owned/Synthetic O - Owned Book.pdf\n")?;
    entry(&lib.root, "D.md", "title: Done Book\nauthor: Synthetic D\nstatus: done\nrating: 5\n")?;
    let conn = db::open(&lib.db)?;
    desktop_lib::scanner::scan_library(&conn, &lib.root)?;
    let q = queue_mirror(&conn, &lib.root, 10)?;
    let names = titles(&q);
    let excluded_low = !names.iter().any(|t| t == "Wish 00" || t == "Wish 01"); // rating 1
    let excludes_other = !names.iter().any(|t| t == "Owned Book" || t == "Done Book");
    p.record(
        "Q2",
        "queue",
        "today's top 10; lower-ranked entries excluded",
        "10 rows; both rating-1 wishlist rows and the owned/done rows absent",
        format!("{} rows: {names:?}", q.len()),
        if q.len() == 10 && excluded_low && excludes_other { "HOLDS" } else { "GAP" },
    );

    // Q3: queued status. The UI's "Search & queue" calls update_book with
    // up_next=true (curation.json), not set_catalog_status.
    let w11 = q.iter().map(|b| b.title.clone()).collect::<Vec<_>>();
    let mut all = library::list(&conn, &lib.root, None)?;
    all.retain(|b| b.title == "Wish 01");
    let book = all.first().context("Wish 01 missing")?;
    let mut edit = library::Edit::from(book);
    edit.want_to_read = true;
    edit.up_next = true;
    library::update(&conn, &lib.root, &book.details.stable_id.clone(), edit)?;
    let after = queue_mirror(&conn, &lib.root, 10)?;
    let md_status = parsed(&lib.root.join("Catalog/W01.md"))?.status;
    let sql_after = queue_sql(&conn, 10)?;
    let pinned_cmd = after.first().map(|b| b.title.as_str()) == Some("Wish 01");
    let pinned_sql = sql_after.first().map(String::as_str) == Some("Wish 01");
    p.record(
        "Q3",
        "queue",
        "queued status shown and pinned (UI path: update_book up_next)",
        "queued entry pinned first in the shipped command; one source of truth for 'queued'",
        format!(
            "command mirror first={:?} (pinned={pinned_cmd}); markdown status still {md_status:?}; QUEUE_SQL first={:?} (pinned={pinned_sql}); before={:?}",
            after.first().map(|b| &b.title),
            sql_after.first(),
            w11.first()
        ),
        if pinned_cmd && pinned_sql { "HOLDS" } else if pinned_cmd { "INFO" } else { "GAP" },
    );

    // Q4: "today" stability. Acquire (file) one top-10 book; does the list
    // for the same day change membership?
    let before: Vec<String> = titles(&queue_mirror(&conn, &lib.root, 10)?);
    let target = before.get(1).cloned().unwrap_or_default();
    drop_file(&lib.root, &format!("Synthetic W - {target}.pdf"), b"%PDF-1.4 w")?;
    let _ = process_command(&lib)?;
    let conn = db::open(&lib.db)?;
    let after: Vec<String> = titles(&queue_mirror(&conn, &lib.root, 10)?);
    let entered: Vec<&String> = after.iter().filter(|t| !before.contains(t)).collect();
    let left: Vec<&String> = before.iter().filter(|t| !after.contains(t)).collect();
    p.record(
        "Q4",
        "queue",
        "today's list is a stable daily set (day rollover / carry-over)",
        "decision needed: fixed daily snapshot vs live recompute",
        format!("after filing {target:?}: left={left:?} entered={entered:?}; no date/snapshot is persisted anywhere (recomputed on every panel open)"),
        "INFO",
    );

    // Q5: search link (source inspection of AcquirePanel.tsx).
    let tsx = fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../../desktop/src/AcquirePanel.tsx"),
    )?;
    let url = tsx
        .lines()
        .find(|l| l.contains("openUrl("))
        .map(str::trim)
        .unwrap_or("")
        .to_owned();
    let swallow = tsx.contains("openUrl(") && tsx.contains(".catch(() => {});");
    p.record(
        "Q5",
        "queue",
        "clickable search link per entry",
        "a link per row; target and failure handling decided",
        format!("{url} (hard-coded external target; opener failure swallowed={swallow}; entry is still marked queued when the opener fails)"),
        "STATIC",
    );
    Ok(())
}

// ----------------------------------------------------------------- drop --

fn drop_checks(p: &mut Probe) -> Result<()> {
    // D1/D2/D10/D11: happy path, destination, restart, reversibility.
    let lib = p.lib("d1-happy")?;
    let md = entry(&lib.root, "Ada Synthetic - Deep Learning Foundations Handbook.md", "title: Deep Learning Foundations Handbook\nauthor: Ada Synthetic\nstatus: queued\ntopics:\n- Machine Learning\n")?;
    let original = "Ada Synthetic - Deep Learning Foundations Handbook (2019, Fixture Press) - libgen.li.EPUB";
    drop_file(&lib.root, original, b"PK synthetic epub bytes")?;
    let conn = db::open(&lib.db)?;
    desktop_lib::scanner::scan_library(&conn, &lib.root)?;
    let pre_id: Option<String> = conn
        .query_row("SELECT stable_id FROM books WHERE kind='file'", [], |r| r.get(0))
        .ok();
    drop(conn);
    let report = process_command(&lib)?;
    let e = parsed(&md)?;
    let linked = e.file.clone().unwrap_or_default();
    let linked_path = lib.root.join(&linked);
    let hash_ok = e.hash.as_deref() == matcher::sha256_file(&linked_path).ok().as_deref();
    p.record(
        "D1",
        "drop",
        "match, rename Author - Title.ext, link, set available",
        "filed; name 'Ada Synthetic - Deep Learning Foundations Handbook.EPUB' (extension preserved); status available; hash of the filed file",
        format!(
            "{}; file={linked:?}; status={}; hash matches={hash_ok}; original_filename={:?}",
            outcomes(&report),
            e.status,
            e.original_filename
        ),
        if report.filed == 1 && e.status == "available" && hash_ok { "HOLDS" } else { "GAP" },
    );
    p.record(
        "D1x",
        "drop",
        "rename preserves the extension",
        ".EPUB kept as dropped (or a decided normalisation)",
        format!("extension written: {:?}", Path::new(&linked).extension()),
        if linked.ends_with(".EPUB") { "HOLDS" } else { "INFO" },
    );
    p.record(
        "D2",
        "drop",
        "move into the entry's category folder",
        "a folder derived from the entry's category (topics: Machine Learning)",
        format!("filed under {:?}", Path::new(&linked).parent()),
        if linked.contains("Machine Learning") { "HOLDS" } else { "GAP" },
    );
    // Restart: brand-new connection, rescan, list.
    let conn = db::open(&lib.db)?;
    desktop_lib::scanner::scan_library(&conn, &lib.root)?;
    let books = library::list(&conn, &lib.root, None)?;
    let card = books.iter().find(|b| b.title == "Deep Learning Foundations Handbook");
    let drop_cards = books.iter().filter(|b| b.path.contains("/Drop/")).count();
    let post_id = card.and_then(|b| b.details.asset_id.clone());
    p.record(
        "D10",
        "drop",
        "state survives restart/rescan; one card; asset identity kept",
        "available + local after rescan; no Drop card; asset id == id the dropped file had",
        format!(
            "status={:?} availability={:?} cards_in_Drop={drop_cards} asset_id_kept={}",
            card.and_then(|b| b.status.clone()),
            card.map(|b| b.details.availability.clone()),
            pre_id.is_some() && pre_id == post_id
        ),
        if card.is_some_and(|b| b.details.availability == "local") && drop_cards == 0 { "HOLDS" } else { "GAP" },
    );
    let back = lib.root.join("Drop").join(e.original_filename.clone().unwrap_or_default());
    p.record(
        "D11",
        "drop",
        "reversible original name",
        "original name + original folder recorded; an undo path exists",
        format!(
            "original_filename recorded={}; original folder recorded=false (implied Drop/); restore target free={}; no undo command for a Drop filing",
            e.original_filename.is_some(),
            !back.exists()
        ),
        "INFO",
    );

    // D3: queued before other wishlist when both fit the same file.
    let lib = p.lib("d3-queued-first")?;
    let q = entry(&lib.root, "Q.md", "title: Signal Patterns\nauthor: Rhea Queue\nstatus: queued\n")?;
    let w = entry(&lib.root, "W.md", "title: Signal Patterns\nauthor: Omar Wish\nstatus: wishlist\n")?;
    drop_file(&lib.root, "Signal Patterns.pdf", b"%PDF-1.4 sp")?;
    let report = process_command(&lib)?;
    p.record(
        "D3",
        "drop",
        "Drop files match queued entries before other wishlist",
        "the queued entry wins a tie, or the tie is explicitly sent to review by design",
        format!(
            "{}; queued linked={}; wishlist linked={} (candidate set ignores status/up_next)",
            outcomes(&report),
            parsed(&q)?.file.is_some(),
            parsed(&w)?.file.is_some()
        ),
        if parsed(&q)?.file.is_some() { "HOLDS" } else { "GAP" },
    );
    // D3b: a non-wishlist entry without a file is also a candidate.
    let lib = p.lib("d3b-done-entry")?;
    let d = entry(&lib.root, "D.md", "title: Finished Fixture Without File\nauthor: Synthetic Done\nstatus: done\n")?;
    drop_file(&lib.root, "Synthetic Done - Finished Fixture Without File.pdf", b"%PDF-1.4 d")?;
    let report = process_command(&lib)?;
    p.record(
        "D3b",
        "drop",
        "which statuses Drop may link",
        "decision: only wishlist/queued, or any entry without a file",
        format!("{}; status after={:?}", outcomes(&report), parsed(&d)?.status),
        "INFO",
    );

    // D4: collision handling (no overwrite).
    let lib = p.lib("d4-collision")?;
    entry(&lib.root, "C.md", "title: Collision Fixture Title\nauthor: Synthetic C\nstatus: wishlist\n")?;
    let inbox = lib.root.join("Library/00 Inbox");
    fs::create_dir_all(&inbox)?;
    let occupant = inbox.join("Synthetic C - Collision Fixture Title.pdf");
    fs::write(&occupant, b"%PDF-1.4 OCCUPANT")?;
    let dropped = drop_file(&lib.root, "Synthetic C - Collision Fixture Title (Z-Library).pdf", b"%PDF-1.4 NEW")?;
    let report = process_command(&lib)?;
    let kept = fs::read(&occupant)? == b"%PDF-1.4 OCCUPANT" && fs::read(&dropped)? == b"%PDF-1.4 NEW";
    p.record(
        "D4",
        "drop",
        "collision never overwrites",
        "occupant and dropped file both byte-identical; dropped file left with a reason",
        format!("{}; both intact={kept}", outcomes(&report)),
        if kept { "HOLDS" } else { "GAP" },
    );
    // D4b: identical duplicate download.
    let lib = p.lib("d4b-duplicate")?;
    let md = entry(&lib.root, "X.md", "title: Duplicate Download Fixture\nauthor: Synthetic X\nstatus: queued\n")?;
    drop_file(&lib.root, "Synthetic X - Duplicate Download Fixture.pdf", b"%PDF-1.4 same")?;
    drop_file(&lib.root, "Synthetic X - Duplicate Download Fixture (1).pdf", b"%PDF-1.4 same")?;
    let r1 = process_command(&lib)?;
    let r2 = process_command(&lib)?;
    let left_in_drop = fs::read_dir(lib.root.join("Drop"))?.count();
    p.record(
        "D6",
        "drop",
        "duplicate events / re-run are idempotent",
        "run 2 changes nothing; one link; the duplicate is not filed twice",
        format!(
            "run1: {}; run2: {} (filed={}); linked={:?}; files still in Drop={left_in_drop}",
            outcomes(&r1),
            outcomes(&r2),
            r2.filed,
            parsed(&md)?.file
        ),
        if r2.filed == 0 { "HOLDS" } else { "GAP" },
    );

    // D5: partial-file arrival.
    let lib = p.lib("d5-partial")?;
    let md = entry(&lib.root, "P.md", "title: Partial Arrival Fixture Volume\nauthor: Synthetic P\nstatus: queued\n")?;
    drop_file(&lib.root, "Synthetic P - Partial Arrival Fixture Volume.pdf.part", b"%PDF")?;
    drop_file(&lib.root, "Synthetic P - Partial Arrival Fixture Volume.crdownload", b"%PDF")?;
    let r0 = process_command(&lib)?;
    p.record(
        "D5a",
        "drop",
        "browser temp files (.part/.crdownload) are not touched",
        "ignored",
        format!("filed={} left={} outcomes=[{}]", r0.filed, r0.left, outcomes(&r0)),
        if r0.filed == 0 { "HOLDS" } else { "GAP" },
    );
    fs::remove_file(lib.root.join("Drop/Synthetic P - Partial Arrival Fixture Volume.pdf.part"))?;
    fs::remove_file(lib.root.join("Drop/Synthetic P - Partial Arrival Fixture Volume.crdownload"))?;
    drop_file(&lib.root, "Synthetic P - Partial Arrival Fixture Volume.pdf", b"%PDF-1.4 first half")?;
    let r1 = process_command(&lib)?;
    let e = parsed(&md)?;
    let filed = lib.root.join(e.file.clone().unwrap_or_default());
    // The downloader keeps writing to its open handle (same inode on Unix).
    if filed.is_file() {
        use std::io::Write;
        fs::OpenOptions::new().append(true).open(&filed)?.write_all(b" second half %%EOF")?;
    }
    let stale = e.hash.as_deref() != matcher::sha256_file(&filed).ok().as_deref();
    p.record(
        "D5b",
        "drop",
        "a file still being written in place is not filed",
        "left until size/mtime are stable (or a quiet period passes)",
        format!("{}; recorded hash stale after the write completed={stale}", outcomes(&r1)),
        if r1.filed == 0 { "HOLDS" } else { "GAP" },
    );
    let lib = p.lib("d5c-empty")?;
    entry(&lib.root, "Z.md", "title: Zero Byte Fixture Volume\nauthor: Synthetic Z\nstatus: queued\n")?;
    drop_file(&lib.root, "Synthetic Z - Zero Byte Fixture Volume.epub", b"")?;
    let r = process_command(&lib)?;
    p.record(
        "D5c",
        "drop",
        "an empty/invalid file is not filed as the book",
        "left with a reason",
        outcomes(&r),
        if r.filed == 0 { "HOLDS" } else { "GAP" },
    );

    // D7: failure after the move (dangling symlink: rename succeeds, hashing fails).
    let lib = p.lib("d7-midbatch-failure")?;
    let a = entry(&lib.root, "A.md", "title: Broken Link Fixture Title\nauthor: Synthetic F\nstatus: queued\n")?;
    let b = entry(&lib.root, "B.md", "title: Healthy Neighbour Fixture Title\nauthor: Synthetic H\nstatus: queued\n")?;
    #[cfg(unix)]
    std::os::unix::fs::symlink(
        p.base.join("does-not-exist.pdf"),
        lib.root.join("Drop/Synthetic F - Broken Link Fixture Title.pdf"),
    )?;
    drop_file(&lib.root, "Synthetic H - Healthy Neighbour Fixture Title.pdf", b"%PDF-1.4 h")?;
    let conn = db::open(&lib.db)?;
    desktop_lib::scanner::scan_library(&conn, &lib.root)?;
    let result = acquire::process_drop(&conn, &lib.root);
    let moved = lib.root.join("Library/00 Inbox/Synthetic F - Broken Link Fixture Title.pdf");
    p.record(
        "D7",
        "drop",
        "a failure after a move is recoverable (no orphan, batch report kept)",
        "file back in Drop or linked; other files still processed; report returned",
        format!(
            "result={}; broken file moved out of Drop={}; its entry linked={}; neighbour linked={}",
            match &result {
                Ok(r) => format!("Ok(filed={})", r.filed),
                Err(e) => format!("Err({e})"),
            },
            moved.symlink_metadata().is_ok(),
            parsed(&a)?.file.is_some(),
            parsed(&b)?.file.is_some()
        ),
        if result.is_ok() && parsed(&a)?.file.is_some() == moved.symlink_metadata().is_ok() { "HOLDS" } else { "GAP" },
    );

    // D7c: process killed between the move and the catalog write (simulated
    // by performing exactly process_drop's rename step, then stopping).
    let lib = p.lib("d7c-crash-after-move")?;
    let c = entry(&lib.root, "C.md", "title: Crash Window Fixture Title\nauthor: Synthetic K\nstatus: queued\n")?;
    drop_file(&lib.root, "Synthetic K - Crash Window Fixture Title (Z-Library).pdf", b"%PDF-1.4 c")?;
    let conn = db::open(&lib.db)?;
    desktop_lib::scanner::scan_library(&conn, &lib.root)?;
    drop(conn);
    let inbox = lib.root.join("Library/00 Inbox");
    fs::create_dir_all(&inbox)?;
    fs::rename(
        lib.root.join("Drop/Synthetic K - Crash Window Fixture Title (Z-Library).pdf"),
        inbox.join("Synthetic K - Crash Window Fixture Title.pdf"),
    )?;
    let r = process_command(&lib)?; // restart + next Drop run
    let conn = db::open(&lib.db)?;
    let books = library::list(&conn, &lib.root, None)?;
    let profile = books.iter().find(|b| b.kind == "catalog" && b.title == "Crash Window Fixture Title");
    let loose = books.iter().filter(|b| b.kind == "file" && b.path.contains("00 Inbox")).count();
    p.record(
        "D7c",
        "drop",
        "restart after a crash mid-filing converges (journal/recovery)",
        "next run links the moved file (or moves it back); original name not lost",
        format!(
            "next run: filed={} [{}]; entry linked={}; original name recorded anywhere={}; profile availability={:?}; unlinked Inbox file cards={loose}",
            r.filed,
            outcomes(&r),
            parsed(&c)?.file.is_some(),
            parsed(&c)?.original_filename.is_some(),
            profile.map(|b| b.details.availability.clone())
        ),
        if parsed(&c)?.file.is_some() { "HOLDS" } else { "GAP" },
    );

    // D7b: a name the filesystem rejects (> 255 bytes) poisons the batch.
    let lib = p.lib("d7b-long-name")?;
    // 30 identical 4-character CJK words: every title token is in the file
    // name, so it auto-matches; the 120-char "Author - Title" is > 255 bytes.
    let long_title: String = vec!["書書書書"; 30].join(" ");
    entry(&lib.root, "L.md", &format!("title: {long_title}\nauthor: 著者\nstatus: queued\n"))?;
    let other = entry(&lib.root, "N.md", "title: Normal Neighbour Fixture Book\nauthor: Synthetic N\nstatus: queued\n")?;
    drop_file(&lib.root, "著者 - 書書書書.pdf", b"%PDF-1.4 l")?;
    drop_file(&lib.root, "Synthetic N - Normal Neighbour Fixture Book.pdf", b"%PDF-1.4 n")?;
    let conn = db::open(&lib.db)?;
    desktop_lib::scanner::scan_library(&conn, &lib.root)?;
    let result = acquire::process_drop(&conn, &lib.root);
    let proposed = catalog::entry_filename(&long_title, Some("著者"));
    p.record(
        "D7b",
        "drop",
        "one unfileable name does not block the batch",
        "that file left with a reason; the neighbour still filed",
        format!(
            "proposed name {} bytes; result={} (the whole report is lost); neighbour linked={} (depends on directory order)",
            proposed.len() - 3 + 4,
            match &result {
                Ok(r) => outcomes(r),
                Err(e) => format!("Err({e})"),
            },
            parsed(&other)?.file.is_some()
        ),
        if result.is_ok() { "HOLDS" } else { "GAP" },
    );

    // D8: traversal / unsafe titles stay inside the inbox.
    let lib = p.lib("d8-traversal")?;
    let titles = [
        ("T1.md", "../../Escaped Outside Fixture", "Trav One"),
        ("T2.md", "..\\\\..\\\\Escaped Backslash Fixture", "Trav Two"),
        ("T3.md", "/abs/Absolute Path Fixture", "Trav Three"),
    ];
    for (f, t, a) in titles {
        entry(&lib.root, f, &format!("title: \"{t}\"\nauthor: {a}\nstatus: queued\n"))?;
    }
    drop_file(&lib.root, "Trav One - Escaped Outside Fixture.pdf", b"%PDF 1")?;
    drop_file(&lib.root, "Trav Two - Escaped Backslash Fixture.pdf", b"%PDF 2")?;
    drop_file(&lib.root, "Trav Three - Absolute Path Fixture.pdf", b"%PDF 3")?;
    let r = process_command(&lib)?;
    let inbox = lib.root.join("Library/00 Inbox");
    let inside = r
        .outcomes
        .iter()
        .filter_map(|o| o.destination.as_ref())
        .all(|d| lib.root.join(d).parent() == Some(inbox.as_path()));
    let escaped = lib.root.parent().map(|d| d.join("Escaped Outside Fixture.pdf").exists()).unwrap_or(false);
    p.record(
        "D8",
        "drop",
        "traversal-shaped titles cannot write outside the destination",
        "every filed path's parent is the destination folder",
        format!("{}; all inside={inside}; escaped file exists={escaped}", outcomes(&r)),
        // Traversal only: a row left for review (score) is not a traversal failure.
        if inside && !escaped && r.filed >= 1 { "HOLDS" } else { "GAP" },
    );
    // D8b: leading-dot title is filed as a hidden file the index skips.
    let lib = p.lib("d8b-hidden")?;
    let h = entry(&lib.root, "H.md", "title: \".hidden Leading Dot Fixture\"\nstatus: queued\n")?;
    drop_file(&lib.root, "hidden Leading Dot Fixture.pdf", b"%PDF h")?;
    let r = process_command(&lib)?;
    let conn = db::open(&lib.db)?;
    let assets: i64 = conn.query_row("SELECT COUNT(*) FROM books WHERE kind='file'", [], |r| r.get(0))?;
    p.record(
        "D8b",
        "drop",
        "filed name is a normal visible file",
        "no leading dot (the scanner skips dot-files)",
        format!("{}; file={:?}; indexed asset rows={assets}", outcomes(&r), parsed(&h)?.file),
        if parsed(&h)?.file.as_deref().is_some_and(|f| !f.contains("/.")) { "HOLDS" } else { "GAP" },
    );

    // D9: library binding. A symlink in Drop pointing outside the library.
    let lib = p.lib("d9-symlink-escape")?;
    let s = entry(&lib.root, "S.md", "title: Outside Symlink Fixture Title\nauthor: Synthetic S\nstatus: queued\n")?;
    let outside = p.base.join("d9-symlink-escape/outside-secret.pdf");
    fs::write(&outside, b"%PDF-1.4 bytes outside the library")?;
    #[cfg(unix)]
    std::os::unix::fs::symlink(&outside, lib.root.join("Drop/Synthetic S - Outside Symlink Fixture Title.pdf"))?;
    let r = process_command(&lib)?;
    let filed = parsed(&s)?.file;
    let is_link = filed
        .as_ref()
        .map(|f| lib.root.join(f).symlink_metadata().map(|m| m.file_type().is_symlink()).unwrap_or(false))
        .unwrap_or(false);
    p.record(
        "D9",
        "drop",
        "only regular files inside the bound library are filed",
        "symlink left in Drop (refused)",
        format!("{}; entry linked to a symlink that resolves outside the library={is_link}", outcomes(&r)),
        if filed.is_none() { "HOLDS" } else { "GAP" },
    );

    // D12/D13: unmatched retention + visibility; unsupported formats.
    let lib = p.lib("d12-unmatched")?;
    entry(&lib.root, "K.md", "title: Known Catalog Fixture\nauthor: Synthetic K\nstatus: wishlist\n")?;
    drop_file(&lib.root, "random-paper-2015.pdf", b"%PDF r")?;
    drop_file(&lib.root, "Synthetic K - Known Catalog Fixture.mobi", b"MOBI")?;
    let r = process_command(&lib)?;
    let conn = db::open(&lib.db)?;
    let books = library::list(&conn, &lib.root, None)?;
    let drop_cards: Vec<String> = books
        .iter()
        .filter(|b| b.path.contains("/Drop/"))
        .map(|b| b.filename.clone())
        .collect();
    p.record(
        "D12",
        "drop",
        "unmatched files stay in Drop, untouched",
        "left in place, reported",
        format!(
            "{}; still present={}; shown as Library cards meanwhile={drop_cards:?}",
            outcomes(&r),
            lib.root.join("Drop/random-paper-2015.pdf").exists()
        ),
        if lib.root.join("Drop/random-paper-2015.pdf").exists() { "HOLDS" } else { "GAP" },
    );
    p.record(
        "D13",
        "drop",
        "every Drop file gets a reported outcome",
        "the .mobi named in the report (filed or left with reason)",
        format!(
            "report mentions .mobi={}",
            r.outcomes.iter().any(|o| o.filename.ends_with(".mobi"))
        ),
        if r.outcomes.iter().any(|o| o.filename.ends_with(".mobi")) { "HOLDS" } else { "GAP" },
    );

    // D14: queue/Drop consistency for a profile whose linked file went missing.
    let lib = p.lib("d14-missing-link")?;
    let m = entry(&lib.root, "M.md", "title: Missing File Fixture Title\nauthor: Synthetic M\nstatus: wishlist\nfile: Library/Gone/Synthetic M - Missing File Fixture Title.pdf\n")?;
    let conn = db::open(&lib.db)?;
    desktop_lib::scanner::scan_library(&conn, &lib.root)?;
    let in_queue = queue_mirror(&conn, &lib.root, 10)?
        .iter()
        .any(|b| b.title == "Missing File Fixture Title");
    drop_file(&lib.root, "Synthetic M - Missing File Fixture Title.pdf", b"%PDF m")?;
    drop(conn);
    let r = process_command(&lib)?;
    p.record(
        "D14",
        "drop",
        "anything the queue asks for can be filed by Drop",
        "a re-download of a queued entry with a missing file is linked",
        format!(
            "in queue={in_queue}; {}; entry relinked={}",
            outcomes(&r),
            parsed(&m)?.file.as_deref() != Some("Library/Gone/Synthetic M - Missing File Fixture Title.pdf")
        ),
        if !in_queue || r.filed == 1 { "HOLDS" } else { "GAP" },
    );
    Ok(())
}

// -------------------------------------------------------------- matcher --

fn matcher_corpus(p: &mut Probe) -> Result<()> {
    let catalog_rows: &[(&str, Option<&str>)] = &[
        ("Dune", Some("Frank Herbert")),
        ("Dune Messiah", Some("Frank Herbert")),
        ("The Art of Computer Programming Volume 1", Some("Donald Knuth")),
        ("The Art of Computer Programming Volume 2", Some("Donald Knuth")),
        ("It", Some("Stephen King")),
        ("Deep Work", Some("Cal Newport")),
        ("Deep Work", Some("Other Author")),
        ("Thinking, Fast and Slow", Some("Daniel Kahneman")),
        ("The Culture Map", Some("Erin Meyer")),
        ("Antifragile: Things That Gain from Disorder", Some("Nassim Nicholas Taleb")),
        ("Meditations", Some("Marcus Aurelius")),
        ("Principles of Synthetic Fixture Design", None),
    ];
    let candidates: Vec<matcher::CatalogCandidate> = catalog_rows
        .iter()
        .enumerate()
        .map(|(i, (t, a))| matcher::CatalogCandidate {
            path: PathBuf::from(format!("/syn/Catalog/{i}.md")),
            title: (*t).into(),
            author: a.map(Into::into),
        })
        .collect();
    // (filename, expected catalog index or None)
    let files: &[(&str, Option<usize>)] = &[
        ("Frank Herbert - Dune.epub", Some(0)),
        ("Frank Herbert - Dune Messiah.epub", Some(1)),
        ("Dune (Z-Library).epub", Some(0)),
        ("Knuth - The Art of Computer Programming Vol 1.pdf", Some(2)),
        ("Donald Knuth - The Art of Computer Programming Volume 2 (1997, AW) - libgen.li.pdf", Some(3)),
        ("Stephen King - It.epub", Some(4)),
        ("It.epub", Some(4)),
        ("Cal Newport - Deep Work.epub", Some(5)),
        ("Deep Work.pdf", Some(5)),
        ("Daniel Kahneman - Thinking Fast and Slow.epub", Some(7)),
        ("thinking-fast-and-slow.pdf", Some(7)),
        ("The Culture Map (Erin Meyer) (Z-Library).pdf", Some(8)),
        ("Antifragile (Nassim Taleb).epub", Some(9)),
        ("Meditations - Marcus Aurelius (Penguin Classics).pdf", Some(10)),
        ("Meditations on First Philosophy - Descartes.pdf", None),
        ("Principles of Synthetic Fixture Design.pdf", Some(11)),
        ("Synthetic Fixture Design Principles 2nd Edition.pdf", Some(11)),
        ("Frank Herbert - Children of Dune.epub", None),
        ("Stephen King - The Shining.epub", None),
        ("random-paper-2015.pdf", None),
        ("Deep Learning (Goodfellow).pdf", None),
        ("The Map of Culture.pdf", None),
    ];
    let (mut auto_ok, mut auto_wrong, mut review, mut unmatched_miss, mut unmatched_ok) = (0, 0, 0, 0, 0);
    let mut wrong = Vec::new();
    let mut reviews = Vec::new();
    for (name, truth) in files {
        let row = matcher::match_file(Path::new(&format!("/syn/Drop/{name}")), &candidates);
        let (decision, picked, score) = match &row {
            Some(r) => (
                r.decision,
                r.catalog_path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .and_then(|s| s.parse::<usize>().ok()),
                r.score,
            ),
            None => (matcher::Decision::Unmatched, None, 0.0),
        };
        match decision {
            matcher::Decision::Auto if picked == *truth => auto_ok += 1,
            matcher::Decision::Auto => {
                auto_wrong += 1;
                wrong.push(format!("{name} -> {:?} ({score:.2})", picked.map(|i| catalog_rows[i].0)));
            }
            matcher::Decision::Review => {
                review += 1;
                reviews.push(format!("{name} ({score:.2})"));
            }
            matcher::Decision::Unmatched if truth.is_some() => {
                unmatched_miss += 1;
                reviews.push(format!("MISSED {name} ({score:.2})"));
            }
            matcher::Decision::Unmatched => unmatched_ok += 1,
        }
    }
    p.record(
        "M1",
        "matcher",
        "confidence: auto only when certain (22-file synthetic corpus, 12 entries)",
        "0 wrong auto-matches",
        format!(
            "auto correct={auto_ok}, auto WRONG={auto_wrong} {wrong:?}, review={review} {reviews:?}, missed (unmatched but in catalog)={unmatched_miss}, correctly unmatched={unmatched_ok}"
        ),
        if auto_wrong == 0 { "HOLDS" } else { "GAP" },
    );
    Ok(())
}

fn main() -> Result<()> {
    let base = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::temp_dir().join("pbk21-probe"));
    fs::create_dir_all(&base)?;
    let mut p = Probe { base: base.clone(), checks: Vec::new() };
    queue_checks(&mut p)?;
    drop_checks(&mut p)?;
    matcher_corpus(&mut p)?;
    let count = |v: &str| p.checks.iter().filter(|c| c.verdict == v).count();
    println!(
        "\nSUMMARY: {} checks: HOLDS={} GAP={} INFO={} STATIC={}",
        p.checks.len(),
        count("HOLDS"),
        count("GAP"),
        count("INFO"),
        count("STATIC")
    );
    let out = base.join("results.json");
    fs::write(&out, serde_json::to_vec_pretty(&p.checks)?)?;
    println!("results: {}", out.display());
    Ok(())
}
