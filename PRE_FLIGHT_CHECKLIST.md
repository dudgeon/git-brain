# PRE_FLIGHT_CHECKLIST.md - Do This Before Starting Claude Code

Complete these manual steps before you start building with Claude Code. This ensures you have all the accounts and access needed.

---

## 1. Cloudflare Account Setup (10 minutes)

### 1.1 Create/Access Cloudflare Account
- [ ] Go to https://dash.cloudflare.com
- [ ] Create account or sign in
- [ ] Note your **Account ID** (visible in the URL or right sidebar of dashboard)

### 1.2 Enable R2 Storage
- [ ] Go to R2 in the left sidebar
- [ ] Click "Purchase R2 Plan" if prompted (free tier is fine)
- [ ] Accept the terms

### 1.3 Create API Token
- [ ] Go to "My Profile" (top right) → "API Tokens"
- [ ] Click "Create Token"
- [ ] Use the "Edit Cloudflare Workers" template
- [ ] Add these additional permissions:
  - Account / Workers R2 Storage / Edit
  - Account / Workers AI / Edit
- [ ] Click "Continue to summary" → "Create Token"
- [ ] **COPY AND SAVE THE TOKEN** - you won't see it again!

### 1.4 Get R2 API Credentials (for GitHub Actions)
- [ ] Go to R2 → "Manage R2 API Tokens"
- [ ] Click "Create API token"
- [ ] Give it a name like "github-action-sync"
- [ ] Permissions: "Object Read & Write"
- [ ] Specify bucket: (leave blank for now, we'll create the bucket first)
- [ ] Click "Create API Token"
- [ ] **SAVE these values:**
  - Access Key ID
  - Secret Access Key
  - Endpoint URL (looks like `https://ACCOUNT_ID.r2.cloudflarestorage.com`)

---

## 2. GitHub Setup (5 minutes)

### 2.1 Create the MCP Server Repository
- [ ] Go to https://github.com/new
- [ ] Name: `home-brain-mcp` (or your preference)
- [ ] Visibility: **Private**
- [ ] Initialize with README: No (we'll add our own files)
- [ ] Click "Create repository"

### 2.2 Prepare Your home-brain Repository
- [ ] Make sure your existing home-brain repo exists
- [ ] You'll add secrets to it later for the GitHub Action

### 2.3 Create GitHub Personal Access Token (if using GitHub MCP)
- [ ] Go to GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)
- [ ] Generate new token with `repo` scope
- [ ] Save the token

---

## 3. Local Environment (5 minutes)

### 3.1 Install Prerequisites
```bash
# Check Node.js version (need 18+)
node --version

# Install if needed (using nvm)
nvm install 20
nvm use 20

# Install wrangler globally (optional but helpful)
npm install -g wrangler

# Login to Cloudflare via wrangler
wrangler login
```

### 3.2 Verify Wrangler Auth
```bash
# This should show your account info
wrangler whoami
```

### 3.3 Clone Your New Repo
```bash
git clone git@github.com:YOUR_USERNAME/home-brain-mcp.git
cd home-brain-mcp
```

---

## 4. Claude Code Setup (5 minutes)

### 4.1 Install/Update Claude Code
```bash
# If not installed
npm install -g @anthropic-ai/claude-code

# If installed, update to latest
npm update -g @anthropic-ai/claude-code
```

### 4.2 Add MCP Servers to Claude Code

Create or edit `~/.claude.json` (Claude Code config):

```json
{
  "mcpServers": {
    "cloudflare": {
      "command": "npx",
      "args": ["-y", "@cloudflare/mcp-server-cloudflare"],
      "env": {
        "CLOUDFLARE_API_TOKEN": "YOUR_API_TOKEN_HERE",
        "CLOUDFLARE_ACCOUNT_ID": "YOUR_ACCOUNT_ID_HERE"
      }
    }
  }
}
```

**Replace the placeholders with your actual values!**

### 4.3 Verify MCP Connection
```bash
cd home-brain-mcp
claude

# Inside Claude Code, type:
/mcp
# Should show "cloudflare" as connected
```

---

## 5. Collect Your Values

Fill in these values - you'll need them throughout the build:

```
CLOUDFLARE_ACCOUNT_ID = ________________________________

CLOUDFLARE_API_TOKEN = ________________________________

R2_ACCESS_KEY_ID = ________________________________

R2_SECRET_ACCESS_KEY = ________________________________

R2_ENDPOINT = https://________________________________.r2.cloudflarestorage.com

GITHUB_USERNAME = ________________________________

home-brain-mcp REPO URL = ________________________________

home-brain REPO URL = ________________________________
```

---

## 6. Ready to Build!

Once all boxes are checked above:

1. Open terminal in your `home-brain-mcp` directory
2. Copy `CLAUDE.md` from this guide into the repo root
3. Start Claude Code: `claude`
4. Follow the prompts in `PROMPTS.md` in order

---

## Quick Sanity Checks

Before each phase, verify:

### Before Phase 1 (Cloudflare Setup)
```bash
wrangler whoami  # Should show your account
wrangler r2 bucket list  # Should work (might be empty)
```

### Before Phase 3 (GitHub Action)
- [ ] R2 bucket exists and has test content
- [ ] AI Search instance is created and has indexed content
- [ ] You can query AI Search from the Worker locally

### Before Phase 4 (OAuth)
- [ ] MCP server is deployed and accessible
- [ ] Tools work when tested directly
- [ ] You know Claude.ai's OAuth callback URL

---

## If Things Go Wrong

### "wrangler: command not found"
```bash
npm install -g wrangler
# or use npx:
npx wrangler whoami
```

### "Authentication error" from wrangler
```bash
wrangler logout
wrangler login
```

### MCP server not showing in Claude Code
1. Check `~/.claude.json` syntax (valid JSON?)
2. Restart Claude Code completely
3. Check that the npx command works manually:
   ```bash
   npx -y @cloudflare/mcp-server-cloudflare
   ```

### R2 credentials not working
- Make sure you created an **R2-specific** API token, not a general Cloudflare token
- The endpoint should NOT have a bucket name in it - just the account ID
