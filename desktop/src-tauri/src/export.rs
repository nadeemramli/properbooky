use crate::{annotations, article, catalog};
use anyhow::Result;
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use walkdir::WalkDir;

#[derive(Serialize)]
pub struct ExportReport {
    pub books: u32,
    pub highlights: u32,
    pub target: String,
}

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

fn describe_anchor(anchor: &serde_json::Value) -> String {
    if let Some(page) = anchor.get("page").and_then(|p| p.as_i64()) {
        return format!("page {page}");
    }
    match anchor.get("type").and_then(|t| t.as_str()) {
        Some("article") => "article".to_owned(),
        Some("epub-cfi") => "epub location".to_owned(),
        _ => "unknown location".to_owned(),
    }
}

fn yaml_quote(value: &str) -> String {
    serde_yaml::to_string(value)
        .map(|s| s.trim_end().to_owned())
        .unwrap_or_else(|_| format!("\"{value}\""))
}

/// Write one Obsidian-ready markdown note per book/article with live
/// highlights into `out`. Notes are regenerated wholesale — `out` should be
/// a dedicated generated folder (e.g. `<vault>/Properbooky`).
pub fn export_highlights(root: &Path, out: &Path) -> Result<ExportReport> {
    std::fs::create_dir_all(out)?;
    let identities = identities(root);
    let state_dir = root.join(".properbooky").join("state");
    let mut report = ExportReport {
        books: 0,
        highlights: 0,
        target: out.to_string_lossy().into_owned(),
    };

    for entry in WalkDir::new(&state_dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
    {
        let highlights = annotations::live_highlights(entry.path());
        if highlights.is_empty() {
            continue;
        }

        let slug = entry
            .path()
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        let relative = slug.replace("__", "/");
        let (title, author) = identities.get(&relative).cloned().unwrap_or_else(|| {
            let stem = relative
                .rsplit('/')
                .next()
                .and_then(|f| f.rsplit_once('.').map(|(s, _)| s.to_owned()))
                .unwrap_or_else(|| relative.clone());
            (stem, None)
        });

        let mut doc = String::new();
        doc.push_str("---\n");
        doc.push_str(&format!("title: {}\n", yaml_quote(&title)));
        if let Some(author) = &author {
            doc.push_str(&format!("author: {}\n", yaml_quote(author)));
        }
        doc.push_str(&format!("source: {relative}\n"));
        doc.push_str("generated_by: properbooky\n");
        doc.push_str("---\n\n");
        doc.push_str(&format!("# {title}\n\n## Highlights\n\n"));
        for h in &highlights {
            for line in h.text.lines() {
                doc.push_str(&format!("> {line}\n"));
            }
            doc.push_str(&format!(
                "> — {} ^pb-{}\n\n",
                describe_anchor(&h.anchor),
                &h.id[..8]
            ));
            if let Some(note) = &h.note {
                doc.push_str(&format!("**Note:** {note}\n\n"));
            }
            report.highlights += 1;
        }

        let filename = catalog::entry_filename(&title, author.as_deref());
        std::fs::write(out.join(filename), doc)?;
        report.books += 1;
    }

    Ok(report)
}
