//! PBK-21 Drop safety guards (G1-G6, G8 in
//! .agent-delivery/batches/pbk21-drop-safety/plan.md). Synthetic libraries
//! only; each test builds its own throwaway library under the temp dir.
use desktop_lib::{acquire, catalog, db, scanner};
use std::fs;
use std::path::{Path, PathBuf};

const PDF: &[u8] = b"%PDF-1.4\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n";

/// The smallest byte shape the completeness check accepts as an EPUB: a zip
/// local file header up front and an end-of-central-directory record at the
/// end (22 bytes, no comment).
fn epub(body: &[u8]) -> Vec<u8> {
    let mut bytes = b"PK\x03\x04".to_vec();
    bytes.extend_from_slice(body);
    bytes.extend_from_slice(b"PK\x05\x06");
    bytes.extend_from_slice(&[0u8; 18]);
    bytes
}

struct Lib {
    root: PathBuf,
    outside: PathBuf,
    db: PathBuf,
}

fn library(test: &str) -> Lib {
    let dir = std::env::temp_dir().join(format!(
        "properbooky-drop-safety-{}-{test}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&dir);
    let root = dir.join("library");
    fs::create_dir_all(root.join("Catalog")).unwrap();
    fs::create_dir_all(root.join("Drop")).unwrap();
    let outside = dir.join("outside");
    fs::create_dir_all(&outside).unwrap();
    Lib {
        db: dir.join("index.db"),
        root,
        outside,
    }
}

fn entry(root: &Path, title: &str, author: Option<&str>) -> PathBuf {
    // Short, distinct profile file names: the title itself may be too long
    // for a file name (that is what one test is about).
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    (title, author).hash(&mut h);
    let path = root.join("Catalog").join(format!("{:016x}.md", h.finish()));
    let author = author
        .map(|a| format!("author: \"{a}\"\n"))
        .unwrap_or_default();
    fs::write(
        &path,
        format!("---\ntitle: \"{title}\"\n{author}status: queued\n---\n\nKept note.\n"),
    )
    .unwrap();
    path
}

fn drop_file(root: &Path, name: &str, bytes: &[u8]) -> PathBuf {
    let path = root.join("Drop").join(name);
    fs::write(&path, bytes).unwrap();
    path
}

/// The `process_drop` Tauri command: scan, process, scan.
fn process(lib: &Lib) -> anyhow::Result<acquire::DropReport> {
    let conn = db::open(&lib.db)?;
    scanner::scan_library(&conn, &lib.root)?;
    let report = acquire::process_drop(&conn, &lib.root)?;
    scanner::scan_library(&conn, &lib.root)?;
    Ok(report)
}

fn parsed(md: &Path) -> catalog::CatalogEntry {
    catalog::parse(&fs::read_to_string(md).unwrap()).unwrap().0
}

/// (result, reason) of the outcome for one dropped filename.
fn outcome(report: &acquire::DropReport, filename: &str) -> (String, Option<String>) {
    let o = report
        .outcomes
        .iter()
        .find(|o| o.filename == filename)
        .unwrap_or_else(|| panic!("no outcome for {filename}: {:?}", names(report)));
    let value = serde_json::to_value(o).unwrap();
    (
        o.result.clone(),
        value
            .get("reason")
            .and_then(|r| r.as_str())
            .map(str::to_owned),
    )
}

fn names(report: &acquire::DropReport) -> Vec<(String, String)> {
    report
        .outcomes
        .iter()
        .map(|o| (o.filename.clone(), o.result.clone()))
        .collect()
}

fn inbox(root: &Path) -> Vec<String> {
    let dir = root.join("Library/00 Inbox");
    let mut names: Vec<String> = fs::read_dir(&dir)
        .map(|d| {
            d.filter_map(|e| e.ok())
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    names
}

// --- G1 regular files only -------------------------------------------------

#[cfg(unix)]
#[test]
fn symlink_to_a_file_outside_the_library_is_left_in_drop() {
    let lib = library("symlink-outside");
    let md = entry(
        &lib.root,
        "Outside Symlink Fixture Title",
        Some("Synthetic S"),
    );
    let secret = lib.outside.join("secret.pdf");
    fs::write(&secret, PDF).unwrap();
    let link = lib
        .root
        .join("Drop/Synthetic S - Outside Symlink Fixture Title.pdf");
    std::os::unix::fs::symlink(&secret, &link).unwrap();

    let report = process(&lib).unwrap();

    let (result, reason) = outcome(&report, "Synthetic S - Outside Symlink Fixture Title.pdf");
    assert_eq!(result, "left-unsafe", "{reason:?}");
    assert!(reason.is_some_and(|r| r.contains("link")));
    assert!(
        fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink(),
        "link must stay in Drop"
    );
    assert!(
        parsed(&md).file.is_none(),
        "profile must not point at bytes outside the library"
    );
    assert!(inbox(&lib.root).is_empty());
    assert_eq!(fs::read(&secret).unwrap(), PDF);
}

#[cfg(unix)]
#[test]
fn a_dangling_symlink_does_not_abort_the_batch() {
    let lib = library("dangling");
    let broken = entry(&lib.root, "Broken Link Fixture Title", Some("Synthetic F"));
    let healthy = entry(
        &lib.root,
        "Healthy Neighbour Fixture Title",
        Some("Synthetic H"),
    );
    let link = lib
        .root
        .join("Drop/Synthetic F - Broken Link Fixture Title.pdf");
    std::os::unix::fs::symlink(lib.outside.join("missing.pdf"), &link).unwrap();
    drop_file(
        &lib.root,
        "Synthetic H - Healthy Neighbour Fixture Title.pdf",
        PDF,
    );

    let report = process(&lib).expect("one unsafe file must not fail the run");

    assert_eq!(
        outcome(&report, "Synthetic F - Broken Link Fixture Title.pdf").0,
        "left-unsafe"
    );
    assert_eq!(
        outcome(&report, "Synthetic H - Healthy Neighbour Fixture Title.pdf").0,
        "filed"
    );
    assert!(
        fs::symlink_metadata(&link).is_ok(),
        "the link stays in Drop"
    );
    assert!(parsed(&broken).file.is_none());
    assert!(parsed(&healthy).file.is_some());
}

#[test]
fn a_folder_named_like_a_book_is_left_in_drop() {
    let lib = library("folder");
    let md = entry(
        &lib.root,
        "Folder Shaped Fixture Title",
        Some("Synthetic D"),
    );
    let dir = lib
        .root
        .join("Drop/Synthetic D - Folder Shaped Fixture Title.pdf");
    fs::create_dir_all(&dir).unwrap();

    let report = process(&lib).unwrap();

    assert_eq!(
        outcome(&report, "Synthetic D - Folder Shaped Fixture Title.pdf").0,
        "left-unsafe"
    );
    assert!(dir.is_dir());
    assert!(parsed(&md).file.is_none());
}

// --- G2 complete, non-empty content ----------------------------------------

#[test]
fn an_empty_file_is_left_incomplete() {
    let lib = library("empty");
    let md = entry(&lib.root, "Zero Byte Fixture Volume", Some("Synthetic Z"));
    let file = drop_file(
        &lib.root,
        "Synthetic Z - Zero Byte Fixture Volume.epub",
        b"",
    );

    let report = process(&lib).unwrap();

    let (result, reason) = outcome(&report, "Synthetic Z - Zero Byte Fixture Volume.epub");
    assert_eq!(result, "left-incomplete", "{reason:?}");
    assert!(reason.is_some_and(|r| r.contains("empty")));
    assert!(file.is_file());
    assert!(parsed(&md).file.is_none());
}

#[test]
fn a_pdf_without_its_end_marker_is_left_incomplete() {
    let lib = library("half-pdf");
    let md = entry(
        &lib.root,
        "Partial Arrival Fixture Volume",
        Some("Synthetic P"),
    );
    let file = drop_file(
        &lib.root,
        "Synthetic P - Partial Arrival Fixture Volume.pdf",
        b"%PDF-1.4 first half",
    );

    let report = process(&lib).unwrap();

    assert_eq!(
        outcome(&report, "Synthetic P - Partial Arrival Fixture Volume.pdf").0,
        "left-incomplete"
    );
    assert_eq!(fs::read(&file).unwrap(), b"%PDF-1.4 first half");
    assert!(parsed(&md).file.is_none());
    assert!(inbox(&lib.root).is_empty());
}

#[test]
fn an_epub_without_its_zip_directory_is_left_incomplete() {
    let lib = library("half-epub");
    let md = entry(
        &lib.root,
        "Truncated Zip Fixture Volume",
        Some("Synthetic E"),
    );
    let file = drop_file(
        &lib.root,
        "Synthetic E - Truncated Zip Fixture Volume.epub",
        b"PK\x03\x04 first half of a zip",
    );

    let report = process(&lib).unwrap();

    assert_eq!(
        outcome(&report, "Synthetic E - Truncated Zip Fixture Volume.epub").0,
        "left-incomplete"
    );
    assert!(file.is_file());
    assert!(parsed(&md).file.is_none());
}

#[test]
fn complete_pdf_and_epub_are_filed_with_their_hash() {
    let lib = library("complete");
    let p = entry(&lib.root, "Complete Portable Fixture", Some("Synthetic C"));
    let e = entry(&lib.root, "Complete Zipped Fixture", Some("Synthetic C"));
    drop_file(
        &lib.root,
        "Synthetic C - Complete Portable Fixture (2020) - libgen.li.pdf",
        PDF,
    );
    let zipped = epub(b"mimetypeapplication/epub+zip");
    drop_file(
        &lib.root,
        "Synthetic C - Complete Zipped Fixture (Z-Library).EPUB",
        &zipped,
    );

    let report = process(&lib).unwrap();

    assert_eq!(report.filed, 2, "{:?}", names(&report));
    for (md, name) in [
        (&p, "Synthetic C - Complete Portable Fixture.pdf"),
        (&e, "Synthetic C - Complete Zipped Fixture.epub"),
    ] {
        let linked = parsed(md);
        assert_eq!(
            linked.file.as_deref(),
            Some(format!("Library/00 Inbox/{name}").as_str())
        );
        assert_eq!(linked.status, "available");
        let on_disk = lib.root.join(linked.file.unwrap());
        assert_eq!(
            linked.hash,
            Some(desktop_lib::matcher::sha256_file(&on_disk).unwrap())
        );
        assert!(linked.original_filename.is_some());
    }
    assert!(fs::read_dir(lib.root.join("Drop"))
        .unwrap()
        .next()
        .is_none());
}

// --- G3 confined paths ------------------------------------------------------

#[cfg(unix)]
#[test]
fn a_linked_drop_folder_is_refused_before_anything_moves() {
    let lib = library("linked-drop");
    let md = entry(&lib.root, "Linked Drop Fixture Title", Some("Synthetic L"));
    fs::remove_dir(lib.root.join("Drop")).unwrap();
    fs::write(
        lib.outside
            .join("Synthetic L - Linked Drop Fixture Title.pdf"),
        PDF,
    )
    .unwrap();
    std::os::unix::fs::symlink(&lib.outside, lib.root.join("Drop")).unwrap();

    let result = process(&lib);

    assert!(
        result.is_err(),
        "a Drop link to another folder must be refused"
    );
    assert!(lib
        .outside
        .join("Synthetic L - Linked Drop Fixture Title.pdf")
        .is_file());
    assert!(parsed(&md).file.is_none());
    assert!(!lib.root.join("Library").exists());
}

#[cfg(unix)]
#[test]
fn a_linked_catalog_is_refused_before_anything_moves() {
    let lib = library("linked-catalog");
    fs::remove_dir(lib.root.join("Catalog")).unwrap();
    let foreign = lib.outside.join("Catalog");
    fs::create_dir_all(&foreign).unwrap();
    let md = foreign.join("x.md");
    fs::write(
        &md,
        "---\ntitle: Foreign Catalog Fixture\nauthor: Synthetic X\nstatus: queued\n---\n",
    )
    .unwrap();
    let before = fs::read(&md).unwrap();
    std::os::unix::fs::symlink(&foreign, lib.root.join("Catalog")).unwrap();
    let dropped = drop_file(&lib.root, "Synthetic X - Foreign Catalog Fixture.pdf", PDF);

    let conn = db::open(&lib.db).unwrap();
    let result = acquire::process_drop(&conn, &lib.root);

    assert!(result.is_err(), "a Catalog link must be refused");
    assert_eq!(
        fs::read(&md).unwrap(),
        before,
        "the foreign catalog is not written"
    );
    assert!(dropped.is_file());
}

#[cfg(unix)]
#[test]
fn a_linked_inbox_is_refused_before_anything_moves() {
    let lib = library("linked-inbox");
    let md = entry(&lib.root, "Linked Inbox Fixture Title", Some("Synthetic I"));
    fs::create_dir_all(lib.root.join("Library")).unwrap();
    std::os::unix::fs::symlink(&lib.outside, lib.root.join("Library/00 Inbox")).unwrap();
    let dropped = drop_file(
        &lib.root,
        "Synthetic I - Linked Inbox Fixture Title.pdf",
        PDF,
    );

    let result = process(&lib);

    assert!(
        result.is_err(),
        "an Inbox link to another folder must be refused"
    );
    assert!(dropped.is_file());
    assert!(
        fs::read_dir(&lib.outside).unwrap().next().is_none(),
        "nothing written outside"
    );
    assert!(parsed(&md).file.is_none());
}

// --- G4 safe names ----------------------------------------------------------

#[test]
fn a_name_longer_than_the_filesystem_allows_does_not_abort_the_batch() {
    let lib = library("long-name");
    let title = vec!["書書書書"; 30].join(" ");
    let long = entry(&lib.root, &title, Some("著者"));
    let other = entry(
        &lib.root,
        "Normal Neighbour Fixture Book",
        Some("Synthetic N"),
    );
    drop_file(&lib.root, "著者 - 書書書書.pdf", PDF);
    drop_file(
        &lib.root,
        "Synthetic N - Normal Neighbour Fixture Book.pdf",
        PDF,
    );
    assert!(catalog::entry_filename(&title, Some("著者")).len() > 255);

    let report = process(&lib).expect("a long name must not fail the run");

    assert_eq!(report.filed, 2, "{:?}", names(&report));
    let file = parsed(&long).file.unwrap();
    let name = Path::new(&file)
        .file_name()
        .unwrap()
        .to_string_lossy()
        .into_owned();
    assert!(
        name.len() <= 255 && name.starts_with("著者 - 書書書書") && name.ends_with(".pdf"),
        "{name}"
    );
    assert!(parsed(&other).file.is_some());
}

#[test]
fn a_leading_dot_title_is_filed_as_a_visible_indexed_file() {
    let lib = library("leading-dot");
    let md = entry(&lib.root, ".hidden Leading Dot Fixture", None);
    drop_file(&lib.root, "hidden Leading Dot Fixture.pdf", PDF);

    let report = process(&lib).unwrap();

    assert_eq!(report.filed, 1, "{:?}", names(&report));
    let file = parsed(&md).file.unwrap();
    assert_eq!(file, "Library/00 Inbox/hidden Leading Dot Fixture.pdf");
    let conn = db::open(&lib.db).unwrap();
    let assets: i64 = conn
        .query_row("SELECT COUNT(*) FROM books WHERE kind='file'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(assets, 1, "the filed book is indexed");
}

#[test]
fn ordinary_names_are_unchanged() {
    let lib = library("ordinary");
    let md = entry(
        &lib.root,
        "Thinking in Fixtures: A Synthetic Primer",
        Some("Ada Synthetic"),
    );
    drop_file(
        &lib.root,
        "Ada Synthetic - Thinking in Fixtures A Synthetic Primer (2019, Press) - libgen.li.pdf",
        PDF,
    );

    process(&lib).unwrap();

    let expected = catalog::entry_filename(
        "Thinking in Fixtures: A Synthetic Primer",
        Some("Ada Synthetic"),
    );
    let expected = format!("Library/00 Inbox/{}.pdf", expected.trim_end_matches(".md"));
    assert_eq!(parsed(&md).file.as_deref(), Some(expected.as_str()));
}

// --- G5 no-clobber publication ----------------------------------------------

#[test]
fn an_occupied_destination_is_never_overwritten() {
    let lib = library("collision");
    let md = entry(&lib.root, "Collision Fixture Title", Some("Synthetic C"));
    let inbox = lib.root.join("Library/00 Inbox");
    fs::create_dir_all(&inbox).unwrap();
    let occupant = inbox.join("Synthetic C - Collision Fixture Title.pdf");
    fs::write(&occupant, b"%PDF-1.4 OCCUPANT\n%%EOF\n").unwrap();
    let dropped = drop_file(
        &lib.root,
        "Synthetic C - Collision Fixture Title (Z-Library).pdf",
        PDF,
    );

    let report = process(&lib).unwrap();

    let (result, reason) = outcome(
        &report,
        "Synthetic C - Collision Fixture Title (Z-Library).pdf",
    );
    assert_eq!(result, "left-conflict", "{reason:?}");
    assert_eq!(fs::read(&occupant).unwrap(), b"%PDF-1.4 OCCUPANT\n%%EOF\n");
    assert_eq!(fs::read(&dropped).unwrap(), PDF);
    assert!(parsed(&md).file.is_none());
}

// --- G8 no double link --------------------------------------------------------

#[test]
fn two_formats_of_one_book_in_one_run_link_once_and_orphan_nothing() {
    let lib = library("two-formats");
    let md = entry(&lib.root, "Two Format Fixture Volume", Some("Synthetic T"));
    drop_file(
        &lib.root,
        "Synthetic T - Two Format Fixture Volume.pdf",
        PDF,
    );
    drop_file(
        &lib.root,
        "Synthetic T - Two Format Fixture Volume.epub",
        &epub(b"x"),
    );

    let report = process(&lib).unwrap();

    assert_eq!(report.filed, 1, "{:?}", names(&report));
    let linked = parsed(&md).file.expect("linked once");
    assert!(lib.root.join(&linked).is_file());
    // Everything in the inbox is the linked file: nothing filed and then
    // orphaned by a second link.
    assert_eq!(
        inbox(&lib.root),
        vec![Path::new(&linked)
            .file_name()
            .unwrap()
            .to_string_lossy()
            .into_owned()]
    );
    let drop_left: Vec<_> = fs::read_dir(lib.root.join("Drop")).unwrap().collect();
    assert_eq!(drop_left.len(), 1, "the other format stays in Drop");
    let other = report
        .outcomes
        .iter()
        .find(|o| o.result != "filed")
        .unwrap();
    assert_eq!(other.result, "left-conflict");
}

// --- G6 report survives a per-file I/O error --------------------------------

#[cfg(unix)]
#[test]
fn an_unreadable_file_is_reported_and_the_rest_still_filed() {
    use std::os::unix::fs::PermissionsExt;
    // Root reads anything; this guard is exercised by CI's non-root runner
    // and by the hook-driven error tests in acquire_recovery_test.rs.
    if unsafe_is_root() {
        return;
    }
    let lib = library("unreadable");
    let a = entry(&lib.root, "Unreadable Fixture Title", Some("Synthetic U"));
    let b = entry(&lib.root, "Readable Neighbour Fixture", Some("Synthetic R"));
    let locked = drop_file(&lib.root, "Synthetic U - Unreadable Fixture Title.pdf", PDF);
    fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).unwrap();
    drop_file(
        &lib.root,
        "Synthetic R - Readable Neighbour Fixture.pdf",
        PDF,
    );

    // Straight to the service: today's library scan itself stops at an
    // unreadable file (scanner behaviour, outside this repair).
    let conn = db::open(&lib.db).unwrap();
    let report = acquire::process_drop(&conn, &lib.root);
    fs::set_permissions(&locked, fs::Permissions::from_mode(0o644)).unwrap();
    let report = report.expect("one unreadable file must not fail the run");

    assert_eq!(
        outcome(&report, "Synthetic U - Unreadable Fixture Title.pdf").0,
        "error"
    );
    assert!(locked.is_file());
    assert!(parsed(&a).file.is_none());
    assert!(parsed(&b).file.is_some());
}

#[cfg(unix)]
fn unsafe_is_root() -> bool {
    // Avoids a libc dependency: root owns /proc/self.
    std::fs::read_to_string("/proc/self/status")
        .ok()
        .and_then(|s| {
            s.lines()
                .find(|l| l.starts_with("Uid:"))
                .map(|l| l.split_whitespace().nth(1) == Some("0"))
        })
        .unwrap_or(false)
}

#[cfg(unix)]
#[test]
fn a_colon_in_a_dropped_name_is_still_filed() {
    // Legal on Linux/macOS; the intent record must not refuse it.
    let lib = library("colon");
    let md = entry(&lib.root, "Colon Named Fixture Volume", Some("Synthetic Q"));
    drop_file(
        &lib.root,
        "Synthetic Q - Colon Named Fixture Volume: Second Edition.pdf",
        PDF,
    );

    // Straight to the service: today's library scan itself refuses a `:` in
    // any file name (identity::relative; scanner behaviour, outside this
    // repair). Drop filing must not add a refusal of its own.
    let conn = db::open(&lib.db).unwrap();
    let report = acquire::process_drop(&conn, &lib.root).unwrap();

    assert_eq!(report.filed, 1, "{:?}", names(&report));
    assert_eq!(
        parsed(&md).original_filename.as_deref(),
        Some("Synthetic Q - Colon Named Fixture Volume: Second Edition.pdf")
    );
}
