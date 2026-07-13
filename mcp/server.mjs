#!/usr/bin/env node
// ProperBooky library MCP server (PBK-13): exposes the local library —
// catalog, files, articles, highlights — to any MCP client (Claude Code,
// Claude Desktop, …). Read-only. Files are the source of truth; the SQLite
// index provides search.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const DB_PATH =
  process.env.PROPERBOOKY_DB ??
  path.join(os.homedir(), ".local/share/com.nadeemramli.properbooky/library.db");

const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
const LIBRARY_ROOT =
  process.env.PROPERBOOKY_LIBRARY ??
  db.prepare("SELECT value FROM settings WHERE key = 'library_path'").get()?.value;

const ROW_FIELDS =
  "id, title, author, category, kind, status, rating, year, path, file_link, format";

function ftsQuery(query) {
  return query
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replaceAll('"', "")}"*`)
    .join(" ");
}

function text(payload) {
  return {
    content: [
      { type: "text", text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2) },
    ],
  };
}

function sidecarPath(bookPath) {
  const relative = bookPath.startsWith(LIBRARY_ROOT)
    ? bookPath.slice(LIBRARY_ROOT.length).replace(/^[/\\]/, "")
    : bookPath;
  const slug = relative.replaceAll("/", "__").replaceAll("\\", "__");
  return path.join(LIBRARY_ROOT, ".properbooky", "state", `${slug}.json`);
}

function liveHighlights(bookPath) {
  try {
    const sidecar = JSON.parse(fs.readFileSync(sidecarPath(bookPath), "utf8"));
    return (sidecar.highlights ?? []).filter((h) => !h.deleted);
  } catch {
    return [];
  }
}

const server = new McpServer({ name: "properbooky-library", version: "0.1.0" });

server.tool(
  "search_library",
  "Full-text search over the personal library: books (owned + wishlist), articles. Matches title, author, filename, category/topics.",
  { query: z.string(), limit: z.number().int().min(1).max(100).default(20) },
  async ({ query, limit }) => {
    const prefixed = ROW_FIELDS.split(", ")
      .map((c) => `b.${c}`)
      .join(", ");
    const rows = db
      .prepare(
        `SELECT ${prefixed} FROM books b
         JOIN books_fts f ON f.rowid = b.id
         WHERE books_fts MATCH ?
           AND NOT (b.kind = 'file' AND b.path IN
                    (SELECT file_link FROM books WHERE file_link IS NOT NULL))
         ORDER BY rank LIMIT ?`
      )
      .all(ftsQuery(query), limit);
    return text(rows);
  }
);

server.tool(
  "library_stats",
  "Counts by kind and status — the shape of the library.",
  {},
  async () => {
    const byKind = db.prepare("SELECT kind, COUNT(*) n FROM books GROUP BY kind").all();
    const byStatus = db
      .prepare("SELECT status, COUNT(*) n FROM books WHERE kind='catalog' GROUP BY status")
      .all();
    return text({ library_root: LIBRARY_ROOT, by_kind: byKind, catalog_by_status: byStatus });
  }
);

server.tool(
  "get_asset",
  "Fetch an asset's content by its index `path`. Markdown (articles, catalog book profiles) returns full text; EPUB/PDF return metadata plus their on-disk location (no text extraction yet).",
  { path: z.string() },
  async ({ path: assetPath }) => {
    const row = db
      .prepare(`SELECT ${ROW_FIELDS} FROM books WHERE path = ?`)
      .get(assetPath);
    if (!row) return text(`No asset indexed at: ${assetPath}`);
    if (assetPath.endsWith(".md")) {
      const content = fs.readFileSync(assetPath, "utf8");
      return text(content.length > 100_000 ? content.slice(0, 100_000) + "\n…[truncated]" : content);
    }
    return text({ ...row, note: "binary book file — use highlights or the reading app for content" });
  }
);

server.tool(
  "search_content",
  "Deep full-text search INSIDE books and articles (extracted text, chunk-level). Returns snippets with the source asset. Requires the content index (index_content CLI).",
  { query: z.string(), limit: z.number().int().min(1).max(50).default(10) },
  async ({ query, limit }) => {
    const rows = db
      .prepare(
        `SELECT c.book_path, c.seq,
                snippet(chunks_fts, 0, '»', '«', ' … ', 32) AS snippet,
                b.title, b.author
         FROM chunks_fts f
         JOIN chunks c ON c.id = f.rowid
         LEFT JOIN books b ON b.path = c.book_path
         WHERE chunks_fts MATCH ?
         ORDER BY rank LIMIT ?`
      )
      .all(ftsQuery(query), limit);
    return text(rows);
  }
);

server.tool(
  "read_passage",
  "Read the extracted text around one search hit: the chunk at `seq` for `book_path`, with `context` chunks either side.",
  {
    book_path: z.string(),
    seq: z.number().int().min(0),
    context: z.number().int().min(0).max(5).default(1),
  },
  async ({ book_path, seq, context }) => {
    const rows = db
      .prepare(
        `SELECT seq, text FROM chunks
         WHERE book_path = ? AND seq BETWEEN ? AND ?
         ORDER BY seq`
      )
      .all(book_path, seq - context, seq + context);
    if (rows.length === 0) return text(`No indexed content at ${book_path}#${seq}`);
    return text(rows.map((r) => r.text).join("\n\n"));
  }
);

server.tool(
  "get_highlights",
  "All live highlights for one book/article (by the file's absolute path — for catalog entries use their file_link).",
  { path: z.string() },
  async ({ path: bookPath }) => text(liveHighlights(bookPath))
);

server.tool(
  "search_highlights",
  "Search across every highlight in the library (case-insensitive substring).",
  { query: z.string(), limit: z.number().int().min(1).max(200).default(50) },
  async ({ query, limit }) => {
    const stateDir = path.join(LIBRARY_ROOT, ".properbooky", "state");
    const needle = query.toLowerCase();
    const hits = [];
    for (const file of fs.existsSync(stateDir) ? fs.readdirSync(stateDir) : []) {
      if (!file.endsWith(".json")) continue;
      try {
        const sidecar = JSON.parse(fs.readFileSync(path.join(stateDir, file), "utf8"));
        for (const h of sidecar.highlights ?? []) {
          if (h.deleted) continue;
          if (
            h.text.toLowerCase().includes(needle) ||
            (h.note ?? "").toLowerCase().includes(needle)
          ) {
            hits.push({
              book: file.replace(/\.json$/, "").replaceAll("__", "/"),
              text: h.text,
              note: h.note ?? null,
              anchor: h.anchor,
            });
            if (hits.length >= limit) return text(hits);
          }
        }
      } catch {
        /* unreadable sidecar — skip */
      }
    }
    return text(hits);
  }
);

await server.connect(new StdioServerTransport());
