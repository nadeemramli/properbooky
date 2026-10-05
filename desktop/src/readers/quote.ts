/** Quote anchoring over a rendered container (PDF text layer, EPUB section,
 * article body). The canonical text space is the concatenation of the
 * container's text nodes in document order — for the PDF text layer that is
 * pdf.js's text items for the page, independent of zoom. `start`/`end` are
 * offsets in that space (W3C TextPositionSelector); `exact`/`prefix`/`suffix`
 * form the TextQuoteSelector. */

export interface QuoteSelector {
  exact: string;
  prefix: string;
  suffix: string;
}

export interface PositionSelector {
  start: number;
  end: number;
}

const CONTEXT = 32;

interface TextIndex {
  nodes: { node: Text; start: number }[];
  text: string;
}

/** The document a node lives in (EPUB sections render in an iframe). */
const docOf = (node: Node): Document =>
  node.nodeType === Node.DOCUMENT_NODE ? (node as Document) : node.ownerDocument!;

function indexText(container: Node): TextIndex {
  const walker = docOf(container).createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes: { node: Text; start: number }[] = [];
  let text = "";
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push({ node: n as Text, start: text.length });
    text += n.textContent ?? "";
  }
  return { nodes, text };
}

/** Offset of a DOM boundary point in the container's text space. */
function offsetOf(index: TextIndex, container: Node, node: Node, offset: number): number | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const hit = index.nodes.find((n) => n.node === node);
    return hit ? hit.start + offset : null;
  }
  // Element boundary: count the text before the offset-th child.
  const probe = docOf(container).createRange();
  probe.setStart(container, 0);
  try {
    probe.setEnd(node, offset);
  } catch {
    return null;
  }
  return probe.toString().length;
}

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** Selection → quote + position selectors, measured where the user actually
 * selected (not the first occurrence of the same words). */
export function captureQuoteSelection(container: HTMLElement) {
  const selection = container.ownerDocument.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  return captureRange(container, selection.getRangeAt(0));
}

export function captureRange(container: Node, range: Range) {
  if (!container.contains(range.commonAncestorContainer)) return null;
  const index = indexText(container);
  let start = offsetOf(index, container, range.startContainer, range.startOffset);
  let end = offsetOf(index, container, range.endContainer, range.endOffset);
  if (start === null || end === null || end <= start) return null;
  // Trim surrounding whitespace so the stored quote is what reads as selected.
  while (start < end && /\s/.test(index.text[start])) start++;
  while (end > start && /\s/.test(index.text[end - 1])) end--;
  const exact = collapse(index.text.slice(start, end));
  if (!exact) return null;
  return {
    exact,
    prefix: index.text.slice(Math.max(0, start - CONTEXT), start),
    suffix: index.text.slice(end, end + CONTEXT),
    start,
    end,
  };
}

/** Score how well the text around an occurrence matches the stored context. */
function contextScore(text: string, from: number, to: number, quote?: Partial<QuoteSelector>) {
  let score = 0;
  const before = collapse(text.slice(Math.max(0, from - CONTEXT * 2), from));
  const after = collapse(text.slice(to, to + CONTEXT * 2));
  const prefix = collapse(quote?.prefix ?? "");
  const suffix = collapse(quote?.suffix ?? "");
  if (prefix && before.endsWith(prefix)) score += 2;
  else if (prefix && before.endsWith(prefix.slice(-8))) score += 1;
  if (suffix && after.startsWith(suffix)) score += 2;
  else if (suffix && after.startsWith(suffix.slice(0, 8))) score += 1;
  return score;
}

/** Find the stored quote in a rendered container and return a Range over the
 * occurrence that best matches position + prefix/suffix, or null when the
 * quote isn't present. Whitespace-insensitive, so line breaks in the text
 * layer don't matter. */
export function rangeForQuote(
  container: Node,
  exact: string,
  hints?: { quote?: Partial<QuoteSelector>; position?: Partial<PositionSelector> },
): Range | null {
  const index = indexText(container);
  if (!index.text) return null;
  const pattern = exact
    .trim()
    .split(/\s+/)
    .map((tok) => tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s*");
  if (!pattern) return null;
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, "g");
  } catch {
    return null;
  }
  const matches: { from: number; to: number }[] = [];
  for (let m = regex.exec(index.text); m; m = regex.exec(index.text)) {
    matches.push({ from: m.index, to: m.index + m[0].length });
    if (m[0].length === 0) regex.lastIndex++;
  }
  if (!matches.length) return null;

  const start = hints?.position?.start;
  const best = matches
    .map((m) => ({
      ...m,
      exactPosition: typeof start === "number" && m.from === start,
      score: contextScore(index.text, m.from, m.to, hints?.quote),
      distance: typeof start === "number" ? Math.abs(m.from - start) : 0,
    }))
    .sort(
      (a, b) =>
        Number(b.exactPosition && b.score > 0) - Number(a.exactPosition && a.score > 0) ||
        b.score - a.score ||
        a.distance - b.distance ||
        a.from - b.from,
    )[0];

  const locate = (offset: number, isEnd: boolean) => {
    for (let i = index.nodes.length - 1; i >= 0; i--) {
      const { node, start: nodeStart } = index.nodes[i];
      const len = node.textContent?.length ?? 0;
      if (offset > nodeStart || (isEnd ? offset === nodeStart + len : offset >= nodeStart)) {
        if (offset <= nodeStart + len) return { node, offset: offset - nodeStart };
      }
    }
    return null;
  };
  const from = locate(best.from, false);
  const to = locate(best.to, true);
  if (!from || !to) return null;

  const range = docOf(container).createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  return range;
}
