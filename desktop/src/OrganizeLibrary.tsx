import { useEffect, useMemo, useRef, useState } from "react";
import { useLibrary } from "./library";
import type { Book, Organisation, OrganisationView } from "./types";

const labelKey = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
function canonical(value: string, aliases: Record<string, string>): string {
  const seen = new Set<string>();
  while (
    Object.prototype.hasOwnProperty.call(aliases, labelKey(value)) &&
    !seen.has(labelKey(value))
  ) {
    seen.add(labelKey(value));
    value = aliases[labelKey(value)];
  }
  return value;
}
type Roadmap = Organisation["roadmaps"][number];

export default function OrganizeLibrary({
  onClose,
  onSaved,
  onOpen,
}: {
  onClose: () => void;
  onSaved: () => Promise<void>;
  onOpen: (book: Book) => void;
}) {
  const { invoke } = useLibrary();
  const dialog = useRef<HTMLDialogElement>(null);
  const [saved, setSaved] = useState<OrganisationView | null>(null);
  const [value, setValue] = useState<Organisation | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [page, setPage] = useState<"labels" | "roadmaps">("labels");
  const [kind, setKind] = useState<"authors" | "topics">("authors");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selected, setSelected] = useState("");
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
    let active = true;
    Promise.all([
      invoke<OrganisationView>("get_organisation"),
      invoke<Book[]>("list_books", { query: null }),
    ])
      .then(([org, found]) => {
        if (active) {
          setSaved(org);
          setValue(org.value);
          setBooks(found);
          setSelected(org.value.roadmaps[0]?.id ?? "");
        }
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, []);
  const bySource = useMemo(() => {
    const map = new Map<string, Book>();
    for (const book of books) {
      map.set(book.stable_id, book);
      for (const source of book.source_profiles) map.set(source.id, book);
    }
    return map;
  }, [books]);
  const dirty = Boolean(
    value && saved && JSON.stringify(value) !== JSON.stringify(saved.value),
  );
  const roadmap = value?.roadmaps.find((r) => r.id === selected);
  const groupedSteps = (r: Roadmap) => {
    const groups = new Map<string, Roadmap["steps"]>();
    for (const step of r.steps) {
      const id = bySource.get(step.profile_id)?.stable_id ?? step.profile_id;
      groups.set(id, [...(groups.get(id) ?? []), step]);
    }
    return [...groups].map(([id, steps]) => ({
      id,
      steps,
      book: bySource.get(id),
    }));
  };
  const groups = roadmap ? groupedSteps(roadmap) : [];
  const next = groups.find(
    (g) => g.book && !["finished", "stopped"].includes(g.book.reading_status),
  );
  function changeRoadmap(update: Partial<Roadmap>) {
    if (value && roadmap)
      setValue({
        ...value,
        roadmaps: value.roadmaps.map((r) =>
          r.id === roadmap.id ? { ...r, ...update } : r,
        ),
      });
  }
  async function save() {
    if (!value || !saved) return;
    setBusy(true);
    setError("");
    try {
      await invoke("save_organisation", { revision: saved.revision, value });
      await onSaved();
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  const options = [
    ...new Set(
      books.flatMap((b) =>
        b.source_profiles.flatMap((s) =>
          kind === "authors"
            ? s.author
              ? [s.author]
              : []
            : (s.category ?? "")
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean),
        ),
      ),
    ),
  ].sort();
  const affected =
    value && saved
      ? books.filter((b) =>
          b.source_profiles.some(
            (s) =>
              canonical(s.author ?? "", value.authors) !==
                canonical(s.author ?? "", saved.value.authors) ||
              (s.category ?? "")
                .split(",")
                .some(
                  (t) =>
                    canonical(t.trim(), value.topics) !==
                    canonical(t.trim(), saved.value.topics),
                ),
          ),
        )
      : [];
  return (
    <dialog
      ref={dialog}
      className="book-review organize-library"
      aria-labelledby="organize-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header className="review-header">
        <div>
          <p className="eyebrow">Your library</p>
          <h2 id="organize-title">Organize library</h2>
        </div>
        <button
          onClick={onClose}
          disabled={busy}
          aria-label="Close organization"
        >
          ×
        </button>
      </header>
      <p>
        Shared labels make shelves consistent. Roadmaps arrange books in reading
        order. Saved changes can be undone from Library cleanup.
      </p>
      {error && <p role="alert">{error}</p>}
      {!value ? (
        <p role="status">
          {error ? "Could not load library organization." : "Loading…"}
        </p>
      ) : preview ? (
        <section>
          <h3>Review organization changes</h3>
          <p>
            {affected.length} profiles will display updated author or topic
            labels. Original source labels remain searchable.
          </p>
          <ul>
            {affected.slice(0, 30).map((b) => (
              <li key={b.stable_id}>{b.title}</li>
            ))}
          </ul>
          {affected.length > 30 && (
            <p>And {affected.length - 30} more profiles.</p>
          )}
          <h4>Shared labels after saving</h4>
          <ul>
            {(["authors", "topics"] as const).flatMap((k) =>
              Object.entries(value[k]).map(([a, b]) => (
                <li key={`${k}-${a}`}>
                  {k === "authors" ? "Author" : "Topic"}: {a} → {b}
                </li>
              )),
            )}
          </ul>
          <h4>Roadmaps after saving</h4>
          {value.roadmaps.map((r) => (
            <article key={r.id}>
              <strong>{r.title}</strong>
              <p>{r.description}</p>
              <ol>
                {groupedSteps(r).map((g) => (
                  <li key={g.id}>
                    {g.book?.title ?? "Unavailable profile"}
                    {g.steps.some((s) => s.note)
                      ? ` — ${g.steps
                          .map((s) => s.note)
                          .filter(Boolean)
                          .join("; ")}`
                      : ""}
                  </li>
                ))}
              </ol>
            </article>
          ))}
          {saved?.value.roadmaps
            .filter((r) => !value.roadmaps.some((v) => v.id === r.id))
            .map((r) => (
              <p key={r.id}>
                Remove roadmap: {r.title}. Its books stay in the library.
              </p>
            ))}
          <footer>
            <button disabled={busy} onClick={() => setPreview(false)}>
              Back to organization
            </button>
            <button className="primary" disabled={busy} onClick={save}>
              {busy ? "Saving…" : "Save organization"}
            </button>
          </footer>
        </section>
      ) : (
        <>
          <nav className="chips" aria-label="Organization views">
            <button
              className={page === "labels" ? "chip chip-active" : "chip"}
              onClick={() => setPage("labels")}
            >
              Author and topic labels
            </button>
            <button
              className={page === "roadmaps" ? "chip chip-active" : "chip"}
              onClick={() => setPage("roadmaps")}
            >
              Reading roadmaps
            </button>
          </nav>
          {page === "labels" ? (
            <section>
              <h3>Use one preferred label</h3>
              <p>
                Map a spelling or variant to the label you prefer. Future
                imports use the same rule. Author names are matched as whole
                contributor labels; similar names are never combined
                automatically.
              </p>
              <div className="review-fields">
                <label>
                  Label type
                  <select
                    value={kind}
                    onChange={(e) => {
                      setKind(e.target.value as typeof kind);
                      setFrom("");
                      setTo("");
                    }}
                  >
                    <option value="authors">Author</option>
                    <option value="topics">Topic</option>
                  </select>
                </label>
                <label>
                  Existing label
                  <input
                    list="existing-labels"
                    value={from}
                    maxLength={250}
                    onChange={(e) => setFrom(e.target.value)}
                  />
                </label>
                <label>
                  Preferred label
                  <input
                    value={to}
                    maxLength={250}
                    onChange={(e) => setTo(e.target.value)}
                  />
                </label>
                <datalist id="existing-labels">
                  {options.map((o) => (
                    <option key={o} value={o} />
                  ))}
                </datalist>
              </div>
              <button
                disabled={!from.trim() || !to.trim()}
                onClick={() => {
                  setValue({
                    ...value,
                    [kind]: { ...value[kind], [labelKey(from)]: to.trim() },
                  });
                  setFrom("");
                  setTo("");
                }}
              >
                Add label rule
              </button>
              <ul className="label-rules">
                {Object.entries(value[kind]).map(([a, b]) => (
                  <li key={a}>
                    <span>
                      {a} → {b}
                    </span>
                    <button
                      aria-label={`Remove label rule ${a}`}
                      onClick={() => {
                        const aliases = { ...value[kind] };
                        delete aliases[a];
                        setValue({ ...value, [kind]: aliases });
                      }}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
              <p>{affected.length} profiles affected by your changes.</p>
            </section>
          ) : (
            <section>
              <div className="roadmap-toolbar">
                <label>
                  Roadmap
                  <select
                    value={selected}
                    onChange={(e) => setSelected(e.target.value)}
                  >
                    <option value="">Choose a roadmap</option>
                    {value.roadmaps.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.title}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  onClick={() => {
                    const id = crypto.randomUUID();
                    setValue({
                      ...value,
                      roadmaps: [
                        ...value.roadmaps,
                        {
                          id,
                          title: "New reading roadmap",
                          description: "",
                          steps: [],
                        },
                      ],
                    });
                    setSelected(id);
                  }}
                >
                  New roadmap
                </button>
              </div>
              {roadmap ? (
                <>
                  <div className="review-fields">
                    <label>
                      Roadmap title
                      <input
                        value={roadmap.title}
                        maxLength={250}
                        onChange={(e) =>
                          changeRoadmap({ title: e.target.value })
                        }
                      />
                    </label>
                    <label className="wide">
                      Purpose
                      <textarea
                        value={roadmap.description}
                        maxLength={5000}
                        onChange={(e) =>
                          changeRoadmap({ description: e.target.value })
                        }
                      />
                    </label>
                  </div>
                  <p>
                    {
                      groups.filter(
                        (g) => g.book?.reading_status === "finished",
                      ).length
                    }{" "}
                    of {groups.length} finished
                    {next ? ` · Next: ${next.book?.title}` : ""}
                  </p>
                  <ol className="roadmap-steps">
                    {groups.map((g, index) => (
                      <li key={g.id}>
                        <strong>
                          {g.book?.title ??
                            "Profile unavailable — restore its source to reconnect"}
                        </strong>
                        {g.book && (
                          <p>
                            {g.book.author} · {g.book.reading_status} ·{" "}
                            {g.book.availability === "local"
                              ? "On the shelf"
                              : g.book.availability === "missing"
                                ? "File missing"
                                : "No local file"}
                            {next?.id === g.id ? " · Next in this roadmap" : ""}
                          </p>
                        )}
                        {g.steps.map((step, i) => (
                          <label key={step.profile_id}>
                            Why read this
                            {g.steps.length > 1 ? ` (note ${i + 1})` : ""}
                            <textarea
                              value={step.note}
                              maxLength={5000}
                              onChange={(e) =>
                                changeRoadmap({
                                  steps: roadmap.steps.map((s) =>
                                    s.profile_id === step.profile_id
                                      ? { ...s, note: e.target.value }
                                      : s,
                                  ),
                                })
                              }
                            />
                          </label>
                        ))}
                        <div className="card-actions">
                          {([-1, 1] as const).map((direction) => (
                            <button
                              key={direction}
                              disabled={
                                index + direction < 0 ||
                                index + direction >= groups.length
                              }
                              aria-label={`${direction < 0 ? "Move earlier" : "Move later"}: ${g.book?.title ?? "Unavailable profile"}`}
                              onClick={() => {
                                const reordered = [...groups];
                                [
                                  reordered[index],
                                  reordered[index + direction],
                                ] = [
                                  reordered[index + direction],
                                  reordered[index],
                                ];
                                changeRoadmap({
                                  steps: reordered.flatMap(
                                    (group) => group.steps,
                                  ),
                                });
                              }}
                            >
                              {direction < 0 ? "Move earlier" : "Move later"}
                            </button>
                          ))}
                          <button
                            onClick={() =>
                              changeRoadmap({
                                steps: roadmap.steps.filter(
                                  (s) => !g.steps.includes(s),
                                ),
                              })
                            }
                          >
                            Remove from roadmap
                          </button>
                          {g.book?.assets.some(
                            (a) =>
                              a.available &&
                              ["pdf", "epub", "article"].includes(a.format),
                          ) && (
                            <button
                              disabled={dirty}
                              onClick={() => {
                                onClose();
                                onOpen(g.book!);
                              }}
                            >
                              Read book
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                  <label>
                    Find a book to add
                    <input
                      type="search"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Title, author or topic"
                    />
                  </label>
                  <div className="roadmap-results">
                    {books
                      .filter(
                        (b) =>
                          !groups.some((g) => g.id === b.stable_id) &&
                          `${b.title} ${b.author ?? ""} ${b.category ?? ""}`
                            .toLowerCase()
                            .includes(search.toLowerCase()),
                      )
                      .slice(0, 12)
                      .map((b) => (
                        <button
                          key={b.stable_id}
                          onClick={() =>
                            changeRoadmap({
                              steps: [
                                ...roadmap.steps,
                                { profile_id: b.stable_id, note: "" },
                              ],
                            })
                          }
                        >
                          Add: {b.title}
                        </button>
                      ))}
                  </div>
                  <button
                    onClick={() => {
                      setValue({
                        ...value,
                        roadmaps: value.roadmaps.filter(
                          (r) => r.id !== roadmap.id,
                        ),
                      });
                      setSelected("");
                    }}
                  >
                    Delete this roadmap
                  </button>
                </>
              ) : (
                <p>
                  Create a roadmap for a topic such as psychology, then add
                  books in the order you want to read them.
                </p>
              )}
            </section>
          )}
          <footer>
            <button onClick={onClose}>Close</button>
            <button
              className="primary"
              disabled={!dirty || value.roadmaps.some((r) => !r.title.trim())}
              onClick={() => {
                setPreview(true);
                dialog.current?.scrollTo(0, 0);
              }}
            >
              Preview organization
            </button>
          </footer>
        </>
      )}
    </dialog>
  );
}
