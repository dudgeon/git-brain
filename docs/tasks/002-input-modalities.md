# Tasks: Email Input Build Plan

**Related**: [PRD-002](../prd/002-input-modalities.md), [ERD-001](../erd/001-input-modalities.md), [ADR-008](../adr/008-email-input.md)
**Last updated**: 2026-02-09

This is a 3-session build. Each session should complete one numbered group. Tasks within a group can often be parallelized; groups should be completed in order.

---

## Session 1: Schema, Shared Infra, brain_account Tool

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

## Session 2: Outbound Email + Confirmation Flow

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

## Session 3: Inbound Email Processing

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

## Cross-Cutting Concerns

- [ ] **C.1** Shared `saveToInbox()` must trigger AI Search reindex after save
- [ ] **C.2** Email handler must not throw — all errors logged to `email_log`, never crash the Worker
- [ ] **C.3** All new D1 writes need error handling (constraint violations, connection errors)
- [ ] **C.4** YAML frontmatter format for email-sourced notes:
  ```yaml
  ---
  source: email
  from: dan@gmail.com
  date: 2026-02-09T14:30:00Z
  subject: The email subject
  ---
  ```

---

## Dependency Install Summary

| Package | Session | Purpose |
|---------|---------|---------|
| `postal-mime` | 3 | MIME email parsing |
| `turndown` | 3 | HTML → Markdown (for HTML-only emails) |

---

## Manual Steps Checklist

These require human action (Cloudflare dashboard, DNS):

- [ ] Enable Cloudflare Email Routing for brainstem.cc (Session 2)
- [ ] Add SPF DNS record for MailChannels (Session 2)
- [ ] Add DKIM DNS record for MailChannels (Session 2)
- [ ] Add DMARC DNS record (Session 2)
- [ ] Verify MailChannels free-for-Workers still works (Session 2 — before committing to it)
