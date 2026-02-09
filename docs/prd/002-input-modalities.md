# PRD-002: Input Modalities Beyond MCP

**Status**: Research
**Date**: 2026-02-09
**Author**: Research session

## Problem

Today, the only way to feed content into a brainstem is through the MCP connection (via `brain_inbox` / `brain_inbox_save` tools) or by pushing to the connected GitHub repo. Both require the user to be in a Claude session or at a terminal. There's no way to capture content while browsing the web, reading email, or scrolling X.

This document explores three additional input modalities — all feeding the existing inbox pipeline.

---

## 1. Email Processing

### How It Works

Cloudflare Email Routing can intercept inbound email at the MX level and route it to an Email Worker — the same Worker that runs the MCP server. A single Worker can export both `fetch()` and `email()` handlers.

### Tenant Routing

Each installation gets a unique email address:

```
brain+{uuid}@brainstem.cc
```

The Cloudflare Agents SDK has a built-in `createAddressBasedEmailResolver` that parses the sub-address (`+{uuid}`) and routes to the correct Durable Object instance. This aligns perfectly with the existing per-installation DO architecture.

Alternative: `inbox+{uuid}@brainstem.cc` or `{uuid}@brainstem.cc` (catch-all).

### Implementation Sketch

```
wrangler.toml:
  [triggers]
  email = ["*@brainstem.cc"]

Worker email() handler:
  1. Parse recipient address → extract UUID
  2. Verify installation exists in D1
  3. Parse MIME body with postal-mime (npm package)
  4. Extract subject → inbox title, body → content
  5. Write to R2 at brains/{uuid}/inbox/{timestamp}-{sanitized-subject}.md
  6. Commit to GitHub repo (same as brain_inbox_save)
  7. Trigger AI Search reindex
```

### Authentication

Email has no bearer token. Tenant identification comes from the `to` address (UUID in sub-address). This means **anyone who knows the UUID can email content into the inbox**. This is acceptable because:

- UUIDs are unguessable (128-bit random)
- The same security model applies to Craigslist relay addresses, GitHub notification addresses, and Notion email-to-page
- Optionally: verify sender email matches the GitHub account's email (but this breaks forwarding use cases)

### What the User Sees

On the success/settings page, display:

> **Email to your brain:** `brain+a1b2c3d4-e5f6-...@brainstem.cc`
> Forward any email to this address and it will appear in your inbox.

### Domain Requirements

- `brainstem.cc` must use Cloudflare DNS (already does)
- Enabling Email Routing adds MX records automatically
- **Constraint**: No other email service can be active on the domain simultaneously (no Google Workspace, etc.)

### MIME Parsing

Use `postal-mime` (recommended by Cloudflare):

| Field | Mapping |
|-------|---------|
| `subject` | → inbox note title |
| `text` (plain text body) | → note content (preferred) |
| `html` (HTML body) | → fallback, convert to markdown with Turndown |
| `from` | → metadata line at top of note |
| `date` | → note timestamp |
| `attachments` | → ignore initially; future: store in R2 |

### Limits

- 25 MiB max email size
- 200 routing rules max (not a concern with catch-all)
- Same Worker CPU/memory limits apply

### Complexity: Low

The email handler reuses the existing inbox save pipeline. New code: ~100 lines for the email handler + MIME parsing. One new npm dependency (`postal-mime`).

---

## 2. X (Twitter) Bookmarks

### API Assessment

The X Bookmarks API exists in API v2 but has significant constraints:

| Factor | Detail |
|--------|--------|
| Minimum tier | Basic ($200/month) |
| Auth | OAuth 2.0 with PKCE (per-user) |
| Scopes | `bookmark.read`, `tweet.read`, `users.read`, `offline.access` |
| Hard ceiling | 800 most recent bookmarks only |
| Rate limit | 180 GET / 15 min per user |
| Real quota | 15,000 tweet reads/month on Basic |
| Webhooks | None — polling only |
| Real-time | Not available |

### The $200/Month Problem

The X API Basic tier costs $200/month with a 15,000-tweet monthly read quota. For a multi-tenant service, this is the binding constraint — not rate limits. If 10 users each poll hourly and get 5 new bookmarks per poll, that's:

```
10 users × 24 polls/day × 5 tweets × 30 days = 36,000 tweets/month
```

This exceeds the Basic quota. Pro tier ($5,000/month) would be needed for meaningful multi-tenant use.

### Architecture Options

**Option A: Server-side polling (brainstem polls X on behalf of users)**

```
User authorizes X OAuth → brainstem stores refresh token
  → Cron trigger polls GET /2/users/{id}/bookmarks every N minutes
    → New bookmarks → write to R2 inbox → reindex
```

- Requires: X API subscription ($200+/month), OAuth consent flow, refresh token storage, cron scheduling
- Pro: Fully automatic, user does nothing after setup
- Con: Expensive, quota-constrained, 800-bookmark ceiling

**Option B: Client-side export (user runs a browser extension/script)**

User installs the open-source [Twitter Web Exporter](https://github.com/prinsss/twitter-web-exporter) UserScript, exports bookmarks as JSON/Markdown, then uploads via bookmarklet or email.

- Pro: Free, no API key needed, no 800-bookmark limit (intercepts web app's GraphQL)
- Con: Manual, requires user action, brittle (X can break it)

**Option C: iOS Shortcut or bookmarklet for individual tweets**

Instead of syncing all bookmarks, let users save individual tweets via the share sheet or bookmarklet (covered in Section 3).

### Recommendation: Defer

X Bookmarks integration is **not worth building now**:

1. **$200/month minimum** for API access is disproportionate to the value
2. **Polling-only** means infrastructure complexity (cron, token refresh, dedup)
3. **800-bookmark ceiling** means you can never get a full export
4. **X API instability** — pricing has doubled once already, terms change frequently
5. The user can accomplish 80% of the value by sharing individual tweets via the bookmarklet/share sheet (Section 3)

If demand materializes, revisit when X ships pay-per-use pricing (currently in closed beta) or if a reliable free alternative emerges.

### What to Build Instead

A generic "save this URL" input (bookmarklet/share sheet) that works for X tweets, articles, or any web page. The user taps share on a tweet → it goes to brainstem inbox with the tweet content extracted server-side.

---

## 3. Bookmarklet / Share Sheet

### Strategy: Three Surfaces, One Endpoint

Build a single `/clip` endpoint on brainstem.cc that accepts `{ url, title, text, token }` and saves to the inbox. Then expose it through three progressively richer surfaces:

| Surface | Platform | Auth | Effort |
|---------|----------|------|--------|
| **Bookmarklet** | All desktop browsers | Cookie (OAuth) | Low |
| **PWA Share Target** | Android Chrome | Cookie (OAuth) | Low |
| **iOS Shortcut** | iOS (all apps) | Bearer token in shortcut | Low |

### 3a. Bookmarklet (Desktop)

**Pattern**: Popup window (same approach as Pinboard, Instapaper, Pocket).

The bookmarklet captures metadata from the current page and opens a popup to brainstem.cc:

```javascript
javascript:void(function(){
  var t=encodeURIComponent(document.title);
  var u=encodeURIComponent(location.href);
  var s=encodeURIComponent(window.getSelection().toString().substring(0,2000));
  window.open(
    'https://brainstem.cc/clip?title='+t+'&url='+u+'&text='+s,
    'brainstem','width=550,height=420'
  );
}())
```

**Why popup, not direct fetch**: A direct `fetch()` from the bookmarklet to brainstem.cc faces CORS issues and CSP blocking on many sites. The popup window approach is immune to both — it opens a brainstem.cc page (same origin), which can freely call brainstem.cc APIs.

**Auth**: Cookie-based. First use redirects through GitHub OAuth, sets a session cookie on brainstem.cc. Subsequent uses are instant — cookie is sent with the popup page load.

**The popup page** (`/clip`):

1. Check session cookie → if missing, redirect to OAuth → come back
2. If `url` param is present, fetch the URL server-side and extract article content
3. Show preview: title, extracted content (editable), Save/Cancel buttons
4. On save: POST to `/api/clip` → writes to R2 + GitHub (reuses `brain_inbox_save` logic)
5. Show confirmation, auto-close after 2 seconds

**Content extraction pipeline** (server-side):

```
URL → fetch() → HTML
  → linkedom (lightweight DOM parser, works in Workers)
    → Readability.js (extract article content)
      → Turndown (HTML → Markdown)
        → Save as inbox note
```

This is the same pipeline used by every read-later service. `linkedom` is the right choice for Workers (JSDOM is too heavy).

### 3b. PWA Share Target (Android)

Add a `manifest.json` to brainstem.cc:

```json
{
  "name": "Brainstem",
  "short_name": "Brainstem",
  "start_url": "/clip",
  "display": "standalone",
  "share_target": {
    "action": "/clip",
    "method": "POST",
    "enctype": "multipart/form-data",
    "params": {
      "title": "title",
      "text": "text",
      "url": "url"
    }
  }
}
```

When the user shares a URL from any Android app, "Brainstem" appears in the share sheet. The shared data POSTs to `/clip`, which runs the same save pipeline.

**Requirements**: User must "install" the PWA (Add to Home Screen in Chrome). A minimal service worker must be registered.

**Platform gap**: iOS Safari does **not** support Web Share Target API. Apple has shown no intent to implement it (WebKit bug open since 2019).

### 3c. iOS Shortcut (Share Sheet)

Since Web Share Target doesn't work on iOS, an Apple Shortcut fills the gap:

1. Triggered from the share sheet (any app)
2. Extracts the shared URL
3. POSTs to `https://brainstem.cc/api/clip` with bearer token
4. Shows a notification on success

**Distribution**: Provide an iCloud link on the brainstem.cc settings page. User taps to install, enters their bearer token once.

**Limitation**: The user must manually paste their bearer token into the shortcut. There's no OAuth flow in Shortcuts (though you could build a helper page that copies the token to clipboard).

### The `/clip` Endpoint

A single new HTTP route that all three surfaces hit:

```
POST /api/clip
  Authorization: Bearer <token> OR session cookie
  Content-Type: application/json

  {
    "url": "https://example.com/article",     // required
    "title": "Article Title",                  // optional (extracted if missing)
    "text": "Selected text or note",           // optional
    "extract": true                            // optional: fetch URL and extract article
  }

Response:
  {
    "success": true,
    "path": "inbox/2026-02-09T14-30-45-article-title.md",
    "r2": true,
    "github": true
  }
```

When `extract` is true (or when `url` is present without `text`), the Worker fetches the URL, runs Readability.js, converts to Markdown, and saves the result. When `text` is provided, it saves that directly with the URL as a reference link.

### Authentication: Dual Mode

The `/clip` endpoint accepts either:
- **Bearer token** in `Authorization` header (for API clients, iOS Shortcut)
- **Session cookie** (for bookmarklet popup, PWA share target)

Both resolve to the same session/user/installation. The cookie is set during the OAuth flow on brainstem.cc. The existing session table and auth logic can be reused.

**New requirement**: A user may have multiple installations. The clip page needs to either:
- Default to the user's first/only installation
- Let the user pick which brain to save to (if they have multiple)

---

## Tenancy Considerations

### Current Model

```
User → has sessions (bearer tokens)
     → owns installations (1 user can have N installations)
         → each installation = 1 GitHub repo = 1 R2 prefix = 1 brain
```

### Impact of New Input Modalities

| Modality | Tenant Resolution |
|----------|-------------------|
| **MCP** (existing) | UUID in URL path `/mcp/{uuid}` |
| **Email** | UUID in email sub-address `brain+{uuid}@brainstem.cc` |
| **Bookmarklet** | Session cookie → user → default installation (or picker) |
| **PWA Share Target** | Session cookie → user → default installation (or picker) |
| **iOS Shortcut** | Bearer token → user → installation (need to specify) |

**For single-installation users** (the common case today), all modalities resolve unambiguously. The user has one brain, and all inputs go there.

**For multi-installation users**, we need a "default brain" concept or a selection UI. Options:
- Add a `default_installation_id` column to the `users` table
- In the bookmarklet popup, show a brain picker dropdown
- In email, the UUID in the address is explicit — no ambiguity
- For iOS Shortcut, the bearer token maps to a user, not an installation — we'd need a separate setting or a per-installation token

### Shared Infrastructure

All three new modalities feed into the same pipeline:

```
Input → authenticate → resolve installation → save to inbox
                                                  ↓
                                        R2: brains/{uuid}/inbox/{file}.md
                                        GitHub: create file via Contents API
                                        AI Search: trigger reindex
```

The `brain_inbox_save` tool's internal logic should be extracted into a shared function that all modalities call.

---

## Implementation Priority

| Phase | Modality | Effort | Value | Dependencies |
|-------|----------|--------|-------|-------------|
| **1** | Bookmarklet | Low | High | `/clip` endpoint, cookie auth, content extraction |
| **1** | iOS Shortcut | Low | High | `/api/clip` endpoint (same as above) |
| **2** | Email | Low | Medium | Cloudflare Email Routing setup, `postal-mime` |
| **2** | PWA Share Target | Low | Medium | `manifest.json`, service worker |
| **—** | X Bookmarks | High | Low | $200/month API cost, polling infra, OAuth with X |

**Phase 1 delivers the most value**: a bookmarklet for desktop and an iOS Shortcut cover the two most common "I want to save this" moments. They share the same `/clip` backend.

**Phase 2 adds convenience**: email is useful for forwarding newsletters, receipts, and notes-to-self. PWA share target covers Android users.

**X Bookmarks is deferred** until the cost/value ratio improves.

---

## New Dependencies

| Package | Purpose | Size | Workers Compatible |
|---------|---------|------|--------------------|
| `postal-mime` | MIME email parsing | ~15KB | Yes (recommended by Cloudflare) |
| `linkedom` | Lightweight DOM parser | ~50KB | Yes |
| `@mozilla/readability` | Article content extraction | ~30KB | Yes (needs DOM) |
| `turndown` | HTML → Markdown conversion | ~20KB | Yes |

All four are pure JS and known to work in Cloudflare Workers.

---

## Open Questions

1. **Multi-brain users**: Should the bookmarklet default to the most recently used brain, or always show a picker?
2. **Content extraction depth**: Should we extract full articles by default, or just save the URL + title + selected text? Full extraction is more useful but adds latency and complexity.
3. **Email abuse**: Should we rate-limit inbound email per installation? An attacker with a UUID could spam the inbox.
4. **Cookie vs. token unification**: The MCP server uses bearer tokens; the bookmarklet would use cookies. Should we unify (set a cookie during OAuth that maps to the existing session)?
5. **Shortcut distribution**: How to handle token rotation in iOS Shortcuts? If the session expires, the user has to manually update the shortcut.
6. **Extracted content format**: Save as a single markdown file with metadata (URL, author, date) in frontmatter? Or save URL and content separately?
