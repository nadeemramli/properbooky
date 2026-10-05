//! PBK-15: known-library list, recovery and the single-library import, on
//! temporary app-data and library folders only.
use desktop_lib::{db, libraries};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

fn temp(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("pbk15-{name}-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn library(parent: &Path, name: &str) -> String {
    let dir = parent.join(name);
    fs::create_dir_all(dir.join(".properbooky/state")).unwrap();
    fs::write(dir.join("book.epub"), name.as_bytes()).unwrap();
    fs::write(
        dir.join(".properbooky/state/asset-x.json"),
        b"{\"position\":\"3\"}",
    )
    .unwrap();
    dir.to_string_lossy().into_owned()
}

/// Every file under `dir` with its content hash, for "nothing changed" checks.
fn tree(dir: &Path) -> Vec<(String, String)> {
    let mut out: Vec<_> = walkdir::WalkDir::new(dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .map(|e| {
            let rel = e
                .path()
                .strip_prefix(dir)
                .unwrap()
                .to_string_lossy()
                .into_owned();
            (
                rel,
                format!("{:x}", Sha256::digest(fs::read(e.path()).unwrap())),
            )
        })
        .collect();
    out.sort();
    out
}

#[test]
fn fresh_app_data_has_no_library_and_writes_nothing() {
    let data = temp("fresh");
    let loaded = libraries::load(&data).unwrap();
    assert!(loaded.settings.libraries.is_empty());
    assert!(loaded.settings.active.is_none());
    assert!(loaded.notices.is_empty());
    assert!(!data.join(libraries::SETTINGS_FILE).exists());
}

#[test]
fn same_folder_in_any_spelling_is_listed_once() {
    let parent = temp("dedupe");
    let a = library(&parent, "Alpha");
    let b = library(&parent, "Beta");
    let mut s = libraries::Settings::default();
    let (id_a, created) = s.add(&a).unwrap();
    assert!(created);
    let (id_b, _) = s.add(&b).unwrap();
    assert_ne!(id_a, id_b);
    assert_eq!(s.add(&format!("{a}/")).unwrap(), (id_a.clone(), false));
    assert_eq!(s.add(&format!("  {a}  ")).unwrap(), (id_a.clone(), false));
    assert_eq!(
        s.add(&format!("{a}/../Alpha")).unwrap(),
        (id_a.clone(), false)
    );
    #[cfg(unix)]
    {
        let link = parent.join("alpha-link");
        std::os::unix::fs::symlink(&a, &link).unwrap();
        assert_eq!(
            s.add(&link.to_string_lossy()).unwrap(),
            (id_a.clone(), false)
        );
    }
    assert_eq!(s.listed().count(), 2);
    assert_eq!(s.get(&id_a).unwrap().name, "Alpha");
    // Adding never switches.
    assert!(s.active.is_none());
}

#[test]
fn unusable_folders_are_refused_with_a_reason() {
    let parent = temp("refuse");
    let mut s = libraries::Settings::default();
    assert!(s
        .add("relative/folder")
        .unwrap_err()
        .to_string()
        .contains("full path"));
    let missing = parent.join("gone");
    let err = s.add(&missing.to_string_lossy()).unwrap_err().to_string();
    assert!(err.contains("was not found"), "{err}");
    let file = parent.join("file.txt");
    fs::write(&file, b"x").unwrap();
    assert!(s
        .add(&file.to_string_lossy())
        .unwrap_err()
        .to_string()
        .contains("not a folder"));
    assert!(s.listed().next().is_none());
}

#[test]
fn a_library_state_folder_is_never_a_library() {
    let parent = temp("state-folder");
    let a = library(&parent, "Alpha");
    let mut s = libraries::Settings::default();
    for candidate in [
        format!("{a}/.properbooky"),
        format!("{a}/.properbooky/state"),
    ] {
        let err = s.add(&candidate).unwrap_err().to_string();
        assert!(err.contains("own data folder"), "{err}");
    }
    let (id, _) = s.add(&a).unwrap();
    assert!(s.relocate(&id, &format!("{a}/.properbooky")).is_err());
    assert_eq!(s.listed().count(), 1);
}

#[test]
fn nested_libraries_are_refused() {
    let parent = temp("nested");
    let outer = library(&parent, "Outer");
    let inner = library(Path::new(&outer), "Inner");
    let mut s = libraries::Settings::default();
    s.add(&outer).unwrap();
    let err = s.add(&inner).unwrap_err().to_string();
    assert!(err.contains("inside the library “Outer”"), "{err}");

    let mut s = libraries::Settings::default();
    s.add(&inner).unwrap();
    let err = s.add(&outer).unwrap_err().to_string();
    assert!(err.contains("contains the library “Inner”"), "{err}");
}

#[test]
fn list_round_trips_and_keeps_a_backup() {
    let parent = temp("roundtrip");
    let data = temp("roundtrip-data");
    let a = library(&parent, "Alpha");
    let b = library(&parent, "Beta");
    let mut s = libraries::Settings::default();
    let (id_a, _) = s.add(&a).unwrap();
    s.add(&b).unwrap();
    s.activate(&id_a).unwrap();
    libraries::save(&data, &s).unwrap();
    assert!(!data.join(libraries::SETTINGS_BACKUP).exists());
    s.rename(&id_a, "Main shelf").unwrap();
    libraries::save(&data, &s).unwrap();
    let backup: libraries::Settings =
        serde_json::from_slice(&fs::read(data.join(libraries::SETTINGS_BACKUP)).unwrap()).unwrap();
    assert_eq!(backup.get(&id_a).unwrap().name, "Alpha");
    let loaded = libraries::load(&data).unwrap();
    assert_eq!(loaded.settings, s);
    assert!(loaded.notices.is_empty());
}

#[test]
fn rename_validates_names() {
    let parent = temp("rename");
    let mut s = libraries::Settings::default();
    let (id, _) = s.add(&library(&parent, "Alpha")).unwrap();
    assert!(s.rename(&id, "   ").is_err());
    assert!(s.rename(&id, &"x".repeat(121)).is_err());
    assert!(s.rename(&id, "line\nbreak").is_err());
    assert_eq!(s.get(&id).unwrap().name, "Alpha");
    s.rename(&id, "  Archive shelf ").unwrap();
    assert_eq!(s.get(&id).unwrap().name, "Archive shelf");
    assert!(s.rename(&uuid::Uuid::new_v4().to_string(), "x").is_err());
}

#[test]
fn removing_forgets_only_and_readding_restores_the_entry() {
    let parent = temp("remove");
    let data = temp("remove-data");
    let a = library(&parent, "Alpha");
    let vault = temp("remove-vault");
    let mut s = libraries::Settings::default();
    let (id, _) = s.add(&a).unwrap();
    s.rename(&id, "Main shelf").unwrap();
    s.set_vault(&id, Some(vault.to_string_lossy().into_owned()))
        .unwrap();
    s.activate(&id).unwrap();
    let index = libraries::index_file(&data, &id).unwrap();
    fs::create_dir_all(index.parent().unwrap()).unwrap();
    fs::write(&index, b"index").unwrap();
    let before = tree(Path::new(&a));

    s.remove(&id).unwrap();
    libraries::save(&data, &s).unwrap();
    assert!(
        s.active.is_none(),
        "removing the open library opens nothing else"
    );
    assert!(s.get(&id).is_none());
    assert_eq!(tree(Path::new(&a)), before, "library folder untouched");
    assert!(index.is_file(), "index kept for a later re-add");

    let mut s = libraries::load(&data).unwrap().settings;
    assert_eq!(s.listed().count(), 0);
    let (again, created) = s.add(&a).unwrap();
    assert_eq!((again.as_str(), created), (id.as_str(), false));
    let entry = s.get(&id).unwrap();
    assert_eq!(entry.name, "Main shelf");
    assert_eq!(
        entry.obsidian_vault_path.as_deref(),
        Some(vault.to_string_lossy().as_ref())
    );
    assert_eq!(tree(Path::new(&a)), before);
}

#[test]
fn relocate_keeps_the_entry_and_refuses_listed_folders() {
    let parent = temp("relocate");
    let a = library(&parent, "Alpha");
    let b = library(&parent, "Beta");
    let mut s = libraries::Settings::default();
    let (id_a, _) = s.add(&a).unwrap();
    s.add(&b).unwrap();
    let moved = parent.join("Alpha moved");
    fs::rename(&a, &moved).unwrap();
    assert_eq!(
        libraries::probe(Path::new(&a)).0,
        libraries::Status::Missing
    );
    assert!(s
        .relocate(&id_a, &b)
        .unwrap_err()
        .to_string()
        .contains("already listed"));
    s.relocate(&id_a, &moved.to_string_lossy()).unwrap();
    let entry = s.get(&id_a).unwrap();
    assert_eq!(entry.path, moved.to_string_lossy());
    assert_eq!(entry.name, "Alpha");
}

#[test]
fn an_export_folder_belongs_to_one_library() {
    let parent = temp("vault");
    let vault = temp("vault-shared");
    let other = temp("vault-other");
    let mut s = libraries::Settings::default();
    let (a, _) = s.add(&library(&parent, "Alpha")).unwrap();
    let (b, _) = s.add(&library(&parent, "Beta")).unwrap();
    s.set_vault(&a, Some(vault.to_string_lossy().into_owned()))
        .unwrap();
    let err = s
        .set_vault(&b, Some(format!("{}/", vault.to_string_lossy())))
        .unwrap_err()
        .to_string();
    assert!(err.contains("library “Alpha”"), "{err}");
    assert!(s.get(&b).unwrap().obsidian_vault_path.is_none());
    s.set_vault(&b, Some(other.to_string_lossy().into_owned()))
        .unwrap();
    assert!(s
        .set_vault(&b, Some(parent.join("nope").to_string_lossy().into_owned()))
        .is_err());
    s.set_vault(&b, None).unwrap();
    assert!(s.get(&b).unwrap().obsidian_vault_path.is_none());
}

#[test]
fn corrupt_list_is_kept_and_the_backup_restored() {
    let parent = temp("corrupt");
    let data = temp("corrupt-data");
    let mut s = libraries::Settings::default();
    let (id, _) = s.add(&library(&parent, "Alpha")).unwrap();
    libraries::save(&data, &s).unwrap();
    s.activate(&id).unwrap();
    libraries::save(&data, &s).unwrap();
    fs::write(data.join(libraries::SETTINGS_FILE), b"{not json").unwrap();

    let loaded = libraries::load(&data).unwrap();
    assert_eq!(loaded.settings.listed().count(), 1);
    assert!(
        loaded.settings.active.is_none(),
        "backup predates the activation"
    );
    assert!(
        loaded.notices[0].contains("previous saved list was restored"),
        "{:?}",
        loaded.notices
    );
    let kept: Vec<_> = fs::read_dir(&data)
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_name()
                .to_string_lossy()
                .starts_with("settings.json.unreadable-")
        })
        .collect();
    assert_eq!(kept.len(), 1);
    assert_eq!(fs::read(kept[0].path()).unwrap(), b"{not json");
    // The restored list was written back.
    assert_eq!(libraries::load(&data).unwrap().settings.listed().count(), 1);
}

#[test]
fn corrupt_list_without_backup_starts_empty_and_says_so() {
    let data = temp("corrupt-nobackup");
    fs::write(data.join(libraries::SETTINGS_FILE), b"\x00\x01garbage").unwrap();
    let loaded = libraries::load(&data).unwrap();
    assert!(loaded.settings.libraries.is_empty());
    assert!(loaded.notices[0].contains("Open your library folders again"));
    assert!(
        !data.join(libraries::SETTINGS_FILE).exists(),
        "nothing written over it"
    );
}

#[test]
fn invalid_entries_make_the_list_unreadable() {
    let data = temp("invalid");
    let id = uuid::Uuid::new_v4().to_string();
    let doubled = format!(
        r#"{{"version":1,"libraries":[{e},{e}]}}"#,
        e = format!(r#"{{"id":"{id}","name":"x","path":"/x","canonical":"/x","added_at":0}}"#)
    );
    fs::write(data.join(libraries::SETTINGS_FILE), doubled).unwrap();
    assert!(libraries::load(&data).unwrap().notices[0].contains("could not be read"));
    let data = temp("invalid-id");
    fs::write(
        data.join(libraries::SETTINGS_FILE),
        r#"{"version":1,"libraries":[{"id":"../../etc","name":"x","path":"/x","canonical":"/x","added_at":0}]}"#,
    )
    .unwrap();
    assert!(libraries::load(&data)
        .unwrap()
        .settings
        .libraries
        .is_empty());
    assert!(libraries::index_file(&data, "../../etc").is_err());
}

#[test]
fn active_entry_that_was_removed_is_not_reopened() {
    let data = temp("dangling");
    let id = uuid::Uuid::new_v4().to_string();
    fs::write(
        data.join(libraries::SETTINGS_FILE),
        format!(
            r#"{{"version":1,"active":"{id}","libraries":[{{"id":"{id}","name":"x","path":"/x","canonical":"/x","added_at":0,"removed_at":5}}]}}"#
        ),
    )
    .unwrap();
    let loaded = libraries::load(&data).unwrap();
    assert!(loaded.settings.active.is_none());
    assert!(loaded.notices[0].contains("no longer in your list"));
}

fn legacy(data: &Path, library: Option<&str>, vault: Option<&str>) -> String {
    let conn = db::open(&data.join(libraries::LEGACY_DB)).unwrap();
    if let Some(library) = library {
        db::set_setting(&conn, "library_path", library).unwrap();
    }
    if let Some(vault) = vault {
        db::set_setting(&conn, "obsidian_vault_path", vault).unwrap();
    }
    drop(conn);
    format!(
        "{:x}",
        Sha256::digest(fs::read(data.join(libraries::LEGACY_DB)).unwrap())
    )
}

#[test]
fn single_library_install_is_imported_without_touching_its_database() {
    let parent = temp("legacy");
    let data = temp("legacy-data");
    let a = library(&parent, "Owner Books");
    let hash = legacy(&data, Some(&a), Some("/vault"));
    let files_before = tree(Path::new(&a));

    let loaded = libraries::load(&data).unwrap();
    assert!(loaded.notices.is_empty(), "{:?}", loaded.notices);
    let s = loaded.settings;
    let entry = s.listed().next().unwrap();
    assert_eq!(s.active.as_deref(), Some(entry.id.as_str()));
    assert_eq!(entry.path, a);
    assert_eq!(entry.name, "Owner Books");
    assert_eq!(entry.obsidian_vault_path.as_deref(), Some("/vault"));
    assert_eq!(entry.migrated_from.as_deref(), Some("library.db"));
    assert!(data.join(libraries::SETTINGS_FILE).is_file());
    let after = format!(
        "{:x}",
        Sha256::digest(fs::read(data.join(libraries::LEGACY_DB)).unwrap())
    );
    assert_eq!(
        after, hash,
        "legacy database is left byte-for-byte unchanged (rollback)"
    );
    for side in ["library.db-wal", "library.db-shm"] {
        assert!(
            !data.join(side).exists(),
            "{side} created beside the legacy database"
        );
    }
    assert_eq!(tree(Path::new(&a)), files_before);

    // Imported once: the next start reads the saved list, same id.
    let again = libraries::load(&data).unwrap().settings;
    assert_eq!(again, s);
}

#[test]
fn legacy_settings_still_in_the_wal_are_imported_and_the_wal_kept() {
    let parent = temp("legacy-wal");
    let data = temp("legacy-wal-data");
    let a = library(&parent, "Crashed");
    // A previous build that crashed leaves its last writes in the WAL.
    let conn = db::open(&data.join(libraries::LEGACY_DB)).unwrap();
    conn.pragma_update(None, "wal_autocheckpoint", 0).unwrap();
    db::set_setting(&conn, "library_path", &a).unwrap();
    assert!(fs::metadata(data.join("library.db-wal")).unwrap().len() > 0);
    // Snapshot main file + WAL as a crash would leave them (no -shm).
    let crashed = temp("legacy-wal-crashed");
    for name in ["library.db", "library.db-wal"] {
        fs::copy(data.join(name), crashed.join(name)).unwrap();
    }
    drop(conn);
    let hash = |name: &str| {
        format!(
            "{:x}",
            Sha256::digest(fs::read(crashed.join(name)).unwrap())
        )
    };
    let (main, wal) = (hash("library.db"), hash("library.db-wal"));

    let s = libraries::load(&crashed).unwrap().settings;
    assert_eq!(
        s.listed().next().unwrap().path,
        a,
        "setting only in the WAL was read"
    );
    assert_eq!(hash("library.db"), main);
    assert_eq!(hash("library.db-wal"), wal);
    assert!(!crashed.join("library.db-shm").exists());
}

#[test]
fn legacy_install_whose_folder_is_gone_is_still_listed_not_replaced() {
    let data = temp("legacy-missing");
    legacy(&data, Some("/definitely/not/here/pbk15"), None);
    let s = libraries::load(&data).unwrap().settings;
    let entry = s.listed().next().unwrap();
    assert_eq!(entry.path, "/definitely/not/here/pbk15");
    assert_eq!(
        libraries::probe(Path::new(&entry.path)).0,
        libraries::Status::Missing
    );
}

#[test]
fn legacy_without_a_library_or_unreadable_is_left_alone() {
    let data = temp("legacy-empty");
    legacy(&data, None, None);
    let loaded = libraries::load(&data).unwrap();
    assert!(loaded.settings.libraries.is_empty());
    assert!(loaded.notices.is_empty());

    let data = temp("legacy-corrupt");
    fs::write(
        data.join(libraries::LEGACY_DB),
        b"this is not sqlite at all, just bytes",
    )
    .unwrap();
    let before = fs::read(data.join(libraries::LEGACY_DB)).unwrap();
    let loaded = libraries::load(&data).unwrap();
    assert!(loaded.settings.libraries.is_empty());
    assert!(
        loaded.notices[0].contains("could not be read"),
        "{:?}",
        loaded.notices
    );
    assert_eq!(fs::read(data.join(libraries::LEGACY_DB)).unwrap(), before);
}

#[cfg(unix)]
#[test]
fn unwritable_settings_fail_and_change_nothing() {
    use std::os::unix::fs::PermissionsExt;
    let parent = temp("readonly");
    let data = temp("readonly-data");
    let mut s = libraries::Settings::default();
    s.add(&library(&parent, "Alpha")).unwrap();
    libraries::save(&data, &s).unwrap();
    let before = fs::read(data.join(libraries::SETTINGS_FILE)).unwrap();
    fs::set_permissions(&data, fs::Permissions::from_mode(0o555)).unwrap();
    let probe = data.join("probe");
    let enforced = fs::write(&probe, b"x").is_err();
    let _ = fs::remove_file(&probe);
    if enforced {
        let mut next = s.clone();
        next.add(&library(&parent, "Beta")).unwrap();
        assert!(libraries::save(&data, &next).is_err());
        assert_eq!(
            fs::read(data.join(libraries::SETTINGS_FILE)).unwrap(),
            before
        );
    } else {
        eprintln!(
            "running with permission override (root); unwritable case covered by packaged E2E"
        );
    }
    fs::set_permissions(&data, fs::Permissions::from_mode(0o755)).unwrap();
}
