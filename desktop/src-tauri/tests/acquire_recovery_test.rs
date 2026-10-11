//! PBK-21 Drop crash/retry recovery (G7 in
//! .agent-delivery/batches/pbk21-drop-safety/plan.md). A step observer
//! panics (a crash: nothing after that point runs) or returns an error (a
//! failed write) at each point between publishing a file and recording it in
//! the catalog; the next run, through a fresh connection like a restarted
//! app, must converge. Synthetic libraries only.
use desktop_lib::{acquire, catalog, db, library, matcher, scanner};
use std::fs;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};

const PDF: &[u8] = b"%PDF-1.4\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n";
const DROPPED: &str = "Synthetic K - Crash Window Fixture Title (Z-Library).pdf";
const FILED: &str = "Library/00 Inbox/Synthetic K - Crash Window Fixture Title.pdf";

struct Lib {
    root: PathBuf,
    db: PathBuf,
    md: PathBuf,
}

fn library(test: &str) -> Lib {
    let dir = std::env::temp_dir().join(format!(
        "properbooky-drop-recovery-{}-{test}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&dir);
    let root = dir.join("library");
    fs::create_dir_all(root.join("Catalog")).unwrap();
    fs::create_dir_all(root.join("Drop")).unwrap();
    let md = root.join("Catalog/Synthetic K - Crash Window Fixture Title.md");
    fs::write(&md, "---\ntitle: Crash Window Fixture Title\nauthor: Synthetic K\nstatus: queued\n---\n\nKept note.\n").unwrap();
    fs::write(root.join("Drop").join(DROPPED), PDF).unwrap();
    Lib {
        db: dir.join("index.db"),
        root,
        md,
    }
}

/// One run of the `process_drop` command (scan, process, scan) on a fresh
/// connection, as after an app restart.
fn run(
    lib: &Lib,
    observe: &dyn Fn(acquire::Step, &str) -> anyhow::Result<()>,
) -> anyhow::Result<acquire::DropReport> {
    let conn = db::open(&lib.db)?;
    scanner::scan_library(&conn, &lib.root)?;
    let report = acquire::process_drop_observed(&conn, &lib.root, observe)?;
    scanner::scan_library(&conn, &lib.root)?;
    Ok(report)
}

fn crash_at(lib: &Lib, at: acquire::Step) {
    let crashed = catch_unwind(AssertUnwindSafe(|| {
        run(lib, &|step, _| {
            if step == at {
                panic!("simulated crash at {step:?}");
            }
            Ok(())
        })
    }));
    assert!(
        crashed.is_err(),
        "the observer must have been reached at {at:?}"
    );
}

fn ok(_: acquire::Step, _: &str) -> anyhow::Result<()> {
    Ok(())
}

fn entry(md: &Path) -> catalog::CatalogEntry {
    catalog::parse(&fs::read_to_string(md).unwrap()).unwrap().0
}

fn pending_records(root: &Path) -> usize {
    fs::read_dir(root.join(".properbooky/acquisition/drop"))
        .map(|d| {
            d.filter_map(|e| e.ok())
                .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
                .count()
        })
        .unwrap_or(0)
}

fn files_under(dir: &Path) -> Vec<String> {
    let mut out: Vec<String> = walkdir(dir);
    out.sort();
    out
}

fn walkdir(dir: &Path) -> Vec<String> {
    let mut out = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for e in entries.filter_map(|e| e.ok()) {
            let p = e.path();
            if p.is_dir() {
                out.extend(walkdir(&p));
            } else {
                out.push(p.to_string_lossy().into_owned());
            }
        }
    }
    out
}

/// The converged state: one linked, hashed, available file under its
/// canonical name, its original name recorded, Drop empty, no pending
/// intent, and the index (fresh connection) shows it on the shelf.
fn assert_converged(lib: &Lib) {
    let e = entry(&lib.md);
    assert_eq!(e.file.as_deref(), Some(FILED));
    let on_disk = lib.root.join(FILED);
    assert_eq!(e.hash, Some(matcher::sha256_file(&on_disk).unwrap()));
    assert_eq!(fs::read(&on_disk).unwrap(), PDF);
    assert_eq!(e.original_filename.as_deref(), Some(DROPPED));
    assert_eq!(e.status, "available");
    assert!(fs::read_to_string(&lib.md).unwrap().contains("Kept note."));
    assert!(
        files_under(&lib.root.join("Drop")).is_empty(),
        "Drop: {:?}",
        files_under(&lib.root.join("Drop"))
    );
    assert_eq!(
        files_under(&lib.root.join("Library")).len(),
        1,
        "{:?}",
        files_under(&lib.root.join("Library"))
    );
    assert_eq!(pending_records(&lib.root), 0);
    let conn = db::open(&lib.db).unwrap();
    scanner::scan_library(&conn, &lib.root).unwrap();
    let book = library::list(&conn, &lib.root, None)
        .unwrap()
        .into_iter()
        .find(|b| b.title == "Crash Window Fixture Title")
        .unwrap();
    assert_eq!(book.details.availability, "local");
    assert_eq!(book.status.as_deref(), Some("available"));
}

fn result_of(report: &acquire::DropReport) -> Vec<(String, String)> {
    report
        .outcomes
        .iter()
        .map(|o| (o.filename.clone(), o.result.clone()))
        .collect()
}

#[test]
fn an_uninterrupted_run_files_and_leaves_no_intent() {
    let lib = library("clean");
    let report = run(&lib, &ok).unwrap();
    assert_eq!(
        result_of(&report),
        vec![(DROPPED.to_owned(), "filed".to_owned())]
    );
    assert_converged(&lib);
}

#[test]
fn a_crash_at_any_step_converges_on_the_next_run_and_retries_are_idempotent() {
    use acquire::Step::*;
    for (at, expected) in [
        (IntentWritten, "filed"),
        (Linked, "recovered"),
        (Published, "recovered"),
        (CatalogWritten, "recovered"),
    ] {
        let lib = library(&format!("crash-{at:?}"));
        crash_at(&lib, at);
        if at != IntentWritten {
            assert_eq!(
                pending_records(&lib.root),
                1,
                "{at:?}: the intent survives the crash"
            );
        }

        let report = run(&lib, &ok).unwrap();

        let results = result_of(&report);
        if at == CatalogWritten {
            // Already linked before the crash: the run only clears the intent.
            assert!(
                results.iter().all(|(_, r)| r != "filed"),
                "{at:?}: {results:?}"
            );
        } else {
            assert_eq!(
                results,
                vec![(DROPPED.to_owned(), expected.to_owned())],
                "{at:?}"
            );
        }
        assert_converged(&lib);

        // A further retry changes nothing on disk.
        let before: Vec<(String, Vec<u8>)> = files_under(&lib.root)
            .into_iter()
            .filter(|p| !p.contains("/.properbooky/"))
            .map(|p| (p.clone(), fs::read(&p).unwrap()))
            .collect();
        let again = run(&lib, &ok).unwrap();
        assert_eq!(again.filed, 0, "{at:?}: {:?}", result_of(&again));
        let after: Vec<(String, Vec<u8>)> = files_under(&lib.root)
            .into_iter()
            .filter(|p| !p.contains("/.properbooky/"))
            .map(|p| (p.clone(), fs::read(&p).unwrap()))
            .collect();
        assert_eq!(before, after, "{at:?}: retry changed files");
    }
}

#[test]
fn a_failed_catalog_write_is_pending_and_the_neighbour_is_still_filed() {
    let lib = library("catalog-error");
    let other = lib
        .root
        .join("Catalog/Synthetic N - Neighbour Fixture Volume.md");
    fs::write(
        &other,
        "---\ntitle: Neighbour Fixture Volume\nauthor: Synthetic N\nstatus: wishlist\n---\n",
    )
    .unwrap();
    fs::write(
        lib.root
            .join("Drop/Synthetic N - Neighbour Fixture Volume.pdf"),
        PDF,
    )
    .unwrap();

    let report = run(&lib, &|step, file| {
        if step == acquire::Step::Published && file == DROPPED {
            anyhow::bail!("disk full (simulated)");
        }
        Ok(())
    })
    .expect("a failed write is a per-file outcome, not a failed run");

    let pending = report
        .outcomes
        .iter()
        .find(|o| o.filename == DROPPED)
        .unwrap();
    assert_eq!(pending.result, "pending");
    let reason = serde_json::to_value(pending).unwrap()["reason"]
        .as_str()
        .unwrap_or("")
        .to_owned();
    assert!(reason.contains("disk full"), "{reason}");
    assert!(entry(&lib.md).file.is_none());
    assert_eq!(
        pending_records(&lib.root),
        1,
        "the intent keeps the original name"
    );
    assert!(entry(&other).file.is_some(), "the neighbour is filed");

    let retry = run(&lib, &ok).unwrap();
    assert!(
        result_of(&retry).contains(&(DROPPED.to_owned(), "recovered".to_owned())),
        "{:?}",
        result_of(&retry)
    );
    let e = entry(&lib.md);
    assert_eq!(e.file.as_deref(), Some(FILED));
    assert_eq!(e.original_filename.as_deref(), Some(DROPPED));
    assert_eq!(pending_records(&lib.root), 0);
}

#[test]
fn a_profile_linked_elsewhere_meanwhile_gets_the_file_returned_to_drop() {
    let lib = library("returned");
    crash_at(&lib, acquire::Step::Published);
    // Meanwhile the profile was linked to another file by the user.
    fs::create_dir_all(lib.root.join("Library/Shelf")).unwrap();
    fs::write(lib.root.join("Library/Shelf/other.pdf"), PDF).unwrap();
    let text = fs::read_to_string(&lib.md).unwrap().replace(
        "status: queued",
        "status: available\nfile: Library/Shelf/other.pdf",
    );
    fs::write(&lib.md, &text).unwrap();

    let report = run(&lib, &ok).unwrap();

    // Returned first; the same run then finds no unlinked profile for it, so
    // it stays in Drop (reported as such).
    assert_eq!(
        result_of(&report),
        vec![
            (DROPPED.to_owned(), "returned".to_owned()),
            (DROPPED.to_owned(), "left-unmatched".to_owned())
        ]
    );
    assert_eq!(
        fs::read(lib.root.join("Drop").join(DROPPED)).unwrap(),
        PDF,
        "back under its original name"
    );
    assert!(!lib.root.join(FILED).exists());
    assert_eq!(
        entry(&lib.md).file.as_deref(),
        Some("Library/Shelf/other.pdf"),
        "the user's link is kept"
    );
    assert_eq!(pending_records(&lib.root), 0);
}

#[test]
fn an_intent_that_escapes_the_library_is_reported_and_never_acted_on() {
    let lib = library("escape");
    let dir = lib.root.join(".properbooky/acquisition/drop");
    fs::create_dir_all(&dir).unwrap();
    let outside = lib.root.parent().unwrap().join("outside.pdf");
    fs::write(&outside, PDF).unwrap();
    fs::write(
        dir.join("forged.json"),
        serde_json::json!({
            "version": 1,
            "source": "../outside.pdf",
            "target": "../outside-moved.pdf",
            "catalog": "Catalog/Synthetic K - Crash Window Fixture Title.md",
            "hash": matcher::sha256_file(&outside).unwrap(),
            "original_filename": "outside.pdf"
        })
        .to_string(),
    )
    .unwrap();

    let report = run(&lib, &ok).unwrap();

    let forged = report
        .outcomes
        .iter()
        .find(|o| o.result == "error")
        .expect("reported");
    assert!(serde_json::to_value(forged).unwrap()["reason"]
        .as_str()
        .unwrap_or("")
        .contains("outside"));
    assert_eq!(fs::read(&outside).unwrap(), PDF);
    assert!(!lib
        .root
        .parent()
        .unwrap()
        .join("outside-moved.pdf")
        .exists());
    assert!(
        dir.join("forged.json").exists(),
        "kept for a person to look at"
    );
    // The ordinary file in Drop is still filed in the same run.
    assert_eq!(entry(&lib.md).file.as_deref(), Some(FILED));
}
