# Troubleshooting

Common issues and solutions for the Git Brain MCP server.

## Connection Issues

### Claude.ai shows "Disconnected"

1. **Check URL format** — Must be `https://brainstem.cc/mcp/{uuid}` (with your installation UUID)

2. **Verify deployment**
   ```bash
   npm run deploy
   curl -H "Authorization: Bearer <token>" https://brainstem.cc/mcp/{uuid}
   # Should return SSE event stream, not an error
   ```

3. **Test MCP connection**
   ```bash
   node test-user-mcp.mjs
   # Should list all 6 tools
   ```

### Tools don't appear in Claude

- Restart the Claude conversation
- Verify tools with `node test-user-mcp.mjs`
- Check tool names are valid identifiers

## Search Issues

### "AutoRAG not found" error

The AI Search instance name differs from the Vectorize index name:
- **AI Search instance**: `home-brain-search`
- **Vectorize index** (auto-created): `ai-search-home-brain-search`

Use the AI Search instance name in `wrangler.toml`:
```toml
[vars]
AUTORAG_NAME = "home-brain-search"  # NOT "ai-search-home-brain-search"
```

### Empty search results

1. Check AI Search has content: Dashboard → AI → AI Search → Documents indexed
2. Check R2 has files: `wrangler r2 object list home-brain-store`
3. Wait for indexing (can take 1-2 minutes after push)
4. Trigger manual re-index: `curl -X POST https://brainstem.cc/debug/reindex`

### Stale search results (new content not appearing)

1. **Check webhook delivered successfully**
   ```bash
   curl https://brainstem.cc/debug/webhooks
   # Look for recent push events with status: "success"
   ```

2. **Check file synced to R2**
   ```bash
   wrangler r2 object get home-brain-store/path/to/file.md
   ```

3. **Check AI Search reindex triggered**
   - The webhook handler calls `triggerAISearchReindex()` after sync
   - Check for `sync_in_cooldown` in logs (means sync already triggered recently)
   - Cooldown is ~30 seconds between syncs

4. **Manually trigger reindex**
   ```bash
   curl -X POST https://brainstem.cc/debug/reindex
   ```

### AI Search shows "paused" or "invalid token"

The AI Search instance has an internal token for R2 access that can expire:

1. Go to Cloudflare dashboard → AI → AI Search → home-brain-search
2. If status shows error, click to regenerate the service API token
3. Wait for indexing to resume

## Webhook Issues

### Webhooks not being received

1. **Verify webhook URL** — Must be `https://brainstem.cc/webhook/github` (NOT `/setup/callback`). This was misconfigured once and caused all webhooks to return 400.

2. **Check webhook deliveries via GitHub App API**
   Use the local private key (`github-app.pem`) to query deliveries:
   ```bash
   # Generate JWT and query /app/hook/deliveries
   # See github-app.pem and App ID 2716073
   ```

3. **Verify GitHub App settings**
   - Go to: `https://github.com/settings/apps/git-brain-stem`
   - Check Webhook URL is `https://brainstem.cc/webhook/github`
   - Check "Active" is enabled
   - Check "Recent Deliveries" for failed attempts

3. **Check webhook logs**
   ```bash
   curl https://brainstem.cc/debug/webhooks
   ```

### "Invalid signature" errors

The webhook secret in GitHub App settings must match the `GITHUB_WEBHOOK_SECRET` Wrangler secret.

1. Check secret is set:
   ```bash
   wrangler secret list
   ```

2. If mismatched, regenerate:
   ```bash
   openssl rand -hex 32  # Generate new secret
   # Update in GitHub App settings AND in Wrangler
   wrangler secret put GITHUB_WEBHOOK_SECRET
   ```

### "Installation not found" errors

The GitHub installation ID from the webhook doesn't match any record in D1:

1. Check installation exists:
   ```bash
   curl https://brainstem.cc/debug/status/{uuid}
   ```

2. If missing, re-install the GitHub App on the repo

## Sync Issues

### Files not syncing

1. **Check webhook received the push**
   ```bash
   curl https://brainstem.cc/debug/webhooks
   # Look for "push" events
   ```

2. **Check file type is syncable**
   Only these extensions sync: `.md`, `.txt`, `.json`, `.yaml`, `.yml`

3. **Manually trigger sync**
   ```bash
   curl -X POST https://brainstem.cc/debug/sync/{uuid}
   ```

### Sync fails with GitHub API errors

1. **Check GitHub App has access to the repo**
   - Go to repo → Settings → GitHub Apps → Installed GitHub Apps
   - Verify `git-brain-stem` is listed

2. **Check app permissions**
   - App needs "Contents: Read" permission

3. **Check secrets**
   ```bash
   wrangler secret list
   # Should show: GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET
   ```

## OAuth Issues

### "Unauthorized" (401) on brainstem.cc

All endpoints on brainstem.cc require OAuth authentication.

1. **Get a token**
   ```bash
   # Open in browser
   open https://brainstem.cc/oauth/authorize
   ```
   Complete the GitHub OAuth flow and copy the session token.

2. **Use the token**
   ```bash
   curl -H "Authorization: Bearer <token>" https://brainstem.cc/mcp/{uuid}
   ```

### Token expired

Session tokens expire after 1 year. Get a new token:
```bash
open https://brainstem.cc/oauth/authorize
```

### "Installation not found or access denied" (403)

The authenticated user doesn't own the requested installation. Either:
1. The installation was created by a different user
2. The user_id hasn't been linked to the installation yet (authenticate with OAuth to link)

### OAuth callback fails

1. **Check GitHub App OAuth settings**
   - Go to: `https://github.com/settings/apps/git-brain-stem`
   - Callback URL should be: `https://brainstem.cc/oauth/callback`

2. **Check client secret**
   ```bash
   wrangler secret list
   # Should include: GITHUB_CLIENT_SECRET
   ```

## Brain Summary Issues

### Tool description missing domains/topics

1. **Check summary file exists in R2**
   ```bash
   wrangler r2 object get home-brain-store/brains/{uuid}/_brain_summary.json
   ```

2. **Force Durable Object restart** — The summary is loaded when the DO initializes. A new deployment or waiting for the DO to expire (~30 seconds of inactivity) will reload it.

## Worker Issues

### Deploy fails

```bash
npm run typecheck  # Check for TypeScript errors
```

Common fixes:
- Ensure R2 bucket exists before deploying
- Use `new_sqlite_classes` (not `new_classes`) for free tier Durable Objects
- Add `compatibility_flags = ["nodejs_compat"]` to wrangler.toml

### Node version errors

Wrangler requires Node.js v20+:
```bash
nvm use 20
npm run deploy
```

### View logs

```bash
wrangler tail home-brain-mcp
```

## Quick Diagnostics

```bash
# Test MCP connection (requires valid bearer token)
node test-user-mcp.mjs

# Test OAuth flow (browser)
open https://brainstem.cc/oauth/authorize

# Test MCP with auth
curl -H "Authorization: Bearer <token>" https://brainstem.cc/mcp/{uuid}

# Check installation status (requires auth)
curl -H "Authorization: Bearer <token>" https://brainstem.cc/debug/status/{uuid}

# Check recent webhooks (requires auth)
curl -H "Authorization: Bearer <token>" https://brainstem.cc/debug/webhooks

# Trigger manual reindex (requires auth)
curl -X POST -H "Authorization: Bearer <token>" https://brainstem.cc/debug/reindex

# View live logs
wrangler tail home-brain-mcp
```
