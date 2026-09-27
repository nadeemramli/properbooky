use desktop_lib::{annotations, db, export, identity, library, scanner};
use std::{fs, path::Path};

fn fixture() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir_all(dir.path().join("Catalog")).unwrap();
    fs::create_dir_all(dir.path().join("Library")).unwrap();
    dir
}
fn profile(root: &Path, name: &str, metadata: &str) {
    fs::write(root.join(format!("Catalog/{name}.md")), format!("---\ntitle: {name}\nauthor: Test Author\n{metadata}\n---\n\n# Personal context\nKeep this body.\n")).unwrap();
}

#[test]
fn rescan_and_index_rebuild_retain_ids_and_corrections_without_touching_sources() {
    let dir = fixture();
    let root = dir.path();
    profile(
        root,
        "0071713166.pdf",
        "status: wishlist\ncustom_provider:\n  confidence: unknown",
    );
    let source = fs::read(root.join("Catalog/0071713166.pdf.md")).unwrap();
    let conn = db::open(&root.join("index.db")).unwrap();
    scanner::scan_library(&conn, root).unwrap();
    let before = library::list(&conn, root, None).unwrap().remove(0);
    let id = before.details.stable_id.clone();
    let mut edit = library::Edit::from(&before);
    edit.title = "A corrected title".into();
    edit.reading_status = "reading".into();
    edit.up_next = true;
    library::update(&conn, root, &id, edit).unwrap();
    assert_eq!(
        fs::read(root.join("Catalog/0071713166.pdf.md")).unwrap(),
        source
    );
    // A completely new database still recovers metadata from library files.
    let rebuilt = db::open(&root.join("rebuilt.db")).unwrap();
    scanner::scan_library(&rebuilt, root).unwrap();
    let after = library::list(&rebuilt, root, Some("0071713166"))
        .unwrap()
        .remove(0);
    assert_eq!(after.details.stable_id, id);
    assert_eq!(after.title, "A corrected title");
    assert_eq!(after.details.reading_status, "reading");
    assert!(after.details.up_next && after.details.want_to_read);
    library::undo(&rebuilt, root).unwrap();
    assert_eq!(
        library::list(&rebuilt, root, None).unwrap()[0].title,
        "0071713166.pdf"
    );
}

#[test]
fn renamed_asset_keeps_legacy_position_highlights_and_export_identity() {
    let dir = fixture();
    let root = dir.path();
    let old = root.join("Library/old.pdf");
    fs::write(&old, b"%PDF-original").unwrap();
    profile(root, "The Book", "status: reading\nfile: Library/old.pdf");
    let state = root.join(".properbooky/state/Library__old.pdf.json");
    annotations::set_position(&state, "7".into(), Some(0.4)).unwrap();
    annotations::add_highlight(
        &state,
        "A retained quote".into(),
        None,
        None,
        serde_json::json!({"type":"pdf", "page":7}),
    )
    .unwrap();
    let conn = db::open(&root.join("index.db")).unwrap();
    scanner::scan_library(&conn, root).unwrap();
    let before = library::list(&conn, root, None).unwrap().remove(0);
    let moved = root.join("Library/better.pdf");
    fs::rename(&old, &moved).unwrap();
    scanner::scan_library(&conn, root).unwrap();
    let books = library::list(&conn, root, None).unwrap();
    assert_eq!(books.len(), 1);
    assert_eq!(books[0].details.asset_id, before.details.asset_id);
    assert_eq!(books[0].details.availability, "local");
    assert_eq!(books[0].details.reading_status, "reading");
    assert_eq!(books[0].file_link.as_deref(), moved.to_str());
    let registry = identity::Registry::load(root).unwrap();
    let resolved = registry.state_path(root, &moved).unwrap();
    assert_eq!(resolved, state);
    assert_eq!(annotations::load(&resolved).position.as_deref(), Some("7"));
    assert_eq!(annotations::live_highlights(&resolved).len(), 1);
    let mut edit = library::Edit::from(&books[0]);
    edit.title = "Corrected Book".into();
    library::update(&conn, root, &books[0].details.stable_id, edit).unwrap();
    let out = root.join(".export");
    assert_eq!(export::export_highlights(root, &out).unwrap().highlights, 1);
    assert!(
        fs::read_to_string(out.join("Test Author - Corrected Book.md"))
            .unwrap()
            .contains("A retained quote")
    );
}

#[test]
fn replaced_asset_does_not_inherit_old_anchors_or_change_id_on_every_scan() {
    let dir = fixture();
    let root = dir.path();
    let asset = root.join("Library/book.pdf");
    fs::write(&asset, b"%PDF-original").unwrap();
    let conn = db::open(&root.join("index.db")).unwrap();
    scanner::scan_library(&conn, root).unwrap();
    let registry = identity::Registry::load(root).unwrap();
    let old_id = registry.at_path("Library/book.pdf").unwrap().id.clone();
    let old_state = registry.state_path(root, &asset).unwrap();
    annotations::set_position(&old_state, "10".into(), Some(0.5)).unwrap();
    fs::write(&asset, b"%PDF-a-different-edition").unwrap();
    scanner::scan_library(&conn, root).unwrap();
    let registry = identity::Registry::load(root).unwrap();
    let new_id = registry.at_path("Library/book.pdf").unwrap().id.clone();
    assert_ne!(old_id, new_id);
    assert_ne!(registry.state_path(root, &asset).unwrap(), old_state);
    scanner::scan_library(&conn, root).unwrap();
    assert_eq!(
        identity::Registry::load(root)
            .unwrap()
            .at_path("Library/book.pdf")
            .unwrap()
            .id,
        new_id
    );
    assert_eq!(
        annotations::load(&old_state).position.as_deref(),
        Some("10")
    );
}

#[test]
fn links_normalize_slashes_and_duplicates_are_reviewed_not_merged() {
    let dir = fixture();
    let root = dir.path();
    fs::write(root.join("Library/book.pdf"), b"%PDF-original").unwrap();
    profile(root, "The Book", "status: reading\nfile: Library\\book.pdf");
    profile(
        root,
        "The Book edition two",
        "status: wishlist\nfile: Library/book.pdf",
    );
    let conn = db::open(&root.join("index.db")).unwrap();
    scanner::scan_library(&conn, root).unwrap();
    let books = library::list(&conn, root, None).unwrap();
    assert_eq!(books.len(), 2);
    assert!(books.iter().all(|b| b.details.availability == "local"));
    assert!(books
        .iter()
        .all(|b| b.details.duplicate_candidates.len() == 1));
    assert!(books.iter().all(|b| b.format == "pdf"));
}

#[test]
fn missing_files_remain_missing_even_when_status_is_reading() {
    let dir = fixture();
    let root = dir.path();
    profile(
        root,
        "Missing",
        "status: reading\nfile: Library/missing.pdf",
    );
    profile(root, "Wishlist", "status: wishlist");
    let conn = db::open(&root.join("index.db")).unwrap();
    scanner::scan_library(&conn, root).unwrap();
    let books = library::list(&conn, root, None).unwrap();
    assert_eq!(books[0].details.availability, "missing");
    assert_eq!(books[0].details.reading_status, "reading");
    assert_eq!(books[1].details.availability, "none");
}

#[test]
fn invalid_scan_or_corrupt_registry_preserves_previous_index() {
    let dir = fixture();
    let root = dir.path();
    profile(root, "Keep", "status: wishlist");
    let conn = db::open(&root.join("index.db")).unwrap();
    scanner::scan_library(&conn, root).unwrap();
    assert!(scanner::scan_library(&conn, &root.join("missing-folder")).is_err());
    fs::write(root.join(".properbooky/identities.json"), b"not-json").unwrap();
    assert!(scanner::scan_library(&conn, root).is_err());
    assert_eq!(
        conn.query_row("SELECT count(*) FROM books", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
}

#[test]
fn schema_upgrade_preserves_settings() {
    let dir = fixture();
    let path = dir.path().join("old.db");
    let conn = rusqlite::Connection::open(&path).unwrap();
    conn.execute_batch("CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT); INSERT INTO settings VALUES ('library_path','/books'); PRAGMA user_version=8;").unwrap();
    drop(conn);
    let conn = db::open(&path).unwrap();
    assert_eq!(
        db::get_setting(&conn, "library_path").unwrap().as_deref(),
        Some("/books")
    );
}

#[test]
fn ambiguous_equal_files_remain_distinct_and_unsafe_links_cannot_escape() {
    let dir = fixture();
    let root = dir.path();
    fs::write(root.join("Library/a.pdf"), b"same").unwrap();
    fs::write(root.join("Library/b.pdf"), b"same").unwrap();
    let conn = db::open(&root.join("index.db")).unwrap();
    scanner::scan_library(&conn, root).unwrap();
    let books = library::list(&conn, root, None).unwrap();
    assert_ne!(books[0].details.asset_id, books[1].details.asset_id);
    assert_eq!(books[0].details.duplicate_candidates.len(), 1);
    assert!(identity::safe_join(root, "../outside.pdf").is_err());
    assert!(identity::safe_join(root, "C:\\outside.pdf").is_err());
    assert!(identity::safe_join(root, "/outside.pdf").is_err());
}

#[test]
fn ambiguous_move_does_not_assign_old_reading_state_to_an_arbitrary_copy() {
    let dir = fixture();
    let root = dir.path();
    let old = root.join("Library/old.pdf");
    fs::write(&old, b"same content").unwrap();
    let conn = db::open(&root.join("index.db")).unwrap();
    scanner::scan_library(&conn, root).unwrap();
    let before = library::list(&conn, root, None).unwrap().remove(0);
    fs::rename(&old, root.join("Library/new-a.pdf")).unwrap();
    fs::write(root.join("Library/new-b.pdf"), b"same content").unwrap();
    scanner::scan_library(&conn, root).unwrap();
    let after = library::list(&conn, root, None).unwrap();
    assert_eq!(after.len(), 2);
    assert!(after
        .iter()
        .all(|b| b.details.asset_id != before.details.asset_id));
}

#[test]
fn corrupt_curation_aborts_scan_without_replacing_the_index() {
    let dir = fixture();
    let root = dir.path();
    profile(root, "Keep", "status: wishlist");
    let conn = db::open(&root.join("index.db")).unwrap();
    scanner::scan_library(&conn, root).unwrap();
    fs::write(root.join(".properbooky/curation.json"), b"broken").unwrap();
    profile(root, "New", "status: wishlist");
    assert!(scanner::scan_library(&conn, root).is_err());
    assert_eq!(
        conn.query_row("SELECT count(*) FROM books", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
}
