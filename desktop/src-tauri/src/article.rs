use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Frontmatter of an `Articles/*.md` asset — web content captured as an
/// owned, permanent markdown file (articles rot; the library doesn't).
#[derive(Serialize, Deserialize, Debug)]
pub struct ArticleMeta {
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    pub source_url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub site: Option<String>,
    #[serde(default)]
    pub saved_at: i64,
}

/// Parse a markdown document as an article (frontmatter must carry
/// `source_url` — that's what distinguishes it from a catalog entry).
pub fn parse(content: &str) -> Option<(ArticleMeta, String)> {
    let rest = content.strip_prefix("---")?;
    let (front, body) = rest.split_once("\n---")?;
    let meta: ArticleMeta = serde_yaml::from_str(front).ok()?;
    if meta.title.trim().is_empty() || meta.source_url.trim().is_empty() {
        return None;
    }
    let body = body.trim_start_matches(['-']).trim_start_matches('\n');
    Some((meta, body.to_owned()))
}

pub fn render(meta: &ArticleMeta, markdown: &str) -> String {
    let front = serde_yaml::to_string(meta).unwrap_or_default();
    format!("---\n{front}---\n\n{}\n", markdown.trim())
}

/// Readability-extract a fetched HTML page into (meta, markdown).
pub fn extract(html: &str, url: &str) -> Result<(ArticleMeta, String)> {
    let mut readability = dom_smoothie::Readability::new(html, Some(url), None)
        .map_err(|e| anyhow::anyhow!("readability init: {e:?}"))?;
    let article = readability
        .parse()
        .map_err(|e| anyhow::anyhow!("extraction failed: {e:?}"))?;

    let markdown = htmd::convert(&article.content)
        .map_err(|e| anyhow::anyhow!("markdown conversion: {e}"))?;
    if markdown.trim().len() < 200 {
        anyhow::bail!("extracted content too small — page may need a browser to render");
    }

    let site = url
        .split("//")
        .nth(1)
        .and_then(|rest| rest.split('/').next())
        .map(|host| host.trim_start_matches("www.").to_owned());
    let title = if article.title.trim().is_empty() {
        site.clone().unwrap_or_else(|| "Untitled article".to_owned())
    } else {
        article.title.trim().to_owned()
    };

    Ok((
        ArticleMeta {
            title,
            author: article
                .byline
                .as_deref()
                .map(str::trim)
                .filter(|b| !b.is_empty())
                .map(ToOwned::to_owned),
            source_url: url.to_owned(),
            site,
            saved_at: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0),
        },
        markdown,
    ))
}

/// Write the article under `<library>/Articles/`. Same source URL updates
/// its existing file; a new title collision gets a numbered suffix.
pub fn save(root: &Path, meta: &ArticleMeta, markdown: &str) -> Result<PathBuf> {
    let dir = root.join("Articles");
    std::fs::create_dir_all(&dir)?;

    // Dedupe by source URL: re-saving refreshes in place.
    for entry in std::fs::read_dir(&dir)?.filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.extension().is_some_and(|x| x == "md") {
            if let Ok(existing) = std::fs::read_to_string(&path) {
                if let Some((existing_meta, _)) = parse(&existing) {
                    if existing_meta.source_url == meta.source_url {
                        std::fs::write(&path, render(meta, markdown))?;
                        return Ok(path);
                    }
                }
            }
        }
    }

    let base = crate::catalog::entry_filename(&meta.title, None);
    let base = base.trim_end_matches(".md");
    let mut path = dir.join(format!("{base}.md"));
    let mut counter = 2;
    while path.exists() {
        path = dir.join(format!("{base} ({counter}).md"));
        counter += 1;
    }
    std::fs::write(&path, render(meta, markdown))?;
    Ok(path)
}
