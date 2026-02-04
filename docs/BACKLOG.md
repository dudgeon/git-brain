# Product Backlog

**Last updated:** 2026-02-03

---

## Critical — Blocking core functionality

*(No critical items)*

---

## High — Security & correctness

### ~~User data encryption at rest~~ → [ADR-003](adr/003-encryption-at-rest.md)

Decided: R2 already encrypts at rest (Cloudflare-managed AES-256-GCM). Application-layer encryption is incompatible with AI Search (which reads R2 directly) and any scheme where the Worker holds keys doesn't protect against the operator. Phase 1: document trust model and add disclosures (done). Phase 2: per-user R2 + AI Search instances for hard tenant isolation. Phase 3 (aspirational): BYOA model for true operator-blindness.

### Verify AI Search tenant isolation

Search queries use folder metadata filters (`gt`/`lte` on folder path) for cross-tenant isolation, but this has never been verified with multiple tenants. The `folder` metadata key may not exist or may not filter correctly.

**Fix:** Deploy a second test installation, sync files, and verify that search from installation A never returns installation B's documents.

### Token refresh flow

Session tokens expire after 1 year with no refresh mechanism. Users must re-authenticate. ChatGPT and Claude.ai expect `refresh_token` support.

**Fix:** Implement `refresh_token` grant type in `/oauth/token`. Issue refresh tokens on OAuth callback. Store in sessions table. Handle rotation.

### Token revocation

No way to revoke a bearer token before expiry. A compromised token remains valid for up to 1 year.

**Fix:** Add `/oauth/revoke` endpoint that deletes the session from D1.

---

## Medium — Product quality

### Link installation to user on setup

Installations are only linked to users on first OAuth (by matching GitHub login). If a user installs the GitHub App but never authenticates, the installation remains unowned.

**Fix:** Either require OAuth before App installation, or request user identity during the App installation callback.

### Multi-repo support

GitHub Apps can be installed on multiple repos, but only the first repo is synced. Supporting multiple repos requires storing the repo list, prefixing R2 paths by repo, and scoping MCP tools per repo.

### AI Search path filtering

Configure `include_items: ["brains/**"]` in the AI Search instance settings to ensure only scoped files are indexed (not stale root objects).

### ~~Brain summary generation on sync~~ ✅ DONE

Fixed: `syncChangedFiles` now regenerates `_brain_summary.json` after any file changes (added, modified, or removed), not just removals.

---

## Low — Polish

### ScopedR2 / ScopedAISearch wrappers

Enforce path prefixes at the API layer so MCP tools can never accidentally access raw `env.R2` or `env.AI` without scoping. Prevents path traversal and cross-tenant access.

### Rate limiting

No rate limiting on any endpoint. OAuth endpoints are vulnerable to brute-force. MCP endpoints could be used for resource exhaustion.

### Observability

Console logging is basic. Would benefit from structured JSON logging, request IDs, error reporting (Sentry), and a metrics dashboard.

### Error response consistency

Error responses mix plain text and JSON. Standardize on `{ "error": "code", "message": "Human readable" }` with correct HTTP status codes.

### Automated tests

No automated tests exist. The manual test script (`test-user-mcp.mjs`) requires a live deployment and valid bearer token. Would benefit from unit tests for OAuth, integration tests for webhooks, and E2E tests for MCP tools.

### UUID-free MCP URL

Users currently need `https://brainstem.cc/mcp/{uuid}` — the UUID is ugly and requires manual copy-paste. The server should resolve the user's installation from their bearer token so Claude.ai users can just give `https://brainstem.cc/mcp`.

**Fix:** On authenticated `/mcp` POST, look up the session's user_id, query installations, and auto-scope to the user's installation. Falls through to generic about-only MCP if unauthenticated. `/mcp/{uuid}` continues working for backward compatibility.

### Self-service onboarding UI

The setup page is minimal. Could add progress indicators, repo selection (for multi-repo), and connection verification.

---

## Done

Items completed in v4.4+:

- **Tool metadata enhancements (v4.5):** Updated `brain_inbox` and `brain_inbox_save` tool descriptions to guide clients on which tool to use. `brain_inbox_save` is now callable by models directly (removed `visibility: ["app"]`) with optional `filePath` parameter and auto-generation. `brain_inbox` description clarifies it's for UI hosts only. Non-UI hosts and AI agents should use `brain_inbox_save` instead for direct saves.
- **File deletion sync:** `extractChangedFiles` now returns both changed and removed files. `syncChangedFiles` deletes removed files from R2 and triggers AI Search reindex. Brain summary is regenerated after deletions. Also handles file moves (git treats moves as remove + add). AI Search takes 2-3 minutes to process deletion from its vector index — this is expected Cloudflare behavior, not a bug.
- **Initial sync subrequest limit fix:** `syncRepo` previously fetched each file individually via the Git Blobs API (1 external subrequest per file), hitting the Workers free-plan 50-subrequest limit. Repos with >50 files silently stopped syncing partway through (e.g., 51/136 files). Replaced with GitHub Tarball API approach — downloads the entire repo as a gzip tarball in 1 subrequest, extracts and filters in-memory, then writes to R2 (internal bindings, no limit).

Items completed in v4.0-v4.3, for changelog reference:

- **Security lockdown (ADR-002):** Auth on all endpoints, legacy `/mcp` removed, workers.dev disabled, debug endpoints auth-gated with ownership checks, `/doc/*` removed, dual-write eliminated, root R2 cleaned
- **AI Search tenant isolation:** Folder metadata filtering (`gt`/`lte`) on shared index
- **OAuth discovery (RFC 9728/8414):** `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`
- **Dynamic Client Registration (RFC 7591):** `/oauth/register`
- **PKCE support:** S256 code challenge/verifier in OAuth flow
- **Claude.ai connector:** Automatic OAuth discovery, DCR, PKCE — connect with just the MCP URL
- **brain_inbox tool:** Always registered (removed conditional on inbox folder existence); renamed from `inbox` to `brain_inbox` for clarity
- **Brain Inbox Composer (MCP App):** Interactive preview-before-save UI using `@modelcontextprotocol/ext-apps`. In Claude Desktop, `brain_inbox` shows a streaming markdown preview, 5-second auto-save countdown, editable title/content, save/cancel buttons. Uses `brain_inbox_save` (app-only tool) via `callServerTool`. Vite + vite-plugin-singlefile build pipeline. See ADR-004
- **Initial sync on setup:** Background `waitUntil` sync in `/setup/callback` — repo content available within minutes of installation
- **Account deletion:** `installation.deleted` webhook purges R2 files, D1 records, sessions. Manual `/debug/delete/{uuid}` endpoint also available
- **OAuth success page UX:** Shows real installation UUID in MCP config (no more placeholder)
- **Token expiry extended:** Session tokens changed from 30 days to 1 year
- **Webhook pipeline fix:** Corrected webhook URL from `/setup/callback` to `/webhook/github`
- **Success page redesign:** Copy-button fields matching Claude.ai connector labels; note that OAuth Client ID/Secret not needed
- **Generic MCP at bare `/mcp`:** About-only tool with connection instructions when no installation scoped
- **Bare `/mcp` GET blocked:** Returns 404 JSON with setup instructions

---

## Related documents

- [ADR-001: GitHub App](adr/001-github-app.md)
- [ADR-002: Security Isolation](adr/002-security-isolation.md)
- [ADR-003: Encryption at Rest](adr/003-encryption-at-rest.md)
- [ADR-004: MCP Apps UI](adr/004-mcp-apps-ui.md)
- [CLAUDE.md](../CLAUDE.md)
