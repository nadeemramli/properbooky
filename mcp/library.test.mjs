import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

for (const version of [8, 9, 10]) {
  const modern = version >= 9;
  test(`MCP metadata and highlights with schema ${version}`, async () => {
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
    if (version === 10) {
      db.exec("ALTER TABLE books ADD COLUMN merged_into TEXT");
      const otherAsset = path.join(root, "edition.epub");
      writeFileSync(otherAsset, "epub fixture");
      db.prepare(
        "INSERT INTO books VALUES (3,'Alias Edition','Test Author','Philosophy','catalog','finished',5,2017,?,?,'md','other-profile','other-asset','finished',1,0,'book','profile-id')",
      ).run(path.join(root, "other.md"), otherAsset);
      db.exec("INSERT INTO books_fts(rowid,title) VALUES (3,'Alias Edition')");
    }
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
      if (version === 10) {
        const stats = await call("library_stats", {});
        assert.equal(stats.visible_profiles, 1);
        assert.equal(stats.by_availability.local, 1);
        const aliases = await call("search_library", { query: "Alias" });
        assert.equal(aliases.length, 1);
        assert.equal(aliases[0].title, "Corrected Title");
        assert.equal(aliases[0].source_profiles.length, 2);
        assert.equal(aliases[0].assets.length, 2);
        assert.deepEqual(aliases[0].assets.map((a) => a.format).sort(), [
          "epub",
          "pdf",
        ]);
        writeFileSync(
          path.join(root, ".properbooky/curation.json"),
          JSON.stringify({
            version: 3,
            organisation: {
              authors: { "test author": "Preferred Author" },
              topics: { psychology: "Mind" },
              roadmaps: [
                {
                  id: "r1",
                  title: "Psychology",
                  steps: [
                    { profile_id: "other-profile", note: "Context" },
                    { profile_id: "profile-id", note: "Foundations" },
                  ],
                },
              ],
            },
          }),
        );
        const canonical = await call("search_library", {
          query: "Preferred Author",
        });
        assert.equal(canonical.length, 1);
        assert.equal(canonical[0].author, "Preferred Author");
        assert.equal(canonical[0].category, "Mind");
        const roadmaps = await call("reading_roadmaps", {});
        assert.equal(roadmaps[0].steps.length, 1);
        assert.deepEqual(roadmaps[0].steps[0].notes, [
          "Context",
          "Foundations",
        ]);
        assert.equal(roadmaps[0].next_profile_id, "profile-id");
      }
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
