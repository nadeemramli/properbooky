//! Adopt unmatched library files into the catalog: every owned book gets a
//! catalog entry (status available, file + hash linked, name normalized).
//!
//! Usage: cargo run --example adopt_library -- <library-root>
//!
//! Only files with NO plausible catalog match are adopted — files with a
//! pending review match are left for `match_library` triage so they don't
//! become duplicate entries. Renames record original_filename (reversible).

use desktop_lib::catalog::{self, CatalogEntry};
use desktop_lib::{matcher, scanner};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

fn main() -> anyhow::Result<()> {
    let Some(root) = std::env::args().nth(1).map(PathBuf::from) else {
        eprintln!("usage: adopt_library <library-root>");
        std::process::exit(2);
    };
    let catalog_dir = root.join("Catalog");

    // Load candidates and the set of already-linked files.
    let mut candidates = Vec::new();
    let mut linked: HashSet<PathBuf> = HashSet::new();
    for entry in WalkDir::new(&catalog_dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter(|e| e.path().extension().is_some_and(|x| x == "md"))
    {
        let Ok(content) = std::fs::read_to_string(entry.path()) else {
            continue;
        };
        if let Some((parsed, _)) = catalog::parse(&content) {
            if let Some(file) = &parsed.file {
                linked.insert(root.join(file));
            }
            candidates.push(matcher::CatalogCandidate {
                path: entry.path().to_owned(),
                title: parsed.title,
                author: parsed.author,
            });
        }
    }

    let files: Vec<PathBuf> = WalkDir::new(&root)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter(|e| {
            e.path()
                .extension()
                .and_then(|x| x.to_str())
                .map(|x| x.to_ascii_lowercase())
                .is_some_and(|x| x == "epub" || x == "pdf")
        })
        .map(|e| e.path().to_owned())
        .collect();

    let (mut adopted, mut renamed, mut already_linked, mut left_for_review, mut collisions) =
        (0u32, 0u32, 0u32, 0u32, 0u32);

    for file in &files {
        if linked.contains(file) {
            already_linked += 1;
            continue;
        }
        match matcher::match_file(file, &candidates) {
            Some(row) if row.decision != matcher::Decision::Unmatched => {
                left_for_review += 1;
                continue;
            }
            _ => {}
        }

        let filename = file
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let ext = file
            .extension()
            .map(|x| x.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        let (title, author) = scanner::extract_metadata(file, &ext, &filename);

        let md_path = catalog_dir.join(catalog::entry_filename(&title, author.as_deref()));
        if md_path.exists() {
            collisions += 1;
            continue;
        }

        // Normalize the book's own filename from its (extracted) identity.
        let proposed = catalog::entry_filename(&title, author.as_deref());
        let proposed = format!("{}.{ext}", proposed.trim_end_matches(".md"));
        let target = file.with_file_name(&proposed);
        let (did_rename, final_path) = if target != *file && !target.exists() {
            std::fs::rename(file, &target)?;
            (true, target)
        } else {
            (false, file.clone())
        };

        let relative = final_path
            .strip_prefix(&root)
            .unwrap_or(&final_path)
            .to_string_lossy()
            .into_owned();
        let category = final_path
            .strip_prefix(&root)
            .ok()
            .and_then(|rel| rel.parent())
            .and_then(|parent| parent.components().next())
            .map(|c| c.as_os_str().to_string_lossy().into_owned());

        let entry = CatalogEntry {
            title,
            author,
            status: "available".to_owned(),
            topics: category.into_iter().collect(),
            source: Some("adopted-from-file".to_owned()),
            file: Some(relative),
            hash: Some(matcher::sha256_file(&final_path)?),
            original_filename: did_rename.then_some(filename),
            ..Default::default()
        };
        std::fs::write(&md_path, catalog::render(&entry, ""))?;
        adopted += 1;
        if did_rename {
            renamed += 1;
        }
    }

    println!(
        "adopted={adopted} renamed={renamed} already_linked={already_linked} left_for_review={left_for_review} collisions={collisions}"
    );
    Ok(())
}
