# CLAUDE.md - Home Brain MCP Server

## Project Overview

This project creates a remote MCP (Model Context Protocol) server that exposes my private `home-brain` GitHub repository to Claude via semantic search. The goal is to make my personal knowledge base accessible from Claude mobile, web, and desktop apps.

## Architecture

```
home-brain repo → GitHub Action → R2 bucket → AI Search (embeddings) → MCP Server (Worker) → Claude
```

### Components

1. **R2 Bucket** (`home-brain-store`) - Stores synced files from the home-brain repo
2. **AI Search** (`home-brain-search`) - Cloudflare's managed RAG service that indexes R2 content
3. **MCP Server** (`home-brain-mcp`) - Cloudflare Worker exposing search as MCP tools
4. **GitHub Action** - In the home-brain repo, syncs content to R2 on push

## Tech Stack

- **Runtime**: Cloudflare Workers
- **Storage**: Cloudflare R2
- **Search/RAG**: Cloudflare AI Search (AutoRAG)
- **Auth**: OAuth 2.0 (for Claude.ai connector)
- **Language**: TypeScript

## Project Structure

```
home-brain-mcp/
├── CLAUDE.md                 # This file - project instructions
├── README.md                 # Public documentation
├── wrangler.toml             # Cloudflare Worker configuration
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # Main Worker entry point
│   ├── mcp/
│   │   ├── server.ts         # MCP protocol handler
│   │   ├── tools.ts          # MCP tool definitions
│   │   └── auth.ts           # OAuth handling
│   └── search/
│       └── client.ts         # AI Search client wrapper
├── scripts/
│   └── setup-cloudflare.ts   # One-time setup script
└── .github/
    └── workflows/
        └── sync-to-r2.yml    # GitHub Action for home-brain repo
```

## MCP Tools to Implement

The MCP server should expose these tools:

### `search_brain`
Semantic search across all content in the knowledge base.

```typescript
{
  name: "search_brain",
  description: "Search the knowledge base using natural language. Returns relevant passages from notes, documents, and files.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Natural language search query"
      },
      limit: {
        type: "number",
        description: "Maximum number of results (default: 5, max: 20)"
      }
    },
    required: ["query"]
  }
}
```

### `get_document`
Retrieve a specific document by path.

```typescript
{
  name: "get_document",
  description: "Get the full content of a specific document by its path.",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the document (e.g., 'projects/cnc/notes.md')"
      }
    },
    required: ["path"]
  }
}
```

### `list_recent`
List recently modified files.

```typescript
{
  name: "list_recent",
  description: "List recently modified files in the knowledge base.",
  inputSchema: {
    type: "object",
    properties: {
      limit: {
        type: "number",
        description: "Number of files to return (default: 10)"
      },
      path_prefix: {
        type: "string",
        description: "Optional path prefix to filter results"
      }
    }
  }
}
```

### `list_folders`
Browse the knowledge base structure.

```typescript
{
  name: "list_folders",
  description: "List folders and files at a given path in the knowledge base.",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to list (empty or '/' for root)"
      }
    }
  }
}
```

## Development Commands

```bash
# Install dependencies
npm install

# Run locally
npm run dev

# Deploy to Cloudflare
npm run deploy

# Run tests
npm test

# Type check
npm run typecheck
```

## Environment Variables / Secrets

These need to be configured in Cloudflare:

- `AUTORAG_NAME` - Name of the AI Search instance (e.g., "home-brain-search")
- For OAuth (added later):
  - `OAUTH_CLIENT_ID`
  - `OAUTH_CLIENT_SECRET`

## Wrangler Bindings

```toml
[vars]
AUTORAG_NAME = "home-brain-search"

[[r2_buckets]]
binding = "R2"
bucket_name = "home-brain-store"

[ai]
binding = "AI"
```

## Auth Strategy

### Phase 1: Authless (for testing)
Start without auth to verify the MCP server works. Only use from trusted networks.

### Phase 2: OAuth (for production)
Add OAuth using Cloudflare's `workers-oauth-provider` package. This allows secure access from Claude.ai as a custom connector.

## Claude.ai Connector Setup

Once deployed with OAuth, add to Claude:

1. Go to Claude.ai → Settings → Connectors
2. Click "Add custom connector"
3. Enter the Worker URL: `https://home-brain-mcp.YOUR_SUBDOMAIN.workers.dev/sse`
4. Authenticate when prompted

## Important Notes

### On AI Search Limitations
- Deleted files aren't removed from the index yet (Cloudflare is working on this)
- Re-indexing has a 5-minute cooldown between manual triggers
- New files take up to 4 hours to appear unless manually triggered

### On MCP Protocol
- Use SSE (Server-Sent Events) transport for Claude.ai compatibility
- The server must respond to `/sse` endpoint
- Tool results should be concise - Claude has context limits

### On Security
- Never commit secrets to the repo
- Use Cloudflare's secret management: `wrangler secret put SECRET_NAME`
- The R2 bucket should not be publicly accessible

## Testing Checklist

- [ ] MCP server starts locally without errors
- [ ] `/sse` endpoint accepts connections
- [ ] `search_brain` tool returns results from AI Search
- [ ] `get_document` retrieves files from R2
- [ ] OAuth flow works end-to-end
- [ ] Claude.ai can connect as custom connector
- [ ] Claude mobile can use the connected tools

## References

- [Cloudflare MCP Server Guide](https://developers.cloudflare.com/agents/guides/remote-mcp-server/)
- [AI Search Docs](https://developers.cloudflare.com/ai-search/)
- [MCP Specification](https://modelcontextprotocol.io/)
- [workers-oauth-provider](https://github.com/cloudflare/workers-oauth-provider)
