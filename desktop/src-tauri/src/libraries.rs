//! Known libraries (PBK-15). The list lives in app settings
//! (`<app-data>/settings.json`); each library's disposable index lives under
//! `<app-data>/libraries/<id>/`. Library folders stay the source of truth and
//! nothing in this module writes inside one: removing a library only forgets
//! it, and re-adding the same folder revives the same entry.
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    path::{Component, Path, PathBuf},
};

pub const SETTINGS_FILE: &str = "settings.json";
pub const SETTINGS_BACKUP: &str = "settings.previous.json";
/// Single-library settings + index written by builds before PBK-15. Read
/// once, read-only, and never modified, so a previous build still works.
pub const LEGACY_DB: &str = "library.db";
/// Written into an export folder so a second library cannot overwrite it.
pub const EXPORT_MARKER: &str = ".properbooky-library";
const NAME_LIMIT: usize = 120;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Entry {
    pub id: String,
    pub name: String,
    /// As the user chose it; book paths are built from this.
    pub path: String,
    /// Resolved form at the time it was added, for duplicate detection while
    /// the folder is unavailable.
    pub canonical: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub obsidian_vault_path: Option<String>,
    pub added_at: i64,
    /// Forgotten by the user. Kept so re-adding the folder restores the same
    /// name, export folder and index.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub removed_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub migrated_from: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Settings {
    pub version: u32,
    #[serde(default)]
    pub active: Option<String>,
    #[serde(default)]
    pub libraries: Vec<Entry>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            version: 1,
            active: None,
            libraries: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Available,
    Missing,
    Inaccessible,
    NotFolder,
}

/// What a folder looks like right now, without writing anything.
pub fn probe(path: &Path) -> (Status, Option<String>) {
    match fs::metadata(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => (Status::Missing, None),
        Err(e) => (Status::Inaccessible, Some(e.to_string())),
        Ok(meta) if !meta.is_dir() => (Status::NotFolder, None),
        Ok(_) => match fs::read_dir(path) {
            Ok(_) => (Status::Available, None),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (Status::Missing, None),
            Err(e) => (Status::Inaccessible, Some(e.to_string())),
        },
    }
}

/// A sentence for the user about a folder that cannot be opened.
pub fn problem(name: &str, path: &str, status: Status, detail: Option<&str>) -> String {
    match status {
        Status::Available => String::new(),
        Status::Missing => format!(
            "The folder for “{name}” was not found at {path}. It may have been moved, renamed or be on a drive that is not connected. Nothing was opened in its place."
        ),
        Status::Inaccessible => format!(
            "The folder for “{name}” at {path} cannot be read{}. Check its permissions, then try again.",
            detail.map(|d| format!(" ({d})")).unwrap_or_default()
        ),
        Status::NotFolder => format!("{path} is not a folder."),
    }
}

/// Trimmed absolute path without a trailing separator.
pub fn normalize(path: &str) -> Result<String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        bail!("Choose a folder first.");
    }
    let p = Path::new(trimmed);
    if !p.is_absolute() {
        bail!(
            "Use the full path of the folder (for example one starting with / or a drive letter)."
        );
    }
    let mut value = trimmed.to_owned();
    while value.len() > 1 && (value.ends_with('/') || value.ends_with('\\')) {
        let candidate = &value[..value.len() - 1];
        // Keep "C:\" and "/" as they are.
        if candidate.ends_with(':') {
            break;
        }
        value.truncate(value.len() - 1);
    }
    Ok(value)
}

/// A library's own state lives in `.properbooky`; that folder (or anything in
/// it) is never a library itself.
fn ensure_not_state_folder(path: &str) -> Result<()> {
    if Path::new(path)
        .components()
        .any(|c| c.as_os_str() == ".properbooky")
    {
        bail!(
            "This is ProperBooky's own data folder inside a library. Open the library folder that contains it instead."
        );
    }
    Ok(())
}

/// One spelling per folder: symlinks and `..` resolved when the folder can be
/// reached, a lexical form otherwise.
pub fn canonical_key(path: &str) -> String {
    let resolved = fs::canonicalize(path)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| lexical(path));
    let resolved = resolved
        .strip_prefix(r"\\?\")
        .map(str::to_owned)
        .unwrap_or(resolved);
    if cfg!(windows) {
        resolved.to_lowercase()
    } else {
        resolved
    }
}

fn lexical(path: &str) -> String {
    let mut out = PathBuf::new();
    for component in Path::new(path).components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out.to_string_lossy().into_owned()
}

fn keys(entry: &Entry) -> [String; 2] {
    [entry.canonical.clone(), canonical_key(&entry.path)]
}

pub fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn default_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| path.to_owned())
}

impl Settings {
    pub fn listed(&self) -> impl Iterator<Item = &Entry> {
        self.libraries.iter().filter(|e| e.removed_at.is_none())
    }

    pub fn get(&self, id: &str) -> Option<&Entry> {
        self.listed().find(|e| e.id == id)
    }

    fn get_mut(&mut self, id: &str) -> Result<&mut Entry> {
        self.libraries
            .iter_mut()
            .find(|e| e.id == id && e.removed_at.is_none())
            .context("That library is no longer in your list.")
    }

    pub fn validate(&self) -> Result<()> {
        if self.version != 1 {
            bail!("unsupported library list version {}", self.version);
        }
        let mut ids = HashSet::new();
        for entry in &self.libraries {
            uuid::Uuid::parse_str(&entry.id).context("invalid library id")?;
            if !ids.insert(entry.id.as_str()) {
                bail!("duplicate library id");
            }
            if entry.path.trim().is_empty() || !Path::new(&entry.path).is_absolute() {
                bail!("library path must be absolute");
            }
        }
        Ok(())
    }

    fn ensure_no_overlap(&self, key: &str, except: Option<&str>) -> Result<()> {
        for other in self.listed().filter(|e| Some(e.id.as_str()) != except) {
            for other_key in keys(other) {
                if other_key == key {
                    continue;
                }
                if Path::new(key).starts_with(&other_key) {
                    bail!(
                        "This folder is inside the library “{}” ({}). Libraries cannot be nested, because each one indexes everything in its folder.",
                        other.name,
                        other.path
                    );
                }
                if Path::new(&other_key).starts_with(key) {
                    bail!(
                        "This folder contains the library “{}” ({}). Libraries cannot be nested, because each one indexes everything in its folder.",
                        other.name,
                        other.path
                    );
                }
            }
        }
        Ok(())
    }

    /// Add a folder, or find it when it is already listed (any spelling of
    /// the same folder) or was removed earlier. Never changes the active
    /// library. Returns the entry id and whether a new entry was created.
    pub fn add(&mut self, path: &str) -> Result<(String, bool)> {
        let path = normalize(path)?;
        ensure_not_state_folder(&canonical_key(&path))?;
        let (status, detail) = probe(Path::new(&path));
        if status != Status::Available {
            bail!(problem(
                &default_name(&path),
                &path,
                status,
                detail.as_deref()
            ));
        }
        let key = canonical_key(&path);
        if let Some(existing) = self.listed().find(|e| keys(e).contains(&key)) {
            return Ok((existing.id.clone(), false));
        }
        self.ensure_no_overlap(&key, None)?;
        if let Some(previous) = self
            .libraries
            .iter_mut()
            .rev()
            .find(|e| e.removed_at.is_some() && keys(e).contains(&key))
        {
            previous.removed_at = None;
            previous.path = path;
            previous.canonical = key;
            return Ok((previous.id.clone(), false));
        }
        let id = uuid::Uuid::new_v4().to_string();
        self.libraries.push(Entry {
            id: id.clone(),
            name: default_name(&path),
            path,
            canonical: key,
            obsidian_vault_path: None,
            added_at: now(),
            removed_at: None,
            migrated_from: None,
        });
        Ok((id, true))
    }

    /// Point a listed library at the folder it was moved to. The user picks
    /// the folder; nothing is guessed.
    pub fn relocate(&mut self, id: &str, path: &str) -> Result<()> {
        let path = normalize(path)?;
        ensure_not_state_folder(&canonical_key(&path))?;
        let (status, detail) = probe(Path::new(&path));
        if status != Status::Available {
            bail!(problem(
                &default_name(&path),
                &path,
                status,
                detail.as_deref()
            ));
        }
        let key = canonical_key(&path);
        if let Some(other) = self.listed().find(|e| e.id != id && keys(e).contains(&key)) {
            bail!("That folder is already listed as “{}”.", other.name);
        }
        self.ensure_no_overlap(&key, Some(id))?;
        let entry = self.get_mut(id)?;
        entry.path = path;
        entry.canonical = key;
        Ok(())
    }

    pub fn rename(&mut self, id: &str, name: &str) -> Result<()> {
        let name = name.trim();
        if name.is_empty() {
            bail!("A library needs a name.");
        }
        if name.chars().count() > NAME_LIMIT || name.chars().any(char::is_control) {
            bail!("Use a shorter name without line breaks (up to {NAME_LIMIT} characters).");
        }
        self.get_mut(id)?.name = name.to_owned();
        Ok(())
    }

    /// Forget a library. Its folder, books, reading state, notes and index
    /// stay exactly where they are.
    pub fn remove(&mut self, id: &str) -> Result<()> {
        self.get_mut(id)?.removed_at = Some(now());
        if self.active.as_deref() == Some(id) {
            self.active = None;
        }
        Ok(())
    }

    pub fn activate(&mut self, id: &str) -> Result<()> {
        self.get_mut(id)?;
        self.active = Some(id.to_owned());
        Ok(())
    }

    /// The Obsidian export folder (`<vault>/Properbooky`) belongs to one
    /// library; another library already using it is named in the error.
    pub fn set_vault(&mut self, id: &str, vault: Option<String>) -> Result<()> {
        let vault = match vault.map(|v| v.trim().to_owned()).filter(|v| !v.is_empty()) {
            Some(v) => {
                let v = normalize(&v)?;
                let (status, detail) = probe(Path::new(&v));
                if status != Status::Available {
                    bail!(problem("the Obsidian vault", &v, status, detail.as_deref()));
                }
                if let Some(other) = self.export_owner(id, &v) {
                    bail!(shared_export(&other.name, &export_folder(&v)));
                }
                Some(v)
            }
            None => None,
        };
        self.get_mut(id)?.obsidian_vault_path = vault;
        Ok(())
    }

    /// Another listed library exporting into the same folder as `vault`.
    pub fn export_owner(&self, id: &str, vault: &str) -> Option<&Entry> {
        let target = canonical_key(&export_folder(vault).to_string_lossy());
        self.listed().filter(|e| e.id != id).find(|e| {
            e.obsidian_vault_path
                .as_deref()
                .is_some_and(|v| canonical_key(&export_folder(v).to_string_lossy()) == target)
        })
    }
}

pub fn export_folder(vault: &str) -> PathBuf {
    Path::new(vault).join("Properbooky")
}

pub fn shared_export(other: &str, folder: &Path) -> String {
    format!(
        "Highlights from the library “{other}” are exported to {}. Choose a different Obsidian folder for this library so the two libraries' notes cannot overwrite each other.",
        folder.display()
    )
}

/// Where library `id`'s index lives. Ids are validated UUIDs, so this cannot
/// leave the app-data directory.
pub fn index_file(dir: &Path, id: &str) -> Result<PathBuf> {
    uuid::Uuid::parse_str(id).context("invalid library id")?;
    Ok(dir.join("libraries").join(id).join("library.db"))
}

pub struct Loaded {
    pub settings: Settings,
    pub notices: Vec<String>,
}

/// Read the library list. A list that cannot be parsed is moved aside, never
/// overwritten, and the previous saved copy is used when it is valid. Before
/// any list exists, a pre-PBK-15 single-library setup is imported.
pub fn load(dir: &Path) -> Result<Loaded> {
    let path = dir.join(SETTINGS_FILE);
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(import_legacy(dir)),
        Err(e) => {
            return Err(e)
                .with_context(|| format!("cannot read the library list {}", path.display()))
        }
    };
    match parse(&bytes) {
        Ok(settings) => Ok(sanitized(settings, Vec::new())),
        Err(error) => {
            let kept = quarantine(&path).with_context(|| {
                format!(
                    "the library list {} is unreadable ({error:#}) and could not be set aside",
                    path.display()
                )
            })?;
            let kept = kept
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned();
            let backup = dir.join(SETTINGS_BACKUP);
            match fs::read(&backup).map_err(anyhow::Error::from).and_then(|b| parse(&b)) {
                Ok(previous) => {
                    let mut notices = vec![format!(
                        "Your library list could not be read. It was kept unchanged as {kept} and the previous saved list was restored."
                    )];
                    if let Err(e) = save(dir, &previous) {
                        notices.push(format!("The restored library list could not be saved yet: {e:#}"));
                    }
                    Ok(sanitized(previous, notices))
                }
                Err(_) => Ok(Loaded {
                    settings: Settings::default(),
                    notices: vec![format!(
                        "Your library list could not be read. It was kept unchanged as {kept}. Open your library folders again; their books, reading progress and highlights are unchanged."
                    )],
                }),
            }
        }
    }
}

fn parse(bytes: &[u8]) -> Result<Settings> {
    let settings: Settings = serde_json::from_slice(bytes).context("invalid JSON")?;
    settings.validate()?;
    Ok(settings)
}

fn sanitized(mut settings: Settings, mut notices: Vec<String>) -> Loaded {
    if let Some(active) = settings.active.clone() {
        if settings.get(&active).is_none() {
            settings.active = None;
            notices.push("The library that was open last is no longer in your list.".into());
        }
    }
    Loaded { settings, notices }
}

/// Atomic replace with the previous list kept as `settings.previous.json`.
pub fn save(dir: &Path, settings: &Settings) -> Result<()> {
    let path = dir.join(SETTINGS_FILE);
    let bytes = serde_json::to_vec_pretty(settings)?;
    let current = fs::read(&path).ok();
    if current.as_deref() == Some(bytes.as_slice()) {
        return Ok(());
    }
    if let Some(previous) = current {
        if parse(&previous).is_ok() {
            crate::identity::atomic_write(&dir.join(SETTINGS_BACKUP), &previous)
                .context("cannot save the library list")?;
        }
    }
    crate::identity::atomic_write(&path, &bytes).context("cannot save the library list")
}

/// `<name>.unreadable-<unix>[-n]` beside the original.
pub fn quarantine(path: &Path) -> Result<PathBuf> {
    let name = path.file_name().context("no file name")?;
    let stamp = now();
    for n in 0.. {
        let mut target = name.to_os_string();
        target.push(if n == 0 {
            format!(".unreadable-{stamp}")
        } else {
            format!(".unreadable-{stamp}-{n}")
        });
        let target = path.with_file_name(target);
        if !target.exists() {
            fs::rename(path, &target)?;
            return Ok(target);
        }
    }
    unreachable!()
}

/// Import the single library of a pre-PBK-15 install from its `library.db`,
/// read from a copy. The legacy files are left byte-for-byte unchanged so the
/// previous build keeps working (rollback); the new index is rebuilt from the
/// library folder, where reading state and corrections already live.
fn import_legacy(dir: &Path) -> Loaded {
    let legacy = dir.join(LEGACY_DB);
    if !legacy.is_file() {
        return Loaded {
            settings: Settings::default(),
            notices: Vec::new(),
        };
    }
    let read = || -> Result<(Option<String>, Option<String>)> {
        // Even a read-only open makes SQLite create -wal/-shm beside a WAL
        // database; read a private copy so the original is never opened.
        let scratch = tempfile::tempdir()?;
        let copy = scratch.path().join(LEGACY_DB);
        fs::copy(&legacy, &copy)?;
        let wal = dir.join(format!("{LEGACY_DB}-wal"));
        if wal.is_file() {
            fs::copy(&wal, scratch.path().join(format!("{LEGACY_DB}-wal")))?;
        }
        let conn = rusqlite::Connection::open_with_flags(
            &copy,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        let has_settings: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='settings')",
            [],
            |r| r.get(0),
        )?;
        if !has_settings {
            return Ok((None, None));
        }
        let get = |key: &str| -> Result<Option<String>> {
            Ok(crate::db::get_setting(&conn, key)?.filter(|v| !v.trim().is_empty()))
        };
        Ok((get("library_path")?, get("obsidian_vault_path")?))
    };
    match read() {
        Ok((Some(path), vault)) => {
            let mut settings = Settings::default();
            let path = normalize(&path).unwrap_or(path);
            let id = uuid::Uuid::new_v4().to_string();
            settings.libraries.push(Entry {
                id: id.clone(),
                name: default_name(&path),
                canonical: canonical_key(&path),
                path,
                obsidian_vault_path: vault,
                added_at: now(),
                removed_at: None,
                migrated_from: Some(LEGACY_DB.into()),
            });
            settings.active = Some(id);
            let mut notices = Vec::new();
            if let Err(e) = save(dir, &settings) {
                notices.push(format!(
                    "Your library was found, but the library list could not be saved: {e:#}"
                ));
            }
            Loaded { settings, notices }
        }
        Ok((None, _)) => Loaded {
            settings: Settings::default(),
            notices: Vec::new(),
        },
        Err(e) => Loaded {
            settings: Settings::default(),
            notices: vec![format!(
                "Settings from the previous version could not be read ({e:#}); {} was left unchanged. Open your library folder to continue.",
                legacy.display()
            )],
        },
    }
}
