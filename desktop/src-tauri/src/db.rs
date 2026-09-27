use anyhow::Result;
use rusqlite::Connection;
use std::path::Path;

/// Bump when the schema changes. The index is disposable (files are the
/// source of truth), so a mismatch drops and recreates everything.
const SCHEMA_VERSION: i64 = 9;

pub fn open(db_path: &Path) -> Result<Connection> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let conn = Connection::open(db_path)?;
    conn.busy_timeout(std::time::Duration::from_secs(10))?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    let migration = conn.unchecked_transaction()?;
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    anyhow::ensure!(
        version <= SCHEMA_VERSION,
        "index was written by a newer ProperBooky version"
    );
    if version != 0 && version != SCHEMA_VERSION {
        conn.execute_batch(
            "DROP TABLE IF EXISTS books_fts;
             DROP TABLE IF EXISTS books;
             DROP TABLE IF EXISTS chunks_fts;
             DROP TABLE IF EXISTS chunks;",
        )?;
    }
    conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    conn.execute_batch(
        r#"

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
            cover       TEXT,
            year        INTEGER,
            spectrum    TEXT,
            stable_id   TEXT,
            asset_id    TEXT,
            reading_status TEXT NOT NULL DEFAULT 'unread',
            want_to_read INTEGER NOT NULL DEFAULT 0,
            up_next INTEGER NOT NULL DEFAULT 0,
            content_type TEXT NOT NULL DEFAULT 'unidentified',
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

        CREATE TABLE IF NOT EXISTS chunks (
            id        INTEGER PRIMARY KEY,
            book_path TEXT NOT NULL,
            seq       INTEGER NOT NULL,
            text      TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS chunks_book ON chunks(book_path);

        CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
            text, content='chunks', content_rowid='id'
        );

        CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
            INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
        END;

        CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
            INSERT INTO chunks_fts(chunks_fts, rowid, text)
            VALUES ('delete', old.id, old.text);
        END;

        CREATE TRIGGER IF NOT EXISTS books_au AFTER UPDATE ON books BEGIN
            INSERT INTO books_fts(books_fts, rowid, title, author, filename, category)
            VALUES ('delete', old.id, old.title, old.author, old.filename, old.category);
            INSERT INTO books_fts(rowid, title, author, filename, category)
            VALUES (new.id, new.title, new.author, new.filename, new.category);
        END;
        "#,
    )?;
    migration.commit()?;
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
