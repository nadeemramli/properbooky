// Self-test: boot the server over stdio, list tools, run real queries.
// Usage: node mcp/selftest.mjs
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const here = path.dirname(fileURLToPath(import.meta.url));
const transport = new StdioClientTransport({
  command: "node",
  args: [path.join(here, "server.mjs")],
});
const client = new Client({ name: "selftest", version: "0.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
const names = tools.map((t) => t.name).sort();
console.log("tools:", names.join(", "));
assert.ok(names.includes("search_library"));
assert.ok(names.includes("search_highlights"));

const stats = await client.callTool({ name: "library_stats", arguments: {} });
console.log("stats:", stats.content[0].text.slice(0, 200).replaceAll("\n", " "));

const search = await client.callTool({
  name: "search_library",
  arguments: { query: "venture capital", limit: 3 },
});
const rows = JSON.parse(search.content[0].text);
console.log(`search "venture capital": ${rows.length} rows, first: ${rows[0]?.title ?? "—"}`);
assert.ok(rows.length > 0, "expected search hits");

const highlights = await client.callTool({
  name: "search_highlights",
  arguments: { query: "grandparent" },
});
console.log("highlight search:", search && JSON.parse(highlights.content[0].text).length, "hits");

await client.close();
console.log("MCP SELFTEST: PASS");
