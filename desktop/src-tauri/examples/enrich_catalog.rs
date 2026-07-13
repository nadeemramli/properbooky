//! Enrich catalog entries from Open Library: ISBN, year, cover.
//!
//! Usage: cargo run --example enrich_catalog -- <library-root> [limit]
//!
//! Resumable: entries with an `enriched` marker are skipped, so re-running
//! continues where it stopped. Conservative: metadata is only accepted when
//! the Open Library candidate demonstrably matches title (+author); titles
//! and authors are never overwritten. Covers cache under
//! `.properbooky/covers/` (library-relative link in frontmatter).
//! Courteous rate: ~1 request/second with a proper User-Agent.

use desktop_lib::catalog;
use desktop_lib::enrich::{self, OlSearch};
use std::path::PathBuf;
use std::time::Duration;
use walkdir::WalkDir;

const USER_AGENT: &str = "ProperBooky/0.1 (personal library; github.com/nadeemramli/properbooky)";

fn main() -> anyhow::Result<()> {
    let mut args = std::env::args().skip(1);
    let Some(root) = args.next().map(PathBuf::from) else {
        eprintln!("usage: enrich_catalog <library-root> [limit]");
        std::process::exit(2);
    };
    let limit: usize = args.next().and_then(|l| l.parse().ok()).unwrap_or(usize::MAX);

    let covers_dir = root.join(".properbooky").join("covers");
    std::fs::create_dir_all(&covers_dir)?;

    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(20))
        .user_agent(USER_AGENT)
        .build();

    let (mut enriched, mut not_found, mut skipped, mut errors) = (0u32, 0u32, 0u32, 0u32);

    for entry in WalkDir::new(root.join("Catalog"))
        .sort_by_file_name()
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter(|e| e.path().extension().is_some_and(|x| x == "md"))
    {
        if enriched + not_found >= limit as u32 {
            break;
        }
        let Ok(content) = std::fs::read_to_string(entry.path()) else {
            continue;
        };
        let Some((mut parsed, body)) = catalog::parse(&content) else {
            continue;
        };
        if parsed.enriched.is_some() {
            skipped += 1;
            continue;
        }

        let mut query = vec![("title", parsed.title.clone())];
        if let Some(author) = &parsed.author {
            query.push(("author", author.clone()));
        }
        query.push(("limit", "5".to_owned()));
        query.push((
            "fields",
            "title,author_name,first_publish_year,cover_i,isbn".to_owned(),
        ));
        let pairs: Vec<(&str, &str)> = query.iter().map(|(k, v)| (*k, v.as_str())).collect();

        let response = agent
            .get("https://openlibrary.org/search.json")
            .query_pairs(pairs)
            .call();
        std::thread::sleep(Duration::from_millis(1100));

        let search: OlSearch = match response.and_then(|r| {
            r.into_json::<OlSearch>()
                .map_err(|e| ureq::Error::from(std::io::Error::other(e)))
        }) {
            Ok(s) => s,
            Err(e) => {
                errors += 1;
                eprintln!("error: {} — {e}", parsed.title);
                if errors > 20 {
                    eprintln!("too many errors; stopping");
                    break;
                }
                continue;
            }
        };

        match enrich::pick_match(&parsed.title, parsed.author.as_deref(), &search.docs) {
            Some(doc) => {
                parsed.isbn = parsed.isbn.take().or_else(|| enrich::pick_isbn(doc));
                parsed.year = parsed.year.take().or(doc.first_publish_year);
                if parsed.author.is_none() && !doc.author_name.is_empty() {
                    parsed.author = Some(doc.author_name.join(", "));
                }
                if parsed.cover.is_none() {
                    if let Some(cover_id) = doc.cover_i {
                        let cover_name = format!("ol-{cover_id}.jpg");
                        let cover_path = covers_dir.join(&cover_name);
                        if !cover_path.exists() {
                            let url = format!(
                                "https://covers.openlibrary.org/b/id/{cover_id}-M.jpg"
                            );
                            if let Ok(resp) = agent.get(&url).call() {
                                let mut bytes = Vec::new();
                                if std::io::copy(&mut resp.into_reader(), &mut bytes).is_ok()
                                    && bytes.len() > 1000
                                {
                                    let _ = std::fs::write(&cover_path, &bytes);
                                }
                            }
                            std::thread::sleep(Duration::from_millis(400));
                        }
                        if cover_path.exists() {
                            parsed.cover =
                                Some(format!(".properbooky/covers/{cover_name}"));
                        }
                    }
                }
                parsed.enriched = Some("openlibrary".to_owned());
                enriched += 1;
            }
            None => {
                parsed.enriched = Some("not-found".to_owned());
                not_found += 1;
            }
        }
        std::fs::write(entry.path(), catalog::render(&parsed, &body))?;

        if (enriched + not_found) % 50 == 0 {
            eprintln!("progress: enriched={enriched} not_found={not_found} skipped={skipped}");
        }
    }

    println!("enriched={enriched} not_found={not_found} skipped={skipped} errors={errors}");
    Ok(())
}
