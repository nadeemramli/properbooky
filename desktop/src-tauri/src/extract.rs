use anyhow::Result;
use std::path::Path;

/// Extract readable text from a library asset. EPUB walks the spine and
/// strips markup; PDF uses pure-Rust pdf-extract (imperfect on scanned or
/// exotic layouts — pdfium is the future upgrade per TRD-3); markdown
/// returns the body (frontmatter dropped).
pub fn extract_text(path: &Path) -> Result<String> {
    let ext = path
        .extension()
        .and_then(|x| x.to_str())
        .map(|x| x.to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "epub" => extract_epub(path),
        "pdf" => extract_pdf(path),
        "md" => extract_md(path),
        other => anyhow::bail!("no text extraction for .{other}"),
    }
}

fn extract_epub(path: &Path) -> Result<String> {
    let mut doc = epub::doc::EpubDoc::new(path)
        .map_err(|e| anyhow::anyhow!("epub open: {e:?}"))?;
    let mut out = String::new();
    loop {
        if let Some((content, _mime)) = doc.get_current_str() {
            out.push_str(&strip_tags(&content));
            out.push('\n');
        }
        if !doc.go_next() {
            break;
        }
    }
    Ok(out)
}

fn extract_pdf(path: &Path) -> Result<String> {
    // pdf-extract panics on some malformed files; contain it.
    let path = path.to_owned();
    std::panic::catch_unwind(move || pdf_extract::extract_text(&path))
        .map_err(|_| anyhow::anyhow!("pdf extraction panicked"))?
        .map_err(|e| anyhow::anyhow!("pdf extraction: {e}"))
}

fn extract_md(path: &Path) -> Result<String> {
    let raw = std::fs::read_to_string(path)?;
    let body = raw
        .strip_prefix("---")
        .and_then(|rest| rest.split_once("\n---").map(|(_, b)| b))
        .unwrap_or(&raw);
    Ok(body.to_owned())
}

/// Cheap HTML→text: drop tags, scripts/styles, decode common entities.
fn strip_tags(html: &str) -> String {
    const ENTITIES: [(&str, char); 7] = [
        ("&amp;", '&'),
        ("&lt;", '<'),
        ("&gt;", '>'),
        ("&quot;", '"'),
        ("&#39;", '\''),
        ("&apos;", '\''),
        ("&nbsp;", ' '),
    ];
    let lower = html.to_lowercase();
    let mut out = String::with_capacity(html.len() / 2);
    let mut skip_until: Option<&str> = None;
    let mut i = 0;
    while i < html.len() {
        if let Some(end_tag) = skip_until {
            match lower[i..].find(end_tag) {
                Some(pos) => {
                    i += pos + end_tag.len();
                    skip_until = None;
                }
                None => break,
            }
            continue;
        }
        let rest = &html[i..];
        if rest.starts_with('<') {
            let rest_lower = &lower[i..];
            if rest_lower.starts_with("<script") {
                skip_until = Some("</script>");
                i += 7;
                continue;
            }
            if rest_lower.starts_with("<style") {
                skip_until = Some("</style>");
                i += 6;
                continue;
            }
            match rest.find('>') {
                Some(pos) => {
                    // Block-ish closers become line breaks so words don't fuse.
                    if rest_lower.starts_with("</p")
                        || rest_lower.starts_with("<br")
                        || rest_lower.starts_with("</h")
                        || rest_lower.starts_with("</div")
                        || rest_lower.starts_with("</li")
                    {
                        out.push('\n');
                    }
                    i += pos + 1;
                }
                None => break,
            }
            continue;
        }
        if let Some((entity, decoded)) = ENTITIES.iter().find(|(e, _)| rest.starts_with(e)) {
            out.push(*decoded);
            i += entity.len();
            continue;
        }
        let ch = rest.chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

const TARGET_CHUNK: usize = 1200;

/// Paragraph-preserving chunker: packs paragraphs up to ~TARGET_CHUNK chars;
/// oversized paragraphs split on sentence-ish boundaries.
pub fn chunk_text(text: &str) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current = String::new();
    for para in text.split("\n\n").flat_map(|p| p.split('\n')) {
        let para = para.trim();
        if para.is_empty() {
            continue;
        }
        if current.len() + para.len() + 1 > TARGET_CHUNK && !current.is_empty() {
            chunks.push(std::mem::take(&mut current));
        }
        if para.len() > TARGET_CHUNK {
            for piece in split_long(para) {
                if current.len() + piece.len() + 1 > TARGET_CHUNK && !current.is_empty() {
                    chunks.push(std::mem::take(&mut current));
                }
                push_part(&mut current, &piece);
            }
        } else {
            push_part(&mut current, para);
        }
    }
    if !current.trim().is_empty() {
        chunks.push(current);
    }
    chunks
}

fn push_part(current: &mut String, part: &str) {
    if !current.is_empty() {
        current.push(' ');
    }
    current.push_str(part);
}

fn split_long(para: &str) -> Vec<String> {
    let mut pieces = Vec::new();
    let mut current = String::new();
    for sentence in para.split_inclusive(['.', '?', '!']) {
        if current.len() + sentence.len() > TARGET_CHUNK && !current.is_empty() {
            pieces.push(std::mem::take(&mut current));
        }
        current.push_str(sentence);
    }
    if !current.is_empty() {
        pieces.push(current);
    }
    pieces
}
