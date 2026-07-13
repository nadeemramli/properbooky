use desktop_lib::{annotations, export};
use serde_json::json;
use std::fs;

#[test]
fn exports_notes_with_identity_and_skips_tombstones() {
    let root = std::env::temp_dir().join(format!("properbooky-exp-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(root.join("Catalog")).unwrap();
    fs::create_dir_all(root.join("Library/05 Trading & Markets")).unwrap();

    // A linked catalog entry and its book file.
    fs::write(
        root.join("Catalog/Annie Duke - Thinking in Bets.md"),
        "---\ntitle: Thinking in Bets\nauthor: Annie Duke\nstatus: available\nfile: Library/05 Trading & Markets/Annie Duke - Thinking in Bets.pdf\n---\n",
    )
    .unwrap();
    fs::write(
        root.join("Library/05 Trading & Markets/Annie Duke - Thinking in Bets.pdf"),
        b"%PDF-1.4",
    )
    .unwrap();

    // Sidecar with one live + one tombstoned highlight.
    let state = root.join(".properbooky/state");
    fs::create_dir_all(&state).unwrap();
    let sidecar =
        state.join("Library__05 Trading & Markets__Annie Duke - Thinking in Bets.pdf.json");
    annotations::add_highlight(
        &sidecar,
        "Decisions are bets on the future.".to_owned(),
        Some("thesis".to_owned()),
        None,
        json!({"type": "pdf", "page": 3}),
    )
    .unwrap();
    let doomed = annotations::add_highlight(
        &sidecar,
        "This one is deleted.".to_owned(),
        None,
        None,
        json!({"type": "pdf", "page": 4}),
    )
    .unwrap();
    annotations::remove_highlight(&sidecar, &doomed.id).unwrap();

    let out = root.join("vault/Properbooky");
    let report = export::export_highlights(&root, &out).unwrap();
    assert_eq!(report.books, 1);
    assert_eq!(report.highlights, 1);

    let note = fs::read_to_string(out.join("Annie Duke - Thinking in Bets.md")).unwrap();
    assert!(note.contains("author: Annie Duke"));
    assert!(note.contains("> Decisions are bets on the future."));
    assert!(note.contains("page 3"));
    assert!(note.contains("^pb-"));
    assert!(note.contains("**Note:** thesis"));
    assert!(!note.contains("This one is deleted"));
}
