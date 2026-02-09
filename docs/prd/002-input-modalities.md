# PRD-002: Input Modalities Beyond MCP

**Status**: Design Complete
**Date**: 2026-02-09
**Author**: Research session
**Related**: [ERD-001](../erd/001-input-modalities.md) | [ADR-008](../adr/008-email-input.md) | [Tasks](../tasks/002-input-modalities.md)

## Problem

Today, the only way to feed content into a brainstem is through the MCP connection (via `brain_inbox` / `brain_inbox_save` tools) or by pushing to the connected GitHub repo. Both require the user to be in a Claude session or at a terminal. There's no way to capture content while browsing the web, reading email, or scrolling X.

This document explores three additional input modalities — all feeding the existing inbox pipeline.

---

## 1. Email Processing

### How It Works

Cloudflare Email Routing can intercept inbound email at the MX level and route it to an Email Worker — the same Worker that runs the MCP server. A single Worker can export both `fetch()` and `email()` handlers.

### Brainstem Email Addresses

Each installation gets a unique email address. The default is:

```
brain+{uuid}@brainstem.cc
```

Users can optionally request a vanity address (e.g., `dan@brainstem.cc`) via the account management MCP tool (see Onboarding below). Both the default and any vanity address route to the same installation.

The Cloudflare Agents SDK has a built-in `createAddressBasedEmailResolver` that parses the sub-address and routes to the correct Durable Object instance. Vanity addresses require a lookup table in D1.

### Authentication: Sender Verification

Email has no bearer token. Instead, the Worker verifies that the sender's `From` address is on the installation's **verified senders** list. Unverified senders get a bounce or are silently dropped.

This prevents inbox spam from anyone who discovers the brainstem address — the address is the routing key, but not the auth credential.

### Onboarding: MCP-Native Email Setup

Email setup stays within the MCP conversation. The user never has to visit a settings page or configure anything outside of Claude. New MCP tool: `brain_account` (or extend `about`).

**Flow:**

```
1. User (in Claude):  "I want to forward emails to my brain"
2. Claude calls:      brain_account({ action: "request_email", email: "dan@gmail.com" })
3. Server:            - Stores email as "pending" in D1 (new verified_senders table)
                      - Sends confirmation email FROM brain+{uuid}@brainstem.cc
                        TO dan@gmail.com
                      - Subject: "Confirm your brainstem email connection"
                      - Body: "Reply YES to this email to confirm."
4. User:              Replies "yes" (or any affirmative) to the confirmation email
5. Worker email():    - Receives reply at brain+{uuid}@brainstem.cc
                      - Parses In-Reply-To header to match confirmation
                      - Updates verified_senders: status = "confirmed"
6. Claude calls:      brain_account({ action: "status" })
7. Server returns:    { email: "dan@gmail.com", status: "confirmed",
                        brainstem_address: "brain+{uuid}@brainstem.cc" }
8. Claude tells user: "You're set. Forward emails to brain+{uuid}@brainstem.cc"
```

**Why reply-based confirmation:**
- User proves they own the email address
- No magic links or codes to copy — just reply to an email
- The reply arrives at the same brainstem address, so the Worker can process it
- The `In-Reply-To` / `References` headers link the reply to the original confirmation

**Vanity alias (v1 scope):**

Vanity aliases are first-class from launch — not a bolt-on. During email setup, the user can claim a memorable address. The availability check is a separate action so Claude can confirm before claiming.

```
User:   "Can I get dan@brainstem.cc instead?"
Claude: brain_account({ action: "check_alias", alias: "dan" })
Server: - Validates format (3-30 chars, lowercase alphanum + hyphens/dots)
        - Checks reserved list (admin, support, brain, postmaster, etc.)
        - Queries D1: SELECT alias FROM email_aliases WHERE alias = 'dan'
        - Returns: { alias: "dan", available: true }
Claude: "dan@brainstem.cc is available. Want me to claim it?"
User:   "Yes"
Claude: brain_account({ action: "request_alias", alias: "dan" })
Server: - INSERT (atomic — PK constraint prevents race conditions)
        - Returns: { alias: "dan@brainstem.cc", status: "active" }
```

Both the vanity alias and the default `brain+{uuid}` address route to the same installation. The vanity alias is for sharing; the default is always available as a fallback.

### D1 Schema

See [ERD-001](../erd/001-input-modalities.md) for the full data model. Summary of new tables:

| Table | Purpose |
|-------|---------|
| `email_aliases` | Maps local-part → installation (default + vanity addresses) |
| `verified_senders` | Authorized sender emails with confirmation state |
| `email_log` | Inbound email audit trail (last 200 entries) |

Plus one column addition: `users.default_installation_id` for multi-brain `/clip` routing.

### Implementation Sketch

```
wrangler.toml:
  [triggers]
  email = ["*@brainstem.cc"]

Worker email() handler:
  1. Parse recipient address → resolve installation:
     a. If brain+{uuid}@brainstem.cc → UUID from sub-address
     b. If {alias}@brainstem.cc → lookup in email_aliases table
  2. Check if this is a confirmation reply:
     a. Parse In-Reply-To / References headers
     b. If matches a pending confirmation_id → mark sender as confirmed, done
  3. Verify sender:
     a. Extract From address
     b. Lookup in verified_senders for this installation
     c. If not confirmed → bounce or drop
  4. Parse MIME body with postal-mime (npm package)
  5. Extract subject → inbox title, body → content
  6. Write to R2 at brains/{uuid}/inbox/{timestamp}-{sanitized-subject}.md
  7. Commit to GitHub repo (same as brain_inbox_save)
  8. Trigger AI Search reindex
```

### Sending Confirmation Emails

Cloudflare Workers can send email via:
- **MailChannels API** (free for Workers, no signup) — send-only, ideal for transactional email
- **Cloudflare Email Routing** — inbound only, cannot send

MailChannels is the right fit: one transactional email per confirmation, no ongoing sending.

### What the User Sees (in Claude)

```
User: "Set up email forwarding to my brain"
Claude: "I'll set that up. What email address do you want to forward from?"
User: "dan@gmail.com"
Claude: [calls brain_account tool]
        "Done — I sent a confirmation to dan@gmail.com from your brainstem
         address. Reply to that email with 'yes' to confirm."

         Once confirmed, forward any email to:
           brain+a1b2c3d4-e5f6-...@brainstem.cc

         Want me to check if it's confirmed yet?"
```

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

### New MCP Tool: `brain_account`

Exposes email setup (and future account management) through the MCP interface:

| Action | Parameters | Description |
|--------|------------|-------------|
| `request_email` | `email` | Start email verification for a sender address |
| `request_alias` | `alias` | Request a vanity brainstem.cc address |
| `status` | — | Show current email config, verified senders, alias |
| `remove_email` | `email` | Remove a verified sender |

This keeps all account management MCP-native — no separate settings page needed.

### Complexity: Low-Medium

The email handler reuses the existing inbox save pipeline. Added scope vs. the original "UUID-as-auth" design:
- Confirmation email send/receive loop (+MailChannels integration)
- `verified_senders` and `email_aliases` D1 tables
- `brain_account` MCP tool
- Two new npm dependencies (`postal-mime`, MailChannels is a fetch call)

Estimated: ~300 lines for the email handler, verification flow, and MCP tool.

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

| Modality | Tenant Resolution | Sender Auth |
|----------|-------------------|-------------|
| **MCP** (existing) | UUID in URL path `/mcp/{uuid}` | Bearer token |
| **Email** | UUID in sub-address or alias lookup | Verified sender list |
| **Bookmarklet** | Session cookie → user → default installation | Cookie (OAuth) |
| **PWA Share Target** | Session cookie → user → default installation | Cookie (OAuth) |
| **iOS Shortcut** | Bearer token → user → installation | Bearer token |

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

## Implementation Phases

See [TASKS-002](../tasks/002-input-modalities.md) for the full task breakdown.

### Phase 1: Foundation + Email (Sessions 1-3)

Build the shared infrastructure that all modalities need, then email end-to-end.

| Deliverable | Description |
|-------------|-------------|
| Shared inbox save function | Extract from `brain_inbox_save` into reusable `saveToInbox()` |
| D1 migration | `email_aliases`, `verified_senders`, `email_log` tables + `users.default_installation_id` |
| `brain_account` MCP tool | `enable_email`, `request_email`, `check_alias`, `request_alias`, `status`, `remove_email` |
| Vanity alias system | Availability check, validation, reserved words, claim flow |
| Confirmation email sending | MailChannels integration, SPF/DKIM DNS records |
| Email Worker handler | Routing, sender verification, confirmation reply matching, MIME parsing, save |
| Email rate limiting | Per-sender and per-installation daily limits |

Email is the most architecturally interesting modality — it touches D1 schema, MCP tools, Worker email handler, and outbound email. Building it first establishes patterns that clip reuses.

### Phase 2: Web Clipping (Sessions 4-5)

| Deliverable | Description |
|-------------|-------------|
| `/api/clip` endpoint | JSON API for saving URLs + text to inbox |
| `/clip` popup page | HTML page served by Worker for bookmarklet popup |
| Cookie-based auth | Set `brainstem_session` cookie during OAuth, check in `/clip` |
| Content extraction | `linkedom` + Readability.js + Turndown pipeline |
| Bookmarklet generator | Page on brainstem.cc that shows the user their bookmarklet |
| iOS Shortcut | `.shortcut` file + iCloud distribution link |

### Phase 3: Polish (Session 6)

| Deliverable | Description |
|-------------|-------------|
| PWA Share Target | `manifest.json`, service worker, Android share sheet |
| Multi-brain picker | Brain selection in `/clip` popup for multi-installation users |
| Bookmarklet settings page | Show brainstem address, bookmarklet, shortcut link |

### Deferred

| Item | Reason |
|------|--------|
| X Bookmarks | $200/month API cost, polling complexity, 800-bookmark ceiling |
| Browser extension | High effort (multi-platform review), bookmarklet covers 90% |

**X Bookmarks**: Users can save individual tweets via the bookmarklet/share sheet. Revisit if X ships affordable API pricing.

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

## Resolved Decisions

1. **Vanity aliases in v1**: Yes — first-class from launch, not a bolt-on. Availability check via `check_alias` action.
2. **Alias rules**: First-come-first-served, 1 vanity alias per installation (v1), reserved words enforced, 3-30 chars lowercase alphanumeric + hyphens/dots.
3. **Email rate limiting**: Yes — 50/day per sender, 200/day per installation, enforced via `email_log` count.
4. **Cookie vs. token**: Dual-mode. Cookie (`brainstem_session`) for browser-based flows, bearer token for API/Shortcut. Both resolve to same session table.
5. **Multi-brain default**: `users.default_installation_id` column. Null = oldest installation. Settable via `brain_account` tool.

## Open Questions

1. **Content extraction depth**: Should we extract full articles by default, or just save the URL + title + selected text? Full extraction is more useful but adds latency (~2-5s) and Worker CPU time.
2. **Extracted content format**: Markdown with YAML frontmatter (URL, author, date, source) seems right. Confirm format before building.
3. **MailChannels availability**: Verify current free-for-Workers status before depending on it. Backup: Resend ($0 for <100 emails/day), or Cloudflare's own Email Sending Workers if available.
4. **Confirmation UX for non-reply clients**: Some email clients make replying awkward. Consider including a magic link in the confirmation email as a fallback (adds one HTTP endpoint).
5. **Shortcut token rotation**: iOS Shortcuts store the bearer token. If the session expires (1 year), the user must manually update. Consider: could the shortcut auto-refresh by hitting an endpoint?
6. **Alias reclamation**: Should inactive vanity aliases be reclaimed after N months? Not urgent for v1 but worth deciding before the namespace fills up.
