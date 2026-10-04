use crate::{annotations, article, catalog};
use anyhow::Result;
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use walkdir::WalkDir;

#[derive(Serialize)]
pub struct ExportReport {
    pub books: u32,
    pub highlights: u32,
    pub target: String,
    /// Notes rewritten this run (unchanged notes are left untouched).
    pub written: u32,
    /// Problems that kept a note from being written, e.g. an unreadable
    /// sidecar or a file in the folder that Properbooky did not create.
    pub skipped: Vec<String>,
}

/// Generated region of a note. Everything outside it (and any frontmatter
/// keys other than ours) belongs to the user and survives every sync.
pub const BLOCK_START: &str =
    "<!-- properbooky:highlights:start (regenerated on sync; write your own notes outside this block) -->";
pub const BLOCK_END: &str = "<!-- properbooky:highlights:end -->";
const GENERATED_BY: &str = "properbooky";

/// Identity (title, author) for every linked asset: catalog entries keyed by
/// their file, plus articles keyed by their own path.
fn identities(root: &Path) -> HashMap<String, (String, Option<String>)> {
    let mut map = HashMap::new();
    for entry in WalkDir::new(root.join("Catalog"))
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter(|e| e.path().extension().is_some_and(|x| x == "md"))
    {
        let Ok(content) = std::fs::read_to_string(entry.path()) else {
            continue;
        };
        if let Some((parsed, _)) = catalog::parse(&content) {
            if let Some(file) = parsed.file {
                map.insert(file, (parsed.title, parsed.author));
            }
        }
    }
    for entry in WalkDir::new(root.join("Articles"))
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter(|e| e.path().extension().is_some_and(|x| x == "md"))
    {
        let Ok(content) = std::fs::read_to_string(entry.path()) else {
            continue;
        };
        if let Some((meta, _)) = article::parse(&content) {
            let relative = entry
                .path()
                .strip_prefix(root)
                .unwrap_or(entry.path())
                .to_string_lossy()
                .into_owned();
            map.insert(relative, (meta.title, meta.author));
        }
    }
    map
}

/// Human location for the export line: PDF page; EPUB chapter and percent
/// recorded with the highlight; article.
pub fn describe_anchor(anchor: &serde_json::Value) -> String {
    if let Some(page) = anchor.get("page").and_then(|p| p.as_i64()) {
        return format!("page {page}");
    }
    match anchor.get("type").and_then(|t| t.as_str()) {
        Some("article") => "article".to_owned(),
        Some("epub-cfi") => {
            let chapter = anchor
                .get("chapter")
                .and_then(|c| c.as_str())
                .map(str::trim)
                .filter(|c| !c.is_empty());
            let percent = anchor
                .get("percent")
                .and_then(|p| p.as_f64())
                .filter(|p| p.is_finite() && (0.0..=1.0).contains(p))
                .map(|p| format!("{}%", (p * 100.0).round() as i64));
            match (chapter, percent) {
                (Some(c), Some(p)) => format!("{c} · {p}"),
                (Some(c), None) => c.to_owned(),
                (None, Some(p)) => p,
                (None, None) => "epub location".to_owned(),
            }
        }
        _ => "unknown location".to_owned(),
    }
}

/// The stable Obsidian block id of a highlight (`^pb-…`), derived from its
/// UUID so links survive re-export, edits and moves.
pub fn block_id(id: &str) -> String {
    format!("pb-{}", &id[..id.len().min(8)])
}

fn render_block(title: &str, highlights: &[annotations::Highlight]) -> String {
    let mut block = String::new();
    block.push_str(BLOCK_START);
    block.push_str(&format!("\n# {title}\n\n## Highlights\n\n"));
    if highlights.is_empty() {
        block.push_str("_No highlights._\n\n");
    }
    for h in highlights {
        for line in h.text.lines() {
            block.push_str(&format!("> {line}\n"));
        }
        block.push_str(&format!(
            "> — {} ^{}\n\n",
            describe_anchor(&h.anchor),
            block_id(&h.id)
        ));
        if let Some(note) = &h.note {
            let mut lines = note.lines();
            if let Some(first) = lines.next() {
                block.push_str(&format!("**Note:** {first}\n"));
            }
            for line in lines {
                block.push_str(&format!("{line}\n"));
            }
            block.push('\n');
        }
    }
    block.push_str(BLOCK_END);
    block.push('\n');
    block
}

/// Split `---` YAML frontmatter from the body.
fn split_frontmatter(text: &str) -> (Option<&str>, &str) {
    if let Some(rest) = text.strip_prefix("---\n") {
        if let Some(end) = rest.find("\n---\n") {
            return (Some(&rest[..end]), &rest[end + 5..]);
        }
    }
    (None, text)
}

fn frontmatter_mapping(front: &str) -> Option<serde_yaml::Mapping> {
    match serde_yaml::from_str::<serde_yaml::Value>(front).ok()? {
        serde_yaml::Value::Mapping(m) => Some(m),
        serde_yaml::Value::Null => Some(serde_yaml::Mapping::new()),
        _ => None,
    }
}

fn get_str<'a>(map: &'a serde_yaml::Mapping, key: &str) -> Option<&'a str> {
    map.get(key).and_then(|v| v.as_str())
}

/// One `key: value` line as serde_yaml writes it (quoted when needed).
fn render_property(key: &str, value: &str) -> String {
    let mut map = serde_yaml::Mapping::new();
    map.insert(key.into(), value.into());
    let yaml = serde_yaml::to_string(&map).unwrap_or_default();
    yaml.strip_suffix('\n').unwrap_or(&yaml).to_owned()
}

/// Whether a top-level `key: value` line can be rewritten without losing
/// anything the user wrote: a single-line plain or fully quoted scalar (or
/// nothing) and no comment. Anything else is left to the user.
fn rewritable_property(line: &str, key: &str) -> bool {
    let Some(value) = line
        .strip_prefix(key)
        .and_then(|rest| rest.strip_prefix(':'))
    else {
        return false;
    };
    if !(value.is_empty() || value.starts_with(' ')) {
        return false;
    }
    let value = value.trim_start_matches(' ');
    let closes_at_end = |quote: char| {
        let mut chars = value.char_indices().skip(1).peekable();
        while let Some((i, c)) = chars.next() {
            if quote == '"' && c == '\\' {
                chars.next();
            } else if c == quote {
                if quote == '\'' && chars.peek().is_some_and(|&(_, n)| n == '\'') {
                    chars.next();
                    continue;
                }
                return i + c.len_utf8() == value.len();
            }
        }
        false
    };
    match value.chars().next() {
        None => true,
        Some('"') => closes_at_end('"'),
        Some('\'') => closes_at_end('\''),
        Some(c) if "[{|>&*!%@`#,".contains(c) => false,
        Some('-' | '?' | ':') if value.len() == 1 || value[1..].starts_with(' ') => false,
        Some(_) => !value.contains(" #") && !value.contains('\t') && !value.ends_with(' '),
    }
}

/// Ours, with everything else the user wrote kept byte for byte. The
/// existing text is reused verbatim when our keys already hold these
/// values; otherwise only our own top-level lines are replaced, inserted or
/// removed, and the result must parse to the user's properties unchanged.
/// When that cannot be done safely the note is left alone, with the reason.
fn merge_frontmatter(
    existing: Option<&str>,
    title: &str,
    author: Option<&str>,
    source: &str,
) -> std::result::Result<String, String> {
    let wanted: [(&str, Option<&str>); 4] = [
        ("title", Some(title)),
        ("author", author),
        ("source", Some(source)),
        ("generated_by", Some(GENERATED_BY)),
    ];
    let Some(front) = existing else {
        let mut map = serde_yaml::Mapping::new();
        for (key, value) in wanted {
            if let Some(v) = value {
                map.insert(key.into(), v.into());
            }
        }
        let yaml = serde_yaml::to_string(&map).unwrap_or_default();
        return Ok(format!("---\n{}---\n", yaml));
    };
    let map = frontmatter_mapping(front).unwrap_or_default();
    if wanted.iter().all(|(k, v)| get_str(&map, k) == *v) {
        return Ok(format!("---\n{front}\n---\n"));
    }
    if front.contains('\r') {
        return Err(frontmatter_refusal(
            "its properties use Windows (CRLF) line endings",
            "save them with LF line endings",
        ));
    }
    let lines: Vec<&str> = front.split('\n').collect();
    // Output lines per original line (replacement plus insertions), and
    // lines added after the last one.
    let mut slots: Vec<Vec<String>> = lines.iter().map(|l| vec![(*l).to_owned()]).collect();
    let mut tail: Vec<String> = Vec::new();
    let position = |key: &str| -> Vec<usize> {
        let prefix = format!("{key}:");
        lines
            .iter()
            .enumerate()
            .filter(|(_, l)| l.starts_with(&prefix))
            .map(|(i, _)| i)
            .collect()
    };
    for (n, (key, value)) in wanted.iter().enumerate() {
        if get_str(&map, key) == *value {
            continue;
        }
        let found = position(key);
        if found.len() != usize::from(map.contains_key(*key)) {
            return Err(frontmatter_refusal(
                &format!("its `{key}` property appears more than once or in a form Properbooky did not write"),
                &format!("keep a single `{key}:` line"),
            ));
        }
        match found.first() {
            Some(&i) => {
                let continued = lines
                    .get(i + 1)
                    .is_some_and(|next| next.starts_with([' ', '\t']));
                if !rewritable_property(lines[i], key) || continued {
                    return Err(frontmatter_refusal(
                        &format!("its `{key}:` line has a comment or formatting Properbooky did not write"),
                        &format!("put `{key}:` back on one line without a comment (comments on their own lines are kept)"),
                    ));
                }
                // Ours: replaced, or removed when it no longer applies.
                slots[i].remove(0);
                if let Some(v) = value {
                    slots[i].insert(0, render_property(key, v));
                }
            }
            None => {
                let Some(v) = value else { continue };
                let line = render_property(key, v);
                // Next to our other keys: after the previous one, else before
                // the next one, else at the end.
                let before = wanted[..n]
                    .iter()
                    .rev()
                    .find_map(|(k, _)| position(k).first().copied());
                let after = wanted[n + 1..]
                    .iter()
                    .find_map(|(k, _)| position(k).first().copied());
                match (before, after) {
                    (Some(i), _) => slots[i].push(line),
                    (None, Some(i)) => slots[i].insert(0, line),
                    (None, None) => tail.push(line),
                }
            }
        }
    }
    let updated: Vec<String> = slots.into_iter().flatten().chain(tail).collect();
    let updated = updated.join("\n");
    // Proof: the user's properties are exactly as before, ours as wanted.
    let check = frontmatter_mapping(&updated);
    let ours = |k: &serde_yaml::Value| wanted.iter().any(|(w, _)| k.as_str() == Some(*w));
    let same = check.as_ref().is_some_and(|new| {
        wanted
            .iter()
            .all(|(k, v)| get_str(new, k) == *v && (v.is_some() || !new.contains_key(*k)))
            && map
                .iter()
                .filter(|(k, _)| !ours(k))
                .all(|(k, v)| new.get(k) == Some(v))
            && new.iter().filter(|(k, _)| !ours(k)).count()
                == map.iter().filter(|(k, _)| !ours(k)).count()
    });
    if !same {
        return Err(frontmatter_refusal(
            "Properbooky could not prove the update keeps your properties unchanged",
            "simplify its `title:`, `author:` and `source:` lines to one plain line each",
        ));
    }
    Ok(format!("---\n{updated}\n---\n"))
}

/// Why Properbooky's properties could not be updated, and how to fix it.
fn frontmatter_refusal(problem: &str, fix: &str) -> String {
    format!(
        "{problem}, so Properbooky cannot update its title, author or source without changing what you \
         wrote. To sync it again, {fix}, {KEEP_AS_OWN}"
    )
}

/// Location text the exporter wrote before markers (every version up to
/// 44e96b6): only PDF pages were described in detail.
fn legacy_describe_anchor(anchor: &serde_json::Value) -> String {
    if let Some(page) = anchor.get("page").and_then(|p| p.as_i64()) {
        return format!("page {page}");
    }
    match anchor.get("type").and_then(|t| t.as_str()) {
        Some("article") => "article".to_owned(),
        Some("epub-cfi") => "epub location".to_owned(),
        _ => "unknown location".to_owned(),
    }
}

/// The exact lines the pre-marker exporter wrote for one highlight, without
/// its note: quote lines, the attribution line and a blank line.
fn legacy_entry(h: &annotations::Highlight) -> String {
    let mut entry = String::new();
    for line in h.text.lines() {
        entry.push_str(&format!("> {line}\n"));
    }
    entry.push_str(&legacy_attribution(h));
    entry.push_str("\n\n");
    entry
}

fn legacy_attribution(h: &annotations::Highlight) -> String {
    format!(
        "> — {} ^pb-{}",
        legacy_describe_anchor(&h.anchor),
        &h.id[..h.id.len().min(8)]
    )
}

/// Every refusal's way out that needs no repair of the generated text.
const KEEP_AS_OWN: &str =
    "or remove the line `generated_by: properbooky` from its frontmatter to keep this file as \
     your own (Properbooky then writes a new note beside it)";

/// The user's part of a note written by the exporter before markers, or why
/// it cannot be told apart. Ownership is proven, never guessed from Markdown:
/// only bytes identical to what that exporter wrote for this book (its
/// title, and each highlight of this book's sidecar, removed ones included)
/// count as generated; everything after them is returned verbatim.
fn legacy_user_part<'a>(
    body: &'a str,
    titles: &[&str],
    known: &[annotations::Highlight],
) -> std::result::Result<&'a str, String> {
    if body.is_empty() {
        return Ok(body);
    }
    let header = titles
        .iter()
        .map(|t| format!("\n# {t}\n\n## Highlights\n\n"))
        .find(|h| body.starts_with(h.as_str()));
    let Some(header) = header else {
        return Err(format!(
            "written by an older Properbooky, and its \"# title\" and \"## Highlights\" lines are no longer \
             at the top as it wrote them, so Properbooky cannot tell its highlights from your writing. To \
             sync it again, put those two lines back at the top, {KEEP_AS_OWN}"
        ));
    };
    let mut rest = &body[header.len()..];
    let entries: Vec<String> = known.iter().map(legacy_entry).collect();
    let mut used = vec![false; known.len()];
    'entries: loop {
        for (i, h) in known.iter().enumerate() {
            if used[i] {
                continue;
            }
            let Some(after) = rest.strip_prefix(entries[i].as_str()) else {
                continue;
            };
            used[i] = true;
            rest = after;
            if let Some(note) = &h.note {
                rest = rest
                    .strip_prefix(format!("**Note:** {note}\n\n").as_str())
                    .unwrap_or(rest);
            }
            continue 'entries;
        }
        break;
    }
    // A generated attribution line after unproven text means the user wrote
    // between highlights (or edited/duplicated one): keeping it would
    // duplicate the highlight, dropping it could drop the user's text.
    let attributions: Vec<String> = known.iter().map(legacy_attribution).collect();
    if rest
        .split('\n')
        .map(|l| l.strip_suffix('\r').unwrap_or(l))
        .any(|l| attributions.iter().any(|a| a == l))
    {
        return Err(format!(
            "written by an older Properbooky and you wrote between its highlights (or edited one), so \
             Properbooky cannot tell its highlights from your writing. To sync it again, move your own text \
             to the end of the note, below the last highlight and the blank line after it, {KEEP_AS_OWN}"
        ));
    }
    Ok(rest)
}

/// The complete new note, keeping user content from `existing`, or why the
/// existing note must be left unchanged.
fn compose(
    existing: Option<&str>,
    title: &str,
    author: Option<&str>,
    source: &str,
    block: &str,
    known: &[annotations::Highlight],
) -> std::result::Result<String, String> {
    let (front, body) = existing.map(split_frontmatter).unwrap_or((None, ""));
    let frontmatter = merge_frontmatter(front, title, author, source)?;
    let body = match (body.find(BLOCK_START), body.find(BLOCK_END)) {
        (Some(start), Some(end)) if end > start => {
            let after = &body[end + BLOCK_END.len()..];
            let after = after.strip_prefix('\n').unwrap_or(after);
            format!("{}{}{}", &body[..start], block, after)
        }
        (None, None) => {
            // First export, or a note from the exporter before markers.
            let front_title = front
                .and_then(frontmatter_mapping)
                .and_then(|m| get_str(&m, "title").map(str::to_owned));
            let mut titles = vec![title];
            titles.extend(front_title.as_deref());
            let user = legacy_user_part(body, &titles, known)?;
            if user.is_empty() {
                format!("\n{block}")
            } else {
                format!("\n{block}\n{user}")
            }
        }
        _ => {
            return Err(format!(
                "one of its two highlights block markers is missing or out of order, so Properbooky cannot \
                 tell its highlights from your writing. To sync it again, put back the marker lines \
                 `{BLOCK_START}` and `{BLOCK_END}` around the highlights, {KEEP_AS_OWN}"
            ));
        }
    };
    Ok(format!("{frontmatter}{body}"))
}

/// Existing notes in `out` that Properbooky generated, keyed by `source:`,
/// so a book keeps its note (and the user's text in it) even when its title
/// or author changes. Also returns every file name already present.
fn existing_notes(out: &Path) -> (HashMap<String, String>, std::collections::HashSet<String>) {
    let mut by_source = HashMap::new();
    let mut names = std::collections::HashSet::new();
    let Ok(entries) = std::fs::read_dir(out) else {
        return (by_source, names);
    };
    let mut entries: Vec<_> = entries.filter_map(|e| e.ok()).collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.ends_with(".md") || !entry.path().is_file() {
            continue;
        }
        names.insert(name.clone());
        let Ok(text) = std::fs::read_to_string(entry.path()) else {
            continue;
        };
        if let (Some(front), _) = split_frontmatter(&text) {
            if let Some(map) = frontmatter_mapping(front) {
                if get_str(&map, "generated_by") == Some(GENERATED_BY) {
                    if let Some(source) = get_str(&map, "source") {
                        by_source.entry(source.to_owned()).or_insert(name);
                    }
                }
            }
        }
    }
    (by_source, names)
}

/// Write one Obsidian-ready markdown note per book/article with highlights
/// into `out` (a dedicated folder, e.g. `<vault>/Properbooky`). Only the
/// marked highlights block and our frontmatter keys are regenerated; user
/// text survives, and an unchanged note is not rewritten.
pub fn export_highlights(root: &Path, out: &Path) -> Result<ExportReport> {
    std::fs::create_dir_all(out)?;
    let mut identities = identities(root);
    let registry = crate::identity::Registry::load(root)?;
    crate::library::export_identities(root, &registry, &mut identities)?;
    let state_dir = root.join(".properbooky").join("state");
    let mut report = ExportReport {
        books: 0,
        highlights: 0,
        target: out.to_string_lossy().into_owned(),
        written: 0,
        skipped: Vec::new(),
    };

    struct Note {
        state_name: String,
        source: String,
        title: String,
        author: Option<String>,
        live: Vec<annotations::Highlight>,
        /// Live and removed: proof of what an older export wrote.
        known: Vec<annotations::Highlight>,
    }
    let mut notes: BTreeMap<String, Vec<Note>> = BTreeMap::new();

    let mut sidecars: Vec<_> = WalkDir::new(&state_dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
        .collect();
    sidecars.sort_by(|a, b| a.path().cmp(b.path()));
    for entry in sidecars {
        // Strict and read-only: an unreadable sidecar must never empty a note.
        let sidecar: annotations::Sidecar = match std::fs::read(entry.path())
            .map_err(anyhow::Error::from)
            .and_then(|bytes| serde_json::from_slice(&bytes).map_err(Into::into))
        {
            Ok(sidecar) => sidecar,
            Err(e) => {
                report.skipped.push(format!(
                    "{}: reading state is unreadable ({e})",
                    entry.file_name().to_string_lossy()
                ));
                continue;
            }
        };
        if sidecar.highlights.is_empty() {
            continue;
        }
        let known = sidecar.highlights;
        let mut live: Vec<_> = known.iter().filter(|h| !h.deleted).cloned().collect();
        live.sort_by(|a, b| a.created_at.cmp(&b.created_at).then(a.id.cmp(&b.id)));

        let slug = entry
            .path()
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        let name = format!("{slug}.json");
        let relative = registry
            .records
            .iter()
            .find(|r| r.state_file.as_deref() == Some(&name))
            .map(|r| r.path.clone())
            .unwrap_or_else(|| slug.replace("__", "/"));
        let (title, author) = identities.get(&relative).cloned().unwrap_or_else(|| {
            // Uncatalogued file: its own metadata (EPUB title/creator), the
            // file stem otherwise — the same title the library grid shows.
            let filename = relative.rsplit('/').next().unwrap_or(&relative).to_owned();
            let ext = filename
                .rsplit_once('.')
                .map(|(_, e)| e.to_ascii_lowercase())
                .unwrap_or_default();
            let path = root.join(&relative);
            if path.is_file() {
                crate::scanner::extract_metadata(&path, &ext, &filename)
            } else {
                let stem = filename
                    .rsplit_once('.')
                    .map(|(s, _)| s.to_owned())
                    .unwrap_or(filename);
                (stem, None)
            }
        });
        let filename = catalog::entry_filename(&title, author.as_deref());
        notes.entry(filename).or_default().push(Note {
            state_name: name,
            source: relative,
            title,
            author,
            live,
            known,
        });
    }

    let (by_source, names) = existing_notes(out);
    for (filename, group) in notes {
        let collision = group.len() > 1;
        for note in group {
            let destination = match by_source.get(&note.source) {
                Some(existing) => existing.clone(),
                None => {
                    let hashed = || {
                        use sha2::Digest;
                        let suffix =
                            format!("{:x}", sha2::Sha256::digest(note.state_name.as_bytes()));
                        format!(
                            "{} - {}.md",
                            filename.trim_end_matches(".md"),
                            &suffix[..12]
                        )
                    };
                    if collision || names.contains(&filename) {
                        hashed()
                    } else {
                        filename.clone()
                    }
                }
            };
            let path = out.join(&destination);
            let existing = std::fs::read_to_string(&path).ok();
            if let Some(text) = &existing {
                let ours = split_frontmatter(text)
                    .0
                    .and_then(frontmatter_mapping)
                    .is_some_and(|m| get_str(&m, "generated_by") == Some(GENERATED_BY));
                if !ours {
                    report.skipped.push(format!(
                        "{destination}: not created by Properbooky; left unchanged"
                    ));
                    continue;
                }
            } else if note.live.is_empty() {
                // Every highlight removed and no note yet: nothing to write.
                continue;
            }
            let block = render_block(&note.title, &note.live);
            let text = match compose(
                existing.as_deref(),
                &note.title,
                note.author.as_deref(),
                &note.source,
                &block,
                &note.known,
            ) {
                Ok(text) => text,
                Err(reason) => {
                    report
                        .skipped
                        .push(format!("{destination}: left unchanged: {reason}."));
                    continue;
                }
            };
            if existing.as_deref() != Some(text.as_str()) {
                crate::identity::atomic_write(&path, text.as_bytes())?;
                report.written += 1;
            }
            if !note.live.is_empty() {
                report.books += 1;
                report.highlights += note.live.len() as u32;
            }
        }
    }

    Ok(report)
}
