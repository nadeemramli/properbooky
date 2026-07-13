//! Export highlights to Obsidian-ready markdown, one note per book.
//!
//! Usage: cargo run --example export_highlights -- <library-root> <output-dir>
//!
//! Reads `.properbooky/state/*.json` sidecars, resolves book identity from
//! the catalog (falling back to the filename), and writes/overwrites
//! `<output-dir>/<Author - Title>.md`. Each highlight carries a stable
//! `^pb-<id>` block marker so downstream links survive re-export.

use desktop_lib::{annotations, catalog};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

fn catalog_by_file(root: &Path) -> HashMap<String, (String, Option<String>)> {
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
    map
}

fn describe_anchor(anchor: &serde_json::Value) -> String {
    if let Some(page) = anchor.get("page").and_then(|p| p.as_i64()) {
        return format!("page {page}");
    }
    if anchor.get("cfi").is_some() {
        return "epub location".to_owned();
    }
    "unknown location".to_owned()
}

fn main() -> anyhow::Result<()> {
    let mut args = std::env::args().skip(1);
    let (Some(root), Some(out)) = (args.next(), args.next()) else {
        eprintln!("usage: export_highlights <library-root> <output-dir>");
        std::process::exit(2);
    };
    let root = PathBuf::from(root);
    let out = PathBuf::from(out);
    std::fs::create_dir_all(&out)?;

    let identities = catalog_by_file(&root);
    let state_dir = root.join(".properbooky").join("state");
    let (mut books, mut total) = (0u32, 0u32);

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

        // Sidecar slug encodes the book's library-relative path.
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
        doc.push_str(&format!("title: {}\n", serde_yaml_quote(&title)));
        if let Some(author) = &author {
            doc.push_str(&format!("author: {}\n", serde_yaml_quote(author)));
        }
        doc.push_str(&format!("source: {relative}\n"));
        doc.push_str("generated_by: properbooky\n");
        doc.push_str("---\n\n");
        doc.push_str(&format!("# {title}\n\n## Highlights\n\n"));
        for h in &highlights {
            for line in h.text.lines() {
                doc.push_str(&format!("> {line}\n"));
            }
            doc.push_str(&format!("> — {} ^pb-{}\n\n", describe_anchor(&h.anchor), &h.id[..8]));
            if let Some(note) = &h.note {
                doc.push_str(&format!("**Note:** {note}\n\n"));
            }
            total += 1;
        }

        let filename = catalog::entry_filename(&title, author.as_deref());
        std::fs::write(out.join(filename), doc)?;
        books += 1;
    }

    println!("exported {total} highlights across {books} books to {}", out.display());
    Ok(())
}

fn serde_yaml_quote(value: &str) -> String {
    serde_yaml::to_string(value)
        .map(|s| s.trim_end().to_owned())
        .unwrap_or_else(|_| format!("\"{value}\""))
}
