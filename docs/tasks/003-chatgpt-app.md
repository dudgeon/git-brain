# Tasks: ChatGPT App Directory Submission

**Related**: [ADR-004](../adr/004-chatgpt-app.md) (gap analysis), [ADR-005](../adr/005-chatgpt-app.md) (shared tool core)
**Last updated**: 2026-02-16

This is a multi-session build. Phase 1 (code changes) is done. Remaining phases are mostly manual (account setup, testing, submission).

---

## Phase 1: Tool Metadata, Privacy, OAuth — ✅ DONE (2026-02-16)

**Goal**: MCP server passes ChatGPT App submission requirements for tool annotations, privacy policy, and auth compatibility.

- [x] **1.1** Add MCP tool annotations to all 8 tools
  - `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint` on every tool
  - Read-only tools: `about`, `search_brain`, `get_document`, `list_recent`, `list_folders`, `brain_inbox`
  - Write tools: `brain_inbox_save`, `brain_account` (`openWorldHint: true`)
  - Verified: annotations appear in `test-user-mcp.mjs` output

- [x] **1.2** Audit tool response shapes — strip internal data
  - Fixed `search_brain`: was leaking `brains/{uuid}/` R2 prefix in filenames and GitHub URLs
  - Now strips `this.r2Prefix` from `r.filename` before display and URL construction
  - Other tools already clean (list_recent, list_folders strip prefix; inbox returns relative paths)

- [x] **1.3** Tighten tool descriptions for submission compliance
  - Removed model-manipulation language from `brain_account` (`IMPORTANT: call IMMEDIATELY`, `Do NOT search`)
  - Removed overly-broad triggering from `search_brain` (`do not hesitate to search`)
  - Updated `about` tool output: platform-neutral ("AI assistants" not "Claude"), removed prompts section
  - All descriptions: clear, specific, no promotional or comparative language

- [x] **1.4** Create privacy policy page at `/privacy`
  - Full HTML page using `SITE_STYLES` at `https://brainstem.cc/privacy`
  - Covers: data collected, purposes, infrastructure, sharing, retention/deletion, user controls, children, contact
  - Contact: `privacy@brainstem.cc`
  - Linked from homepage footer
  - `site/content.md` updated with privacy page content

- [x] **1.5** Verify OAuth compatibility with ChatGPT
  - DCR (`/oauth/register`): accepts any `redirect_uris` — ChatGPT's URIs will work
  - PKCE S256: already implemented
  - Added `scopes_supported: []` to `/.well-known/oauth-protected-resource`
  - `resource` parameter: ChatGPT sends it; our server ignores it (single-resource, functionally correct)
  - Auth server metadata already includes `registration_endpoint`, `code_challenge_methods_supported`

- [x] **1.6** Deploy and verify
  - `npm run typecheck` ✅
  - `npm run deploy` ✅
  - `node test-user-mcp.mjs` ✅ — all 8 tools with annotations visible
  - `curl https://brainstem.cc/privacy` → 200 ✅
  - Search result path stripping verified via live MCP call ✅

**Verification**: Deployed to production. All tools show annotations. Privacy page live. Search results no longer leak internal UUIDs.

---

## Phase 2: Reviewer Demo Account

**Goal**: Pre-provisioned installation with sample data that OpenAI reviewers can use without GitHub App installation.

- [ ] **2.1** Create a dedicated demo GitHub repo
  - Public repo with representative sample content (markdown notes, folder structure)
  - ~20-30 files across 3-4 domains to demonstrate search, browsing, retrieval
  - No real personal data — use fictional/example content
  - Repo name: `dudgeon/brainstem-demo` or similar

- [ ] **2.2** Install Brainstem GitHub App on demo repo
  - Create a new installation via `/setup`
  - Verify initial sync completes and content is searchable
  - Note the installation UUID

- [ ] **2.3** Create long-lived demo session
  - OAuth to get a session token for the demo installation
  - Extend expiry if needed (or document the token refresh process)
  - Test all 8 tools work against the demo installation

- [ ] **2.4** Document reviewer test instructions
  - Clear step-by-step for: connect MCP URL, authenticate, test each tool
  - Include the demo MCP URL and bearer token
  - Note which tools are read-only vs write (annotations convey this, but be explicit)

**Verification**: Reviewer can connect to the demo MCP endpoint and successfully use all tools.

---

## Phase 3: OpenAI Account Setup (Manual)

**Goal**: Verified OpenAI Platform account ready for app submission.

- [ ] **3.1** Create OpenAI Platform account
  - Sign up at platform.openai.com
  - Must be Owner role in the submitting organization

- [ ] **3.2** Verify developer identity
  - Complete identity verification in OpenAI Platform Dashboard
  - Required before any app submission

- [ ] **3.3** Create project with global data residency
  - Our Cloudflare Worker runs globally — this satisfies the requirement
  - EU-only projects can't submit apps

- [ ] **3.4** Set up customer support contact
  - Use `support@brainstem.cc` or `privacy@brainstem.cc`
  - Must be current and responsive

---

## Phase 4: Developer Mode Testing

**Goal**: End-to-end verification that Brainstem works as a ChatGPT App in developer mode.

- [ ] **4.1** Connect in ChatGPT developer mode
  - Settings → Developer mode → Add MCP server
  - Use the production MCP URL: `https://brainstem.cc/mcp/{uuid}`
  - Verify OAuth flow completes (DCR → authorize → callback → token exchange)

- [ ] **4.2** Test all tools in ChatGPT
  - `about` — returns Brainstem info
  - `search_brain` — semantic search returns results
  - `get_document` — retrieves full document
  - `list_recent` — lists files
  - `list_folders` — browses folders
  - `brain_inbox` — returns draft (no UI in ChatGPT)
  - `brain_inbox_save` — saves note to R2 + GitHub
  - `brain_account` — shows email config status

- [ ] **4.3** Test on mobile ChatGPT app
  - Submission guidelines require testing on both web and mobile
  - Verify tools work on iOS/Android ChatGPT

- [ ] **4.4** Test confirmation dialogs for write actions
  - ChatGPT shows confirmation for non-read-only tools
  - Verify `brain_inbox_save` and `brain_account` trigger confirmation
  - Verify read-only tools execute without confirmation

- [ ] **4.5** Document any issues or incompatibilities
  - Note differences from Claude MCP behavior
  - File bugs if any tools fail

---

## Phase 5: Submission

**Goal**: App submitted and accepted into the ChatGPT App Directory.

- [ ] **5.1** Prepare listing metadata
  - App name: "Brainstem" (or "Brainstem - Personal Knowledge Base")
  - Short description (≤80 chars): "Search and manage your personal knowledge base from GitHub"
  - Long description: Expand on features, how it works, what tools are available
  - Category/tags: productivity, knowledge management, personal assistant
  - Icon: brain emoji or custom logo (check required dimensions)
  - Screenshots: capture actual ChatGPT usage showing search results, document retrieval

- [ ] **5.2** Prepare submission fields
  - MCP server URL: `https://brainstem.cc/mcp/{demo-uuid}`
  - OAuth metadata: auto-discovered via `/.well-known/oauth-authorization-server`
  - Privacy policy URL: `https://brainstem.cc/privacy`
  - Customer support contact
  - Test credentials (demo bearer token + instructions from Phase 2)

- [ ] **5.3** Submit for review
  - Fill all required fields in OpenAI submission UI
  - Attach test credentials and instructions
  - Confirm policy compliance

- [ ] **5.4** Handle rejection feedback
  - Common rejection reasons: incorrect annotations, unclear descriptions, auth issues
  - Fix and resubmit (no code freeze — tool definitions lock only after *publication*, not submission)

**Verification**: App appears in the ChatGPT App Directory.

---

## Phase 6: Post-Approval

**Goal**: Published app monitored and maintained.

- [ ] **6.1** Publish the app
  - Click Publish in OpenAI dashboard when approved

- [ ] **6.2** Monitor for issues
  - Watch for auth failures, tool errors, latency under ChatGPT traffic patterns
  - Check if multi-tenant isolation holds under wider use

- [ ] **6.3** Refresh tool schemas if needed
  - After publishing, tool updates require "Refresh" in app settings
  - Major changes (new tools, schema changes) require resubmission

---

## Key Decisions and Context for Future Sessions

### Tool annotations rationale
- `brain_inbox` marked `readOnlyHint: true` because it only returns a draft — it does NOT save. The MCP Apps composer UI calls `brain_inbox_save` separately.
- `brain_inbox_save` and `brain_account` are the only write tools (`openWorldHint: true`).
- `idempotentHint: true` on all read tools (safe to retry). `false` on write tools (each call creates a new note / modifies state).

### Description changes and their implications
- Removing `IMPORTANT: call IMMEDIATELY` from `brain_account` may reduce tool selection accuracy when users ask about email in Claude. If this causes regression, we can restore assertive language for the Claude-specific MCP config while keeping the ChatGPT-facing description clean. Tool descriptions are the same across all clients currently (single codebase), but ADR-005's shared-core extraction would enable per-adapter description overrides.
- The `about` tool response no longer mentions prompts/slash commands or Claude-specific instructions. This is intentional for platform neutrality.

### OAuth compatibility notes
- ChatGPT sends a `resource` parameter in OAuth requests. Our server ignores it (single-resource server). If we later support multiple resources, we'd need to validate `resource` and issue audience-scoped tokens.
- ChatGPT's redirect URIs (`chatgpt.com/connector_platform_oauth_redirect` and `platform.openai.com/apps-manage/oauth`) are accepted by our DCR endpoint because we don't restrict registered redirect URIs.
- No `refresh_token` support yet (backlog item). ChatGPT docs don't mandate it, but it's recommended. Sessions last 1 year.

### ADR-005 refactor (deferred)
- The shared tool core extraction (ADR-005) was **not** done as part of Phase 1. It's good engineering but wasn't required for submission. The existing monolithic `src/index.ts` serves both Claude and ChatGPT via the same MCP endpoint.
- If per-platform description overrides become needed (e.g., assertive `brain_account` description for Claude, neutral for ChatGPT), that's when ADR-005 becomes worth doing.

### Search result path fix
- Before this work, `search_brain` results showed `brains/{uuid}/domains/family/README.md` as the filename — leaking the internal R2 prefix and installation UUID. Now stripped to `domains/family/README.md`.
- The `getSourceUrl()` helper was also building wrong GitHub URLs (including the R2 prefix in the path). Now receives the clean display path.
