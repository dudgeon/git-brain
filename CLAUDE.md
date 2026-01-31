# CLAUDE.md - Git Brain MCP Server

## Project Overview

Git Brain is a remote MCP (Model Context Protocol) server that exposes private GitHub repositories as a searchable knowledge base accessible from Claude mobile, web, and desktop apps.

**Live Deployment**: `https://brainstem.cc/mcp/{uuid}`

**Domain**: `brainstem.cc` (requires OAuth authentication)

## Working Guidelines

**Ask for help early:** If you fail at a task after 2-3 attempts, or lack the tools/permissions to complete it, ASK THE USER FOR HELP immediately. Do not:
- Keep trying variations of the same failing approach
- Propose workarounds that compromise functional requirements
- Spin on authentication/permission issues

Instead, clearly state what you're blocked on and what you need from the user.

**Be proactive with read-only research:** When investigating issues or verifying changes, always proactively check the live state of things (R2 contents, GitHub repo, worker logs, debug endpoints) rather than waiting for the user to ask. Read-only operations are safe and give you the information needed to diagnose problems or confirm success.

**Use your own tooling — don't delegate diagnostics to the user:** You have the GitHub App private key (`github-app.pem`, App ID `2716073`) and can authenticate as the GitHub App to query webhook deliveries, installation details, and other App-level APIs. Use manual JWT generation (Node.js `crypto` module) rather than `@octokit/auth-app` for CLI scripts — it's more reliable. When something isn't working, pull the logs yourself rather than asking the user to check GitHub UI.

**Node.js version:** Wrangler requires Node.js v20+. Always run `source ~/.nvm/nvm.sh && nvm use 20` before `npm run deploy` or `npm run typecheck` commands.

## Architecture

```
GitHub Push → Webhook → Worker → R2 Bucket → AI Search (reindex) → MCP Server → Claude
                          ↓
                   Durable Objects (session state)
                          ↓
                   D1 Database (installations, logs)
```

**Key flow:**
1. User pushes to GitHub repo
2. GitHub sends webhook to `/webhook/github`
3. Worker fetches changed files via GitHub API (using GitHub App credentials)
4. Files sync to R2 bucket
5. Worker triggers AI Search reindex via Cloudflare API
6. New content is searchable within ~1 minute

### Components

| Component | Name | Purpose |
|-----------|------|---------|
| GitHub App | `git-brain-stem` | Authenticates with GitHub, receives webhooks |
| R2 Bucket | `home-brain-store` | Stores synced files from connected repos |
| AI Search | `home-brain-search` | Cloudflare's managed RAG service for semantic search |
| D1 Database | `brain-stem-db` | Stores installations and webhook logs |
| MCP Server | `home-brain-mcp` | Cloudflare Worker exposing tools via MCP protocol |
| Durable Objects | `HomeBrainMCP` | Maintains MCP session state across requests |

## Tech Stack

- **Runtime**: Cloudflare Workers with Durable Objects
- **MCP Framework**: Cloudflare Agents SDK (`agents` package)
- **Storage**: Cloudflare R2
- **Database**: Cloudflare D1 (SQLite)
- **Search/RAG**: Cloudflare AI Search
- **Auth**: GitHub App + GitHub OAuth 2.0
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
├── test-user-mcp.mjs      # Per-user MCP endpoint test
├── docs/
│   ├── BACKLOG.md             # Product backlog (prioritized)
│   └── adr/
│       ├── 001-github-app.md  # GitHub App integration ADR
│       └── 002-security-isolation.md  # Security & data isolation ADR
└── src/
    ├── index.ts           # Main Worker, MCP server, HTTP routes
    └── github.ts          # GitHub API helpers (auth, fetch files)
```

## Secrets Configuration

These secrets must be set via `wrangler secret put <NAME>`:

| Secret | Description |
|--------|-------------|
| `GITHUB_APP_ID` | GitHub App ID (from app settings page) |
| `GITHUB_APP_PRIVATE_KEY` | Full contents of the `.pem` private key file |
| `GITHUB_WEBHOOK_SECRET` | Webhook secret (generate with `openssl rand -hex 32`) |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth client secret (from app settings) |
| `CLOUDFLARE_API_TOKEN` | API token with "AI Search Edit" permission |

### Local GitHub App Private Key

The GitHub App private key is stored locally at `github-app.pem` (gitignored). This file enables CLI scripts to authenticate as the GitHub App (JWT auth) to access App-level APIs such as webhook delivery logs (`GET /app/hook/deliveries`). The App ID is `2716073`.

## Environment Variables

Set in `wrangler.toml` under `[vars]`:

| Variable | Description |
|----------|-------------|
| `AUTORAG_NAME` | AI Search instance name (`home-brain-search`) |
| `WORKER_URL` | Base URL for the worker (`https://brainstem.cc`) |
| `GITHUB_REPO_URL` | Legacy: GitHub repo URL for source links |
| `GITHUB_APP_NAME` | GitHub App name for install URL (`git-brain-stem`) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |
| `GITHUB_CLIENT_ID` | GitHub OAuth client ID (from app settings) |

## HTTP Endpoints

### MCP Endpoints
| Endpoint | Auth Required | Description |
|----------|---------------|-------------|
| `/mcp/{uuid}` | Yes (bearer token) | Per-installation MCP endpoint (multi-tenant) |

All MCP connections require a bearer token from OAuth. The legacy `/mcp` endpoint and workers.dev domain have been removed (ADR-002).

### Setup & Webhooks
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/setup` | GET | Landing page with "Connect Repository" button |
| `/setup/callback` | GET | GitHub App installation callback |
| `/webhook/github` | POST | GitHub webhook receiver |

### OAuth & Discovery Endpoints
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/.well-known/oauth-protected-resource` | GET | RFC 9728 Protected Resource Metadata |
| `/.well-known/oauth-authorization-server` | GET | RFC 8414 Authorization Server Metadata |
| `/oauth/authorize` | GET | Redirect to GitHub OAuth consent (supports PKCE) |
| `/oauth/callback` | GET | Handle GitHub OAuth callback, issue authorization code |
| `/oauth/token` | POST | Exchange code for token (supports PKCE verification) |
| `/oauth/register` | POST | Dynamic Client Registration (RFC 7591) |

### Debug Endpoints (all require bearer token)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/debug/status/{uuid}` | GET | Diagnostic info for an installation (owner only) |
| `/debug/webhooks` | GET | Recent webhook logs |
| `/debug/reindex` | POST | Manually trigger AI Search reindex |
| `/debug/sync/{uuid}` | POST | Manually trigger full repo sync (owner only) |
| `/debug/sync-file/{uuid}` | POST | Sync a single file (owner only) |
| `/debug/delete/{uuid}` | POST | Delete installation: purge R2, D1, sessions (owner only) |

## Registered MCP Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `about` | Get information about Git Brain | none |
| `search_brain` | Semantic search via AI Search | `query`, `limit?` |
| `get_document` | Retrieve document from R2 by path | `path` |
| `list_recent` | List recently modified files | `limit?`, `path_prefix?` |
| `list_folders` | Browse folder structure | `path?` |
| `inbox` | Add a note to the inbox | `title`, `content` |

## AI Search Reindex API

**Correct endpoint** (discovered via Cloudflare dashboard network inspection):
```
POST /accounts/{account_id}/ai-search/instances/{name}/jobs
```

**NOT** the documented `full_scan` endpoint which returns 404:
```
PATCH /autorag/rags/{name}/full_scan  # DOES NOT WORK
```

The cooldown period is ~30 seconds between syncs. Error code `7020` (`sync_in_cooldown`) is handled gracefully as success.

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

# Test per-user MCP endpoint
node test-user-mcp.mjs
```

## Testing Requirements

**CRITICAL**: After making any changes to the MCP server, Claude MUST:

1. Run `npm run typecheck` to verify TypeScript compiles
2. Run `npm run deploy` to deploy changes
3. Run `node test-user-mcp.mjs` to verify the MCP server responds correctly (requires valid bearer token)

**Do NOT rely on the user to test MCP functionality.** Always verify the deployment works before reporting success.

### Test Script Output

A successful test looks like:
```
Connecting to: https://brainstem.cc/mcp/{uuid}
Connected!

=== Available Tools ===
{
  "tools": [
    { "name": "about", ... },
    { "name": "search_brain", ... },
    { "name": "get_document", ... },
    { "name": "list_recent", ... },
    { "name": "list_folders", ... },
    { "name": "inbox", ... }
  ]
}
```

## Key URLs for Testing

- **Setup page**: `https://brainstem.cc/setup`
- **OAuth authorize**: `https://brainstem.cc/oauth/authorize`
- **Debug status**: `https://brainstem.cc/debug/status/{uuid}`
- **Webhook logs**: `https://brainstem.cc/debug/webhooks`
- **Manual reindex**: `POST https://brainstem.cc/debug/reindex`

## Database Schema

### `installations` table
```sql
CREATE TABLE installations (
  id TEXT PRIMARY KEY,              -- UUID v4
  github_installation_id INTEGER,   -- GitHub's installation ID
  account_login TEXT,               -- GitHub username or org
  account_type TEXT,                -- 'User' or 'Organization'
  repo_full_name TEXT,              -- e.g., 'dudgeon/home-brain'
  created_at TEXT,
  last_sync_at TEXT,
  user_id TEXT                      -- FK to users table (set on first OAuth)
);
```

### `users` table
```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,              -- UUID v4
  github_user_id INTEGER UNIQUE,    -- GitHub's user ID
  github_login TEXT,                -- GitHub username
  created_at TEXT,
  last_login_at TEXT
);
```

### `sessions` table
```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,              -- UUID v4 (this IS the bearer token)
  user_id TEXT,                     -- FK to users table
  github_access_token TEXT,         -- GitHub OAuth token (optional)
  created_at TEXT,
  expires_at TEXT                   -- 1 year from creation
);
```

### `oauth_clients` table (auto-created on first DCR request)
```sql
CREATE TABLE oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_secret TEXT NOT NULL,
  client_name TEXT,
  redirect_uris TEXT NOT NULL,       -- JSON array
  created_at TEXT NOT NULL
);
```

### `authorization_codes` table (auto-created on first DCR request)
```sql
CREATE TABLE authorization_codes (
  code TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT,               -- PKCE S256 challenge
  code_challenge_method TEXT,
  user_id TEXT,
  github_access_token TEXT,
  expires_at TEXT NOT NULL,
  used INTEGER DEFAULT 0
);
```

### `webhook_logs` table
```sql
CREATE TABLE webhook_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at TEXT,
  event_type TEXT,
  installation_id TEXT,
  payload_summary TEXT,
  status TEXT,
  error TEXT
);
```

## Customer Lifecycle

### New Installation (Onboarding)

1. User visits `/setup` → installs the GitHub App on their repo
2. GitHub redirects to `/setup/callback` with `installation_id`
3. Callback creates D1 installation record, then triggers background sync via `ctx.waitUntil()`
4. Background sync: `syncRepo` fetches the entire repo tree (Git Trees API — 1 API call), downloads each text file (Git Blobs API), writes to R2 at `brains/{uuid}/`, generates `_brain_summary.json`, triggers AI Search reindex
5. User authenticates via OAuth → session created → MCP tools available

**Key functions:** `handleSetupCallback` → `syncRepo` → `fetchRepoTree` / `fetchBlobContent` → `generateBrainSummary` → `triggerAISearchReindex`

### Incremental Sync (Ongoing)

1. User pushes to GitHub → webhook fires to `/webhook/github`
2. `extractChangedFiles` parses push payload for added/modified files
3. `syncChangedFiles` fetches each changed file via GitHub Contents API, writes to R2
4. AI Search reindex triggered automatically

**Note:** Deleted files are not yet handled — see backlog.

### Account Deletion (Offboarding)

Triggered by either:
- **GitHub App uninstall** → `installation.deleted` webhook → `/webhook/github`
- **Manual** → `POST /debug/delete/{uuid}` (auth-gated, owner-only)

Both call `deleteInstallation(env, installationUuid)` which:
1. Paginated R2 list + bulk delete of all objects under `brains/{uuid}/`
2. Deletes the D1 installation record
3. Revokes all sessions for the owning user
4. Triggers AI Search reindex to remove stale vectors

**E2E test procedure:**
1. Note the installation UUID and file count via `/debug/status/{uuid}`
2. Uninstall the GitHub App from GitHub (Settings → Applications → git-brain-stem → Uninstall)
3. Check GitHub App settings → Recent Deliveries → confirm `installation.deleted` webhook got 200 response
4. Verify R2 is empty: `/debug/status/{uuid}` should 404 or show 0 files
5. Verify bearer token is revoked: any authenticated request should return 401
6. Verify D1 is clean: `wrangler d1 execute brain-stem-db --remote --command "SELECT COUNT(*) FROM installations"`

## Development History & Decisions

### Key Implementation Decisions

1. **GitHub App (not OAuth/PAT)**: Enables webhook-based sync without user managing tokens. App authenticates via JWT + installation token.

2. **Single AI Search instance with folder filtering**: All users share one AI Search index. Files are stored at `brains/{uuid}/` in R2, and search queries use folder metadata filters for tenant isolation (ADR-002).

3. **Per-installation Durable Objects**: Each installation gets its own DO via `idFromName(uuid)` for session isolation.

4. **Webhook-based sync**: Files sync on push, not via polling. Incremental sync (only changed files) to stay within Worker limits.

5. **Cloudflare Agents SDK**: Using `agents` package instead of raw MCP SDK. Provides `McpAgent` class that handles Durable Objects integration automatically.

### Defects Overcome

1. **AI Search reindex API**: The documented `full_scan` endpoint doesn't exist. Correct endpoint found via dashboard network inspection: `POST /ai-search/instances/{name}/jobs`.

2. **AI Search token expiry**: AI Search has an internal token for R2 access that can expire. Fix: regenerate service API token in Cloudflare dashboard (AI Search settings).

3. **MCP SDK version mismatch**: The `agents` package bundles its own `@modelcontextprotocol/sdk@1.25.2`. Using a different version causes type conflicts.

4. **Durable Objects free tier**: Free tier requires `new_sqlite_classes` in migrations, not `new_classes`.

5. **nodejs_compat flag**: The agents SDK requires Node.js compatibility mode in wrangler.toml.

6. **Worker subrequest limits**: Recursive `syncDirectory` made 1 subrequest per directory + 1 per file, hitting the 1000 limit at ~40 files. Solution: rewrote `syncRepo` to use Git Trees API (1 call for entire tree) + Blobs API (1 call per file), reducing subrequests to O(1 + files).

7. **Webhook URL misconfigured**: GitHub App webhook URL was set to `/setup/callback` (a GET endpoint) instead of `/webhook/github`. All webhook POST requests returned 400 for days. Diagnosed by querying `GET /app/hook/deliveries` using the local GitHub App private key. Fix: updated webhook URL in GitHub App settings.

## Connecting to Claude

### Getting a Token

1. Visit `https://brainstem.cc/oauth/authorize` in your browser
2. Authorize with GitHub
3. Copy the session token from the success page

### Claude.ai (Web) — Automatic OAuth
1. Settings → Connectors → Add custom connector
2. URL: `https://brainstem.cc/mcp/{uuid}`
3. Claude.ai automatically discovers OAuth endpoints via `/.well-known/oauth-protected-resource`, registers via DCR, and walks you through GitHub authentication
4. Callback URL: `https://claude.ai/api/mcp/auth_callback`

### Claude Code / Desktop
Add to MCP server config:
```json
{
  "mcpServers": {
    "home-brain": {
      "url": "https://brainstem.cc/mcp/{uuid}",
      "headers": {
        "Authorization": "Bearer <your-session-token>"
      }
    }
  }
}
```


## Brain Summary (Dynamic Tool Metadata)

The MCP server can load a `_brain_summary.json` file from R2 to enrich the `search_brain` tool description with actual content topics.

### Summary File Format

```json
{
  "domains": ["family", "projects", "resources", "tools"],
  "topics": ["kids Alina & Owen", "swim team", "schools", "home automation"],
  "recentFiles": ["domains/family/README.md", "tasks.md"],
  "lastUpdated": "2025-01-22T00:00:00Z"
}
```

### Non-Exhaustive Framing

The summary is explicitly framed as **non-exhaustive** in the tool description to prevent Claude from thinking "topic X isn't in the summary, so I shouldn't search."

## Current Status

**v4.2 — Webhook Fix + OAuth UX + Token Expiry:**
- ✅ All MCP endpoints require OAuth bearer token
- ✅ Legacy `/mcp` endpoint removed
- ✅ workers.dev domain disabled (`workers_dev = false`)
- ✅ Debug endpoints auth-gated with installation ownership checks
- ✅ `/doc/{path}` endpoint removed
- ✅ Dual-write to R2 root eliminated (files only at `brains/{uuid}/`)
- ✅ AI Search queries scoped per-installation via folder metadata filters
- ✅ Root R2 data cleaned up
- ✅ OAuth discovery: `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`
- ✅ Dynamic Client Registration (`/oauth/register`)
- ✅ PKCE support (S256)
- ✅ Claude.ai automatic connector integration
- ✅ 6 MCP tools: about, search_brain, get_document, list_recent, list_folders, inbox
- ✅ Initial sync on setup (background via `waitUntil`)
- ✅ Account deletion: R2 purge, D1 cleanup, session revocation on GitHub App uninstall
- ✅ Manual deletion via `/debug/delete/{uuid}`
- ✅ OAuth success page shows real installation UUID (no more placeholder)
- ✅ Session tokens extended to 1 year (was 30 days)
- ✅ Webhook pipeline verified end-to-end (URL was misconfigured, now fixed)
- ✅ GitHub App private key available locally for CLI diagnostics

## Known Limitations

1. **Deleted files not cleaned up** — Files deleted from the GitHub repo are never removed from R2 or AI Search. The webhook handler collects `removed` files but ignores them.

2. **AI Search tenant isolation unverified** — Folder metadata filtering is implemented but never tested with multiple tenants. Cross-tenant leakage is theoretically possible.

3. **No token refresh** — Sessions expire after 1 year with no refresh mechanism.

4. **Initial sync subrequest limit** — Full repo sync may hit the Worker 1000-subrequest limit on repos with >500 files. Works for typical knowledge base repos.

## Backlog

See [docs/BACKLOG.md](docs/BACKLOG.md) for the full prioritized product backlog.

## References

- [Cloudflare Agents SDK](https://developers.cloudflare.com/agents/)
- [AI Search Docs](https://developers.cloudflare.com/ai-search/)
- [MCP Specification](https://modelcontextprotocol.io/)
- [R2 Documentation](https://developers.cloudflare.com/r2/)
- [GitHub Apps](https://docs.github.com/en/apps)
