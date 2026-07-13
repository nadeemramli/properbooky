use desktop_lib::matcher::{self, CatalogCandidate, Decision};
use std::path::PathBuf;

fn candidates() -> Vec<CatalogCandidate> {
    let mk = |title: &str, author: Option<&str>| CatalogCandidate {
        path: PathBuf::from(format!("/lib/Catalog/{title}.md")),
        title: title.to_owned(),
        author: author.map(ToOwned::to_owned),
    };
    vec![
        mk(
            "Go-To-Market Strategist: Everything You Need to Reach Product-Market Fit",
            Some("Maja Voje"),
        ),
        mk("The Taylor Trading Technique", Some("George D. Taylor")),
        mk(
            "Maximum Trading Gains with Anchored VWAP",
            Some("Brian Shannon"),
        ),
        mk("The Culture Map", Some("Erin Meyer")),
        mk("Raising Venture Capital", Some("Andy Sparks")),
    ]
}

#[test]
fn zlibrary_suffix_matches_cleanly() {
    let row = matcher::match_file(
        &PathBuf::from(
            "/lib/Go-To-Market Strategist Everything You Need to Reach Product-Market Fit (Maja Voje) (Z-Library).pdf",
        ),
        &candidates(),
    )
    .unwrap();
    assert_eq!(row.decision, Decision::Auto, "score={}", row.score);
    assert!(row.catalog_path.to_string_lossy().contains("Go-To-Market"));
    assert_eq!(
        row.proposed_name,
        "Maja Voje - Go-To-Market Strategist Everything You Need to Reach Product-Market Fit.pdf"
    );
}

#[test]
fn libgen_publisher_year_suffix_matches() {
    let row = matcher::match_file(
        &PathBuf::from(
            "/lib/George D. Taylor - The Taylor Trading Technique (1994, Traders Press, Inc.) - libgen.li.pdf",
        ),
        &candidates(),
    )
    .unwrap();
    assert_eq!(row.decision, Decision::Auto, "score={}", row.score);
    assert!(row.catalog_path.to_string_lossy().contains("Taylor"));
}

#[test]
fn site_watermark_matches() {
    let row = matcher::match_file(
        &PathBuf::from("/lib/Al-Brooks-Trading-Price-Action-Trends-(KohanFx.com).pdf"),
        &candidates(),
    )
    .unwrap();
    // Not in the catalog: best coverage stays low → review or unmatched, never auto.
    assert_ne!(row.decision, Decision::Auto, "score={}", row.score);
}

#[test]
fn unrelated_file_is_unmatched() {
    let row = matcher::match_file(
        &PathBuf::from("/lib/12step_Foolproof_SalesLetter_Template.pdf"),
        &candidates(),
    )
    .unwrap();
    assert_eq!(row.decision, Decision::Unmatched, "score={}", row.score);
}

#[test]
fn filename_tokens_strip_junk() {
    let toks = matcher::filename_tokens(
        "Harvard Business Review on Leadership (Z-lib.io) (1998) - libgen.li.pdf",
    );
    assert!(toks.contains(&"harvard".to_owned()));
    assert!(toks.contains(&"leadership".to_owned()));
    assert!(!toks.contains(&"libgen".to_owned()));
    assert!(!toks.contains(&"1998".to_owned()));
    assert!(!toks.contains(&"io".to_owned()));
}
