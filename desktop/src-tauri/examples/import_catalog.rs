//! Import the "Library of Books" sheet CSV into Catalog/*.md files (PBK-19).
//!
//! Usage: cargo run --example import_catalog -- [--dry-run] <csv-path> <catalog-dir>
//!
//! Re-runnable: existing profiles are never changed (they may hold notes and
//! edits made since the import); every row that was not imported is listed
//! with its CSV line. `--dry-run` reports the same without writing anything.
//! Exit codes: 0 imported (rows may still be listed as skipped), 1 the CSV
//! was refused and nothing was written, 2 usage.

use desktop_lib::catalog_import;
use std::path::PathBuf;

fn main() {
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    let dry_run = args.first().is_some_and(|a| a == "--dry-run");
    if dry_run {
        args.remove(0);
    }
    let [csv_path, catalog_dir] = args.as_slice() else {
        eprintln!("usage: import_catalog [--dry-run] <csv-path> <catalog-dir>");
        std::process::exit(2);
    };
    let report = match catalog_import::import(
        &PathBuf::from(csv_path),
        &PathBuf::from(catalog_dir),
        dry_run,
    ) {
        Ok(report) => report,
        Err(error) => {
            eprintln!("import refused: {error:#}");
            std::process::exit(1);
        }
    };
    let verb = if dry_run { "would create" } else { "created" };
    for c in &report.created {
        let renamed = if c.renamed {
            " (usual name taken by another book)"
        } else {
            ""
        };
        println!("line {}: {verb} {}{renamed}", c.line, c.file);
    }
    for e in &report.existing {
        if e.differs.is_empty() {
            println!("line {}: already in the catalog as {}", e.line, e.file);
        } else {
            println!(
                "line {}: kept {} unchanged; the row differs in {}",
                e.line,
                e.file,
                e.differs.join(", ")
            );
        }
    }
    for d in &report.duplicates {
        println!(
            "line {}: same book as line {}; skipped",
            d.line, d.first_line
        );
    }
    for n in &report.near_duplicates {
        println!(
            "line {}: imported \"{}\" by {}; similar to {} (review in Library cleanup)",
            n.line, n.title, n.author, n.similar_to
        );
    }
    for r in &report.rejected {
        println!("line {}: not imported: {}", r.line, r.reason);
    }
    for u in &report.unreadable {
        println!("could not read existing catalog file {u}");
    }
    for s in &report.statuses {
        println!("status \"{}\" -> {} ({} rows)", s.sheet, s.status, s.rows);
    }
    println!(
        "{}rows={} {}={} existing={} duplicates={} near_duplicates={} rejected={} blank_rows={} temp_files_removed={} dir={}",
        if dry_run { "DRY RUN " } else { "" },
        report.rows,
        verb.replace(' ', "_"),
        report.created.len(),
        report.existing.len(),
        report.duplicates.len(),
        report.near_duplicates.len(),
        report.rejected.len(),
        report.blank_rows,
        report.temp_files_removed,
        catalog_dir
    );
}
