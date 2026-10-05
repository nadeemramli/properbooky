// PBK-26 review repair: notes written by the exporter before block markers.
// Ownership of their text is proven by exact bytes, never guessed from
// Markdown shape; what cannot be proven is kept verbatim or the note is left
// unchanged with a reason. All through the public `export::export_highlights`.
use desktop_lib::annotations::{self, Highlight};
use desktop_lib::export;
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};

const PDF_NOTE: &str = "Synthetic Harbormaster - Tidewater Echo Ledger.md";
const EPUB_NOTE: &str = "Synthetic Fixture - Zephyr Lantern Field Notes.md";

/// The pre-marker exporter's note, verbatim from main 44e96b6 (export.rs:
/// yaml_quote, describe_anchor, the document assembly). Identical in every
/// version before markers (72ca43c, 676498a, 2f17383) apart from `source:`
/// quoting, which only the frontmatter sees.
fn legacy_note(title: &str, author: Option<&str>, relative: &str, highlights: &[&Highlight]) -> String {
    fn yaml_quote(value: &str) -> String {
        serde_yaml::to_string(value)
            .map(|s| s.trim_end().to_owned())
            .unwrap_or_else(|_| format!("\"{value}\""))
    }
    fn describe_anchor(anchor: &serde_json::Value) -> String {
        if let Some(page) = anchor.get("page").and_then(|p| p.as_i64()) {
            return format!("page {page}");
        }
        match anchor.get("type").and_then(|t| t.as_str()) {
            Some("article") => "article".to_owned(),
            Some("epub-cfi") => "epub location".to_owned(),
            _ => "unknown location".to_owned(),
        }
    }
    let mut doc = String::new();
    doc.push_str("---\n");
    doc.push_str(&format!("title: {}\n", yaml_quote(title)));
    if let Some(author) = &author {
        doc.push_str(&format!("author: {}\n", yaml_quote(author)));
    }
    doc.push_str(&format!("source: {}\n", yaml_quote(relative)));
    doc.push_str("generated_by: properbooky\n");
    doc.push_str("---\n\n");
    doc.push_str(&format!("# {title}\n\n## Highlights\n\n"));
    for h in highlights {
        for line in h.text.lines() {
            doc.push_str(&format!("> {line}\n"));
        }
        doc.push_str(&format!("> — {} ^pb-{}\n\n", describe_anchor(&h.anchor), &h.id[..8]));
        if let Some(note) = &h.note {
            doc.push_str(&format!("**Note:** {note}\n\n"));
        }
    }
    doc
}

struct Library {
    _dir: tempfile::TempDir,
    root: PathBuf,
    out: PathBuf,
    pdf: PathBuf,
    epub: PathBuf,
}

/// A PDF and an EPUB in the catalog, both with sidecars; nothing exported.
fn library() -> Library {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().to_path_buf();
    fs::create_dir_all(root.join("Catalog")).unwrap();
    fs::write(
        root.join("Catalog/Tide.md"),
        "---\ntitle: Tidewater Echo Ledger\nauthor: Synthetic Harbormaster\nstatus: reading\nfile: tide.pdf\n---\n",
    )
    .unwrap();
    fs::write(
        root.join("Catalog/Zephyr.md"),
        "---\ntitle: Zephyr Lantern Field Notes\nauthor: Synthetic Fixture\nstatus: reading\nfile: zephyr.epub\n---\n",
    )
    .unwrap();
    fs::write(root.join("tide.pdf"), b"%PDF-1.4 tide").unwrap();
    fs::write(root.join("zephyr.epub"), b"not really an epub").unwrap();
    let out = root.join("vault/Properbooky");
    fs::create_dir_all(&out).unwrap();
    Library {
        pdf: root.join(".properbooky/state/tide.pdf.json"),
        epub: root.join(".properbooky/state/zephyr.epub.json"),
        root,
        out,
        _dir: dir,
    }
}

fn add(sidecar: &Path, text: &str, note: Option<&str>, anchor: serde_json::Value) -> Highlight {
    let h = annotations::add_highlight(sidecar, text.into(), note.map(Into::into), None, anchor).unwrap();
    // Distinct creation times keep the legacy order deterministic.
    std::thread::sleep(std::time::Duration::from_millis(2));
    h
}

fn page(n: i64) -> serde_json::Value {
    json!({"type": "pdf", "page": n})
}

fn epub(chapter: &str) -> serde_json::Value {
    json!({"type": "epub-cfi", "cfi": "epubcfi(/6/4!/4/2,/1:0,/1:5)", "chapter": chapter, "percent": 0.4})
}

/// Bytes and modification time: a refused note must be left exactly as is.
fn snapshot(path: &Path) -> (Vec<u8>, std::time::SystemTime) {
    (fs::read(path).unwrap(), fs::metadata(path).unwrap().modified().unwrap())
}

fn read(path: &Path) -> String {
    fs::read_to_string(path).unwrap()
}

fn tail_after_block(text: &str) -> &str {
    let end = text.find(export::BLOCK_END).expect("block end") + export::BLOCK_END.len();
    &text[end..]
}

/// Every kind of user-authored Markdown written after the old exporter's
/// highlights: commentary, a quote, a **Note:** line, headings, blank lines,
/// CRLF lines among LF lines and no final newline.
const USER_TAIL: &str = "My own commentary:\n> USER QUOTE: the ledger is wrong\n> USER QUOTE: second line\n**Note:** USER NOTE LINE\n\n\n## Highlights\n# My own heading\r\nCRLF line from another editor\r\n\r\n- [ ] follow up on page 2\n> — page 9 ^pb-userlink\nlast line without newline";

#[test]
fn legacy_note_migrates_by_proof_and_keeps_every_user_byte() {
    let lib = library();
    // At the time of the old export: a multi-line quote with a multi-line
    // note, a plain one, and one the user later removes in the app.
    let a = add(&lib.pdf, "the tide returns the ledger\nand the pier", Some("first thought\n\nsecond paragraph\n> quoted inside my note"), page(2));
    let b = add(&lib.pdf, "Harbor office", None, page(3));
    let c = add(&lib.pdf, "removed later", Some("gone"), page(4));
    let legacy = legacy_note("Tidewater Echo Ledger", Some("Synthetic Harbormaster"), "tide.pdf", &[&a, &b, &c]);
    let note = lib.out.join(PDF_NOTE);
    fs::write(&note, format!("{legacy}{USER_TAIL}")).unwrap();
    annotations::remove_highlight(&lib.pdf, &c.id).unwrap();

    let report = export::export_highlights(&lib.root, &lib.out).unwrap();
    assert!(report.skipped.is_empty(), "{:?}", report.skipped);
    assert_eq!((report.books, report.highlights, report.written), (1, 2, 1));
    let text = read(&note);
    // Frontmatter unchanged, block first, then the user's bytes verbatim.
    let front_end = legacy.find("\n---\n").unwrap() + 5;
    assert!(text.starts_with(&legacy[..front_end]));
    assert!(text[front_end..].starts_with(&format!("\n{}", export::BLOCK_START)));
    assert_eq!(tail_after_block(&text), format!("\n\n{USER_TAIL}"));
    // Generated content exactly once, in the block; the removed one gone.
    assert_eq!(text.matches("> the tide returns the ledger\n> and the pier\n").count(), 1);
    assert_eq!(text.matches("> Harbor office\n").count(), 1);
    assert_eq!(text.matches(&format!("^{}", export::block_id(&a.id))).count(), 1);
    assert_eq!(text.matches("**Note:** first thought\n\nsecond paragraph\n> quoted inside my note\n").count(), 1);
    assert!(!text.contains("removed later") && !text.contains(&c.id[..8]));
    assert_eq!(text.matches("# Tidewater Echo Ledger\n").count(), 1);

    // Repeated exports: byte-identical and not rewritten.
    let before = snapshot(&note);
    for _ in 0..2 {
        let again = export::export_highlights(&lib.root, &lib.out).unwrap();
        assert_eq!((again.written, again.skipped.len()), (0, 0));
        assert_eq!(snapshot(&note), before);
    }

    // Later highlight changes touch only the block.
    let d = add(&lib.pdf, "a new line from the app", None, page(5));
    assert_eq!(export::export_highlights(&lib.root, &lib.out).unwrap().written, 1);
    let text = read(&note);
    assert!(text.contains(&export::block_id(&d.id)));
    assert_eq!(tail_after_block(&text), format!("\n\n{USER_TAIL}"));
    for h in [&a, &b, &d] {
        annotations::remove_highlight(&lib.pdf, &h.id).unwrap();
    }
    let emptied = export::export_highlights(&lib.root, &lib.out).unwrap();
    assert_eq!((emptied.books, emptied.written), (0, 1));
    let text = read(&note);
    assert!(text.contains("_No highlights._") && !text.contains("Harbor office"));
    assert_eq!(tail_after_block(&text), format!("\n\n{USER_TAIL}"));
}

#[test]
fn unproven_text_is_kept_never_dropped() {
    let lib = library();
    // EPUB entry (old "epub location" text); its note was edited in the app
    // after the old export, so the old note line is no longer provably ours.
    let a = add(&lib.epub, "quiet weather", Some("old note"), epub("First Light"));
    let legacy = legacy_note("Zephyr Lantern Field Notes", Some("Synthetic Fixture"), "zephyr.epub", &[&a]);
    assert!(legacy.contains("> — epub location ^pb-"));
    let note = lib.out.join(EPUB_NOTE);
    fs::write(&note, &legacy).unwrap();
    annotations::set_note(&lib.epub, &a.id, Some("new note".into())).unwrap();
    // Catalog title corrected since: the old heading is still proven by the
    // note's own frontmatter title.
    fs::write(
        lib.root.join("Catalog/Zephyr.md"),
        "---\ntitle: Zephyr Lantern Field Notes (Revised)\nauthor: Synthetic Fixture\nstatus: reading\nfile: zephyr.epub\n---\n",
    )
    .unwrap();
    let report = export::export_highlights(&lib.root, &lib.out).unwrap();
    assert!(report.skipped.is_empty(), "{:?}", report.skipped);
    let text = read(&note);
    assert!(text.contains("title: Zephyr Lantern Field Notes (Revised)"));
    assert!(text.contains("**Note:** new note"));
    assert_eq!(tail_after_block(&text), "\n\n**Note:** old note\n\n");
    assert_eq!(text.matches("> quiet weather\n").count(), 1);
    assert_eq!(export::export_highlights(&lib.root, &lib.out).unwrap().written, 0);
}

#[test]
fn ambiguous_legacy_notes_are_refused_without_any_write() {
    let lib = library();
    let a = add(&lib.pdf, "the tide returns the ledger", Some("thesis"), page(2));
    let b = add(&lib.pdf, "Harbor office", None, page(3));
    let e = add(&lib.epub, "quiet weather", None, epub("First Light"));
    let pdf_legacy = legacy_note("Tidewater Echo Ledger", Some("Synthetic Harbormaster"), "tide.pdf", &[&a, &b]);
    let mine = "My thought about the first highlight.\n> USER QUOTE between highlights\n\n";
    let entry_b = format!("> Harbor office\n> — page 3 ^pb-{}\n\n", &b.id[..8]);
    let interleaved = pdf_legacy.replacen(&entry_b, &format!("{mine}{entry_b}"), 1);
    assert_ne!(interleaved, pdf_legacy);
    let note = lib.out.join(PDF_NOTE);
    fs::write(&note, &interleaved).unwrap();
    let epub_note = lib.out.join(EPUB_NOTE);
    fs::write(&epub_note, legacy_note("Zephyr Lantern Field Notes", Some("Synthetic Fixture"), "zephyr.epub", &[&e])).unwrap();
    let before = snapshot(&note);

    // Refused with a reason and a way out; the other book still migrates.
    for _ in 0..2 {
        let report = export::export_highlights(&lib.root, &lib.out).unwrap();
        assert_eq!(report.skipped.len(), 1, "{:?}", report.skipped);
        let reason = &report.skipped[0];
        assert!(reason.starts_with(&format!("{PDF_NOTE}: left unchanged: ")), "{reason}");
        assert!(reason.contains("you wrote between its highlights"), "{reason}");
        assert!(reason.contains("move your own text to the end of the note, below the last highlight"), "{reason}");
        assert!(reason.contains("generated_by: properbooky"), "{reason}");
        assert_eq!((report.books, report.highlights), (1, 1), "refused note not counted");
        assert_eq!(snapshot(&note), before, "refused note written");
        assert!(read(&epub_note).contains(export::BLOCK_START));
    }

    // The user follows the advice: the next sync migrates and keeps the text.
    fs::write(&note, format!("{pdf_legacy}{mine}")).unwrap();
    let report = export::export_highlights(&lib.root, &lib.out).unwrap();
    assert!(report.skipped.is_empty(), "{:?}", report.skipped);
    let text = read(&note);
    assert_eq!(tail_after_block(&text), format!("\n\n{mine}"));
    assert_eq!(text.matches("> Harbor office\n").count(), 1);
}

#[test]
fn every_unprovable_shape_is_refused_and_left_byte_identical() {
    let lib = library();
    let a = add(&lib.pdf, "the tide returns the ledger", Some("thesis"), page(2));
    let b = add(&lib.pdf, "Harbor office", None, page(3));
    let legacy = legacy_note("Tidewater Echo Ledger", Some("Synthetic Harbormaster"), "tide.pdf", &[&a, &b]);
    let entry_a = format!("> the tide returns the ledger\n> — page 2 ^pb-{}\n\n**Note:** thesis\n\n", &a.id[..8]);
    let entry_b = format!("> Harbor office\n> — page 3 ^pb-{}\n\n", &b.id[..8]);
    let cases: Vec<(&str, String, &str)> = vec![
        ("text above the title", legacy.replacen("\n# Tidewater", "\nMy preface.\n# Tidewater", 1), "put those two lines back at the top"),
        ("edited heading", legacy.replacen("## Highlights\n", "## Highlights I liked\n", 1), "put those two lines back at the top"),
        ("CRLF in the generated header", legacy.replacen("## Highlights\n", "## Highlights\r\n", 1), "put those two lines back at the top"),
        ("edited quote", legacy.replacen("> the tide returns", "> the TIDE returns", 1), "you wrote between its highlights (or edited one)"),
        ("CRLF in a generated entry", legacy.replacen("> Harbor office\n", "> Harbor office\r\n", 1), "you wrote between its highlights (or edited one)"),
        ("duplicated entry", format!("{legacy}{entry_b}"), "you wrote between its highlights (or edited one)"),
        ("text before a later entry", legacy.replacen(&entry_b, &format!("**Note:** mine\n\n{entry_b}"), 1), "you wrote between its highlights"),
        ("user text inside an entry", legacy.replacen(&entry_a, &entry_a.replacen("\n\n**Note:**", "\nmine\n\n**Note:**", 1), 1), "you wrote between its highlights"),
    ];
    let note = lib.out.join(PDF_NOTE);
    for (case, content, advice) in cases {
        assert_ne!(content, legacy, "{case}: fixture did not change the note");
        fs::write(&note, &content).unwrap();
        let before = snapshot(&note);
        let report = export::export_highlights(&lib.root, &lib.out).unwrap();
        assert_eq!(report.skipped.len(), 1, "{case}: {:?}", report.skipped);
        assert!(report.skipped[0].contains(advice), "{case}: {}", report.skipped[0]);
        assert_eq!((report.written, report.books), (0, 0), "{case}");
        assert_eq!(snapshot(&note), before, "{case}: refused note written");
    }

    // Opting out: without `generated_by` the file is the user's; a fresh
    // note is written beside it and the original is never touched again.
    let mine = legacy.replacen("\n# Tidewater", "\nMy preface.\n# Tidewater", 1).replacen("generated_by: properbooky\n", "", 1);
    fs::write(&note, &mine).unwrap();
    let report = export::export_highlights(&lib.root, &lib.out).unwrap();
    assert!(report.skipped.is_empty(), "{:?}", report.skipped);
    assert_eq!(read(&note), mine);
    let fresh: Vec<_> = fs::read_dir(&lib.out)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|n| n != PDF_NOTE)
        .collect();
    assert_eq!(fresh.len(), 1, "{fresh:?}");
    let text = read(&lib.out.join(&fresh[0]));
    assert!(text.contains(export::BLOCK_START) && text.contains("> Harbor office\n"));
    assert_eq!(export::export_highlights(&lib.root, &lib.out).unwrap().written, 0);
    assert_eq!(read(&note), mine);
}

#[test]
fn incomplete_block_markers_are_refused_not_treated_as_legacy() {
    let lib = library();
    add(&lib.pdf, "the tide returns the ledger", None, page(2));
    let note = lib.out.join(PDF_NOTE);
    export::export_highlights(&lib.root, &lib.out).unwrap();
    let current = format!("{}\n> MY QUOTE below the block\n**Note:** my note\n", read(&note));
    let end_line = format!("{}\n", export::BLOCK_END);
    let start_line = format!("{}\n", export::BLOCK_START);
    let cases = [
        ("end marker deleted", current.replacen(&end_line, "", 1)),
        ("start marker deleted", current.replacen(&start_line, "", 1)),
        ("markers swapped", current.replacen(&start_line, "@@S@@", 1).replacen(&end_line, &start_line, 1).replacen("@@S@@", &end_line, 1)),
    ];
    for (case, content) in cases {
        assert_ne!(content, current, "{case}");
        fs::write(&note, &content).unwrap();
        let before = snapshot(&note);
        let report = export::export_highlights(&lib.root, &lib.out).unwrap();
        assert_eq!(report.skipped.len(), 1, "{case}: {:?}", report.skipped);
        assert!(report.skipped[0].contains("block markers is missing or out of order"), "{case}: {}", report.skipped[0]);
        assert!(report.skipped[0].contains(export::BLOCK_END), "{case}: names the marker lines");
        assert_eq!(snapshot(&note), before, "{case}: note written");
    }
    // Restored markers: synced again, the user's lines intact.
    fs::write(&note, &current).unwrap();
    let report = export::export_highlights(&lib.root, &lib.out).unwrap();
    assert!(report.skipped.is_empty() && report.written == 0, "{:?}", report.skipped);
    assert!(read(&note).ends_with("\n> MY QUOTE below the block\n**Note:** my note\n"));
}

#[test]
fn a_legacy_note_converted_to_crlf_is_never_written() {
    let lib = library();
    let a = add(&lib.pdf, "the tide returns the ledger", None, page(2));
    let legacy = legacy_note("Tidewater Echo Ledger", Some("Synthetic Harbormaster"), "tide.pdf", &[&a]);
    let crlf = format!("{legacy}My line.\n").replace('\n', "\r\n");
    let note = lib.out.join(PDF_NOTE);
    fs::write(&note, &crlf).unwrap();
    let before = snapshot(&note);
    // Not recognised as Properbooky's (its frontmatter no longer parses as
    // ours): never written; the highlights go to a new note beside it.
    let report = export::export_highlights(&lib.root, &lib.out).unwrap();
    assert!(report.skipped.is_empty(), "{:?}", report.skipped);
    assert_eq!(snapshot(&note), before);
    assert_eq!(fs::read_dir(&lib.out).unwrap().count(), 2);
    export::export_highlights(&lib.root, &lib.out).unwrap();
    assert_eq!(snapshot(&note), before);
}
