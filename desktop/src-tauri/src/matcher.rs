use crate::catalog::{self, CatalogEntry};
use anyhow::Result;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

/// Tokens that carry no identity in shadow-library filenames.
const JUNK_TOKENS: [&str; 14] = [
    "z", "lib", "library", "libgen", "zlib", "io", "li", "com", "www", "org", "net", "ebook",
    "annas", "archive",
];
const STOPWORDS: [&str; 13] = [
    "the", "a", "an", "of", "and", "to", "in", "for", "on", "with", "how", "is", "at",
];

pub fn tokens(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .filter(|t| !STOPWORDS.contains(t))
        .map(ToOwned::to_owned)
        .collect()
}

/// Tokens from a library filename, with shadow-library junk removed.
pub fn filename_tokens(filename: &str) -> Vec<String> {
    let stem = filename
        .rsplit_once('.')
        .map(|(stem, _)| stem)
        .unwrap_or(filename);
    tokens(stem)
        .into_iter()
        .filter(|t| !JUNK_TOKENS.contains(&t.as_str()))
        .filter(|t| !(t.len() == 4 && t.chars().all(|c| c.is_ascii_digit()))) // years
        .collect()
}

pub struct MatchScore {
    pub total: f64,
    pub title_coverage: f64,
    pub title_tokens: usize,
}

/// How well the filename covers the catalog entry's title (+author) tokens.
/// Asymmetric on purpose: extra junk in the filename must not hurt the score.
pub fn score(entry_title: &str, entry_author: Option<&str>, file_tokens: &[String]) -> MatchScore {
    let file_set: HashSet<&str> = file_tokens.iter().map(String::as_str).collect();
    let coverage = |text: &str| -> Option<(f64, usize)> {
        let toks = tokens(text);
        if toks.is_empty() {
            return None;
        }
        let hit = toks.iter().filter(|t| file_set.contains(t.as_str())).count();
        Some((hit as f64 / toks.len() as f64, toks.len()))
    };
    let title = coverage(entry_title);
    let author = entry_author.and_then(|a| coverage(a));
    let (title_coverage, title_tokens) = title.unwrap_or((0.0, 0));
    let total = match (title, author) {
        (Some((t, _)), Some((a, _))) => 0.75 * t + 0.25 * a,
        (Some((t, _)), None) => t,
        _ => 0.0,
    };
    MatchScore {
        total,
        title_coverage,
        title_tokens,
    }
}

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Decision {
    Auto,
    Review,
    Unmatched,
}

pub struct PlanRow {
    pub decision: Decision,
    pub score: f64,
    pub file_path: PathBuf,
    pub proposed_name: String,
    pub catalog_path: PathBuf,
}

pub struct CatalogCandidate {
    pub path: PathBuf,
    pub title: String,
    pub author: Option<String>,
}

const AUTO_SCORE: f64 = 0.85;
const AUTO_MARGIN: f64 = 0.12;
const REVIEW_SCORE: f64 = 0.5;

/// Best catalog candidate for one file, classified by confidence.
pub fn match_file(
    file_path: &Path,
    candidates: &[CatalogCandidate],
) -> Option<PlanRow> {
    let filename = file_path.file_name()?.to_string_lossy();
    let ext = file_path.extension()?.to_string_lossy().to_lowercase();
    let ftoks = filename_tokens(&filename);
    if ftoks.is_empty() {
        return None;
    }

    let mut best: Option<(MatchScore, &CatalogCandidate)> = None;
    let mut second = 0.0f64;
    for candidate in candidates {
        let s = score(&candidate.title, candidate.author.as_deref(), &ftoks);
        match &best {
            Some((b, _)) if s.total <= b.total => {
                if s.total > second {
                    second = s.total;
                }
            }
            _ => {
                if let Some((b, _)) = &best {
                    second = b.total;
                }
                best = Some((s, candidate));
            }
        }
    }
    let (best_score, candidate) = best?;

    let margin = best_score.total - second;
    // A fully covered, distinctive title is safe even when the filename
    // carries no author (the common case for hand-named files).
    let full_title = best_score.title_coverage >= 1.0
        && best_score.title_tokens >= 4
        && margin >= 0.10;
    let decision = if (best_score.total >= AUTO_SCORE && margin >= AUTO_MARGIN) || full_title {
        Decision::Auto
    } else if best_score.total >= REVIEW_SCORE {
        Decision::Review
    } else {
        Decision::Unmatched
    };
    let best_score = best_score.total;

    let proposed = catalog::entry_filename(&candidate.title, candidate.author.as_deref());
    let proposed_name = format!("{}.{ext}", proposed.trim_end_matches(".md"));

    Some(PlanRow {
        decision,
        score: best_score,
        file_path: file_path.to_owned(),
        proposed_name,
        catalog_path: candidate.path.clone(),
    })
}

pub struct ApplyOutcome {
    pub renamed: bool,
    pub new_path: PathBuf,
}

/// Apply one accepted match: rename in place, hash, update the catalog entry.
/// Fully reversible: the original filename is recorded in the frontmatter.
pub fn apply_match(library_root: &Path, row: &PlanRow) -> Result<ApplyOutcome> {
    let original_name = row
        .file_path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let target = row.file_path.with_file_name(&row.proposed_name);

    let (renamed, new_path) = if target == row.file_path {
        (false, row.file_path.clone())
    } else if target.exists() {
        // Never clobber; keep the original name and still link the entry.
        (false, row.file_path.clone())
    } else {
        fs::rename(&row.file_path, &target)?;
        (true, target)
    };

    let hash = sha256_file(&new_path)?;
    let relative = new_path
        .strip_prefix(library_root)
        .unwrap_or(&new_path)
        .to_string_lossy()
        .into_owned();

    let content = fs::read_to_string(&row.catalog_path)?;
    let (mut entry, body): (CatalogEntry, String) = catalog::parse(&content)
        .ok_or_else(|| anyhow::anyhow!("unparseable catalog entry: {:?}", row.catalog_path))?;
    entry.file = Some(relative);
    entry.hash = Some(hash);
    if renamed {
        entry.original_filename = Some(original_name);
    }
    if matches!(entry.status.as_str(), "wishlist" | "queued") {
        entry.status = "available".to_owned();
    }
    fs::write(&row.catalog_path, catalog::render(&entry, &body))?;

    Ok(ApplyOutcome { renamed, new_path })
}

pub fn sha256_file(path: &Path) -> Result<String> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut file, &mut hasher)?;
    Ok(format!("{:x}", hasher.finalize()))
}
