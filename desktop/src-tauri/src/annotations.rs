use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// One highlight, UUID-keyed with LWW timestamps and a tombstone flag so
/// sidecars stay merge-friendly under file sync (TRD-3 phase-1 model).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Highlight {
    pub id: String,
    /// The exact quoted text.
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// Multi-selector anchor envelope, format-specific (CFI / page+quote).
    pub anchor: serde_json::Value,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub deleted: bool,
}

/// Per-book sidecar: reading position + highlights, one JSON file per book
/// under `<library>/.properbooky/state/`.
#[derive(Serialize, Deserialize, Default, Debug)]
pub struct Sidecar {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub percent: Option<f64>,
    #[serde(default)]
    pub updated_at: i64,
    #[serde(default)]
    pub highlights: Vec<Highlight>,
    /// Set (never stored) when an unreadable sidecar was moved aside on load.
    #[serde(default, skip_deserializing, skip_serializing_if = "Option::is_none")]
    pub notice: Option<String>,
}

/// Lenient read for exports: a missing or unreadable file yields no state.
pub fn load(path: &Path) -> Sidecar {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_default()
}

/// Read for the reader and every write. A missing file is empty state; an
/// I/O failure is an error. A file that is not valid sidecar JSON is moved
/// aside, byte for byte, so the next write can never clobber what it held.
pub fn load_checked(path: &Path) -> Result<Sidecar> {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Sidecar::default()),
        Err(e) => {
            return Err(e).with_context(|| format!("cannot read reading state {}", path.display()))
        }
    };
    match serde_json::from_slice(&bytes) {
        Ok(sidecar) => Ok(sidecar),
        Err(_) => {
            let kept = quarantine(path)?;
            Ok(Sidecar {
                notice: Some(format!(
                    "Saved reading state for this book could not be read. It was kept unchanged as {} and reading starts from the beginning.",
                    kept.file_name().unwrap_or_default().to_string_lossy()
                )),
                ..Sidecar::default()
            })
        }
    }
}

/// `<name>.unreadable-<unix>[-n]` beside the original; not `*.json`, so
/// exports and identity lookups never treat it as live state.
fn quarantine(path: &Path) -> Result<PathBuf> {
    let name = path.file_name().context("sidecar has no file name")?;
    let stamp = now();
    for n in 0.. {
        let suffix = if n == 0 {
            format!(".unreadable-{stamp}")
        } else {
            format!(".unreadable-{stamp}-{n}")
        };
        let mut target = name.to_os_string();
        target.push(suffix);
        let target = path.with_file_name(target);
        if !target.exists() {
            std::fs::rename(path, &target).with_context(|| {
                format!(
                    "cannot set aside unreadable reading state {}",
                    path.display()
                )
            })?;
            return Ok(target);
        }
    }
    unreachable!()
}

/// Atomic replace: an interrupted write leaves the previous sidecar intact.
pub fn save(path: &Path, sidecar: &Sidecar) -> Result<()> {
    let mut value = serde_json::to_value(sidecar)?;
    if let Some(fields) = value.as_object_mut() {
        fields.remove("notice");
    }
    crate::identity::atomic_write(path, serde_json::to_string_pretty(&value)?.as_bytes())
        .with_context(|| format!("cannot save reading state {}", path.display()))
}

pub fn set_position(path: &Path, position: String, percent: Option<f64>) -> Result<()> {
    let mut sidecar = load_checked(path)?;
    sidecar.position = Some(position);
    sidecar.percent = percent;
    sidecar.updated_at = now();
    save(path, &sidecar)
}

/// Live (non-tombstoned) highlights, oldest first.
pub fn live_highlights(path: &Path) -> Vec<Highlight> {
    let mut highlights: Vec<Highlight> = load(path)
        .highlights
        .into_iter()
        .filter(|h| !h.deleted)
        .collect();
    highlights.sort_by_key(|h| h.created_at);
    highlights
}

pub fn add_highlight(
    path: &Path,
    text: String,
    note: Option<String>,
    color: Option<String>,
    anchor: serde_json::Value,
) -> Result<Highlight> {
    let mut sidecar = load_checked(path)?;
    let timestamp = now();
    let highlight = Highlight {
        id: uuid::Uuid::new_v4().to_string(),
        text,
        note,
        color,
        anchor,
        created_at: timestamp,
        updated_at: timestamp,
        deleted: false,
    };
    sidecar.highlights.push(highlight.clone());
    sidecar.updated_at = timestamp;
    save(path, &sidecar)?;
    Ok(highlight)
}

/// Attach or replace the note on a live highlight (LWW timestamp).
pub fn set_note(path: &Path, id: &str, note: Option<String>) -> Result<bool> {
    let mut sidecar = load_checked(path)?;
    let mut found = false;
    for highlight in &mut sidecar.highlights {
        if highlight.id == id && !highlight.deleted {
            highlight.note = note.clone().filter(|n| !n.trim().is_empty());
            highlight.updated_at = now();
            found = true;
        }
    }
    if found {
        sidecar.updated_at = now();
        save(path, &sidecar)?;
    }
    Ok(found)
}

/// Tombstone rather than delete, so a later sync can converge.
pub fn remove_highlight(path: &Path, id: &str) -> Result<bool> {
    let mut sidecar = load_checked(path)?;
    let mut found = false;
    for highlight in &mut sidecar.highlights {
        if highlight.id == id && !highlight.deleted {
            highlight.deleted = true;
            highlight.updated_at = now();
            found = true;
        }
    }
    if found {
        sidecar.updated_at = now();
        save(path, &sidecar)?;
    }
    Ok(found)
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}
