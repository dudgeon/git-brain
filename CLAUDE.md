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
├── TROUBLESHOOTING.md     # Common issues and solutions
├── wrangler.toml          # Cloudflare Worker configuration
├── package.json
├── tsconfig.json
├── test-mcp.mjs           # MCP connection test script
├── test-tools.mjs         # Full tools test script
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

### HTTP Endpoints

| Endpoint | Description |
|----------|-------------|
| `/mcp` | MCP protocol (SSE transport) |
| `/doc/{path}` | Direct document access - returns raw file content from R2 |

### Source Links

Search results include clickable GitHub links (not R2/worker links) so users can:
- View files in the GitHub UI with proper rendering
- See file history and blame
- Edit files directly in GitHub
- Navigate the repo structure

Example: `https://github.com/dudgeon/home-brain/blob/main/domains/family/owen/swim/README.md`

### search_brain Tool Description

The `search_brain` tool has a carefully crafted description that:

1. **Hard-coded base**: Explains this is a personal knowledge base, NOT general knowledge
2. **Dynamic enrichment**: If `_brain_summary.json` exists in R2, domains/topics are added to the description
3. **Scope boundaries**: Explicitly states what to use it for and what NOT to use it for
4. **Non-exhaustive framing**: Dynamic topics are presented as "includes but not limited to" to prevent Claude from skipping searches when topics aren't in the summary

The description guides Claude to:
- Use search_brain for personal notes, project docs, family info
- NOT use it for general knowledge, current events
- Try a search if unsure whether content is in the knowledge base

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

## Brain Summary (Dynamic Tool Metadata)

The MCP server can load a `_brain_summary.json` file from R2 to enrich the `search_brain` tool description with actual content topics. This helps Claude understand when to use the tool.

### Summary File Format

```json
{
  "domains": ["family", "projects", "resources", "tools"],
  "topics": ["kids Alina & Owen", "swim team", "schools", "home automation"],
  "recentFiles": ["domains/family/README.md", "tasks.md"],
  "lastUpdated": "2025-01-22T00:00:00Z"
}
```

### Generation Strategy

The summary should be regenerated **periodically** (not on every push) to avoid overhead:

1. **Scheduled Action** - Runs weekly (e.g., every Sunday at midnight)
2. **Manual trigger** - `workflow_dispatch` for on-demand regeneration
3. **NOT on every push** - Unlike file sync, summary generation is infrequent

### home-brain GitHub Action (`generate-summary.yml`)

**TO BE IMPLEMENTED** in the `home-brain` repo:

```yaml
name: Generate Brain Summary

on:
  schedule:
    - cron: '0 0 * * 0'  # Weekly on Sundays
  workflow_dispatch:      # Manual trigger

jobs:
  generate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Generate summary
        run: |
          # Extract domains from top-level folders
          DOMAINS=$(ls -d */ | grep -v '^\.' | sed 's/\///' | jq -R . | jq -s .)

          # Extract sample topics from folder names and file titles
          TOPICS=$(find . -name "README.md" -exec head -1 {} \; | grep "^#" | sed 's/^# //' | head -10 | jq -R . | jq -s .)

          # Recent files
          RECENT=$(ls -t **/*.md 2>/dev/null | head -5 | jq -R . | jq -s .)

          # Build JSON
          jq -n \
            --argjson domains "$DOMAINS" \
            --argjson topics "$TOPICS" \
            --argjson recent "$RECENT" \
            '{domains: $domains, topics: $topics, recentFiles: $recent, lastUpdated: now | todate}' \
            > _brain_summary.json

      - name: Upload to R2
        run: |
          aws s3 cp _brain_summary.json s3://home-brain-store/_brain_summary.json
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
          AWS_ENDPOINT_URL: ${{ secrets.R2_ENDPOINT }}
```

### Important: Non-Exhaustive Framing

The summary is explicitly framed as **non-exhaustive** in the tool description. This prevents Claude from thinking "topic X isn't in the summary, so I shouldn't search." The description says:

> "Knowledge domains include (but are not limited to): ..."
> "Note: This is a sample - the knowledge base may contain additional topics not listed here."

## Current Status

**v1.1 - Improved search_brain metadata:**
- ✅ MCP Server deployed at `https://home-brain-mcp.dudgeon.workers.dev/mcp`
- ✅ All 5 tools working: `about`, `search_brain`, `get_document`, `list_recent`, `list_folders`
- ✅ `/doc/*` endpoint for direct document access with source links
- ✅ Improved `search_brain` description with scope guidance
- ✅ Support for `_brain_summary.json` dynamic enrichment (optional)
- ✅ Search results include clickable source URLs
- ⏳ `generate-summary.yml` Action not yet implemented in home-brain repo

## Proposed Next Steps

### High Priority
1. **OAuth authentication** - Currently no auth; anyone with the URL can access. Add Cloudflare Access or OAuth to restrict to authorized users.

2. **Expand file sync beyond markdown** - Currently only `.md` files sync. Update GitHub Action to use exclusion-based filtering (exclude `.git`, `node_modules`, etc.) instead of `--include "*.md"`.

### Medium Priority
3. **Write tools** - Add `create_document` and `update_document` tools to allow Claude to write back to the knowledge base (would need to sync R2 → GitHub or use GitHub API directly).

4. **Better search relevance** - Tune AI Search settings (chunk size, overlap, reranking) or add metadata filtering to improve result quality.

5. **Observability** - Add structured logging and connect to Cloudflare Analytics or external monitoring to track usage patterns and errors.

### Low Priority / Nice to Have
6. **Multiple knowledge bases** - Support connecting multiple GitHub repos as separate "brains" with a brain selector tool.

7. **Caching layer** - Add KV caching for frequently accessed documents to reduce R2 reads.

8. **MCP Resources** - Expose documents as MCP resources (not just tools) for richer client integration.

9. **Version history** - Track document versions and allow retrieving previous versions.

## References

- [Cloudflare Agents SDK](https://developers.cloudflare.com/agents/)
- [AI Search Docs](https://developers.cloudflare.com/ai-search/)
- [MCP Specification](https://modelcontextprotocol.io/)
- [R2 Documentation](https://developers.cloudflare.com/r2/)
