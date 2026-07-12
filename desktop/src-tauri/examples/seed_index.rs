//! Index a library folder into an app database from the CLI, bypassing the UI.
//!
//! Usage: cargo run --example seed_index -- <library-path> <db-path>
//! e.g.   cargo run --example seed_index -- "/mnt/c/Users/Nadeem/Desktop/All Books Inside Here" \
//!            ~/.local/share/com.nadeemramli.properbooky/library.db

use desktop_lib::{db, scanner};
use std::path::PathBuf;

fn main() -> anyhow::Result<()> {
    let mut args = std::env::args().skip(1);
    let (Some(library), Some(db_path)) = (args.next(), args.next()) else {
        eprintln!("usage: seed_index <library-path> <db-path>");
        std::process::exit(2);
    };

    let conn = db::open(&PathBuf::from(&db_path))?;
    let result = scanner::scan_library(&conn, &PathBuf::from(&library))?;
    db::set_setting(&conn, "library_path", &library)?;

    println!(
        "indexed={} skipped={} db={}",
        result.indexed, result.skipped, db_path
    );
    Ok(())
}
