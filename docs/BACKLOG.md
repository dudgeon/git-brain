# Product Backlog

**Last updated:** 2026-02-09

---

## Critical — Blocking core functionality

*(No critical items)*

---

## High — Security & correctness

### ~~User data encryption at rest~~ → [ADR-003](adr/003-encryption-at-rest.md)

Decided: R2 already encrypts at rest (Cloudflare-managed AES-256-GCM). Application-layer encryption is incompatible with AI Search (which reads R2 directly) and any scheme where the Worker holds keys doesn't protect against the operator. Phase 1: document trust model and add disclosures (done). Phase 2: per-user R2 + AI Search instances for hard tenant isolation. Phase 3 (aspirational): BYOA model for true operator-blindness.

### Multi-tenant readiness

The GitHub App (`git-brain-stem`) was made public on 2026-02-09. Any GitHub user can now install it. The onboarding flow (setup → callback → initial sync → OAuth → MCP) works for new users, but multi-tenant correctness has never been verified end-to-end.

**Done:** GitHub App visibility set to public.

**Remaining:**
- Verify AI Search tenant isolation (see below)
- Verify onboarding flow produces a fully working installation for a non-owner user
- Verify account deletion (uninstall webhook) cleans up a non-owner user's data correctly
- Confirm no hardcoded assumptions about single-tenant usage in the codebase

### ~~Verify AI Search tenant isolation~~ ✅ VERIFIED (2026-02-10)

Search queries use folder metadata filters (`gt`/`lte` on folder path) for cross-tenant isolation. Verified with two live installations:
- **Installation A** (`dudgeon/home-brain`): 260 files, searches return results for "family", "Alina", "brainstem project"
- **Installation B** (`clawdbot-dudgeon/test-repo`): 0 files (empty repo)
- **Test:** Searched from installation B for queries that only exist in A's data → all returned "No results found"
- **R2 isolation also verified:** `list_recent` and `list_folders` from B returned empty
- **Debug endpoint ownership:** `/debug/status/{B's uuid}` returns 403 when accessed with A's token

**Remaining gap:** This test used an empty installation B. A stronger test would populate B with distinct content and verify bidirectional isolation (A can't see B's data AND B can't see A's data). Current test only proves unidirectional isolation (B can't see A).

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

### ~~Claude.ai MCP proxy `-32600` error~~ ✅ FIXED (ADR-009)

Root cause: server used legacy SSE transport (`serveSSE`) while Claude.ai's proxy expects Streamable HTTP. Fix: switched to `HomeBrainMCP.serve("/mcp")` for Streamable HTTP transport. Also cleaned up tool definitions (conditional MCP Apps upgrade via `RegisteredTool.update()`, stripped SDK `execution` field). See [ADR-009](adr/009-mcp-apps-compatibility.md).

### ~~Web clipping (bookmarklet / share sheet / iOS Shortcut)~~ ✅ DONE (v5.2)

`POST /api/clip` REST endpoint with CORS support. Self-contained bookmarklet bundles `@mozilla/readability` + `turndown` (~45KB IIFE) for client-side article extraction and HTML→markdown conversion, with `prompt()` for optional context notes. URL-only bookmark fallback for iOS Shortcuts. Delivered on OAuth success page and dedicated `/bookmarklet` page.

### X (Twitter) Bookmarks sync

Deferred indefinitely. X API Basic tier costs $200/month, has a 15k tweet/month read quota, 800-bookmark ceiling, and is polling-only. Cost/value ratio is poor. Individual tweets can be saved via the bookmarklet. Revisit if X ships affordable API pricing.

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

### Latent Turndown bug in email handler

`emailToMarkdown()` in `src/email.ts:186-191` calls `turndown.turndown(email.html)` which requires browser DOM (`document`). Workers don't have `document`, so this will throw `document not defined` for HTML-only emails (no plaintext body). Currently latent because `email.text` path wins for all tested emails. **Fix:** Either strip HTML tags with a simple regex for email (acceptable quality), or use a DOM-less HTML parser.

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

- **Web clipping (v5.2):** `POST /api/clip` REST endpoint with CORS for cross-origin bookmarklet requests. Self-contained bookmarklet bundles `@mozilla/readability` + `turndown` (~45KB minified IIFE) for client-side article extraction and HTML→markdown conversion. `prompt()` dialog for optional context notes stored in YAML frontmatter. URL-only bookmark fallback for iOS Shortcuts. Bookmarklet delivered on OAuth success page and dedicated `/bookmarklet` page. Vite IIFE build pipeline at `ui/bookmarklet/`. 81 total unit tests (7 new for clip frontmatter).
- **Claude.ai proxy fix (ADR-009):** All MCP tools failed through Claude.ai's proxy with `-32600`. Root cause: server used legacy SSE transport (`serveSSE`) while Claude.ai expects Streamable HTTP. Fixed by switching to `HomeBrainMCP.serve("/mcp")`. Also replaced `registerAppTool` with standard `server.registerTool()` + conditional upgrade via `RegisteredTool.update()` after MCP handshake (keeps MCP Apps UI for Claude Desktop). Stripped SDK-injected `execution` field from tool definitions. See [ADR-009](adr/009-mcp-apps-compatibility.md).
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
- [ADR-009: MCP Apps Compatibility](adr/009-mcp-apps-compatibility.md)
- [CLAUDE.md](../CLAUDE.md)
