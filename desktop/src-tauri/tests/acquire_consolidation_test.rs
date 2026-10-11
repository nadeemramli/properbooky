//! Consolidation regressions: disposable synthetic libraries only.
use desktop_lib::{acquire, catalog, db, matcher, scanner};
use std::{fs, path::PathBuf};

const PDF: &[u8] = b"%PDF-1.4\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n";
const MD: &str = "---\ntitle: Safe Arrival Fixture\nauthor: Synthetic Repair\nstatus: queued\n---\n\nOriginal synthetic note.\n";

struct Fixture {
    _temp: tempfile::TempDir,
    root: PathBuf,
    outside: PathBuf,
    conn: rusqlite::Connection,
}
impl Fixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("library");
        let outside = temp.path().join("outside");
        for p in [
            root.join("Drop"),
            root.join("Catalog"),
            root.join("Library/00 Inbox"),
            outside.clone(),
        ] {
            fs::create_dir_all(p).unwrap();
        }
        let conn = db::open(&temp.path().join("index.db")).unwrap();
        Self {
            _temp: temp,
            root,
            outside,
            conn,
        }
    }
    fn profile(&self) -> PathBuf {
        let p = self.root.join("Catalog/Safe.md");
        fs::write(&p, MD).unwrap();
        p
    }
    fn journal(&self, source: &str, target: &str, profile: &str) -> PathBuf {
        let dir = self.root.join(".properbooky/acquisition/drop");
        fs::create_dir_all(&dir).unwrap();
        let bytes = self.outside.join("hash-source.pdf");
        fs::write(&bytes, PDF).unwrap();
        let record = dir.join("interrupted.json");
        fs::write(&record,serde_json::to_vec(&serde_json::json!({"version":1,"source":source,"target":target,"catalog":profile,"hash":matcher::sha256_file(&bytes).unwrap(),"original_filename":"original.pdf"})).unwrap()).unwrap();
        record
    }
    fn process(&self) -> acquire::DropReport {
        scanner::scan_library(&self.conn, &self.root).unwrap();
        let report = acquire::process_drop(&self.conn, &self.root).unwrap();
        scanner::scan_library(&self.conn, &self.root).unwrap();
        report
    }
}

#[cfg(unix)]
#[test]
fn linked_catalog_parent_recovery_never_rewrites_outside() {
    let f = Fixture::new();
    fs::write(f.outside.join("Victim.md"), MD).unwrap();
    std::os::unix::fs::symlink(&f.outside, f.root.join("Catalog/linked")).unwrap();
    fs::write(f.root.join("Drop/original.pdf"), PDF).unwrap();
    fs::write(f.root.join("Library/00 Inbox/filed.pdf"), PDF).unwrap();
    let record = f.journal(
        "Drop/original.pdf",
        "Library/00 Inbox/filed.pdf",
        "Catalog/linked/Victim.md",
    );
    let report = f.process();
    assert_eq!(fs::read_to_string(f.outside.join("Victim.md")).unwrap(), MD);
    assert!(f.root.join("Drop/original.pdf").exists());
    assert!(record.exists());
    assert_eq!(report.filed, 0);
}

#[cfg(unix)]
#[test]
fn linked_source_parent_recovery_never_deletes_outside() {
    let f = Fixture::new();
    let md = f.profile();
    fs::write(f.outside.join("original.pdf"), PDF).unwrap();
    std::os::unix::fs::symlink(&f.outside, f.root.join("Drop/linked")).unwrap();
    fs::write(f.root.join("Library/00 Inbox/filed.pdf"), PDF).unwrap();
    let record = f.journal(
        "Drop/linked/original.pdf",
        "Library/00 Inbox/filed.pdf",
        "Catalog/Safe.md",
    );
    let report = f.process();
    assert_eq!(fs::read(f.outside.join("original.pdf")).unwrap(), PDF);
    assert_eq!(fs::read_to_string(md).unwrap(), MD);
    assert!(record.exists());
    assert_eq!(report.filed, 0);
}

#[cfg(unix)]
#[test]
fn linked_target_parent_recovery_never_links_outside() {
    let f = Fixture::new();
    let md = f.profile();
    fs::write(f.outside.join("filed.pdf"), PDF).unwrap();
    std::os::unix::fs::symlink(&f.outside, f.root.join("Library/00 Inbox/linked")).unwrap();
    let record = f.journal(
        "Drop/original.pdf",
        "Library/00 Inbox/linked/filed.pdf",
        "Catalog/Safe.md",
    );
    let report = f.process();
    assert_eq!(fs::read_to_string(md).unwrap(), MD);
    assert!(record.exists());
    assert_eq!(report.filed, 0);
    assert_eq!(fs::read(f.outside.join("filed.pdf")).unwrap(), PDF);
}

#[cfg(unix)]
#[test]
fn linked_catalog_leaf_recovery_is_refused() {
    let f = Fixture::new();
    fs::write(f.outside.join("Victim.md"), MD).unwrap();
    std::os::unix::fs::symlink(f.outside.join("Victim.md"), f.root.join("Catalog/Safe.md"))
        .unwrap();
    fs::write(f.root.join("Library/00 Inbox/filed.pdf"), PDF).unwrap();
    let record = f.journal(
        "Drop/original.pdf",
        "Library/00 Inbox/filed.pdf",
        "Catalog/Safe.md",
    );
    assert_eq!(f.process().filed, 0);
    assert!(record.exists());
    assert!(fs::symlink_metadata(f.root.join("Catalog/Safe.md"))
        .unwrap()
        .file_type()
        .is_symlink());
}

fn dropped(f: &Fixture, bytes: &[u8], ext: &str) -> PathBuf {
    f.profile();
    let p = f.root.join(format!(
        "Drop/Synthetic Repair - Safe Arrival Fixture.{ext}"
    ));
    fs::write(&p, bytes).unwrap();
    p
}
#[test]
fn truncated_incremental_pdf_stays_unlinked_in_drop() {
    let f = Fixture::new();
    let mut bytes = PDF.to_vec();
    bytes.extend_from_slice(&[b'x'; 600]);
    let p = dropped(&f, &bytes, "pdf");
    let report = f.process();
    assert_eq!(report.filed, 0);
    assert_eq!(fs::read(p).unwrap(), bytes);
    assert!(report
        .outcomes
        .iter()
        .any(|o| o.result == "left-incomplete"));
}
fn zip(payload: &[u8], comment: &[u8]) -> Vec<u8> {
    let mut bytes = b"PK\x03\x04".to_vec();
    bytes.extend_from_slice(payload);
    let position = bytes.len() as u32;
    bytes.extend_from_slice(b"PK\x05\x06");
    bytes.extend_from_slice(&[0; 12]);
    bytes.extend_from_slice(&position.to_le_bytes());
    bytes.extend_from_slice(&(comment.len() as u16).to_le_bytes());
    bytes.extend_from_slice(comment);
    bytes
}
#[test]
fn inner_zip_end_marker_does_not_complete_a_truncated_epub() {
    let f = Fixture::new();
    let mut bytes = b"PK\x03\x04outer-local-entry".to_vec();
    bytes.extend_from_slice(&zip(b"inner", b""));
    let p = dropped(&f, &bytes, "epub");
    let report = f.process();
    assert_eq!(report.filed, 0);
    assert_eq!(fs::read(p).unwrap(), bytes);
    assert!(report
        .outcomes
        .iter()
        .any(|o| o.result == "left-incomplete"));
}
#[test]
fn healthy_pdf_with_preamble_and_epub_with_comment_are_filed() {
    for (ext, bytes) in [
        ("pdf", [b"fixture preamble\n".as_slice(), PDF].concat()),
        ("epub", zip(b"payload", b"synthetic comment")),
    ] {
        let f = Fixture::new();
        let p = dropped(&f, &bytes, ext);
        let report = f.process();
        assert_eq!(report.filed, 1, "{ext}");
        assert!(!p.exists());
        let e = catalog::parse(&fs::read_to_string(f.root.join("Catalog/Safe.md")).unwrap())
            .unwrap()
            .0;
        assert_eq!(fs::read(f.root.join(e.file.unwrap())).unwrap(), bytes);
    }
}
#[test]
fn nested_real_catalog_recovery_still_converges() {
    let f = Fixture::new();
    fs::create_dir(f.root.join("Catalog/nested")).unwrap();
    fs::write(f.root.join("Catalog/nested/Safe.md"), MD).unwrap();
    fs::write(f.root.join("Library/00 Inbox/filed.pdf"), PDF).unwrap();
    let record = f.journal(
        "Drop/original.pdf",
        "Library/00 Inbox/filed.pdf",
        "Catalog/nested/Safe.md",
    );
    assert_eq!(f.process().filed, 1);
    assert!(!record.exists());
}
#[cfg(unix)]
#[test]
fn one_colon_path_does_not_abort_healthy_siblings_at_command_boundary() {
    let f = Fixture::new();
    fs::create_dir(f.root.join("Library/Notes")).unwrap();
    fs::write(
        f.root.join("Library/Notes/Meeting: synthetic.md"),
        b"synthetic note",
    )
    .unwrap();
    dropped(&f, PDF, "pdf");
    assert_eq!(f.process().filed, 1);
}
#[cfg(unix)]
#[test]
fn one_unreadable_file_does_not_abort_healthy_siblings_at_command_boundary() {
    use std::os::unix::fs::PermissionsExt;
    let f = Fixture::new();
    let p = f.root.join("Drop/unreadable.pdf");
    fs::write(&p, PDF).unwrap();
    fs::set_permissions(&p, fs::Permissions::from_mode(0o000)).unwrap();
    if fs::File::open(&p).is_ok() {
        fs::set_permissions(&p, fs::Permissions::from_mode(0o600)).unwrap();
        return;
    }
    dropped(&f, PDF, "pdf");
    let report = f.process();
    fs::set_permissions(&p, fs::Permissions::from_mode(0o600)).unwrap();
    assert_eq!(report.filed, 1);
}

#[cfg(unix)]
#[test]
fn observed_folder_swaps_never_write_delete_or_link_outside() {
    use acquire::Step;
    for (folder, step) in [
        ("Drop", Step::IntentWritten),
        ("Library/00 Inbox", Step::IntentWritten),
        ("Drop", Step::Linked),
        ("Catalog", Step::Published),
    ] {
        let f = Fixture::new();
        let initial = dropped(&f, PDF, "pdf");
        let source = f
            .root
            .join("Drop/Synthetic Repair - Safe Arrival Fixture (Z-Library).pdf");
        fs::rename(initial, &source).unwrap();
        let original = source.file_name().unwrap();
        fs::write(f.outside.join(original), PDF).unwrap();
        fs::write(f.outside.join("Safe.md"), MD).unwrap();
        scanner::scan_library(&f.conn, &f.root).unwrap();
        let report = acquire::process_drop_observed(&f.conn, &f.root, &|at, _| {
            if at == step {
                let path = f.root.join(folder);
                fs::rename(&path, f.root.join("saved-folder"))?;
                std::os::unix::fs::symlink(&f.outside, &path)?;
            }
            Ok(())
        })
        .unwrap();
        assert_eq!(report.filed, 0, "{folder} at {step:?}");
        assert_eq!(fs::read(f.outside.join(original)).unwrap(), PDF);
        assert_eq!(fs::read_to_string(f.outside.join("Safe.md")).unwrap(), MD);
        assert!(!f
            .outside
            .join("Synthetic Repair - Safe Arrival Fixture.pdf")
            .exists());
        let e = catalog::parse(
            &fs::read_to_string(if folder == "Catalog" {
                f.root.join("saved-folder/Safe.md")
            } else {
                f.root.join("Catalog/Safe.md")
            })
            .unwrap(),
        )
        .unwrap()
        .0;
        assert!(e.file.is_none());
    }
}

#[test]
fn unknown_intent_version_is_retained_without_recovery_mutation() {
    let f = Fixture::new();
    let md = f.profile();
    fs::write(f.root.join("Library/00 Inbox/filed.pdf"), PDF).unwrap();
    let record = f.journal(
        "Drop/original.pdf",
        "Library/00 Inbox/filed.pdf",
        "Catalog/Safe.md",
    );
    let mut value: serde_json::Value = serde_json::from_slice(&fs::read(&record).unwrap()).unwrap();
    value["version"] = 2.into();
    fs::write(&record, serde_json::to_vec(&value).unwrap()).unwrap();
    let report = f.process();
    assert_eq!(report.filed, 0);
    assert!(record.exists());
    assert_eq!(fs::read_to_string(md).unwrap(), MD);
    assert!(report.outcomes.iter().any(|o| o.result == "recovery-error"));
}

#[cfg(unix)]
#[test]
fn an_unregistrable_duplicate_does_not_steal_a_moved_assets_annotations() {
    use desktop_lib::{annotations, identity};
    let f = Fixture::new();
    let old = f.root.join("Library/old.pdf");
    fs::write(&old, PDF).unwrap();
    scanner::scan_library(&f.conn, &f.root).unwrap();
    let registry = identity::Registry::load(&f.root).unwrap();
    let id = registry.at_path("Library/old.pdf").unwrap().id.clone();
    let state = registry.state_path(&f.root, &old).unwrap();
    annotations::set_position(&state, "7".into(), Some(0.5)).unwrap();
    fs::rename(&old, f.root.join("Library/new.pdf")).unwrap();
    fs::write(f.root.join("Library/Unregistrable: copy.pdf"), PDF).unwrap();
    let result = scanner::scan_library(&f.conn, &f.root).unwrap();
    assert!(result.skipped >= 1);
    let registry = identity::Registry::load(&f.root).unwrap();
    assert_ne!(registry.at_path("Library/new.pdf").unwrap().id, id);
    assert_eq!(annotations::load(&state).position.as_deref(), Some("7"));
}
