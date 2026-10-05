//! PBK-19: the Library of Books CSV export becomes `Catalog/*.md` profiles
//! that the library indexes, searches and filters. Synthetic CSVs only.

use desktop_lib::catalog::{self, CatalogEntry};
use desktop_lib::catalog_import::{self, identity_key, import, import_filename, map_status};
use desktop_lib::{db, library, scanner};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

const HEADER: [&str; 11] = [
    "Book Title",
    "Author",
    "Date Releases",
    "Types",
    "Topic Category",
    "Recommendation",
    "Rating",
    "Status",
    "Date Input",
    "Latticework",
    "Sheet Notes",
];

/// A CSV built field by field (every field quoted), remembering the line on
/// which each row starts, plus raw lines for malformed input.
struct Csv {
    text: String,
    line: u64,
    rows: Vec<u64>,
}

impl Csv {
    fn new(header: &[&str]) -> Self {
        let mut csv = Csv {
            text: String::new(),
            line: 1,
            rows: Vec::new(),
        };
        csv.push(header);
        csv.rows.clear();
        csv
    }
    fn push(&mut self, fields: &[&str]) -> u64 {
        let quoted: Vec<String> = fields
            .iter()
            .map(|f| format!("\"{}\"", f.replace('"', "\"\"")))
            .collect();
        self.raw(&quoted.join(","))
    }
    fn raw(&mut self, line: &str) -> u64 {
        let start = self.line;
        self.text.push_str(line);
        self.text.push('\n');
        self.line += 1 + line.matches('\n').count() as u64;
        self.rows.push(start);
        start
    }
}

/// One sheet row in HEADER order (Sheet Notes is not imported).
#[allow(clippy::too_many_arguments)]
fn row<'a>(
    title: &'a str,
    author: &'a str,
    released: &'a str,
    types: &'a str,
    topics: &'a str,
    rec: &'a str,
    rating: &'a str,
    status: &'a str,
    input: &'a str,
    lattice: &'a str,
) -> [&'a str; 11] {
    [
        title,
        author,
        released,
        types,
        topics,
        rec,
        rating,
        status,
        input,
        lattice,
        "not imported",
    ]
}

const LATTICE: &str = "## Latticework\n\nBets are decisions under uncertainty, \"resulting\" is a trap.\n---\nkey: value that looks like YAML\n# not a heading in YAML\n  - indented, with trailing spaces   \n\nCJK 思考 · emoji 🎲 · RTL שלום\nlast line";

fn temp() -> tempfile::TempDir {
    tempfile::tempdir().unwrap()
}

fn md_files(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

fn snapshot(dir: &Path) -> BTreeMap<String, (Vec<u8>, SystemTime)> {
    if !dir.exists() {
        return BTreeMap::new();
    }
    fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap())
        .filter(|e| e.file_type().unwrap().is_file())
        .map(|e| {
            let p = e.path();
            (
                e.file_name().to_string_lossy().into_owned(),
                (
                    fs::read(&p).unwrap(),
                    fs::metadata(&p).unwrap().modified().unwrap(),
                ),
            )
        })
        .collect()
}

/// Every file must be valid YAML frontmatter that the library reads back.
fn profile(path: &Path) -> (CatalogEntry, String) {
    let text = fs::read_to_string(path).unwrap();
    let front = text
        .strip_prefix("---\n")
        .and_then(|rest| rest.split_once("\n---\n"))
        .unwrap_or_else(|| panic!("{} has no frontmatter", path.display()))
        .0;
    let yaml: serde_yaml::Value = serde_yaml::from_str(front)
        .unwrap_or_else(|e| panic!("{}: invalid YAML: {e}", path.display()));
    assert!(
        yaml.is_mapping(),
        "{} frontmatter is not a mapping",
        path.display()
    );
    let (entry, body) = catalog::parse(&text)
        .unwrap_or_else(|| panic!("{} is not a catalog profile", path.display()));
    // `render` ends the file with one newline after the body.
    (entry, body.strip_suffix('\n').unwrap_or(&body).to_owned())
}

fn by_title(dir: &Path) -> BTreeMap<String, (String, CatalogEntry, String)> {
    md_files(dir)
        .into_iter()
        .filter(|n| n.ends_with(".md"))
        .map(|n| {
            let (entry, body) = profile(&dir.join(&n));
            (entry.title.clone(), (n, entry, body))
        })
        .collect()
}

fn write_csv(dir: &Path, name: &str, text: &str) -> PathBuf {
    let path = dir.join(name);
    fs::write(&path, text).unwrap();
    path
}

#[test]
fn sheet_status_maps_exactly() {
    for (sheet, status) in [
        ("Downloaded", "available"),
        ("  downloaded ", "available"),
        ("DOWNLOADED", "available"),
        ("Need to read now", "queued"),
        ("need  to read   NOW", "queued"),
        ("", "wishlist"),
        ("Reading", "wishlist"),
        ("Not downloaded", "wishlist"),
        ("Downloaded?", "wishlist"),
        ("Need to read", "wishlist"),
        ("Don't need to read now", "wishlist"),
    ] {
        assert_eq!(map_status(sheet), status, "sheet status {sheet:?}");
    }
}

#[test]
fn identity_keeps_punctuation_and_order() {
    let k = |t, a| identity_key(t, a);
    assert_eq!(
        k("  Thinking   in Bets ", "ANNIE  Duke"),
        k("thinking in bets", "annie duke")
    );
    assert_ne!(k("C++ Primer", "Lippman"), k("C Primer", "Lippman"));
    assert_ne!(k("It", "Stephen King"), k("It!", "Stephen King"));
    assert_ne!(
        k("Dune", "Frank Herbert"),
        k("Dune: Messiah", "Frank Herbert")
    );
    assert_ne!(k("Book", "Duke, Annie"), k("Book", "Annie Duke"));
    // A title can never borrow words from the author.
    assert_ne!(k("A B", "C"), k("A", "B C"));
}

#[test]
fn filenames_are_one_safe_plain_file() {
    assert_eq!(
        import_filename("Thinking in Bets", "Annie Duke", 1),
        "Annie Duke - Thinking in Bets.md"
    );
    assert_eq!(
        import_filename("Thinking in Bets", "Annie Duke", 1),
        catalog::entry_filename("Thinking in Bets", Some("Annie Duke")),
        "ordinary titles keep the name earlier imports gave them"
    );
    assert_eq!(
        import_filename("Thinking in Bets", "Annie Duke", 3),
        "Annie Duke - Thinking in Bets (3).md"
    );
    assert_eq!(
        import_filename("../../etc/passwd", "..", 1),
        "- .. .. etc passwd.md"
    );
    assert_eq!(import_filename("CON", "", 1), "_CON.md");
    assert_eq!(import_filename("lpt1.notes", "", 1), "_lpt1.notes.md");
    assert_eq!(
        import_filename("Bell\u{7}\u{0}Title.", "A", 1),
        "A - Bell Title.md"
    );
    assert_eq!(import_filename("...", "", 1), "Untitled.md");
    let long = "思".repeat(150);
    for n in [1, 2, 999] {
        let name = import_filename(&long, "作者", n);
        assert!(name.len() <= 200, "{} bytes", name.len());
        assert!(name.ends_with(".md") && !name.contains('/'));
    }
}

/// The representative synthetic export used by the main journey.
fn sheet() -> (Csv, BTreeMap<&'static str, u64>) {
    let mut csv = Csv::new(&HEADER);
    let mut at = BTreeMap::new();
    at.insert(
        "bets",
        csv.push(&row(
            "Thinking in Bets",
            "Annie Duke",
            "2018",
            "Book",
            "Decision Making, Psychology",
            "Must read",
            "5",
            "Downloaded",
            "2024-01-02",
            LATTICE,
        )),
    );
    at.insert(
        "queued",
        csv.push(&row(
            "The Culture Map",
            "Erin Meyer",
            "2014-05-27",
            "Book",
            "Business",
            "",
            "",
            "Need to read now",
            "",
            "",
        )),
    );
    at.insert(
        "other",
        csv.push(&row(
            "Deep Work",
            "Cal Newport",
            "",
            "",
            "",
            "",
            "4",
            "Reading",
            "",
            "",
        )),
    );
    at.insert(
        "empty",
        csv.push(&row(
            "Range",
            "David Epstein",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
        )),
    );
    at.insert(
        "quoted",
        csv.push(&row(
            "Re: \"Work\" — A Novel: Subtitle, Part 2",
            "García Márquez, Gabriel",
            "1967",
            "Novel",
            "Fiction,,  Latin America ,",
            "Maybe",
            "3",
            "downloaded",
            "",
            "He said \"hello\", then left.",
        )),
    );
    at.insert(
        "yaml",
        csv.push(&row(
            "null",
            "yes",
            "123",
            "true",
            "- dash, #hash, @at",
            "*star",
            "-2",
            "",
            "1.5",
            "&anchor",
        )),
    );
    at.insert(
        "dots",
        csv.push(&row(
            "...And Then There Were None",
            "Agatha Christie",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
        )),
    );
    at.insert(
        "multiline",
        csv.push(&row(
            "Line one\nLine two",
            "Multi Line",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
        )),
    );
    at.insert(
        "long",
        csv.push(&row(
            &"思考".repeat(80),
            "長い 作者",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "本文",
        )),
    );
    at.insert(
        "dupe",
        csv.push(&row(
            "  thinking   in BETS ",
            "ANNIE  duke",
            "2019",
            "",
            "",
            "",
            "1",
            "",
            "",
            "different",
        )),
    );
    at.insert(
        "cpp",
        csv.push(&row(
            "C++ Primer",
            "Stanley Lippman",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
        )),
    );
    at.insert(
        "c",
        csv.push(&row(
            "C Primer",
            "Stanley Lippman",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
        )),
    );
    at.insert(
        "ab-slash",
        csv.push(&row(
            "A/B Testing",
            "Dan Siroker",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
        )),
    );
    at.insert(
        "ab-space",
        csv.push(&row(
            "A B Testing",
            "Dan Siroker",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
        )),
    );
    at.insert(
        "no-title",
        csv.push(&row("  ", "Someone", "", "", "", "", "", "", "", "")),
    );
    at.insert(
        "no-author",
        csv.push(&row(
            "Anonymous Book",
            "",
            "",
            "",
            "",
            "",
            "",
            "Downloaded",
            "",
            "",
        )),
    );
    at.insert(
        "bad-rating",
        csv.push(&row(
            "Half Stars",
            "Rater",
            "",
            "",
            "",
            "",
            "4.5",
            "",
            "",
            "",
        )),
    );
    at.insert("short", csv.raw("\"Too Short\",\"Only Two\""));
    at.insert("blank", csv.raw(",,,,,,,,,,"));
    at.insert(
        "after",
        csv.push(&row(
            "After The Bad Rows",
            "Still Imported",
            "",
            "",
            "",
            "",
            "",
            "Need to read now",
            "",
            "",
        )),
    );
    (csv, at)
}

#[test]
fn imports_each_book_once_with_every_field() {
    let dir = temp();
    let (csv, at) = sheet();
    let csv_path = write_csv(dir.path(), "export.csv", &csv.text);
    let catalog_dir = dir.path().join("library/Catalog");

    let report = import(&csv_path, &catalog_dir, false).unwrap();
    assert_eq!(report.rows, 20);
    assert_eq!(report.blank_rows, 1);
    let rejected: BTreeMap<u64, &str> = report
        .rejected
        .iter()
        .map(|r| (r.line, r.reason.as_str()))
        .collect();
    assert_eq!(
        rejected,
        BTreeMap::from([
            (at["no-title"], "the Book Title is blank"),
            (at["no-author"], "the Author is blank"),
            (at["bad-rating"], "the Rating \"4.5\" is not a whole number"),
            (
                at["short"],
                "the row has 2 fields where the header has 11 (a stray comma or quote?)"
            ),
        ])
    );
    assert_eq!(report.duplicates.len(), 1);
    assert_eq!(
        (report.duplicates[0].line, report.duplicates[0].first_line),
        (at["dupe"], at["bets"])
    );
    assert_eq!(
        report.duplicates[0].differs,
        [
            "title",
            "author",
            "status",
            "rating",
            "recommendation",
            "type",
            "topics",
            "published",
            "added",
            "latticework"
        ]
    );
    let near: Vec<(u64, &str)> = report
        .near_duplicates
        .iter()
        .map(|n| (n.line, n.similar_to.as_str()))
        .collect();
    let (c_line, ab_line) = (
        format!("line {}", at["cpp"]),
        format!("line {}", at["ab-slash"]),
    );
    assert_eq!(
        near,
        [
            (at["c"], c_line.as_str()),
            (at["ab-space"], ab_line.as_str())
        ]
    );

    // One profile per unique book; all of them valid YAML read back as catalog profiles.
    let files = md_files(&catalog_dir);
    assert_eq!(files.len(), 14, "{files:?}");
    assert_eq!(report.created.len(), 14);
    let profiles = by_title(&catalog_dir);
    assert_eq!(profiles.len(), 14);

    let get = |title: &str| {
        profiles
            .get(title)
            .unwrap_or_else(|| panic!("no profile titled {title:?}"))
    };
    let (name, bets, body) = get("Thinking in Bets");
    assert_eq!(name, "Annie Duke - Thinking in Bets.md");
    assert_eq!(bets.author.as_deref(), Some("Annie Duke"));
    assert_eq!(bets.published.as_deref(), Some("2018"));
    assert_eq!(bets.r#type.as_deref(), Some("Book"));
    assert_eq!(bets.topics, ["Decision Making", "Psychology"]);
    assert_eq!(bets.recommendation.as_deref(), Some("Must read"));
    assert_eq!(bets.rating, Some(5));
    assert_eq!(bets.status, "available");
    assert_eq!(bets.added.as_deref(), Some("2024-01-02"));
    assert_eq!(bets.source.as_deref(), Some(catalog_import::SOURCE));
    assert_eq!(
        bets.extra.get("source_status").and_then(|v| v.as_str()),
        Some("Downloaded")
    );
    assert_eq!(body, LATTICE, "Latticework body is kept whole");
    let raw = fs::read_to_string(catalog_dir.join(name)).unwrap();
    assert!(
        raw.ends_with(&format!("\n---\n\n{LATTICE}\n")),
        "body written verbatim:\n{raw}"
    );

    let (_, queued, body) = get("The Culture Map");
    assert_eq!(
        (
            queued.status.as_str(),
            queued.rating,
            queued.recommendation.as_deref()
        ),
        ("queued", None, None)
    );
    assert_eq!(
        (
            queued.published.as_deref(),
            queued.topics.as_slice(),
            body.as_str()
        ),
        (Some("2014-05-27"), &["Business".to_owned()][..], "")
    );
    let (_, other, _) = get("Deep Work");
    assert_eq!((other.status.as_str(), other.rating), ("wishlist", Some(4)));
    assert_eq!(
        other.extra.get("source_status").and_then(|v| v.as_str()),
        Some("Reading")
    );
    let (_, empty, _) = get("Range");
    assert_eq!(empty.status, "wishlist");
    assert!(
        empty.extra.get("source_status").is_none()
            && empty.r#type.is_none()
            && empty.topics.is_empty()
    );

    let (name, quoted, body) = get("Re: \"Work\" — A Novel: Subtitle, Part 2");
    assert_eq!(
        name,
        "García Márquez, Gabriel - Re Work — A Novel Subtitle, Part 2.md"
    );
    assert_eq!(quoted.author.as_deref(), Some("García Márquez, Gabriel"));
    assert_eq!(
        (quoted.status.as_str(), quoted.rating),
        ("available", Some(3))
    );
    assert_eq!(
        quoted.topics,
        ["Fiction", "Latin America"],
        "empty topics dropped"
    );
    assert_eq!(body, "He said \"hello\", then left.");

    let (_, yaml, body) = get("null");
    assert_eq!(yaml.author.as_deref(), Some("yes"));
    assert_eq!(yaml.published.as_deref(), Some("123"));
    assert_eq!(yaml.r#type.as_deref(), Some("true"));
    assert_eq!(yaml.topics, ["- dash", "#hash", "@at"]);
    assert_eq!(yaml.recommendation.as_deref(), Some("*star"));
    assert_eq!(yaml.rating, Some(-2));
    assert_eq!(yaml.added.as_deref(), Some("1.5"));
    assert_eq!(body, "&anchor");

    let (name, ..) = get("...And Then There Were None");
    assert_eq!(name, "Agatha Christie - ...And Then There Were None.md");
    let (name, multi, _) = get("Line one\nLine two");
    assert_eq!(
        (name.as_str(), multi.author.as_deref()),
        ("Multi Line - Line one Line two.md", Some("Multi Line"))
    );
    let (name, long, body) = get(&"思考".repeat(80));
    assert!(
        name.len() <= 200 && name.starts_with("長い 作者 - 思考"),
        "{name}"
    );
    assert_eq!(
        (long.author.as_deref(), body.as_str()),
        (Some("長い 作者"), "本文")
    );

    get("C++ Primer");
    get("C Primer");
    let (slash, ..) = get("A/B Testing");
    let (space, ..) = get("A B Testing");
    assert_eq!(
        (slash.as_str(), space.as_str()),
        (
            "Dan Siroker - A B Testing.md",
            "Dan Siroker - A B Testing (2).md"
        )
    );
    assert!(report
        .created
        .iter()
        .any(|c| c.line == at["ab-space"] && c.renamed));
    let (_, after, _) = get("After The Bad Rows");
    assert_eq!(after.status, "queued");

    assert_eq!(
        report
            .statuses
            .iter()
            .map(|s| (s.sheet.as_str(), s.status.as_str(), s.rows))
            .collect::<Vec<_>>(),
        [
            ("", "wishlist", 10),
            ("Downloaded", "available", 1),
            ("Need to read now", "queued", 2),
            ("Reading", "wishlist", 1),
            ("downloaded", "available", 1)
        ]
    );
    assert!(
        !files.iter().any(|f| f.starts_with('.')),
        "no temporary files left: {files:?}"
    );
}

#[test]
fn rescan_indexes_imported_profiles_beside_files_for_search_and_filters() {
    let dir = temp();
    let root = dir.path().join("library");
    fs::create_dir_all(root.join("Shelf")).unwrap();
    fs::write(root.join("Shelf/Plain File.pdf"), b"%PDF-1.4 synthetic").unwrap();
    let (csv, _) = sheet();
    let csv_path = write_csv(dir.path(), "export.csv", &csv.text);
    import(
        &csv_path,
        &catalog_import::catalog_dir(&root).unwrap(),
        false,
    )
    .unwrap();

    let conn = db::open(&dir.path().join("index/library.db")).unwrap();
    let scan = scanner::scan_library(&conn, &root).unwrap();
    assert_eq!(scan.indexed, 15, "14 profiles + 1 file");
    let books = library::list(&conn, &root, None).unwrap();
    assert_eq!(books.iter().filter(|b| b.kind == "catalog").count(), 14);
    assert_eq!(books.iter().filter(|b| b.kind == "file").count(), 1);
    let status = |t: &str| {
        let b = books
            .iter()
            .find(|b| b.title == t)
            .unwrap_or_else(|| panic!("{t} not listed"));
        (b.status.clone().unwrap_or_default(), b.rating)
    };
    assert_eq!(status("Thinking in Bets"), ("available".into(), Some(5)));
    assert_eq!(status("The Culture Map"), ("queued".into(), None));
    assert_eq!(status("Range"), ("wishlist".into(), None));
    let count = |s: &str| {
        books
            .iter()
            .filter(|b| b.status.as_deref() == Some(s))
            .count()
    };
    assert_eq!(
        (count("available"), count("queued"), count("wishlist")),
        (2, 2, 10)
    );

    let search = |q: &str| {
        let mut t: Vec<String> = library::list(&conn, &root, Some(q))
            .unwrap()
            .into_iter()
            .map(|b| b.title)
            .collect();
        t.sort();
        t
    };
    assert_eq!(search("culture map"), ["The Culture Map"]);
    assert_eq!(
        search("erin meyer"),
        ["The Culture Map"],
        "search by author"
    );
    assert_eq!(
        search("garcía"),
        ["Re: \"Work\" — A Novel: Subtitle, Part 2"]
    );
    assert_eq!(search("lippman"), ["C Primer", "C++ Primer"]);
    assert_eq!(search("plain file"), ["Plain File"]);

    // The index is disposable: a rebuild from the folder converges on the same rows.
    let again = scanner::scan_library(&conn, &root).unwrap();
    assert_eq!(again.indexed, 15);
}

#[test]
fn second_import_creates_nothing_and_keeps_every_file_byte_for_byte() {
    let dir = temp();
    let (csv, at) = sheet();
    let csv_path = write_csv(dir.path(), "export.csv", &csv.text);
    let catalog_dir = dir.path().join("Catalog");
    import(&csv_path, &catalog_dir, false).unwrap();
    // The owner edits a profile after the import.
    let edited = catalog_dir.join("Erin Meyer - The Culture Map.md");
    let mut text = fs::read_to_string(&edited).unwrap();
    text.push_str("\nMy own notes, added later.\n");
    fs::write(&edited, &text).unwrap();
    let before = snapshot(&catalog_dir);
    std::thread::sleep(std::time::Duration::from_millis(20));

    let second = import(&csv_path, &catalog_dir, false).unwrap();
    assert!(second.created.is_empty(), "{:?}", second.created);
    assert_eq!(second.existing.len(), 14);
    let culture = second
        .existing
        .iter()
        .find(|e| e.line == at["queued"])
        .unwrap();
    assert_eq!(
        (culture.file.as_str(), culture.differs.as_slice()),
        ("Erin Meyer - The Culture Map.md", &["latticework"][..])
    );
    assert!(second
        .existing
        .iter()
        .filter(|e| e.line != at["queued"])
        .all(|e| e.differs.is_empty()));
    assert_eq!(
        snapshot(&catalog_dir),
        before,
        "bytes and modification times unchanged"
    );

    // The sheet changes since: rows are reported, files are still not touched.
    let changed = csv
        .text
        .replace(
            "\"Business\",\"\",\"\",\"Need to read now\"",
            "\"Business\",\"\",\"\",\"Downloaded\"",
        )
        .replace(
            "\"Deep Work\",\"Cal Newport\",\"\",\"\",\"\",\"\",\"4\"",
            "\"Deep Work\",\"Cal Newport\",\"\",\"\",\"\",\"\",\"2\"",
        );
    assert_ne!(changed, csv.text);
    let changed_path = write_csv(dir.path(), "export-later.csv", &changed);
    let third = import(&changed_path, &catalog_dir, false).unwrap();
    assert!(third.created.is_empty());
    let culture = third
        .existing
        .iter()
        .find(|e| e.line == at["queued"])
        .unwrap();
    assert_eq!(culture.differs, ["status", "latticework"]);
    let deep = third
        .existing
        .iter()
        .find(|e| e.line == at["other"])
        .unwrap();
    assert_eq!(deep.differs, ["rating"]);
    assert_eq!(snapshot(&catalog_dir), before);

    // A dry run reports the same and writes nothing.
    let dry = import(&changed_path, &catalog_dir, true).unwrap();
    assert!(dry.dry_run && dry.created.is_empty() && dry.existing.len() == 14);
    assert_eq!(snapshot(&catalog_dir), before);
}

#[test]
fn profiles_from_the_earlier_importer_and_renamed_files_are_recognised() {
    let dir = temp();
    let catalog_dir = dir.path().join("Catalog");
    fs::create_dir_all(&catalog_dir).unwrap();
    // Written by the previous importer (no source_status), under its usual name.
    let earlier = "---\ntitle: Thinking in Bets\nauthor: Annie Duke\nstatus: available\nrating: 5\n---\n\nOld body.\n";
    fs::write(
        catalog_dir.join("Annie Duke - Thinking in Bets.md"),
        earlier,
    )
    .unwrap();
    // Same book, moved and renamed by the owner, in a subfolder.
    fs::create_dir_all(catalog_dir.join("Shelved")).unwrap();
    fs::write(
        catalog_dir.join("Shelved/culture.md"),
        "---\ntitle: The  Culture Map\nauthor: erin meyer\nstatus: done\n---\n",
    )
    .unwrap();
    // The usual name of a new book is taken by a different book / a plain note.
    fs::write(
        catalog_dir.join("Cal Newport - Deep Work.md"),
        "# my reading plan\n",
    )
    .unwrap();
    fs::write(
        catalog_dir.join("david epstein - range.md"),
        "---\ntitle: Range (2nd ed.)\nauthor: David Epstein\n---\n",
    )
    .unwrap();
    let before = snapshot(&catalog_dir);

    let mut csv = Csv::new(&HEADER);
    let bets = csv.push(&row(
        "Thinking in Bets",
        "Annie Duke",
        "",
        "",
        "",
        "",
        "5",
        "Downloaded",
        "",
        "Old body.",
    ));
    let culture = csv.push(&row(
        "The Culture Map",
        "Erin Meyer",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
    ));
    csv.push(&row(
        "Deep Work",
        "Cal Newport",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
    ));
    csv.push(&row(
        "Range",
        "David Epstein",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
    ));
    let csv_path = write_csv(dir.path(), "export.csv", &csv.text);
    let report = import(&csv_path, &catalog_dir, false).unwrap();

    let existing: Vec<(u64, &str, Vec<&str>)> = report
        .existing
        .iter()
        .map(|e| (e.line, e.file.as_str(), e.differs.clone()))
        .collect();
    assert_eq!(
        existing,
        [
            (bets, "Annie Duke - Thinking in Bets.md", vec![]),
            (
                culture,
                "Shelved/culture.md",
                vec!["title", "author", "status"]
            )
        ]
    );
    let created: Vec<&str> = report.created.iter().map(|c| c.file.as_str()).collect();
    assert_eq!(
        created,
        [
            "Cal Newport - Deep Work (2).md",
            "David Epstein - Range (2).md"
        ],
        "case-insensitive names never clobber"
    );
    for (name, (bytes, modified)) in &before {
        let path = catalog_dir.join(name);
        if path.is_file() {
            assert_eq!(
                (
                    &fs::read(&path).unwrap(),
                    &fs::metadata(&path).unwrap().modified().unwrap()
                ),
                (bytes, modified),
                "{name} changed"
            );
        }
    }
    assert_eq!(
        fs::read_to_string(catalog_dir.join("Shelved/culture.md")).unwrap(),
        "---\ntitle: The  Culture Map\nauthor: erin meyer\nstatus: done\n---\n"
    );
}

#[test]
fn a_csv_that_cannot_be_imported_writes_nothing() {
    let dir = temp();
    let catalog_dir = dir.path().join("Catalog");
    fs::create_dir_all(&catalog_dir).unwrap();
    fs::write(
        catalog_dir.join("Annie Duke - Thinking in Bets.md"),
        "---\ntitle: Thinking in Bets\nauthor: Annie Duke\n---\nmine\n",
    )
    .unwrap();
    let before = snapshot(&catalog_dir);
    let cases: Vec<(PathBuf, &str)> = vec![
        (
            write_csv(
                dir.path(),
                "no-author.csv",
                "\"Book Title\",\"Status\"\n\"New Book\",\"Downloaded\"\n",
            ),
            "no \"Author\" column",
        ),
        (
            write_csv(dir.path(), "other.csv", "Name,Email\nA,b@example.com\n"),
            "no \"Book Title\" or \"Author\" column",
        ),
        (
            write_csv(dir.path(), "empty.csv", ""),
            "no \"Book Title\" or \"Author\" column",
        ),
        (
            write_csv(
                dir.path(),
                "twice.csv",
                "Book Title,Author,Status,Status\nA,B,Downloaded,\n",
            ),
            "\"Status\" appears more than once",
        ),
        (dir.path().join("missing.csv"), "cannot read the CSV file"),
        (catalog_dir.clone(), "is not a file"),
    ];
    let bad_utf8 = dir.path().join("latin1.csv");
    fs::write(&bad_utf8, b"Book T\xedtle,Author\nX,Y\n").unwrap();
    for (path, expected) in cases
        .iter()
        .map(|(p, e)| (p.as_path(), *e))
        .chain([(bad_utf8.as_path(), "header row cannot be read")])
    {
        let error = format!("{:#}", import(path, &catalog_dir, false).unwrap_err());
        assert!(error.contains(expected), "{}: {error}", path.display());
        assert_eq!(
            snapshot(&catalog_dir),
            before,
            "{} changed the catalog",
            path.display()
        );
    }
    // A missing catalog folder is not created by a refused or dry import.
    let fresh = dir.path().join("Fresh/Catalog");
    assert!(import(&cases[0].0, &fresh, false).is_err());
    let mut csv = Csv::new(&HEADER);
    csv.push(&row("New", "Author", "", "", "", "", "", "", "", ""));
    let ok = write_csv(dir.path(), "ok.csv", &csv.text);
    assert_eq!(import(&ok, &fresh, true).unwrap().created.len(), 1);
    assert!(!fresh.exists(), "dry run created the folder");
}

#[test]
fn an_interrupted_import_resumes_without_partial_or_duplicate_files() {
    let dir = temp();
    let (csv, _) = sheet();
    let root = dir.path().join("library");
    let catalog_dir = root.join("Catalog");
    // A first run that stopped after a few rows, leaving an unpublished file.
    let (csv, at) = (csv, sheet().1);
    let cut: String = csv
        .text
        .split_inclusive('\n')
        .take(at["dots"] as usize - 1)
        .collect();
    let partial = import(
        &write_csv(dir.path(), "first.csv", &cut),
        &catalog_dir,
        false,
    )
    .unwrap();
    assert_eq!(partial.created.len(), 6);
    fs::write(
        catalog_dir.join(".properbooky-import-abc123.tmp"),
        "---\ntitle: half writ",
    )
    .unwrap();
    // The leftover is invisible to the index meanwhile.
    let conn = db::open(&dir.path().join("index.db")).unwrap();
    assert_eq!(
        scanner::scan_library(&conn, &root).unwrap().indexed,
        partial.created.len()
    );

    let full = import(
        &write_csv(dir.path(), "export.csv", &csv.text),
        &catalog_dir,
        false,
    )
    .unwrap();
    assert_eq!(full.temp_files_removed, 1);
    assert_eq!(full.existing.len(), partial.created.len());
    assert_eq!(full.created.len() + full.existing.len(), 14);
    let files = md_files(&catalog_dir);
    assert_eq!(files.len(), 14, "{files:?}");
    assert_eq!(
        by_title(&catalog_dir).len(),
        14,
        "every file is a complete profile"
    );
}

#[test]
fn an_export_cut_off_inside_a_quoted_field_loses_no_row_silently() {
    let dir = temp();
    let mut csv = Csv::new(&["Book Title", "Author", "Latticework"]);
    csv.push(&["Whole", "Author", "complete \"quoted\" body"]);
    let cut_line = csv.raw("\"Cut Off\",\"Author\",\"first paragraph\nsecond para");
    let catalog_dir = dir.path().join("Catalog");
    let report = import(
        &write_csv(dir.path(), "cut.csv", csv.text.trim_end()),
        &catalog_dir,
        false,
    )
    .unwrap();
    assert_eq!(report.created.len(), 1);
    assert_eq!(report.rejected.len(), 1);
    assert_eq!(report.rejected[0].line, cut_line);
    assert!(
        report.rejected[0]
            .reason
            .contains("ends inside a quoted field"),
        "{}",
        report.rejected[0].reason
    );
    assert_eq!(md_files(&catalog_dir), ["Author - Whole.md"]);
}

#[test]
fn utf8_bom_crlf_and_column_order_are_accepted() {
    let dir = temp();
    let mut text = String::from("\u{feff}Status,Rating,Author,Book Title,Latticework\r\n");
    text.push_str("Downloaded,4,Annie Duke,Thinking in Bets,\"first\r\nsecond\"\r\n");
    text.push_str("Need to read now,,Erin Meyer,The Culture Map,\r\n");
    let csv_path = write_csv(dir.path(), "bom.csv", &text);
    let catalog_dir = dir.path().join("Catalog");
    let report = import(&csv_path, &catalog_dir, false).unwrap();
    assert!(report.rejected.is_empty(), "{:?}", report.rejected);
    let profiles = by_title(&catalog_dir);
    let (_, bets, body) = &profiles["Thinking in Bets"];
    assert_eq!(
        (bets.status.as_str(), bets.rating, body.as_str()),
        ("available", Some(4), "first\r\nsecond")
    );
    assert_eq!(profiles["The Culture Map"].1.status, "queued");
}

#[cfg(unix)]
#[test]
fn the_library_catalog_folder_must_stay_inside_the_library() {
    let dir = temp();
    let root = dir.path().join("library");
    let elsewhere = dir.path().join("other-library/Catalog");
    fs::create_dir_all(&root).unwrap();
    fs::create_dir_all(&elsewhere).unwrap();
    assert_eq!(
        catalog_import::catalog_dir(&root).unwrap(),
        root.join("Catalog"),
        "missing folder is fine"
    );
    std::os::unix::fs::symlink(&elsewhere, root.join("Catalog")).unwrap();
    let error = catalog_import::catalog_dir(&root).unwrap_err().to_string();
    assert!(error.contains("is a link to another folder"), "{error}");
    fs::remove_file(root.join("Catalog")).unwrap();
    fs::create_dir(root.join("Catalog")).unwrap();
    assert!(catalog_import::catalog_dir(&root).is_ok());
}

/// One row of the representative ~1700-row sheet (PBK-19/PBK-15 integration):
/// varied status spellings, ratings, topics, sparse optional fields and
/// multi-line Latticework, deterministic so every run checks the same rows.
struct Representative {
    title: String,
    author: String,
    released: String,
    types: &'static str,
    topics: String,
    rec: &'static str,
    rating: &'static str,
    status: &'static str,
    input: String,
    lattice: String,
}

fn representative_row(i: usize) -> Representative {
    const ADJ: [&str; 45] = [
        "Amber",
        "Brass",
        "Cedar",
        "Copper",
        "Crimson",
        "Dusky",
        "Ember",
        "Fallow",
        "Gilded",
        "Granite",
        "Hollow",
        "Indigo",
        "Ivory",
        "Juniper",
        "Kestrel",
        "Lunar",
        "Marble",
        "Mossy",
        "Northern",
        "Ochre",
        "Pale",
        "Quiet",
        "Russet",
        "Saffron",
        "Silver",
        "Sable",
        "Tawny",
        "Umber",
        "Velvet",
        "Verdant",
        "Wandering",
        "Willow",
        "Winter",
        "Yonder",
        "Zinc",
        "Ashen",
        "Briar",
        "Coral",
        "Drifting",
        "Faded",
        "Golden",
        "Harbor",
        "Iron",
        "Jade",
        "Linen",
    ];
    const NOUN: [&str; 40] = [
        "Almanac",
        "Bridge",
        "Chronicle",
        "Compass",
        "Counsel",
        "Dialogue",
        "Echo",
        "Engine",
        "Garden",
        "Grammar",
        "Harvest",
        "Inquiry",
        "Journal",
        "Kingdom",
        "Lexicon",
        "Meridian",
        "Mosaic",
        "Narrative",
        "Observatory",
        "Parable",
        "Primer",
        "Quarry",
        "Reckoning",
        "Sonata",
        "Testament",
        "Theorem",
        "Treatise",
        "Uprising",
        "Voyage",
        "Wager",
        "Workshop",
        "Archive",
        "Bestiary",
        "Cipher",
        "Doctrine",
        "Expedition",
        "Fable",
        "Gazette",
        "Horizon",
        "Inventory",
    ];
    const FIRST: [&str; 30] = [
        "Ada", "Bram", "Cyrus", "Dalia", "Elio", "Farah", "Gideon", "Hana", "Ilse", "Joaquín",
        "Kenji", "Leona", "Milo", "Nadia", "Oren", "Priya", "Quentin", "Rhea", "Soren", "Tamsin",
        "Ulla", "Viktor", "Wren", "Xiomara", "Yusuf", "Zelda", "Anouk", "Bastian", "Céline",
        "Dmitri",
    ];
    const LAST: [&str; 30] = [
        "Abernathy",
        "Bellweather",
        "Castellano",
        "Drummond",
        "Eberhardt",
        "Fairweather",
        "Gallagher",
        "Holloway",
        "Ishikawa",
        "Jovanovic",
        "Kowalczyk",
        "Lindqvist",
        "Montgomery",
        "Nakashima",
        "Oyelaran",
        "Pemberton",
        "Quintero",
        "Rasmussen",
        "Szymanski",
        "Thornbury",
        "Underhill",
        "Valdivia",
        "Whitcombe",
        "Xanthos",
        "Yamamoto",
        "Zielinski",
        "Achterberg",
        "Brennan",
        "Cavendish",
        "Delacroix",
    ];
    const TOPICS: [&str; 12] = [
        "Philosophy",
        "History",
        "Economics",
        "Psychology",
        "Biology",
        "Mathematics",
        "Fiction",
        "Poetry",
        "Engineering",
        "Design",
        "Music",
        "Cartography",
    ];
    const STATUS: [&str; 20] = [
        "Downloaded",
        "Downloaded",
        "Downloaded",
        "Downloaded",
        "Downloaded",
        "Downloaded",
        "downloaded",
        "Need to read now",
        "Need to read now",
        "need to read  NOW",
        "Reading",
        "Not downloaded",
        "Need to read",
        "Done",
        "",
        "",
        "",
        "",
        "",
        "",
    ];
    const RATINGS: [&str; 9] = ["", "5", "4", "3", "", "2", "1", "4", "5"];
    let adj = ADJ[i % 45];
    let noun = NOUN[(i / 45 + i % 45) % 40];
    let base = format!("{}{adj} {noun}", if i % 97 == 0 { "Élan " } else { "" });
    let title = match i % 6 {
        0 => format!("The {base}"),
        1 => base.clone(),
        2 => format!("{base}: Notes on Practice"),
        3 => format!("{base}, Volume {}", 1 + i % 4),
        4 => format!("On the {base}"),
        _ => format!("{base} (Revised Edition)"),
    };
    let k = (i * 13) % 330;
    let status = STATUS[i % 20];
    let mut rating = RATINGS[i % 9];
    if map_status(status) == "queued" && rating == "1" {
        rating = "2";
    }
    let topics = if i % 31 == 0 {
        "History,, Design ,".to_owned()
    } else {
        (0..i % 4)
            .map(|j| TOPICS[(i + j * 5) % 12])
            .collect::<Vec<_>>()
            .join(", ")
    };
    let lattice = match i % 4 {
        0 => format!(
            "## Latticework\n\n{adj} ideas connect to the {}.\n---\nkey: {i}\n# not a heading in YAML\n  - indented line   \n\nCJK 思考 · row {i}",
            noun.to_lowercase()
        ),
        1 => format!("He said \"hello\" ({i}), then left."),
        _ => String::new(),
    };
    Representative {
        title,
        author: format!("{} {}", FIRST[k % 30], LAST[(k / 30) % 30]),
        released: if i % 3 == 2 {
            String::new()
        } else {
            (1850 + (i * 37) % 175).to_string()
        },
        types: ["Book", "Novel", "Essay", ""][i % 4],
        topics,
        rec: ["Must read", "Maybe", "", "Skim", ""][i % 5],
        rating,
        status,
        input: if i % 11 == 0 {
            String::new()
        } else {
            format!("2024-{:02}-{:02}", 1 + i % 12, 1 + i % 28)
        },
        lattice,
    }
}

#[test]
fn a_representative_1700_row_sheet_imports_each_book_once_and_reruns_unchanged() {
    const UNIQUE: usize = 1690;
    let dir = temp();
    let root = dir.path().join("library");
    fs::create_dir_all(root.join("Shelf")).unwrap();
    fs::write(root.join("Shelf/Plain File.pdf"), b"%PDF-1.4 synthetic").unwrap();
    let books: Vec<Representative> = (0..UNIQUE).map(representative_row).collect();
    let mut csv = Csv::new(&HEADER);
    let mut first_line = Vec::new();
    let mut duplicates = Vec::new();
    for (i, b) in books.iter().enumerate() {
        first_line.push(csv.push(&row(
            &b.title,
            &b.author,
            &b.released,
            b.types,
            &b.topics,
            b.rec,
            b.rating,
            b.status,
            &b.input,
            &b.lattice,
        )));
        // A later row of the same book under case/space variants collapses into the first.
        if i % 70 == 35 {
            let s = i - 30;
            let variant = match i % 3 {
                0 => books[s].title.to_uppercase(),
                1 => format!(
                    "  {} ",
                    books[s].title.split(' ').collect::<Vec<_>>().join("   ")
                ),
                _ => books[s].title.to_lowercase(),
            };
            let author = books[s].author.to_lowercase();
            let line = csv.push(&row(
                &variant,
                &author,
                "",
                "",
                "",
                "",
                "1",
                "Downloaded",
                "",
                "a later note",
            ));
            duplicates.push((line, first_line[s]));
        }
        if i == 400 {
            csv.push(&row(
                "No Author Here",
                "",
                "",
                "",
                "",
                "",
                "",
                "Downloaded",
                "",
                "",
            ));
        }
        if i == 1200 {
            csv.push(&row(
                "Half Stars",
                "Rater",
                "",
                "",
                "",
                "",
                "4.5",
                "",
                "",
                "",
            ));
        }
    }
    assert!(
        (1700..=1730).contains(&csv.rows.len()),
        "{} rows",
        csv.rows.len()
    );
    let csv_path = write_csv(dir.path(), "export.csv", &csv.text);
    let catalog_dir = catalog_import::catalog_dir(&root).unwrap();

    let report = import(&csv_path, &catalog_dir, false).unwrap();
    assert_eq!(report.created.len(), UNIQUE);
    assert_eq!(report.rejected.len(), 2, "{:?}", report.rejected);
    assert!(
        report.near_duplicates.is_empty(),
        "{:?}",
        report.near_duplicates
    );
    let got: Vec<(u64, u64)> = report
        .duplicates
        .iter()
        .map(|d| (d.line, d.first_line))
        .collect();
    assert_eq!(got, duplicates);
    assert_eq!(md_files(&catalog_dir).len(), UNIQUE);

    // Every profile: valid YAML, every field of its (first) row, body whole.
    let profiles = by_title(&catalog_dir);
    assert_eq!(profiles.len(), UNIQUE);
    for b in &books {
        let (name, entry, body) = profiles
            .get(&b.title)
            .unwrap_or_else(|| panic!("no profile for {}", b.title));
        let opt = |s: &str| (!s.is_empty()).then(|| s.to_owned());
        assert_eq!(entry.author.as_deref(), Some(b.author.as_str()), "{name}");
        assert_eq!(entry.status, map_status(b.status), "{name}");
        assert_eq!(entry.rating, b.rating.parse().ok(), "{name}");
        assert_eq!(entry.recommendation, opt(b.rec), "{name}");
        assert_eq!(entry.r#type, opt(b.types), "{name}");
        assert_eq!(entry.published, opt(&b.released), "{name}");
        assert_eq!(entry.added, opt(&b.input), "{name}");
        let topics: Vec<String> = b
            .topics
            .split(',')
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .map(ToOwned::to_owned)
            .collect();
        assert_eq!(entry.topics, topics, "{name}");
        assert_eq!(
            entry.extra.get("source_status").and_then(|v| v.as_str()),
            opt(b.status).as_deref(),
            "{name}"
        );
        assert_eq!(body.trim_start_matches('\n'), b.lattice.trim(), "{name}");
    }

    // Rerun: nothing created, every byte and modification time unchanged.
    let before = snapshot(&catalog_dir);
    std::thread::sleep(std::time::Duration::from_millis(20));
    let again = import(&csv_path, &catalog_dir, false).unwrap();
    assert!(again.created.is_empty());
    assert_eq!(again.existing.len(), UNIQUE);
    assert!(again.existing.iter().all(|e| e.differs.is_empty()));
    assert_eq!(snapshot(&catalog_dir), before);

    // Rescan indexes the catalog beside the file; statuses, ratings and search.
    let conn = db::open(&dir.path().join("index/library.db")).unwrap();
    let scan = scanner::scan_library(&conn, &root).unwrap();
    assert_eq!(scan.indexed, UNIQUE + 1);
    let listed = library::list(&conn, &root, None).unwrap();
    let count = |s: &str| {
        listed
            .iter()
            .filter(|b| b.status.as_deref() == Some(s))
            .count()
    };
    let want = |s: &str| books.iter().filter(|b| map_status(b.status) == s).count();
    for s in ["available", "queued", "wishlist"] {
        assert_eq!(count(s), want(s), "{s}");
    }
    let rated = |r: Option<i64>| {
        listed
            .iter()
            .filter(|b| b.kind == "catalog" && b.rating == r)
            .count()
    };
    for r in [None, Some(1), Some(2), Some(3), Some(4), Some(5)] {
        assert_eq!(
            rated(r),
            books.iter().filter(|b| b.rating.parse().ok() == r).count(),
            "{r:?}"
        );
    }
    let titles = |q: &str| {
        let mut t: Vec<String> = library::list(&conn, &root, Some(q))
            .unwrap()
            .into_iter()
            .map(|b| b.title)
            .collect();
        t.sort();
        t
    };
    let author = books[777].author.clone();
    let mut by_author: Vec<String> = books
        .iter()
        .filter(|b| b.author == author)
        .map(|b| b.title.clone())
        .collect();
    by_author.sort();
    assert!(by_author.len() >= 3);
    assert_eq!(
        titles(&author.to_lowercase()),
        by_author,
        "search by author"
    );
    assert_eq!(
        titles("ivory wager volume"),
        ["Ivory Wager, Volume 2"],
        "search by title"
    );
    assert!(titles("zzqx").is_empty());
    assert_eq!(
        snapshot(&catalog_dir),
        before,
        "scan and search write no profile"
    );
}
