use crate::matcher;
use serde::Deserialize;
use std::collections::HashSet;

/// One candidate from Open Library's search API.
#[derive(Deserialize, Debug, Clone)]
pub struct OlDoc {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub author_name: Vec<String>,
    #[serde(default)]
    pub first_publish_year: Option<i64>,
    #[serde(default)]
    pub cover_i: Option<i64>,
    #[serde(default)]
    pub isbn: Vec<String>,
}

#[derive(Deserialize)]
pub struct OlSearch {
    #[serde(default)]
    pub docs: Vec<OlDoc>,
}

/// Conservative acceptance: the candidate's title must cover most of our
/// title tokens (and vice versa loosely), so a garbled query can't attach
/// wrong metadata. Returns the first acceptable doc.
pub fn pick_match<'a>(
    entry_title: &str,
    entry_author: Option<&str>,
    docs: &'a [OlDoc],
) -> Option<&'a OlDoc> {
    let ours: HashSet<String> = matcher::tokens(entry_title).into_iter().collect();
    // Too little signal to trust any match (garbled adopted titles like
    // ") pdf" would otherwise trivially cover a one-word candidate).
    if ours.len() < 2 || (entry_author.is_none() && ours.len() < 3) {
        return None;
    }
    docs.iter().find(|doc| {
        let Some(title) = &doc.title else {
            return false;
        };
        let theirs: HashSet<String> = matcher::tokens(title).into_iter().collect();
        if theirs.is_empty() {
            return false;
        }
        let overlap = ours.intersection(&theirs).count() as f64;
        let title_ok = overlap / ours.len() as f64 >= 0.7 && overlap / theirs.len() as f64 >= 0.5;
        if !title_ok {
            return false;
        }
        // If we know the author, the candidate must agree on at least one
        // author token; if we don't, the title match must be very strong.
        match entry_author {
            Some(author) => {
                let our_author: HashSet<String> = matcher::tokens(author).into_iter().collect();
                if our_author.is_empty() {
                    return true;
                }
                doc.author_name.iter().any(|candidate| {
                    matcher::tokens(candidate)
                        .iter()
                        .any(|t| our_author.contains(t))
                })
            }
            None => overlap / ours.len() as f64 >= 0.9,
        }
    })
}

/// Shortest ISBN-13 (or any) — stable pick from OL's unordered list.
pub fn pick_isbn(doc: &OlDoc) -> Option<String> {
    doc.isbn
        .iter()
        .filter(|i| i.len() == 13)
        .min()
        .or_else(|| doc.isbn.iter().min())
        .cloned()
}
