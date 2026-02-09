# PRD-002: Email Input

**Status**: Design Complete
**Date**: 2026-02-09
**Author**: Research session
**Related**: [ERD-001](../erd/001-input-modalities.md) | [ADR-008](../adr/008-email-input.md) | [Tasks](../tasks/002-email-input.md)

## Problem

Today, the only way to feed content into a brainstem is through the MCP connection (via `brain_inbox` / `brain_inbox_save` tools) or by pushing to the connected GitHub repo. Both require the user to be in a Claude session or at a terminal. There's no way to capture content while reading email, and no way to quickly forward a newsletter, receipt, or note-to-self into the brain.

This document covers email as the first new input modality. Other modalities (bookmarklet, share sheet, X bookmarks) are documented in the [research appendix](#appendix-other-modalities-research) and tracked in the [backlog](../BACKLOG.md) for future builds.

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

Plus one column addition: `users.default_installation_id` for future multi-brain routing.

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

## Tenancy

### Current Model

```
User → has sessions (bearer tokens)
     → owns installations (1 user can have N installations)
         → each installation = 1 GitHub repo = 1 R2 prefix = 1 brain
```

### Email Tenant Resolution

| Modality | Tenant Resolution | Sender Auth |
|----------|-------------------|-------------|
| **MCP** (existing) | UUID in URL path `/mcp/{uuid}` | Bearer token |
| **Email** | UUID in sub-address or alias lookup | Verified sender list |

Email routing is unambiguous — the recipient address maps directly to one installation. No "default brain" concept needed for this build.

### Shared Infrastructure

Email feeds into the same inbox pipeline as MCP:

```
Inbound email → verify sender → resolve installation → save to inbox
                                                           ↓
                                                 R2: brains/{uuid}/inbox/{file}.md
                                                 GitHub: create file via Contents API
                                                 AI Search: trigger reindex
```

The `brain_inbox_save` tool's internal logic should be extracted into a shared `saveToInbox()` function that both MCP and email call.

---

## Build Plan

See [TASKS-002](../tasks/002-email-input.md) for the full task breakdown (3 sessions).

| Session | Goal |
|---------|------|
| **1** | D1 tables, shared `saveToInbox()`, `brain_account` MCP tool with alias validation |
| **2** | MailChannels outbound, confirmation flow, email Worker handler (routing + confirmation matching) |
| **3** | MIME parsing, inbound save pipeline, rate limiting, e2e test, docs |

### Deliverables

| Deliverable | Description |
|-------------|-------------|
| Shared inbox save function | Extract from `brain_inbox_save` into reusable `saveToInbox()` |
| D1 migration | `email_aliases`, `verified_senders`, `email_log` tables + `users.default_installation_id` |
| `brain_account` MCP tool | `enable_email`, `request_email`, `check_alias`, `request_alias`, `status`, `remove_email` |
| Vanity alias system | Availability check, validation, reserved words, claim flow |
| Confirmation email sending | MailChannels integration, SPF/DKIM DNS records |
| Email Worker handler | Routing, sender verification, confirmation reply matching, MIME parsing, save |
| Email rate limiting | Per-sender and per-installation daily limits |

---

## New Dependencies

| Package | Purpose | Size | Workers Compatible |
|---------|---------|------|--------------------|
| `postal-mime` | MIME email parsing | ~15KB | Yes (recommended by Cloudflare) |
| `turndown` | HTML → Markdown conversion | ~20KB | Yes |

---

## Resolved Decisions

1. **Vanity aliases in v1**: Yes — first-class from launch, not a bolt-on. Availability check via `check_alias` action.
2. **Alias rules**: First-come-first-served, 1 vanity alias per installation (v1), reserved words enforced, 3-30 chars lowercase alphanumeric + hyphens/dots.
3. **Email rate limiting**: Yes — 50/day per sender, 200/day per installation, enforced via `email_log` count.
4. **Email-only scope**: Web clipping (bookmarklet, share sheet, iOS Shortcut) is a separate future build. See [backlog](../BACKLOG.md).

## Open Questions

1. **MailChannels availability**: Verify current free-for-Workers status before depending on it. Backup: Resend ($0 for <100 emails/day), or Cloudflare's own Email Sending Workers if available.
2. **Confirmation UX for non-reply clients**: Some email clients make replying awkward. Consider including a magic link in the confirmation email as a fallback (adds one HTTP endpoint).
3. **Alias reclamation**: Should inactive vanity aliases be reclaimed after N months? Not urgent for v1 but worth deciding before the namespace fills up.

---

## Appendix: Other Modalities (Research)

The following modalities were researched alongside email but are **out of scope for this build**. They are tracked in the [backlog](../BACKLOG.md) as separate future work.

### Web Clipping (Bookmarklet / Share Sheet / iOS Shortcut)

Build a `/clip` endpoint that accepts `{ url, title, text }` and saves to the inbox with optional server-side article extraction (Readability.js + Turndown). Three surfaces:

- **Bookmarklet**: Popup window pattern (like Pinboard). Cookie-based auth. Works on all desktop browsers.
- **PWA Share Target**: `manifest.json` with `share_target`. Android only (iOS doesn't support Web Share Target API).
- **iOS Shortcut**: Apple Shortcut with share sheet trigger, POSTs to `/api/clip` with bearer token.

Content extraction pipeline: `fetch URL → linkedom → Readability.js → Turndown → markdown`

Additional dependencies: `linkedom`, `@mozilla/readability`

### X (Twitter) Bookmarks

**Deferred.** X API Basic tier costs $200/month with a 15,000 tweet/month read quota and 800-bookmark ceiling. Polling-only (no webhooks). The cost/value ratio is poor. Users can save individual tweets via the bookmarklet/share sheet instead.
