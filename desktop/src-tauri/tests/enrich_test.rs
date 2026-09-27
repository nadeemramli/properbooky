use desktop_lib::enrich::{accepted, pick_match, OlDoc};

fn doc(title: &str, authors: &[&str], year: i64, cover: i64) -> OlDoc {
    OlDoc {
        title: Some(title.to_owned()),
        author_name: authors.iter().map(|a| a.to_string()).collect(),
        first_publish_year: Some(year),
        cover_i: Some(cover),
        isbn: vec!["9780141031487".into(), "0141031484".into()],
        ..Default::default()
    }
}

#[test]
fn accepts_matching_title_and_author() {
    let docs = vec![
        doc("The Wrong Book Entirely", &["Someone Else"], 1990, 1),
        doc(
            "Antifragile: Things That Gain from Disorder",
            &["Nassim Nicholas Taleb"],
            2012,
            42,
        ),
    ];
    let picked = pick_match(
        "Antifragile Things That Gain From Disorder",
        Some("Nassim Taleb"),
        &docs,
    )
    .expect("should match the Taleb doc");
    assert_eq!(picked.cover_i, Some(42));
}

#[test]
fn rejects_wrong_author_even_with_similar_title() {
    let docs = vec![doc("The Art of Seduction", &["Robert Greene"], 2001, 7)];
    // Similar-ish garbled query with a different author must not attach.
    assert!(pick_match("The Art of Client Service", Some("Robert Solomon"), &docs).is_none());
}

#[test]
fn authorless_query_needs_near_exact_distinctive_title() {
    let docs = vec![doc(
        "Thinking, Fast and Slow",
        &["Daniel Kahneman"],
        2011,
        9,
    )];
    assert!(pick_match("Thinking Fast and Slow", None, &docs).is_some());
    // Too few tokens to trust without an author.
    let short = vec![doc("PDF", &[], 2000, 1)];
    assert!(pick_match(") pdf", None, &short).is_none());
    assert!(pick_match(
        "Deep Work",
        None,
        &[doc("Deep Work", &["Cal Newport"], 2016, 9)]
    )
    .is_none());
}

#[test]
fn garbled_adopted_title_finds_nothing() {
    let docs = vec![doc("Tuesdays with Morrie", &["Mitch Albom"], 1997, 3)];
    assert!(pick_match("'s Greatest Lesson PDFDrive com", None, &docs).is_none());
}

#[test]
fn work_isbns_and_first_publish_year_are_not_accepted_as_edition_metadata() {
    let root = tempfile::tempdir().unwrap();
    let mut d = doc("X", &[], 2000, 1);
    d.key = "/works/OL1W".into();
    let result = serde_json::to_value(accepted(root.path(), d, false).unwrap()).unwrap();
    assert!(result.get("isbn").is_none());
    assert!(result.get("year").is_none());
}
