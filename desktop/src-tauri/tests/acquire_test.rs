use desktop_lib::{acquire, catalog, db, scanner};
use std::fs;
use std::path::PathBuf;

fn temp_library() -> PathBuf {
    let dir = std::env::temp_dir().join(format!("properbooky-acq-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("Catalog")).unwrap();
    fs::create_dir_all(dir.join("Drop")).unwrap();
    dir
}

fn write_entry(root: &PathBuf, title: &str, author: &str, topics: &str, status: &str) -> PathBuf {
    let path = root
        .join("Catalog")
        .join(catalog::entry_filename(title, Some(author)));
    fs::write(
        &path,
        format!(
            "---\ntitle: {title}\nauthor: {author}\nstatus: {status}\ntopics:\n- {topics}\n---\n"
        ),
    )
    .unwrap();
    path
}

#[test]
fn drop_processing_files_matches_and_leaves_strangers() {
    let root = temp_library();
    let db_path = root.join("index.db");
    let conn = db::open(&db_path).unwrap();

    let entry_md = write_entry(
        &root,
        "The Taylor Trading Technique",
        "George D. Taylor",
        "Trading",
        "queued",
    );
    write_entry(&root, "The Culture Map", "Erin Meyer", "Business", "wishlist");

    // A downloaded file with shadow-library naming, and an unrelated one.
    fs::write(
        root.join("Drop/George D. Taylor - The Taylor Trading Technique (1994, Traders Press) - libgen.li.pdf"),
        b"%PDF-1.4 x",
    )
    .unwrap();
    fs::write(root.join("Drop/random-paper-2015.pdf"), b"%PDF-1.4 y").unwrap();

    // Index the catalog so the status mirror has rows to update.
    scanner::scan_library(&conn, &root).unwrap();

    let report = acquire::process_drop(&conn, &root).unwrap();
    assert_eq!(report.filed, 1, "outcomes: {:?}", report.outcomes.iter().map(|o| (&o.filename, &o.result)).collect::<Vec<_>>());
    assert_eq!(report.left, 1);

    // Filed into the inbox shelf under the canonical name.
    let filed = root.join("Library/00 Inbox/George D. Taylor - The Taylor Trading Technique.pdf");
    assert!(filed.exists());
    assert!(!root
        .join("Drop/George D. Taylor - The Taylor Trading Technique (1994, Traders Press) - libgen.li.pdf")
        .exists());
    // Stranger stays in Drop.
    assert!(root.join("Drop/random-paper-2015.pdf").exists());

    // Catalog entry linked, hashed, flipped to available; original kept.
    let (entry, _) = catalog::parse(&fs::read_to_string(&entry_md).unwrap()).unwrap();
    assert_eq!(entry.status, "available");
    assert_eq!(
        entry.file.as_deref(),
        Some("Library/00 Inbox/George D. Taylor - The Taylor Trading Technique.pdf")
    );
    assert!(entry.hash.is_some());
    assert!(entry.original_filename.is_some());

    // Index row mirrored.
    let status: String = conn
        .query_row(
            "SELECT status FROM books WHERE path = ?1",
            [entry_md.to_string_lossy()],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(status, "available");
}

#[test]
fn set_status_updates_markdown_and_index() {
    let root = temp_library();
    let conn = db::open(&root.join("index.db")).unwrap();
    let md = write_entry(&root, "Antifragile", "Nassim Taleb", "Philosophy", "wishlist");
    scanner::scan_library(&conn, &root).unwrap();

    acquire::set_status(&conn, &md, "queued").unwrap();

    let (entry, _) = catalog::parse(&fs::read_to_string(&md).unwrap()).unwrap();
    assert_eq!(entry.status, "queued");
    let status: String = conn
        .query_row(
            "SELECT status FROM books WHERE path = ?1",
            [md.to_string_lossy()],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(status, "queued");
}
