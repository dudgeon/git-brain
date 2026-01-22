# Home-Brain MCP Server: Setup Guide

> A step-by-step guide to building a remote MCP server that makes your private GitHub knowledge base accessible from Claude mobile, web, and desktop.

## Architecture Overview

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  home-brain     │     │   Cloudflare    │     │   Cloudflare    │
│  GitHub Repo    │────▶│   R2 Bucket     │────▶│   AI Search     │
│  (your notes)   │     │   (file store)  │     │   (embeddings)  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                                               │
        │ GitHub Action                                 │
        │ (sync on push)                                │
        │                                               ▼
        │                                       ┌─────────────────┐
        │                                       │   MCP Server    │
        │                                       │   (CF Worker)   │
        │                                       └─────────────────┘
        │                                               │
        │                                               │
        ▼                                               ▼
┌─────────────────┐                             ┌─────────────────┐
│  Claude Code    │                             │  Claude Mobile  │
│  (editing)      │                             │  Claude Web     │
└─────────────────┘                             │  Claude Desktop │
                                                └─────────────────┘
```

## Prerequisites

Before starting, ensure you have:

- [ ] A Cloudflare account (free tier works to start)
- [ ] A GitHub account
- [ ] Claude Code installed and working
- [ ] Node.js 18+ installed locally (for Claude Code's tooling)

## Phase 0: Equip Claude Code with Skills

### 0.1 Install the Cloudflare MCP Server

Claude Code can use Cloudflare's official MCP server to manage your Cloudflare resources directly.

```bash
# In your terminal, configure Claude Code's MCP servers
claude mcp add cloudflare-mcp -- npx -y @anthropic-ai/mcp-server-cloudflare
```

Or add it to your Claude Code config file (`~/.claude/claude_desktop_config.json` or similar):

```json
{
  "mcpServers": {
    "cloudflare": {
      "command": "npx",
      "args": ["-y", "@cloudflare/mcp-server-cloudflare"]
    }
  }
}
```

### 0.2 Install GitHub MCP Server (Optional but helpful)

```bash
claude mcp add github -- npx -y @modelcontextprotocol/server-github
```

You'll need to set `GITHUB_PERSONAL_ACCESS_TOKEN` environment variable.

### 0.3 Verify MCP Servers

Restart Claude Code and verify the servers are connected:

```bash
claude
# Then type: /mcp
# You should see cloudflare and github listed
```

## Phase 1: Create the Project Repository

### 1.1 Create a new repo

Create a new **private** GitHub repository called `home-brain-mcp` (or similar).

### 1.2 Clone and initialize

```bash
git clone git@github.com:YOUR_USERNAME/home-brain-mcp.git
cd home-brain-mcp
```

### 1.3 Create the CLAUDE.md file

Copy the contents of `CLAUDE.md` from this guide into your repo root. This file instructs Claude Code on how to build and maintain your project.

### 1.4 Start Claude Code

```bash
claude
```

Claude Code will read CLAUDE.md and understand the project context.

## Phase 2: Build with Claude Code

From here, you'll work primarily through Claude Code prompts. See the `PROMPTS.md` file for the exact prompts to use at each step.

### Build Sequence

1. **Cloudflare Setup** - Create R2 bucket and AI Search instance
2. **MCP Server** - Build the Cloudflare Worker that serves as your MCP server
3. **GitHub Action** - Set up automatic sync from home-brain repo to R2
4. **Testing** - Verify everything works end-to-end
5. **Connect to Claude** - Add as custom connector in Claude.ai

## Phase 3: Connect Your Existing home-brain

Once the infrastructure is built, you'll configure your existing `home-brain` repo to sync to R2.

## Maintenance

After initial setup, the system is largely self-maintaining:

- Push to home-brain → GitHub Action syncs to R2 → AI Search re-indexes
- Query via Claude mobile/web → MCP server → AI Search → results

## Troubleshooting

Common issues and solutions are documented in `TROUBLESHOOTING.md`.

## Cost Estimate

| Service | Free Tier | Paid (if exceeded) |
|---------|-----------|-------------------|
| R2 Storage | 10GB | $0.015/GB/month |
| R2 Operations | 1M reads, 1M writes | $0.36/1M reads |
| AI Search | Beta (free) | TBD |
| Workers | 100K requests/day | $0.50/1M requests |
| Workers AI | 10K neurons/day | $0.011/1K neurons |

For a personal knowledge base, you'll likely stay well within free tiers.
