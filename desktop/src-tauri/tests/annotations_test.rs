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

#[test]
fn unreadable_sidecar_is_set_aside_not_overwritten() {
    let dir = tempfile::tempdir().unwrap();
    let sidecar = dir.path().join("asset-x.json");
    let corrupt = br#"{"position": "2", "highlights": [ {"id": "keep-me""#;
    fs::write(&sidecar, corrupt).unwrap();

    // The reader's load reports the problem and starts from empty state.
    let loaded = annotations::load_checked(&sidecar).unwrap();
    assert!(loaded.position.is_none());
    let notice = loaded.notice.expect("corruption is reported");
    assert!(notice.contains("asset-x.json.unreadable-"), "{notice}");

    // The original bytes survive beside the sidecar, never as live *.json.
    let kept: Vec<_> = fs::read_dir(dir.path())
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p != &sidecar)
        .collect();
    assert_eq!(kept.len(), 1);
    assert_eq!(fs::read(&kept[0]).unwrap(), corrupt);
    assert_ne!(kept[0].extension().and_then(|e| e.to_str()), Some("json"));

    // A write after corruption (even without a prior load) never clobbers.
    fs::write(&sidecar, b"not json").unwrap();
    annotations::set_position(&sidecar, "3".into(), Some(0.5)).unwrap();
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 3);
    let saved = annotations::load_checked(&sidecar).unwrap();
    assert_eq!(saved.position.as_deref(), Some("3"));
    assert!(saved.notice.is_none());
    // The notice is never persisted.
    assert!(!fs::read_to_string(&sidecar).unwrap().contains("notice"));
}

#[test]
fn unwritable_sidecar_reports_an_error_and_keeps_existing_state() {
    let dir = tempfile::tempdir().unwrap();
    // A directory where the sidecar should be: reads and writes both fail
    // (even as root), unlike permission bits.
    let blocked = dir.path().join("blocked.json");
    fs::create_dir(&blocked).unwrap();
    let read = annotations::load_checked(&blocked).unwrap_err();
    assert!(format!("{read:#}").contains("cannot read reading state"));
    let write = annotations::set_position(&blocked, "1".into(), None).unwrap_err();
    assert!(format!("{write:#}").contains("blocked.json"));
    assert!(
        blocked.is_dir(),
        "a failed write must not remove what was there"
    );

    // A failed atomic save leaves the previous sidecar byte-identical.
    let sidecar = dir.path().join("ok.json");
    annotations::set_position(&sidecar, "5".into(), Some(0.5)).unwrap();
    let before = fs::read(&sidecar).unwrap();
    let state = dir.path().join("state");
    fs::write(&state, b"a file where a directory is expected").unwrap();
    let nested = state.join("child.json");
    assert!(annotations::set_position(&nested, "6".into(), None).is_err());
    assert_eq!(fs::read(&sidecar).unwrap(), before);
}

#[test]
fn highlights_are_uuid_keyed_with_lww_timestamps_and_durable_tombstones() {
    let dir = tempfile::tempdir().unwrap();
    let sidecar = dir.path().join("asset.json");
    let anchor = json!({"type": "epub-cfi", "cfi": "epubcfi(/6/4!/4/2,/1:0,/1:5)",
        "quote": {"exact": "quiet", "prefix": "and ", "suffix": " weather"},
        "position": {"start": 120, "end": 125}, "href": "ch2.xhtml", "chapter": "Second Watch"});
    let h =
        annotations::add_highlight(&sidecar, "quiet".into(), None, None, anchor.clone()).unwrap();
    assert!(uuid::Uuid::parse_str(&h.id).is_ok());
    assert_eq!(h.created_at, h.updated_at);
    // The whole multi-selector envelope round-trips unchanged.
    assert_eq!(annotations::live_highlights(&sidecar)[0].anchor, anchor);
    assert!(annotations::set_note(&sidecar, &h.id, Some("n".into())).unwrap());
    assert!(annotations::remove_highlight(&sidecar, &h.id).unwrap());
    let stored = &annotations::load(&sidecar).highlights[0];
    assert!(stored.deleted && stored.updated_at >= stored.created_at);
    // A position write later keeps the tombstone (reload from disk).
    annotations::set_position(&sidecar, "epubcfi(/6/2!/4/2/1:0)".into(), Some(0.1)).unwrap();
    let reloaded = annotations::load(&sidecar);
    assert_eq!(reloaded.highlights.len(), 1);
    assert!(reloaded.highlights[0].deleted);
    assert!(annotations::live_highlights(&sidecar).is_empty());
}
