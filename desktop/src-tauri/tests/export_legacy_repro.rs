// Coordinator's synthetic regression (PBK-26 review repair, 4 October 2026),
// kept verbatim: a pre-marker note with user commentary, a user-authored
// blockquote and a user-authored **Note:** line.
use desktop_lib::{annotations, export};
use serde_json::json;
use std::fs;

#[test]
fn legacy_export_preserves_user_authored_quote_and_note() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    fs::create_dir_all(root.join("Catalog")).unwrap();
    fs::write(root.join("Catalog/Synthetic.md"), "---\ntitle: Synthetic Harbor\nauthor: Test Author\nstatus: reading\nfile: synthetic.pdf\n---\n").unwrap();
    fs::write(root.join("synthetic.pdf"), b"%PDF-1.4 synthetic").unwrap();
    let sidecar = root.join(".properbooky/state/synthetic.pdf.json");
    let highlight = annotations::add_highlight(&sidecar, "Generated quotation".into(), None, None, json!({"type":"pdf","page":1})).unwrap();
    let out = root.join("out");
    fs::create_dir_all(&out).unwrap();
    let note = out.join("Test Author - Synthetic Harbor.md");
    let legacy = format!("---\ntitle: Synthetic Harbor\nauthor: Test Author\nsource: synthetic.pdf\ngenerated_by: properbooky\n---\n\n# Synthetic Harbor\n\n## Highlights\n\n> Generated quotation\n> — page 1 ^pb-{}\n\nMy own commentary:\n> USER WRITTEN QUOTATION MUST SURVIVE\n**Note:** USER WRITTEN NOTE MUST SURVIVE\n", &highlight.id[..8]);
    fs::write(&note, &legacy).unwrap();
    let report = export::export_highlights(root, &out).unwrap();
    let actual = fs::read_to_string(&note).unwrap();
    println!("written={}, skipped={:?}; user_quote_present={}, user_note_present={}", report.written, report.skipped, actual.contains("USER WRITTEN QUOTATION MUST SURVIVE"), actual.contains("USER WRITTEN NOTE MUST SURVIVE"));
    assert!(actual.contains("USER WRITTEN QUOTATION MUST SURVIVE"), "export deleted a user-authored blockquote from a legacy note");
    assert!(actual.contains("USER WRITTEN NOTE MUST SURVIVE"), "export deleted a user-authored note from a legacy note");
}
