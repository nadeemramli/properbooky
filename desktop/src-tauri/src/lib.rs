pub mod acquire;
pub mod annotations;
pub mod catalog;
pub mod db;
pub mod enrich;
pub mod matcher;
pub mod scanner;

use rusqlite::Connection;
use serde::Serialize;
use std::path::PathBuf;
use tauri::Manager;

const LIBRARY_PATH_KEY: &str = "library_path";

#[derive(Serialize)]
struct Book {
    id: i64,
    path: String,
    filename: String,
    title: String,
    author: Option<String>,
    category: Option<String>,
    kind: String,
    status: Option<String>,
    rating: Option<i64>,
    file_link: Option<String>,
    format: String,
    size_bytes: i64,
    recommended: bool,
    cover: Option<String>,
    year: Option<i64>,
}


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
fn get_library_state(app: tauri::AppHandle) -> Result<LibraryState, String> {
    let conn = open_db(&app)?;
    let library_path = db::get_setting(&conn, LIBRARY_PATH_KEY).map_err(|e| e.to_string())?;
    let book_count = conn
        .query_row("SELECT COUNT(*) FROM books", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    Ok(LibraryState {
        library_path,
        book_count,
    })
}

#[tauri::command]
fn scan_library(app: tauri::AppHandle, path: String) -> Result<scanner::ScanResult, String> {
    let conn = open_db(&app)?;
    let result = scanner::scan_library(&conn, PathBuf::from(&path).as_path())
        .map_err(|e| e.to_string())?;
    db::set_setting(&conn, LIBRARY_PATH_KEY, &path).map_err(|e| e.to_string())?;
    Ok(result)
}

#[tauri::command]
fn list_books(app: tauri::AppHandle, query: Option<String>) -> Result<Vec<Book>, String> {
    let conn = open_db(&app)?;
    let map_row = |row: &rusqlite::Row| -> rusqlite::Result<Book> {
        Ok(Book {
            id: row.get(0)?,
            path: row.get(1)?,
            filename: row.get(2)?,
            title: row.get(3)?,
            author: row.get(4)?,
            category: row.get(5)?,
            kind: row.get(6)?,
            status: row.get(7)?,
            rating: row.get(8)?,
            file_link: row.get(9)?,
            format: row.get(10)?,
            size_bytes: row.get(11)?,
            recommended: row.get(12)?,
            cover: row.get(13)?,
            year: row.get(14)?,
        })
    };

    let books = match query.as_deref().map(str::trim).filter(|q| !q.is_empty()) {
        Some(q) => {
            let fts_query = q
                .split_whitespace()
                .map(|token| format!("\"{}\"*", token.replace('"', "")))
                .collect::<Vec<_>>()
                .join(" ");
            let mut stmt = conn
                .prepare(
                    "SELECT b.id, b.path, b.filename, b.title, b.author, b.category, b.kind, b.status, b.rating, b.file_link, b.format, b.size_bytes, b.recommended, b.cover, b.year
                     FROM books b JOIN books_fts f ON f.rowid = b.id
                     WHERE books_fts MATCH ?1
                       AND NOT (b.kind = 'file' AND b.path IN
                                (SELECT file_link FROM books WHERE file_link IS NOT NULL))
                     ORDER BY rank",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([fts_query], map_row)
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
        }
        None => {
            let mut stmt = conn
                .prepare(
                    "SELECT id, path, filename, title, author, category, kind, status, rating, file_link, format, size_bytes, recommended, cover, year
                     FROM books
                     WHERE NOT (kind = 'file' AND path IN
                                (SELECT file_link FROM books WHERE file_link IS NOT NULL))
                     ORDER BY title COLLATE NOCASE",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt.query_map([], map_row).map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
        }
    };
    Ok(books)
}

/// Sidecar path for per-book reading state, under `<library>/.properbooky/state/`.
/// Files-as-truth: positions survive index rebuilds and travel with the folder.
fn progress_file(app: &tauri::AppHandle, book_path: &str) -> Result<PathBuf, String> {
    let conn = open_db(app)?;
    let root = db::get_setting(&conn, LIBRARY_PATH_KEY)
        .map_err(|e| e.to_string())?
        .ok_or("no library configured")?;
    let relative = book_path
        .strip_prefix(&root)
        .unwrap_or(book_path)
        .trim_start_matches(['/', '\\']);
    let slug: String = relative
        .chars()
        .map(|c| if matches!(c, '/' | '\\') { "__".to_owned() } else { c.to_string() })
        .collect();
    let dir = PathBuf::from(root).join(".properbooky").join("state");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(format!("{slug}.json")))
}

/// Top of the wishlist, ranked for the daily download run: queued first,
/// then recommended, then by rating.
#[tauri::command]
fn acquisition_queue(app: tauri::AppHandle, limit: i64) -> Result<Vec<Book>, String> {
    let conn = open_db(&app)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, path, filename, title, author, category, kind, status, rating, file_link, format, size_bytes, recommended, cover, year
             FROM books
             WHERE kind = 'catalog' AND file_link IS NULL
               AND status IN ('wishlist', 'queued')
             ORDER BY (status = 'queued') DESC, recommended DESC,
                      COALESCE(rating, 0) DESC, title COLLATE NOCASE
             LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([limit], |row| {
            Ok(Book {
                id: row.get(0)?,
                path: row.get(1)?,
                filename: row.get(2)?,
                title: row.get(3)?,
                author: row.get(4)?,
                category: row.get(5)?,
                kind: row.get(6)?,
                status: row.get(7)?,
                rating: row.get(8)?,
                file_link: row.get(9)?,
                format: row.get(10)?,
                size_bytes: row.get(11)?,
                recommended: row.get(12)?,
                cover: row.get(13)?,
                year: row.get(14)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// Flip a catalog entry's status (markdown is the source of truth; the
/// index row is mirrored).
#[tauri::command]
fn set_catalog_status(
    app: tauri::AppHandle,
    path: String,
    status: String,
) -> Result<(), String> {
    let conn = open_db(&app)?;
    acquire::set_status(&conn, PathBuf::from(path).as_path(), &status)
        .map_err(|e| e.to_string())
}

/// Match, rename, file, and link everything waiting in `<library>/Drop/`.
#[tauri::command]
fn process_drop(app: tauri::AppHandle) -> Result<acquire::DropReport, String> {
    let conn = open_db(&app)?;
    let root = db::get_setting(&conn, LIBRARY_PATH_KEY)
        .map_err(|e| e.to_string())?
        .ok_or("no library configured")?;
    acquire::process_drop(&conn, PathBuf::from(root).as_path()).map_err(|e| e.to_string())
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_library_state,
            scan_library,
            list_books,
            get_sidecar,
            save_progress,
            add_highlight,
            remove_highlight,
            acquisition_queue,
            set_catalog_status,
            process_drop
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
