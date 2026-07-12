//! Import the "Library of Books" sheet CSV into Catalog/*.md files.
//!
//! Usage: cargo run --example import_catalog -- <csv-path> <catalog-dir>
//!
//! Re-runnable: existing files are never overwritten (the catalog file may
//! have accumulated notes/links since import); duplicate rows are skipped.

use desktop_lib::catalog::{self, CatalogEntry};
use std::collections::HashSet;
use std::path::PathBuf;

fn field(record: &csv::StringRecord, idx: Option<usize>) -> Option<String> {
    idx.and_then(|i| record.get(i))
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(ToOwned::to_owned)
}

fn map_status(sheet_status: Option<&str>) -> String {
    match sheet_status.map(str::to_lowercase).as_deref() {
        Some(s) if s.contains("downloaded") => "available".to_owned(),
        Some(s) if s.contains("need to read") => "queued".to_owned(),
        _ => "wishlist".to_owned(),
    }
}

fn main() -> anyhow::Result<()> {
    let mut args = std::env::args().skip(1);
    let (Some(csv_path), Some(catalog_dir)) = (args.next(), args.next()) else {
        eprintln!("usage: import_catalog <csv-path> <catalog-dir>");
        std::process::exit(2);
    };
    let catalog_dir = PathBuf::from(catalog_dir);
    std::fs::create_dir_all(&catalog_dir)?;

    let mut reader = csv::Reader::from_path(&csv_path)?;
    let headers = reader.headers()?.clone();
    let col = |name: &str| headers.iter().position(|h| h.eq_ignore_ascii_case(name));
    let (c_title, c_author) = (col("Book Title"), col("Author"));
    let (c_released, c_type, c_topics) = (col("Date Releases"), col("Types"), col("Topic Category"));
    let (c_rec, c_rating, c_status) = (col("Recommendation"), col("Rating"), col("Status"));
    let (c_input, c_lattice) = (col("Date Input"), col("Latticework"));

    let (mut created, mut existing, mut dupes, mut empty) = (0u32, 0u32, 0u32, 0u32);
    let mut seen: HashSet<String> = HashSet::new();

    for record in reader.records() {
        let record = record?;
        let Some(title) = field(&record, c_title) else {
            empty += 1;
            continue;
        };
        let author = field(&record, c_author);

        let key = catalog::normalize_key(&title, author.as_deref());
        if !seen.insert(key) {
            dupes += 1;
            continue;
        }

        let entry = CatalogEntry {
            title: title.clone(),
            author: author.clone(),
            status: map_status(field(&record, c_status).as_deref()),
            rating: field(&record, c_rating).and_then(|r| r.parse().ok()),
            recommendation: field(&record, c_rec),
            r#type: field(&record, c_type),
            topics: field(&record, c_topics)
                .map(|t| t.split(',').map(|s| s.trim().to_owned()).collect())
                .unwrap_or_default(),
            published: field(&record, c_released),
            added: field(&record, c_input),
            source: Some("library-of-books-sheet/ai-enriching-3.0".to_owned()),
            ..Default::default()
        };
        let body = field(&record, c_lattice).unwrap_or_default();

        let path = catalog_dir.join(catalog::entry_filename(&title, author.as_deref()));
        if path.exists() {
            existing += 1;
            continue;
        }
        std::fs::write(&path, catalog::render(&entry, &body))?;
        created += 1;
    }

    println!(
        "created={created} existing={existing} dupes={dupes} empty_rows={empty} dir={}",
        catalog_dir.display()
    );
    Ok(())
}
