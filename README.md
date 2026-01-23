# Git Brain

A remote MCP server that exposes private GitHub repositories as a searchable knowledge base for Claude.

## Quick Start

### Connect to Claude.ai
1. Settings → Connectors → Add custom connector
2. URL: `https://home-brain-mcp.dudgeon.workers.dev/mcp`

### Connect Claude Code / Desktop
Add to your MCP config:
```json
{
  "mcpServers": {
    "home-brain": {
      "url": "https://home-brain-mcp.dudgeon.workers.dev/mcp"
    }
  }
}
```

## Available Tools

| Tool | Description |
|------|-------------|
| `search_brain` | Semantic search with dynamic metadata (domains, topics) |
| `get_document` | Retrieve a file by path |
| `list_recent` | Browse recently modified files |
| `list_folders` | Navigate folder structure |
| `about` | Server information |

### Search Features

- **Dynamic tool description** - Automatically includes knowledge domains and sample topics from your content
- **Source links** - Search results include clickable GitHub links to view/edit files
- **Scope guidance** - Tool description helps Claude understand when to use (and not use) the search

## Architecture

```
GitHub Repo → GitHub Action → R2 Bucket → AI Search → MCP Server → Claude
     │                              │
     └── generate-summary.yml ──────┘ (weekly metadata refresh)
```

- **Cloudflare Workers** with Durable Objects for session state
- **Cloudflare R2** for file storage
- **Cloudflare AI Search** for semantic search
- **Cloudflare Agents SDK** for MCP protocol

## HTTP Endpoints

| Endpoint | Description |
|----------|-------------|
| `/mcp` | MCP protocol (SSE transport) |
| `/doc/{path}` | Direct document access from R2 |

## Development

```bash
npm install          # Install dependencies
npm run dev          # Local development
npm run deploy       # Deploy to Cloudflare
node test-mcp.mjs    # Test MCP connection
node test-tools.mjs  # Test all tools
```

## Documentation

- [CLAUDE.md](./CLAUDE.md) - Implementation details and development guide
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) - Common issues and solutions

## License

ISC
