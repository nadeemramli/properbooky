// Coordinator's synthetic regression (PBK-26 review repair, task 2,
// 4 October 2026), kept verbatim: a user comment in a managed note's
// frontmatter must survive an update of Properbooky's own metadata.
use desktop_lib::{annotations, export};
use serde_json::json;
use std::fs;

#[test]
fn managed_export_retains_user_frontmatter_comment_on_metadata_update() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    fs::create_dir_all(root.join("Catalog")).unwrap();
    fs::write(root.join("Catalog/Synthetic.md"), "---\ntitle: Synthetic Harbor\nauthor: Test Author\nstatus: reading\nfile: synthetic.pdf\n---\n").unwrap();
    fs::write(root.join("synthetic.pdf"), b"%PDF-1.4 synthetic").unwrap();
    annotations::add_highlight(&root.join(".properbooky/state/synthetic.pdf.json"), "Synthetic quotation".into(), None, None, json!({"type":"pdf","page":1})).unwrap();
    let out=root.join("out");
    export::export_highlights(root,&out).unwrap();
    let note=out.join("Test Author - Synthetic Harbor.md");
    let original=fs::read_to_string(&note).unwrap();
    let with_user_text=original.replacen("title: Synthetic Harbor", "# USER COMMENT MUST SURVIVE\ntitle: Old title", 1);
    assert_ne!(original,with_user_text,"fixture must change owned metadata and add comment");
    fs::write(&note,with_user_text).unwrap();
    let report=export::export_highlights(root,&out).unwrap();
    let actual=fs::read_to_string(&note).unwrap();
    println!("written={}, skipped={:?}, user_comment_present={}",report.written,report.skipped,actual.contains("USER COMMENT MUST SURVIVE"));
    assert!(actual.contains("USER COMMENT MUST SURVIVE"),"export deleted user-authored frontmatter comment");
}
