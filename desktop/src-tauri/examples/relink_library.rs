//! Repair catalog file links after the library is reorganized on disk.
//!
//! Usage: cargo run --example relink_library -- <library-root>
//!
//! Files are the source of truth and moves/renames are expected; the
//! content hash recorded at match/adopt time is the durable identity.
//! Every on-disk book is hashed, then broken `file:` links are re-pointed
//! at wherever the same content lives now.

use desktop_lib::{catalog, matcher};
use std::collections::HashMap;
use std::path::PathBuf;
use walkdir::WalkDir;

fn main() -> anyhow::Result<()> {
    let Some(root) = std::env::args().nth(1).map(PathBuf::from) else {
        eprintln!("usage: relink_library <library-root>");
        std::process::exit(2);
    };

    // Hash every book on disk (skip dot-dirs and Drop).
    let files: Vec<PathBuf> = WalkDir::new(&root)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            e.depth() == 0 || (!name.starts_with('.') && name != "Drop")
        })
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

    eprintln!("hashing {} files…", files.len());
    let mut by_hash: HashMap<String, String> = HashMap::new();
    for (i, file) in files.iter().enumerate() {
        if i % 100 == 0 {
            eprintln!("  {i}/{}", files.len());
        }
        if let Ok(hash) = matcher::sha256_file(file) {
            let relative = file
                .strip_prefix(&root)
                .unwrap_or(file)
                .to_string_lossy()
                .into_owned();
            by_hash.entry(hash).or_insert(relative);
        }
    }

    let (mut ok, mut relinked, mut lost, mut no_hash) = (0u32, 0u32, 0u32, 0u32);
    for entry in WalkDir::new(root.join("Catalog"))
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter(|e| e.path().extension().is_some_and(|x| x == "md"))
    {
        let Ok(content) = std::fs::read_to_string(entry.path()) else {
            continue;
        };
        let Some((mut parsed, body)) = catalog::parse(&content) else {
            continue;
        };
        let Some(file) = parsed.file.clone() else {
            continue;
        };
        if root.join(&file).exists() {
            ok += 1;
            continue;
        }
        let Some(hash) = parsed.hash.clone() else {
            no_hash += 1;
            continue;
        };
        match by_hash.get(&hash) {
            Some(new_relative) => {
                parsed.file = Some(new_relative.clone());
                std::fs::write(entry.path(), catalog::render(&parsed, &body))?;
                relinked += 1;
            }
            None => {
                // Content is genuinely gone; release the link but keep the
                // hash so a future reappearance can relink again.
                parsed.file = None;
                if parsed.status == "available" {
                    parsed.status = "wishlist".to_owned();
                }
                std::fs::write(entry.path(), catalog::render(&parsed, &body))?;
                lost += 1;
            }
        }
    }

    println!("intact={ok} relinked={relinked} lost={lost} unlinkable_no_hash={no_hash}");
    Ok(())
}
