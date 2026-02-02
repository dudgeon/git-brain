# Self-Hosting Brain Stem

This guide walks through forking Brain Stem and deploying your own instance on Cloudflare. Written for a coding assistant (Claude Code, Cursor, etc.) to execute step by step.

**Why self-host?** Brain Stem's hosted version stores your files on Cloudflare R2 where the platform operator has technical access. If that trust model doesn't work for you, run your own instance — you become the only operator.

## Prerequisites

- A GitHub account
- A payment method (Cloudflare Workers paid plan is ~$5/month for R2 + AI Search)
- Node.js v20+
- `npm` and `git`

## 1. Fork and Clone

```bash
gh repo fork dudgeon/git-brain --clone
cd git-brain
npm install
```

## 2. Create a Cloudflare Account

1. Sign up at https://dash.cloudflare.com
2. Subscribe to the **Workers Paid** plan ($5/month) — required for R2, D1, Durable Objects, and AI Search
3. Note your **Account ID** from the dashboard sidebar (Workers & Pages → Overview → right sidebar)

## 3. Install Wrangler and Authenticate

```bash
npx wrangler login
```

This opens a browser for OAuth. Wrangler stores credentials locally.

## 4. Create Cloudflare Resources

### 4a. R2 Bucket

```bash
npx wrangler r2 bucket create brain-store
```

### 4b. D1 Database

```bash
npx wrangler d1 create brain-db
```

Note the **database_id** from the output — you'll need it for `wrangler.toml`.

### 4c. AI Search Instance

Create via the Cloudflare dashboard:

1. Go to **AI** → **AI Search** in the sidebar
2. Click **Create** and name it `brain-search`
3. Connect it to the R2 bucket you created (`brain-store`)
4. Note the instance name

### 4d. Create the D1 Tables

```bash
npx wrangler d1 execute brain-db --remote --command "
CREATE TABLE IF NOT EXISTS installations (
  id TEXT PRIMARY KEY,
  github_installation_id INTEGER,
  account_login TEXT,
  account_type TEXT,
  repo_full_name TEXT,
  created_at TEXT,
  last_sync_at TEXT,
  user_id TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  github_user_id INTEGER UNIQUE,
  github_login TEXT,
  created_at TEXT,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  github_access_token TEXT,
  created_at TEXT,
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS webhook_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at TEXT,
  event_type TEXT,
  installation_id TEXT,
  payload_summary TEXT,
  status TEXT,
  error TEXT
);
"
```

The `oauth_clients` and `authorization_codes` tables are created automatically on first use.

## 5. Create a GitHub App

1. Go to https://github.com/settings/apps/new
2. Fill in:
   - **App name**: Choose something unique (e.g., `my-brain-stem`)
   - **Homepage URL**: Your worker URL (set temporarily to `https://example.com`, update after deploy)
   - **Callback URL**: `https://<your-domain>/setup/callback`
   - **Webhook URL**: `https://<your-domain>/webhook/github`
   - **Webhook secret**: Generate one with `openssl rand -hex 32` — save this value
3. Permissions:
   - **Repository → Contents**: Read & write (for inbox commits)
   - **Repository → Metadata**: Read-only
4. Events to subscribe:
   - **Push**
   - **Installation**
5. Click **Create GitHub App**
6. Note the **App ID** from the app settings page
7. Generate a **private key** — download the `.pem` file
8. Under **OAuth**, note the **Client ID** and generate a **Client Secret**

## 6. Configure wrangler.toml

Update `wrangler.toml` with your values:

```toml
name = "brain-stem"
main = "src/index.ts"
compatibility_date = "2025-01-22"
compatibility_flags = ["nodejs_compat"]
workers_dev = false

[[durable_objects.bindings]]
name = "MCP_OBJECT"
class_name = "HomeBrainMCP"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["HomeBrainMCP"]

[[r2_buckets]]
binding = "R2"
bucket_name = "brain-store"          # ← your R2 bucket name

[ai]
binding = "AI"

[[d1_databases]]
binding = "DB"
database_name = "brain-db"           # ← your D1 database name
database_id = "YOUR_D1_DATABASE_ID"  # ← from step 4b

[vars]
AUTORAG_NAME = "brain-search"                # ← your AI Search instance name
WORKER_URL = "https://your-domain.com"       # ← your worker URL (or workers.dev subdomain)
GITHUB_APP_NAME = "my-brain-stem"            # ← your GitHub App name
CLOUDFLARE_ACCOUNT_ID = "YOUR_ACCOUNT_ID"    # ← from step 2
GITHUB_CLIENT_ID = "YOUR_CLIENT_ID"          # ← from step 5

[[rules]]
type = "Data"
globs = ["**/*.png"]
fallthrough = false
```

## 7. Set Secrets

```bash
npx wrangler secret put GITHUB_APP_ID
# Enter your App ID

npx wrangler secret put GITHUB_APP_PRIVATE_KEY
# Paste the entire contents of the .pem file

npx wrangler secret put GITHUB_WEBHOOK_SECRET
# Enter the webhook secret from step 5

npx wrangler secret put GITHUB_CLIENT_SECRET
# Enter the OAuth client secret from step 5

npx wrangler secret put CLOUDFLARE_API_TOKEN
# Create a token at https://dash.cloudflare.com/profile/api-tokens
# with the "AI Search Edit" permission, then paste it here
```

## 8. Deploy

```bash
npm run typecheck
npm run deploy
```

The deploy output shows your worker URL (e.g., `https://brain-stem.<your-subdomain>.workers.dev`).

## 9. Custom Domain (Optional)

If you own a domain and it's on Cloudflare:

1. Dashboard → Workers & Pages → your worker → Settings → Domains & Routes
2. Add your custom domain
3. Update `WORKER_URL` in `wrangler.toml` and redeploy
4. Update the GitHub App's callback and webhook URLs to use the new domain

## 10. Update GitHub App URLs

Go back to your GitHub App settings and update:
- **Homepage URL**: Your deployed worker URL
- **Callback URL**: `https://<your-domain>/setup/callback`
- **Webhook URL**: `https://<your-domain>/webhook/github`

## 11. Test the Deployment

Visit `https://<your-domain>/setup` in your browser. You should see the Brain Stem homepage. Click **Connect Repository** to install your GitHub App on a repo.

After connecting, get an auth token:

```bash
# Open in browser
open "https://<your-domain>/oauth/authorize"
```

Then test the MCP endpoint:

```bash
# Update test-user-mcp.mjs with your URL, UUID, and bearer token, then:
node test-user-mcp.mjs
```

## 12. Connect to Claude

### Claude Code / Desktop

```json
{
  "mcpServers": {
    "my-brain": {
      "url": "https://<your-domain>/mcp/<your-uuid>",
      "headers": {
        "Authorization": "Bearer <your-token>"
      }
    }
  }
}
```

### Claude.ai (Web)

Settings → Connectors → Add custom connector → paste your MCP URL. Claude.ai handles OAuth automatically via the discovery endpoints.

## Ongoing Costs

| Resource | Estimated Cost |
|----------|---------------|
| Workers (requests) | Free tier covers ~100k req/day |
| R2 (storage) | ~$0.015/GB/month |
| D1 (database) | Free tier covers most usage |
| AI Search | Included with Workers Paid |
| Durable Objects | ~$0.15/million requests |

For a single-user personal knowledge base, expect **$5/month** (the Workers Paid plan minimum).

## Keeping Up to Date

```bash
# Add upstream remote
git remote add upstream https://github.com/dudgeon/git-brain.git

# Pull updates
git fetch upstream
git merge upstream/main
```

Review changes before merging — upstream config values will differ from yours.
