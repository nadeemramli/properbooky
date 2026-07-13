use desktop_lib::{article, db, scanner};
use std::fs;

const FIXTURE_HTML: &str = r#"<!DOCTYPE html>
<html><head><title>Why Books Compound — Example Blog</title>
<meta name="author" content="Jane Reader"></head>
<body>
<nav><a href="/">Home</a><a href="/about">About</a></nav>
<article>
<h1>Why Books Compound</h1>
<p class="byline">By Jane Reader</p>
<p>Reading is the only technology that lets one mind install decades of
another mind's work in a matter of hours. The compounding starts when the
second book connects to the first: suddenly you are not reading pages,
you are building a lattice.</p>
<p>The lattice is why a personal library matters more than a feed. A feed
optimizes for the next minute; a library optimizes for the next decade.
Every volume you shelve is a bet that your future self will need a
foundation, not a notification.</p>
<h2>The permanence problem</h2>
<p>Web writing rots. Domains lapse, platforms die, paywalls descend. The
only reliable archive is the one you own — plain files, on your disk,
in a format that will outlive every app you read them with.</p>
</article>
<footer>Subscribe to the newsletter!</footer>
</body></html>"#;

#[test]
fn extracts_fixture_to_markdown_with_meta() {
    let (meta, markdown) =
        article::extract(FIXTURE_HTML, "https://example.com/blog/why-books-compound").unwrap();
    assert!(meta.title.contains("Why Books Compound"), "title: {}", meta.title);
    assert_eq!(meta.site.as_deref(), Some("example.com"));
    assert_eq!(meta.source_url, "https://example.com/blog/why-books-compound");
    assert!(markdown.contains("lattice"), "content preserved");
    assert!(!markdown.contains("Subscribe to the newsletter"), "chrome stripped");
    assert!(!markdown.contains("<p>"), "no raw HTML in markdown");
}

#[test]
fn roundtrip_and_scan_as_article() {
    let dir = std::env::temp_dir().join(format!("properbooky-art-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();

    let (meta, markdown) =
        article::extract(FIXTURE_HTML, "https://example.com/blog/why-books-compound").unwrap();
    let path = article::save(&dir, &meta, &markdown).unwrap();
    assert!(path.starts_with(dir.join("Articles")));

    // Parse back.
    let (parsed, body) = article::parse(&fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(parsed.source_url, meta.source_url);
    assert!(body.contains("lattice"));

    // Re-saving the same URL updates in place (no duplicate file).
    let again = article::save(&dir, &meta, &markdown).unwrap();
    assert_eq!(path, again);

    // Scanner indexes it as kind=article, openable via its own path.
    let conn = db::open(&dir.join("index.db")).unwrap();
    scanner::scan_library(&conn, &dir).unwrap();
    let (kind, file_link, status): (String, Option<String>, Option<String>) = conn
        .query_row(
            "SELECT kind, file_link, status FROM books WHERE format = 'article'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(kind, "article");
    assert_eq!(file_link.as_deref(), Some(path.to_string_lossy().as_ref()));
    assert_eq!(status.as_deref(), Some("available"));
}
