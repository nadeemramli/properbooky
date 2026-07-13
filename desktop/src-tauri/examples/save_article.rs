//! Save a web article into the library from the terminal.
//! Usage: cargo run --example save_article -- <library-root> <url>

use desktop_lib::article;
use std::path::PathBuf;
use std::time::Duration;

fn main() -> anyhow::Result<()> {
    let mut args = std::env::args().skip(1);
    let (Some(root), Some(url)) = (args.next().map(PathBuf::from), args.next()) else {
        eprintln!("usage: save_article <library-root> <url>");
        std::process::exit(2);
    };

    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(25))
        .user_agent("Mozilla/5.0 (X11; Linux x86_64) ProperBooky/0.1")
        .build();
    let html = agent.get(&url).call()?.into_string()?;
    let (meta, markdown) = article::extract(&html, &url)?;
    let path = article::save(&root, &meta, &markdown)?;
    println!(
        "saved “{}” ({} chars) → {}",
        meta.title,
        markdown.len(),
        path.display()
    );
    Ok(())
}
