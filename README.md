<p align="center">
  <img src="site/brainstem_logo.png" alt="Brainstem Logo" width="150">
</p>

<h1 align="center">Brainstem</h1>

<p align="center"><strong>Give your AI a second brain.</strong></p>

---

You maintain a personal knowledge base — notes, docs, references — in a GitHub repo. Maybe you use Obsidian, Logseq, or just plain markdown. Maybe you use Claude Code, ClawdBot, Codex, or another agent to help maintain it.

**Brainstem** connects that repo to your AI chat clients so you can search and retrieve your own knowledge from anywhere — your phone, your desktop, or any MCP-compatible tool.

Here's how it works:

1. **You have a GitHub-hosted PKM** (personal knowledge management) repo, public or private
2. **You install the Brainstem GitHub App** on that repo
3. **Brainstem embeds your content** and keeps its index up-to-date with every push
4. **Brainstem exposes search & retrieval tools via MCP** that you connect to any compatible AI client (Claude Mobile, Claude Desktop, Claude Code, etc.)

That's it. Push to GitHub, and your AI can search it within a minute.

<p align="center">
  <img src="site/brainstem-diagram.png" alt="Brainstem Ecosystem Diagram" width="700">
</p>

## Quick Start

### 1. Connect Your Repository

1. Visit [brainstem.cc/setup](https://brainstem.cc/setup)
2. Click **Connect Repository** to install the GitHub App
3. Select your repository
4. Copy your unique MCP endpoint URL from the success page

### 2. Connect Your AI Client

#### Claude.ai (Web) — easiest

1. Go to **Settings → Connectors → Add custom connector**
2. Paste your MCP endpoint URL: `https://brainstem.cc/mcp/{your-uuid}`
3. Claude.ai handles authentication automatically via OAuth — no token needed

#### Claude Desktop / Claude Code

Add to your MCP config (Claude Desktop: `claude_desktop_config.json`, Claude Code: `.mcp.json` or via `claude mcp add`):

```json
{
  "mcpServers": {
    "my-brain": {
      "url": "https://brainstem.cc/mcp/{your-uuid}"
    }
  }
}
```

OAuth authentication is handled automatically — you'll be prompted to authorize with GitHub on first use. No manual token needed.

## MCP Tools

Brainstem exposes five tools over MCP:

| Tool | Description |
|------|-------------|
| `search_brain` | Semantic search across your knowledge base. Results include source links back to GitHub. The tool description dynamically reflects your actual content domains and topics. |
| `get_document` | Retrieve the full contents of a file by its path. |
| `list_recent` | List recently modified files, optionally filtered by path prefix. |
| `list_folders` | Browse the folder structure of your repo. |
| `brain_inbox` | Add a quick note to your inbox folder, committed directly to GitHub. |

## How Sync Works

```
GitHub Push → Webhook → Brainstem Worker → R2 Storage → AI Search (reindex)
```

- When you push to your connected repo, GitHub sends a webhook to Brainstem
- Brainstem fetches the changed files via the GitHub API and stores them in Cloudflare R2
- A reindex is triggered on Cloudflare AI Search
- New content is searchable within ~1 minute

Sync is incremental — only changed files are fetched on each push.

## Architecture

Built on Cloudflare's stack:

- **Cloudflare Workers** with Durable Objects for MCP session state
- **Cloudflare R2** for file storage
- **Cloudflare D1** (SQLite) for installation and user tracking
- **Cloudflare AI Search** for semantic search and retrieval
- **GitHub App** for authentication, webhooks, and repo access

## Documentation

- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) — Common issues and solutions
- [CLAUDE.md](./CLAUDE.md) — Implementation details and development guide

## License

ISC
