//! Non-destructive work grouping. Every source and asset keeps its identity.
use crate::library::Book;
use anyhow::{ensure, Result};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap, HashSet};

#[derive(Clone, Serialize)]
pub struct Asset {
    pub id: Option<String>,
    pub path: String,
    pub format: String,
    pub available: bool,
    pub year: Option<i64>,
}

#[derive(Clone, Serialize)]
pub struct SourceProfile {
    pub id: String,
    pub path: String,
    pub kind: String,
    pub title: String,
    pub author: Option<String>,
    pub category: Option<String>,
    pub year: Option<i64>,
    pub rating: Option<i64>,
    pub recommended: bool,
    pub reading_status: String,
    pub want_to_read: bool,
    pub up_next: bool,
}

pub fn resolve<'a>(merges: &'a BTreeMap<String, String>, id: &'a str) -> Result<&'a str> {
    let mut seen = HashSet::new();
    let mut current = id;
    while let Some(next) = merges.get(current) {
        ensure!(
            seen.insert(current) && !next.is_empty(),
            "invalid profile merge cycle"
        );
        current = next;
    }
    Ok(current)
}

pub fn project(books: Vec<Book>, merges: &BTreeMap<String, String>) -> Result<Vec<Book>> {
    let present: HashSet<_> = books.iter().map(|b| b.details.stable_id.clone()).collect();
    let mut groups: HashMap<String, Vec<Book>> = HashMap::new();
    let mut redirects = HashMap::new();
    for book in books {
        let resolved = resolve(merges, &book.details.stable_id)?;
        // If a primary source is missing, expose surviving members for repair.
        let target = if present.contains(resolved) {
            resolved
        } else {
            &book.details.stable_id
        }
        .to_owned();
        redirects.insert(book.details.stable_id.clone(), target.clone());
        groups.entry(target).or_default().push(book);
    }
    let mut projected = Vec::new();
    for (target, mut members) in groups {
        members.sort_by(|a, b| a.details.stable_id.cmp(&b.details.stable_id));
        let primary = members
            .iter()
            .position(|b| b.details.stable_id == target)
            .unwrap();
        members.swap(0, primary);
        let mut book = members[0].clone();
        let mut candidates = HashSet::new();
        let mut asset_keys = HashSet::new();
        for member in &members {
            book.details.source_profiles.push(SourceProfile {
                id: member.details.stable_id.clone(),
                path: member.path.clone(),
                kind: member.kind.clone(),
                title: member.title.clone(),
                author: member.author.clone(),
                category: member.category.clone(),
                year: member.year,
                rating: member.rating,
                recommended: member.recommended,
                reading_status: member.details.reading_status.clone(),
                want_to_read: member.details.want_to_read,
                up_next: member.details.up_next,
            });
            let asset_path = if member.kind == "catalog" {
                member.file_link.as_deref()
            } else {
                Some(member.path.as_str())
            };
            if let Some(path) = asset_path {
                let key = member
                    .details
                    .asset_id
                    .as_deref()
                    .unwrap_or(path)
                    .to_owned();
                if asset_keys.insert(key) {
                    book.details.assets.push(Asset {
                        id: member.details.asset_id.clone(),
                        path: path.into(),
                        format: member.format.clone(),
                        available: std::path::Path::new(path).is_file(),
                        year: member.year,
                    });
                }
            }
            for id in &member.details.duplicate_candidates {
                let candidate = redirects.get(id).unwrap_or(id);
                if candidate != &target {
                    candidates.insert(candidate.clone());
                }
            }
            if book.cover.is_none() {
                book.cover = member.cover.clone();
            }
            book.recommended |= member.recommended;
        }
        book.details.assets.sort_by_key(|a| {
            (
                !a.available,
                !["pdf", "epub", "article"].contains(&a.format.as_str()),
            )
        });
        if let Some(asset) = book.details.assets.first() {
            book.file_link = Some(asset.path.clone());
            book.format = asset.format.clone();
            book.details.asset_id = asset.id.clone();
            book.details.availability = if asset.available { "local" } else { "missing" }.into();
        }
        if members.len() > 1 {
            book.details.issues.retain(|issue| issue != "Missing file");
            if book.details.assets.iter().any(|a| !a.available) {
                book.details.issues.push("Missing file".into());
            }
        }
        book.details.issues.retain(|issue| {
            issue != "Possible duplicate" && (issue != "Missing cover" || book.cover.is_none())
        });
        book.details.duplicate_candidates = candidates.into_iter().collect();
        book.details.duplicate_candidates.sort();
        if !book.details.duplicate_candidates.is_empty() {
            book.details.issues.push("Possible duplicate".into());
        }
        if resolve(merges, &target)? != target {
            book.details.issues.push("Missing primary profile".into());
        }
        projected.push(book);
    }
    projected.sort_by_key(|b| b.title.to_lowercase());
    Ok(projected)
}
