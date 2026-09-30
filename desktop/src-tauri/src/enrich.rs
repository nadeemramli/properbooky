use crate::matcher;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// One candidate from Open Library's search API.
#[derive(Deserialize, Serialize, Debug, Clone, Default)]
pub struct OlDoc {
    #[serde(default)]
    pub key: String,
    #[serde(default)]
    pub subject: Vec<String>,
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

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Accepted {
    pub work_key: String,
    pub source_url: String,
    pub accepted_at: u64,
    pub cover: Option<String>, // library-relative; survives a folder move
    pub suggested_title: String,
    pub suggested_authors: Vec<String>,
    pub suggested_topics: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Suggestions {
    pub fetched_at: u64,
    pub stale: bool,
    pub docs: Vec<OlDoc>,
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

// Shared across search and cover requests, including rapid repeated clicks.
static REQUEST_TIME: std::sync::Mutex<Option<std::time::Instant>> = std::sync::Mutex::new(None);
fn throttle() -> anyhow::Result<()> {
    let mut previous = REQUEST_TIME
        .lock()
        .map_err(|_| anyhow::anyhow!("metadata request lock unavailable"))?;
    if let Some(last) = *previous {
        std::thread::sleep(std::time::Duration::from_millis(1100).saturating_sub(last.elapsed()));
    }
    *previous = Some(std::time::Instant::now());
    Ok(())
}

fn client() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout(std::time::Duration::from_secs(20))
        .user_agent("ProperBooky/0.1 (https://github.com/nadeemramli/properbooky)")
        .build()
}

pub fn work_key(value: &str) -> anyhow::Result<String> {
    let value = value.strip_prefix("/works/").unwrap_or(value);
    let number = value
        .strip_prefix("OL")
        .and_then(|s| s.strip_suffix('W'))
        .unwrap_or("");
    anyhow::ensure!(
        !number.is_empty() && number.len() < 20 && number.bytes().all(|b| b.is_ascii_digit()),
        "invalid Open Library work identifier"
    );
    Ok(format!("/works/{value}"))
}

/// Search is a suggestion, never an automatic identification. A short or
/// numeric filename can be replaced by a user-supplied query in the review UI.
pub fn search(
    root: &std::path::Path,
    title: &str,
    author: &str,
    refresh: bool,
) -> anyhow::Result<Suggestions> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    anyhow::ensure!(
        !title.trim().is_empty() && title.len() <= 1000 && author.len() <= 500,
        "enter a title to look up"
    );
    let hash = format!(
        "{:x}",
        Sha256::digest(format!("{}\n{}", title.trim(), author.trim()).as_bytes())
    );
    let cache = root.join(format!(".properbooky/metadata-cache/{hash}.json"));
    let cached = std::fs::read(&cache)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Suggestions>(&bytes).ok());
    if !refresh {
        if let Some(saved) = &cached {
            if now().saturating_sub(saved.fetched_at) < 7 * 86400 {
                return Ok(saved.clone());
            }
        }
    }
    let fetched = (|| -> anyhow::Result<Suggestions> {
        throttle()?;
        let response = client()
            .get("https://openlibrary.org/search.json")
            .query("title", title.trim())
            .query("author", author.trim())
            .query("limit", "5")
            .query(
                "fields",
                "key,title,author_name,first_publish_year,cover_i,subject",
            )
            .call()?;
        let mut bytes = Vec::new();
        response
            .into_reader()
            .take(2_000_001)
            .read_to_end(&mut bytes)?;
        anyhow::ensure!(bytes.len() <= 2_000_000, "metadata response is too large");
        let mut result: OlSearch = serde_json::from_slice(&bytes)?;
        result.docs.retain(|doc| {
            work_key(&doc.key).is_ok() && doc.title.as_ref().is_some_and(|s| !s.trim().is_empty())
        });
        result.docs.truncate(5);
        for doc in &mut result.docs {
            doc.key = work_key(&doc.key)?;
            doc.subject.truncate(20);
            doc.isbn.clear();
        }
        Ok(Suggestions {
            fetched_at: now(),
            stale: false,
            docs: result.docs,
        })
    })();
    match fetched {
        Ok(result) => {
            crate::identity::atomic_write(&cache, &serde_json::to_vec(&result)?)?;
            Ok(result)
        }
        Err(error) => {
            match cached {
                Some(mut saved) => {
                    saved.stale = true;
                    Ok(saved)
                }
                None => Err(error
                    .context("Open Library lookup failed; you can still edit details manually")),
            }
        }
    }
}

pub fn accepted(root: &std::path::Path, doc: OlDoc, use_cover: bool) -> anyhow::Result<Accepted> {
    let key = work_key(&doc.key)?;
    let title = doc
        .title
        .as_ref()
        .filter(|t| !t.trim().is_empty() && t.len() <= 1000)
        .ok_or_else(|| anyhow::anyhow!("invalid suggested title"))?;
    let cover = if use_cover {
        Some(download_cover(
            root,
            doc.cover_i
                .ok_or_else(|| anyhow::anyhow!("candidate has no cover"))?,
        )?)
    } else {
        None
    };
    Ok(Accepted {
        source_url: format!("https://openlibrary.org{key}"),
        work_key: key,
        accepted_at: now(),
        cover,
        suggested_title: title.clone(),
        suggested_authors: doc.author_name,
        suggested_topics: doc.subject,
    })
}

fn download_cover(root: &std::path::Path, id: i64) -> anyhow::Result<String> {
    use std::io::Read;
    anyhow::ensure!(id > 0, "invalid cover identifier");
    let relative = format!(".properbooky/covers/ol-reviewed-{id}.jpg");
    let path = root.join(&relative);
    if path.is_file() {
        return Ok(relative);
    }
    throttle()?;
    let response = client()
        .get(&format!(
            "https://covers.openlibrary.org/b/id/{id}-M.jpg?default=false"
        ))
        .call()?;
    anyhow::ensure!(
        response
            .header("Content-Type")
            .unwrap_or("")
            .starts_with("image/jpeg"),
        "provider did not return a JPEG cover"
    );
    let mut bytes = Vec::new();
    response
        .into_reader()
        .take(5_000_001)
        .read_to_end(&mut bytes)?;
    anyhow::ensure!(
        bytes.len() > 100
            && bytes.len() <= 5_000_000
            && bytes.starts_with(&[0xff, 0xd8, 0xff])
            && bytes.ends_with(&[0xff, 0xd9]),
        "invalid or oversized cover image"
    );
    crate::identity::atomic_write(&path, &bytes)?;
    Ok(relative)
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
