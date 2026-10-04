//! Import the "Library of Books" sheet CSV export into `Catalog/*.md` book
//! profiles (PBK-19).
//!
//! The import only ever adds files. A row whose book already has a profile in
//! the catalog folder leaves that file exactly as it is, even when the row
//! changed since (the profile may hold the owner's edits); the report names
//! every row that was not imported and why. The whole CSV is read before
//! anything is written, so a file that cannot be imported writes nothing.

use crate::catalog::{self, CatalogEntry};
use anyhow::{bail, Context, Result};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::{ErrorKind, Write};
use std::path::{Component, Path, PathBuf};
use walkdir::WalkDir;

/// Provenance recorded in every imported profile.
pub const SOURCE: &str = "library-of-books-sheet/ai-enriching-3.0";
/// Unpublished files of an interrupted import. The leading dot keeps them out
/// of the library index; the next import removes them.
const TEMP_PREFIX: &str = ".properbooky-import-";
/// Bound on a generated file name in bytes (most filesystems allow 255).
const MAX_NAME_BYTES: usize = 200;

const TITLE: &str = "Book Title";
const AUTHOR: &str = "Author";
const COLUMNS: [&str; 10] = [
    TITLE,
    AUTHOR,
    "Date Releases",
    "Types",
    "Topic Category",
    "Recommendation",
    "Rating",
    "Status",
    "Date Input",
    "Latticework",
];

#[derive(Serialize, Debug, Default)]
pub struct Report {
    pub dry_run: bool,
    /// Data rows read (the header excluded), blank rows included.
    pub rows: usize,
    pub blank_rows: usize,
    /// Files written (or, in a dry run, that would be written).
    pub created: Vec<Created>,
    /// Rows whose book already has a profile; that file was left unchanged.
    pub existing: Vec<Existing>,
    /// Later rows for a book that appears earlier in the same CSV.
    pub duplicates: Vec<Duplicate>,
    /// Imported rows that only resemble another book (punctuation or word
    /// differences); kept separate so a person can review them.
    pub near_duplicates: Vec<NearDuplicate>,
    /// Rows that could not be imported, with the reason.
    pub rejected: Vec<Rejected>,
    /// Sheet status (as written) -> catalog status, with row counts.
    pub statuses: Vec<StatusCount>,
    /// Catalog files that could not be read, so their books are unknown here.
    pub unreadable: Vec<String>,
    /// Leftover files of an interrupted import that were removed.
    pub temp_files_removed: usize,
}

#[derive(Serialize, Debug)]
pub struct Created {
    pub line: u64,
    pub file: String,
    /// The usual "Author - Title.md" name was taken by a different book.
    pub renamed: bool,
}

#[derive(Serialize, Debug)]
pub struct Existing {
    pub line: u64,
    pub file: String,
    /// Fields where the row and the kept file differ (empty: same).
    pub differs: Vec<&'static str>,
}

#[derive(Serialize, Debug)]
pub struct Duplicate {
    pub line: u64,
    pub first_line: u64,
    pub differs: Vec<&'static str>,
}

#[derive(Serialize, Debug)]
pub struct NearDuplicate {
    pub line: u64,
    pub title: String,
    pub author: String,
    pub similar_to: String,
}

#[derive(Serialize, Debug)]
pub struct Rejected {
    pub line: u64,
    pub reason: String,
}

#[derive(Serialize, Debug)]
pub struct StatusCount {
    pub sheet: String,
    pub status: String,
    pub rows: usize,
}

/// Identity of a book for import: title and author each trimmed, inner
/// whitespace collapsed and lowercased. Punctuation, subtitles and name order
/// are kept, so different books never merge (the frontend's `authorKey`).
pub fn identity_key(title: &str, author: &str) -> String {
    let fold = |s: &str| {
        s.split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase()
    };
    format!("{}\u{1f}{}", fold(title), fold(author))
}

/// Sheet status -> catalog status. Exact values only (case and spacing
/// ignored), so "Not downloaded" never reads as downloaded.
pub fn map_status(sheet: &str) -> &'static str {
    match sheet
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
        .as_str()
    {
        "downloaded" => "available",
        "need to read now" => "queued",
        _ => "wishlist",
    }
}

/// The usual `catalog::entry_filename` (so profiles from earlier imports keep
/// their names), made safe as one plain file: no leading dot (hidden from the
/// index), control characters, Windows-reserved names or trailing dots, and
/// at most `MAX_NAME_BYTES`. `n > 1` adds " (n)" for a name taken by another book.
pub fn import_filename(title: &str, author: &str, n: usize) -> String {
    let usual = catalog::entry_filename(title, Some(author));
    let stem = usual.strip_suffix(".md").unwrap_or(&usual);
    let stem: String = stem
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let mut stem = stem
        .trim_start_matches(|c: char| c == '.' || c.is_whitespace())
        .trim_end_matches(|c: char| c == '.' || c.is_whitespace())
        .to_owned();
    if stem.is_empty() {
        stem = "Untitled".to_owned();
    }
    let reserved = stem
        .split('.')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_uppercase();
    if matches!(reserved.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (reserved.len() == 4
            && (reserved.starts_with("COM") || reserved.starts_with("LPT"))
            && reserved.as_bytes()[3].is_ascii_digit())
    {
        stem.insert(0, '_');
    }
    let suffix = if n > 1 {
        format!(" ({n})")
    } else {
        String::new()
    };
    let budget = MAX_NAME_BYTES - suffix.len() - ".md".len();
    if stem.len() > budget {
        let mut end = budget;
        while !stem.is_char_boundary(end) {
            end -= 1;
        }
        stem.truncate(end);
        stem = stem
            .trim_end_matches(|c: char| c == '.' || c.is_whitespace())
            .to_owned();
    }
    format!("{stem}{suffix}.md")
}

/// The library's `Catalog/` folder, refused when it is a link or otherwise
/// resolves outside the library (the import must only write inside it).
pub fn catalog_dir(root: &Path) -> Result<PathBuf> {
    let dir = root.join("Catalog");
    match std::fs::symlink_metadata(&dir) {
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(dir),
        Err(error) => return Err(error).with_context(|| format!("cannot read {}", dir.display())),
        Ok(meta) if meta.file_type().is_symlink() => bail!(
            "{} is a link to another folder; the import only writes inside the library, so nothing was imported",
            dir.display()
        ),
        Ok(_) => {}
    }
    let (real_root, real_dir) = (root.canonicalize()?, dir.canonicalize()?);
    anyhow::ensure!(
        real_dir.starts_with(&real_root) && real_dir != real_root,
        "{} resolves outside the library, so nothing was imported",
        dir.display()
    );
    Ok(dir)
}

/// One valid CSV row as the profile it becomes.
struct Row {
    line: u64,
    key: String,
    loose: String,
    entry: CatalogEntry,
    body: String,
}

fn build_entry(
    record: &csv::StringRecord,
    cols: &HashMap<&'static str, usize>,
) -> std::result::Result<Option<(CatalogEntry, String)>, String> {
    let field = |name: &str| {
        cols.get(name)
            .and_then(|&i| record.get(i))
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(ToOwned::to_owned)
    };
    if record.iter().all(|f| f.trim().is_empty()) {
        return Ok(None);
    }
    let title = field(TITLE).ok_or("the Book Title is blank")?;
    let author = field(AUTHOR).ok_or("the Author is blank")?;
    let rating = match field("Rating") {
        None => None,
        Some(r) => Some(
            r.parse::<i64>()
                .map_err(|_| format!("the Rating \"{r}\" is not a whole number"))?,
        ),
    };
    let sheet_status = field("Status");
    let mut entry = CatalogEntry {
        title,
        author: Some(author),
        status: map_status(sheet_status.as_deref().unwrap_or("")).to_owned(),
        rating,
        recommendation: field("Recommendation"),
        r#type: field("Types"),
        topics: field("Topic Category")
            .map(|t| {
                t.split(',')
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(ToOwned::to_owned)
                    .collect()
            })
            .unwrap_or_default(),
        published: field("Date Releases"),
        added: field("Date Input"),
        source: Some(SOURCE.to_owned()),
        ..Default::default()
    };
    if let Some(sheet) = sheet_status {
        entry
            .extra
            .insert("source_status".to_owned(), serde_yaml::Value::String(sheet));
    }
    Ok(Some((entry, field("Latticework").unwrap_or_default())))
}

/// Fields where a kept profile and the row differ.
fn differences(
    old: &CatalogEntry,
    old_body: &str,
    new: &CatalogEntry,
    new_body: &str,
) -> Vec<&'static str> {
    let mut out = Vec::new();
    let mut check = |name, same: bool| {
        if !same {
            out.push(name);
        }
    };
    check("title", old.title == new.title);
    check("author", old.author == new.author);
    check("status", old.status == new.status);
    check("rating", old.rating == new.rating);
    check("recommendation", old.recommendation == new.recommendation);
    check("type", old.r#type == new.r#type);
    check("topics", old.topics == new.topics);
    check("published", old.published == new.published);
    check("added", old.added == new.added);
    check("latticework", old_body.trim() == new_body.trim());
    out
}

/// Read and validate the whole CSV. File-level problems are errors (nothing is
/// imported); row-level problems are recorded in the report.
fn read_rows(csv_path: &Path, report: &mut Report) -> Result<Vec<Row>> {
    let meta = std::fs::metadata(csv_path)
        .with_context(|| format!("cannot read the CSV file {}", csv_path.display()))?;
    if !meta.is_file() {
        bail!(
            "{} is not a file; choose the exported CSV file",
            csv_path.display()
        );
    }
    let bytes = std::fs::read(csv_path)
        .with_context(|| format!("cannot read the CSV file {}", csv_path.display()))?;
    let mut reader = csv::ReaderBuilder::new()
        .flexible(false)
        .from_reader(bytes.as_slice());
    let headers = reader
        .headers()
        .context("the CSV header row cannot be read (is this a UTF-8 CSV export?)")?
        .clone();
    let mut cols: HashMap<&'static str, usize> = HashMap::new();
    for name in COLUMNS {
        let found: Vec<usize> = headers
            .iter()
            .enumerate()
            .filter(|(_, h)| h.trim().eq_ignore_ascii_case(name))
            .map(|(i, _)| i)
            .collect();
        match found.as_slice() {
            [] => {}
            [i] => {
                cols.insert(name, *i);
            }
            _ => bail!("the column \"{name}\" appears more than once in the CSV header"),
        }
    }
    let missing: Vec<&str> = [TITLE, AUTHOR]
        .into_iter()
        .filter(|c| !cols.contains_key(c))
        .collect();
    if !missing.is_empty() {
        bail!(
            "this CSV has no {} column, so it is not the Library of Books export; nothing was imported",
            missing.iter().map(|c| format!("\"{c}\"")).collect::<Vec<_>>().join(" or ")
        );
    }

    let mut rows = Vec::new();
    // Where the last record starts, and whether it became a row.
    let mut last: Option<(usize, bool)> = None;
    for result in reader.records() {
        report.rows += 1;
        let record = match result {
            Ok(record) => record,
            Err(error) => {
                last = None;
                let line = error.position().map(|p| p.line()).unwrap_or(0);
                let reason = match error.kind() {
                    csv::ErrorKind::UnequalLengths { expected_len, len, .. } => format!(
                        "the row has {len} fields where the header has {expected_len} (a stray comma or quote?)"
                    ),
                    csv::ErrorKind::Utf8 { .. } => "the row is not valid UTF-8 text".to_owned(),
                    _ => format!("the row cannot be read: {error}"),
                };
                report.rejected.push(Rejected { line, reason });
                continue;
            }
        };
        let line = record.position().map(|p| p.line()).unwrap_or(0);
        last = record.position().map(|p| (p.byte() as usize, false));
        match build_entry(&record, &cols) {
            Ok(None) => report.blank_rows += 1,
            Ok(Some((entry, body))) => {
                let author = entry.author.clone().unwrap_or_default();
                rows.push(Row {
                    line,
                    key: identity_key(&entry.title, &author),
                    loose: catalog::normalize_key(&entry.title, Some(&author)),
                    entry,
                    body,
                });
                last = last.map(|(byte, _)| (byte, true));
            }
            Err(reason) => report.rejected.push(Rejected { line, reason }),
        }
    }
    // A file cut off inside a quoted field still parses: the last field just
    // ends early. Its quotes are then unbalanced, so the row is not imported.
    if let Some((byte, true)) = last {
        let quotes = bytes
            .get(byte..)
            .unwrap_or_default()
            .iter()
            .filter(|&&b| b == b'"')
            .count();
        if quotes % 2 == 1 {
            let row = rows.pop().expect("the last record became a row");
            report.rejected.push(Rejected {
                line: row.line,
                reason: "the file ends inside a quoted field, so this row looks cut off (is the export complete?)".to_owned(),
            });
        }
    }
    Ok(rows)
}

struct Known {
    file: String,
    entry: CatalogEntry,
    body: String,
}

/// Import `csv_path` into `catalog_dir` (created when missing). With
/// `dry_run`, report what would happen and write nothing.
pub fn import(csv_path: &Path, catalog_dir: &Path, dry_run: bool) -> Result<Report> {
    let mut report = Report {
        dry_run,
        ..Default::default()
    };
    let rows = read_rows(csv_path, &mut report)?;

    if catalog_dir.exists() && !catalog_dir.is_dir() {
        bail!("{} is not a folder", catalog_dir.display());
    }
    // Profiles already in the catalog folder, by identity; every file name
    // (case-insensitively, for Windows/macOS) is taken.
    let mut known: HashMap<String, Known> = HashMap::new();
    let mut loose_known: HashMap<String, String> = HashMap::new();
    let mut taken: HashSet<String> = HashSet::new();
    let mut leftovers = Vec::new();
    if catalog_dir.is_dir() {
        for entry in WalkDir::new(catalog_dir).follow_links(false) {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if entry.depth() == 1 {
                taken.insert(name.to_lowercase());
                if name.starts_with(TEMP_PREFIX) && entry.file_type().is_file() {
                    leftovers.push(entry.path().to_owned());
                }
            }
            if entry.depth() == 0
                || name.starts_with('.')
                || !entry.file_type().is_file()
                || !name.to_lowercase().ends_with(".md")
            {
                continue;
            }
            let rel = entry
                .path()
                .strip_prefix(catalog_dir)
                .unwrap_or(entry.path())
                .to_string_lossy()
                .into_owned();
            let Ok(content) = std::fs::read_to_string(entry.path()) else {
                report.unreadable.push(rel);
                continue;
            };
            if let Some((parsed, body)) = catalog::parse(&content) {
                let author = parsed.author.clone().unwrap_or_default();
                loose_known
                    .entry(catalog::normalize_key(&parsed.title, Some(&author)))
                    .or_insert_with(|| rel.clone());
                known
                    .entry(identity_key(&parsed.title, &author))
                    .or_insert(Known {
                        file: rel,
                        entry: parsed,
                        body,
                    });
            }
        }
    }

    if !dry_run {
        std::fs::create_dir_all(catalog_dir)
            .with_context(|| format!("cannot create {}", catalog_dir.display()))?;
        for leftover in leftovers {
            std::fs::remove_file(&leftover)
                .with_context(|| format!("cannot remove {}", leftover.display()))?;
            report.temp_files_removed += 1;
        }
    }

    let mut statuses: BTreeMap<String, (String, usize)> = BTreeMap::new();
    let mut seen: HashMap<String, (u64, usize)> = HashMap::new();
    let mut loose_seen: HashMap<String, u64> = HashMap::new();
    let mut planned = Vec::new();
    for (index, row) in rows.iter().enumerate() {
        let sheet = row
            .entry
            .extra
            .get("source_status")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_owned();
        let counted = statuses
            .entry(sheet)
            .or_insert_with(|| (row.entry.status.clone(), 0));
        counted.1 += 1;

        if let Some(&(first_line, first)) = seen.get(&row.key) {
            let first = &rows[first];
            report.duplicates.push(Duplicate {
                line: row.line,
                first_line,
                differs: differences(&first.entry, &first.body, &row.entry, &row.body),
            });
            continue;
        }
        seen.insert(row.key.clone(), (row.line, index));
        if let Some(existing) = known.get(&row.key) {
            report.existing.push(Existing {
                line: row.line,
                file: existing.file.clone(),
                differs: differences(&existing.entry, &existing.body, &row.entry, &row.body),
            });
            continue;
        }
        if let Some(similar) = loose_known.get(&row.loose).cloned().or_else(|| {
            loose_seen
                .get(&row.loose)
                .map(|line| format!("line {line}"))
        }) {
            report.near_duplicates.push(NearDuplicate {
                line: row.line,
                title: row.entry.title.clone(),
                author: row.entry.author.clone().unwrap_or_default(),
                similar_to: similar,
            });
        }
        loose_seen.entry(row.loose.clone()).or_insert(row.line);

        let content = catalog::render(&row.entry, &row.body);
        // Never publish a profile the index would not read back as this row.
        let reads_back = catalog::parse(&content).is_some_and(|(check, body)| {
            identity_key(&check.title, check.author.as_deref().unwrap_or("")) == row.key
                && differences(&check, &body, &row.entry, &row.body).is_empty()
        });
        if !reads_back {
            report.rejected.push(Rejected {
                line: row.line,
                reason:
                    "the profile for this row would not read back exactly, so it was not written"
                        .to_owned(),
            });
            continue;
        }
        planned.push((row, content));
    }
    // Everything is validated before the first write.
    for (row, content) in planned {
        let author = row.entry.author.as_deref().unwrap_or("");
        let file = publish(catalog_dir, &row.entry.title, author, &content, &mut taken, dry_run)
            .with_context(|| {
                format!(
                    "line {}: {} new profiles were created before this error; importing again continues where it stopped",
                    row.line,
                    report.created.len()
                )
            })?;
        report.created.push(Created {
            line: row.line,
            renamed: file != import_filename(&row.entry.title, author, 1),
            file,
        });
    }
    report.statuses = statuses
        .into_iter()
        .map(|(sheet, (status, rows))| StatusCount {
            sheet,
            status,
            rows,
        })
        .collect();
    Ok(report)
}

/// Write `content` under the first free name, never replacing a file: the
/// profile is written to a temporary file and published without clobbering,
/// so it appears complete or not at all.
fn publish(
    dir: &Path,
    title: &str,
    author: &str,
    content: &str,
    taken: &mut HashSet<String>,
    dry_run: bool,
) -> Result<String> {
    let mut temp = None;
    for n in 1..=1000 {
        let name = import_filename(title, author, n);
        let mut parts = Path::new(&name).components();
        anyhow::ensure!(
            matches!(
                (parts.next(), parts.next()),
                (Some(Component::Normal(_)), None)
            ),
            "unsafe file name {name:?}"
        );
        if taken.contains(&name.to_lowercase()) {
            continue;
        }
        if dry_run {
            taken.insert(name.to_lowercase());
            return Ok(name);
        }
        let file = match temp.take() {
            Some(file) => file,
            None => {
                let mut file = tempfile::Builder::new()
                    .prefix(TEMP_PREFIX)
                    .suffix(".tmp")
                    .tempfile_in(dir)
                    .with_context(|| format!("cannot write in {}", dir.display()))?;
                file.write_all(content.as_bytes())?;
                file.as_file().sync_all()?;
                file
            }
        };
        match file.persist_noclobber(dir.join(&name)) {
            Ok(_) => {
                taken.insert(name.to_lowercase());
                return Ok(name);
            }
            Err(error) if error.error.kind() == ErrorKind::AlreadyExists => {
                taken.insert(name.to_lowercase());
                temp = Some(error.file);
            }
            Err(error) => {
                return Err(error.error).with_context(|| format!("cannot create {name}"));
            }
        }
    }
    bail!("no free file name for \"{author} - {title}\"")
}
