pub mod catalog;
pub mod db;
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
    format: String,
    size_bytes: i64,
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
            format: row.get(9)?,
            size_bytes: row.get(10)?,
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
                    "SELECT b.id, b.path, b.filename, b.title, b.author, b.category, b.kind, b.status, b.rating, b.format, b.size_bytes
                     FROM books b JOIN books_fts f ON f.rowid = b.id
                     WHERE books_fts MATCH ?1 ORDER BY rank",
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
                    "SELECT id, path, filename, title, author, category, kind, status, rating, format, size_bytes
                     FROM books ORDER BY title COLLATE NOCASE",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt.query_map([], map_row).map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
        }
    };
    Ok(books)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_library_state,
            scan_library,
            list_books
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
