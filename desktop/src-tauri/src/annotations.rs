use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::Path;
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
}

pub fn load(path: &Path) -> Sidecar {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_default()
}

pub fn save(path: &Path, sidecar: &Sidecar) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, serde_json::to_string_pretty(sidecar)?)?;
    Ok(())
}

pub fn set_position(path: &Path, position: String, percent: Option<f64>) -> Result<()> {
    let mut sidecar = load(path);
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
    let mut sidecar = load(path);
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
    let mut sidecar = load(path);
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
    let mut sidecar = load(path);
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
