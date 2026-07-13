use anyhow::Result;
use rusqlite::Connection;
use std::path::Path;

/// Bump when the schema changes. The index is disposable (files are the
/// source of truth), so a mismatch drops and recreates everything.
const SCHEMA_VERSION: i64 = 5;

pub fn open(db_path: &Path) -> Result<Connection> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let conn = Connection::open(db_path)?;
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version != 0 && version != SCHEMA_VERSION {
        conn.execute_batch(
            "DROP TABLE IF EXISTS books_fts;
             DROP TABLE IF EXISTS books;
             DROP TABLE IF EXISTS settings;",
        )?;
    }
    conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    conn.execute_batch(
        r#"
        PRAGMA journal_mode = WAL;

        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS books (
            id          INTEGER PRIMARY KEY,
            path        TEXT NOT NULL UNIQUE,
            filename    TEXT NOT NULL,
            title       TEXT NOT NULL,
            author      TEXT,
            category    TEXT,
            kind        TEXT NOT NULL DEFAULT 'file',
            status      TEXT,
            rating      INTEGER,
            recommended INTEGER NOT NULL DEFAULT 0,
            file_link   TEXT,
            format      TEXT NOT NULL,
            size_bytes  INTEGER NOT NULL,
            modified_at INTEGER NOT NULL,
            indexed_at  INTEGER NOT NULL
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS books_fts USING fts5(
            title, author, filename, category,
            content='books', content_rowid='id'
        );

        CREATE TRIGGER IF NOT EXISTS books_ai AFTER INSERT ON books BEGIN
            INSERT INTO books_fts(rowid, title, author, filename, category)
            VALUES (new.id, new.title, new.author, new.filename, new.category);
        END;

        CREATE TRIGGER IF NOT EXISTS books_ad AFTER DELETE ON books BEGIN
            INSERT INTO books_fts(books_fts, rowid, title, author, filename, category)
            VALUES ('delete', old.id, old.title, old.author, old.filename, old.category);
        END;

        CREATE TRIGGER IF NOT EXISTS books_au AFTER UPDATE ON books BEGIN
            INSERT INTO books_fts(books_fts, rowid, title, author, filename, category)
            VALUES ('delete', old.id, old.title, old.author, old.filename, old.category);
            INSERT INTO books_fts(rowid, title, author, filename, category)
            VALUES (new.id, new.title, new.author, new.filename, new.category);
        END;
        "#,
    )?;
    Ok(conn)
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO settings(key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )?;
    Ok(())
}

pub fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
    let mut rows = stmt.query([key])?;
    Ok(match rows.next()? {
        Some(row) => Some(row.get(0)?),
        None => None,
    })
}
