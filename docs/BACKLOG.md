# Product Backlog

**Last updated:** 2026-01-31

---

## Critical — Blocking core functionality

### File deletion sync

When files are deleted from the GitHub repo, they are **not** deleted from R2 or AI Search. The webhook handler (`extractChangedFiles`) collects `removed` files from push payloads but ignores them — see `src/index.ts` line 1392: `// Note: We don't handle removed files yet`.

**Fix:** In `syncChangedFiles`, delete R2 objects for removed files (`env.R2.delete(key)`). Trigger AI Search reindex after deletion to remove stale vectors.

---

## High — Security & correctness

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

### Brain summary generation on sync

The `_brain_summary.json` file is generated during `syncRepo` (initial sync) but NOT regenerated during incremental webhook syncs. Adding/removing files via push doesn't update the summary's `domains`, `topics`, or `recentFiles`.

**Fix:** Call `generateBrainSummary` at the end of `syncChangedFiles` (incremental webhook handler) in addition to `syncRepo`.

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

No automated tests exist. Manual test scripts (`test-mcp.mjs`, `test-user-mcp.mjs`) require a live deployment. Would benefit from unit tests for OAuth, integration tests for webhooks, and E2E tests for MCP tools.

### Self-service onboarding UI

The setup page is minimal. Could add progress indicators, repo selection (for multi-repo), and connection verification.

---

## Done

Items completed in v4.0-v4.2, for changelog reference:

- **Security lockdown (ADR-002):** Auth on all endpoints, legacy `/mcp` removed, workers.dev disabled, debug endpoints auth-gated with ownership checks, `/doc/*` removed, dual-write eliminated, root R2 cleaned
- **AI Search tenant isolation:** Folder metadata filtering (`gt`/`lte`) on shared index
- **OAuth discovery (RFC 9728/8414):** `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`
- **Dynamic Client Registration (RFC 7591):** `/oauth/register`
- **PKCE support:** S256 code challenge/verifier in OAuth flow
- **Claude.ai connector:** Automatic OAuth discovery, DCR, PKCE — connect with just the MCP URL
- **Inbox tool:** Always registered (removed conditional on inbox folder existence)
- **Initial sync on setup:** Background `waitUntil` sync in `/setup/callback` — repo content available within minutes of installation
- **Account deletion:** `installation.deleted` webhook purges R2 files, D1 records, sessions. Manual `/debug/delete/{uuid}` endpoint also available
- **OAuth success page UX:** Shows real installation UUID in MCP config (no more placeholder)
- **Token expiry extended:** Session tokens changed from 30 days to 1 year
- **Webhook pipeline fix:** Corrected webhook URL from `/setup/callback` to `/webhook/github`

---

## Related documents

- [ADR-001: GitHub App](adr/001-github-app.md)
- [ADR-002: Security Isolation](adr/002-security-isolation.md)
- [CLAUDE.md](../CLAUDE.md)
