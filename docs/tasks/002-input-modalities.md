# Tasks: Input Modalities Build Plan

**Related**: [PRD-002](../prd/002-input-modalities.md), [ERD-001](../erd/001-input-modalities.md), [ADR-008](../adr/008-email-input.md)
**Last updated**: 2026-02-09

This is a multi-session build. Each session should complete one or more numbered groups. Tasks within a group can often be parallelized; groups should be completed in order.

---

## Phase 1: Foundation + Email

### Session 1: Schema, Shared Infra, brain_account Tool

**Goal**: D1 tables exist, inbox save logic is shared, `brain_account` tool responds to all actions (email sending stubbed).

- [ ] **1.1** Extract `saveToInbox()` from `brain_inbox_save` tool handler
  - Move R2 write + GitHub commit + reindex logic into `src/inbox.ts`
  - Function signature: `saveToInbox(env, installationId, title, content, options?)`
  - `brain_inbox_save` tool calls `saveToInbox()` internally (no behavior change)
  - Unit test: verify `saveToInbox` produces correct R2 key and calls GitHub

- [ ] **1.2** D1 migration: create new tables
  - Create `email_aliases`, `verified_senders`, `email_log` tables
  - Add `default_installation_id` column to `users` table
  - Test migration locally with `wrangler d1 execute --local`
  - Deploy migration with `wrangler d1 execute --remote`

- [ ] **1.3** Implement `brain_account` MCP tool — data layer
  - Register tool with Zod schema for all 6 actions
  - `enable_email`: create default alias row (`brain+{uuid}`), return brainstem address
  - `check_alias`: validate format + reserved words + D1 availability check
  - `request_alias`: atomic INSERT with PK conflict handling
  - `request_email`: create pending `verified_senders` row, generate `confirmation_id`
  - `remove_email`: delete from `verified_senders`
  - `status`: return email config, aliases, verified senders list

- [ ] **1.4** Alias validation logic
  - Implement `validateAlias()` with format rules, reserved words, length limits
  - Unit tests: valid aliases, invalid formats, reserved words, edge cases
  - Reserved word list: `brain, admin, support, help, info, postmaster, abuse, noreply, no-reply, webmaster, security, root, hostmaster, mailer-daemon, www, mail, ftp, api, app, dashboard, status, billing`

- [ ] **1.5** Unit tests for session 1 deliverables
  - `saveToInbox()` path generation and R2 key construction
  - `validateAlias()` comprehensive test suite
  - `brain_account` tool action routing (mock D1)

**Verification**: `npm test` passes, `npm run typecheck` passes, deploy succeeds, `brain_account` tool appears in MCP tool list via `test-user-mcp.mjs`.

---

### Session 2: Outbound Email + Confirmation Flow

**Goal**: `brain_account({ action: "request_email" })` sends a real confirmation email. Reply-based confirmation works end-to-end.

- [ ] **2.1** MailChannels send function
  - Create `src/email.ts` with `sendConfirmationEmail(to, brainstemAddress, confirmationId)`
  - Construct email with `Message-ID` header containing `confirmation_id`
  - Body: "Reply YES to confirm you want to send email to your brain at {brainstemAddress}"
  - Unit test with mocked fetch

- [ ] **2.2** DNS setup for email sending
  - Add SPF record: `v=spf1 include:_spf.mx.cloudflare.net include:relay.mailchannels.net ~all`
  - Add DKIM record for MailChannels
  - Add DMARC record: `v=DMARC1; p=none; rua=mailto:dmarc@brainstem.cc`
  - **Manual step**: User must add these DNS records via Cloudflare dashboard

- [ ] **2.3** Wire confirmation sending into `brain_account`
  - `request_email` action: after creating pending row, call `sendConfirmationEmail()`
  - Set `confirmation_expires_at` to 24 hours from now
  - Return `{ email, status: "pending", message: "Confirmation sent" }`

- [ ] **2.4** Enable Cloudflare Email Routing
  - **Manual step**: Enable Email Routing in Cloudflare dashboard for brainstem.cc
  - Add catch-all rule: `*@brainstem.cc` → Worker
  - Add `[triggers] email = ["*@brainstem.cc"]` to wrangler.toml

- [ ] **2.5** Email Worker handler — routing + confirmation matching
  - Export `email()` handler from Worker
  - Parse recipient address → resolve to installation ID (sub-address parse or alias lookup)
  - Check `In-Reply-To` header → if matches a pending `confirmation_id`, mark sender as confirmed
  - For non-confirmation emails: verify sender, then hand off to save (session 3)
  - Log all inbound email to `email_log`

- [ ] **2.6** Test confirmation flow end-to-end
  - Use `brain_account` to request email verification for a test address
  - Verify confirmation email arrives (check test inbox)
  - Reply to confirmation email
  - Verify `brain_account({ action: "status" })` shows confirmed

**Verification**: Full confirmation round-trip works. `brain_account` status reflects confirmed sender.

---

### Session 3: Inbound Email Processing

**Goal**: Forwarded emails arrive in the brain inbox (R2 + GitHub). Rate limiting works.

- [ ] **3.1** MIME parsing with `postal-mime`
  - `npm install postal-mime`
  - Create `parseInboundEmail(message)` in `src/email.ts`
  - Extract: subject, text body, HTML body, from address, date
  - If HTML-only: convert to markdown with `turndown` (`npm install turndown`)
  - Unit test with sample MIME payloads

- [ ] **3.2** Email → inbox save pipeline
  - After sender verification passes in email handler:
  - Parse MIME → extract title (subject) and content (body)
  - Prepend YAML frontmatter: `from`, `date`, `subject`, `source: email`
  - Call `saveToInbox(env, installationId, title, content)`
  - Log to `email_log` with `status: "saved"`, `inbox_path`

- [ ] **3.3** Rate limiting
  - Before saving, count today's `email_log` entries for this sender + installation
  - If > 50/sender/day or > 200/installation/day → log `status: "rate_limited"`, skip save
  - Return appropriate bounce/silent drop

- [ ] **3.4** Email log cleanup
  - After each email, delete entries older than 7 days (keep `email_log` bounded)
  - Same pattern as `webhook_logs` cleanup

- [ ] **3.5** End-to-end test: email → inbox
  - Send a real email from verified address to brainstem address
  - Verify note appears in R2 at `brains/{uuid}/inbox/...`
  - Verify note appears in GitHub repo
  - Verify AI Search reindex triggered
  - Check `brain_account status` shows recent email in activity

- [ ] **3.6** Update `about` tool and documentation
  - Mention email input in the `about` tool response
  - Update CLAUDE.md with email endpoints and architecture
  - Update `site/content.md` if brainstem.cc homepage needs changes

**Verification**: Email forwarded from verified sender appears as inbox note. Rate limiting rejects excess. `npm test` passes.

---

## Phase 2: Web Clipping

### Session 4: `/clip` API + Content Extraction

**Goal**: `POST /api/clip` saves a URL to the inbox with extracted article content.

- [ ] **4.1** Content extraction pipeline
  - `npm install linkedom @mozilla/readability turndown` (turndown may already be installed from 3.1)
  - Create `src/extract.ts` with `extractArticle(url): Promise<{ title, content, byline?, excerpt? }>`
  - Fetch URL → parse with linkedom → Readability.js → Turndown → markdown
  - Handle errors gracefully (timeouts, non-HTML responses, empty extractions)
  - Unit test with sample HTML fixtures

- [ ] **4.2** `/api/clip` POST endpoint
  - Accept JSON: `{ url, title?, text?, extract? }`
  - Auth: bearer token (header) or session cookie
  - Resolve user → installation (use `default_installation_id` or first installation)
  - If `extract: true` or `url` without `text`: run extraction pipeline
  - Format as markdown with YAML frontmatter: `url`, `title`, `date`, `source: clip`
  - Call `saveToInbox()`
  - Return `{ success, path, r2, github }`

- [ ] **4.3** Cookie-based auth for browser flows
  - On OAuth callback: set `brainstem_session={session_id}` cookie (`HttpOnly; Secure; SameSite=Lax`)
  - In auth middleware: check `Authorization: Bearer` first, fall back to `brainstem_session` cookie
  - Cookie has same expiry as session (1 year)

- [ ] **4.4** CORS headers for `/api/clip`
  - Handle OPTIONS preflight
  - `Access-Control-Allow-Origin: https://brainstem.cc` (only own origin needed for popup)
  - `Access-Control-Allow-Methods: POST, OPTIONS`
  - `Access-Control-Allow-Headers: Authorization, Content-Type`

- [ ] **4.5** Unit + integration tests
  - Content extraction with various HTML structures
  - `/api/clip` with bearer token auth
  - `/api/clip` with cookie auth
  - Error cases: invalid URL, extraction failure, unauthorized

**Verification**: `curl -X POST https://brainstem.cc/api/clip -H "Authorization: Bearer ..." -d '{"url":"...","extract":true}'` saves extracted article to inbox.

---

### Session 5: Bookmarklet + iOS Shortcut

**Goal**: User can clip web pages from desktop browser and iOS share sheet.

- [ ] **5.1** `/clip` popup page (GET)
  - HTML page served by Worker at `GET /clip?url=...&title=...&text=...`
  - Check session cookie → if missing, redirect to OAuth (with `redirect_uri=/clip?...`)
  - Show: title (editable), extracted preview (loading state → content), Save/Cancel buttons
  - On save: `fetch('/api/clip', { method: 'POST', ... })` with cookie auth
  - On success: show confirmation, auto-close after 2s
  - Minimal, clean UI consistent with brainstem.cc design language

- [ ] **5.2** Bookmarklet code
  - Generate per-user bookmarklet on a brainstem.cc page (e.g., `/tools` or `/settings`)
  - Bookmarklet captures `document.title`, `location.href`, `getSelection().toString()`
  - Opens `window.open('https://brainstem.cc/clip?url=...&title=...&text=...')`
  - Show drag-to-bookmarks-bar instruction

- [ ] **5.3** iOS Shortcut
  - Create Apple Shortcut that:
    1. Accepts share sheet input (URL)
    2. Calls `POST https://brainstem.cc/api/clip` with bearer token
    3. Shows notification on success/failure
  - Host `.shortcut` file or provide iCloud link
  - Document setup: "Open link → install shortcut → paste bearer token"

- [ ] **5.4** OAuth redirect-back for bookmarklet
  - When `/clip` redirects to OAuth, store the original `/clip?url=...` URL
  - After OAuth completes, redirect back to `/clip` with params intact
  - User sees the clip popup with their content, ready to save

- [ ] **5.5** Bookmarklet/Shortcut setup via MCP
  - Add `brain_account({ action: "get_clip_tools" })` that returns:
    - Bookmarklet JavaScript code
    - iOS Shortcut install link
    - Brainstem address (for email, as a bonus)
  - Claude can proactively offer these when the user asks about saving web content

**Verification**: Bookmarklet works from Chrome/Safari on a test page. iOS Shortcut saves a shared URL to inbox.

---

## Phase 3: Polish

### Session 6: PWA + Multi-Brain + Settings

- [ ] **6.1** PWA Share Target (Android)
  - Serve `/manifest.json` with `share_target` config
  - Register minimal service worker at `/sw.js`
  - Handle POST to `/clip` from share sheet (multipart/form-data)
  - Test on Chrome Android

- [ ] **6.2** Multi-brain picker in `/clip` popup
  - If user has multiple installations, show dropdown in clip popup
  - Default to `default_installation_id` or first installation
  - Remember last selection in localStorage

- [ ] **6.3** Tools/settings page on brainstem.cc
  - New page at `/tools` showing:
    - Brainstem email address(es)
    - Verified senders list
    - Bookmarklet (drag to bar)
    - iOS Shortcut install link
    - MCP connection config
  - Auth-gated (session cookie)

- [ ] **6.4** Update homepage and content.md
  - Add email + clip to feature list on brainstem.cc homepage
  - Update `site/content.md` to match

---

## Cross-Cutting Concerns

These apply across all phases:

- [ ] **C.1** Shared `saveToInbox()` must trigger AI Search reindex after save
- [ ] **C.2** All new endpoints need auth (bearer or cookie) — no unauthenticated writes
- [ ] **C.3** All new D1 writes need error handling (constraint violations, connection errors)
- [ ] **C.4** Email handler must not throw — all errors logged to `email_log`, never crash the Worker
- [ ] **C.5** Content extraction must have a timeout (5s) — don't let slow sites block the Worker
- [ ] **C.6** YAML frontmatter format should be consistent across email and clip sources:
  ```yaml
  ---
  source: email | clip | mcp
  url: https://... (clip only)
  from: dan@gmail.com (email only)
  date: 2026-02-09T14:30:00Z
  title: The note title
  ---
  ```

---

## Dependency Install Summary

| Package | Phase | Purpose |
|---------|-------|---------|
| `postal-mime` | 1 (Session 3) | MIME email parsing |
| `turndown` | 1 (Session 3) | HTML → Markdown (email + clip) |
| `linkedom` | 2 (Session 4) | Lightweight DOM parser for Readability |
| `@mozilla/readability` | 2 (Session 4) | Article content extraction |

---

## Manual Steps Checklist

These require human action (Cloudflare dashboard, DNS, Apple):

- [ ] Enable Cloudflare Email Routing for brainstem.cc (Session 2)
- [ ] Add SPF DNS record for MailChannels (Session 2)
- [ ] Add DKIM DNS record for MailChannels (Session 2)
- [ ] Add DMARC DNS record (Session 2)
- [ ] Verify MailChannels free-for-Workers still works (Session 2 — before committing to it)
- [ ] Create and test iOS Shortcut in Shortcuts app (Session 5)
- [ ] Upload Shortcut to iCloud for distribution (Session 5)
