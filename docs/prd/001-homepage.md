# PRD: Brain Stem Homepage

> **Status:** ✅ Implemented (2026-01-24)

## Overview

Create a simple, inviting homepage for Brain Stem at `https://brainstem.cc` that explains the service and guides users through connecting their "second brain" repository.

**Goal**: Help users quickly understand what Brain Stem does and get started in under 2 minutes.

---

## Problem Statement

Currently, visiting `https://brainstem.cc/` falls through to the MCP SSE handler, which returns protocol garbage instead of a welcoming landing page. Users have no way to discover Brain Stem or understand what it does without knowing the exact `/setup` URL.

---

## User Journey

```
1. User lands on brainstem.cc
   ↓
2. Reads ~30 seconds of context about what Brain Stem does
   ↓
3. Clicks "Connect Repository" button
   ↓
4. Installs GitHub App on their brain repo
   ↓
5. Redirected to success page with:
   - Their unique MCP endpoint URL
   - Instructions to authenticate (get bearer token)
   - Copy-paste config for Claude Desktop/Code
   ↓
6. User configures their AI client and starts using their brain
```

---

## Pages

### 1. Homepage (`/`)

**Purpose**: Explain Brain Stem and provide the install button.

**Content Structure** (derived from markdown source):

```
# Brain Stem

Give your AI a second brain.

---

Brain Stem connects your private knowledge base to Claude, ChatGPT, and other AI assistants.

## How it works

1. **You maintain a "second brain"** — notes, docs, or a knowledge base in a private GitHub repo. Maybe you use Obsidian, Notion exports, or just markdown files.

2. **Connect it to Brain Stem** — Install our GitHub App on your repo. We sync your files and make them searchable.

3. **Your AI can access it** — Claude Desktop, Claude Code, or any MCP-compatible client can now search and retrieve from your brain.

That's it. No complex setup. No manual file uploads. Push to GitHub, and your AI knows about it within a minute.

---

[Connect Repository] (button → GitHub App install)

---

**Already connected?** [Get your auth token](/oauth/authorize) | [View setup](/setup)
```

**Design Notes**:
- Single column, centered, max-width ~600px
- Lots of whitespace
- System font stack (like Claude)
- Warm, muted color palette (not stark white)
- Primary action button: soft green or blue (not aggressive)
- Secondary links: understated text links

### 2. Success Page (`/setup/callback` — already exists, needs update)

**Purpose**: Guide user through connecting their AI client after GitHub App installation.

**Content Structure**:

```
# Connected!

Your repository **{repo-name}** is now synced.

---

## Step 1: Get your auth token

Brain Stem uses GitHub OAuth to verify you own your repos.

[Authorize with GitHub] (button → /oauth/authorize)

---

## Step 2: Configure your AI client

### Claude Desktop / Claude Code

Add to your MCP config (`~/.config/claude/mcp_servers.json`):

{config snippet with placeholder for token}

### Claude.ai (Web)

Settings → Connectors → Add custom connector → paste your endpoint URL

---

## Your endpoint

`https://brainstem.cc/mcp/{uuid}`

---

Questions? Check the [troubleshooting guide](https://github.com/dudgeon/git-brain/blob/main/TROUBLESHOOTING.md).
```

### 3. OAuth Success Page (`/oauth/callback` — already exists, needs update)

**Purpose**: Show user their bearer token and final config.

Keep the current structure but:
- Match the new visual style
- Improve the "next steps" flow
- Link back to success page if they need their endpoint UUID

### 4. Error Pages

**Needed error states**:

| Error | Route | Message |
|-------|-------|---------|
| Installation cancelled | `/setup/callback?error=...` | "Installation cancelled. [Try again](/setup)" |
| OAuth denied | `/oauth/callback?error=...` | "Authorization cancelled. [Try again](/oauth/authorize)" |
| Invalid/expired token | MCP auth failure | JSON error with link to `/oauth/authorize` |
| Installation not found | `/mcp/{bad-uuid}` | JSON error (already handled) |

Most errors are already handled with JSON responses. The only HTML error pages needed are for the setup/OAuth cancellation flows.

---

## Technical Implementation

### File Structure

```
git-brain/
└── site/
    ├── content.md          # Source markdown for all page content
    ├── styles.css          # Shared styles (inlined during build)
    └── pages/
        ├── home.html       # Homepage template
        ├── success.html    # Post-install success template
        └── oauth.html      # OAuth success template
```

### Content Management

**For now**: Manual process
1. User edits `site/content.md`
2. User asks Claude to regenerate the HTML templates from the markdown
3. Claude updates the HTML files
4. User deploys with `npm run deploy`

**Future** (backlog item):
- GitHub Action that auto-generates HTML on push to `site/content.md`
- Or: Worker reads markdown at runtime and renders (adds latency but simpler)

### Routing Changes

Add to `src/index.ts` fetch handler:

```typescript
// Homepage - serve before other routes
if (url.pathname === "/" || url.pathname === "") {
  return serveHomepage(env);
}
```

### Serving Options

**Option A: Inline HTML in handler** (current pattern)
- Pros: Simple, no extra files
- Cons: Hard to maintain, no separation of concerns

**Option B: Import HTML from site/ folder** (recommended)
- Pros: Separation of content, easier to update
- Cons: Slightly more complex build

**Option C: Cloudflare Pages for static site**
- Pros: CDN caching, separate from Worker
- Cons: Two deployments to manage, more complexity

**Recommendation**: Option B — import HTML templates into the Worker. This matches the "ask Claude to update" workflow without requiring a separate deployment.

### Implementation Steps

1. Create `site/` folder structure
2. Write `content.md` with all page copy
3. Generate initial HTML templates from content
4. Add CSS with Claude-inspired aesthetic
5. Update `src/index.ts` to serve homepage at `/`
6. Update existing success/OAuth pages to use new templates
7. Deploy and test

---

## Design Specifications

### Colors

| Element | Color | Notes |
|---------|-------|-------|
| Background | `#FAF9F7` | Warm off-white (like Claude) |
| Text | `#1a1a1a` | Near-black for readability |
| Muted text | `#6b6b6b` | Secondary information |
| Primary button | `#5a67d8` | Soft indigo (not aggressive) |
| Success accent | `#38a169` | Green for confirmation states |
| Code blocks | `#f4f4f5` | Light gray background |
| Links | `#5a67d8` | Match primary color |

### Typography

- **Font**: System font stack (`system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`)
- **Headings**:
  - H1: 2rem, font-weight 600
  - H2: 1.25rem, font-weight 600
- **Body**: 1rem, line-height 1.6
- **Code**: `ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace`

### Layout

- Max-width: 600px
- Centered with `margin: 0 auto`
- Padding: 24px horizontal, 48px top
- Generous spacing between sections (32px)

### Buttons

```css
.btn-primary {
  background: #5a67d8;
  color: white;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 500;
  text-decoration: none;
  display: inline-block;
}

.btn-primary:hover {
  background: #4c51bf;
}
```

---

## Content Guidelines

### Voice & Tone

- **Conversational**: Write like you're explaining to a friend
- **Confident but humble**: We know this works, but we're not boastful
- **Concise**: Every word earns its place
- **Technical where needed**: Don't dumb down, but don't jargon-dump

### Examples

| Instead of | Write |
|------------|-------|
| "Leverage your knowledge assets" | "Use your notes" |
| "Seamlessly integrates" | "Connects" |
| "Cutting-edge AI" | "Your AI" |
| "Transform your workflow" | (just explain what it does) |

---

## Success Metrics

Not implementing analytics for MVP, but conceptually:
- Time from landing to GitHub App install
- Completion rate of OAuth step
- Successful MCP connections (harder to measure)

---

## Out of Scope (Backlog)

1. **Automated content pipeline**: Auto-generate HTML from markdown on push
2. **Account dashboard**: View/manage connected repos, revoke tokens
3. **Analytics**: Track funnel completion
4. **Marketing pages**: Pricing, features comparison, testimonials
5. **Blog/changelog**: Updates and announcements
6. **Future client mentions**: ChatGPT/Gemini support not mentioned until actually supported

---

## Open Questions

1. **Domain for static assets**: Serve from Worker or separate CDN?
   - Recommendation: Worker for simplicity, revisit if performance is an issue

2. **Logo/branding**: Do we need a Brain Stem logo?
   - Recommendation: Text-only for MVP, add later if desired

3. **Mobile responsiveness**: How important?
   - Recommendation: Basic responsive (single column works on mobile), don't over-engineer

---

## Verification

After implementation:

```bash
# Test homepage loads
curl https://brainstem.cc/

# Test setup page still works
curl https://brainstem.cc/setup

# Test OAuth flow (browser)
open https://brainstem.cc/oauth/authorize

# Verify MCP still works
curl -H "Authorization: Bearer <token>" https://brainstem.cc/mcp/<uuid>

# Run full MCP test
node test-user-mcp.mjs
```

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `site/content.md` | Create | Source content for all pages |
| `site/styles.css` | Create | Shared CSS |
| `site/pages/home.html` | Create | Homepage HTML |
| `site/pages/success.html` | Create | Post-install success HTML |
| `site/pages/oauth-success.html` | Create | OAuth success HTML |
| `src/index.ts` | Modify | Add root route, update existing page renderers |

---

## Implementation Order

1. **Create site folder and content.md** with all copy
2. **Create CSS** with Claude-inspired design
3. **Generate HTML templates** from content
4. **Add root route** in src/index.ts
5. **Update existing pages** to use new styles
6. **Deploy and test**
7. **Document** in CLAUDE.md

---

## Implementation Notes (2026-01-24)

**Approach taken:** Embedded HTML/CSS directly in `src/index.ts` rather than importing from files. This is simpler for Cloudflare Workers (no build step needed for static files) and matches the "ask Claude to update" workflow.

**Files created:**
- `site/content.md` - Source markdown for page content (reference only, not used at runtime)
- `site/styles.css` - CSS source (reference only, embedded in code)
- `site/pages/*.html` - HTML templates (reference only, embedded in code)

**Files modified:**
- `src/index.ts` - Added `SITE_STYLES` constant, `handleHomepage()`, updated all page renderers

**Key decisions:**
- `/setup` now redirects to `/` (homepage has the connect button)
- All error pages updated to use new styles
- CSS inlined in each page (simpler than external stylesheet for Worker)

**Tested:**
- Homepage loads at `https://brainstem.cc/`
- MCP endpoints still work
- Error pages display correctly
