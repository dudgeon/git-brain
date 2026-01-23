# Troubleshooting

Common issues and solutions for the Git Brain MCP server.

## Connection Issues

### Claude.ai shows "Disconnected"

1. **Check URL format** - Must be `https://home-brain-mcp.dudgeon.workers.dev/mcp` (note the `/mcp` suffix)

2. **Verify deployment**
   ```bash
   npm run deploy
   curl https://home-brain-mcp.dudgeon.workers.dev/mcp
   # Should return SSE event stream, not an error
   ```

3. **Test MCP connection**
   ```bash
   node test-mcp.mjs
   # Should list all 5 tools
   ```

### Tools don't appear in Claude

- Restart the Claude conversation
- Verify tools with `node test-mcp.mjs`
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
3. Wait for indexing (can take 20+ minutes for first sync)
4. Trigger re-index from AI Search dashboard

### Stale search results

1. Verify GitHub Action ran successfully
2. Check file exists in R2: `wrangler r2 object get home-brain-store/path/to/file.md`
3. Trigger re-index from AI Search dashboard (5-minute cooldown between syncs)

## GitHub Action Issues

### Sync fails with "Access Denied"

Check secrets in `home-brain` repo → Settings → Secrets → Actions:
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_ENDPOINT` (format: `https://ACCOUNT_ID.r2.cloudflarestorage.com`)

### Sync succeeds but files missing

- Check action logs for actual sync output
- Verify bucket name matches
- Review `--exclude` patterns in workflow

## Worker Issues

### Deploy fails

```bash
npm run typecheck  # Check for TypeScript errors
```

Common fixes:
- Ensure R2 bucket exists before deploying
- Use `new_sqlite_classes` (not `new_classes`) for free tier Durable Objects
- Add `compatibility_flags = ["nodejs_compat"]` to wrangler.toml

### View logs

```bash
wrangler tail home-brain-mcp
```

## Quick Diagnostics

```bash
# Test MCP connection
node test-mcp.mjs

# Test all tools
node test-tools.mjs

# Check deployment
npm run deploy

# View live logs
wrangler tail home-brain-mcp
```
