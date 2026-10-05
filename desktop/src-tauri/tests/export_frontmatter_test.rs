// PBK-26 review repair (task 2): updating Properbooky's own properties
// (title, author, source) in an exported note keeps every byte of what the
// user wrote in its frontmatter, or leaves the note unchanged with a reason.
// All through the public `export::export_highlights`.
use desktop_lib::{annotations, export};
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};

const NOTE: &str = "Synthetic Harbormaster - Tidewater Echo Ledger.md";

struct Library {
    _dir: tempfile::TempDir,
    root: PathBuf,
    out: PathBuf,
    sidecar: PathBuf,
}

fn catalog(root: &Path, title: &str, author: Option<&str>) {
    let author = author.map(|a| format!("author: {a}\n")).unwrap_or_default();
    fs::write(
        root.join("Catalog/Tide.md"),
        format!("---\ntitle: {title}\n{author}status: reading\nfile: tide.pdf\n---\n"),
    )
    .unwrap();
}

/// One catalogued PDF with a highlight, exported once; plus a second book
/// so a refused note can be told apart from a skipped export.
fn library() -> Library {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().to_path_buf();
    fs::create_dir_all(root.join("Catalog")).unwrap();
    catalog(&root, "Tidewater Echo Ledger", Some("Synthetic Harbormaster"));
    fs::write(
        root.join("Catalog/Zephyr.md"),
        "---\ntitle: Zephyr Lantern Field Notes\nauthor: Synthetic Fixture\nstatus: reading\nfile: zephyr.pdf\n---\n",
    )
    .unwrap();
    fs::write(root.join("tide.pdf"), b"%PDF-1.4 tide").unwrap();
    fs::write(root.join("zephyr.pdf"), b"%PDF-1.4 zephyr").unwrap();
    let sidecar = root.join(".properbooky/state/tide.pdf.json");
    annotations::add_highlight(&sidecar, "the tide returns the ledger".into(), None, None, json!({"type": "pdf", "page": 2})).unwrap();
    annotations::add_highlight(&root.join(".properbooky/state/zephyr.pdf.json"), "quiet weather".into(), None, None, json!({"type": "pdf", "page": 1})).unwrap();
    let out = root.join("vault/Properbooky");
    let report = export::export_highlights(&root, &out).unwrap();
    assert_eq!((report.written, report.skipped.len()), (2, 0));
    Library { root, out, sidecar, _dir: dir }
}

fn read(path: &Path) -> String {
    fs::read_to_string(path).unwrap()
}

fn snapshot(path: &Path) -> (Vec<u8>, std::time::SystemTime) {
    (fs::read(path).unwrap(), fs::metadata(path).unwrap().modified().unwrap())
}

/// (frontmatter including its `---` lines, body)
fn split(text: &str) -> (&str, &str) {
    let end = text[4..].find("\n---\n").unwrap() + 4 + 5;
    (&text[..end], &text[end..])
}

/// Everything a user may write in Obsidian properties: comments (own line,
/// inline on their keys, nested), flow and block lists, quoted values, a
/// block scalar containing `title:`, a nested map, blank lines, custom order.
const USER_FRONT: &str = "---\n# My reading properties: keep this comment\ntitle: Tidewater Echo Ledger\nauthor: Synthetic Harbormaster\nsource: tide.pdf\ngenerated_by: properbooky\ntags: [harbor,   ledger]   # inline comment on my key\naliases:\n  - Tide book\n  - \"Ledger: notes\"\n\nrating: 4\nsummary: |\n  First line of my summary\n  title: not a property\nstatus: 'reading'\nnested:\n  key: value   # nested comment\n---\n";

#[test]
fn metadata_updates_touch_only_properbookys_lines() {
    let lib = library();
    let note = lib.out.join(NOTE);
    let (_, body) = split(&read(&note)).to_owned_pair();
    fs::write(&note, format!("{USER_FRONT}{body}")).unwrap();
    assert_eq!(export::export_highlights(&lib.root, &lib.out).unwrap().written, 0, "unchanged values: not rewritten");

    // Title and author corrected in the catalog (one needs quoting).
    catalog(&lib.root, "\"Ledger: A #1 Story\"", Some("Synthetic Harbormistress"));
    let report = export::export_highlights(&lib.root, &lib.out).unwrap();
    assert!(report.skipped.is_empty(), "{:?}", report.skipped);
    assert_eq!(report.written, 1);
    let text = read(&note);
    let expected = USER_FRONT
        .replacen("title: Tidewater Echo Ledger\n", "title: 'Ledger: A #1 Story'\n", 1)
        .replacen("author: Synthetic Harbormaster\n", "author: Synthetic Harbormistress\n", 1);
    assert_eq!(split(&text).0, expected, "only Properbooky's lines changed");
    assert!(split(&text).1.contains("# Ledger: A #1 Story\n"), "block heading updated");

    // Repeated syncs: byte-identical and not rewritten.
    let before = snapshot(&note);
    for _ in 0..2 {
        assert_eq!(export::export_highlights(&lib.root, &lib.out).unwrap().written, 0);
        assert_eq!(snapshot(&note), before);
    }

    // Author removed, then restored: its line goes, then returns after title.
    catalog(&lib.root, "\"Ledger: A #1 Story\"", None);
    export::export_highlights(&lib.root, &lib.out).unwrap();
    let without = expected.replacen("author: Synthetic Harbormistress\n", "", 1);
    assert_eq!(split(&read(&note)).0, without);
    catalog(&lib.root, "\"Ledger: A #1 Story\"", Some("Synthetic Harbormistress"));
    export::export_highlights(&lib.root, &lib.out).unwrap();
    assert_eq!(split(&read(&note)).0, expected);

    // A new highlight updates the block; the properties stay as they are.
    annotations::add_highlight(&lib.sidecar, "Harbor office".into(), None, None, json!({"type": "pdf", "page": 3})).unwrap();
    assert_eq!(export::export_highlights(&lib.root, &lib.out).unwrap().written, 1);
    let text = read(&note);
    assert_eq!(split(&text).0, expected);
    assert!(text.contains("> Harbor office\n"));
}

#[test]
fn unsafe_property_lines_are_refused_and_left_byte_identical() {
    let lib = library();
    let note = lib.out.join(NOTE);
    let exported = read(&note);
    let (front, body) = split(&exported).to_owned_pair();
    let with = |f: &str| format!("{f}{body}");
    let cases: Vec<(&str, String, &str)> = vec![
        ("inline comment on title", with(&front.replacen("title: Tidewater Echo Ledger\n", "title: Tidewater Echo Ledger # my comment\n", 1)), "put `title:` back on one line without a comment"),
        ("folded title", with(&front.replacen("title: Tidewater Echo Ledger\n", "title: >-\n  Tidewater Echo\n  Ledger\n", 1)), "put `title:` back on one line"),
        ("title continued on the next line", with(&front.replacen("title: Tidewater Echo Ledger\n", "title: Tidewater Echo\n  Ledger\n", 1)), "put `title:` back on one line"),
        ("quoted key", with(&front.replacen("title: Tidewater", "\"title\": Tidewater", 1)), "keep a single `title:` line"),
        ("spaced key", with(&front.replacen("title: Tidewater", "title : Tidewater", 1)), "keep a single `title:` line"),
        ("CRLF properties", with(&front.replacen("generated_by: properbooky\n", "generated_by: properbooky\r\ntags: [a]\r\n", 1)), "save them with LF line endings"),
    ];
    // An update is needed: the catalog title changed, and a new highlight.
    catalog(&lib.root, "Tidewater Echo Ledger (Revised)", Some("Synthetic Harbormaster"));
    annotations::add_highlight(&lib.sidecar, "Harbor office".into(), None, None, json!({"type": "pdf", "page": 3})).unwrap();
    for (case, content, fix) in cases {
        assert_ne!(content, exported, "{case}: fixture unchanged");
        fs::write(&note, &content).unwrap();
        let before = snapshot(&note);
        let report = export::export_highlights(&lib.root, &lib.out).unwrap();
        assert_eq!(report.skipped.len(), 1, "{case}: {:?}", report.skipped);
        let reason = &report.skipped[0];
        assert!(reason.starts_with(&format!("{NOTE}: left unchanged: ")), "{case}: {reason}");
        assert!(reason.contains(fix) && reason.contains("generated_by: properbooky"), "{case}: {reason}");
        assert_eq!(snapshot(&note), before, "{case}: refused note written");
        assert_eq!((report.books, report.highlights), (1, 1), "{case}: the other book is still exported");
    }

    // The user moves the comment to its own line: synced, comment kept.
    let fixed = with(&front.replacen("title: Tidewater Echo Ledger\n", "# my comment\ntitle: Tidewater Echo Ledger\n", 1));
    fs::write(&note, &fixed).unwrap();
    let report = export::export_highlights(&lib.root, &lib.out).unwrap();
    assert!(report.skipped.is_empty(), "{:?}", report.skipped);
    let text = read(&note);
    assert!(split(&text).0.contains("# my comment\ntitle: Tidewater Echo Ledger (Revised)\n"));
    assert!(text.contains("> Harbor office\n"));
    assert_eq!(export::export_highlights(&lib.root, &lib.out).unwrap().written, 0);
}

#[test]
fn unusual_property_lines_are_kept_when_no_update_is_needed() {
    let lib = library();
    let note = lib.out.join(NOTE);
    let (front, body) = split(&read(&note)).to_owned_pair();
    // Inline comment on an unchanged Properbooky line: nothing to update.
    let front = front.replacen("title: Tidewater Echo Ledger\n", "title: Tidewater Echo Ledger # my comment\n", 1);
    fs::write(&note, format!("{front}{body}")).unwrap();
    let report = export::export_highlights(&lib.root, &lib.out).unwrap();
    assert_eq!((report.written, report.skipped.len()), (0, 0));
    // Highlights still update; the properties are kept verbatim.
    annotations::add_highlight(&lib.sidecar, "Harbor office".into(), None, None, json!({"type": "pdf", "page": 3})).unwrap();
    let report = export::export_highlights(&lib.root, &lib.out).unwrap();
    assert_eq!((report.written, report.skipped.len()), (1, 0));
    let text = read(&note);
    assert_eq!(split(&text).0, front);
    assert!(text.contains("> Harbor office\n"));
}

#[test]
fn legacy_note_with_user_properties_migrates_with_its_metadata_update() {
    let lib = library();
    let note = lib.out.join(NOTE);
    let h = annotations::live_highlights(&lib.sidecar).remove(0);
    // Before markers, with the user's comment and property, and an old title.
    let legacy = format!(
        "---\n# keep me\ntitle: Old Tidewater\nauthor: Synthetic Harbormaster\nsource: tide.pdf\ngenerated_by: properbooky\ntags: [harbor]\n---\n\n# Old Tidewater\n\n## Highlights\n\n> the tide returns the ledger\n> — page 2 ^pb-{}\n\nMy line.\n",
        &h.id[..8]
    );
    fs::write(&note, &legacy).unwrap();
    let report = export::export_highlights(&lib.root, &lib.out).unwrap();
    assert!(report.skipped.is_empty(), "{:?}", report.skipped);
    let text = read(&note);
    assert_eq!(
        split(&text).0,
        "---\n# keep me\ntitle: Tidewater Echo Ledger\nauthor: Synthetic Harbormaster\nsource: tide.pdf\ngenerated_by: properbooky\ntags: [harbor]\n---\n"
    );
    assert!(text.ends_with(&format!("{}\n\nMy line.\n", export::BLOCK_END)));
    assert_eq!(export::export_highlights(&lib.root, &lib.out).unwrap().written, 0);
}

trait OwnedPair {
    fn to_owned_pair(&self) -> (String, String);
}
impl OwnedPair for (&str, &str) {
    fn to_owned_pair(&self) -> (String, String) {
        (self.0.to_owned(), self.1.to_owned())
    }
}
