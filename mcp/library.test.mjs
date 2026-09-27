import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

for (const modern of [false, true]) {
  test(`MCP metadata and highlights with ${modern ? "stable identities" : "legacy paths"}`, async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "properbooky-mcp-"));
    const dbPath = path.join(root, "library.db");
    const assetPath = path.join(root, "reading.pdf");
    const profilePath = path.join(root, "profile.md");
    writeFileSync(assetPath, "%PDF-test");
    const db = new Database(dbPath);
    db.exec(`CREATE TABLE settings(key TEXT, value TEXT);
      CREATE TABLE books(id INTEGER PRIMARY KEY, title TEXT, author TEXT, category TEXT, kind TEXT, status TEXT, rating INTEGER, year INTEGER, path TEXT, file_link TEXT, format TEXT${modern ? ", stable_id TEXT, asset_id TEXT, reading_status TEXT, want_to_read INTEGER, up_next INTEGER, content_type TEXT" : ""});
      CREATE VIRTUAL TABLE books_fts USING fts5(title, author, filename, category);`);
    db.prepare("INSERT INTO settings VALUES ('library_path',?)").run(root);
    const fields = modern
      ? ", 'profile-id','asset-id','reading',1,1,'book'"
      : "";
    db.prepare(
      `INSERT INTO books VALUES (1,'Corrected Title','Test Author','Psychology','catalog','reading',NULL,NULL,?,?,'md'${fields})`,
    ).run(profilePath, assetPath);
    const rawFields = modern
      ? ", 'asset-id','asset-id','unread',0,0,'unidentified'"
      : "";
    db.prepare(
      `INSERT INTO books VALUES (2,'Corrected file',NULL,NULL,'file',NULL,NULL,NULL,?,NULL,'pdf'${rawFields})`,
    ).run(assetPath);
    db.exec(
      "INSERT INTO books_fts(rowid,title) VALUES (1,'Corrected Title'),(2,'Corrected file')",
    );
    db.close();
    const stateName = modern ? "asset-test-id.json" : "reading.pdf.json";
    mkdirSync(path.join(root, ".properbooky/state"), { recursive: true });
    if (modern)
      writeFileSync(
        path.join(root, ".properbooky/identities.json"),
        JSON.stringify({
          version: 1,
          records: [
            { id: "asset-id", path: "reading.pdf", state_file: stateName },
          ],
        }),
      );
    writeFileSync(
      path.join(root, ".properbooky/state", stateName),
      JSON.stringify({
        highlights: [
          {
            id: "h1",
            text: "Retained highlight",
            anchor: { page: 4 },
            deleted: false,
          },
          { id: "h2", text: "Deleted highlight", deleted: true },
        ],
      }),
    );
    const client = new Client({
      name: "library-regression-test",
      version: "1",
    });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve("server.mjs")],
      env: {
        ...process.env,
        PROPERBOOKY_DB: dbPath,
        PROPERBOOKY_LIBRARY: root,
      },
    });
    try {
      await client.connect(transport);
      const call = async (name, args) => {
        const result = await client.callTool({ name, arguments: args });
        assert.ok(!result.isError, JSON.stringify(result));
        return JSON.parse(result.content[0].text);
      };
      const rows = await call("search_library", { query: "Corrected" });
      assert.equal(rows.length, 1);
      assert.equal(rows[0].format, "pdf");
      assert.equal(rows[0].availability, "local");
      if (modern) assert.equal(rows[0].reading_status, "reading");
      const highlights = await call("get_highlights", { path: assetPath });
      assert.equal(highlights.length, 1);
      const hits = await call("search_highlights", { query: "Retained" });
      assert.equal(hits.length, 1);
      assert.equal(hits[0].book, "reading.pdf");
    } finally {
      await client.close();
    }
  });
}
