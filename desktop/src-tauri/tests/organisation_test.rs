use desktop_lib::{
    db, enrich, identity, library,
    organisation::{self, Organisation, Roadmap, Step},
    scanner,
};
use std::{collections::BTreeMap, fs};

#[test]
#[ignore = "opt-in network smoke test; normal tests use deterministic cached data"]
fn live_open_library_smoke() {
    let dir = tempfile::tempdir().unwrap();
    let result = enrich::search(
        dir.path(),
        "Thinking Fast and Slow",
        "Daniel Kahneman",
        true,
    )
    .unwrap();
    assert!(!result.stale);
    let candidate = result
        .docs
        .into_iter()
        .find(|d| d.author_name.iter().any(|a| a.contains("Kahneman")) && d.cover_i.is_some())
        .expect("matching book with cover");
    let accepted = enrich::accepted(dir.path(), candidate, true).unwrap();
    assert!(dir.path().join(accepted.cover.unwrap()).is_file());
    println!(
        "Live metadata and JPEG cover downloaded into a disposable fixture: {}",
        accepted.source_url
    );
}

fn fixture() -> (tempfile::TempDir, rusqlite::Connection) {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join("Catalog")).unwrap();
    for title in ["First", "Second"] {
        fs::write(dir.path().join(format!("Catalog/{title}.md")), format!("---\ntitle: {title}\nauthor: Taleb, Nassim\ntopics: [selfhelp, Psychology]\nstatus: wishlist\nyear: 2017\n---\nKeep my notes.\n")).unwrap();
    }
    let conn = db::open(&dir.path().join("index.db")).unwrap();
    scanner::scan_library(&conn, dir.path()).unwrap();
    (dir, conn)
}

#[test]
fn older_curation_history_can_be_undone_then_upgraded_without_losing_profiles() {
    for version in [1, 2] {
        let (dir, conn) = fixture();
        let root = dir.path();
        let first = library::list(&conn, root, None).unwrap().remove(0);
        let before = library::Edit::from(&first);
        let mut after = before.clone();
        after.title = "Old correction".into();
        identity::atomic_write(&root.join(".properbooky/curation.json"), &serde_json::to_vec(&serde_json::json!({
            "version": version, "edits": {first.details.stable_id.clone(): after}, "aliases": {},
            "history": [{"id": first.details.stable_id, "before": before}], "merges": {}
        })).unwrap()).unwrap();
        assert_eq!(
            library::list(&conn, root, Some("Old correction"))
                .unwrap()
                .len(),
            1
        );
        library::undo(&conn, root).unwrap();
        assert_eq!(library::list(&conn, root, Some("First")).unwrap().len(), 1);
        let saved: serde_json::Value =
            serde_json::from_slice(&fs::read(root.join(".properbooky/curation.json")).unwrap())
                .unwrap();
        assert_eq!(saved["version"], 3);
        assert!(saved["organisation"]["roadmaps"]
            .as_array()
            .unwrap()
            .is_empty());
    }
}

#[test]
fn label_aliases_survive_rebuild_apply_to_new_imports_and_undo_without_losing_original_labels() {
    let (dir, conn) = fixture();
    let root = dir.path();
    let original = fs::read(root.join("Catalog/First.md")).unwrap();
    let mut org = Organisation::default();
    org.authors
        .insert("taleb, nassim".into(), "Nassim Nicholas Taleb".into());
    org.topics.insert("selfhelp".into(), "Self-help".into());
    library::save_organisation(root, 0, org.clone()).unwrap();
    assert!(library::save_organisation(root, 0, org).is_err()); // stale preview
    let first = library::list(&conn, root, Some("Nassim Nicholas Taleb"))
        .unwrap()
        .remove(0);
    assert_eq!(first.author.as_deref(), Some("Nassim Nicholas Taleb"));
    assert_eq!(first.category.as_deref(), Some("Self-help, Psychology"));
    assert_eq!(first.details.browse_authors, vec!["Nassim Nicholas Taleb"]);
    assert_eq!(
        library::list(&conn, root, Some("Taleb, Nassim"))
            .unwrap()
            .len(),
        2
    );
    let mut edit = library::Edit::from(&first);
    edit.reading_status = "reading".into();
    library::update(&conn, root, &first.details.stable_id, edit).unwrap();
    library::undo(&conn, root).unwrap(); // state edit must not bake canonical names into the source
    fs::write(
        root.join("Catalog/Third.md"),
        "---\ntitle: Third\nauthor: Taleb, Nassim\n---\n",
    )
    .unwrap();
    let rebuilt = db::open(&root.join("rebuilt.db")).unwrap();
    scanner::scan_library(&rebuilt, root).unwrap();
    assert_eq!(
        library::list(&rebuilt, root, Some("Nassim Nicholas Taleb"))
            .unwrap()
            .len(),
        3
    );
    library::undo(&rebuilt, root).unwrap();
    assert!(library::list(&rebuilt, root, None)
        .unwrap()
        .iter()
        .all(|b| b.author.as_deref() == Some("Taleb, Nassim")));
    assert_eq!(fs::read(root.join("Catalog/First.md")).unwrap(), original);
}

#[test]
fn roadmaps_retain_original_memberships_and_notes_across_combine_rebuild_and_undo() {
    let (dir, conn) = fixture();
    let root = dir.path();
    let books = library::list(&conn, root, None).unwrap();
    let mut org = Organisation::default();
    org.roadmaps.push(Roadmap {
        id: "psychology".into(),
        title: "Psychology".into(),
        description: "Foundations first".into(),
        steps: books
            .iter()
            .map(|b| Step {
                profile_id: b.details.stable_id.clone(),
                note: format!("Context for {}", b.title),
            })
            .collect(),
    });
    library::save_organisation(root, 0, org).unwrap();
    library::merge(
        &conn,
        root,
        &books[0].details.stable_id,
        &books[1].details.stable_id,
        library::Edit::from(&books[0]),
    )
    .unwrap();
    let rebuilt = db::open(&root.join("rebuilt.db")).unwrap();
    scanner::scan_library(&rebuilt, root).unwrap();
    let merged = library::list(&rebuilt, root, None).unwrap();
    assert_eq!(merged.len(), 1);
    let steps = library::organisation(root)
        .unwrap()
        .value
        .roadmaps
        .remove(0)
        .steps;
    assert_eq!(steps.len(), 2);
    assert!(steps.iter().all(|step| merged[0]
        .details
        .source_profiles
        .iter()
        .any(|s| s.id == step.profile_id)));
    assert_eq!(steps[1].note, "Context for Second");
    library::undo(&rebuilt, root).unwrap();
    assert_eq!(library::list(&rebuilt, root, None).unwrap().len(), 2);
    assert_eq!(
        library::organisation(root).unwrap().value.roadmaps[0]
            .steps
            .len(),
        2
    );
    library::undo(&rebuilt, root).unwrap();
    assert!(library::organisation(root)
        .unwrap()
        .value
        .roadmaps
        .is_empty());
}

#[test]
fn invalid_alias_cycles_and_duplicate_steps_are_rejected_without_writing() {
    let (dir, _) = fixture();
    let mut org = Organisation::default();
    org.authors = BTreeMap::from([("a".into(), "B".into()), ("b".into(), "A".into())]);
    assert!(library::save_organisation(dir.path(), 0, org).is_err());
    assert!(!dir.path().join(".properbooky/curation.json").exists());
    assert_eq!(
        organisation::label(
            "SELF HELP",
            &BTreeMap::from([("self help".into(), "Self Help".into())])
        )
        .unwrap(),
        "Self Help"
    );
    let org = Organisation {
        roadmaps: vec![Roadmap {
            id: "r".into(),
            title: "x".into(),
            description: "".into(),
            steps: vec![Step {
                profile_id: "missing".into(),
                note: "".into(),
            }],
        }],
        ..Default::default()
    };
    assert!(library::save_organisation(dir.path(), 0, org).is_err());
}

#[test]
fn accepted_metadata_keeps_edition_year_and_sources_and_restores_previous_cover_on_undo() {
    let (dir, conn) = fixture();
    let root = dir.path();
    let first = library::list(&conn, root, None).unwrap().remove(0);
    let before = library::Edit::from(&first);
    let mut edit = before.clone();
    edit.title = "Corrected title".into();
    let cover = ".properbooky/covers/fixture.jpg";
    identity::atomic_write(&root.join(cover), b"test cover bytes").unwrap();
    let accepted = enrich::Accepted {
        work_key: "/works/OL1W".into(),
        source_url: "https://openlibrary.org/works/OL1W".into(),
        accepted_at: 1,
        cover: Some(cover.into()),
        suggested_title: "Corrected title".into(),
        suggested_authors: vec![],
        suggested_topics: vec![],
    };
    library::accept_metadata(
        &conn,
        root,
        &first.details.stable_id,
        &before,
        edit.clone(),
        accepted.clone(),
    )
    .unwrap();
    assert!(library::accept_metadata(
        &conn,
        root,
        &first.details.stable_id,
        &before,
        edit,
        accepted
    )
    .is_err()); // stale selection
    let rebuilt = db::open(&root.join("rebuilt.db")).unwrap();
    scanner::scan_library(&rebuilt, root).unwrap();
    let updated = library::list(&rebuilt, root, Some("First"))
        .unwrap()
        .remove(0);
    assert_eq!(updated.title, "Corrected title");
    assert_eq!(updated.year, Some(2017));
    assert_eq!(
        updated.cover,
        Some(root.join(cover).to_string_lossy().into_owned())
    );
    assert!(updated.details.metadata_source.is_some());
    library::undo(&rebuilt, root).unwrap();
    let restored = library::list(&rebuilt, root, Some("First"))
        .unwrap()
        .remove(0);
    assert_eq!(restored.title, "First");
    assert!(restored.cover.is_none());
    assert!(restored.details.metadata_source.is_none());
    assert!(fs::read_to_string(root.join("Catalog/First.md"))
        .unwrap()
        .contains("Keep my notes."));
}

#[test]
fn cache_works_without_network_and_provider_identifiers_cannot_redirect_requests() {
    use sha2::{Digest, Sha256};
    let dir = tempfile::tempdir().unwrap();
    let cached = enrich::Suggestions {
        fetched_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs(),
        stale: false,
        docs: vec![enrich::OlDoc {
            key: "/works/OL1W".into(),
            title: Some("Fixture".into()),
            ..Default::default()
        }],
    };
    let hash = format!("{:x}", Sha256::digest(b"Fixture\nAuthor"));
    identity::atomic_write(
        &dir.path()
            .join(format!(".properbooky/metadata-cache/{hash}.json")),
        &serde_json::to_vec(&cached).unwrap(),
    )
    .unwrap();
    assert_eq!(
        enrich::search(dir.path(), "Fixture", "Author", false)
            .unwrap()
            .docs[0]
            .title
            .as_deref(),
        Some("Fixture")
    );
    assert!(enrich::work_key("https://elsewhere/OL1W").is_err());
    assert!(enrich::work_key("/works/../../file").is_err());
    assert_eq!(enrich::work_key("OL123W").unwrap(), "/works/OL123W");
}
