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

**Keep `site/content.md` in sync:** When making major changes to any user-facing HTML page (homepage, success page, OAuth pages, error pages), always update `site/content.md` to reflect the change. This file is the source of truth for all page content on brainstem.cc. If the HTML and content.md diverge, content.md wins.

**Fix the code, don't work around it:** When you discover a bug or limitation in the application, your default response must be to fix the application code — not trigger manual workarounds (debug endpoints, manual syncs, etc.). Workarounds are not acceptable as solutions. If you identify a defect, immediately shift to implementing a code fix. This does NOT mean repurposing existing destructive endpoints for unintended purposes — if no safe endpoint exists for what you need, write a one-off script instead.

**Document bugs proactively:** When you discover a bug, immediately log it in `docs/BACKLOG.md` — don't wait to be asked. If you're about to fix it, log it as a Done item with explanation. If it's deferred, add it to the appropriate priority section.

**Keep test credentials current:** When installation UUIDs or bearer tokens change (e.g., after a reinstall), immediately update `test-user-mcp.mjs` and any other test scripts. Being able to test the MCP server directly is critical — never leave stale credentials as a known issue.

**Verify before asking the user to validate:** Always test functionality yourself before reporting it as done or asking the user to check. This means: run unit tests (`npm test`), hit the prod MCP server directly (`node test-user-mcp.mjs`, `curl` against live endpoints), check debug/status endpoints to confirm state changes, and use Chrome integration (`--chrome` flag or `/chrome` command) to visually inspect web page changes (success pages, setup pages, etc.). The user's validation should be a second look, not the primary check. When testing features end-to-end (e.g., webhook-triggered sync, file deletion), run the verification scripts yourself — don't ask the user to run them or report back results.

**Never run destructive operations against production data:** Debug endpoints like `/debug/delete` and `/debug/sync` have irreversible side effects (purging R2 files, deleting D1 records, revoking sessions). Before calling any write/POST debug endpoint, re-read the endpoint's documentation in this file to understand exactly what it does. If you need to clean up R2 without destroying the installation, write a targeted script — don't repurpose a full-deletion endpoint. When in doubt, ask the user before executing.

**Be proactive with read-only research:** When investigating issues or verifying changes, always proactively check the live state of things (R2 contents, GitHub repo, worker logs, debug endpoints) rather than waiting for the user to ask. Read-only operations are safe and give you the information needed to diagnose problems or confirm success.

**Use your own tooling — don't delegate diagnostics to the user:** You have the GitHub App private key (`github-app.pem`, App ID `2716073`) and can authenticate as the GitHub App to query webhook deliveries, installation details, and other App-level APIs. Use manual JWT generation (Node.js `crypto` module) rather than `@octokit/auth-app` for CLI scripts — it's more reliable. When something isn't working, pull the logs yourself rather than asking the user to check GitHub UI.

**Node.js version:** Wrangler requires Node.js v20+. Always run `source ~/.nvm/nvm.sh && nvm use 20` before `npm run deploy` or `npm run typecheck` commands.

**Check implementation before documenting:** When asked to write PRDs, feature specs, or design docs, ALWAYS read the current implementation first. Do not make assumptions about architecture, existing features, or code structure. Read `src/index.ts`, check the backlog, and verify actual behavior before proposing changes. A feature you're asked to design may already be implemented, or the architecture may have evolved significantly. Writing documentation based on assumptions wastes time and creates confusion when branches diverge.

**Branch hygiene and divergence:** When working on a branch that has diverged from main (check with `git log --oneline <common-ancestor>..origin/main`), assess whether the work is still relevant:
- If main has evolved significantly (architecture changes, rebrand, major refactors), consider abandoning the branch and extracting useful ideas to the backlog instead of forcing a merge
- Don't create PRDs or extensive documentation on stale branches — they become obsolete quickly
- When in doubt, ask the user for decisions about branch disposition (abandon, salvage, or merge)

**Sync before committing:** Always `git fetch && git status` before committing to check for remote changes. If behind, stash local changes, pull, then pop. This repo may have concurrent sessions from different Claude instances.

**Never ignore MCP server errors:** When an MCP tool call fails — whether from Claude.ai, Claude Desktop, Claude Code, or a test script — treat it as a potential product bug. Investigate the root cause immediately (check error codes, compare behavior across clients, inspect server responses). Log the issue in `docs/BACKLOG.md` even if you work around it. Do not silently switch to a workaround and move on.

**Design tool metadata for semantic understanding:** When writing MCP tool descriptions, focus on *why* Claude should use the tool (semantic categories), not just trigger phrases. Good: "Use for information about the user unlikely to be in training data or public sources." Bad: "Use when user says 'search the brain'." Semantic descriptions generalize; phrase matching is brittle.

**No browser DOM in Workers:** Cloudflare Workers do not have `document`, `window`, or any browser DOM APIs. Libraries that parse HTML via `document.createElement` (Turndown, JSDOM, Readability, etc.) will throw `document not defined` at runtime. When a feature needs HTML→markdown or HTML parsing, always run the conversion client-side (bookmarklet, browser extension, frontend) and send the result to the Worker. Never add DOM-dependent logic to server-side Worker code.

**CORS-safe error handling for cross-origin endpoints:** Any Worker route called from cross-origin JavaScript (bookmarklets, browser extensions, external frontends) MUST wrap the entire handler in try/catch. An uncaught exception causes the Worker runtime to return a bare 500 without CORS headers — browsers can't read the error, so users see an opaque "Failed to fetch" instead of the real message. The catch block must return a Response with CORS headers (`Access-Control-Allow-Origin`, etc.) so the actual error propagates to the caller.

**Bookmarklet build hygiene:** Vite IIFE output ends with `})();`. When wrapping in `javascript:void(...)`, the trailing semicolon inside the parens is a syntax error. Always `.trim().replace(/;$/, '')` on the IIFE string before URI-encoding. Test bookmarklets on real pages (not just localhost) — CSP, CORS, and encoding issues only surface in production contexts.

## Architecture

```
GitHub Push → Webhook → Worker → R2 Bucket → AI Search (reindex) → MCP Server → Claude
                          ↓
                   Durable Objects (session state)
                          ↓
                   D1 Database (installations, logs, email)

Email → Cloudflare Email Routing → Worker email() → R2 + GitHub (via saveToInbox)

Bookmarklet/Shortcut → POST /api/clip → Worker → R2 + GitHub (via saveToInbox)
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
| Email Routing | `*@brainstem.cc` | Catch-all routes inbound email to Worker `email()` handler |

## Tech Stack

- **Runtime**: Cloudflare Workers with Durable Objects
- **MCP Framework**: Cloudflare Agents SDK (`agents` package)
- **Storage**: Cloudflare R2
- **Database**: Cloudflare D1 (SQLite)
- **Search/RAG**: Cloudflare AI Search
- **Auth**: GitHub App + GitHub OAuth 2.0
- **Language**: TypeScript
- **Validation**: Zod
- **Email Parsing**: `postal-mime` (MIME) + `turndown` (HTML→markdown)
- **Email Routing**: Cloudflare Email Routing (catch-all → Worker)
- **MCP Apps UI**: `@modelcontextprotocol/ext-apps` + Vite + `vite-plugin-singlefile`

## Project Structure

```
git-brain/
├── CLAUDE.md              # This file - project instructions for Claude
├── README.md              # Public documentation
├── TROUBLESHOOTING.md     # Common issues and solutions
├── wrangler.toml          # Cloudflare Worker configuration
├── package.json
├── tsconfig.json
├── vitest.config.ts       # Vitest test configuration
├── test-user-mcp.mjs      # MCP endpoint test (authenticated, production)
├── test-mocks/            # Mock assets for unit tests
│   └── empty-asset.js     # Empty string exports for binary/HTML imports
├── docs/
│   ├── BACKLOG.md             # Product backlog (prioritized)
│   └── adr/                   # Architecture Decision Records
├── scripts/
│   └── setup-email-routing.mjs  # Cloudflare Email Routing configuration script
├── src/
│   ├── index.ts           # Main Worker, MCP server, HTTP routes
│   ├── github.ts          # GitHub API helpers (auth, fetch files)
│   ├── cloudflare.ts      # Cloudflare API helpers (AI Search reindex)
│   ├── inbox.ts           # Shared inbox logic (saveToInbox, ensureEmailTables)
│   ├── email.ts           # Inbound email handler (routing, verification, MIME parsing)
│   ├── clip.ts            # Web clipping handler (bookmarklet/iOS Shortcut → inbox)
│   ├── utils.ts           # Pure utility functions (extractChangedFiles, sanitizeInboxTitle, validateAlias)
│   ├── github.test.ts     # Unit tests for GitHub helpers (webhook signature, file filtering)
│   ├── index.test.ts      # Unit tests for business logic (webhook parsing, title sanitization)
│   ├── email.test.ts      # Unit tests for email functions (alias validation, code gen, parsing)
│   ├── clip.test.ts       # Unit tests for clip functions (frontmatter builder)
│   └── html.d.ts          # Type declarations for .html and .js text imports
└── ui/
    ├── brain-inbox/       # Brain Inbox Composer app source
    │   ├── index.html     # HTML shell (composing → draft → saving → result states)
    │   ├── vite.config.ts # Vite + vite-plugin-singlefile build config
    │   ├── tsconfig.json
    │   └── src/
    │       ├── app.ts     # App logic (countdown, editing, callServerTool save)
    │       ├── app.css    # Styles (host CSS variables for theme integration)
    │       └── global.css # Base reset
    ├── brain-explorer/    # Brain Explorer app source
    │   ├── brain-explorer.html  # HTML shell (results drawer, viewer, folders)
    │   ├── vite.config.ts
    │   ├── tsconfig.json
    │   └── src/
    │       ├── app.ts     # App logic (callServerTool, updateModelContext, fullscreen)
    │       ├── app.css    # Styles (collapsible drawer, host CSS variables)
    │       └── global.css
    ├── bookmarklet/       # Web Clipper bookmarklet source
    │   ├── vite.config.ts # Vite IIFE build config
    │   ├── tsconfig.json
    │   └── src/
    │       └── clip.ts    # Bookmarklet logic (Readability + fetch + toast)
    └── dist/
        ├── index.html           # Brain Inbox bundle (generated)
        ├── brain-explorer.html  # Brain Explorer bundle (generated)
        └── bookmarklet.js       # Bookmarklet IIFE bundle (generated)
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

All MCP connections require a bearer token from OAuth. Transport is Streamable HTTP (ADR-009; previously SSE). The legacy `/mcp` endpoint and workers.dev domain have been removed (ADR-002).

### Setup & Webhooks
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/setup` | GET | Landing page with "Connect Repository" button |
| `/setup/callback` | GET | GitHub App installation callback |
| `/webhook/github` | POST | GitHub webhook receiver |

### API Endpoints (require bearer token)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/clip` | POST | Web clipping endpoint (bookmarklet / iOS Shortcut → inbox) |
| `/api/clip` | OPTIONS | CORS preflight for cross-origin bookmarklet requests |
| `/bookmarklet` | GET | Bookmarklet delivery page with drag-to-install link |

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

| Tool | Description | Parameters | UI |
|------|-------------|------------|----|
| `about` | Get information about Git Brain | none | — |
| `search_brain` | Semantic search via AI Search | `query`, `limit?` | ✅ Explorer |
| `get_document` | Retrieve document from R2 by path | `path` | ✅ Explorer |
| `list_recent` | List recently modified files | `limit?`, `path_prefix?` | ✅ Explorer |
| `list_folders` | Browse folder structure | `path?` | ✅ Explorer |
| `brain_inbox` | Preview a note before saving (UI hosts only) | `title`, `content` | ✅ Composer |
| `brain_inbox_save` | Save a note to the inbox (R2 + GitHub) | `title`, `content`, `filePath?` | — |
| `brain_account` | Manage email-to-brain forwarding | `action`, `email?`, `alias?` | — |

### Brain Inbox Tools

**For AI agents and non-UI hosts:** Use `brain_inbox_save` directly — it saves the note to both R2 and GitHub in one call. The `filePath` parameter is optional; if omitted, a timestamped filename is auto-generated.

**For UI-capable hosts (Claude Desktop):** The `brain_inbox` tool is paired with an interactive composer UI via the MCP Apps extension (`@modelcontextprotocol/ext-apps`):

1. **Streaming preview** — Note content renders progressively as Claude generates it (`ontoolinputpartial`)
2. **Draft review** — Editable title + content fields with a **5-second countdown bar**
3. **Countdown behavior** — If the user doesn't interact, the note auto-saves after 5s. If they tap or start editing, the countdown pauses and they get manual Save/Cancel buttons
4. **Save** — The app calls `brain_inbox_save` via `callServerTool`. Shows R2/GitHub status on completion
5. **Cancel** — Discards the note without saving

In non-UI hosts, `brain_inbox` returns the draft text but does NOT save. Use `brain_inbox_save` to persist the note.

**Build pipeline:** `npm run build:ui` → Vite bundles the app into a single HTML file (`ui/dist/index.html`) → Wrangler imports it as a text module → served via `registerAppResource`. The `deploy` and `dev` scripts run `build:ui` automatically.

See `docs/adr/` for architecture decisions (ADR-004: inbox composer, ADR-006: explorer).

### Email Input (`brain_account` tool)

Users can forward emails to their `@brainstem.cc` address to save them as inbox notes. The `brain_account` tool manages the full email setup lifecycle.

**Actions:**
- `status` — Show current email config (aliases, verified senders, recent email count). Use this first.
- `request_email` — Start verification for a sender email address. Returns a 6-character code.
- `check_alias` / `request_alias` — Check availability or claim a vanity address (e.g., `dan@brainstem.cc`)
- `remove_email` — Remove a previously verified sender

**Verification flow (inbound code verification):**
1. User calls `brain_account` with `action: "request_email"` and their email address
2. Tool returns a 6-character confirmation code and the user's brainstem address
3. User sends an email with the code as the subject to their brainstem address
4. Worker matches code + sender → marks as verified
5. Future emails from that sender are saved as inbox notes automatically

**Why inbound verification?** MailChannels free-for-Workers was shut down August 2024. Cloudflare `send_email` binding only works for pre-verified destination addresses. Inbound code verification is fully self-contained with zero external services.

**Email processing pipeline:** Cloudflare Email Routing (catch-all `*@brainstem.cc`) → Worker `email()` handler → routing resolution (sub-address `brain+{uuid}@` or alias lookup) → sender verification check → MIME parsing (postal-mime + Turndown for HTML→markdown) → `saveToInbox()` → R2 + GitHub + AI Search reindex

**Key files:** `src/email.ts` (handler), `src/inbox.ts` (shared save logic), `src/cloudflare.ts` (reindex helper)

**D1 tables:** `email_aliases`, `verified_senders`, `email_log` (auto-created via `ensureEmailTables()`)

**ADR:** [ADR-008: Email Input](docs/adr/008-email-input.md)

### MCP Prompts (Slash Commands)

The server registers prompts as explicit tool invocation fallbacks:

| Prompt | Description | Arguments |
|--------|-------------|-----------|
| `brain_search` | Explicitly search the knowledge base | `query` |
| `brain_inbox` | Add a quick note to the inbox | `title`, `content` |

**Purpose:** MCP prompts are designed to be user-invocable slash commands (e.g., `/brain_search family movies`). When invoked, they return a message that explicitly instructs Claude to use the corresponding tool.

**Current limitation:** Claude Desktop doesn't currently render MCP prompts in its UI, but the prompts are correctly advertised via server capabilities. Users can manually tell Claude to "use the brain_search prompt" as a fallback if automatic tool selection fails.

**Tool metadata design:** The `search_brain` tool description is optimized to encourage automatic use:
- Clarifies Claude has been granted access to search on the user's behalf
- Lists semantic triggers (info unlikely in training data, augmenting memory)
- Includes common phrases ("the brain", "my brain", "brainstem")
- The `about` tool output also documents when to use `search_brain`

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

### AI Search Data Notes

**Filenames include R2 prefix**: Search results from `env.AI.autorag().search()` return `r.filename` with the full R2 path including `brains/{uuid}/`. This must be stripped for:
- Display in UI (user shouldn't see internal paths)
- Building GitHub URLs via `getSourceUrl()` (expects repo-relative paths)

**Content is matched chunks**: `r.content` contains the semantically matched chunks, not the beginning of the file. This is the relevant context. But raw chunk text may need cleanup (collapse whitespace, truncate at word boundaries).

## Development Commands

```bash
# Install dependencies
npm install

# Build MCP App UI bundles (runs automatically before dev/deploy)
npm run build:ui

# Run locally (note: AI Search won't work locally)
npm run dev

# Type check
npm run typecheck

# Run unit tests
npm test

# Run unit tests in watch mode
npm run test:watch

# Deploy to Cloudflare (builds UI first)
npm run deploy

# Test MCP connection (REQUIRED after changes)
node test-user-mcp.mjs
```

## Testing Requirements

**CRITICAL**: After making any changes to the MCP server, Claude MUST:

1. Run `npm test` to verify unit tests pass
2. Run `npm run typecheck` to verify TypeScript compiles
3. Run `npm run deploy` to deploy changes
4. Run `node test-user-mcp.mjs` to verify the MCP server responds correctly (requires valid bearer token)

**Do NOT rely on the user to test MCP functionality.** Always verify the deployment works before reporting success.

**For MCP Apps changes:** API tests verify data structure, but visual UX needs testing in Claude Desktop. Ask the user to verify UI after API tests pass.

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
    { "name": "brain_inbox", ... },
    { "name": "brain_account", ... }
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

### `email_aliases` table (auto-created via `ensureEmailTables`)
```sql
CREATE TABLE email_aliases (
  alias TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL,
  type TEXT NOT NULL,              -- 'default' (brain+uuid) or 'vanity'
  created_at TEXT NOT NULL
);
```

### `verified_senders` table (auto-created via `ensureEmailTables`)
```sql
CREATE TABLE verified_senders (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' or 'confirmed'
  confirmation_code TEXT,
  confirmation_expires_at TEXT,
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  UNIQUE(installation_id, email)
);
```

### `email_log` table (auto-created via `ensureEmailTables`)
```sql
CREATE TABLE email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at TEXT NOT NULL,
  installation_id TEXT,
  from_address TEXT,
  to_address TEXT,
  subject TEXT,
  status TEXT NOT NULL,            -- 'saved', 'verified', 'rejected_*', 'error'
  error TEXT,
  inbox_path TEXT
);
```

## Customer Lifecycle

### New Installation (Onboarding)

1. User visits `/setup` → installs the GitHub App on their repo
2. GitHub redirects to `/setup/callback` with `installation_id`
3. Callback creates D1 installation record, then triggers background sync via `ctx.waitUntil()`
4. Background sync: `syncRepo` downloads the entire repo as a gzip tarball (1 subrequest), filters and extracts text files in-memory, writes to R2 at `brains/{uuid}/`, generates `_brain_summary.json`, triggers AI Search reindex
5. User authenticates via OAuth → session created → MCP tools available

**Key functions:** `handleSetupCallback` → `syncRepo` → `fetchRepoTarballFiles` → `generateBrainSummary` → `triggerAISearchReindex`

### Incremental Sync (Ongoing)

1. User pushes to GitHub → webhook fires to `/webhook/github`
2. `extractChangedFiles` parses push payload for added/modified files
3. `syncChangedFiles` fetches each changed file via GitHub Contents API, writes to R2
4. AI Search reindex triggered automatically

**Note:** Deleted files are synced — `extractChangedFiles` returns both changed and removed files. `syncChangedFiles` deletes removed files from R2 and regenerates the brain summary.

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

6. **Worker subrequest limits (v1)**: Recursive `syncDirectory` made 1 subrequest per directory + 1 per file. Solution: rewrote to use Git Trees API + Blobs API, reducing to O(1 + files). **(v2)**: Blobs API still used 1 subrequest per file, hitting the free-plan 50-subrequest limit at ~50 files (repos with 136 files only synced 51). Solution: replaced with GitHub Tarball API — downloads entire repo as gzip tarball in 1 subrequest, parses tar in-memory, writes to R2 via internal bindings.

7. **Webhook URL misconfigured**: GitHub App webhook URL was set to `/setup/callback` (a GET endpoint) instead of `/webhook/github`. All webhook POST requests returned 400 for days. Diagnosed by querying `GET /app/hook/deliveries` using the local GitHub App private key. Fix: updated webhook URL in GitHub App settings.

8. **Claude.ai proxy rejects `structuredContent` and `execution` fields (ADR-009)**: Claude.ai's MCP proxy returned `-32600` for any tool response containing MCP Apps `structuredContent` or SDK-injected `execution: { taskSupport: 'forbidden' }`. Two fixes: (a) switched from `registerAppTool` to standard `server.registerTool()` + conditional upgrade via `RegisteredTool.update()` after client capabilities are known, (b) stripped `execution` field from all tool definitions. Also switched transport from legacy SSE (`serveSSE`) to Streamable HTTP (`HomeBrainMCP.serve("/mcp")`).

9. **Bookmarklet syntax error from IIFE semicolon**: Vite IIFE output ends with `})();`. Wrapping in `javascript:void(...)` put the trailing `;` inside the parens → `SyntaxError: Unexpected token ';'`. Fix: `.trim().replace(/;$/, '')` before `encodeURIComponent`.

10. **Cross-origin "Failed to fetch" hiding real errors**: The `/api/clip` endpoint threw an uncaught exception (Turndown `document not defined`), causing a bare 500 without CORS headers. Browser reported opaque "Failed to fetch" instead of the error. Fix: try/catch wrapper returning CORS-enabled JSON error responses.

11. **Turndown `document not defined` in Workers**: The clip handler called `turndown.turndown(html)` server-side, but Turndown uses `document.createElement` internally. Workers have no browser DOM. Fix: moved HTML→markdown conversion to the bookmarklet (client-side), sending `content` instead of `html` to the API.

12. **Stale diagram served after deploy (browser cache)**: The homepage `<img src="/diagram.png">` had `Cache-Control: public, max-age=86400` (24 hours). After updating the diagram file and redeploying, browsers kept showing the old V1 diagram (no email/web clipper). The Worker was serving the correct file — the browser cache was stale. Fix: added cache-busting query parameter (`/diagram.png?v=2`). Future deploys that update static assets need to bump the version parameter.

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

**v5.2 — Web Clipping (Bookmarklet + iOS Shortcut):**
- ✅ `POST /api/clip` REST endpoint: accepts `{ url, title, content?, context? }`, saves to brain inbox
- ✅ Client-side HTML→markdown: bookmarklet runs Readability + Turndown in-browser, sends markdown to server
- ✅ Self-contained bookmarklet: bundles `@mozilla/readability` + `turndown` (~45KB IIFE), extracts and converts in-browser
- ✅ `prompt()` dialog for optional context note (stored as frontmatter field)
- ✅ Bookmarklet cancellation: pressing Cancel on prompt aborts without saving
- ✅ URL-only bookmark fallback: when Readability fails or no content provided (iOS Shortcut path)
- ✅ CORS support: `Access-Control-Allow-Origin: *` (safe — auth is bearer token, not cookies)
- ✅ Bookmarklet delivered on OAuth success page and dedicated `/bookmarklet` page
- ✅ iOS Shortcut instructions on `/bookmarklet` page
- ✅ Vite IIFE build pipeline: `ui/bookmarklet/` → `ui/dist/bookmarklet.js`
- ✅ YAML frontmatter: `source: clip`, `url`, `date`, `title`, `context` (optional)
- ✅ 81 total unit tests (7 new for clip frontmatter builder)
- ✅ `buildClipFrontmatter()` pure function in `src/utils.ts`

**v5.1 — Public Launch + MCP Apps Compatibility:**
- ✅ GitHub App made public — any GitHub user can now install `git-brain-stem` on their repos
- ✅ Tenant isolation verified with two live installations (search, R2, debug endpoints)
- ✅ Claude.ai proxy fix: switched from legacy SSE to Streamable HTTP transport (ADR-009)
- ✅ MCP Apps conditional upgrade: tools register without `_meta`, upgraded after handshake for Apps-capable clients
- ✅ Stripped SDK-injected `execution` field that caused Claude.ai `-32600` errors

**v5.0 — Email Input (Forward Emails to Brain):**
- ✅ `brain_account` MCP tool: manage email forwarding setup, sender verification, vanity aliases
- ✅ Inbound code verification flow (no outbound email needed — MailChannels deprecated)
- ✅ Cloudflare Email Routing: catch-all `*@brainstem.cc` → Worker `email()` handler
- ✅ MIME parsing: postal-mime for text extraction, Turndown for HTML→markdown fallback
- ✅ Shared `saveToInbox()` extracted to `src/inbox.ts` (used by both `brain_inbox_save` and email handler)
- ✅ `triggerAISearchReindex()` extracted to `src/cloudflare.ts` (breaks circular imports)
- ✅ D1 tables: `email_aliases`, `verified_senders`, `email_log` (auto-migrated via `ensureEmailTables`)
- ✅ Rate limiting: 50 emails/sender/day, 200 emails/installation/day
- ✅ Vanity aliases: `dan@brainstem.cc` (one per installation, 3-30 chars, reserved words blocked)
- ✅ Sub-address routing: `brain+{uuid}@brainstem.cc` for direct UUID-based delivery
- ✅ Email cleanup on uninstall: aliases, verified senders, and email logs purged with installation
- ✅ 74 unit tests (27 new for email functions: alias validation, code generation, address parsing, frontmatter)
- ✅ Durable Object state persistence fix: `installationId` and `repoFullName` survive hibernation via `this.ctx.storage`
- ✅ Tool metadata optimized: `IMPORTANT:` directive prevents `search_brain` from capturing email queries
- ✅ E2E verified: full verification flow + email save tested in production
- ✅ ADR-008: Email Input architecture decision documented

**v4.7 — Tool Metadata & Prompts (Discoverability Improvements):**
- ✅ Improved `search_brain` tool description to encourage automatic use
- ✅ Removed "private" framing that caused Claude to hesitate
- ✅ Added semantic triggers: info unlikely in training data, augmenting memory
- ✅ Added MCP prompts: `brain_search`, `brain_inbox` as explicit invocation fallbacks
- ✅ Updated `about` tool to document prompts and reinforce tool usage guidance
- ✅ Server correctly advertises `prompts` capability (Claude Desktop UI support pending)

**v4.6 — Unit Test Coverage (Pre-Refactor Baseline):**
- ✅ 47 unit tests covering extractable business logic (Vitest framework)
- ✅ Webhook signature verification tests (security-critical HMAC validation)
- ✅ File filtering tests (extension, sensitive file, directory exclusion logic)
- ✅ Webhook payload parsing tests (changed/removed file extraction, deduplication)
- ✅ Title sanitization tests (inbox filename normalization)
- ✅ Pure functions extracted to `src/utils.ts` for testability (no Workers dependencies)
- ✅ Test suite runs in CI-friendly mode (`npm test`) and watch mode (`npm run test:watch`)
- ✅ Establishes regression safety net for ADR-005 refactor (ChatGPT App dual distribution)

**v4.5 — MCP Apps Interactive UI:**
- ✅ Brain Inbox Composer: interactive preview-before-save with 5s countdown, editing, cancel
- ✅ `brain_inbox` → UI preview (returns draft); `brain_inbox_save` → direct save (preferred for non-UI hosts)
- ✅ MCP Apps extension integration (`@modelcontextprotocol/ext-apps`)
- ✅ Vite + vite-plugin-singlefile build pipeline for app UI bundles
- ✅ `npm run build:ui` runs automatically before dev/deploy
- ✅ Streaming preview via `ontoolinputpartial` as Claude generates note content
- ✅ ADR-004: MCP Apps architecture decision documented

**v4.4 — Tarball Sync + Security Transparency:**
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
- ✅ 8 MCP tools: about, search_brain, get_document, list_recent, list_folders, brain_inbox, brain_inbox_save, brain_account
- ✅ Initial sync on setup (background via `waitUntil`)
- ✅ Account deletion: R2 purge, D1 cleanup, session revocation on GitHub App uninstall
- ✅ Manual deletion via `/debug/delete/{uuid}`
- ✅ OAuth success page shows real installation UUID (no more placeholder)
- ✅ Session tokens extended to 1 year (was 30 days)
- ✅ Webhook pipeline verified end-to-end (URL was misconfigured, now fixed)
- ✅ GitHub App private key available locally for CLI diagnostics
- ✅ OAuth success page redesigned with copy-button fields matching Claude.ai labels
- ✅ Bare `/mcp` GET returns 404 with setup instructions
- ✅ Bare `/mcp` POST serves generic about-only MCP (no brain content accessible)
- ✅ Tarball-based initial sync (1 subrequest for entire repo, replaces per-file Blobs API)
- ✅ Security & privacy disclosures on homepage, README, and content.md
- ✅ ADR-003: encryption at rest analyzed (7 alternatives), decided on transparency + future per-user isolation

## Known Limitations

1. **AI Search tenant isolation verified (unidirectional)** — Folder metadata filtering (`gt`/`lte`) confirmed working: an empty installation cannot see another tenant's search results, R2 files, or folder listings. Bidirectional test (both tenants with data) still needed.

2. **No token refresh** — Sessions expire after 1 year with no refresh mechanism.

3. **Initial sync size limit** — Full repo sync downloads the entire repo as a tarball into memory. Very large repos may exceed Worker memory limits (128MB).

4. **No application-layer encryption** — User files in R2 are encrypted with Cloudflare-managed keys (AES-256-GCM) but are readable by the platform operator. This was analyzed thoroughly in ADR-003 and is an intentional tradeoff: application-layer encryption is incompatible with AI Search. See `docs/adr/003-encryption-at-rest.md`.

5. **MCP Apps host support** — MCP Apps is an extension spec currently supported in Claude Desktop. Claude.ai web support is TBD. For non-UI hosts, use `brain_inbox_save` directly.

6. **Turndown requires browser DOM** — `emailToMarkdown()` in `src/email.ts` calls Turndown on HTML, which needs `document`. Workers don't have browser DOM. Currently latent (email `text` path wins for all tested emails). The web clipper avoids this by running Turndown client-side in the bookmarklet. See `docs/BACKLOG.md` for fix options.

## Backlog

See [docs/BACKLOG.md](docs/BACKLOG.md) for the full prioritized product backlog.

## References

- [Cloudflare Agents SDK](https://developers.cloudflare.com/agents/)
- [AI Search Docs](https://developers.cloudflare.com/ai-search/)
- [MCP Specification](https://modelcontextprotocol.io/)
- [R2 Documentation](https://developers.cloudflare.com/r2/)
- [GitHub Apps](https://docs.github.com/en/apps)
- [MCP Apps Extension](https://github.com/modelcontextprotocol/ext-apps)
- [Cloudflare Email Routing](https://developers.cloudflare.com/email-routing/)
- [ADR-009: MCP Apps Compatibility](docs/adr/009-mcp-apps-compatibility.md)
