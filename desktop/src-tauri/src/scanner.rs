use crate::catalog;
use anyhow::Result;
use rusqlite::Connection;
use serde::Serialize;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use walkdir::WalkDir;

const SUPPORTED_EXTENSIONS: [&str; 3] = ["epub", "pdf", "md"];

#[derive(Serialize)]
pub struct ScanResult {
    pub indexed: usize,
    pub skipped: usize,
}

/// Rebuild the index from the library folder. The folder is the source of
/// truth: existing rows are dropped so a rescan always converges on disk state.
pub fn scan_library(conn: &Connection, root: &Path) -> Result<ScanResult> {
    conn.execute("DELETE FROM books", [])?;

    let now = unix_now();
    let mut indexed = 0usize;
    let mut skipped = 0usize;

    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            // Skip dot-directories (.properbooky state, .obsidian, …).
            e.depth() == 0
                || !e
                    .file_name()
                    .to_string_lossy()
                    .starts_with('.')
        })
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        let path = entry.path();
        let Some(ext) = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase())
        else {
            continue;
        };
        if !SUPPORTED_EXTENSIONS.contains(&ext.as_str()) {
            continue;
        }

        let Ok(meta) = entry.metadata() else {
            skipped += 1;
            continue;
        };
        let filename = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();

        // Markdown splits three ways: article frontmatter (source_url) is a
        // captured web asset; catalog frontmatter is a book profile; plain
        // markdown is an ordinary library file.
        let md_content = (ext == "md")
            .then(|| std::fs::read_to_string(path).ok())
            .flatten();
        if let Some(content) = &md_content {
            if let Some((article_meta, _)) = crate::article::parse(content) {
                let modified_at = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_secs() as i64)
                    .unwrap_or(0);
                conn.execute(
                    "INSERT OR REPLACE INTO books
                     (path, filename, title, author, category, kind, status, rating, recommended, file_link, cover, year, format, size_bytes, modified_at, indexed_at)
                     VALUES (?1, ?2, ?3, ?4, 'Articles', 'article', 'available', NULL, 0, ?1, NULL, NULL, 'article', ?5, ?6, ?7)",
                    (
                        path.to_string_lossy(),
                        &filename,
                        &article_meta.title,
                        &article_meta.author,
                        meta.len() as i64,
                        modified_at,
                        now,
                    ),
                )?;
                indexed += 1;
                continue;
            }
        }
        let catalog_entry = md_content
            .as_deref()
            .and_then(|content| catalog::parse(content).map(|(entry, _)| entry));

        let (title, author, category, kind, status, rating, recommended, file_link, cover, year) =
            match &catalog_entry {
            Some(entry) => (
                entry.title.clone(),
                entry.author.clone(),
                (!entry.topics.is_empty()).then(|| entry.topics.join(", ")),
                "catalog",
                Some(entry.status.clone()),
                entry.rating,
                entry.recommendation.is_some(),
                entry
                    .file
                    .as_ref()
                    .map(|rel| root.join(rel).to_string_lossy().into_owned()),
                entry
                    .cover
                    .as_ref()
                    .map(|rel| root.join(rel).to_string_lossy().into_owned()),
                entry.year,
            ),
            None => {
                let (title, author) = extract_metadata(path, &ext, &filename);
                // The immediate parent folder is the book's shelf/category
                // (e.g. "Library/05 Trading & Markets/x.pdf" → "05 Trading & Markets").
                let category = path
                    .strip_prefix(root)
                    .ok()
                    .and_then(|rel| rel.parent())
                    .and_then(|parent| parent.file_name())
                    .map(|c| c.to_string_lossy().into_owned());
                (title, author, category, "file", None, None, false, None, None, None)
            }
        };
        let modified_at = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        conn.execute(
            "INSERT OR REPLACE INTO books
             (path, filename, title, author, category, kind, status, rating, recommended, file_link, cover, year, format, size_bytes, modified_at, indexed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
            (
                path.to_string_lossy(),
                &filename,
                &title,
                &author,
                &category,
                kind,
                &status,
                rating,
                recommended,
                &file_link,
                &cover,
                year,
                &ext,
                meta.len() as i64,
                modified_at,
                now,
            ),
        )?;
        indexed += 1;
    }

    Ok(ScanResult { indexed, skipped })
}

pub fn extract_metadata(path: &Path, ext: &str, filename: &str) -> (String, Option<String>) {
    if ext == "epub" {
        if let Ok(doc) = epub::doc::EpubDoc::new(path) {
            let mdata_value = |property: &str| {
                doc.mdata(property)
                    .map(|item| item.value.trim().to_owned())
                    .filter(|value| !value.is_empty())
            };
            let author = mdata_value("creator");
            if let Some(title) = mdata_value("title") {
                return (title, author);
            }
            return (title_from_filename(filename), author);
        }
    }
    (title_from_filename(filename), None)
}

/// "the-pragmatic_programmer.2nd.pdf" -> "the pragmatic programmer 2nd"
fn title_from_filename(filename: &str) -> String {
    let stem = filename
        .rsplit_once('.')
        .map(|(stem, _)| stem)
        .unwrap_or(filename);
    stem.replace(['_', '-', '.'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}
