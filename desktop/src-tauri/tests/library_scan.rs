use desktop_lib::{db, scanner};
use std::fs;
use std::path::PathBuf;

fn temp_path(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("properbooky-test-{}", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    dir.join(name)
}

#[test]
fn scan_indexes_categories_and_rebuilds_identically() {
    let root = temp_path("library");
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(root.join("Trading")).unwrap();
    fs::write(root.join("Trading/Price_Action-Basics.pdf"), b"%PDF-1.4 dummy").unwrap();
    fs::write(root.join("root-level.pdf"), b"%PDF-1.4 dummy").unwrap();
    fs::write(root.join("notes.md"), b"# notes").unwrap();
    fs::write(root.join("ignored.txt"), b"nope").unwrap();
    fs::create_dir_all(root.join("Catalog")).unwrap();
    fs::write(
        root.join("Catalog/Erin Meyer - The Culture Map.md"),
        "---\ntitle: The Culture Map\nauthor: Erin Meyer\nstatus: wishlist\nrating: 5\ntopics:\n- Business and Economics\n---\n\nLeadership impact is culture.\n",
    )
    .unwrap();

    let db_file = temp_path("library.db");
    let _ = fs::remove_file(&db_file);
    let conn = db::open(&db_file).unwrap();

    let result = scanner::scan_library(&conn, &root).unwrap();
    assert_eq!(result.indexed, 4, "pdf/md/catalog indexed, txt ignored");

    // Catalog frontmatter becomes a catalog entry with status/rating facets.
    let (kind, status, rating, title): (String, String, i64, String) = conn
        .query_row(
            "SELECT kind, status, rating, title FROM books WHERE author = 'Erin Meyer'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .unwrap();
    assert_eq!(
        (kind.as_str(), status.as_str(), rating, title.as_str()),
        ("catalog", "wishlist", 5, "The Culture Map")
    );

    // Filename-derived title and folder-derived category.
    let (title, category): (String, Option<String>) = conn
        .query_row(
            "SELECT title, category FROM books WHERE filename = 'Price_Action-Basics.pdf'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(title, "Price Action Basics");
    assert_eq!(category.as_deref(), Some("Trading"));

    let root_category: Option<String> = conn
        .query_row(
            "SELECT category FROM books WHERE filename = 'root-level.pdf'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(root_category, None, "root-level files have no category");

    // FTS prefix search hits title tokens and category.
    let hits: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM books_fts WHERE books_fts MATCH '\"price\"*'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(hits, 1);

    // Rebuild converges: delete the DB, rescan, same book set.
    drop(conn);
    fs::remove_file(&db_file).unwrap();
    let conn = db::open(&db_file).unwrap();
    let rescan = scanner::scan_library(&conn, &root).unwrap();
    assert_eq!(rescan.indexed, 4);
}

/// Gated scan of a real library folder. Run with:
/// PB_TEST_LIBRARY="/path/to/books" cargo test -- --nocapture
#[test]
fn scan_real_library_if_configured() {
    let Some(path) = std::env::var_os("PB_TEST_LIBRARY") else {
        return;
    };
    let root = PathBuf::from(path);
    let db_file = temp_path("real-library.db");
    let _ = fs::remove_file(&db_file);
    let conn = db::open(&db_file).unwrap();

    let result = scanner::scan_library(&conn, &root).unwrap();
    let with_category: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM books WHERE category IS NOT NULL",
            [],
            |r| r.get(0),
        )
        .unwrap();
    println!(
        "real library: indexed={} skipped={} with_category={}",
        result.indexed, result.skipped, with_category
    );
    assert!(result.indexed > 0);
}
