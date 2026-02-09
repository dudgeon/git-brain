# Product Backlog

**Last updated:** 2026-02-09

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

### Complete data purge on app uninstall

`deleteInstallation()` purges R2 files, the installation D1 record, sessions, and email-related data. But the `users` row, `oauth_clients`, and `authorization_codes` records persist after uninstall.

**Fix:** Audit the full uninstall path. Delete or anonymize the `users` row. Revoke and delete `oauth_clients` and `authorization_codes` associated with the user. Ensure no PII remains in D1 after the user disconnects.

---

## Medium — Product quality

### `structuredContent` breaks Claude.ai MCP proxy

Tools that return `structuredContent` (MCP Apps extension field from `@modelcontextprotocol/ext-apps`) fail when called via Claude.ai's MCP connector. The proxy returns JSON-RPC error `-32600` ("Anthropic Proxy: Invalid content from server"). The same tool calls succeed via direct MCP clients (e.g., Node.js `@modelcontextprotocol/sdk` client, Claude Desktop).

**Affected tools:** `brain_inbox_save`, `brain_inbox` — both return `structuredContent` alongside the standard `content` array.

**Workaround:** Users can still use these tools from Claude Desktop or Claude Code. The Claude.ai connector only fails on the tool response — the tool itself executes successfully (the note is saved).

**Fix options:**
1. Conditionally omit `structuredContent` when the client doesn't advertise MCP Apps support (check client capabilities during initialization)
2. Move `structuredContent` into a separate response path that only activates for MCP Apps-capable clients
3. Wait for Claude.ai to support the MCP Apps extension spec

**Reproduction:** Connect brainstem MCP via Claude.ai connector → invoke `brain_inbox_save` → observe `-32600` error. Same call via `node test-user-mcp.mjs` succeeds.

### Web clipping (bookmarklet / share sheet / iOS Shortcut)

Save web pages to the brain inbox from any browser or mobile app. Requires a `/clip` endpoint with server-side content extraction (Readability.js + Turndown), cookie-based auth for the bookmarklet popup, and an iOS Shortcut for mobile share sheet. Separate build from email input. Research and design in [PRD-002 appendix](prd/002-input-modalities.md#appendix-other-modalities-research).

### X (Twitter) Bookmarks sync

Deferred indefinitely. X API Basic tier costs $200/month, has a 15k tweet/month read quota, 800-bookmark ceiling, and is polling-only. Cost/value ratio is poor. Individual tweets can be saved via the bookmarklet (once built). Revisit if X ships affordable API pricing.

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

### GitHub URL parsing in `get_document`

The `search_brain` tool returns results with full GitHub URLs (e.g., `https://github.com/owner/repo/blob/main/path/to/file.md`) via the `getSourceUrl()` helper (src/index.ts:288-295). However, `get_document` only accepts file paths (src/index.ts:387), not URLs.

**Current workaround:** Users must manually extract the path portion from the GitHub URL.

**Fix:** Add URL parsing to `get_document`:
- Accept both full GitHub URLs and file paths in the `path` parameter
- Parse URLs using regex: `/\/blob\/[^/]+\/(.+)$/` to extract the path after `/blob/{branch}/`
- Fall back to treating input as a direct path if it doesn't match the URL pattern

**Implementation location:** `registerGetDocument()` in src/index.ts:382-432

### Batch document retrieval

`get_document` currently accepts only a single `path` string (src/index.ts:387). When search returns multiple relevant chunks from different files, users need multiple tool calls to retrieve all source documents.

**Fix:** Support batch retrieval:
- Change `path` parameter type to `z.union([z.string(), z.array(z.string())])`
- If array provided, fetch all documents in parallel with `Promise.all()`
- Return array of results with per-document success/error status
- Add reasonable limits (e.g., max 10 documents per call) to prevent abuse

**Alternative:** Create a separate `retrieve_documents` tool for batch operations, keeping `get_document` for single files.

### Retrieval guidance in `search_brain` description

The `search_brain` tool description (src/index.ts:244-283) explains when to use search and what content is available, but doesn't mention that `get_document` exists or when to use it for retrieving full document content.

**Current behavior:** Search returns text chunks with GitHub source links, but doesn't guide Claude to retrieve the full document when a chunk is interesting but incomplete.

**Fix:** Add one sentence to the end of `buildSearchDescription()`:
```typescript
description += `\n\nReturns relevant passages with source document links. For complete document content, use 'get_document' with the filename from search results.`;
```

This helps Claude understand the search → retrieve workflow and when to fetch full context.

### ScopedR2 / ScopedAISearch wrappers

Enforce path prefixes at the API layer so MCP tools can never accidentally access raw `env.R2` or `env.AI` without scoping. Prevents path traversal and cross-tenant access.

### Rate limiting

No rate limiting on any endpoint. OAuth endpoints are vulnerable to brute-force. MCP endpoints could be used for resource exhaustion.

### Observability

Console logging is basic. Would benefit from structured JSON logging, request IDs, error reporting (Sentry), and a metrics dashboard.

### Error response consistency

Error responses mix plain text and JSON. Standardize on `{ "error": "code", "message": "Human readable" }` with correct HTTP status codes.

### UUID-free MCP URL

Users currently need `https://brainstem.cc/mcp/{uuid}` — the UUID is ugly and requires manual copy-paste. The server should resolve the user's installation from their bearer token so Claude.ai users can just give `https://brainstem.cc/mcp`.

**Fix:** On authenticated `/mcp` POST, look up the session's user_id, query installations, and auto-scope to the user's installation. Falls through to generic about-only MCP if unauthenticated. `/mcp/{uuid}` continues working for backward compatibility.

### Self-service onboarding UI

The setup page is minimal. Could add progress indicators, repo selection (for multi-repo), and connection verification.

---

## Done

Items completed in v4.4+:

- **Email input (v5.0):** `brain_account` MCP tool for email forwarding setup. Inbound code verification (MailChannels deprecated — no outbound email). Cloudflare Email Routing catch-all `*@brainstem.cc` → Worker `email()` handler. MIME parsing via postal-mime + Turndown HTML→markdown. Shared `saveToInbox()` extracted to `src/inbox.ts`. `triggerAISearchReindex()` extracted to `src/cloudflare.ts`. D1 tables: `email_aliases`, `verified_senders`, `email_log` (auto-migrated). Rate limiting (50/sender/day, 200/installation/day). Vanity aliases, sub-address routing (`brain+{uuid}@`), sender verification, email cleanup on uninstall. 74 total unit tests (27 new). DO state persistence fix via `this.ctx.storage`. E2E verified. See [ADR-008](adr/008-email-input.md).
- **Tool metadata & prompts (v4.7):** Improved `search_brain` tool description to encourage automatic use — removed "private" framing that caused Claude to hesitate, added semantic triggers (info unlikely in training data, augmenting memory), added common phrase triggers. Added MCP prompts (`brain_search`, `brain_inbox`) as explicit tool invocation fallbacks. Updated `about` tool to document prompts and reinforce tool usage. Server advertises `prompts` capability; Claude Desktop UI support for prompts is pending (prompts work via explicit instruction).
- **Unit test coverage (v4.6):** Added 47 unit tests using Vitest covering extractable business logic: webhook signature verification (HMAC-SHA256, security-critical), file filtering (extension/sensitive file/directory exclusion logic), webhook payload parsing (changed/removed file extraction, deduplication), and title sanitization (inbox filename normalization). Pure functions extracted to `src/utils.ts` for testability (no Workers dependencies). Establishes regression safety net for ADR-005 refactor (ChatGPT App dual distribution). Tests run via `npm test` and `npm run test:watch`.
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
- [ADR-008: Email Input](adr/008-email-input.md)
- [CLAUDE.md](../CLAUDE.md)
