use serde::{Deserialize, Serialize};

/// Frontmatter of a `Catalog/*.md` entry — the "book profile" file that
/// represents a book whether or not its file exists on disk yet.
#[derive(Serialize, Deserialize, Debug, Default)]
pub struct CatalogEntry {
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    /// wishlist → queued → available → reading → done
    #[serde(default = "default_status")]
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rating: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recommendation: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub r#type: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub topics: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub published: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub added: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    /// Relative path to the matched file, once it exists on disk.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hash: Option<String>,
    /// Pre-rename filename, kept so any rename is reversible.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_filename: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub isbn: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub year: Option<i64>,
    /// Library-relative path to a cached cover image.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cover: Option<String>,
    /// Enrichment marker: "openlibrary" | "not-found" (resumability).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enriched: Option<String>,
    /// Knowledge spectrum: "original" | "novel" | "collection" — is this a
    /// source of original ideas, a derivative treatment, or an anthology?
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spectrum: Option<String>,
}

fn default_status() -> String {
    "wishlist".to_owned()
}

/// Parse a markdown document with `---` YAML frontmatter. Returns the entry
/// and the body, or None when the document has no parseable catalog frontmatter.
pub fn parse(content: &str) -> Option<(CatalogEntry, String)> {
    let rest = content.strip_prefix("---")?;
    let (front, body) = rest.split_once("\n---")?;
    let entry: CatalogEntry = serde_yaml::from_str(front).ok()?;
    if entry.title.trim().is_empty() {
        return None;
    }
    let body = body.trim_start_matches(['-']).trim_start_matches('\n');
    Some((entry, body.to_owned()))
}

pub fn render(entry: &CatalogEntry, body: &str) -> String {
    let front = serde_yaml::to_string(entry).unwrap_or_default();
    let body = body.trim();
    if body.is_empty() {
        format!("---\n{front}---\n")
    } else {
        format!("---\n{front}---\n\n{body}\n")
    }
}

/// "Author - Title.md", sanitized for the filesystem and bounded in length.
pub fn entry_filename(title: &str, author: Option<&str>) -> String {
    let mut name = match author {
        Some(author) if !author.trim().is_empty() => {
            format!("{} - {}", author.trim(), title.trim())
        }
        _ => title.trim().to_owned(),
    };
    name = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => ' ',
            c => c,
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if name.chars().count() > 120 {
        name = name.chars().take(120).collect::<String>().trim_end().to_owned();
    }
    format!("{name}.md")
}

/// Normalization key for dedupe/matching: lowercased alphanumeric tokens.
pub fn normalize_key(title: &str, author: Option<&str>) -> String {
    let mut tokens: Vec<String> = Vec::new();
    for part in [Some(title), author].into_iter().flatten() {
        for token in part
            .to_lowercase()
            .split(|c: char| !c.is_alphanumeric())
            .filter(|t| !t.is_empty())
        {
            tokens.push(token.to_owned());
        }
    }
    tokens.join(" ")
}
