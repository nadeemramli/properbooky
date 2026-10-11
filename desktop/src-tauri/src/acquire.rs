use crate::catalog::{self, CatalogEntry};
use crate::{identity, matcher};
use anyhow::{bail, Context, Result};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::io::{ErrorKind, Read, Seek, SeekFrom};
use std::path::{Component, Path, PathBuf};
use walkdir::WalkDir;

pub const DROP_DIR: &str = "Drop";
/// Where arrivals are filed. Category folders are a separate, undecided
/// product choice (PBK-21 D-B); this stays the 2026-07-13 inbox shelf.
const INBOX: &str = "Library/00 Inbox";
/// One intent record per filing in progress (`<uuid>.json`). Written before a
/// file leaves Drop and removed once its catalog entry is written, so a crash
/// in between is finished (or undone) by the next run instead of orphaning
/// the file. Inside `.properbooky`, so the index never lists it.
const INTENT_DIR: &str = ".properbooky/acquisition/drop";
/// Copies published by the no-hard-link fallback; hidden from the index and
/// removed by the next run if a crash leaves one behind.
const TEMP_PREFIX: &str = ".properbooky-drop-";

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
    if status == "queued" { entry.up_next = Some(true); entry.want_to_read = Some(true); }
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
    /// filed | recovered | returned | pending | error | left-unmatched |
    /// left-ambiguous | left-conflict | left-unsafe | left-incomplete
    pub result: String,
    pub title: Option<String>,
    pub destination: Option<String>,
    /// Why the file was not filed (or what still has to happen).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Serialize, Default)]
pub struct DropReport {
    /// Files filed by this run, including interrupted filings it finished.
    pub filed: u32,
    /// Everything else: still in Drop, waiting for a retry, or failed.
    pub left: u32,
    pub outcomes: Vec<DropOutcome>,
}

impl DropReport {
    fn push(&mut self, outcome: DropOutcome) {
        if matches!(outcome.result.as_str(), "filed" | "recovered") {
            self.filed += 1;
        } else {
            self.left += 1;
        }
        self.outcomes.push(outcome);
    }
}

fn outcome(filename: &str, result: &str, reason: impl Into<Option<String>>) -> DropOutcome {
    DropOutcome {
        filename: filename.to_owned(),
        result: result.to_owned(),
        title: None,
        destination: None,
        reason: reason.into(),
    }
}

/// Points between taking a file from Drop and recording it in the catalog,
/// reported to [`process_drop_observed`]'s observer (tests use it to inject a
/// crash or a failed write at each one).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Step {
    /// The intent record is durable; the file has not moved yet.
    IntentWritten,
    /// The file has its new name too (hard link); Drop still has it.
    Linked,
    /// The file is only under its new name; the catalog is not written yet.
    Published,
    /// The catalog entry links the file; the intent record still exists.
    CatalogWritten,
}

#[derive(Serialize, Deserialize)]
struct Intent {
    version: u32,
    /// Library-relative paths, `/`-separated.
    source: String,
    target: String,
    catalog: String,
    hash: String,
    original_filename: String,
}

/// Process everything in `<library>/Drop/`: match against the catalog,
/// rename to `Author - Title.ext`, move into the inbox shelf, link + hash +
/// flip status. Ambiguous, unmatched, unsafe or incomplete files stay in Drop
/// untouched; each file gets its own outcome and one file's failure never
/// stops the others.
pub fn process_drop(conn: &Connection, root: &Path) -> Result<DropReport> {
    process_drop_observed(conn, root, &|_, _| Ok(()))
}

/// [`process_drop`] with an observer called at each [`Step`] with the dropped
/// file's name. An observer error is handled like a failed write at that
/// point; production passes a no-op.
#[doc(hidden)]
pub fn process_drop_observed(
    conn: &Connection,
    root: &Path,
    observe: &dyn Fn(Step, &str) -> Result<()>,
) -> Result<DropReport> {
    // Refuse the whole run, before anything moves, when a folder it reads or
    // writes is a link or leads outside the library.
    let drop_dir = confined_dir(root, DROP_DIR, true)?;
    let catalog_dir = confined_dir(root, "Catalog", false)?;
    confined_dir(root, INBOX, false)?;

    let mut report = DropReport::default();
    // Profiles with an unfinished filing must not receive another file.
    let mut taken: HashSet<PathBuf> = recover(conn, root, &mut report)?;

    // Candidates: catalog entries without a file yet (unchanged matching
    // semantics); entries with files are excluded so duplicates in Drop
    // don't steal links.
    let mut candidates = Vec::new();
    let mut entries: Vec<(PathBuf, CatalogEntry)> = Vec::new();
    for entry in WalkDir::new(&catalog_dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter(|e| e.path().extension().is_some_and(|x| x == "md"))
    {
        let Ok(content) = fs::read_to_string(entry.path()) else {
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

    let mut files: Vec<PathBuf> = fs::read_dir(&drop_dir)?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.extension()
                .and_then(|x| x.to_str())
                .map(|x| x.to_ascii_lowercase())
                .is_some_and(|x| x == "epub" || x == "pdf")
        })
        .collect();
    files.sort();

    for file in files {
        let filename = file
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let result = file_one(
            conn,
            root,
            &file,
            &filename,
            &candidates,
            &entries,
            &mut taken,
            observe,
        );
        report.push(result.unwrap_or_else(|e| {
            outcome(
                &filename,
                "error",
                format!("{e:#}; the file was left in Drop"),
            )
        }));
    }

    Ok(report)
}

#[allow(clippy::too_many_arguments)]
fn file_one(
    conn: &Connection,
    root: &Path,
    file: &Path,
    filename: &str,
    candidates: &[matcher::CatalogCandidate],
    entries: &[(PathBuf, CatalogEntry)],
    taken: &mut HashSet<PathBuf>,
    observe: &dyn Fn(Step, &str) -> Result<()>,
) -> Result<DropOutcome> {
    // Only real files: a link could point anywhere, outside the library too.
    let meta = fs::symlink_metadata(file)?;
    if meta.file_type().is_symlink() {
        return Ok(outcome(
            filename,
            "left-unsafe",
            "it is a link to another file; only real files are filed".to_owned(),
        ));
    }
    if !meta.file_type().is_file() {
        return Ok(outcome(
            filename,
            "left-unsafe",
            "it is not a regular file".to_owned(),
        ));
    }

    let Some(row) = matcher::match_file(file, candidates) else {
        return Ok(outcome(filename, "left-unmatched", None));
    };
    if row.decision != matcher::Decision::Auto {
        let result = if row.decision == matcher::Decision::Review {
            "left-ambiguous"
        } else {
            "left-unmatched"
        };
        return Ok(outcome(filename, result, None));
    }
    let entry = entries
        .iter()
        .find(|(p, _)| *p == row.catalog_path)
        .map(|(_, e)| e)
        .context("matched catalog entry disappeared")?;
    let mut done = outcome(filename, "", None);
    done.title = Some(entry.title.clone());
    if taken.contains(&row.catalog_path) {
        done.result = "left-conflict".into();
        done.reason =
            Some("its book already received a file in this run or has a filing to finish".into());
        return Ok(done);
    }

    let ext = file
        .extension()
        .map(|x| x.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if let Some(why) = incomplete(file, &ext)? {
        done.result = "left-incomplete".into();
        done.reason = Some(why.into());
        return Ok(done);
    }
    // Hash, and refuse a file that changes meanwhile (still being written).
    let hash = matcher::sha256_file(file)?;
    let after = fs::symlink_metadata(file)?;
    if after.len() != meta.len() || after.modified().ok() != meta.modified().ok() {
        done.result = "left-incomplete".into();
        done.reason =
            Some("the file changed while it was read; it may still be downloading".into());
        return Ok(done);
    }

    // Name: the usual "Author - Title" made safe as one plain file name.
    let stem = crate::catalog_import::import_filename(
        &entry.title,
        entry.author.as_deref().unwrap_or(""),
        1,
    );
    let name = format!("{}.{ext}", stem.strip_suffix(".md").unwrap_or(&stem));
    let inbox = confined_dir(root, INBOX, true)?;
    let target = inbox.join(&name);
    let target_rel = identity::relative(root, &target)?;
    done.destination = Some(target_rel.clone());
    if fs::symlink_metadata(&target).is_ok() {
        done.result = "left-conflict".into();
        done.reason = Some(format!(
            "{target_rel} already exists; nothing was overwritten"
        ));
        return Ok(done);
    }

    let intent = Intent {
        version: 1,
        source: library_relative(root, file)?,
        target: target_rel.clone(),
        catalog: library_relative(root, &row.catalog_path)?,
        hash: hash.clone(),
        original_filename: filename.to_owned(),
    };
    let record = root
        .join(INTENT_DIR)
        .join(format!("{}.json", uuid::Uuid::new_v4()));
    identity::atomic_write(&record, &serde_json::to_vec_pretty(&intent)?)?;
    if let Err(e) = observe(Step::IntentWritten, filename) {
        let _ = fs::remove_file(&record);
        return Err(e);
    }

    let keep_pending = |done: &mut DropOutcome, why: String| {
        done.result = "pending".into();
        done.reason = Some(format!(
            "{why}; the next Process Drop folder finishes filing it"
        ));
    };
    match publish(file, &target, &hash, &|| observe(Step::Linked, filename)) {
        Ok(()) => {}
        Err(Publish::Exists) => {
            let _ = fs::remove_file(&record);
            done.result = "left-conflict".into();
            done.reason = Some(format!(
                "{target_rel} already exists; nothing was overwritten"
            ));
            return Ok(done);
        }
        Err(Publish::NotPublished(e)) => {
            let _ = fs::remove_file(&record);
            return Err(e);
        }
        Err(Publish::Partial(e)) => {
            keep_pending(&mut done, format!("{e:#}"));
            taken.insert(row.catalog_path.clone());
            return Ok(done);
        }
    }
    taken.insert(row.catalog_path.clone());
    // The bytes under the new name must be the bytes that were checked.
    if matcher::sha256_file(&target).ok().as_deref() != Some(hash.as_str()) {
        return Ok(match publish(&target, file, &hash, &|| Ok(())) {
            Ok(()) => {
                let _ = fs::remove_file(&record);
                done.result = "left-incomplete".into();
                done.reason =
                    Some("the file changed while it was filed; it is back in Drop".into());
                done.destination = None;
                done
            }
            Err(_) => {
                keep_pending(&mut done, "the file changed while it was filed".into());
                done
            }
        });
    }
    if let Err(e) = observe(Step::Published, filename)
        .and_then(|()| link_entry(conn, root, &row.catalog_path, &target, &hash, filename))
    {
        keep_pending(
            &mut done,
            format!("the catalog could not be updated ({e:#})"),
        );
        return Ok(done);
    }
    done.result = "filed".into();
    if observe(Step::CatalogWritten, filename).is_err() || fs::remove_file(&record).is_err() {
        done.reason = Some("its intent record is cleared by the next run".into());
    }
    Ok(done)
}

/// Link + hash + status in the catalog entry (the source of truth), then the
/// index row. Never replaces a link the entry already has.
fn link_entry(
    conn: &Connection,
    root: &Path,
    md: &Path,
    target: &Path,
    hash: &str,
    original: &str,
) -> Result<()> {
    let content = fs::read_to_string(md)?;
    let (mut parsed, body) =
        catalog::parse(&content).context("the book's catalog entry is no longer readable")?;
    if parsed.file.is_some() {
        bail!("the book's catalog entry already links another file");
    }
    parsed.file = Some(identity::relative(root, target)?);
    parsed.hash = Some(hash.to_owned());
    parsed.original_filename = Some(original.to_owned());
    if matches!(parsed.status.as_str(), "wishlist" | "queued") {
        parsed.up_next = Some(parsed.up_next.unwrap_or(parsed.status == "queued"));
        parsed.want_to_read = Some(parsed.want_to_read.unwrap_or(true));
        parsed.status = "available".to_owned();
    }
    identity::atomic_write(md, catalog::render(&parsed, &body).as_bytes())?;
    conn.execute(
        "UPDATE books SET status = ?1, file_link = ?2 WHERE path = ?3",
        (
            &parsed.status,
            target.to_string_lossy(),
            md.to_string_lossy(),
        ),
    )?;
    Ok(())
}

enum Publish {
    /// The destination exists; nothing changed.
    Exists,
    /// Nothing was published; the source is untouched.
    NotPublished(anyhow::Error),
    /// The destination exists and the source may too; the intent record
    /// lets the next run finish.
    Partial(anyhow::Error),
}

/// Give `src` the name `dst` without ever replacing an existing `dst`
/// (`std::fs::rename` replaces on Unix and Windows). A hard link is created
/// atomically or not at all; where links are unavailable (another volume,
/// FAT/exFAT) a verified copy is published with no-clobber instead.
fn publish(
    src: &Path,
    dst: &Path,
    hash: &str,
    linked: &dyn Fn() -> Result<()>,
) -> Result<(), Publish> {
    match fs::hard_link(src, dst) {
        Ok(()) => {
            linked().map_err(Publish::Partial)?;
            fs::remove_file(src).map_err(|e| Publish::Partial(e.into()))
        }
        Err(e) if e.kind() == ErrorKind::AlreadyExists => Err(Publish::Exists),
        Err(_) => {
            let copy = || -> Result<tempfile::NamedTempFile> {
                let dir = dst.parent().context("destination has no folder")?;
                let mut tmp = tempfile::Builder::new()
                    .prefix(TEMP_PREFIX)
                    .tempfile_in(dir)?;
                std::io::copy(&mut fs::File::open(src)?, &mut tmp)?;
                tmp.as_file().sync_all()?;
                if matcher::sha256_file(tmp.path())? != hash {
                    bail!("the file changed while it was copied");
                }
                Ok(tmp)
            };
            let tmp = copy().map_err(Publish::NotPublished)?;
            match tmp.persist_noclobber(dst) {
                Ok(_) => {}
                Err(e) if e.error.kind() == ErrorKind::AlreadyExists => {
                    return Err(Publish::Exists)
                }
                Err(e) => return Err(Publish::NotPublished(e.error.into())),
            }
            linked().map_err(Publish::Partial)?;
            fs::remove_file(src).map_err(|e| Publish::Partial(e.into()))
        }
    }
}

/// `path` relative to `root`, `/`-separated. Unlike `identity::relative`
/// this accepts names `safe_join` refuses but the filesystem allows (a `:`
/// on Linux/macOS), so such downloads are still filed.
fn library_relative(root: &Path, path: &Path) -> Result<String> {
    let rel = path
        .strip_prefix(root)
        .context("path is outside the library")?;
    let mut parts = Vec::new();
    for part in rel.components() {
        let Component::Normal(part) = part else {
            bail!("{} is not a plain library path", rel.display());
        };
        parts.push(part.to_string_lossy().into_owned());
    }
    Ok(parts.join("/"))
}

/// The inverse of [`library_relative`] for a path read back from an intent
/// record: every `/`-separated part must be one plain name (no `..`, root,
/// drive or nested separator), so the result stays inside the library.
fn library_join(root: &Path, rel: &str) -> Result<PathBuf> {
    let mut path = root.to_path_buf();
    for part in rel.split('/') {
        let mut components = Path::new(part).components();
        match (components.next(), components.next()) {
            (Some(Component::Normal(name)), None) if name == part => path.push(part),
            _ => bail!("{rel} is outside the library"),
        }
    }
    Ok(path)
}

/// `None` when the file looks complete; otherwise why it is not filed yet.
/// Structural end markers catch a download still in progress: a PDF ends
/// with `%%EOF` (within its last 1024 bytes), an EPUB is a zip whose
/// end-of-central-directory record is written last.
fn incomplete(path: &Path, ext: &str) -> Result<Option<&'static str>> {
    let mut file = fs::File::open(path)?;
    let len = file.metadata()?.len();
    if len == 0 {
        return Ok(Some("the file is empty"));
    }
    let mut head = [0u8; 5];
    let n = file.read(&mut head)?;
    let head = &head[..n];
    let (magic, end, window, not, partial): (&[u8], &[u8], u64, _, _) = match ext {
        "pdf" => (
            b"%PDF-",
            b"%%EOF",
            1024,
            "it is not a PDF (no %PDF- header)",
            "the PDF has no end marker yet; it may still be downloading",
        ),
        "epub" => (
            b"PK\x03\x04",
            b"PK\x05\x06",
            65_557,
            "it is not an EPUB (no zip header)",
            "the EPUB's zip directory is missing; it may still be downloading",
        ),
        _ => return Ok(None),
    };
    if !head.starts_with(magic) {
        return Ok(Some(not));
    }
    let window = window.min(len);
    file.seek(SeekFrom::Start(len - window))?;
    let mut tail = Vec::with_capacity(window as usize);
    file.take(window).read_to_end(&mut tail)?;
    if !tail.windows(end.len()).any(|w| w == end) {
        return Ok(Some(partial));
    }
    Ok(None)
}

/// `root/relative` when every existing component is a real folder (not a
/// link) inside the library; `create` makes the missing ones.
fn confined_dir(root: &Path, relative: &str, create: bool) -> Result<PathBuf> {
    let mut path = root.to_path_buf();
    for part in Path::new(relative).components() {
        let Component::Normal(part) = part else {
            bail!("{relative} is not a library folder");
        };
        path.push(part);
        match fs::symlink_metadata(&path) {
            Ok(meta) if meta.file_type().is_symlink() => bail!(
                "{} is a link to another folder; Process Drop folder only reads and writes inside the library, so nothing was moved",
                path.display()
            ),
            Ok(meta) if !meta.is_dir() => bail!("{} is not a folder; nothing was moved", path.display()),
            Ok(_) => {}
            Err(e) if e.kind() == ErrorKind::NotFound && create => fs::create_dir(&path)
                .or_else(|e| if e.kind() == ErrorKind::AlreadyExists { Ok(()) } else { Err(e) })
                .with_context(|| format!("cannot create {}", path.display()))?,
            Err(e) if e.kind() == ErrorKind::NotFound => return Ok(root.join(relative)),
            Err(e) => return Err(e).with_context(|| format!("cannot read {}", path.display())),
        }
    }
    let real_root = root.canonicalize()?;
    if !path.canonicalize()?.starts_with(&real_root) {
        bail!(
            "{} resolves outside the library; nothing was moved",
            path.display()
        );
    }
    Ok(path)
}

/// Finish or undo filings an earlier run left half-done (a crash or a failed
/// write between the move and the catalog entry). Returns the catalog entries
/// whose filing still cannot be finished, so no other file is linked to them.
fn recover(conn: &Connection, root: &Path, report: &mut DropReport) -> Result<HashSet<PathBuf>> {
    let mut unresolved = HashSet::new();
    let inbox = root.join(INBOX);
    if let Ok(dir) = fs::read_dir(&inbox) {
        for e in dir.filter_map(|e| e.ok()) {
            let leftover = e.file_name().to_string_lossy().starts_with(TEMP_PREFIX)
                && e.file_type().is_ok_and(|t| t.is_file());
            if leftover {
                let _ = fs::remove_file(e.path());
            }
        }
    }
    let dir = root.join(INTENT_DIR);
    let mut records: Vec<PathBuf> = match fs::read_dir(&dir) {
        Ok(d) => d
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.extension().is_some_and(|x| x == "json"))
            .collect(),
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(unresolved),
        Err(e) => return Err(e).context("cannot read the Drop intent records"),
    };
    records.sort();
    for record in records {
        match recover_one(conn, root, &record) {
            Ok(Some(done)) => report.push(done),
            Ok(None) => {}
            Err((name, catalog, e)) => {
                if let Some(catalog) = catalog {
                    unresolved.insert(catalog);
                }
                report.push(outcome(
                    &name,
                    "error",
                    format!(
                        "an interrupted filing cannot be finished: {e:#} (record {})",
                        record.file_name().unwrap_or_default().to_string_lossy()
                    ),
                ));
            }
        }
    }
    Ok(unresolved)
}

type Unfinished = (String, Option<PathBuf>, anyhow::Error);

fn recover_one(
    conn: &Connection,
    root: &Path,
    record: &Path,
) -> Result<Option<DropOutcome>, Unfinished> {
    let label = record
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let intent: Intent = fs::read(record)
        .map_err(anyhow::Error::from)
        .and_then(|b| serde_json::from_slice(&b).map_err(anyhow::Error::from))
        .map_err(|e| (label.clone(), None, e.context("unreadable record")))?;
    let name = intent.original_filename.clone();
    let fail = |catalog: Option<PathBuf>, e: anyhow::Error| (name.clone(), catalog, e);
    // A record may only describe Drop -> inbox for one catalog entry.
    let within = |rel: &str, folder: &str| -> Result<PathBuf> {
        let path = library_join(root, rel)?;
        if !rel.starts_with(&format!("{folder}/")) {
            bail!("{rel} is outside {folder}");
        }
        Ok(path)
    };
    let plain_name = Path::new(&name)
        .file_name()
        .is_some_and(|n| n.to_string_lossy() == name);
    let (src, dst, md) = match (
        within(&intent.source, DROP_DIR),
        within(&intent.target, INBOX),
        within(&intent.catalog, "Catalog"),
    ) {
        (Ok(s), Ok(d), Ok(m)) if plain_name => (s, d, m),
        (s, d, m) => {
            let e = s
                .err()
                .or(d.err())
                .or(m.err())
                .unwrap_or_else(|| anyhow::anyhow!("{name} is not a plain file name"));
            return Err(fail(None, e));
        }
    };
    let holds = |p: &Path| {
        fs::symlink_metadata(p).is_ok_and(|m| m.file_type().is_file())
            && matcher::sha256_file(p).ok().as_deref() == Some(intent.hash.as_str())
    };
    let entry = fs::read_to_string(&md)
        .ok()
        .and_then(|c| catalog::parse(&c))
        .map(|(e, _)| e);
    let linked_here = entry.as_ref().is_some_and(|e| {
        e.file.as_deref().map(|f| f.replace('\\', "/")) == Some(intent.target.clone())
    });
    let mut done = outcome(&name, "", None);
    done.title = entry.as_ref().map(|e| e.title.clone());

    if linked_here {
        // The catalog was written; only the record was left.
        fs::remove_file(record).map_err(|e| fail(Some(md.clone()), e.into()))?;
        return Ok(None);
    }
    let (src_ok, dst_ok) = (holds(&src), holds(&dst));
    if !dst_ok {
        if src_ok && fs::symlink_metadata(&dst).is_err() {
            // Nothing was published; the file is processed again from Drop.
            fs::remove_file(record).map_err(|e| fail(None, e.into()))?;
            return Ok(None);
        }
        return Err(fail(
            Some(md),
            anyhow::anyhow!("{} no longer holds the recorded file and Drop does not either; nothing was changed", intent.target),
        ));
    }
    if entry.as_ref().is_some_and(|e| e.file.is_none()) {
        // Roll forward: the same bytes may still have their Drop name too.
        if src_ok {
            fs::remove_file(&src).map_err(|e| fail(Some(md.clone()), e.into()))?;
        }
        link_entry(conn, root, &md, &dst, &intent.hash, &name)
            .map_err(|e| fail(Some(md.clone()), e))?;
        fs::remove_file(record).map_err(|e| fail(Some(md.clone()), e.into()))?;
        done.result = "recovered".into();
        done.destination = Some(intent.target.clone());
        done.reason = Some("an interrupted filing was finished".into());
        return Ok(Some(done));
    }
    // The entry now links something else or is gone: return the file to Drop
    // under its original name, never replacing anything there.
    if src_ok {
        fs::remove_file(&dst).map_err(|e| fail(Some(md.clone()), e.into()))?;
    } else {
        publish(&dst, &src, &intent.hash, &|| Ok(())).map_err(|e| {
            let e = match e {
                Publish::Exists => anyhow::anyhow!("{} is taken in Drop", intent.source),
                Publish::NotPublished(e) | Publish::Partial(e) => e,
            };
            fail(Some(md.clone()), e)
        })?;
    }
    fs::remove_file(record).map_err(|e| fail(None, e.into()))?;
    done.result = "returned".into();
    done.reason = Some(
        "its book was linked to another file meanwhile; it is back in Drop under its original name"
            .into(),
    );
    Ok(Some(done))
}
