# Home Brain MCP Server

A remote MCP (Model Context Protocol) server that exposes a personal knowledge base stored in a GitHub repository to Claude AI via semantic search.

## Overview

This project bridges your private GitHub repository with Claude (mobile, web, and desktop) using Cloudflare's infrastructure:

- **Cloudflare R2** for storage
- **Cloudflare AI Search** for semantic search and RAG
- **Cloudflare Workers** for the MCP server runtime

## Features

- **Semantic Search** - Natural language queries across your entire knowledge base
- **Document Retrieval** - Get full content of specific documents
- **Recent Files** - List recently modified files
- **Folder Browsing** - Navigate your knowledge base structure
- **OAuth Authentication** - Secure access from Claude.ai

## Quick Start

### Prerequisites

- Node.js 18+
- Cloudflare account
- Wrangler CLI

### Installation

```bash
npm install
```

### Local Development

```bash
npm run dev
```

This starts a local dev server at `http://localhost:8787`

### Deployment

```bash
npm run deploy
```

## Architecture

```
GitHub Repo → GitHub Action → R2 Bucket → AI Search → MCP Server → Claude
```

## MCP Tools

The server exposes these tools to Claude:

- `search_brain` - Semantic search across all content
- `get_document` - Retrieve a specific document by path
- `list_recent` - List recently modified files
- `list_folders` - Browse the knowledge base structure

## Configuration

See [CLAUDE.md](./CLAUDE.md) for detailed setup instructions, including:

- Cloudflare infrastructure setup (R2, AI Search)
- GitHub Actions for syncing
- OAuth configuration
- Wrangler bindings

## License

ISC

## References

- [MCP Specification](https://modelcontextprotocol.io/)
- [Cloudflare Workers](https://workers.cloudflare.com/)
- [Cloudflare AI Search](https://developers.cloudflare.com/ai-search/)
