import type { Highlight } from "../types";

function locationLabel(highlight: Highlight): string {
  if (highlight.anchor.page != null) return `page ${highlight.anchor.page}`;
  if (highlight.anchor.cfi) return "epub location";
  return "";
}

export default function HighlightsPanel({
  highlights,
  onJump,
  onDelete,
  onClose,
}: {
  highlights: Highlight[];
  onJump: (highlight: Highlight) => void;
  onDelete: (highlight: Highlight) => void;
  onClose: () => void;
}) {
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
                <button
                  className="highlight-delete"
                  onClick={() => onDelete(highlight)}
                  aria-label="Remove highlight"
                  title="Remove highlight"
                >
                  Remove
                </button>
              </div>
              {highlight.note && <p className="highlight-note">{highlight.note}</p>}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
