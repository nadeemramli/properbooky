import type { Book, BookEdit } from "./types";

export function bookEdit(book: Book): BookEdit {
  return {
    title: book.title,
    author: book.author,
    category: book.category,
    content_type: book.content_type,
    reading_status: book.reading_status,
    want_to_read: book.want_to_read,
    up_next: book.up_next,
  };
}

// Group harmless case/spacing variants for browsing, without conflating people
// with similar names or guessing how comma-separated contributor names split.
export const authorKey = (name: string) =>
  name.trim().replace(/\s+/g, " ").toLocaleLowerCase();
export const topicKey = (name: string) =>
  authorKey(name)
    .replace(/[‐‑–—-]/g, " ")
    .replace(/[.]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
export const topics = (value: string | null) =>
  (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
export function combinedTopics(books: Book[]): string | null {
  const labels = new Map<string, string>();
  for (const book of books)
    for (const label of topics(book.category)) {
      if (!labels.has(topicKey(label))) labels.set(topicKey(label), label);
    }
  return [...labels.values()].join(", ") || null;
}

export function authorLabels(book: Book): string[] {
  if (book.browse_authors) return book.browse_authors;
  return [
    ...new Set(
      [book.author, ...book.source_profiles.map((s) => s.author)].filter(
        (s): s is string => Boolean(s),
      ),
    ),
  ];
}
export function topicLabels(book: Book): string[] {
  if (book.browse_topics) return book.browse_topics;
  return [
    ...new Set(
      [book.category, ...book.source_profiles.map((s) => s.category)].flatMap(
        topics,
      ),
    ),
  ];
}
