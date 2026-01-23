# CLAUDE.md - Git Brain MCP Server

## Project Overview

Git Brain is a remote MCP (Model Context Protocol) server that exposes private GitHub repositories as a searchable knowledge base accessible from Claude mobile, web, and desktop apps.

**Live Deployment**: `https://home-brain-mcp.dudgeon.workers.dev/mcp`

## Architecture

```
GitHub Repo → GitHub Action → R2 Bucket → AI Search (embeddings) → MCP Server (Worker) → Claude
                                 ↓
                          Cloudflare Durable Objects (session state)
```

### Components

| Component | Name | Purpose |
|-----------|------|---------|
| Source Repo | `dudgeon/home-brain` | Private knowledge base (markdown files) |
| GitHub Action | `sync-to-r2.yml` | Auto-syncs markdown files to R2 on push |
| R2 Bucket | `home-brain-store` | Stores synced files from the source repo |
| AI Search | `home-brain-search` | Cloudflare's managed RAG service for semantic search |
| MCP Server | `home-brain-mcp` | Cloudflare Worker exposing tools via MCP protocol |
| Durable Objects | `HomeBrainMCP` | Maintains MCP session state across requests |

## Tech Stack

- **Runtime**: Cloudflare Workers with Durable Objects
- **MCP Framework**: Cloudflare Agents SDK (`agents` package)
- **Storage**: Cloudflare R2
- **Search/RAG**: Cloudflare AI Search (AutoRAG)
- **Language**: TypeScript
- **Validation**: Zod

## Project Structure

```
git-brain/
├── CLAUDE.md              # This file - project instructions for Claude
├── README.md              # Public documentation
├── SETUP_LOG.md           # Development history and decisions
├── TROUBLESHOOTING.md     # Common issues and solutions
├── wrangler.toml          # Cloudflare Worker configuration
├── package.json
├── tsconfig.json
├── test-mcp.mjs           # MCP connection test script
└── src/
    └── index.ts           # Single-file MCP server implementation
```

## Implementation Details

### MCP Server (`src/index.ts`)

The server is implemented as a single file using Cloudflare's Agents SDK:

```typescript
export class HomeBrainMCP extends McpAgent<Env> {
  server = new McpServer({ name: "home-brain", version: "1.0.0" });
  async init() { /* register tools */ }
}
export default HomeBrainMCP.serveSSE("/mcp");
```

### Registered MCP Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `about` | Get information about Git Brain | none |
| `search_brain` | Semantic search via AI Search | `query`, `limit?` |
| `get_document` | Retrieve document from R2 by path | `path` |
| `list_recent` | List recently modified files | `limit?`, `path_prefix?` |
| `list_folders` | Browse folder structure | `path?` |

### Wrangler Bindings

```toml
# Durable Objects for MCP session state
[[durable_objects.bindings]]
name = "MCP_OBJECT"
class_name = "HomeBrainMCP"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["HomeBrainMCP"]  # Required for free tier

# R2 Storage
[[r2_buckets]]
binding = "R2"
bucket_name = "home-brain-store"

# AI binding for Workers AI / AutoRAG
[ai]
binding = "AI"

[vars]
AUTORAG_NAME = "home-brain-search"
```

## Development Commands

```bash
# Install dependencies
npm install

# Run locally (note: AI Search won't work locally)
npm run dev

# Type check
npm run typecheck

# Deploy to Cloudflare
npm run deploy

# Test MCP connection (REQUIRED after changes)
node test-mcp.mjs
```

## Testing Requirements

**CRITICAL**: After making any changes to the MCP server, Claude MUST:

1. Run `npm run typecheck` to verify TypeScript compiles
2. Run `npm run deploy` to deploy changes
3. Run `node test-mcp.mjs` to verify the MCP server responds correctly

**Do NOT rely on the user to test MCP functionality.** Always verify the deployment works before reporting success.

### Test Script Output

A successful test looks like:
```
Connecting to: https://home-brain-mcp.dudgeon.workers.dev/mcp
Connected!

=== Available Tools ===
{
  "tools": [
    { "name": "about", ... },
    { "name": "search_brain", ... },
    { "name": "get_document", ... },
    { "name": "list_recent", ... },
    { "name": "list_folders", ... }
  ]
}
```

## Development History & Decisions

### Key Implementation Decisions

1. **Single-file architecture**: All MCP logic in `src/index.ts` rather than multiple files. Simpler for a focused project.

2. **Cloudflare Agents SDK**: Using `agents` package instead of raw MCP SDK. Provides `McpAgent` class that handles Durable Objects integration automatically.

3. **SSE Transport**: Using `serveSSE()` for Server-Sent Events transport at `/mcp` endpoint. This is what Claude Desktop/Code expects.

4. **Zod for validation**: Tool parameters defined with Zod schemas for runtime validation.

### Defects Overcome

1. **MCP SDK version mismatch**: The `agents` package bundles its own `@modelcontextprotocol/sdk@1.25.2`. Using a different version causes type conflicts. Solution: Use the bundled version.

2. **Durable Objects free tier**: Free tier requires `new_sqlite_classes` in migrations, not `new_classes`. Using `new_classes` causes deployment failure.

3. **nodejs_compat flag**: The agents SDK requires Node.js compatibility mode. Added `compatibility_flags = ["nodejs_compat"]` to wrangler.toml.

4. **AutoRAG response structure**: AI Search returns `response.data[]` with content arrays, not flat text. Had to map content correctly.

5. **Tool registration API**: Used the `server.tool()` method with Zod schemas inline rather than the deprecated schema-based registration.

6. **AI Search instance name vs Vectorize index name**: When AI Search creates a Vectorize index, it prefixes the name with `ai-search-`. The `AUTORAG_NAME` must use the AI Search instance name (`home-brain-search`), not the Vectorize index name (`ai-search-home-brain-search`).

## Connecting to Claude

### Claude.ai (Web)
1. Settings → Connectors → Add custom connector
2. URL: `https://home-brain-mcp.dudgeon.workers.dev/mcp`

### Claude Code / Desktop
Add to MCP server config:
```json
{
  "mcpServers": {
    "home-brain": {
      "url": "https://home-brain-mcp.dudgeon.workers.dev/mcp"
    }
  }
}
```

## Content Sync (Implemented)

The `home-brain` repo has a GitHub Action (`.github/workflows/sync-to-r2.yml`) that:
- Triggers on push when `.md` files change
- Syncs markdown files to R2 bucket `home-brain-store`
- Can be manually triggered from GitHub Actions UI

**Required secrets in home-brain repo:**
- `R2_ACCESS_KEY_ID` - Cloudflare R2 access key
- `R2_SECRET_ACCESS_KEY` - Cloudflare R2 secret key
- `R2_ENDPOINT` - `https://0e0a12f91d808a8536743acc49a267cf.r2.cloudflarestorage.com`

**Expanding to all files:** Change `--include "*.md"` to exclusion-based filtering in the workflow.

## Current Status

**All 5 tools working:**
- ✅ MCP Server deployed at `https://home-brain-mcp.dudgeon.workers.dev/mcp`
- ✅ R2 bucket `home-brain-store` with markdown files
- ✅ All tools working: `about`, `search_brain`, `get_document`, `list_recent`, `list_folders`
- ✅ GitHub Action auto-syncs on push
- ✅ AI Search semantic search functional (303 vectors indexed)

**Optional future work:**
- OAuth authentication for production use
- Expand sync to include all file types (not just markdown)

## References

- [Cloudflare Agents SDK](https://developers.cloudflare.com/agents/)
- [AI Search Docs](https://developers.cloudflare.com/ai-search/)
- [MCP Specification](https://modelcontextprotocol.io/)
- [R2 Documentation](https://developers.cloudflare.com/r2/)
