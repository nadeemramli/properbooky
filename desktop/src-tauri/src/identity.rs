//! Durable identities live beside the library; SQLite is only their index.
//! Existing sidecars stay in place. Their filenames become explicit pointers,
//! so a recognized asset move never changes the location of reading state.
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Record {
    pub id: String,
    pub kind: String,
    pub path: String,
    pub hash: String,
    pub size: u64,
    pub modified: u128,
    pub state_file: Option<String>,
    #[serde(default)]
    pub aliases: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Registry {
    pub version: u32,
    pub records: Vec<Record>,
    #[serde(skip)]
    claimed: HashSet<String>,
    #[serde(skip)]
    move_destinations: HashMap<String, usize>,
}

impl Default for Registry {
    fn default() -> Self {
        Self {
            version: 1,
            records: Vec::new(),
            claimed: HashSet::new(),
            move_destinations: HashMap::new(),
        }
    }
}

pub fn relative(root: &Path, path: &Path) -> Result<String> {
    let rel = path
        .strip_prefix(root)
        .context("path is outside the library")?;
    let value = rel.to_string_lossy().replace('\\', "/");
    safe_join(root, &value)?;
    Ok(value)
}

pub fn safe_join(root: &Path, relative: &str) -> Result<PathBuf> {
    let normalized = relative.replace('\\', "/");
    let path = Path::new(&normalized);
    if path.is_absolute()
        || normalized.contains(':')
        || path
            .components()
            .any(|c| !matches!(c, Component::Normal(_) | Component::CurDir))
    {
        bail!("expected a library-relative path: {relative}");
    }
    Ok(root.join(path))
}

pub fn legacy_slug(relative: &str) -> String {
    format!("{}.json", relative.replace('\\', "/").replace('/', "__"))
}

/// Write a complete new file, then atomically replace the destination. A failed
/// write leaves the old file intact; no delete-before-rename window on Windows.
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path.parent().context("missing parent directory")?;
    fs::create_dir_all(parent)?;
    let mut file = tempfile::NamedTempFile::new_in(parent)?;
    file.write_all(bytes)?;
    file.as_file().sync_all()?;
    file.persist(path).map_err(|e| e.error)?;
    Ok(())
}

impl Registry {
    pub fn load(root: &Path) -> Result<Self> {
        let path = root.join(".properbooky/identities.json");
        match fs::read(&path) {
            Ok(bytes) => {
                let value: Self = serde_json::from_slice(&bytes)
                    .context("identity registry is invalid; restore its backup before scanning")?;
                if value.version != 1 {
                    bail!("unsupported identity registry version {}", value.version);
                }
                let mut ids = HashSet::new();
                for record in &value.records {
                    uuid::Uuid::parse_str(&record.id).context("invalid identity UUID")?;
                    if !ids.insert(&record.id) {
                        bail!("duplicate identity UUID");
                    }
                    safe_join(root, &record.path)?;
                    if let Some(state) = &record.state_file {
                        if state.contains(['/', '\\', ':']) || !state.ends_with(".json") {
                            bail!("invalid reading state filename");
                        }
                    }
                }
                Ok(value)
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(e) => Err(e.into()),
        }
    }

    pub fn save(&self, root: &Path) -> Result<()> {
        let path = root.join(".properbooky/identities.json");
        let bytes = serde_json::to_vec_pretty(self)?;
        if fs::read(&path).ok().as_deref() == Some(bytes.as_slice()) {
            return Ok(());
        }
        if let Ok(previous) = fs::read(&path) {
            atomic_write(
                &root.join(".properbooky/identities.previous.json"),
                &previous,
            )?;
        }
        atomic_write(&path, &bytes)
    }

    pub fn register(&mut self, root: &Path, path: &Path, kind: &str) -> Result<String> {
        let rel = relative(root, path)?;
        let meta = fs::metadata(path)?;
        let modified = meta
            .modified()?
            .duration_since(std::time::UNIX_EPOCH)?
            .as_nanos();
        let current = self
            .records
            .iter()
            .rposition(|r| r.path == rel && r.kind == kind && !self.claimed.contains(&r.id));
        let hash = match current.map(|i| &self.records[i]) {
            Some(record) if record.size == meta.len() && record.modified == modified => {
                record.hash.clone()
            }
            _ => crate::matcher::sha256_file(path)?,
        };
        // Catalog metadata may change; file content changes must not inherit
        // anchors that describe a different PDF/EPUB.
        let current = current
            .filter(|&i| kind == "catalog" || kind == "article" || self.records[i].hash == hash);
        let moved: Vec<usize> = self
            .records
            .iter()
            .enumerate()
            .filter(|(_, r)| {
                r.kind == kind
                    && r.hash == hash
                    && !self.claimed.contains(&r.id)
                    && !root.join(&r.path).exists()
            })
            .map(|(i, _)| i)
            .collect();
        // A single missing source is still ambiguous when two new copies
        // appear at once. Count destinations before assigning its annotations.
        let unique_move = if current.is_none() && moved.len() == 1 {
            if !self.move_destinations.contains_key(&hash) {
                let mut count = 0;
                for candidate in walkdir::WalkDir::new(root).into_iter().filter_entry(|e| {
                    e.depth() == 0 || !e.file_name().to_string_lossy().starts_with('.')
                }) {
                    let candidate = candidate?;
                    if !candidate.file_type().is_file() || candidate.metadata()?.len() != meta.len()
                    {
                        continue;
                    }
                    let candidate_rel = relative(root, candidate.path())?;
                    if self.at_path(&candidate_rel).is_none()
                        && crate::matcher::sha256_file(candidate.path())? == hash
                    {
                        count += 1;
                    }
                }
                self.move_destinations.insert(hash.clone(), count);
            }
            self.move_destinations.get(&hash) == Some(&1)
        } else {
            false
        };
        let index = current.or_else(|| unique_move.then(|| moved[0]));
        let index = match index {
            Some(i) => i,
            None => {
                let id = uuid::Uuid::new_v4().to_string();
                let state_file = if kind == "catalog" {
                    None
                } else {
                    let legacy = legacy_slug(&rel);
                    let used = self
                        .records
                        .iter()
                        .any(|r| r.state_file.as_deref() == Some(&legacy));
                    Some(
                        if !used && root.join(".properbooky/state").join(&legacy).is_file() {
                            legacy
                        } else {
                            format!("asset-{id}.json")
                        },
                    )
                };
                self.records.push(Record {
                    id,
                    kind: kind.into(),
                    path: rel.clone(),
                    hash: hash.clone(),
                    size: meta.len(),
                    modified,
                    state_file,
                    aliases: Vec::new(),
                });
                self.records.len() - 1
            }
        };
        let record = &mut self.records[index];
        if record.path != rel {
            if !record.aliases.contains(&record.path) {
                record.aliases.push(record.path.clone());
            }
            record.path = rel;
        }
        record.hash = hash;
        record.size = meta.len();
        record.modified = modified;
        self.claimed.insert(record.id.clone());
        Ok(record.id.clone())
    }

    pub fn at_path(&self, relative: &str) -> Option<&Record> {
        self.records.iter().rev().find(|r| r.path == relative)
    }

    pub fn is_active(&self, id: &str) -> bool {
        self.claimed.contains(id)
    }

    pub fn state_path(&self, root: &Path, path: &Path) -> Result<PathBuf> {
        let rel = relative(root, path)?;
        let name = self
            .at_path(&rel)
            .and_then(|r| r.state_file.clone())
            .unwrap_or_else(|| legacy_slug(&rel));
        Ok(root.join(".properbooky/state").join(name))
    }
}
