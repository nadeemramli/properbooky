use crate::identity;
use anyhow::{bail, Context, Result};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap},
    fs,
    path::Path,
};

#[derive(Clone, Default, Serialize)]
pub struct Details {
    pub stable_id: String,
    pub asset_id: Option<String>,
    pub availability: String,
    pub reading_status: String,
    pub want_to_read: bool,
    pub up_next: bool,
    pub content_type: String,
    pub issues: Vec<String>,
    pub duplicate_candidates: Vec<String>,
    pub assets: Vec<crate::consolidation::Asset>,
    pub source_profiles: Vec<crate::consolidation::SourceProfile>,
    pub metadata_source: Option<crate::enrich::Accepted>,
    pub browse_authors: Vec<String>,
    pub browse_topics: Vec<String>,
    /// Fraction read, from the asset's sidecar (the files are the truth).
    pub progress: Option<f64>,
}

#[derive(Clone, Serialize)]
pub struct Book {
    pub id: i64,
    pub path: String,
    pub filename: String,
    pub title: String,
    pub author: Option<String>,
    pub category: Option<String>,
    pub kind: String,
    pub status: Option<String>,
    pub rating: Option<i64>,
    pub file_link: Option<String>,
    pub format: String,
    pub size_bytes: i64,
    pub recommended: bool,
    pub cover: Option<String>,
    pub year: Option<i64>,
    pub spectrum: Option<String>,
    pub priority: Option<f64>,
    #[serde(flatten)]
    pub details: Details,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Edit {
    pub title: String,
    pub author: Option<String>,
    pub category: Option<String>,
    pub content_type: String,
    pub reading_status: String,
    pub want_to_read: bool,
    pub up_next: bool,
}

impl From<&Book> for Edit {
    fn from(b: &Book) -> Self {
        Self {
            title: b.title.clone(),
            author: b.author.clone(),
            category: b.category.clone(),
            content_type: b.details.content_type.clone(),
            reading_status: b.details.reading_status.clone(),
            want_to_read: b.details.want_to_read,
            up_next: b.details.up_next,
        }
    }
}

fn source_edit(book: &Book) -> Edit {
    let mut edit = Edit::from(book);
    if let Some(source) = book
        .details
        .source_profiles
        .iter()
        .find(|s| s.id == book.details.stable_id)
    {
        edit.author = source.author.clone();
        edit.category = source.category.clone();
    }
    edit
}

fn preserve_unchanged_labels(book: &Book, edit: &mut Edit) {
    let raw = source_edit(book);
    if edit.author == book.author {
        edit.author = raw.author;
    }
    if edit.category == book.category {
        edit.category = raw.category;
    }
}

#[derive(Serialize, Deserialize)]
struct MetadataUndo {
    previous: Option<crate::enrich::Accepted>,
}

#[derive(Serialize, Deserialize)]
struct Change {
    id: String,
    before: Option<Edit>,
    #[serde(default)]
    merges_before: Option<BTreeMap<String, String>>,
    #[serde(default)]
    aliases_before: Option<Vec<String>>,
    #[serde(default)]
    organisation_before: Option<crate::organisation::Organisation>,
    #[serde(default)]
    metadata_before: Option<MetadataUndo>,
}

#[derive(Serialize, Deserialize)]
struct Curation {
    version: u32,
    edits: BTreeMap<String, Edit>,
    aliases: BTreeMap<String, Vec<String>>,
    history: Vec<Change>,
    #[serde(default)]
    merges: BTreeMap<String, String>,
    #[serde(default)]
    revision: u64,
    #[serde(default)]
    organisation: crate::organisation::Organisation,
    #[serde(default)]
    metadata: BTreeMap<String, crate::enrich::Accepted>,
}

impl Default for Curation {
    fn default() -> Self {
        Self {
            version: 3,
            edits: BTreeMap::new(),
            aliases: BTreeMap::new(),
            history: Vec::new(),
            merges: BTreeMap::new(),
            revision: 0,
            organisation: Default::default(),
            metadata: BTreeMap::new(),
        }
    }
}

fn load(root: &Path) -> Result<Curation> {
    match fs::read(root.join(".properbooky/curation.json")) {
        Ok(bytes) => {
            let value: Curation =
                serde_json::from_slice(&bytes).context("cannot read saved library corrections")?;
            if ![1, 2, 3].contains(&value.version) {
                bail!("unsupported curation version");
            }
            for id in value.merges.keys() {
                crate::consolidation::resolve(&value.merges, id)?;
            }
            crate::organisation::validate(&value.organisation)?;
            Ok(value)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Curation::default()),
        Err(e) => Err(e.into()),
    }
}

fn apply(conn: &Connection, id: &str, edit: &Edit) -> Result<()> {
    conn.execute("UPDATE books SET title=?1, author=?2, category=?3, content_type=?4, reading_status=?5, want_to_read=?6, up_next=?7 WHERE stable_id=?8 AND (title IS NOT ?1 OR author IS NOT ?2 OR category IS NOT ?3 OR content_type IS NOT ?4 OR reading_status IS NOT ?5 OR want_to_read IS NOT ?6 OR up_next IS NOT ?7)",
        params![edit.title, edit.author, edit.category, edit.content_type, edit.reading_status, edit.want_to_read, edit.up_next, id])?;
    Ok(())
}

pub fn apply_curation(conn: &Connection, root: &Path) -> Result<()> {
    let curation = load(root)?;
    conn.execute_batch("SAVEPOINT apply_curation")?;
    let result: Result<()> = (|| {
        for (id, edit) in curation.edits {
            apply(conn, &id, &edit)?;
        }
        let assignments: Vec<(String, Option<String>)> = conn
            .prepare("SELECT stable_id, merged_into FROM books WHERE stable_id IS NOT NULL")?
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<rusqlite::Result<_>>()?;
        let present: std::collections::HashSet<_> =
            assignments.iter().map(|(id, _)| id.as_str()).collect();
        for (id, current) in &assignments {
            let resolved = crate::consolidation::resolve(&curation.merges, id)?;
            let target = (resolved != id && present.contains(resolved)).then_some(resolved);
            if current.as_deref() != target {
                conn.execute(
                    "UPDATE books SET merged_into=?1 WHERE stable_id=?2",
                    (target, id),
                )?;
            }
        }
        Ok(())
    })();
    if result.is_err() {
        conn.execute_batch("ROLLBACK TO apply_curation")?;
    }
    conn.execute_batch("RELEASE apply_curation")?;
    result
}

fn validate_edit(edit: &mut Edit) -> Result<()> {
    edit.title = edit.title.trim().into();
    edit.author = edit
        .author
        .take()
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty());
    edit.category = edit
        .category
        .take()
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty());
    if edit.title.is_empty() || edit.title.len() > 1000 {
        bail!("enter a title between 1 and 1000 bytes");
    }
    if ![
        "book",
        "paper",
        "report",
        "manual",
        "notes",
        "article",
        "other",
        "unidentified",
    ]
    .contains(&edit.content_type.as_str())
    {
        bail!("invalid content type");
    }
    if !["unread", "reading", "paused", "finished", "stopped"]
        .contains(&edit.reading_status.as_str())
    {
        bail!("invalid reading status");
    }
    Ok(())
}

fn save(root: &Path, mut curation: Curation) -> Result<()> {
    // Older clients must fail visibly instead of silently discarding merges.
    curation.version = 3;
    curation.revision += 1;
    if let Ok(previous) = fs::read(root.join(".properbooky/curation.json")) {
        identity::atomic_write(&root.join(".properbooky/curation.previous.json"), &previous)?;
    }
    identity::atomic_write(
        &root.join(".properbooky/curation.json"),
        &serde_json::to_vec_pretty(&curation)?,
    )
}

pub fn update(conn: &Connection, root: &Path, id: &str, mut edit: Edit) -> Result<()> {
    validate_edit(&mut edit)?;
    let books = list(conn, root, None)?;
    let book = books
        .iter()
        .find(|b| b.details.stable_id == id)
        .context("book is no longer in the library; refresh and try again")?;
    let mut curation = load(root)?;
    let aliases = curation.aliases.entry(id.into()).or_default();
    let old = format!("{} {}", book.title, book.author.as_deref().unwrap_or(""));
    if !aliases.contains(&old) {
        aliases.push(old);
    }
    curation.history.push(Change {
        id: id.into(),
        before: Some(source_edit(book)),
        merges_before: None,
        aliases_before: None,
        organisation_before: None,
        metadata_before: None,
    });
    preserve_unchanged_labels(book, &mut edit);
    curation.edits.insert(id.into(), edit);
    save(root, curation)?;
    apply_curation(conn, root)
}

pub fn undo(conn: &Connection, root: &Path) -> Result<()> {
    let mut curation = load(root)?;
    let change = curation
        .history
        .pop()
        .context("no library correction to undo")?;
    if let Some(aliases) = change.aliases_before {
        curation.aliases.insert(change.id.clone(), aliases);
    }
    if let Some(before) = change.before {
        curation.edits.insert(change.id.clone(), before);
    }
    if let Some(before) = change.organisation_before {
        curation.organisation = before;
    }
    if let Some(before) = change.metadata_before {
        match before.previous {
            Some(previous) => {
                curation.metadata.insert(change.id.clone(), previous);
            }
            None => {
                curation.metadata.remove(&change.id);
            }
        }
    }
    if let Some(merges) = change.merges_before {
        curation.merges = merges;
    }
    save(root, curation)?;
    apply_curation(conn, root)
}

/// Combine visible profiles, never their asset bytes or reading sidecars.
/// The selected editable fields are explicit; other source metadata stays on
/// its original profile. One history entry restores the prior grouping.
pub fn merge(
    conn: &Connection,
    root: &Path,
    keep: &str,
    absorb: &str,
    mut edit: Edit,
) -> Result<()> {
    anyhow::ensure!(keep != absorb, "choose two different profiles");
    validate_edit(&mut edit)?;
    let books = list(conn, root, None)?;
    let primary = books
        .iter()
        .find(|b| b.details.stable_id == keep)
        .context("primary profile changed; refresh before combining")?;
    let secondary = books
        .iter()
        .find(|b| b.details.stable_id == absorb)
        .context("other profile changed; refresh before combining")?;
    let mut curation = load(root)?;
    curation.history.push(Change {
        id: keep.into(),
        before: Some(source_edit(primary)),
        merges_before: Some(curation.merges.clone()),
        aliases_before: Some(curation.aliases.get(keep).cloned().unwrap_or_default()),
        organisation_before: None,
        metadata_before: None,
    });
    let aliases = curation.aliases.entry(keep.into()).or_default();
    for b in [primary, secondary] {
        let alias = format!("{} {}", b.title, b.author.as_deref().unwrap_or(""));
        if !aliases.contains(&alias) {
            aliases.push(alias);
        }
    }
    curation.merges.insert(absorb.into(), keep.into());
    curation.edits.insert(keep.into(), edit);
    save(root, curation)?;
    apply_curation(conn, root)
}

pub fn source_text(root: &Path, id: &str) -> Result<String> {
    let registry = identity::Registry::load(root)?;
    let record = registry
        .records
        .iter()
        .find(|r| r.id == id)
        .context("source profile is unavailable")?;
    anyhow::ensure!(
        record.kind == "catalog" || record.kind == "article",
        "this source is a binary asset"
    );
    use std::io::Read;
    let mut raw = Vec::new();
    fs::File::open(identity::safe_join(root, &record.path)?)?
        .take(100_001)
        .read_to_end(&mut raw)?;
    let truncated = raw.len() > 100_000;
    raw.truncate(100_000);
    Ok(format!(
        "{}{}",
        String::from_utf8_lossy(&raw),
        if truncated {
            "\n[Source preview truncated]"
        } else {
            ""
        }
    ))
}

#[derive(Serialize)]
pub struct OrganisationView {
    pub revision: u64,
    pub value: crate::organisation::Organisation,
}

pub fn organisation(root: &Path) -> Result<OrganisationView> {
    let curation = load(root)?;
    Ok(OrganisationView {
        revision: curation.revision,
        value: curation.organisation,
    })
}

pub fn save_organisation(
    root: &Path,
    revision: u64,
    value: crate::organisation::Organisation,
) -> Result<()> {
    crate::organisation::validate(&value)?;
    let mut curation = load(root)?;
    anyhow::ensure!(
        curation.revision == revision,
        "library changed while you were editing; close and reopen Organize library"
    );
    let registry = identity::Registry::load(root)?;
    for roadmap in &value.roadmaps {
        for step in &roadmap.steps {
            anyhow::ensure!(
                registry.records.iter().any(|r| r.id == step.profile_id),
                "unknown profile in roadmap"
            );
        }
    }
    curation.history.push(Change {
        id: String::new(),
        before: None,
        merges_before: None,
        aliases_before: None,
        organisation_before: Some(curation.organisation.clone()),
        metadata_before: None,
    });
    curation.organisation = value;
    save(root, curation)
}

pub fn accept_metadata(
    conn: &Connection,
    root: &Path,
    id: &str,
    expected: &Edit,
    mut edit: Edit,
    mut accepted: crate::enrich::Accepted,
) -> Result<()> {
    validate_edit(&mut edit)?;
    let books = list(conn, root, None)?;
    let book = books
        .iter()
        .find(|b| b.details.stable_id == id)
        .context("profile changed; reopen its details")?;
    anyhow::ensure!(
        &Edit::from(book) == expected,
        "profile changed while you were reviewing metadata; reopen its details"
    );
    let mut curation = load(root)?;
    // Choosing metadata without a new cover must retain a previously accepted cover.
    if accepted.cover.is_none() {
        accepted.cover = curation.metadata.get(id).and_then(|m| m.cover.clone());
    }
    curation.history.push(Change {
        id: id.into(),
        before: Some(source_edit(book)),
        merges_before: None,
        aliases_before: Some(curation.aliases.get(id).cloned().unwrap_or_default()),
        organisation_before: None,
        metadata_before: Some(MetadataUndo {
            previous: curation.metadata.get(id).cloned(),
        }),
    });
    curation.aliases.entry(id.into()).or_default().push(format!(
        "{} {}",
        book.title,
        book.author.as_deref().unwrap_or("")
    ));
    preserve_unchanged_labels(book, &mut edit);
    curation.edits.insert(id.into(), edit);
    curation.metadata.insert(id.into(), accepted);
    save(root, curation)?;
    apply_curation(conn, root)
}

pub fn export_identities(
    root: &Path,
    registry: &identity::Registry,
    map: &mut HashMap<String, (String, Option<String>)>,
) -> Result<()> {
    let curation = load(root)?;
    // A linked profile's corrections take precedence over old raw-file edits.
    let records = registry
        .records
        .iter()
        .filter(|r| r.kind != "catalog")
        .chain(registry.records.iter().filter(|r| r.kind == "catalog"));
    for record in records {
        if record.kind == "catalog" {
            if let Ok(raw) = fs::read_to_string(root.join(&record.path)) {
                if let Some((entry, _)) = crate::catalog::parse(&raw) {
                    if let Some(file) = entry.file {
                        let relative = file.replace('\\', "/");
                        let exact = registry
                            .at_path(&relative)
                            .filter(|r| root.join(&r.path).is_file());
                        let aliases: Vec<_> = registry
                            .records
                            .iter()
                            .filter(|r| {
                                r.kind != "catalog"
                                    && r.aliases.contains(&relative)
                                    && root.join(&r.path).is_file()
                            })
                            .collect();
                        let actual = exact
                            .or_else(|| (aliases.len() == 1).then(|| aliases[0]))
                            .map(|r| r.path.clone())
                            .unwrap_or(relative);
                        let primary = crate::consolidation::resolve(&curation.merges, &record.id)?;
                        let value = curation
                            .edits
                            .get(primary)
                            .map(|e| (e.title.clone(), e.author.clone()))
                            .unwrap_or((entry.title, entry.author));
                        map.insert(actual, value);
                    }
                }
            }
        } else if let Some(edit) = curation
            .edits
            .get(crate::consolidation::resolve(&curation.merges, &record.id)?)
        {
            map.insert(
                record.path.clone(),
                (edit.title.clone(), edit.author.clone()),
            );
        }
    }
    for (_, author) in map.values_mut() {
        if let Some(name) = author {
            *name = crate::organisation::label(name, &curation.organisation.authors)?;
        }
    }
    Ok(())
}

pub fn list(conn: &Connection, root: &Path, query: Option<&str>) -> Result<Vec<Book>> {
    // Apply the file-backed override after an interrupted index update too.
    apply_curation(conn, root)?;
    let curation = load(root)?;
    let mut stmt = conn.prepare("SELECT id,path,filename,title,author,category,kind,status,rating,file_link,format,size_bytes,recommended,cover,year,spectrum,stable_id,asset_id,reading_status,want_to_read,up_next,content_type FROM books ORDER BY title COLLATE NOCASE")?;
    let mut books: Vec<Book> = stmt
        .query_map([], |r| {
            Ok(Book {
                id: r.get(0)?,
                path: r.get(1)?,
                filename: r.get(2)?,
                title: r.get(3)?,
                author: r.get(4)?,
                category: r.get(5)?,
                kind: r.get(6)?,
                status: r.get(7)?,
                rating: r.get(8)?,
                file_link: r.get(9)?,
                format: r.get(10)?,
                size_bytes: r.get(11)?,
                recommended: r.get(12)?,
                cover: r.get(13)?,
                year: r.get(14)?,
                spectrum: r.get(15)?,
                priority: None,
                details: Details {
                    stable_id: r.get::<_, Option<String>>(16)?.unwrap_or_default(),
                    asset_id: r.get(17)?,
                    reading_status: r.get(18)?,
                    want_to_read: r.get(19)?,
                    up_next: r.get(20)?,
                    content_type: r.get(21)?,
                    ..Default::default()
                },
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    let linked: std::collections::HashSet<_> = books
        .iter()
        .filter(|b| b.kind == "catalog")
        .filter_map(|b| b.details.asset_id.clone())
        .collect();
    books.retain(|b| {
        b.kind != "file"
            || curation.merges.contains_key(&b.details.stable_id)
            || curation
                .merges
                .values()
                .any(|id| id == &b.details.stable_id)
            || !b
                .details
                .asset_id
                .as_ref()
                .is_some_and(|id| linked.contains(id))
    });
    let mut groups: HashMap<String, Vec<String>> = HashMap::new();
    let registry = identity::Registry::load(root)?;
    let hashes: HashMap<_, _> = registry
        .records
        .iter()
        .map(|r| (r.id.as_str(), r.hash.as_str()))
        .collect();
    for book in &books {
        if let Some(asset) = &book.details.asset_id {
            groups
                .entry(format!("asset:{asset}"))
                .or_default()
                .push(book.details.stable_id.clone());
        }
        if let Some(hash) = book
            .details
            .asset_id
            .as_deref()
            .and_then(|id| hashes.get(id))
        {
            groups
                .entry(format!("hash:{hash}"))
                .or_default()
                .push(book.details.stable_id.clone());
        }
        if let Some(author) = &book.author {
            let title = book.title.split(':').next().unwrap_or(&book.title);
            let key = crate::catalog::normalize_key(title, Some(author));
            if !key.is_empty() {
                groups
                    .entry(format!("title:{key}"))
                    .or_default()
                    .push(book.details.stable_id.clone());
            }
        }
    }
    let mut candidates: HashMap<String, Vec<String>> = HashMap::new();
    for group in groups.values().filter(|g| g.len() > 1) {
        for id in group {
            candidates
                .entry(id.clone())
                .or_default()
                .extend(group.iter().filter(|other| *other != id).cloned());
        }
    }
    let state_files: HashMap<_, _> = registry
        .records
        .iter()
        .filter_map(|r| Some((r.id.as_str(), r.state_file.as_deref()?)))
        .collect();
    let state_dir = root.join(".properbooky/state");
    for book in &mut books {
        book.details.progress = book
            .details
            .asset_id
            .as_deref()
            .and_then(|id| state_files.get(id))
            .and_then(|name| crate::annotations::load(&state_dir.join(name)).percent)
            .filter(|p| p.is_finite() && (0.0..=1.0).contains(p));
        if let Some(metadata) = curation.metadata.get(&book.details.stable_id) {
            book.details.metadata_source = Some(metadata.clone());
            if let Some(cover) = &metadata.cover {
                let path = identity::safe_join(root, cover)?;
                if path.is_file() {
                    book.cover = Some(path.to_string_lossy().into_owned());
                }
            }
        }
        let path = if book.kind == "catalog" {
            book.file_link.as_deref()
        } else {
            Some(book.path.as_str())
        };
        let present = path.is_some_and(|p| Path::new(p).is_file());
        book.details.availability = if present {
            "local"
        } else if path.is_some() || book.status.as_deref() == Some("available") {
            "missing"
        } else {
            "none"
        }
        .into();
        if let Some(path) = path {
            book.format = if book.kind == "article" {
                "article".into()
            } else {
                Path::new(path)
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("")
                    .to_lowercase()
            };
        }
        if book.kind == "catalog" && path.is_none() {
            book.format.clear();
        }
        let lower = book.title.to_lowercase();
        if ["pdfdrive", "z-lib", "libgen", ".pdf", ".epub"]
            .iter()
            .any(|s| lower.contains(s))
            || book.title.chars().filter(|c| c.is_alphabetic()).count() < 3
        {
            book.details.issues.push("Check title".into());
        }
        if book.author.as_deref().is_none_or(|a| a.trim().is_empty()) {
            book.details.issues.push("Missing author".into());
        }
        if book.details.availability == "missing" {
            book.details.issues.push("Missing file".into());
        }
        if book.details.content_type == "unidentified" {
            book.details.issues.push("Classify item".into());
        }
        if book.cover.is_none() && book.details.content_type == "book" {
            book.details.issues.push("Missing cover".into());
        }
        if let Some(mut duplicates) = candidates.remove(&book.details.stable_id) {
            duplicates.sort();
            duplicates.dedup();
            book.details.duplicate_candidates = duplicates;
            book.details.issues.push("Possible duplicate".into());
        }
    }
    let mut books = crate::consolidation::project(books, &curation.merges)?;
    for book in &mut books {
        book.author = book
            .author
            .as_deref()
            .map(|a| crate::organisation::label(a, &curation.organisation.authors))
            .transpose()?;
        book.category =
            crate::organisation::topics(book.category.as_deref(), &curation.organisation.topics)?;
        for source in &book.details.source_profiles {
            if let Some(author) = &source.author {
                let name = crate::organisation::label(author, &curation.organisation.authors)?;
                if !book.details.browse_authors.contains(&name) {
                    book.details.browse_authors.push(name);
                }
            }
            for topic in crate::organisation::topics(
                source.category.as_deref(),
                &curation.organisation.topics,
            )?
            .unwrap_or_default()
            .split(',')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            {
                if !book.details.browse_topics.iter().any(|t| t == topic) {
                    book.details.browse_topics.push(topic.into());
                }
            }
        }
    }
    if let Some(query) = query.filter(|q| !q.trim().is_empty()) {
        let terms: Vec<_> = query
            .to_lowercase()
            .split_whitespace()
            .map(str::to_owned)
            .collect();
        books.retain(|b| {
            let aliases = b
                .details
                .source_profiles
                .iter()
                .map(|s| {
                    format!(
                        "{} {} {} {} {}",
                        s.title,
                        s.author.as_deref().unwrap_or(""),
                        s.category.as_deref().unwrap_or(""),
                        s.path,
                        curation
                            .aliases
                            .get(&s.id)
                            .map(|a| a.join(" "))
                            .unwrap_or_default()
                    )
                })
                .collect::<Vec<_>>()
                .join(" ");
            let haystack = format!(
                "{} {} {} {} {} {} {} {}",
                b.title,
                b.author.as_deref().unwrap_or(""),
                b.category.as_deref().unwrap_or(""),
                b.filename,
                b.file_link.as_deref().unwrap_or(""),
                aliases,
                b.details.browse_authors.join(" "),
                b.details.browse_topics.join(" ")
            )
            .to_lowercase();
            terms.iter().all(|term| haystack.contains(term))
        });
    }
    Ok(books)
}
