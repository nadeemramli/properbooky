pub mod acquire;
pub mod annotations;
pub mod article;
pub mod catalog;
pub mod catalog_import;
pub mod consolidation;
pub mod db;
pub mod enrich;
pub mod export;
pub mod extract;
pub mod identity;
pub mod libraries;
pub mod library;
pub mod matcher;
pub mod organisation;
pub mod scanner;
use libraries::Status;
use library::Book;

use rusqlite::Connection;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};
use tauri::Manager;

/// Mirrored into each library's index for the MCP server (and to notice a
/// relocated library, whose stored absolute paths are stale).
const LIBRARY_PATH_KEY: &str = "library_path";

/// Refusal for a command bound to a library that is no longer the open one,
/// e.g. a late write from a reader that belonged to the previous library.
const NOT_OPEN: &str =
    "This library is not open any more, so nothing was changed. Switch back to it to continue.";

/// Library list and recovery notices for this app session.
struct Session {
    dir: PathBuf,
    settings: libraries::Settings,
    notices: Vec<String>,
    library_notices: HashMap<String, Vec<String>>,
    /// Set while the list cannot be read or set aside; changes are refused
    /// so an unreadable list is never overwritten. Retried on every access.
    error: Option<String>,
}

static SESSION: Mutex<Option<Session>> = Mutex::new(None);
/// One lock per library: another library's long scan never blocks a switch.
static LOCKS: LazyLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn app_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

fn with_session<T>(
    app: &tauri::AppHandle,
    f: impl FnOnce(&mut Session) -> Result<T, String>,
) -> Result<T, String> {
    let mut slot = SESSION.lock().map_err(|e| e.to_string())?;
    if !matches!(&*slot, Some(s) if s.error.is_none()) {
        let dir = app_dir(app)?;
        *slot = Some(match libraries::load(&dir) {
            Ok(loaded) => Session {
                dir,
                settings: loaded.settings,
                notices: loaded.notices,
                library_notices: HashMap::new(),
                error: None,
            },
            Err(e) => Session {
                dir,
                settings: libraries::Settings::default(),
                notices: Vec::new(),
                library_notices: HashMap::new(),
                error: Some(format!("{e:#}")),
            },
        });
    }
    f(slot.as_mut().expect("session loaded"))
}

/// Apply a change to a copy of the list and save it; memory follows disk, so
/// a failed save leaves both unchanged.
fn change<T>(
    app: &tauri::AppHandle,
    f: impl FnOnce(&mut libraries::Settings) -> anyhow::Result<T>,
) -> Result<T, String> {
    with_session(app, |session| {
        if let Some(error) = &session.error {
            return Err(format!(
                "The library list cannot be changed until it can be read: {error}"
            ));
        }
        let mut next = session.settings.clone();
        let value = f(&mut next).map_err(|e| format!("{e:#}"))?;
        libraries::save(&session.dir, &next).map_err(|e| format!("{e:#}"))?;
        session.settings = next;
        Ok(value)
    })
}

fn note(app: &tauri::AppHandle, id: &str, message: String) {
    let _ = with_session(app, |session| {
        session
            .library_notices
            .entry(id.to_owned())
            .or_default()
            .push(message);
        Ok(())
    });
}

/// The open library a command was issued for.
struct Lib {
    id: String,
    name: String,
    root: PathBuf,
    dir: PathBuf,
}

/// Accept `library_id` only while it is the open library and its folder can
/// be read; everything the command touches is resolved from it.
fn bound(app: &tauri::AppHandle, library_id: &str) -> Result<Lib, String> {
    let (entry, dir) = with_session(app, |session| {
        let entry = session
            .settings
            .get(library_id)
            .cloned()
            .ok_or("That library is no longer in your list, so nothing was changed.")?;
        if session.settings.active.as_deref() != Some(library_id) {
            return Err(NOT_OPEN.to_owned());
        }
        Ok((entry, session.dir.clone()))
    })?;
    let (status, detail) = libraries::probe(Path::new(&entry.path));
    if status != Status::Available {
        return Err(libraries::problem(
            &entry.name,
            &entry.path,
            status,
            detail.as_deref(),
        ));
    }
    Ok(Lib {
        id: entry.id,
        name: entry.name,
        root: PathBuf::from(entry.path),
        dir,
    })
}

fn lock_for(id: &str) -> Result<Arc<Mutex<()>>, String> {
    let mut locks = LOCKS.lock().map_err(|e| e.to_string())?;
    Ok(locks.entry(id.to_owned()).or_default().clone())
}

/// Run `f` with the library's lock held and its index open. The binding is
/// checked again after the lock, since a switch may happen while waiting.
fn indexed<T>(
    app: &tauri::AppHandle,
    library_id: &str,
    f: impl FnOnce(&Lib, &Connection) -> Result<T, String>,
) -> Result<T, String> {
    bound(app, library_id)?;
    let lock = lock_for(library_id)?;
    let _guard = lock.lock().map_err(|e| e.to_string())?;
    let lib = bound(app, library_id)?;
    let conn = open_index(app, &lib)?;
    f(&lib, &conn)
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

fn unreadable_db(error: &anyhow::Error) -> bool {
    error.chain().any(|cause| {
        matches!(
            cause.downcast_ref::<rusqlite::Error>(),
            Some(rusqlite::Error::SqliteFailure(failure, _))
                if matches!(
                    failure.code,
                    rusqlite::ErrorCode::NotADatabase | rusqlite::ErrorCode::DatabaseCorrupt
                )
        )
    })
}

/// The library's own index. An unreadable index is set aside (never deleted)
/// and rebuilt from the folder, with a notice.
fn open_index(app: &tauri::AppHandle, lib: &Lib) -> Result<Connection, String> {
    let file = libraries::index_file(&lib.dir, &lib.id).map_err(|e| format!("{e:#}"))?;
    let conn = match db::open(&file) {
        Ok(conn) => conn,
        Err(e) if unreadable_db(&e) => {
            let kept = libraries::quarantine(&file).map_err(|err| {
                format!("The search index for this library cannot be read ({e:#}) or set aside: {err:#}")
            })?;
            for suffix in ["-wal", "-shm"] {
                let side = PathBuf::from(format!("{}{suffix}", file.display()));
                if side.exists() {
                    let _ = std::fs::rename(&side, format!("{}{suffix}", kept.display()));
                }
            }
            note(
                app,
                &lib.id,
                format!(
                    "The search index for “{}” could not be read. It was kept as {} and rebuilt from the library folder; books, reading progress and highlights are unchanged.",
                    lib.name,
                    kept.file_name().unwrap_or_default().to_string_lossy()
                ),
            );
            db::open(&file).map_err(|e| format!("{e:#}"))?
        }
        Err(e) => return Err(format!("{e:#}")),
    };
    let root = lib.root.to_string_lossy();
    let stored = db::get_setting(&conn, LIBRARY_PATH_KEY).map_err(|e| e.to_string())?;
    if stored.as_deref() != Some(root.as_ref()) {
        conn.execute_batch("DELETE FROM books; DELETE FROM chunks;")
            .map_err(|e| e.to_string())?;
        db::set_setting(&conn, LIBRARY_PATH_KEY, &root).map_err(|e| e.to_string())?;
    }
    Ok(conn)
}

/// Book count of an existing index, read-only; `None` before the first scan
/// or when the index was built for another folder.
fn indexed_count(dir: &Path, entry: &libraries::Entry) -> Option<i64> {
    let file = libraries::index_file(dir, &entry.id).ok()?;
    if !file.is_file() {
        return None;
    }
    let conn = Connection::open_with_flags(
        &file,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .ok()?;
    let stored: String = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            [LIBRARY_PATH_KEY],
            |r| r.get(0),
        )
        .ok()?;
    if stored != entry.path {
        return None;
    }
    conn.query_row("SELECT COUNT(*) FROM books", [], |r| r.get(0))
        .ok()
}

#[derive(Serialize)]
struct KnownLibrary {
    id: String,
    name: String,
    path: String,
    status: Status,
    problem: Option<String>,
    /// Rows in this library's own index; `None` until it is first indexed.
    book_count: Option<i64>,
    active: bool,
}

#[derive(Serialize)]
struct LibrariesView {
    libraries: Vec<KnownLibrary>,
    active_id: Option<String>,
    notices: Vec<String>,
    error: Option<String>,
}

fn libraries_view(app: &tauri::AppHandle) -> Result<LibrariesView, String> {
    let (settings, dir, notices, error) = with_session(app, |s| {
        Ok((
            s.settings.clone(),
            s.dir.clone(),
            s.notices.clone(),
            s.error.clone(),
        ))
    })?;
    let libraries = settings
        .listed()
        .map(|entry| {
            let (status, detail) = libraries::probe(Path::new(&entry.path));
            KnownLibrary {
                id: entry.id.clone(),
                name: entry.name.clone(),
                path: entry.path.clone(),
                status,
                problem: (status != Status::Available).then(|| {
                    libraries::problem(&entry.name, &entry.path, status, detail.as_deref())
                }),
                book_count: indexed_count(&dir, entry),
                active: settings.active.as_deref() == Some(entry.id.as_str()),
            }
        })
        .collect();
    Ok(LibrariesView {
        libraries,
        active_id: settings.active.clone(),
        notices,
        error,
    })
}

#[derive(Serialize)]
struct LibraryState {
    library_id: Option<String>,
    library_name: Option<String>,
    library_path: Option<String>,
    status: Option<Status>,
    book_count: i64,
    notices: Vec<String>,
}

/// The open library, if any. A library whose folder is unavailable is still
/// reported (with its status) and never replaced by another one.
#[tauri::command]
async fn get_library_state(app: tauri::AppHandle) -> Result<LibraryState, String> {
    blocking(move || {
        let (entry, dir, notices) = with_session(&app, |s| {
            let entry = s
                .settings
                .active
                .as_deref()
                .and_then(|id| s.settings.get(id))
                .cloned();
            let notices = entry
                .as_ref()
                .and_then(|e| s.library_notices.get(&e.id).cloned())
                .unwrap_or_default();
            Ok((entry, s.dir.clone(), notices))
        })?;
        Ok(match entry {
            None => LibraryState {
                library_id: None,
                library_name: None,
                library_path: None,
                status: None,
                book_count: 0,
                notices,
            },
            Some(entry) => LibraryState {
                status: Some(libraries::probe(Path::new(&entry.path)).0),
                book_count: indexed_count(&dir, &entry).unwrap_or(0),
                library_id: Some(entry.id),
                library_name: Some(entry.name),
                library_path: Some(entry.path),
                notices,
            },
        })
    })
    .await
}

#[tauri::command]
async fn list_libraries(app: tauri::AppHandle) -> Result<LibrariesView, String> {
    blocking(move || libraries_view(&app)).await
}

#[derive(Serialize)]
struct Added {
    id: String,
    created: bool,
    view: LibrariesView,
}

/// Add a folder the user chose (picker or typed path) to the list, or find
/// it when the same folder is already listed. The open library is unchanged;
/// switching is a separate step so the open one can finish first.
#[tauri::command]
async fn add_library(app: tauri::AppHandle, path: String) -> Result<Added, String> {
    blocking(move || {
        let (id, created) = change(&app, |s| s.add(&path))?;
        Ok(Added {
            id,
            created,
            view: libraries_view(&app)?,
        })
    })
    .await
}

#[tauri::command]
async fn switch_library(app: tauri::AppHandle, id: String) -> Result<LibrariesView, String> {
    blocking(move || {
        let entry = with_session(&app, |s| {
            s.settings
                .get(&id)
                .cloned()
                .ok_or_else(|| "That library is no longer in your list.".to_owned())
        })?;
        let (status, detail) = libraries::probe(Path::new(&entry.path));
        if status != Status::Available {
            return Err(libraries::problem(
                &entry.name,
                &entry.path,
                status,
                detail.as_deref(),
            ));
        }
        change(&app, |s| s.activate(&id))?;
        libraries_view(&app)
    })
    .await
}

#[tauri::command]
async fn rename_library(
    app: tauri::AppHandle,
    id: String,
    name: String,
) -> Result<LibrariesView, String> {
    blocking(move || {
        change(&app, |s| s.rename(&id, &name))?;
        libraries_view(&app)
    })
    .await
}

/// Forget a library. Its folder and everything in it, and its index, stay.
#[tauri::command]
async fn remove_library(app: tauri::AppHandle, id: String) -> Result<LibrariesView, String> {
    blocking(move || {
        change(&app, |s| s.remove(&id))?;
        libraries_view(&app)
    })
    .await
}

#[tauri::command]
async fn relocate_library(
    app: tauri::AppHandle,
    id: String,
    path: String,
) -> Result<LibrariesView, String> {
    blocking(move || {
        change(&app, |s| s.relocate(&id, &path))?;
        libraries_view(&app)
    })
    .await
}

#[tauri::command]
async fn scan_library(
    app: tauri::AppHandle,
    library_id: String,
) -> Result<scanner::ScanResult, String> {
    blocking(move || {
        indexed(&app, &library_id, |lib, conn| {
            scanner::scan_library(conn, &lib.root).map_err(|e| e.to_string())
        })
    })
    .await
}

#[tauri::command]
async fn list_books(
    app: tauri::AppHandle,
    library_id: String,
    query: Option<String>,
) -> Result<Vec<Book>, String> {
    blocking(move || {
        indexed(&app, &library_id, |lib, conn| {
            let count: i64 = conn
                .query_row("SELECT count(*) FROM books", [], |r| r.get(0))
                .map_err(|e| e.to_string())?;
            if count == 0 {
                scanner::scan_library(conn, &lib.root).map_err(|e| e.to_string())?;
            }
            library::list(conn, &lib.root, query.as_deref()).map_err(|e| e.to_string())
        })
    })
    .await
}

#[tauri::command]
async fn update_book(
    app: tauri::AppHandle,
    library_id: String,
    id: String,
    edit: library::Edit,
) -> Result<(), String> {
    blocking(move || {
        indexed(&app, &library_id, |lib, conn| {
            library::update(conn, &lib.root, &id, edit).map_err(|e| e.to_string())
        })
    })
    .await
}

#[tauri::command]
async fn undo_library_edit(app: tauri::AppHandle, library_id: String) -> Result<(), String> {
    blocking(move || {
        indexed(&app, &library_id, |lib, conn| {
            library::undo(conn, &lib.root).map_err(|e| e.to_string())
        })
    })
    .await
}

#[tauri::command]
async fn merge_books(
    app: tauri::AppHandle,
    library_id: String,
    keep: String,
    absorb: String,
    edit: library::Edit,
) -> Result<(), String> {
    blocking(move || {
        indexed(&app, &library_id, |lib, conn| {
            library::merge(conn, &lib.root, &keep, &absorb, edit).map_err(|e| e.to_string())
        })
    })
    .await
}

#[tauri::command]
async fn get_profile_source(
    app: tauri::AppHandle,
    library_id: String,
    id: String,
) -> Result<String, String> {
    blocking(move || {
        indexed(&app, &library_id, |lib, _| {
            library::source_text(&lib.root, &id).map_err(|e| e.to_string())
        })
    })
    .await
}

#[tauri::command]
async fn get_organisation(
    app: tauri::AppHandle,
    library_id: String,
) -> Result<library::OrganisationView, String> {
    blocking(move || {
        indexed(&app, &library_id, |lib, _| {
            library::organisation(&lib.root).map_err(|e| e.to_string())
        })
    })
    .await
}

#[tauri::command]
async fn save_organisation(
    app: tauri::AppHandle,
    library_id: String,
    revision: u64,
    value: organisation::Organisation,
) -> Result<(), String> {
    blocking(move || {
        indexed(&app, &library_id, |lib, _| {
            library::save_organisation(&lib.root, revision, value).map_err(|e| e.to_string())
        })
    })
    .await
}

#[tauri::command]
async fn lookup_metadata(
    app: tauri::AppHandle,
    library_id: String,
    title: String,
    author: String,
    refresh: bool,
) -> Result<enrich::Suggestions, String> {
    blocking(move || {
        // Network lookup does not hold up local reading or library edits.
        let lib = bound(&app, &library_id)?;
        enrich::search(&lib.root, &title, &author, refresh).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn accept_metadata(
    app: tauri::AppHandle,
    library_id: String,
    id: String,
    expected: library::Edit,
    edit: library::Edit,
    candidate: enrich::OlDoc,
    use_cover: bool,
) -> Result<(), String> {
    blocking(move || {
        let root = bound(&app, &library_id)?.root;
        let accepted = enrich::accepted(&root, candidate, use_cover).map_err(|e| e.to_string())?;
        indexed(&app, &library_id, |lib, conn| {
            if lib.root != root {
                return Err("library folder changed; reopen the profile".into());
            }
            library::accept_metadata(conn, &lib.root, &id, &expected, edit, accepted)
                .map_err(|e| e.to_string())
        })
    })
    .await
}

/// Sidecar path for per-book reading state, under `<library>/.properbooky/state/`.
/// Files-as-truth: positions survive index rebuilds and travel with the folder.
/// The book path must lie inside the bound library's folder.
fn progress_file(
    app: &tauri::AppHandle,
    library_id: &str,
    book_path: &str,
) -> Result<PathBuf, String> {
    let lib = bound(app, library_id)?;
    identity::Registry::load(&lib.root)
        .and_then(|registry| registry.state_path(&lib.root, Path::new(book_path)))
        .map_err(|e| e.to_string())
}

/// Top of the wishlist, ranked for the daily download run: queued first,
/// then recommended, then by rating.
#[tauri::command]
async fn acquisition_queue(
    app: tauri::AppHandle,
    library_id: String,
    limit: i64,
) -> Result<Vec<Book>, String> {
    blocking(move || {
        indexed(&app, &library_id, |lib, conn| {
            let mut books = library::list(conn, &lib.root, None).map_err(|e| e.to_string())?;
            books.retain(|b| {
                b.kind == "catalog" && b.details.want_to_read && b.details.availability != "local"
            });
            let year: i64 = conn
                .query_row("SELECT CAST(strftime('%Y','now') AS INTEGER)", [], |r| {
                    r.get(0)
                })
                .map_err(|e| e.to_string())?;
            for b in &mut books {
                let age = b
                    .year
                    .map(|y| ((year - y).clamp(0, 120) as f64) / 120.0)
                    .unwrap_or(0.3);
                b.priority = Some(
                    0.35 * age
                        + 0.25 * (b.recommended as u8 as f64)
                        + 0.25 * (b.rating.unwrap_or(3) as f64) / 5.0
                        + 0.15
                            * match b.spectrum.as_deref() {
                                Some("original") => 1.0,
                                Some("novel") => 0.6,
                                Some("collection") => 0.3,
                                _ => 0.5,
                            },
                );
            }
            books.sort_by(|a, b| {
                b.details
                    .up_next
                    .cmp(&a.details.up_next)
                    .then_with(|| {
                        b.priority
                            .partial_cmp(&a.priority)
                            .unwrap_or(std::cmp::Ordering::Equal)
                    })
                    .then_with(|| a.title.cmp(&b.title))
            });
            books.truncate(limit.clamp(1, 100) as usize);
            Ok(books)
        })
    })
    .await
}

/// Flip a catalog entry's status (markdown is the source of truth; the
/// index row is mirrored). The entry must be inside the bound library.
#[tauri::command]
async fn set_catalog_status(
    app: tauri::AppHandle,
    library_id: String,
    path: String,
    status: String,
) -> Result<(), String> {
    blocking(move || {
        indexed(&app, &library_id, |lib, conn| {
            identity::relative(&lib.root, Path::new(&path)).map_err(|e| e.to_string())?;
            acquire::set_status(conn, Path::new(&path), &status).map_err(|e| e.to_string())
        })
    })
    .await
}

#[derive(Serialize)]
struct CatalogImport {
    report: catalog_import::Report,
    /// The rescan after a real import (none for a dry run).
    scan: Option<scanner::ScanResult>,
}

/// Import the Library of Books CSV export into this library's `Catalog/`
/// folder (PBK-19), then rescan so the new profiles are listed. Only adds
/// files; a dry run writes nothing.
#[tauri::command]
async fn import_catalog(
    app: tauri::AppHandle,
    library_id: String,
    csv_path: String,
    dry_run: bool,
) -> Result<CatalogImport, String> {
    blocking(move || {
        indexed(&app, &library_id, |lib, conn| {
            let dir = catalog_import::catalog_dir(&lib.root).map_err(|e| format!("{e:#}"))?;
            let imported = catalog_import::import(Path::new(&csv_path), &dir, dry_run);
            // Profiles published before a failure are complete; list them too.
            let scan = if dry_run || !dir.is_dir() {
                None
            } else {
                Some(scanner::scan_library(conn, &lib.root).map_err(|e| e.to_string())?)
            };
            let report = imported.map_err(|e| format!("{e:#}"))?;
            Ok(CatalogImport { report, scan })
        })
    })
    .await
}

/// Match, rename, file, and link everything waiting in `<library>/Drop/`.
#[tauri::command]
async fn process_drop(
    app: tauri::AppHandle,
    library_id: String,
) -> Result<acquire::DropReport, String> {
    blocking(move || {
        indexed(&app, &library_id, |lib, conn| {
            scanner::scan_library(conn, &lib.root).map_err(|e| e.to_string())?;
            let report = acquire::process_drop(conn, &lib.root).map_err(|e| e.to_string())?;
            scanner::scan_library(conn, &lib.root).map_err(|e| e.to_string())?;
            Ok(report)
        })
    })
    .await
}

#[derive(Serialize)]
struct AppSettings {
    obsidian_vault_path: Option<String>,
    /// Where this library's highlights are written.
    export_folder: Option<String>,
}

/// Per-library settings: each library has its own Obsidian export folder.
#[tauri::command]
fn get_app_settings(app: tauri::AppHandle, library_id: String) -> Result<AppSettings, String> {
    let lib = bound(&app, &library_id)?;
    let vault = with_session(&app, |s| {
        Ok(s.settings
            .get(&lib.id)
            .and_then(|e| e.obsidian_vault_path.clone()))
    })?;
    Ok(AppSettings {
        export_folder: vault
            .as_deref()
            .map(|v| libraries::export_folder(v).to_string_lossy().into_owned()),
        obsidian_vault_path: vault,
    })
}

#[tauri::command]
fn set_obsidian_vault(
    app: tauri::AppHandle,
    library_id: String,
    path: String,
) -> Result<(), String> {
    bound(&app, &library_id)?;
    change(&app, |s| s.set_vault(&library_id, Some(path)))
}

#[derive(Serialize, serde::Deserialize)]
struct ExportMarker {
    library_id: String,
}

/// Export all live highlights into `<vault>/Properbooky/` — a dedicated
/// generated folder inside the user's Obsidian vault, owned by one library.
#[tauri::command]
fn sync_obsidian(
    app: tauri::AppHandle,
    library_id: String,
) -> Result<export::ExportReport, String> {
    // Synchronous command (main thread): no library lock, as before, so an
    // export never waits for a long scan. Claiming the folder is idempotent.
    let lib = bound(&app, &library_id)?;
    let (vault, owner) = with_session(&app, |s| {
        let vault = s
            .settings
            .get(&lib.id)
            .and_then(|e| e.obsidian_vault_path.clone())
            .ok_or("set an Obsidian vault folder first")?;
        let owner = s
            .settings
            .export_owner(&lib.id, &vault)
            .map(|e| e.name.clone());
        Ok((vault, owner))
    })?;
    let out = libraries::export_folder(&vault);
    if let Some(other) = owner {
        return Err(libraries::shared_export(&other, &out));
    }
    let marker = out.join(libraries::EXPORT_MARKER);
    if let Ok(bytes) = std::fs::read(&marker) {
        if let Ok(previous) = serde_json::from_slice::<ExportMarker>(&bytes) {
            if previous.library_id != lib.id {
                let other = with_session(&app, |s| {
                    Ok(s.settings
                        .libraries
                        .iter()
                        .find(|e| e.id == previous.library_id)
                        .map(|e| e.name.clone()))
                })?;
                if let Some(other) = other {
                    return Err(format!(
                        "{} If you no longer use “{other}”, re-add it and clear its Obsidian folder, or delete the file {} yourself.",
                        libraries::shared_export(&other, &out),
                        libraries::EXPORT_MARKER
                    ));
                }
            }
        }
    }
    std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
    let claim = serde_json::to_vec_pretty(&ExportMarker {
        library_id: lib.id.clone(),
    })
    .map_err(|e| e.to_string())?;
    if std::fs::read(&marker).ok().as_deref() != Some(claim.as_slice()) {
        identity::atomic_write(&marker, &claim).map_err(|e| format!("{e:#}"))?;
    }
    export::export_highlights(&lib.root, &out).map_err(|e| e.to_string())
}

/// Fetch a URL, readability-extract it, and save it into the library as a
/// permanent markdown article; the index row is inserted immediately.
#[tauri::command]
async fn save_article(
    app: tauri::AppHandle,
    library_id: String,
    url: String,
) -> Result<Book, String> {
    blocking(move || {
        bound(&app, &library_id)?;
        let agent = ureq::AgentBuilder::new()
            .timeout(std::time::Duration::from_secs(25))
            .user_agent("Mozilla/5.0 (X11; Linux x86_64) ProperBooky/0.1")
            .build();
        let html = agent
            .get(&url)
            .call()
            .map_err(|e| format!("could not fetch the page: {e}"))?
            .into_string()
            .map_err(|e| format!("could not read the page: {e}"))?;

        let (meta, markdown) = article::extract(&html, &url).map_err(|e| e.to_string())?;
        // The download may outlive the library it was started in; a switched
        // library gets nothing written, neither the old one nor the new one.
        indexed(&app, &library_id, |lib, conn| {
            let root = &lib.root;
            let path = article::save(root, &meta, &markdown).map_err(|e| e.to_string())?;

            let size = std::fs::metadata(&path)
                .map(|m| m.len() as i64)
                .unwrap_or(0);
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            let filename = path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            conn.execute(
                "INSERT OR REPLACE INTO books
                 (path, filename, title, author, category, kind, status, rating, recommended, file_link, cover, year, format, size_bytes, modified_at, indexed_at)
                 VALUES (?1, ?2, ?3, ?4, 'Articles', 'article', 'available', NULL, 0, ?1, NULL, NULL, 'article', ?5, ?6, ?6)",
                (
                    path.to_string_lossy(),
                    &filename,
                    &meta.title,
                    &meta.author,
                    size,
                    now,
                ),
            )
            .map_err(|e| e.to_string())?;

            scanner::scan_library(conn, root).map_err(|e| e.to_string())?;
            library::list(conn, root, None)
                .map_err(|e| e.to_string())?
                .into_iter()
                .find(|b| b.path == path.to_string_lossy())
                .ok_or_else(|| "saved article was not indexed".into())
        })
        .map_err(|e| {
            if e == NOT_OPEN {
                "The library was switched before the article finished downloading, so it was not saved.".into()
            } else {
                e
            }
        })
    })
    .await
}

/// Sidecar with only live highlights — what the readers need at open.
#[tauri::command]
fn get_sidecar(
    app: tauri::AppHandle,
    library_id: String,
    path: String,
) -> Result<annotations::Sidecar, String> {
    let file = progress_file(&app, &library_id, &path)?;
    let mut sidecar = annotations::load_checked(&file).map_err(|e| format!("{e:#}"))?;
    sidecar.highlights.retain(|h| !h.deleted);
    sidecar.highlights.sort_by_key(|h| h.created_at);
    Ok(sidecar)
}

#[tauri::command]
fn save_progress(
    app: tauri::AppHandle,
    library_id: String,
    path: String,
    position: String,
    percent: Option<f64>,
) -> Result<(), String> {
    let file = progress_file(&app, &library_id, &path)?;
    annotations::set_position(&file, position, percent).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
fn add_highlight(
    app: tauri::AppHandle,
    library_id: String,
    path: String,
    text: String,
    note: Option<String>,
    color: Option<String>,
    anchor: serde_json::Value,
) -> Result<annotations::Highlight, String> {
    let file = progress_file(&app, &library_id, &path)?;
    annotations::add_highlight(&file, text, note, color, anchor).map_err(|e| e.to_string())
}

#[tauri::command]
fn remove_highlight(
    app: tauri::AppHandle,
    library_id: String,
    path: String,
    id: String,
) -> Result<bool, String> {
    let file = progress_file(&app, &library_id, &path)?;
    annotations::remove_highlight(&file, &id).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_highlight_note(
    app: tauri::AppHandle,
    library_id: String,
    path: String,
    id: String,
    note: Option<String>,
) -> Result<bool, String> {
    let file = progress_file(&app, &library_id, &path)?;
    annotations::set_note(&file, &id, note).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_library_state,
            list_libraries,
            add_library,
            switch_library,
            rename_library,
            remove_library,
            relocate_library,
            scan_library,
            list_books,
            update_book,
            get_organisation,
            save_organisation,
            lookup_metadata,
            accept_metadata,
            merge_books,
            get_profile_source,
            undo_library_edit,
            get_sidecar,
            save_progress,
            add_highlight,
            remove_highlight,
            set_highlight_note,
            acquisition_queue,
            set_catalog_status,
            import_catalog,
            process_drop,
            save_article,
            get_app_settings,
            set_obsidian_vault,
            sync_obsidian
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
