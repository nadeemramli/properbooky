use desktop_lib::extract::{chunk_text, extract_text};
use std::fs;

#[test]
fn markdown_extraction_drops_frontmatter() {
    let dir = std::env::temp_dir().join(format!("properbooky-ext-{}", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    let path = dir.join("article.md");
    fs::write(
        &path,
        "---\ntitle: T\nsource_url: https://x.example\n---\n\nThe lattice compounds.\n",
    )
    .unwrap();
    let text = extract_text(&path).unwrap();
    assert!(text.contains("lattice compounds"));
    assert!(!text.contains("source_url"));
}

#[test]
fn chunker_packs_and_splits_without_losing_content() {
    let marker_a = "ZEBRA-ALPHA-TOKEN";
    let marker_b = "ZEBRA-OMEGA-TOKEN";
    let long_para = format!(
        "{} {} {}",
        marker_a,
        "A sentence about compounding knowledge. ".repeat(120),
        marker_b
    );
    let text = format!("Short opening paragraph.\n\n{long_para}\n\nClosing thought.");
    let chunks = chunk_text(&text);

    assert!(chunks.len() > 3, "long text should split: {}", chunks.len());
    assert!(chunks.iter().all(|c| c.len() <= 1600), "chunks bounded");
    let joined = chunks.join(" ");
    assert!(joined.contains(marker_a) && joined.contains(marker_b), "no content lost");
    assert!(joined.contains("Short opening paragraph"));
    assert!(joined.contains("Closing thought"));
}

#[test]
fn chunker_handles_empty_and_whitespace() {
    assert!(chunk_text("").is_empty());
    assert!(chunk_text("\n\n   \n").is_empty());
    assert_eq!(chunk_text("one paragraph").len(), 1);
}
