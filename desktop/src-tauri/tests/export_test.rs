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

fn library_with_pdf(root: &std::path::Path) -> std::path::PathBuf {
    fs::create_dir_all(root.join("Catalog")).unwrap();
    fs::write(
        root.join("Catalog/Tide.md"),
        "---\ntitle: Tidewater Echo Ledger\nauthor: Synthetic Harbormaster\nstatus: reading\nfile: tide.pdf\n---\n",
    )
    .unwrap();
    fs::write(root.join("tide.pdf"), b"%PDF-1.4 tide").unwrap();
    root.join(".properbooky/state/tide.pdf.json")
}

fn pdf_anchor(page: i64, start: i64) -> serde_json::Value {
    json!({"type": "pdf", "page": page,
        "quote": {"exact": "the tide returns the ledger", "prefix": "South pier: ", "suffix": " after"},
        "position": {"start": start, "end": start + 27}})
}

#[test]
fn rerun_is_idempotent_and_keeps_user_content_and_identity() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let sidecar = library_with_pdf(root);
    let first = annotations::add_highlight(
        &sidecar,
        "the tide returns the ledger".into(),
        Some("second pier".into()),
        None,
        pdf_anchor(2, 140),
    )
    .unwrap();
    let out = root.join("vault/Properbooky");
    let report = export::export_highlights(root, &out).unwrap();
    assert_eq!((report.books, report.highlights, report.written), (1, 1, 1));
    let note = out.join("Synthetic Harbormaster - Tidewater Echo Ledger.md");
    let text = fs::read_to_string(&note).unwrap();
    assert!(text.starts_with("---\ntitle: Tidewater Echo Ledger\nauthor: Synthetic Harbormaster\nsource: tide.pdf\ngenerated_by: properbooky\n---\n"));
    assert!(text.contains(export::BLOCK_START) && text.contains(export::BLOCK_END));
    assert!(text.contains("> the tide returns the ledger\n> — page 2 ^pb-"));
    assert!(text.contains(&format!("^{}", export::block_id(&first.id))));
    assert!(text.contains("**Note:** second pier"));

    // Rerun: byte-identical and not rewritten.
    let modified = fs::metadata(&note).unwrap().modified().unwrap();
    let again = export::export_highlights(root, &out).unwrap();
    assert_eq!(again.written, 0);
    assert_eq!(fs::read_to_string(&note).unwrap(), text);
    assert_eq!(fs::metadata(&note).unwrap().modified().unwrap(), modified);

    // The user writes above and below the block and adds a frontmatter key.
    let edited =
        text.replacen(
            "generated_by: properbooky\n",
            "generated_by: properbooky\ntags: [harbor]\n",
            1,
        )
        .replacen(
            export::BLOCK_START,
            &format!("My intro line.\n\n{}", export::BLOCK_START),
            1,
        ) + "\n## My thoughts\nThe tide line matters.\n";
    fs::write(&note, &edited).unwrap();
    // New highlight, then the catalog title is corrected.
    let second = annotations::add_highlight(
        &sidecar,
        "Harbor office".into(),
        None,
        None,
        pdf_anchor(2, 170),
    )
    .unwrap();
    fs::write(
        root.join("Catalog/Tide.md"),
        "---\ntitle: Tidewater Echo Ledger (Revised)\nauthor: Synthetic Harbormaster\nstatus: reading\nfile: tide.pdf\n---\n",
    )
    .unwrap();
    let third = export::export_highlights(root, &out).unwrap();
    assert_eq!(third.written, 1);
    // Same file (matched by source), user content and key intact, block updated.
    assert_eq!(fs::read_dir(&out).unwrap().count(), 1);
    let text = fs::read_to_string(&note).unwrap();
    assert!(text.contains("title: Tidewater Echo Ledger (Revised)"));
    assert!(text.contains("tags:"));
    assert!(text.contains("My intro line.\n\n<!-- properbooky:highlights:start"));
    assert!(text.contains("## My thoughts\nThe tide line matters.\n"));
    assert!(text.contains(&export::block_id(&second.id)));
    // Idempotent again after the merge.
    assert_eq!(export::export_highlights(root, &out).unwrap().written, 0);

    // Removing every highlight empties the block but keeps the user's text.
    annotations::remove_highlight(&sidecar, &first.id).unwrap();
    annotations::remove_highlight(&sidecar, &second.id).unwrap();
    let emptied = export::export_highlights(root, &out).unwrap();
    assert_eq!(
        (emptied.books, emptied.highlights, emptied.written),
        (0, 0, 1)
    );
    let text = fs::read_to_string(&note).unwrap();
    assert!(text.contains("_No highlights._"));
    assert!(!text.contains("the tide returns the ledger"));
    assert!(text.contains("The tide line matters."));
}

#[test]
fn legacy_notes_keep_user_lines_and_foreign_files_are_untouched() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let sidecar = library_with_pdf(root);
    let h = annotations::add_highlight(
        &sidecar,
        "the tide returns the ledger".into(),
        Some("old note".into()),
        None,
        pdf_anchor(2, 140),
    )
    .unwrap();
    let out = root.join("vault/Properbooky");
    fs::create_dir_all(&out).unwrap();
    // A note written by the exporter before markers, plus a user line.
    let legacy = format!(
        "---\ntitle: Tidewater Echo Ledger\nauthor: Synthetic Harbormaster\nsource: tide.pdf\ngenerated_by: properbooky\n---\n\n# Tidewater Echo Ledger\n\n## Highlights\n\n> the tide returns the ledger\n> — page 2 ^pb-{}\n\n**Note:** old note\n\nMy remark kept from before.\n",
        &h.id[..8]
    );
    let note = out.join("Synthetic Harbormaster - Tidewater Echo Ledger.md");
    fs::write(&note, legacy).unwrap();
    export::export_highlights(root, &out).unwrap();
    let text = fs::read_to_string(&note).unwrap();
    assert_eq!(text.matches("> the tide returns the ledger").count(), 1);
    assert_eq!(text.matches("My remark kept from before.").count(), 1);
    assert!(text.find(export::BLOCK_END).unwrap() < text.find("My remark").unwrap());
    assert_eq!(export::export_highlights(root, &out).unwrap().written, 0);

    // A file the user made with the same name is never overwritten.
    fs::remove_file(&note).unwrap();
    fs::write(&note, "# My own page about the ledger\n").unwrap();
    let report = export::export_highlights(root, &out).unwrap();
    assert_eq!(
        fs::read_to_string(&note).unwrap(),
        "# My own page about the ledger\n"
    );
    assert!(
        report.skipped.is_empty(),
        "a new note name is chosen instead"
    );
    let written: Vec<_> = fs::read_dir(&out)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|n| n != "Synthetic Harbormaster - Tidewater Echo Ledger.md")
        .collect();
    assert_eq!(written.len(), 1);
    assert!(fs::read_to_string(out.join(&written[0]))
        .unwrap()
        .contains("^pb-"));
}

#[test]
fn unreadable_sidecar_never_empties_a_note_and_epub_locations_are_described() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let sidecar = library_with_pdf(root);
    annotations::add_highlight(&sidecar, "kept".into(), None, None, pdf_anchor(1, 0)).unwrap();
    let out = root.join("vault/Properbooky");
    export::export_highlights(root, &out).unwrap();
    let note = out.join("Synthetic Harbormaster - Tidewater Echo Ledger.md");
    let before = fs::read_to_string(&note).unwrap();
    fs::write(&sidecar, b"{ not json").unwrap();
    let report = export::export_highlights(root, &out).unwrap();
    assert_eq!(report.skipped.len(), 1, "{:?}", report.skipped);
    assert_eq!(fs::read_to_string(&note).unwrap(), before);
    // The sidecar itself is left as it was (export is read-only).
    assert_eq!(fs::read(&sidecar).unwrap(), b"{ not json");

    assert_eq!(
        export::describe_anchor(
            &json!({"type": "epub-cfi", "cfi": "epubcfi(/6/4!/4/2,/1:0,/1:5)", "chapter": " Second Watch ", "percent": 0.4249})
        ),
        "Second Watch · 42%"
    );
    assert_eq!(
        export::describe_anchor(&json!({"type": "epub-cfi", "cfi": "x"})),
        "epub location"
    );
    assert_eq!(
        export::describe_anchor(&json!({"type": "pdf", "page": 3})),
        "page 3"
    );
}
