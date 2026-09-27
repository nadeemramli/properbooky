pub mod acquire;
pub mod annotations;
pub mod article;
pub mod catalog;
pub mod consolidation;
pub mod db;
pub mod enrich;
pub mod export;
pub mod extract;
pub mod identity;
pub mod library;
pub mod matcher;
pub mod scanner;
use library::Book;
static LIBRARY_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

use rusqlite::Connection;
use serde::Serialize;
use std::path::PathBuf;
use tauri::Manager;

const LIBRARY_PATH_KEY: &str = "library_path";

#[derive(Serialize)]
struct LibraryState {
    library_path: Option<String>,
    book_count: i64,
}

fn open_db(app: &tauri::AppHandle) -> Result<Connection, String> {
    let db_path = db_file(app)?;
    db::open(&db_path).map_err(|e| e.to_string())
}

fn db_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("library.db"))
}

#[tauri::command]
async fn get_library_state(app: tauri::AppHandle) -> Result<LibraryState, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = LIBRARY_LOCK.lock().map_err(|e| e.to_string())?;
        let conn = open_db(&app)?;
        let library_path = db::get_setting(&conn, LIBRARY_PATH_KEY).map_err(|e| e.to_string())?;
        let book_count = conn
            .query_row("SELECT COUNT(*) FROM books", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        Ok(LibraryState {
            library_path,
            book_count,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn scan_library(app: tauri::AppHandle, path: String) -> Result<scanner::ScanResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = LIBRARY_LOCK.lock().map_err(|e| e.to_string())?;
        let conn = open_db(&app)?;
        let root = PathBuf::from(&path);
        let result = scanner::scan_library(&conn, &root).map_err(|e| e.to_string())?;
        db::set_setting(&conn, LIBRARY_PATH_KEY, &path).map_err(|e| e.to_string())?;
        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn list_books(app: tauri::AppHandle, query: Option<String>) -> Result<Vec<Book>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = LIBRARY_LOCK.lock().map_err(|e| e.to_string())?;
        let conn = open_db(&app)?;
        let Some(root) = db::get_setting(&conn, LIBRARY_PATH_KEY).map_err(|e| e.to_string())?
        else {
            return Ok(Vec::new());
        };
        let root = PathBuf::from(root);
        let count: i64 = conn
            .query_row("SELECT count(*) FROM books", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if count == 0 {
            scanner::scan_library(&conn, &root).map_err(|e| e.to_string())?;
        }
        library::list(&conn, &root, query.as_deref()).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn update_book(app: tauri::AppHandle, id: String, edit: library::Edit) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = LIBRARY_LOCK.lock().map_err(|e| e.to_string())?;
        let conn = open_db(&app)?;
        let root = library_root(&conn)?;
        library::update(&conn, &root, &id, edit).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn undo_library_edit(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = LIBRARY_LOCK.lock().map_err(|e| e.to_string())?;
        let conn = open_db(&app)?;
        library::undo(&conn, &library_root(&conn)?).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn merge_books(
    app: tauri::AppHandle,
    keep: String,
    absorb: String,
    edit: library::Edit,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = LIBRARY_LOCK.lock().map_err(|e| e.to_string())?;
        let conn = open_db(&app)?;
        library::merge(&conn, &library_root(&conn)?, &keep, &absorb, edit)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_profile_source(app: tauri::AppHandle, id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = LIBRARY_LOCK.lock().map_err(|e| e.to_string())?;
        let conn = open_db(&app)?;
        library::source_text(&library_root(&conn)?, &id).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn library_root(conn: &Connection) -> Result<PathBuf, String> {
    db::get_setting(conn, LIBRARY_PATH_KEY)
        .map_err(|e| e.to_string())?
        .map(PathBuf::from)
        .ok_or_else(|| "no library configured".into())
}

/// Sidecar path for per-book reading state, under `<library>/.properbooky/state/`.
/// Files-as-truth: positions survive index rebuilds and travel with the folder.
fn progress_file(app: &tauri::AppHandle, book_path: &str) -> Result<PathBuf, String> {
    let conn = open_db(app)?;
    let root = db::get_setting(&conn, LIBRARY_PATH_KEY)
        .map_err(|e| e.to_string())?
        .ok_or("no library configured")?;
    let root = PathBuf::from(root);
    identity::Registry::load(&root)
        .and_then(|registry| registry.state_path(&root, PathBuf::from(book_path).as_path()))
        .map_err(|e| e.to_string())
}

/// Top of the wishlist, ranked for the daily download run: queued first,
/// then recommended, then by rating.
#[tauri::command]
async fn acquisition_queue(app: tauri::AppHandle, limit: i64) -> Result<Vec<Book>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = LIBRARY_LOCK.lock().map_err(|e| e.to_string())?;
        let conn = open_db(&app)?;
        let mut books =
            library::list(&conn, &library_root(&conn)?, None).map_err(|e| e.to_string())?;
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
    .await
    .map_err(|e| e.to_string())?
}

/// Flip a catalog entry's status (markdown is the source of truth; the
/// index row is mirrored).
#[tauri::command]
async fn set_catalog_status(
    app: tauri::AppHandle,
    path: String,
    status: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = LIBRARY_LOCK.lock().map_err(|e| e.to_string())?;
        let conn = open_db(&app)?;
        acquire::set_status(&conn, PathBuf::from(path).as_path(), &status)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Match, rename, file, and link everything waiting in `<library>/Drop/`.
#[tauri::command]
async fn process_drop(app: tauri::AppHandle) -> Result<acquire::DropReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = LIBRARY_LOCK.lock().map_err(|e| e.to_string())?;
        let conn = open_db(&app)?;
        let root = db::get_setting(&conn, LIBRARY_PATH_KEY)
            .map_err(|e| e.to_string())?
            .ok_or("no library configured")?;
        let root = PathBuf::from(root);
        scanner::scan_library(&conn, &root).map_err(|e| e.to_string())?;
        let report = acquire::process_drop(&conn, &root).map_err(|e| e.to_string())?;
        scanner::scan_library(&conn, &root).map_err(|e| e.to_string())?;
        Ok(report)
    })
    .await
    .map_err(|e| e.to_string())?
}

const OBSIDIAN_VAULT_KEY: &str = "obsidian_vault_path";

#[derive(Serialize)]
struct AppSettings {
    obsidian_vault_path: Option<String>,
}

#[tauri::command]
fn get_app_settings(app: tauri::AppHandle) -> Result<AppSettings, String> {
    let conn = open_db(&app)?;
    Ok(AppSettings {
        obsidian_vault_path: db::get_setting(&conn, OBSIDIAN_VAULT_KEY)
            .map_err(|e| e.to_string())?,
    })
}

#[tauri::command]
fn set_obsidian_vault(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let conn = open_db(&app)?;
    db::set_setting(&conn, OBSIDIAN_VAULT_KEY, &path).map_err(|e| e.to_string())
}

/// Export all live highlights into `<vault>/Properbooky/` — a dedicated
/// generated folder inside the user's Obsidian vault.
#[tauri::command]
fn sync_obsidian(app: tauri::AppHandle) -> Result<export::ExportReport, String> {
    let conn = open_db(&app)?;
    let root = db::get_setting(&conn, LIBRARY_PATH_KEY)
        .map_err(|e| e.to_string())?
        .ok_or("no library configured")?;
    let vault = db::get_setting(&conn, OBSIDIAN_VAULT_KEY)
        .map_err(|e| e.to_string())?
        .ok_or("set an Obsidian vault folder first")?;
    let out = PathBuf::from(vault).join("Properbooky");
    export::export_highlights(PathBuf::from(root).as_path(), &out).map_err(|e| e.to_string())
}

/// Fetch a URL, readability-extract it, and save it into the library as a
/// permanent markdown article; the index row is inserted immediately.
#[tauri::command]
async fn save_article(app: tauri::AppHandle, url: String) -> Result<Book, String> {
    tauri::async_runtime::spawn_blocking(move || {
    let conn = open_db(&app)?;
    let root = db::get_setting(&conn, LIBRARY_PATH_KEY)
        .map_err(|e| e.to_string())?
        .ok_or("no library configured")?;
    let root = PathBuf::from(root);

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
    let _guard = LIBRARY_LOCK.lock().map_err(|e| e.to_string())?;
    let path = article::save(&root, &meta, &markdown).map_err(|e| e.to_string())?;

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

    scanner::scan_library(&conn, &root).map_err(|e| e.to_string())?;
    library::list(&conn, &root, None)
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|b| b.path == path.to_string_lossy())
        .ok_or_else(|| "saved article was not indexed".into())

    }).await.map_err(|e| e.to_string())?
}

/// Sidecar with only live highlights — what the readers need at open.
#[tauri::command]
fn get_sidecar(app: tauri::AppHandle, path: String) -> Result<annotations::Sidecar, String> {
    let file = progress_file(&app, &path)?;
    let mut sidecar = annotations::load(&file);
    sidecar.highlights = annotations::live_highlights(&file);
    Ok(sidecar)
}

#[tauri::command]
fn save_progress(
    app: tauri::AppHandle,
    path: String,
    position: String,
    percent: Option<f64>,
) -> Result<(), String> {
    let file = progress_file(&app, &path)?;
    annotations::set_position(&file, position, percent).map_err(|e| e.to_string())
}

#[tauri::command]
fn add_highlight(
    app: tauri::AppHandle,
    path: String,
    text: String,
    note: Option<String>,
    color: Option<String>,
    anchor: serde_json::Value,
) -> Result<annotations::Highlight, String> {
    let file = progress_file(&app, &path)?;
    annotations::add_highlight(&file, text, note, color, anchor).map_err(|e| e.to_string())
}

#[tauri::command]
fn remove_highlight(app: tauri::AppHandle, path: String, id: String) -> Result<bool, String> {
    let file = progress_file(&app, &path)?;
    annotations::remove_highlight(&file, &id).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_highlight_note(
    app: tauri::AppHandle,
    path: String,
    id: String,
    note: Option<String>,
) -> Result<bool, String> {
    let file = progress_file(&app, &path)?;
    annotations::set_note(&file, &id, note).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_library_state,
            scan_library,
            list_books,
            update_book,
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
            process_drop,
            save_article,
            get_app_settings,
            set_obsidian_vault,
            sync_obsidian
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
