use desktop_lib::annotations;
use serde_json::json;
use std::fs;
use std::path::PathBuf;

fn temp_sidecar(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("properbooky-ann-{}", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    let path = dir.join(name);
    let _ = fs::remove_file(&path);
    path
}

#[test]
fn add_list_remove_roundtrip_with_tombstones() {
    let sidecar = temp_sidecar("book.pdf.json");

    // Position first, then highlights — both live in the same file.
    annotations::set_position(&sidecar, "12".to_owned(), Some(0.25)).unwrap();

    let h1 = annotations::add_highlight(
        &sidecar,
        "Not all books are equal.".to_owned(),
        Some("core thesis".to_owned()),
        None,
        json!({"type": "pdf", "page": 12, "quote": {"exact": "Not all books are equal.", "prefix": "", "suffix": ""}}),
    )
    .unwrap();
    let h2 = annotations::add_highlight(
        &sidecar,
        "Priority is a function of recommendation weight.".to_owned(),
        None,
        None,
        json!({"type": "epub-cfi", "cfi": "epubcfi(/6/4!/4/2/2)"}),
    )
    .unwrap();

    let live = annotations::live_highlights(&sidecar);
    assert_eq!(live.len(), 2);
    assert_ne!(h1.id, h2.id);
    assert!(live.iter().all(|h| !h.deleted));

    // Position survived the highlight writes.
    let loaded = annotations::load(&sidecar);
    assert_eq!(loaded.position.as_deref(), Some("12"));
    assert_eq!(loaded.percent, Some(0.25));

    // Removal is a tombstone, not a delete.
    assert!(annotations::remove_highlight(&sidecar, &h1.id).unwrap());
    let live = annotations::live_highlights(&sidecar);
    assert_eq!(live.len(), 1);
    assert_eq!(live[0].id, h2.id);
    let all = annotations::load(&sidecar).highlights;
    assert_eq!(all.len(), 2, "tombstoned row still present on disk");
    assert!(all.iter().any(|h| h.id == h1.id && h.deleted));

    // Removing again is a no-op.
    assert!(!annotations::remove_highlight(&sidecar, &h1.id).unwrap());

    // Saving a new position never clobbers highlights.
    annotations::set_position(&sidecar, "13".to_owned(), Some(0.26)).unwrap();
    assert_eq!(annotations::live_highlights(&sidecar).len(), 1);

    // Notes attach to live highlights; empty note clears.
    assert!(annotations::set_note(&sidecar, &h2.id, Some("key idea".into())).unwrap());
    assert_eq!(
        annotations::live_highlights(&sidecar)[0].note.as_deref(),
        Some("key idea")
    );
    assert!(annotations::set_note(&sidecar, &h2.id, Some("  ".into())).unwrap());
    assert_eq!(annotations::live_highlights(&sidecar)[0].note, None);
    // Tombstoned highlights reject notes.
    assert!(!annotations::set_note(&sidecar, &h1.id, Some("x".into())).unwrap());
}

#[test]
fn sidecar_tolerates_legacy_progress_only_files() {
    let sidecar = temp_sidecar("legacy.epub.json");
    fs::write(
        &sidecar,
        r#"{"position":"epubcfi(/6/4!/4/2/2)","percent":0.5,"updated_at":1752300000}"#,
    )
    .unwrap();
    let loaded = annotations::load(&sidecar);
    assert_eq!(loaded.position.as_deref(), Some("epubcfi(/6/4!/4/2/2)"));
    assert!(loaded.highlights.is_empty());
    // And it upgrades cleanly.
    annotations::add_highlight(&sidecar, "q".into(), None, None, json!({})).unwrap();
    assert_eq!(annotations::live_highlights(&sidecar).len(), 1);
}
