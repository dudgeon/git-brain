# TROUBLESHOOTING.md - Common Issues and Solutions

## Connection Issues

### Claude.ai says "Disconnected" when adding custom connector

**Symptoms:**
- You add the MCP server URL in Claude.ai Settings → Connectors
- It briefly shows "Connecting..." then shows "Disconnected"

**Causes & Solutions:**

1. **Wrong URL format**
   - Correct: `https://home-brain-mcp.YOUR_SUBDOMAIN.workers.dev/sse`
   - Wrong: `https://home-brain-mcp.YOUR_SUBDOMAIN.workers.dev` (missing /sse)
   - Wrong: `http://...` (must be https)

2. **Worker not deployed**
   ```bash
   wrangler deploy
   # Verify it's live:
   curl https://home-brain-mcp.YOUR_SUBDOMAIN.workers.dev/
   ```

3. **SSE endpoint not responding**
   ```bash
   # Test SSE endpoint directly:
   curl -N https://home-brain-mcp.YOUR_SUBDOMAIN.workers.dev/sse
   # Should see SSE event stream, not an error
   ```

4. **OAuth misconfigured**
   - Check that OAuth callback URL matches Claude's exactly
   - Verify secrets are set: `wrangler secret list`

5. **CORS issues**
   - The Worker needs to allow requests from `claude.ai`
   - Check the Access-Control-Allow-Origin header

---

### MCP tools don't appear in Claude

**Symptoms:**
- Connector shows as "Connected" in Claude.ai
- But no tools appear when you click the tools icon
- Or Claude doesn't use the tools when asked

**Solutions:**

1. **Verify tools are registered**
   ```bash
   # Test locally:
   npm run dev
   # In another terminal, send an MCP request to list tools
   ```

2. **Check tool definitions**
   - Tool names must be valid identifiers (no spaces, special chars)
   - Input schemas must be valid JSON Schema

3. **Restart Claude**
   - Sometimes Claude caches tool lists
   - Close and reopen the conversation

---

## Search Issues

### search_brain returns empty results

**Symptoms:**
- Tool executes without error
- But results array is empty
- Even for queries that should match

**Diagnosis:**

1. **Check if AI Search has content:**
   ```bash
   # In Cloudflare dashboard:
   # AI → AI Search → your instance → Overview
   # Look at "Documents indexed" count
   ```

2. **Check if files are in R2:**
   ```bash
   wrangler r2 object list home-brain-store
   ```

3. **Manually test AI Search:**
   ```bash
   # Add a test endpoint to your Worker:
   app.get('/test-search', async (c) => {
     const result = await c.env.AI.autorag('home-brain-search').aiSearch({
       query: 'test query here'
     });
     return c.json(result);
   });
   ```

4. **Trigger re-indexing:**
   ```bash
   curl -X PATCH \
     "https://api.cloudflare.com/client/v4/accounts/ACCOUNT_ID/autorag/rags/AUTORAG_ID/full_scan" \
     -H "Authorization: Bearer YOUR_API_TOKEN"
   ```

5. **Wait for indexing:**
   - First-time indexing can take 20+ minutes
   - Check the "Jobs" tab in AI Search dashboard

---

### Search results are stale (old content)

**Symptoms:**
- You updated a file in home-brain
- Search still returns old content
- Even after GitHub Action ran successfully

**Solutions:**

1. **Verify sync completed:**
   - Check GitHub Actions tab for your home-brain repo
   - Confirm the sync job succeeded

2. **Verify file is in R2:**
   ```bash
   wrangler r2 object get home-brain-store/path/to/file.md
   ```

3. **Trigger manual re-index:**
   - Dashboard: AI Search → your instance → "Sync index" button
   - Or via API (see above)

4. **Wait for index update:**
   - Even after triggering, indexing takes time
   - Check the Jobs tab for status

5. **Remember: 5-minute cooldown**
   - You can't trigger re-indexing more than once per 5 minutes

---

## GitHub Action Issues

### Sync action fails with "Access Denied"

**Symptoms:**
- GitHub Action runs but fails
- Error mentions S3 access denied or authentication failed

**Solutions:**

1. **Check secrets are set correctly:**
   - Go to home-brain repo → Settings → Secrets and variables → Actions
   - Verify all these exist:
     - `R2_ACCESS_KEY_ID`
     - `R2_SECRET_ACCESS_KEY`
     - `R2_ENDPOINT`
     - `CF_ACCOUNT_ID`
     - `CF_API_TOKEN`

2. **Verify R2 token permissions:**
   - The R2 API token needs "Object Read & Write"
   - Should be scoped to the correct bucket (or all buckets)

3. **Check endpoint format:**
   - Correct: `https://ACCOUNT_ID.r2.cloudflarestorage.com`
   - Wrong: `https://ACCOUNT_ID.r2.cloudflarestorage.com/bucket-name`

4. **Test credentials locally:**
   ```bash
   export AWS_ACCESS_KEY_ID=your_r2_key
   export AWS_SECRET_ACCESS_KEY=your_r2_secret
   aws s3 ls s3://home-brain-store/ --endpoint-url https://ACCOUNT_ID.r2.cloudflarestorage.com
   ```

---

### Sync succeeds but files not in R2

**Symptoms:**
- GitHub Action shows green checkmark
- But R2 bucket is empty or missing files

**Solutions:**

1. **Check the sync command output:**
   - Look at the action logs for what was actually synced
   - Might be syncing to wrong path

2. **Verify bucket name:**
   - Action might be creating/using a different bucket
   - Check the bucket name in the workflow matches your actual bucket

3. **Check exclusions:**
   - Your workflow might be excluding too many files
   - Review the `--exclude` patterns

---

## Worker Issues

### Worker crashes on deploy

**Symptoms:**
- `wrangler deploy` fails
- Or deploys but immediately crashes

**Solutions:**

1. **Check for syntax errors:**
   ```bash
   npm run typecheck
   ```

2. **Verify bindings exist:**
   - R2 bucket must exist before deploying
   - AI Search must be created before using the binding

3. **Check bundle size:**
   - Workers have a 1MB (free) or 10MB (paid) limit
   - Run `wrangler deploy --dry-run` to see bundle size

4. **Review logs:**
   ```bash
   wrangler tail
   ```

---

### "AI binding not found" error

**Symptoms:**
- Worker deploys but errors when using AI Search
- Error: "Cannot read property 'autorag' of undefined" or similar

**Solutions:**

1. **Add AI binding to wrangler.toml:**
   ```toml
   [ai]
   binding = "AI"
   ```

2. **Verify AI Search name:**
   - The name in `env.AI.autorag('name')` must match your AI Search instance
   - Check the exact name in Cloudflare dashboard

3. **Check account has AI enabled:**
   - AI Search requires Workers AI
   - Verify it's enabled in your Cloudflare account

---

## Local Development Issues

### `wrangler dev` fails to start

**Solutions:**

1. **Port already in use:**
   ```bash
   # Use a different port
   wrangler dev --port 8788
   ```

2. **Missing dependencies:**
   ```bash
   npm install
   ```

3. **Node version:**
   ```bash
   node --version  # Need 18+
   ```

---

### Can't connect to local MCP server

**Solutions:**

1. **Check the URL:**
   - Local: `http://localhost:8787/sse`
   - Not `https` for local development

2. **CORS for local testing:**
   - Browser-based tools might have CORS issues
   - Use curl or Postman for testing

3. **Firewall:**
   - Some systems block localhost connections
   - Try `127.0.0.1` instead of `localhost`

---

## Getting More Help

### Enable verbose logging

Add to your Worker:
```typescript
console.log('Request:', request.url);
console.log('Headers:', Object.fromEntries(request.headers));
```

Then stream logs:
```bash
wrangler tail
```

### Check Cloudflare status
- https://www.cloudflarestatus.com/

### MCP Protocol debugging
- Use the MCP Inspector: https://modelcontextprotocol.io/docs/tools/inspector

### Ask Claude Code for help
```
I'm getting this error when [doing X]:

[paste error]

Here's my relevant code:

[paste code]

How do I fix this?
```
