# ADR-002: OAuth Authentication for MCP Endpoints

> **Status:** ✅ Implemented
> **Date:** 2026-01-24
> **Decision:** Use GitHub OAuth 2.0 to authenticate MCP endpoint access

## Context and Problem Statement

With the GitHub App integration complete (ADR-001), anyone with an installation UUID can access the MCP endpoint at `/mcp/{uuid}`. This is "security through obscurity" - UUIDs are hard to guess but not truly secure.

**Goals:**
1. Authenticate users before granting MCP access
2. Use an auth pattern compatible with future ChatGPT custom actions
3. Provide a smooth migration path from unauthenticated to authenticated access
4. Support multi-repo access (one token for all user's installations)

## Decision Drivers

1. **Compatibility with ChatGPT** - ChatGPT custom actions support OAuth 2.0 authorization code flow
2. **Unified identity** - Users already use GitHub for repo access; reuse that identity
3. **Token-based access** - MCP clients (Claude Code, Desktop) can use bearer tokens
4. **Migration safety** - Don't break existing clients during rollout

## Considered Options

### Option 1: GitHub OAuth 2.0 (Chosen)

Use the existing GitHub App's OAuth functionality to authenticate users.

**Pros:**
- Users already have GitHub accounts
- Single identity system (no separate Brain Stem accounts)
- GitHub App already exists (no new app needed)
- ChatGPT supports OAuth 2.0 authorization code flow
- Industry-standard, well-documented

**Cons:**
- Requires client secret management
- Session management complexity

### Option 2: Cloudflare Access

Use Cloudflare's zero-trust access control.

**Pros:**
- Managed by Cloudflare
- Supports many identity providers
- No code needed for basic auth

**Cons:**
- Doesn't work with ChatGPT custom actions
- Less control over token format
- Extra cost (Access is a paid feature)

### Option 3: API Keys

Issue static API keys per user.

**Pros:**
- Simple implementation
- Easy to understand

**Cons:**
- No automatic expiration
- Key rotation is manual
- Doesn't work with ChatGPT OAuth flow

## Decision Outcome

**Chosen option: GitHub OAuth 2.0**

GitHub OAuth provides the best balance of security, compatibility, and user experience. Users authenticate with their existing GitHub identity, and the same flow works for both manual token generation and ChatGPT's OAuth integration.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│ OAuth Flow                                                           │
│                                                                      │
│ User/ChatGPT → /oauth/authorize → GitHub OAuth → /oauth/callback   │
│                                                       │              │
│                                                       ▼              │
│                                    Create user + session in D1      │
│                                    Return bearer token               │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ MCP Access (brainstem.cc only)                                       │
│                                                                      │
│ GET /mcp/{uuid}                                                      │
│ Authorization: Bearer <token>                                        │
│                     │                                                │
│                     ▼                                                │
│         Validate token → Get user → Check user owns installation    │
│                     │                                                │
│                     ▼                                                │
│              Allow MCP access                                        │
└─────────────────────────────────────────────────────────────────────┘
```

### Dual-Domain Migration Strategy

To avoid breaking existing clients, we use a dual-domain approach:

| Domain | Auth Required | Purpose |
|--------|---------------|---------|
| `brainstem.cc` | Yes (Bearer token) | Production, secure access |
| `home-brain-mcp.dudgeon.workers.dev` | No | Legacy, migration period |

This is enforced with a simple hostname check:
```typescript
const requireAuth = hostname === "brainstem.cc";
```

Clients can continue using workers.dev during migration, then switch to brainstem.cc with auth when ready.

---

## Database Schema

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
  github_access_token TEXT,         -- GitHub OAuth token (for future API calls)
  created_at TEXT,
  expires_at TEXT                   -- 30 days from creation
);
```

### `installations` table (updated)
```sql
ALTER TABLE installations ADD COLUMN user_id TEXT;
-- Links installation to user (set on first OAuth)
```

---

## OAuth Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/oauth/authorize` | GET | Redirect to GitHub OAuth consent |
| `/oauth/callback` | GET | Handle GitHub callback, create session, show token |
| `/oauth/token` | POST | Exchange code for token (ChatGPT compatibility) |

### Flow: Manual Token Generation (Browser)

1. User visits `https://brainstem.cc/oauth/authorize`
2. Redirect to GitHub OAuth consent page
3. User authorizes, GitHub redirects to `/oauth/callback?code=...`
4. Worker exchanges code for GitHub access token
5. Worker fetches GitHub user info
6. Worker creates/updates user in D1
7. Worker creates session (30-day expiry)
8. Worker shows success page with bearer token

### Flow: ChatGPT Custom Action

1. ChatGPT initiates OAuth at `/oauth/authorize?redirect_uri=...`
2. Same GitHub consent flow
3. Callback redirects to ChatGPT's redirect_uri with code
4. ChatGPT calls `/oauth/token` with code
5. Worker returns `{ access_token, token_type: "Bearer", expires_in }`

---

## Token Semantics

- **Token format:** UUID v4 (session ID)
- **Token lifetime:** 30 days
- **One token, all repos:** Bearer token grants access to ALL installations owned by that user
- **Installation selection:** The UUID in `/mcp/{uuid}` selects which installation to query

Example:
```
# User has 3 installations: home-brain, work-notes, recipes
# One token grants access to all three:

curl -H "Authorization: Bearer <token>" https://brainstem.cc/mcp/abc-123  # home-brain
curl -H "Authorization: Bearer <token>" https://brainstem.cc/mcp/def-456  # work-notes
curl -H "Authorization: Bearer <token>" https://brainstem.cc/mcp/ghi-789  # recipes
```

---

## Configuration

### Environment Variables (wrangler.toml)
```toml
[vars]
GITHUB_CLIENT_ID = "Iv23liqdmhreJX6G3ku6"
WORKER_URL = "https://brainstem.cc"
```

### Secrets (wrangler secret put)
```bash
wrangler secret put GITHUB_CLIENT_SECRET
```

### GitHub App Settings

Update at `https://github.com/settings/apps/git-brain-stem`:
- Callback URL: `https://brainstem.cc/oauth/callback`

---

## Implementation Checklist

### Phase 1: Domain Setup ✅
- [x] Add custom domain `brainstem.cc` to Cloudflare Worker
- [x] Update `WORKER_URL` in wrangler.toml
- [x] Update GitHub App URLs to use brainstem.cc
- [x] Verify both domains serve the worker

### Phase 2: Database Schema ✅
- [x] Create `users` table in D1
- [x] Create `sessions` table in D1
- [x] Add `user_id` column to `installations` table

### Phase 3: OAuth Endpoints ✅
- [x] Implement `/oauth/authorize` - redirect to GitHub
- [x] Implement `/oauth/callback` - create user/session, show token
- [x] Implement `/oauth/token` - for ChatGPT OAuth flow
- [x] Add `GITHUB_CLIENT_SECRET` secret

### Phase 4: Link Users to Installations ✅
- [x] On OAuth callback, link unclaimed installations by GitHub login
- [x] On MCP access (if installation unowned), link to authenticated user

### Phase 5: Auth on MCP Endpoints ✅
- [x] Add hostname check (brainstem.cc requires auth)
- [x] Validate bearer token against sessions table
- [x] Verify user owns requested installation
- [x] Return helpful error messages with auth URL

### Phase 6: Documentation ✅
- [x] Update CLAUDE.md with OAuth endpoints and flow
- [x] Update README.md with auth instructions
- [x] Update TROUBLESHOOTING.md with OAuth issues

---

## Outstanding Tasks

See [OUTSTANDING_TASKS.md](../OUTSTANDING_TASKS.md) for full list.

Key items related to OAuth:

1. **Token refresh not implemented** - Sessions expire after 30 days; users must re-authenticate
2. **Token revocation not implemented** - No way to invalidate a token before expiry
3. **Deprecate workers.dev** - Eventually remove unauthenticated access on legacy domain

---

## Security Considerations

### CSRF Protection
- OAuth state parameter stored in HttpOnly cookie
- Verified on callback before token exchange

### Token Storage
- Session tokens are UUIDs (not JWTs) - state is server-side
- GitHub access tokens stored in D1 (encrypted at rest by Cloudflare)

### Installation Ownership
- User can only access installations they own (via `user_id` column)
- First OAuth links unclaimed installations by GitHub login match

---

## Testing

```bash
# Test OAuth flow (browser)
open https://brainstem.cc/oauth/authorize

# Test MCP without auth (should fail on brainstem.cc)
curl https://brainstem.cc/mcp/{uuid}
# Returns: 401 Unauthorized

# Test MCP with auth
curl -H "Authorization: Bearer <token>" https://brainstem.cc/mcp/{uuid}
# Returns: SSE event stream

# Test legacy domain (no auth required during migration)
curl https://home-brain-mcp.dudgeon.workers.dev/mcp/{uuid}
# Returns: SSE event stream
```

---

## Claude Code / Desktop Configuration

```json
{
  "mcpServers": {
    "my-brain": {
      "url": "https://brainstem.cc/mcp/{uuid}",
      "headers": {
        "Authorization": "Bearer <your-session-token>"
      }
    }
  }
}
```

---

## ChatGPT Custom Action Configuration

```yaml
openapi: 3.0.0
info:
  title: Brain Stem API
  version: 1.0.0
servers:
  - url: https://brainstem.cc
components:
  securitySchemes:
    oauth2:
      type: oauth2
      flows:
        authorizationCode:
          authorizationUrl: https://brainstem.cc/oauth/authorize
          tokenUrl: https://brainstem.cc/oauth/token
          scopes:
            read: Read access to knowledge base
```

---

## References

- [GitHub OAuth Apps](https://docs.github.com/en/apps/oauth-apps)
- [OAuth 2.0 RFC 6749](https://tools.ietf.org/html/rfc6749)
- [ChatGPT Actions Authentication](https://platform.openai.com/docs/actions/authentication)
- [ADR-001: GitHub App](./001-github-app.md)
