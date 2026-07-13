/** Find `exact` (whitespace-insensitively) inside a rendered container and
 * return a DOM Range over it, or null when the quote isn't present. Shared
 * by the PDF text layer and the article reader. */
export function rangeForQuote(container: HTMLElement, exact: string): Range | null {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes: { node: Text; start: number }[] = [];
  let combined = "";
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push({ node: n as Text, start: combined.length });
    combined += n.textContent ?? "";
  }
  if (!combined) return null;

  const pattern = exact
    .trim()
    .split(/\s+/)
    .map((tok) => tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s*");
  let match: RegExpExecArray | null = null;
  try {
    match = new RegExp(pattern).exec(combined);
  } catch {
    return null;
  }
  if (!match) return null;

  const locate = (offset: number, isEnd: boolean) => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const { node, start } = nodes[i];
      const len = node.textContent?.length ?? 0;
      if (offset > start || (isEnd ? offset === start + len : offset >= start)) {
        if (offset <= start + len) return { node, offset: offset - start };
      }
    }
    return null;
  };
  const from = locate(match.index, false);
  const to = locate(match.index + match[0].length, true);
  if (!from || !to) return null;

  const range = document.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  return range;
}

/** Selection → quote anchor pieces (exact + context), or null. */
export function captureQuoteSelection(container: HTMLElement) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;
  const collapse = (s: string) => s.replace(/\s+/g, " ").trim();
  const exact = collapse(selection.toString());
  if (!exact) return null;
  const pageText = collapse(container.textContent ?? "");
  const index = pageText.indexOf(exact);
  return {
    exact,
    prefix: index > 0 ? pageText.slice(Math.max(0, index - 32), index) : "",
    suffix:
      index >= 0
        ? pageText.slice(index + exact.length, index + exact.length + 32)
        : "",
    start: index,
    end: index >= 0 ? index + exact.length : -1,
  };
}
