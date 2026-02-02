# ADR-002: Security & Data Isolation

> **Status:** Draft
> **Date:** 2026-01-29
> **Supersedes:** ADR-001 isolation sections (deferred items)
> **Decision:** Migrate from Level 1 (logical) isolation to auth-gated, scoped multi-tenancy

## Context

ADR-001 chose Level 1 (logical isolation) for the MVP, deferring `ScopedR2`, `ScopedAISearch`, and search filtering as "single-user MVP" items. The system now has one real user (the maintainer) and the brain_inbox write tool has exposed how fragile the current model is. Before onboarding additional users, we need to address the security gaps documented below.

## Current State (as of 2026-01-29)

### What works
- GitHub App webhook sync (push → R2 + reindex)
- Per-installation MCP endpoints (`/mcp/{uuid}`) with auth on `brainstem.cc`
- OAuth flow producing bearer tokens with 30-day expiry
- 6 MCP tools (about, search_brain, get_document, list_recent, list_folders, brain_inbox)
- brain_inbox tool writes to both R2 and GitHub repo

### What's broken or insecure

#### 1. Legacy `/mcp` endpoint — unauthenticated, unscoped
The legacy endpoint at `/mcp` (no UUID) requires no authentication on either domain. It sets `r2Prefix = ""`, meaning all R2 operations access the **root of the bucket**, which contains every user's files (due to dual-write — see #3). Any MCP client connecting to this endpoint can read all data.

#### 2. `/mcp/{uuid}` on workers.dev — unauthenticated
The `workers.dev` domain skips auth entirely (`requireAuth = hostname === "brainstem.cc"`). Anyone with an installation UUID can connect and read that installation's data without a token. UUIDs are not secret — they appear in URLs, logs, and setup pages.

#### 3. Dual-write to root
Every file sync writes to **two locations**:
- `brains/{uuid}/{path}` — scoped per installation
- `{path}` — root of the R2 bucket (for AI Search indexing)

This means the root of R2 contains a merged, unscoped copy of every user's files. The legacy `/mcp` endpoint reads from root, giving access to everything.

#### 4. AI Search — single shared index, no filtering
One AI Search instance (`home-brain-search`) indexes the entire R2 bucket. The `search_brain` tool queries it without any installation or user filter. All users' documents appear in all users' search results.

#### 5. Debug and doc endpoints — unauthenticated
| Endpoint | Risk |
|----------|------|
| `/debug/status/{uuid}` | Exposes installation details, file counts, webhook logs |
| `/debug/webhooks` | Exposes all webhook history |
| `/debug/reindex` | Triggers reindex (write operation) |
| `/debug/sync/{uuid}` | Triggers full repo sync (write operation) |
| `/debug/sync-file/{uuid}` | Syncs arbitrary file (write operation) |
| `/debug/webhook-test` | Exposes webhook secret prefix |
| `/doc/{path}` | Direct file access from R2, no auth |

#### 6. Inbox tool — GitHub write requires per-user context
The brain_inbox tool only writes to GitHub when `repoFullName` and `r2Prefix` are set, which requires connecting via `/mcp/{uuid}` (not legacy `/mcp`). Users on the legacy endpoint get R2-only writes with no error surfaced.

## Threat Model

| Threat | Current Status | Severity |
|--------|---------------|----------|
| **Search leakage** — User A's search returns User B's docs | Vulnerable (shared index, no filtering) | Critical |
| **Direct read** — unauthenticated access to any file | Vulnerable (legacy `/mcp`, `/doc/{path}`) | Critical |
| **Debug abuse** — trigger syncs, read logs without auth | Vulnerable (all debug endpoints open) | High |
| **UUID enumeration** — guess installation IDs | Mitigated (UUIDs are random), but no auth on workers.dev | Medium |
| **Path traversal** — `../` to escape R2 prefix | Mitigated (R2 prefix is prepended, `../` doesn't traverse R2 keys) | Low |
| **Write abuse** — brain_inbox tool creates files in wrong repo | Mitigated (GitHub write requires valid installation token) | Low |

## Decision

Adopt a phased approach moving from the current state to fully isolated multi-tenancy. Each phase is independently deployable and improves security incrementally.

---

## Phase 0: Immediate Fixes (deploy now)

Low-risk changes that close the worst gaps without architectural changes.

### 0a. Auth-gate debug endpoints
Add bearer token validation to all `/debug/*` routes. Only allow authenticated users to access their own installation's debug info.

### 0b. Auth-gate `/doc/{path}`
Require authentication, scope to the user's installation prefix.

### 0c. Remove legacy `/mcp` endpoint
Stop serving the unscoped, unauthenticated legacy endpoint. All MCP connections must use `/mcp/{uuid}`. Update CLAUDE.md and any client configs.

### 0d. Remove diagnostic messages from brain_inbox tool
The `(synced to GitHub)` / `(skipped GitHub ...)` diagnostic text in the inbox response was added for debugging. Remove it once the GitHub write is confirmed working — tool responses should be clean for end users.

## Phase 1: Auth Everywhere

### 1a. Require auth on workers.dev `/mcp/{uuid}`
Remove the `requireAuth = hostname === "brainstem.cc"` conditional. All `/mcp/{uuid}` requests require a bearer token regardless of domain.

### 1b. Deprecate workers.dev domain
Update documentation and client configs to use `brainstem.cc` exclusively. Set a deprecation date for the workers.dev domain. Eventually remove the custom domain from wrangler.toml or redirect workers.dev to brainstem.cc.

### 1c. Stop dual-write to root
Remove the second `R2.put()` call that writes to root. Files should only exist at `brains/{uuid}/{path}`. This eliminates the unscoped data copy.

**Dependency:** Phase 2 must be in progress — AI Search needs to index from prefixed paths, not root.

## Phase 2: Search Isolation

The biggest architectural gap. Two options:

### Option A: Per-installation AI Search instances (preferred)
Create a dedicated AI Search instance per installation, pointing at that installation's R2 prefix (`brains/{uuid}/`).

**Pros:**
- True isolation — impossible to leak across tenants
- Each instance indexes only its own data
- No filtering logic to get wrong

**Cons:**
- Need to check Cloudflare limits on AI Search instances per account
- Dynamic provisioning via API (need to verify this is supported)
- More instances = more cost

**Implementation:**
1. On installation creation, call AI Search API to create instance with R2 prefix
2. Store instance name in `installations` table (new column: `autorag_instance`)
3. `search_brain` tool uses `this.env.AI.autorag(installation.autorag_instance)` instead of shared instance
4. Migrate existing installation: create new instance, reindex, switch over

### Option B: Metadata filtering on shared instance (fallback)
Keep one AI Search instance but add `installation_id` metadata to every indexed document and filter at query time.

**Pros:**
- No new instances to manage
- Simpler infrastructure

**Cons:**
- Must verify AI Search supports pre-filter (not post-filter) metadata queries
- One bug in filter logic = data leak
- All data still in one index

**Implementation:**
1. Add `installation_id` metadata during indexing
2. Wrap all search calls in `ScopedAISearch` that always adds filter
3. Verify filtering works correctly with cross-tenant test

### Decision
Investigate Option A first. If Cloudflare limits prevent per-installation instances, fall back to Option B with mandatory `ScopedAISearch` wrapper.

## Phase 3: Scoped Access Wrappers

Implement the `ScopedR2` and `ScopedAISearch` wrappers designed in ADR-001 but never built.

### ScopedR2
```typescript
class ScopedR2 {
  constructor(private r2: R2Bucket, private prefix: string) {}

  private scope(path: string): string {
    const safe = path.replace(/\.\./g, '').replace(/^\/+/, '');
    return `${this.prefix}${safe}`;
  }

  get(path: string) { return this.r2.get(this.scope(path)); }
  put(path: string, value: ReadableStream | string | ArrayBuffer) {
    return this.r2.put(this.scope(path), value);
  }
  list(options?: R2ListOptions) {
    return this.r2.list({ ...options, prefix: this.prefix });
  }
}
```

### ScopedAISearch
```typescript
class ScopedAISearch {
  constructor(
    private ai: Ai,
    private instanceName: string // per-installation instance
  ) {}

  search(query: string, maxResults: number) {
    return this.ai.autorag(this.instanceName).search({
      query,
      max_num_results: maxResults,
    });
  }
}
```

### Integration
- `HomeBrainMCP.init()` creates scoped instances from installation context
- All tools receive scoped wrappers, never raw `env.R2` or `env.AI`
- Raw access to `env.R2` and `env.AI` only in worker-level code (webhook sync, setup)

---

## Migration Checklist

### Phase 0 (Immediate) — Done (2026-01-29)
- [x] Auth-gate `/debug/*` endpoints — bearer token + ownership checks
- [x] Remove `/doc/{path}` endpoint entirely
- [x] Remove legacy `/mcp` endpoint (catch-all → 404)
- [x] Clean up brain_inbox tool diagnostic messages (simplified response text)

### Phase 1 (Auth Everywhere) — Done (2026-01-29)
- [x] Require auth on all domains — `workers_dev = false`, `requireAuth = true` always
- [x] Update all documentation to use `brainstem.cc`
- [x] Update test scripts to use auth'd endpoint (`test-user-mcp.mjs`)
- [x] workers.dev disabled entirely (not just deprecated)

### Phase 2 (Search Isolation) — Partially done (2026-01-29)
- [x] Research: AI Search supports folder metadata filtering (pre-filter via `gt`/`lte`)
- [x] Implement folder filtering in `search_brain` tool
- [x] Stop dual-write to root (all 3 locations + debug sync-file)
- [x] Clean up root R2 files (168 objects deleted via temporary endpoint)
- [ ] Verify cross-tenant isolation with multiple installations (untested)

### Phase 3 (Scoped Wrappers) — Not started
- [ ] Implement `ScopedR2`
- [ ] Implement `ScopedAISearch`
- [ ] Refactor all MCP tools to use scoped access
- [ ] Add cross-tenant isolation test

## Verification

After each phase, run:
1. **Cross-tenant test** — create two installations, verify no data leakage via search, get_document, list_folders
2. **Auth test** — verify unauthenticated requests are rejected on all endpoints
3. **brain_inbox e2e test** — verify R2 write + GitHub write both succeed from authenticated `/mcp/{uuid}` endpoint

## References

- ADR-001: GitHub App for Private Repository Access (isolation sections)
- [Cloudflare AI Search docs](https://developers.cloudflare.com/ai-search/)
- [R2 API reference](https://developers.cloudflare.com/r2/api/)
