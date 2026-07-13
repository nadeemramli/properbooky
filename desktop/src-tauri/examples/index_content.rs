//! Build the full-text knowledge layer: extract every readable asset to a
//! text cache, then (re)index it as searchable chunks.
//!
//! Usage: cargo run --release --example index_content -- <library-root> <db-path>
//!
//! Extraction is the expensive step, so it caches to
//! `.properbooky/text/<slug>.txt` (files-as-truth for derived text too);
//! chunk indexing rebuilds fast from the cache. Re-running only extracts
//! assets without a cache file.

use desktop_lib::{db, extract};
use std::path::PathBuf;

fn main() -> anyhow::Result<()> {
    let mut args = std::env::args().skip(1);
    let (Some(root), Some(db_path)) = (args.next().map(PathBuf::from), args.next()) else {
        eprintln!("usage: index_content <library-root> <db-path>");
        std::process::exit(2);
    };
    let text_dir = root.join(".properbooky").join("text");
    std::fs::create_dir_all(&text_dir)?;

    let conn = db::open(&PathBuf::from(&db_path))?;
    let assets: Vec<(String, String)> = conn
        .prepare(
            "SELECT path, format FROM books
             WHERE format IN ('epub', 'pdf', 'article')
             ORDER BY path",
        )?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;
    eprintln!("{} assets to consider", assets.len());

    let (mut extracted, mut cached, mut failed, mut chunk_count) = (0u32, 0u32, 0u32, 0u64);
    conn.execute("DELETE FROM chunks", [])?;

    for (i, (path, _format)) in assets.iter().enumerate() {
        if i % 25 == 0 {
            eprintln!("  {i}/{} (extracted={extracted} cached={cached} failed={failed})", assets.len());
        }
        let relative = path
            .strip_prefix(&root.to_string_lossy().as_ref().to_owned())
            .unwrap_or(path)
            .trim_start_matches(['/', '\\']);
        let slug = relative.replace(['/', '\\'], "__");
        let cache = text_dir.join(format!("{slug}.txt"));

        let text = if cache.exists() {
            cached += 1;
            std::fs::read_to_string(&cache).unwrap_or_default()
        } else {
            match extract::extract_text(PathBuf::from(path).as_path()) {
                Ok(text) if text.trim().len() > 100 => {
                    std::fs::write(&cache, &text)?;
                    extracted += 1;
                    text
                }
                Ok(_) | Err(_) => {
                    // Mark failures so re-runs don't retry expensively.
                    std::fs::write(&cache, "")?;
                    failed += 1;
                    continue;
                }
            }
        };
        if text.trim().len() < 100 {
            continue;
        }

        let mut insert = conn.prepare_cached(
            "INSERT INTO chunks (book_path, seq, text) VALUES (?1, ?2, ?3)",
        )?;
        for (seq, chunk) in extract::chunk_text(&text).into_iter().enumerate() {
            insert.execute(rusqlite::params![path, seq as i64, chunk])?;
            chunk_count += 1;
        }
    }

    println!(
        "extracted={extracted} cached={cached} failed={failed} chunks={chunk_count}"
    );
    Ok(())
}
