# ADR-001: GitHub App for Private Repository Access

> **Status:** ✅ Implemented
> **Date:** 2025-01-22
> **Implemented:** 2026-01-23
> **Decision:** Use GitHub App for git-brain to access private repositories

## Context and Problem Statement

git-brain exposes private GitHub repositories as searchable knowledge bases via MCP. Currently, syncing content from the source repo (`home-brain`) to R2 storage requires:

1. GitHub Actions workflow in the source repo (`sync-to-r2.yml`)
2. R2 credentials stored as secrets in the source repo
3. Manual setup by the repo owner

This creates friction and requires users to understand GitHub Actions, secrets management, and R2 configuration.

**Goal:** Make git-brain a turnkey service where users simply point it at a repo and it "just works" - no GitHub Actions, secrets, or manual setup required in the source repo.

## Decision Drivers

1. **Zero setup in source repo** - Users shouldn't need to add workflows or secrets
2. **Private repo access** - Must work with private repositories
3. **Automatic sync** - Content should update when the repo changes
4. **Scalable to multiple users** - Architecture should support multi-tenancy
5. **Security** - Minimal permissions, revocable access

## Considered Options

### Option 1: GitHub App (Recommended)

A GitHub App is a first-class integration that users install on their repositories.

**Pros:**
- Granular permissions (read-only access to specific repos)
- Webhook support (automatic sync on push)
- Per-installation tokens (not tied to a user)
- Professional appearance in GitHub UI
- Can be listed in GitHub Marketplace
- Revocable per-repo

**Cons:**
- More complex initial setup (create app, handle webhooks)
- Requires hosting webhook endpoint
- App installation flow requires user interaction

### Option 2: GitHub OAuth (User Token)

User authorizes git-brain via OAuth, granting access to their repos.

**Pros:**
- Simpler to implement than GitHub App
- Familiar OAuth flow

**Cons:**
- Token tied to user (if user leaves org, access breaks)
- Broader permissions (all repos user can access)
- No webhooks (must poll for changes)
- Token expiration handling

### Option 3: Personal Access Token (PAT)

User manually creates and provides a PAT.

**Pros:**
- Simplest implementation
- No OAuth flow needed

**Cons:**
- Poor UX (user must create token manually)
- Security risk (tokens often over-scoped)
- No webhooks
- Tokens can expire or be revoked without notification
- Doesn't scale to multiple users

## Decision Outcome

**Chosen option: GitHub App**

The GitHub App approach best supports the goal of making git-brain a turnkey service. Users install the app on their repo with a few clicks, and git-brain handles everything else.

**Critical constraint:** Multi-tenancy requires data isolation. See dedicated section below. We must resolve AI Search isolation strategy before implementing multi-user support.

---

## Detailed Onboarding Flow

### Prerequisites (One-time setup by git-brain maintainer)

1. **Create GitHub App** at github.com/settings/apps/new
   - Name: `Git Brain` or `git-brain-sync`
   - Homepage URL: `https://git-brain.dev` (or worker URL)
   - Webhook URL: `https://home-brain-mcp.dudgeon.workers.dev/webhook/github`
   - Webhook secret: Generate and store as Cloudflare secret
   - Permissions:
     - Repository contents: **Read-only** (to read files)
     - Metadata: **Read-only** (required for all apps)
   - Subscribe to events:
     - `push` (to trigger sync on changes)
     - `installation` (to know when app is installed/uninstalled)
   - Where can this app be installed: **Any account** (for public) or **Only on this account** (for private beta)

2. **Generate private key** for the app (download `.pem` file)

3. **Store secrets in Cloudflare**
   ```bash
   wrangler secret put GITHUB_APP_ID
   wrangler secret put GITHUB_APP_PRIVATE_KEY  # Contents of .pem file
   wrangler secret put GITHUB_WEBHOOK_SECRET
   ```

### User Onboarding Flow (Step-by-Step)

**Step 1: User visits git-brain setup page**
```
https://home-brain-mcp.dudgeon.workers.dev/setup
```

This page explains git-brain and has a button: **"Connect Your Repository"**

**Step 2: User clicks "Connect Your Repository"**

Redirects to GitHub App installation:
```
https://github.com/apps/git-brain/installations/new
```

**Step 3: User selects repository**

GitHub shows standard app installation UI:
- User selects their account/org
- User chooses which repo(s) to grant access
- User clicks "Install"

**Step 4: GitHub redirects back to git-brain**

GitHub redirects to:
```
https://home-brain-mcp.dudgeon.workers.dev/setup/callback?installation_id=12345&setup_action=install
```

**Step 5: git-brain provisions user's brain**

Backend automatically:
1. Stores installation ID and repo info in Durable Objects or D1
2. Creates R2 prefix for user's content (e.g., `brains/{installation_id}/`)
3. Fetches initial repo contents via GitHub API
4. Uploads files to R2 under user's prefix
5. Triggers AI Search indexing

**Step 6: User receives their MCP endpoint**

Setup page shows:
```
✅ Connected: dudgeon/home-brain

Your MCP endpoint:
https://home-brain-mcp.dudgeon.workers.dev/mcp/{installation_id}

Add to Claude Code:
{
  "mcpServers": {
    "my-brain": {
      "url": "https://home-brain-mcp.dudgeon.workers.dev/mcp/{installation_id}"
    }
  }
}
```

**Step 7: Ongoing sync via webhooks**

When user pushes to their repo:
1. GitHub sends `push` webhook to `/webhook/github`
2. git-brain verifies webhook signature
3. git-brain fetches changed files via GitHub API
4. git-brain updates R2 content
5. AI Search re-indexes automatically

---

## Technical Implementation Details

### New Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/setup` | GET | Onboarding landing page |
| `/setup/callback` | GET | GitHub App installation callback |
| `/webhook/github` | POST | GitHub webhook receiver |
| `/mcp/{installation_id}` | GET | Per-user MCP endpoint (SSE) |

### Data Model

```typescript
interface Installation {
  id: string;                    // GitHub installation ID
  accountLogin: string;          // GitHub username or org
  accountType: 'User' | 'Organization';
  repos: Array<{
    id: number;
    name: string;
    fullName: string;            // e.g., "dudgeon/home-brain"
    private: boolean;
  }>;
  r2Prefix: string;              // e.g., "brains/12345/"
  createdAt: string;
  lastSyncAt: string;
}
```

### Storage Strategy

**Option A: Shared R2 bucket with prefixes (Recommended for MVP)**
- Single R2 bucket: `git-brain-store`
- Per-user prefix: `brains/{installation_id}/`
- Simpler to manage, but all data in one bucket

**Option B: Per-user R2 buckets**
- Separate bucket per user
- Better isolation, but harder to manage programmatically
- R2 has limits on bucket creation

### AI Search Consideration

Current setup uses a single AI Search instance (`home-brain-search`). For multi-tenant:

**Option A: Single AI Search with metadata filtering (Chosen for MVP)**
- All content in one index
- Filter by `installation_id` metadata at query time
- Simpler, faster to implement
- Requires disciplined use of ScopedAISearch wrapper

**Option B: Per-user AI Search instances (Future)**
- Complete isolation - impossible to leak data across tenants
- More complex to manage (dynamic instance creation)
- Consider for enterprise tier or if security requirements increase

See **Multi-Tenancy & Data Isolation** section below for implementation details.

---

## Multi-Tenancy & Data Isolation

This section addresses how to prevent User A from seeing User B's brain content.

### Threat Model

| Threat | Description | Severity |
|--------|-------------|----------|
| Search leakage | User A's search returns User B's documents | **Critical** |
| Path traversal | Malicious path accesses another user's R2 prefix | High |
| ID enumeration | Attacker guesses installation IDs to access others' brains | High |
| API confusion | Code bug forgets to scope query to correct user | **Critical** |

### Isolation Strategies

#### Level 1: Logical Isolation (Weakest)
- Single R2 bucket, single AI Search instance
- Separate by `installation_id` in queries and paths
- **Pros:** Simplest, cheapest
- **Cons:** Single bug = data leak. Security depends on every code path being correct.

#### Level 2: Resource Isolation (Recommended)
- **R2:** Single bucket with prefixes (acceptable - R2 paths are explicit)
- **AI Search:** Per-user instances (critical - search is where leaks happen)
- **Durable Objects:** Per-installation DO (already planned)
- **Pros:** Impossible to accidentally query wrong AI Search instance
- **Cons:** More complex provisioning, potential cost increase

#### Level 3: Infrastructure Isolation (Overkill for MVP)
- Separate R2 buckets per user
- Separate Workers per user
- **Pros:** Complete blast radius containment
- **Cons:** Massive operational complexity, doesn't scale

### Chosen Approach (MVP)

**Use Level 1 (Logical Isolation) for MVP:**
- Simpler, faster to implement
- Acceptable risk for initial rollout with controlled user base
- Can upgrade to Level 2 later if needed

**Implementation specifics:**

1. **R2 Storage: Shared bucket with prefixes**
   - Prefix: `brains/{installation_id}/`
   - Installation ID: Use UUID v4 (not sequential integers)
   - All R2 operations go through prefix-enforcing helper

2. **AI Search: Single instance with mandatory filtering**
   - Use `ScopedAISearch` wrapper class (see below)
   - Filter by `installation_id` on every query
   - Store `installation_id` as document metadata during indexing

3. **MCP Endpoints: Per-installation Durable Objects**
   - DO ID derived from installation ID
   - DO instantiated with its installation context

4. **Installation IDs: Cryptographically random**
   - Use UUID v4: `crypto.randomUUID()`

```typescript
// ScopedAISearch wrapper - ALWAYS use this, never raw AI Search
class ScopedAISearch {
  constructor(private ai: Ai, private installationId: string, private autoragName: string) {}

  async search(query: string, limit: number = 5) {
    return this.ai.autorag(this.autoragName).search({
      query,
      max_num_results: limit,
      filter: { installation_id: this.installationId }
    });
  }
}
```

```typescript
// ScopedR2 wrapper - enforces prefix on all operations
class ScopedR2 {
  constructor(private r2: R2Bucket, private installationId: string) {}

  private getPath(path: string): string {
    // Sanitize and prefix
    const sanitized = path.replace(/\.\./g, '').replace(/^\/+/, '');
    return `brains/${this.installationId}/${sanitized}`;
  }

  get(path: string) { return this.r2.get(this.getPath(path)); }
  put(path: string, value: any) { return this.r2.put(this.getPath(path), value); }
  delete(path: string) { return this.r2.delete(this.getPath(path)); }
  list(options?: R2ListOptions) {
    return this.r2.list({ ...options, prefix: `brains/${this.installationId}/` });
  }
}
```

---

### Level 2 Details (Future Reference)

1. **R2 Storage: Shared bucket with prefixes** (same as Level 1)
   - Prefix: `brains/{installation_id}/`
   - Installation ID: Use UUID v4 (not sequential integers)
   - All R2 operations MUST go through a helper that enforces prefix:
   ```typescript
   // GOOD - enforced prefix
   async getDocument(installationId: string, path: string) {
     const safePath = `brains/${installationId}/${sanitize(path)}`;
     return this.env.R2.get(safePath);
   }

   // BAD - raw R2 access allows mistakes
   this.env.R2.get(userProvidedPath); // Never do this
   ```

2. **AI Search: Per-installation instances**
   - Create AI Search instance when installation is provisioned
   - Instance name: `brain-{installation_id}`
   - Store instance name in installation record
   - **Critical:** The installation's AI Search instance is the ONLY one it can query
   ```typescript
   // Each installation has its own AI Search binding
   const aiSearch = await getAISearchForInstallation(installationId);
   const results = await aiSearch.search({ query });
   // Impossible to accidentally query another user's instance
   ```

3. **MCP Endpoints: Per-installation Durable Objects**
   - DO ID derived from installation ID
   - DO only has access to its own installation's data
   - Isolation enforced at the DO boundary

4. **Installation IDs: Cryptographically random**
   - Use UUID v4: `crypto.randomUUID()`
   - Never sequential integers
   - Not derived from user-visible data (GitHub username, repo name)
   - Example: `550e8400-e29b-41d4-a716-446655440000`

### AI Search Multi-Tenancy: Implementation Options

**Option A: Dynamic AI Search instances (Recommended)**
```typescript
// On installation creation
async function provisionBrain(installationId: string) {
  // Create dedicated AI Search instance via API
  const aiSearchInstance = await createAISearchInstance({
    name: `brain-${installationId}`,
    r2Bucket: 'git-brain-store',
    r2Prefix: `brains/${installationId}/`
  });

  // Store instance reference
  await db.installations.update(installationId, {
    aiSearchInstance: aiSearchInstance.name
  });
}
```

**Option B: Single instance with MANDATORY filtering (Fallback)**

If per-user AI Search instances aren't feasible (API limits, cost), use aggressive safeguards:

```typescript
// Wrapper that ALWAYS adds installation filter
class ScopedAISearch {
  constructor(private ai: Ai, private installationId: string) {}

  async search(query: string) {
    // Filter is architecturally required - can't be forgotten
    return this.ai.autorag('git-brain-search').search({
      query,
      filter: { installation_id: this.installationId } // ALWAYS present
    });
  }
}

// Usage - impossible to search without scope
const search = new ScopedAISearch(env.AI, installationId);
const results = await search.search(userQuery);
```

**Important:** Before using Option B, we must verify:
- [ ] AI Search supports metadata filtering
- [ ] Filter is applied BEFORE vector search (not post-filter)
- [ ] Filter cannot be bypassed by query injection

### Verification & Testing

Before launch, implement these tests:

1. **Cross-tenant search test**
   - Create two installations with distinct content
   - Search from Installation A should NEVER return Installation B's content
   - Automate this as a CI test

2. **Path traversal test**
   - Attempt `../` and other traversal patterns
   - Verify all are rejected or sanitized

3. **ID enumeration test**
   - Verify installation IDs are not guessable
   - Rate limit `/mcp/{id}` endpoint lookups

### Migration Consideration

If we start with Option B (single AI Search) and later need Option A (per-user):
- Migration requires re-indexing all content into new per-user instances
- Plan for this by storing installation_id as document metadata from day 1
- Keep R2 prefix structure consistent so re-indexing is straightforward

### GitHub API Authentication

GitHub Apps use JWT + installation tokens:

```typescript
import { createAppAuth } from "@octokit/auth-app";

// Create JWT for app authentication
const appAuth = createAppAuth({
  appId: env.GITHUB_APP_ID,
  privateKey: env.GITHUB_APP_PRIVATE_KEY,
});

// Get installation token for specific installation
const installationAuth = await appAuth({
  type: "installation",
  installationId: installationId,
});

// Use token to access repos
const response = await fetch(
  `https://api.github.com/repos/${owner}/${repo}/contents`,
  {
    headers: {
      Authorization: `Bearer ${installationAuth.token}`,
      Accept: "application/vnd.github.v3+json",
    },
  }
);
```

### Webhook Handling

```typescript
async function handleGitHubWebhook(request: Request, env: Env) {
  // Verify signature
  const signature = request.headers.get("x-hub-signature-256");
  const body = await request.text();
  const expectedSig = await computeHmac(body, env.GITHUB_WEBHOOK_SECRET);

  if (signature !== `sha256=${expectedSig}`) {
    return new Response("Invalid signature", { status: 401 });
  }

  const event = request.headers.get("x-github-event");
  const payload = JSON.parse(body);

  switch (event) {
    case "push":
      await handlePushEvent(payload, env);
      break;
    case "installation":
      await handleInstallationEvent(payload, env);
      break;
  }

  return new Response("OK");
}
```

---

## Files to Create/Modify

| File | Changes |
|------|---------|
| `src/index.ts` | Add webhook handler, installation management, per-user MCP routing |
| `src/github.ts` (new) | GitHub API client, App authentication |
| `src/storage.ts` (new) | Installation data management (D1 or Durable Objects) |
| `wrangler.toml` | Add D1 database binding (for installations) |

---

## Consequences

### Positive
- Users can connect repos with a few clicks
- No setup required in source repos (no workflows, no secrets)
- Automatic sync via webhooks
- Scales to multiple users
- Professional GitHub integration

### Negative
- More complex initial implementation
- Need to handle webhook reliability (retries, idempotency)
- GitHub API rate limits to consider
- Multi-tenant complexity (data isolation, AI Search filtering)

### Risks
- GitHub App review process (if publishing to Marketplace)
- Webhook delivery failures need handling
- Private key management (rotation, security)

---

## Migration Path from Current State

1. **Phase 1:** Implement GitHub App for NEW users
   - Current `home-brain` continues using GitHub Actions
   - New users get GitHub App flow

2. **Phase 2:** Migrate existing setup
   - Remove GitHub Actions from `home-brain`
   - Install git-brain GitHub App on `home-brain`
   - Verify sync works via webhooks

3. **Phase 3:** Deprecate Actions-based setup
   - Update docs to only show GitHub App flow
   - Keep Actions docs for self-hosted scenarios

---

## Open Questions

1. **AI Search multi-tenancy (CRITICAL - must answer before implementation):**
   - Can we create AI Search instances dynamically via API?
   - If not, does metadata filtering guarantee isolation (pre-filter, not post-filter)?
   - What are the limits on number of AI Search instances per account?

2. **Rate limits:** How many repos can we sync before hitting GitHub API limits?
   - GitHub Apps have higher rate limits than OAuth
   - May need to queue large initial syncs

3. **Large repos:** How do we handle repos with thousands of files?
   - Paginate GitHub API responses
   - Consider file size limits (skip binaries over X MB?)
   - May need background job for initial sync

4. **File types:** Sync all files or just certain types (md, txt, etc.)?
   - Start with: `.md`, `.txt`, `.json`, `.yaml`, `.yml`
   - Exclude: binaries, `node_modules/`, `.git/`, images
   - Make configurable per-installation later?

5. **Deletion handling:** When user removes file from repo, do we:
   - Delete from R2 immediately?
   - Keep for X days (soft delete)?
   - Need to track file inventory to detect deletions

---

## Implementation Checklist

### Phase 1: GitHub App Setup (Manual) ✅
- [x] Create GitHub App at github.com/settings/apps/new
  - Name: `git-brain-stem`
  - Homepage: `https://brainstem.cc`
  - Webhook URL: `https://brainstem.cc/webhook/github`
  - Permissions: Contents (read), Metadata (read)
  - Events: Push, Installation
- [x] Generate webhook secret: `openssl rand -hex 32`
- [x] Download private key (.pem file)
- [x] Store secrets in Cloudflare:
  ```bash
  wrangler secret put GITHUB_APP_ID
  wrangler secret put GITHUB_APP_PRIVATE_KEY
  wrangler secret put GITHUB_WEBHOOK_SECRET
  ```

### Phase 2: Database Setup ✅
- [x] Create D1 database: `brain-stem-db`
- [x] Add D1 binding to wrangler.toml
- [x] Create installations table schema
- [x] Create webhook_logs table schema
- [x] Create users table schema (for OAuth - see ADR-002)
- [x] Create sessions table schema (for OAuth - see ADR-002)

### Phase 3: Code Implementation ✅
- [ ] Add `ScopedR2` wrapper class - **Deferred** (single-user MVP)
- [ ] Add `ScopedAISearch` wrapper class - **Deferred** (single-user MVP)
- [x] Implement `/webhook/github` endpoint
- [x] Implement `/setup` landing page
- [x] Implement `/setup/callback` handler
- [x] Implement GitHub API client (`src/github.ts`)
- [x] Implement per-user MCP routing (`/mcp/{installation_id}`)
- [x] Implement sync logic (GitHub → R2)

### Phase 4: Testing ✅
- [x] Install GitHub App on test repo
- [x] Verify webhook receives push events
- [x] Verify files sync to R2
- [x] Verify MCP tools work with per-user routing
- [ ] Test search isolation between installations - **Deferred** (single-user MVP)

### Phase 5: Migration ✅
- [x] Install git-brain app on `home-brain` repo
- [x] Verify sync works via webhooks
- [x] Remove legacy `sync-to-r2.yml` from `home-brain` repo (2026-01-24)
  - Kept `generate-summary.yml` for weekly brain summary generation

---

## Current Status

**Status:** ✅ Fully Implemented (2026-01-23)

**Implementation Summary:**
- GitHub App `git-brain-stem` created and deployed
- Webhook-based sync working (push events trigger file sync)
- Per-installation MCP endpoints (`/mcp/{uuid}`) working
- Setup flow (`/setup` → GitHub App install → `/setup/callback`) working
- D1 database storing installations and webhook logs
- All 5 MCP tools functional

**Decisions Implemented:**
- Using Level 1 isolation (logical) for MVP ✅
- Shared R2 bucket (files at root, not prefixed) - simplified from original plan
- Single AI Search instance (metadata filtering not yet implemented)
- UUID v4 for installation IDs ✅

**Outstanding Items (see [OUTSTANDING_TASKS.md](../OUTSTANDING_TASKS.md)):**
- ~~Legacy GitHub Actions in `home-brain` repo still firing~~ ✅ Removed 2026-01-24
- AI Search metadata filtering not yet implemented (all users share one index)
- ScopedR2 and ScopedAISearch wrappers not implemented (deferred to multi-user)

---

## Quick Resume Instructions

If resuming after context loss:

1. Read this ADR for full context
2. Check **Current Status** section above
3. Review **Implementation Checklist** for progress
4. Key files:
   - `src/index.ts` - Main MCP server
   - `wrangler.toml` - Cloudflare config
   - `docs/adr/001-github-app.md` - This file

---

## Next Steps

1. Create GitHub App in GitHub settings
2. Implement `/webhook/github` endpoint
3. Implement `/setup` and `/setup/callback` endpoints
4. Add installation storage (D1 or Durable Objects)
5. Implement per-user MCP routing
6. Test end-to-end flow
7. Migrate `home-brain` repo to use GitHub App

---

## References

- [GitHub Apps Documentation](https://docs.github.com/en/apps)
- [Creating a GitHub App](https://docs.github.com/en/apps/creating-github-apps)
- [Authenticating as a GitHub App](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app)
- [Cloudflare D1 Documentation](https://developers.cloudflare.com/d1/)
- [Cloudflare R2 Documentation](https://developers.cloudflare.com/r2/)
