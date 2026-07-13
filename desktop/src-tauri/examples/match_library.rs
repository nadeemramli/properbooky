//! Match library files to catalog entries; plan first, then apply.
//!
//! Usage:
//!   cargo run --example match_library -- plan  <library-root>
//!   cargo run --example match_library -- apply <library-root>
//!
//! `plan` writes `<library>/Catalog/.match-plan.tsv` (decision, score, file,
//! proposed name, catalog entry). Edit `review` → `accept` for matches you
//! confirm. `apply` executes rows marked `auto` or `accept`: renames the file
//! in place (never clobbers), records file+hash+original_filename in the
//! catalog entry, and flips wishlist/queued → available.

use desktop_lib::{catalog, matcher};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

const PLAN_FILE: &str = "Catalog/.match-plan.tsv";

fn load_candidates(catalog_dir: &Path) -> Vec<matcher::CatalogCandidate> {
    let mut out = Vec::new();
    for entry in WalkDir::new(catalog_dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter(|e| e.path().extension().is_some_and(|x| x == "md"))
    {
        let Ok(content) = std::fs::read_to_string(entry.path()) else {
            continue;
        };
        if let Some((parsed, _)) = catalog::parse(&content) {
            out.push(matcher::CatalogCandidate {
                path: entry.path().to_owned(),
                title: parsed.title,
                author: parsed.author,
            });
        }
    }
    out
}

fn library_files(root: &Path) -> Vec<PathBuf> {
    WalkDir::new(root)
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
        .collect()
}

fn plan(root: &Path) -> anyhow::Result<()> {
    let candidates = load_candidates(&root.join("Catalog"));
    let files = library_files(root);
    eprintln!("{} catalog entries, {} files", candidates.len(), files.len());

    let (mut auto, mut review, mut unmatched) = (0u32, 0u32, 0u32);
    let mut lines = vec!["decision\tscore\tfile\tproposed_name\tcatalog_entry".to_owned()];
    for file in &files {
        match matcher::match_file(file, &candidates) {
            Some(row) => {
                match row.decision {
                    matcher::Decision::Auto => auto += 1,
                    matcher::Decision::Review => review += 1,
                    matcher::Decision::Unmatched => unmatched += 1,
                }
                let decision = format!("{:?}", row.decision).to_lowercase();
                lines.push(format!(
                    "{decision}\t{:.2}\t{}\t{}\t{}",
                    row.score,
                    row.file_path.display(),
                    row.proposed_name,
                    row.catalog_path.display(),
                ));
            }
            None => unmatched += 1,
        }
    }

    std::fs::write(root.join(PLAN_FILE), lines.join("\n") + "\n")?;
    println!(
        "auto={auto} review={review} unmatched={unmatched} plan={}",
        root.join(PLAN_FILE).display()
    );
    Ok(())
}

fn apply(root: &Path) -> anyhow::Result<()> {
    let content = std::fs::read_to_string(root.join(PLAN_FILE))?;
    let (mut applied, mut renamed, mut skipped) = (0u32, 0u32, 0u32);
    for line in content.lines().skip(1) {
        let cols: Vec<&str> = line.split('\t').collect();
        if cols.len() != 5 || !matches!(cols[0], "auto" | "accept") {
            skipped += 1;
            continue;
        }
        let row = matcher::PlanRow {
            decision: matcher::Decision::Auto,
            score: cols[1].parse().unwrap_or(0.0),
            file_path: PathBuf::from(cols[2]),
            proposed_name: cols[3].to_owned(),
            catalog_path: PathBuf::from(cols[4]),
        };
        if !row.file_path.exists() {
            skipped += 1;
            continue;
        }
        match matcher::apply_match(root, &row) {
            Ok(outcome) => {
                applied += 1;
                if outcome.renamed {
                    renamed += 1;
                }
            }
            Err(e) => {
                eprintln!("failed: {} — {e}", row.file_path.display());
                skipped += 1;
            }
        }
    }
    println!("applied={applied} renamed={renamed} skipped={skipped}");
    Ok(())
}

fn main() -> anyhow::Result<()> {
    let mut args = std::env::args().skip(1);
    let (Some(mode), Some(root)) = (args.next(), args.next()) else {
        eprintln!("usage: match_library <plan|apply> <library-root>");
        std::process::exit(2);
    };
    let root = PathBuf::from(root);
    match mode.as_str() {
        "plan" => plan(&root),
        "apply" => apply(&root),
        _ => {
            eprintln!("unknown mode: {mode}");
            std::process::exit(2);
        }
    }
}
