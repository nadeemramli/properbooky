import { useState } from "react";
import type { Highlight } from "../types";

function locationLabel(highlight: Highlight): string {
  if (highlight.anchor.page != null) return `page ${highlight.anchor.page}`;
  if (highlight.anchor.cfi) return "epub location";
  if (highlight.anchor.type === "article") return "article";
  return "";
}

export default function HighlightsPanel({
  highlights,
  onJump,
  onDelete,
  onNote,
  onClose,
}: {
  highlights: Highlight[];
  onJump: (highlight: Highlight) => void;
  onDelete: (highlight: Highlight) => void;
  onNote: (highlight: Highlight, note: string) => void;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  return (
    <aside className="highlights-panel" aria-label="Highlights">
      <header className="highlights-panel-head">
        <h3>Highlights</h3>
        <button className="panel-close" onClick={onClose} aria-label="Close highlights">
          ×
        </button>
      </header>
      {highlights.length === 0 ? (
        <p className="highlights-empty">
          Nothing highlighted yet. Select text on the page and press
          “Highlight”.
        </p>
      ) : (
        <ul>
          {highlights.map((highlight) => (
            <li key={highlight.id}>
              <blockquote onClick={() => onJump(highlight)} title="Go to highlight">
                {highlight.text.length > 220
                  ? `${highlight.text.slice(0, 220)}…`
                  : highlight.text}
              </blockquote>
              <div className="highlight-row-meta">
                <span>{locationLabel(highlight)}</span>
                <span>
                  <button
                    className="highlight-note-btn"
                    onClick={() => {
                      setEditing(highlight.id);
                      setDraft(highlight.note ?? "");
                    }}
                  >
                    {highlight.note ? "Edit note" : "Add note"}
                  </button>{" "}
                  <button
                    className="highlight-delete"
                    onClick={() => onDelete(highlight)}
                    aria-label="Remove highlight"
                    title="Remove highlight"
                  >
                    Remove
                  </button>
                </span>
              </div>
              {editing === highlight.id ? (
                <div className="note-editor">
                  <textarea
                    value={draft}
                    autoFocus
                    rows={3}
                    placeholder="Your thought about this passage…"
                    onChange={(e) => setDraft(e.currentTarget.value)}
                  />
                  <div className="note-editor-actions">
                    <button
                      onClick={() => {
                        onNote(highlight, draft.trim());
                        setEditing(null);
                      }}
                    >
                      Save note
                    </button>
                    <button className="pill-dismiss" onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                highlight.note && <p className="highlight-note">{highlight.note}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
