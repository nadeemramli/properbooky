use desktop_lib::{annotations, db, export, identity, library, scanner};
use std::{collections::BTreeMap, fs, path::Path};

fn fixture() -> tempfile::TempDir {
    let root = tempfile::tempdir().unwrap();
    fs::create_dir(root.path().join("Catalog")).unwrap();
    fs::create_dir(root.path().join("Library")).unwrap();
    root
}
fn profile(root: &Path, name: &str, metadata: &str) {
    fs::write(
        root.join(format!("Catalog/{name}.md")),
        format!(
            "---\ntitle: {name}\nauthor: Test Author\n{metadata}\n---\n\nContext for {name}.\n"
        ),
    )
    .unwrap();
}
fn book(conn: &rusqlite::Connection, root: &Path, title: &str) -> library::Book {
    library::list(conn, root, None)
        .unwrap()
        .into_iter()
        .find(|b| b.title == title)
        .unwrap()
}

#[test]
fn combine_wishlist_and_owned_profile_preserves_all_sources_assets_and_state_then_undoes() {
    let dir = fixture();
    let root = dir.path();
    profile(
        root,
        "Wishlist",
        "status: wishlist\nyear: 2014\nrecommendation: A personal recommendation\ncustom: keep",
    );
    profile(
        root,
        "Owned edition",
        "status: reading\nyear: 2017\nfile: Library/book.pdf\ntopics: [Psychology]",
    );
    fs::write(root.join("Library/book.pdf"), b"%PDF-original").unwrap();
    let originals: Vec<_> = [
        "Catalog/Wishlist.md",
        "Catalog/Owned edition.md",
        "Library/book.pdf",
    ]
    .into_iter()
    .map(|p| (p, fs::read(root.join(p)).unwrap()))
    .collect();
    let conn = db::open(&root.join("index.db")).unwrap();
    scanner::scan_library(&conn, root).unwrap();
    let wanted = book(&conn, root, "Wishlist");
    let owned = book(&conn, root, "Owned edition");
    let state = identity::Registry::load(root)
        .unwrap()
        .state_path(root, &root.join("Library/book.pdf"))
        .unwrap();
    annotations::set_position(&state, "9".into(), Some(0.5)).unwrap();
    annotations::add_highlight(
        &state,
        "Retain my highlight".into(),
        Some("My note".into()),
        None,
        serde_json::json!({"type":"pdf","page":9}),
    )
    .unwrap();
    let state_bytes = fs::read(&state).unwrap();
    let mut edit = library::Edit::from(&wanted);
    edit.reading_status = "reading".into();
    library::merge(
        &conn,
        root,
        &wanted.details.stable_id,
        &owned.details.stable_id,
        edit,
    )
    .unwrap();
    let combined = library::list(&conn, root, Some("Owned edition")).unwrap();
    assert_eq!(combined.len(), 1);
    let combined = &combined[0];
    assert_eq!(combined.details.stable_id, wanted.details.stable_id);
    assert_eq!(combined.details.source_profiles.len(), 2);
    assert_eq!(combined.details.assets.len(), 1);
    assert_eq!(combined.details.availability, "local");
    assert_eq!(combined.details.reading_status, "reading");
    assert!(combined.details.want_to_read);
    assert_eq!(combined.details.assets[0].year, Some(2017));
    assert!(library::source_text(root, &wanted.details.stable_id)
        .unwrap()
        .contains("A personal recommendation"));
    let rebuilt = db::open(&root.join("rebuilt.db")).unwrap();
    scanner::scan_library(&rebuilt, root).unwrap();
    assert_eq!(library::list(&rebuilt, root, None).unwrap().len(), 1);
    library::undo(&rebuilt, root).unwrap();
    assert_eq!(library::list(&rebuilt, root, None).unwrap().len(), 2);
    assert_eq!(
        library::list(&rebuilt, root, Some("Owned edition"))
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        book(&rebuilt, root, "Wishlist").details.reading_status,
        "unread"
    );
    assert_eq!(fs::read(state).unwrap(), state_bytes);
    for (path, bytes) in originals {
        assert_eq!(fs::read(root.join(path)).unwrap(), bytes);
    }
}

#[test]
fn chained_combinations_and_corrections_undo_in_order() {
    let dir = fixture();
    let root = dir.path();
    for title in ["One", "Two", "Three"] {
        profile(root, title, "status: wishlist");
    }
    let conn = db::open(&root.join("index.db")).unwrap();
    scanner::scan_library(&conn, root).unwrap();
    let one = book(&conn, root, "One");
    let two = book(&conn, root, "Two");
    let three = book(&conn, root, "Three");
    library::merge(
        &conn,
        root,
        &one.details.stable_id,
        &two.details.stable_id,
        library::Edit::from(&one),
    )
    .unwrap();
    library::merge(
        &conn,
        root,
        &three.details.stable_id,
        &one.details.stable_id,
        library::Edit::from(&three),
    )
    .unwrap();
    assert_eq!(book(&conn, root, "Three").details.source_profiles.len(), 3);
    let mut edit = library::Edit::from(&three);
    edit.title = "Renamed".into();
    library::update(&conn, root, &three.details.stable_id, edit).unwrap();
    library::undo(&conn, root).unwrap();
    library::undo(&conn, root).unwrap();
    assert_eq!(library::list(&conn, root, None).unwrap().len(), 2);
    assert_eq!(book(&conn, root, "One").details.source_profiles.len(), 2);
    library::undo(&conn, root).unwrap();
    assert_eq!(library::list(&conn, root, None).unwrap().len(), 3);
    assert!(library::merge(
        &conn,
        root,
        &one.details.stable_id,
        &one.details.stable_id,
        library::Edit::from(&one)
    )
    .is_err());
}

#[test]
fn multiple_assets_keep_individual_anchors_and_exports_do_not_overwrite_each_other() {
    let dir = fixture();
    let root = dir.path();
    let conn = db::open(&root.join("index.db")).unwrap();
    for (title, file) in [("First", "a.pdf"), ("Second", "b.epub")] {
        profile(
            root,
            title,
            &format!("status: available\nfile: Library/{file}"),
        );
        fs::write(
            root.join("Library").join(file),
            format!("different bytes for {file}"),
        )
        .unwrap();
    }
    scanner::scan_library(&conn, root).unwrap();
    let registry = identity::Registry::load(root).unwrap();
    for file in ["a.pdf", "b.epub"] {
        let state = registry
            .state_path(root, &root.join("Library").join(file))
            .unwrap();
        annotations::add_highlight(
            &state,
            format!("Quote from {file}"),
            None,
            None,
            serde_json::json!({"type":"pdf","page":3}),
        )
        .unwrap();
    }
    let first = book(&conn, root, "First");
    let second = book(&conn, root, "Second");
    library::merge(
        &conn,
        root,
        &first.details.stable_id,
        &second.details.stable_id,
        library::Edit::from(&first),
    )
    .unwrap();
    let merged = book(&conn, root, "First");
    assert_eq!(merged.details.assets.len(), 2);
    assert_ne!(merged.details.assets[0].id, merged.details.assets[1].id);
    let out = root.join(".exports");
    assert_eq!(export::export_highlights(root, &out).unwrap().highlights, 2);
    let docs: Vec<_> = fs::read_dir(&out)
        .unwrap()
        .map(|e| fs::read_to_string(e.unwrap().path()).unwrap())
        .collect();
    assert_eq!(docs.len(), 2);
    assert!(docs.iter().any(|d| d.contains("Quote from a.pdf")));
    assert!(docs.iter().any(|d| d.contains("Quote from b.epub")));
}

#[test]
fn shared_asset_is_listed_once_and_missing_primary_does_not_hide_the_other_profile() {
    let dir = fixture();
    let root = dir.path();
    for title in ["One", "Two"] {
        profile(root, title, "file: Library/book.pdf");
    }
    fs::write(root.join("Library/book.pdf"), b"pdf").unwrap();
    let conn = db::open(&root.join("index.db")).unwrap();
    scanner::scan_library(&conn, root).unwrap();
    let one = book(&conn, root, "One");
    let two = book(&conn, root, "Two");
    library::merge(
        &conn,
        root,
        &one.details.stable_id,
        &two.details.stable_id,
        library::Edit::from(&one),
    )
    .unwrap();
    assert_eq!(book(&conn, root, "One").details.assets.len(), 1);
    fs::remove_file(root.join("Catalog/One.md")).unwrap();
    scanner::scan_library(&conn, root).unwrap();
    let books = library::list(&conn, root, None).unwrap();
    assert_eq!(books.len(), 1);
    assert_eq!(books[0].title, "Two");
    assert!(books[0]
        .details
        .issues
        .contains(&"Missing primary profile".into()));
}

#[test]
fn merge_cycles_are_rejected_and_old_curation_remains_readable() {
    let merges = BTreeMap::from([("a".into(), "b".into()), ("b".into(), "a".into())]);
    assert!(desktop_lib::consolidation::resolve(&merges, "a").is_err());
    let dir = fixture();
    let root = dir.path();
    profile(root, "One", "status: wishlist");
    fs::create_dir_all(root.join(".properbooky")).unwrap();
    fs::write(
        root.join(".properbooky/curation.json"),
        r#"{"version":1,"edits":{},"aliases":{},"history":[]}"#,
    )
    .unwrap();
    let conn = db::open(&root.join("index.db")).unwrap();
    scanner::scan_library(&conn, root).unwrap();
    assert_eq!(library::list(&conn, root, None).unwrap().len(), 1);
}

#[test]
fn raw_primary_remains_visible_when_a_retained_profile_later_links_its_file() {
    let dir = fixture();
    let root = dir.path();
    profile(root, "Wishlist", "status: wishlist");
    fs::write(root.join("Library/book.pdf"), b"pdf").unwrap();
    let conn = db::open(&root.join("index.db")).unwrap();
    scanner::scan_library(&conn, root).unwrap();
    let raw = book(&conn, root, "book");
    let wanted = book(&conn, root, "Wishlist");
    library::merge(
        &conn,
        root,
        &raw.details.stable_id,
        &wanted.details.stable_id,
        library::Edit::from(&raw),
    )
    .unwrap();
    profile(
        root,
        "Wishlist",
        "status: available\nfile: Library/book.pdf",
    );
    scanner::scan_library(&conn, root).unwrap();
    let books = library::list(&conn, root, None).unwrap();
    assert_eq!(books.len(), 1);
    assert_eq!(books[0].details.stable_id, raw.details.stable_id);
    assert_eq!(books[0].details.source_profiles.len(), 2);
    assert_eq!(books[0].details.assets.len(), 1);
}

/// Opt-in preservation test. Only operate on an explicitly marked pilot copy.
#[test]
fn merge_pilot_copy_if_configured() {
    let Some(path) = std::env::var_os("PB_MERGE_PILOT") else {
        return;
    };
    let root = Path::new(&path);
    assert!(
        root.join(".properbooky/pilot-only").is_file(),
        "requires isolated pilot marker"
    );
    let mut hashes = BTreeMap::new();
    for entry in walkdir::WalkDir::new(root)
        .into_iter()
        .map(Result::unwrap)
        .filter(|e| e.file_type().is_file())
    {
        let relative = identity::relative(root, entry.path()).unwrap();
        if !relative.starts_with(".properbooky/")
            || relative.starts_with(".properbooky/state/")
            || relative.starts_with(".properbooky/covers/")
        {
            hashes.insert(
                relative,
                desktop_lib::matcher::sha256_file(entry.path()).unwrap(),
            );
        }
    }
    let conn = db::open(&root.join(".properbooky/pilot.db")).unwrap();
    scanner::scan_library(&conn, root).unwrap();
    let before = library::list(&conn, root, None).unwrap();
    let mut merged = 0;
    for _ in 0..3 {
        let books = library::list(&conn, root, None).unwrap();
        let pair = books.iter().find_map(|a| {
            books
                .iter()
                .find(|b| {
                    a.details.stable_id != b.details.stable_id
                        && a.details.asset_id.is_some()
                        && a.details.asset_id == b.details.asset_id
                })
                .map(|b| (a, b))
        });
        let Some((keep, other)) = pair else {
            break;
        };
        library::merge(
            &conn,
            root,
            &keep.details.stable_id,
            &other.details.stable_id,
            library::Edit::from(keep),
        )
        .unwrap();
        merged += 1;
    }
    assert!(
        merged > 0,
        "pilot must include shared-file duplicate candidates"
    );
    let rebuilt = db::open(&root.join(".properbooky/pilot-rebuilt.db")).unwrap();
    scanner::scan_library(&rebuilt, root).unwrap();
    let combined = library::list(&rebuilt, root, None).unwrap();
    assert_eq!(combined.len(), before.len() - merged);
    assert_eq!(
        combined
            .iter()
            .map(|b| b.details.source_profiles.len())
            .sum::<usize>(),
        before.len()
    );
    for _ in 0..merged {
        library::undo(&rebuilt, root).unwrap();
    }
    assert_eq!(
        library::list(&rebuilt, root, None).unwrap().len(),
        before.len()
    );
    for (relative, hash) in &hashes {
        assert_eq!(
            &desktop_lib::matcher::sha256_file(&root.join(relative)).unwrap(),
            hash
        );
    }
    println!("pilot: {merged} combinations, {} visible sources, {} unchanged source/state files; rebuild and undo passed", before.len(), hashes.len());
}
