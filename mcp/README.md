# ProperBooky Library MCP Server

Read-only MCP (stdio) server over the local library: search books/articles,
fetch markdown assets, and query highlights. Any MCP client (Claude Code,
Claude Desktop) can use the library as a knowledge source.

## Setup

```bash
cd mcp && npm install
node selftest.mjs   # boots the server, runs real queries
```

Claude Code picks it up automatically via the repo's `.mcp.json`. For other
clients, register: `command: node`, `args: [<repo>/mcp/server.mjs]`.

Configuration (optional env):

- `PROPERBOOKY_APP_DATA` — the app's data dir (default:
  `~/.local/share/com.nadeemramli.properbooky`). The server serves the library
  that is open in the app: its entry in `settings.json` and its own index under
  `libraries/<id>/library.db`. Installs from before multiple libraries
  (PBK-15) fall back to `library.db`.
- `PROPERBOOKY_DB` — SQLite index path (overrides the above)
- `PROPERBOOKY_LIBRARY` — library root (default: from the library list or the index settings)

## Tools

| Tool | Does |
|---|---|
| `search_library` | FTS over title/author/filename/topics (books + wishlist + articles) |
| `library_stats` | counts by kind and catalog status |
| `get_asset` | full markdown for articles/book profiles; metadata for EPUB/PDF |
| `get_highlights` | live highlights for one book (by file path) |
| `search_highlights` | substring search across every highlight + note |

The index is rebuildable and read-only here; files stay the source of truth.
Semantic search arrives with the knowledge layer (PBK-12).
