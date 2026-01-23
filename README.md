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
| `search_brain` | Semantic search across all content |
| `get_document` | Retrieve a file by path |
| `list_recent` | Browse recently modified files |
| `list_folders` | Navigate folder structure |
| `about` | Server information |

## Architecture

```
GitHub Repo → GitHub Action → R2 Bucket → AI Search → MCP Server → Claude
```

- **Cloudflare Workers** with Durable Objects for session state
- **Cloudflare R2** for file storage
- **Cloudflare AI Search** for semantic search (303 vectors indexed)
- **Cloudflare Agents SDK** for MCP protocol

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
