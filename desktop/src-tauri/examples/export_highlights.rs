//! Export highlights to Obsidian-ready markdown, one note per book.
//! Usage: cargo run --example export_highlights -- <library-root> <output-dir>

use std::path::PathBuf;

fn main() -> anyhow::Result<()> {
    let mut args = std::env::args().skip(1);
    let (Some(root), Some(out)) = (args.next().map(PathBuf::from), args.next().map(PathBuf::from))
    else {
        eprintln!("usage: export_highlights <library-root> <output-dir>");
        std::process::exit(2);
    };
    let report = desktop_lib::export::export_highlights(&root, &out)?;
    println!(
        "exported {} highlights across {} books to {}",
        report.highlights, report.books, report.target
    );
    Ok(())
}
