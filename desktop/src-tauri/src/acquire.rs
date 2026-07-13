use crate::catalog::{self, CatalogEntry};
use crate::matcher;
use anyhow::Result;
use rusqlite::Connection;
use serde::Serialize;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

pub const DROP_DIR: &str = "Drop";

/// The acquisition-queue ranking (Prioritization Algorithm v2):
/// `0.35·lindy + 0.25·recommendation + 0.25·rating + 0.15·spectrum`,
/// with explicitly queued items always pinned first.
/// - lindy: min(age, 120)/120 from first-publish year; unknown → 0.3
/// - rating: manual 1–5 → /5; unrated → 3/5
/// - spectrum: original 1.0 / novel 0.6 / collection 0.3 / unset 0.5
pub const QUEUE_SQL: &str = "\
    SELECT id, path, filename, title, author, category, kind, status, rating, \
           file_link, format, size_bytes, recommended, cover, year, spectrum, \
           (0.35 * COALESCE(MIN(MAX(CAST(strftime('%Y','now') AS INTEGER) - year, 0), 120) / 120.0, 0.3) \
            + 0.25 * recommended \
            + 0.25 * COALESCE(rating, 3) / 5.0 \
            + 0.15 * CASE spectrum \
                WHEN 'original' THEN 1.0 \
                WHEN 'novel' THEN 0.6 \
                WHEN 'collection' THEN 0.3 \
                ELSE 0.5 END) AS priority \
     FROM books \
     WHERE kind = 'catalog' AND file_link IS NULL \
       AND status IN ('wishlist', 'queued') \
     ORDER BY (status = 'queued') DESC, priority DESC, title COLLATE NOCASE \
     LIMIT ?1";

/// Update a catalog entry's status in its markdown file (the source of
/// truth) and mirror it into the index row.
pub fn set_status(conn: &Connection, md_path: &Path, status: &str) -> Result<()> {
    let content = std::fs::read_to_string(md_path)?;
    let (mut entry, body): (CatalogEntry, String) = catalog::parse(&content)
        .ok_or_else(|| anyhow::anyhow!("unparseable catalog entry: {md_path:?}"))?;
    entry.status = status.to_owned();
    std::fs::write(md_path, catalog::render(&entry, &body))?;
    conn.execute(
        "UPDATE books SET status = ?1 WHERE path = ?2",
        (status, md_path.to_string_lossy()),
    )?;
    Ok(())
}

#[derive(Serialize)]
pub struct DropOutcome {
    pub filename: String,
    pub result: String, // filed | left-unmatched | left-ambiguous | left-conflict
    pub title: Option<String>,
    pub destination: Option<String>,
}

#[derive(Serialize)]
pub struct DropReport {
    pub filed: u32,
    pub left: u32,
    pub outcomes: Vec<DropOutcome>,
}

/// Process everything in `<library>/Drop/`: match against the catalog,
/// rename to `Author - Title.ext`, move into the entry's category folder,
/// link + hash + flip status. Ambiguous or unmatched files stay in Drop.
pub fn process_drop(conn: &Connection, root: &Path) -> Result<DropReport> {
    let drop_dir = root.join(DROP_DIR);
    std::fs::create_dir_all(&drop_dir)?;

    // Candidates: catalog entries without a file yet get matching priority
    // handled by score; entries with files are excluded so duplicates in
    // Drop don't steal links.
    let mut candidates = Vec::new();
    let mut entries: Vec<(PathBuf, CatalogEntry)> = Vec::new();
    for entry in WalkDir::new(root.join("Catalog"))
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter(|e| e.path().extension().is_some_and(|x| x == "md"))
    {
        let Ok(content) = std::fs::read_to_string(entry.path()) else {
            continue;
        };
        if let Some((parsed, _)) = catalog::parse(&content) {
            if parsed.file.is_none() {
                candidates.push(matcher::CatalogCandidate {
                    path: entry.path().to_owned(),
                    title: parsed.title.clone(),
                    author: parsed.author.clone(),
                });
            }
            entries.push((entry.path().to_owned(), parsed));
        }
    }

    let files: Vec<PathBuf> = std::fs::read_dir(&drop_dir)?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.extension()
                .and_then(|x| x.to_str())
                .map(|x| x.to_ascii_lowercase())
                .is_some_and(|x| x == "epub" || x == "pdf")
        })
        .collect();

    let mut report = DropReport {
        filed: 0,
        left: 0,
        outcomes: Vec::new(),
    };

    for file in files {
        let filename = file
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let matched = matcher::match_file(&file, &candidates);
        let Some(row) = matched else {
            report.left += 1;
            report.outcomes.push(DropOutcome {
                filename,
                result: "left-unmatched".into(),
                title: None,
                destination: None,
            });
            continue;
        };
        if row.decision != matcher::Decision::Auto {
            report.left += 1;
            report.outcomes.push(DropOutcome {
                filename,
                result: if row.decision == matcher::Decision::Review {
                    "left-ambiguous".into()
                } else {
                    "left-unmatched".into()
                },
                title: None,
                destination: None,
            });
            continue;
        }

        let entry = entries
            .iter()
            .find(|(p, _)| *p == row.catalog_path)
            .map(|(_, e)| e);
        // New arrivals land in one inbox shelf; the user sorts them into
        // their own taxonomy, and relink-by-hash follows the move.
        let dest_dir = root.join("Library").join("00 Inbox");
        std::fs::create_dir_all(&dest_dir)?;
        let target = dest_dir.join(&row.proposed_name);
        if target.exists() {
            report.left += 1;
            report.outcomes.push(DropOutcome {
                filename,
                result: "left-conflict".into(),
                title: entry.map(|e| e.title.clone()),
                destination: Some(target.to_string_lossy().into_owned()),
            });
            continue;
        }
        std::fs::rename(&file, &target)?;

        // Link + hash + status in the catalog entry (source of truth).
        let content = std::fs::read_to_string(&row.catalog_path)?;
        if let Some((mut parsed, body)) = catalog::parse(&content) {
            let relative = target
                .strip_prefix(root)
                .unwrap_or(&target)
                .to_string_lossy()
                .into_owned();
            parsed.file = Some(relative);
            parsed.hash = Some(matcher::sha256_file(&target)?);
            parsed.original_filename = Some(filename.clone());
            if matches!(parsed.status.as_str(), "wishlist" | "queued") {
                parsed.status = "available".to_owned();
            }
            let status = parsed.status.clone();
            let file_link = target.to_string_lossy().into_owned();
            std::fs::write(&row.catalog_path, catalog::render(&parsed, &body))?;
            conn.execute(
                "UPDATE books SET status = ?1, file_link = ?2 WHERE path = ?3",
                (status, file_link, row.catalog_path.to_string_lossy()),
            )?;
        }

        report.filed += 1;
        report.outcomes.push(DropOutcome {
            filename,
            result: "filed".into(),
            title: entry.map(|e| e.title.clone()),
            destination: Some(
                target
                    .strip_prefix(root)
                    .unwrap_or(&target)
                    .to_string_lossy()
                    .into_owned(),
            ),
        });
    }

    Ok(report)
}

