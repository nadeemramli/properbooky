//! Reproduce list_books' query + row mapping against a database file.
//! Usage: cargo run --example probe_list -- <db-path>

fn main() -> anyhow::Result<()> {
    let db = std::env::args().nth(1).expect("db path");
    let conn = rusqlite::Connection::open(db)?;
    let mut stmt = conn.prepare(
        "SELECT id, path, filename, title, author, category, kind, status, rating, file_link, format, size_bytes, recommended, cover, year
         FROM books
         WHERE NOT (kind = 'file' AND path IN
                    (SELECT file_link FROM books WHERE file_link IS NOT NULL))
         ORDER BY title COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(3)?,
            row.get::<_, bool>(12)?,
            row.get::<_, Option<String>>(13)?,
            row.get::<_, Option<i64>>(14)?,
        ))
    })?;
    let mut count = 0;
    for row in rows {
        match row {
            Ok(_) => count += 1,
            Err(e) => {
                println!("row error after {count}: {e}");
                return Ok(());
            }
        }
    }
    println!("mapped {count} rows cleanly");
    Ok(())
}
