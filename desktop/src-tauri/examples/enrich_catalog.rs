//! Cache reviewed-enrichment candidates without rewriting Catalog files.
//! Usage: cargo run --example enrich_catalog -- <library-root> [limit=20]
//! Accept suggestions in the desktop's Review details screen. Work-level
//! ISBN lists and first-publication years never identify a particular copy.
use desktop_lib::{catalog, enrich};
use std::path::PathBuf;
use walkdir::WalkDir;

fn main() -> anyhow::Result<()> {
    let mut args = std::env::args().skip(1);
    let root = args
        .next()
        .map(PathBuf::from)
        .ok_or_else(|| anyhow::anyhow!("usage: enrich_catalog <library-root> [limit=20]"))?;
    anyhow::ensure!(
        root.join("Catalog").is_dir(),
        "library has no Catalog folder"
    );
    let limit: usize = args.next().map(|n| n.parse()).transpose()?.unwrap_or(20);
    let mut cached = 0;
    for entry in WalkDir::new(root.join("Catalog")).sort_by_file_name() {
        let entry = entry?;
        if cached >= limit {
            break;
        }
        if !entry.file_type().is_file()
            || entry.path().extension().and_then(|e| e.to_str()) != Some("md")
        {
            continue;
        }
        let raw = std::fs::read_to_string(entry.path())?;
        let Some((profile, _)) = catalog::parse(&raw) else {
            continue;
        };
        let suggestions = enrich::search(
            &root,
            &profile.title,
            profile.author.as_deref().unwrap_or(""),
            false,
        )?;
        println!(
            "{}: {} candidates{}",
            profile.title,
            suggestions.docs.len(),
            if suggestions.stale {
                " (cached; online unavailable)"
            } else {
                ""
            }
        );
        cached += 1;
    }
    println!("Prepared {cached} searches. Review suggestions in the desktop app; no catalog entries were changed.");
    Ok(())
}
