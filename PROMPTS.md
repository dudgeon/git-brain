# PROMPTS.md - Claude Code Prompts for Building Home Brain MCP

This file contains the exact prompts to use with Claude Code at each phase of building your home-brain MCP server. Copy and paste these into Claude Code in order.

---

## Phase 1: Cloudflare Resource Setup

### Prompt 1.1: Initial Project Scaffolding

```
I'm starting a new project to build a remote MCP server on Cloudflare Workers. The MCP server will provide semantic search over my personal knowledge base stored in R2, using Cloudflare AI Search for embeddings.

Please help me:
1. Initialize a new npm project with TypeScript
2. Install the required dependencies:
   - wrangler (Cloudflare CLI)
   - @cloudflare/workers-types
   - hono (lightweight web framework for Workers)
   - @modelcontextprotocol/sdk (MCP SDK)
3. Create a basic wrangler.toml configured for Workers
4. Set up tsconfig.json appropriate for Cloudflare Workers
5. Create a minimal src/index.ts that responds with "Hello World"

After creating the files, show me how to test locally with `wrangler dev`.
```

### Prompt 1.2: Create R2 Bucket

```
I need to create an R2 bucket to store my knowledge base files. The bucket should be called "home-brain-store".

Please:
1. Use the Cloudflare MCP tools (or show me the wrangler commands) to create the R2 bucket
2. Update wrangler.toml to bind the bucket to my Worker as "R2"
3. Add a simple test endpoint that lists objects in the bucket

If you don't have access to Cloudflare MCP tools, provide the wrangler CLI commands I should run.
```

### Prompt 1.3: Create AI Search Instance

```
Now I need to set up Cloudflare AI Search (formerly AutoRAG) to index the content in my R2 bucket.

Please:
1. Show me how to create an AI Search instance via the Cloudflare dashboard or API
   - Name: "home-brain-search"
   - Data source: the R2 bucket "home-brain-store"
   - Use default embedding model
   - Use default LLM
2. Update wrangler.toml to add the AI binding so I can query AI Search from my Worker
3. Create a test endpoint that queries AI Search with a sample query

Note: AI Search setup might need to be done in the dashboard. If so, walk me through the exact steps and tell me what to configure, then show me the code changes needed after.
```

---

## Phase 2: MCP Server Implementation

### Prompt 2.1: Basic MCP Server Structure

```
Now let's implement the MCP server. I want to use the official MCP SDK and Hono for routing.

Please create the MCP server structure:
1. src/index.ts - Main entry point with Hono router
2. src/mcp/server.ts - MCP server setup using @modelcontextprotocol/sdk
3. src/mcp/tools.ts - Tool definitions (empty implementations for now)

The server needs to:
- Handle SSE transport at the /sse endpoint (required for Claude.ai)
- Also support the newer streamable-http transport at /mcp
- Properly handle MCP protocol messages

Reference the CLAUDE.md file for the tool schemas I want to implement.
```

### Prompt 2.2: Implement search_brain Tool

```
Let's implement the search_brain tool. This is the core tool that does semantic search.

The tool should:
1. Accept a query string and optional limit parameter
2. Call AI Search using the AI binding (env.AI.autorag())
3. Return formatted results with:
   - The matched text/passage
   - The source file path
   - A relevance score if available

Handle errors gracefully and return helpful error messages.

Also add logging so I can debug issues in the Cloudflare dashboard.
```

### Prompt 2.3: Implement get_document Tool

```
Now implement the get_document tool that retrieves full file contents from R2.

The tool should:
1. Accept a file path parameter
2. Fetch the object from R2 using the R2 binding
3. Return the text content for text-based files
4. For binary files, return an appropriate message
5. Handle missing files with a clear error

Consider:
- Text files: .md, .txt, .json, .yaml, .csv, .html
- Return an error for binary files rather than corrupted content
```

### Prompt 2.4: Implement list_recent and list_folders Tools

```
Implement the remaining two tools:

1. list_recent - List recently modified files
   - Use R2's list operation with metadata
   - Sort by last modified date
   - Support optional path_prefix filter
   - Return file paths and modification dates

2. list_folders - Browse the knowledge base structure
   - List objects at a given path prefix
   - Distinguish between "folders" (common prefixes) and files
   - Return a structured list suitable for navigation

Note: R2 doesn't have real folders, so list_folders should parse object keys to simulate folder structure.
```

### Prompt 2.5: Test MCP Server Locally

```
Let's test the MCP server locally before deploying.

Please:
1. Show me how to run the server with `wrangler dev`
2. Create a simple test script or curl commands to:
   - Connect to the SSE endpoint
   - List available tools
   - Call search_brain with a test query
   - Call get_document with a test path
3. Help me debug any issues that come up

If I need test data in R2, show me how to upload some sample markdown files.
```

---

## Phase 3: GitHub Action for Syncing

### Prompt 3.1: Create Sync GitHub Action

```
I need a GitHub Action that syncs my home-brain repo to the R2 bucket whenever I push changes.

Please create .github/workflows/sync-to-r2.yml that:
1. Triggers on push to main branch
2. Uses rclone or AWS CLI to sync files to R2
3. Excludes .git directory and other non-content files
4. Calls the AI Search sync API to trigger re-indexing
5. Uses GitHub secrets for credentials

I'll need to set up these secrets in my home-brain repo:
- R2_ACCESS_KEY_ID
- R2_SECRET_ACCESS_KEY
- R2_ENDPOINT (the S3-compatible endpoint for my R2 bucket)
- CF_ACCOUNT_ID
- CF_API_TOKEN
- AUTORAG_ID

Show me exactly what secrets I need and how to get each value from Cloudflare.
```

### Prompt 3.2: Test the Sync

```
Let's test the GitHub Action sync:

1. Help me verify my R2 credentials are correct by testing locally first
2. Show me how to manually trigger the GitHub Action
3. After sync, verify the files appear in R2
4. Check that AI Search picks up the new content

What should I look for in the GitHub Action logs to confirm success?
```

---

## Phase 4: OAuth and Security

### Prompt 4.1: Add OAuth Authentication

```
Now let's secure the MCP server with OAuth so it can be used as a Claude.ai custom connector.

Please:
1. Install @cloudflare/workers-oauth-provider
2. Update the Worker to wrap endpoints with OAuth
3. Configure OAuth to work with Claude.ai's callback URL: https://claude.ai/api/mcp/auth_callback
4. For the OAuth provider, let's use a simple email/password flow initially (we can add GitHub OAuth later)

Show me:
- The code changes needed
- What secrets to configure
- How to test the OAuth flow
```

### Prompt 4.2: Deploy to Production

```
Let's deploy the MCP server to Cloudflare:

1. Run wrangler deploy and show me the output
2. Verify the deployed URL works
3. Test the SSE endpoint from the deployed URL
4. Walk me through adding this as a custom connector in Claude.ai

What's the exact URL I should enter in Claude.ai settings?
```

---

## Phase 5: Testing and Polish

### Prompt 5.1: End-to-End Test

```
Let's do a full end-to-end test:

1. I'll push a new file to my home-brain repo
2. Verify the GitHub Action syncs it to R2
3. Trigger AI Search re-indexing
4. Query for the new content via Claude.ai using the MCP connector
5. Verify the search results include the new file

Help me trace through each step and debug any issues.
```

### Prompt 5.2: Error Handling and Logging

```
Let's improve error handling and observability:

1. Add structured logging using Cloudflare's console
2. Add error boundaries around each tool
3. Return helpful error messages to Claude (not stack traces)
4. Set up alerts for failures (optional)

Also, review the code for any edge cases we might have missed.
```

### Prompt 5.3: Documentation

```
Finally, let's document everything:

1. Update README.md with:
   - What this project does
   - How to set it up from scratch
   - How to maintain it
   - Troubleshooting common issues
2. Add inline code comments for complex sections
3. Create a TROUBLESHOOTING.md with known issues and solutions

Make sure someone (including future me) could understand and maintain this project.
```

---

## Quick Reference: Common Commands

```bash
# Local development
npm run dev                    # Start local server
wrangler dev                   # Same thing, directly

# Deployment
npm run deploy                 # Deploy to Cloudflare
wrangler deploy               # Same thing, directly

# Secrets management
wrangler secret put SECRET_NAME    # Add a secret
wrangler secret list               # List secrets

# R2 operations
wrangler r2 object put home-brain-store/test.md --file=./test.md
wrangler r2 object list home-brain-store

# Logs
wrangler tail                  # Stream live logs from deployed Worker

# AI Search (via API)
curl -X PATCH "https://api.cloudflare.com/client/v4/accounts/ACCOUNT_ID/autorag/rags/AUTORAG_ID/full_scan" \
  -H "Authorization: Bearer CF_API_TOKEN"
```

---

## Troubleshooting Prompts

If things go wrong, use these prompts:

### "The MCP connection fails"
```
I'm getting an error when Claude tries to connect to my MCP server. Here's what I see:
[paste error]

The server is deployed at: [your URL]

Help me debug this step by step.
```

### "Search returns no results"
```
The search_brain tool returns empty results even though I have files in R2.

Help me verify:
1. Files are actually in R2
2. AI Search has indexed them
3. The query is being sent correctly
4. The response is being parsed correctly
```

### "GitHub Action fails"
```
My sync GitHub Action is failing with this error:
[paste error]

Here's my workflow file:
[paste workflow]

What's wrong and how do I fix it?
```
