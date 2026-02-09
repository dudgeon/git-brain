# ADR-008: Email Input with MCP-Native Onboarding

**Status:** Accepted
**Date:** 2026-02-09
**Related:** PRD-002, ADR-004 (MCP Apps UI)

## Context

We want to let users forward emails to their brainstem inbox. This requires solving three problems:

1. **Routing**: Inbound email must reach the correct installation's Durable Object
2. **Authentication**: We must verify the sender is authorized (email has no bearer token)
3. **Onboarding**: Users need a way to set up email forwarding and verify their address

The key design constraint is: **onboarding should stay MCP-native**. The user should be able to set up email forwarding entirely within a Claude conversation, without visiting a settings page.

## Decision

### Email Infrastructure: Cloudflare Email Routing + Workers

Cloudflare Email Routing delivers inbound email to the Worker's `email()` handler. This is zero-cost, requires no external SMTP service, and runs in the same Worker that handles MCP.

**wrangler.toml addition:**
```toml
[triggers]
email = ["*@brainstem.cc"]
```

The `email()` handler receives a `ForwardableEmailMessage` with headers, `from`, `to`, and a readable stream for the body.

### Routing: Alias-Based with D1 Lookup

Every installation gets a default address: `brain+{uuid}@brainstem.cc`. Users can also claim a vanity alias: `{name}@brainstem.cc`.

Both routes resolve to an installation ID:

```
brain+{uuid}@brainstem.cc  →  parse sub-address  →  installation UUID
{alias}@brainstem.cc       →  D1 lookup          →  installation UUID
```

The `email_aliases` table stores both types. Default aliases are created when email is first enabled (via `brain_account` tool). Vanity aliases are user-requested.

**Why alias table for defaults too**: Having both types in one table simplifies routing — the email handler always checks `email_aliases` first. If no match, it tries parsing `brain+{uuid}` as a fallback for installations that haven't explicitly enabled email yet (future-proofing).

### Authentication: Verified Sender List

The sender's `From` address must be on the installation's `verified_senders` list. Verification uses a reply-based confirmation flow, entirely MCP-driven.

**Why sender verification over UUID-as-auth:**
- The brainstem address is a routing key, not a secret. It appears in email headers, forwarding rules, and possibly auto-complete.
- Sender verification lets users share their brainstem address publicly (e.g., in an email signature) without opening the inbox to arbitrary senders.
- It's the same model as mailing list subscriptions — prove you own the address, then you're authorized.

**Why reply-based confirmation over link-based:**
- The reply arrives at the same brainstem address, so the Worker processes it — no separate callback endpoint needed.
- Users prove they can both send and receive at the address.
- Reply-to is a natural interaction; clicking a link requires context-switching to a browser.
- Fallback: if reply-based confirmation is awkward for some mail clients, we can add a link-based option later (the confirmation email can include both).

### Onboarding: `brain_account` MCP Tool

A new MCP tool exposes account management within the Claude conversation:

```typescript
server.tool("brain_account", {
  action: z.enum([
    "enable_email",       // Enable email + create default alias
    "request_email",      // Add a verified sender
    "check_alias",        // Check vanity alias availability
    "request_alias",      // Claim a vanity alias
    "remove_email",       // Remove a verified sender
    "status",             // Show email config
  ]),
  email: z.string().email().optional(),
  alias: z.string().optional(),
});
```

**Full flow — enabling email for the first time:**

```
1. User:    "I want to forward emails to my brain"
2. Claude → brain_account({ action: "enable_email" })
3. Server:  - Creates email_aliases row: alias="brain+{uuid}", type="default"
            - Returns: { brainstem_address: "brain+{uuid}@brainstem.cc",
                         status: "enabled", verified_senders: [] }
4. Claude:  "Email is enabled! Your brainstem address is brain+{uuid}@brainstem.cc.
             What email address will you be forwarding from?"
5. User:    "dan@gmail.com"
6. Claude → brain_account({ action: "request_email", email: "dan@gmail.com" })
7. Server:  - Creates verified_senders row: status="pending", confirmation_id={uuid}
            - Sends confirmation email FROM brain+{uuid}@brainstem.cc TO dan@gmail.com
            - Returns: { email: "dan@gmail.com", status: "pending" }
8. Claude:  "I sent a confirmation email to dan@gmail.com. Reply 'yes' to that email
             to verify your address. I can check the status whenever you're ready."
9. User:    (replies "yes" to the confirmation email)
10. Worker: email() handler receives reply, matches In-Reply-To → confirmation_id,
            updates verified_senders: status="confirmed"
11. User:   "Did it work?"
12. Claude → brain_account({ action: "status" })
13. Server: Returns: { brainstem_address: "brain+{uuid}@brainstem.cc",
                       verified_senders: [{ email: "dan@gmail.com", status: "confirmed" }] }
14. Claude: "Confirmed! dan@gmail.com is verified. Forward any email to
             brain+{uuid}@brainstem.cc and it'll show up in your inbox."
```

**Vanity alias flow:**

```
1. User:    "Can I get dan@brainstem.cc?"
2. Claude → brain_account({ action: "check_alias", alias: "dan" })
3. Server:  - Validates format (3-30 chars, lowercase alphanumeric + hyphens/dots)
            - Checks reserved list
            - Queries D1: SELECT alias FROM email_aliases WHERE alias = 'dan'
            - Returns: { alias: "dan", available: true }
4. Claude:  "dan@brainstem.cc is available! Want me to claim it?"
5. User:    "Yes"
6. Claude → brain_account({ action: "request_alias", alias: "dan" })
7. Server:  - INSERT into email_aliases (atomic, PK constraint prevents race)
            - Returns: { alias: "dan@brainstem.cc", status: "active" }
8. Claude:  "Done! Your brainstem address is now dan@brainstem.cc.
             Both dan@brainstem.cc and brain+{uuid}@brainstem.cc work."
```

### Sending Confirmation Emails

The Worker needs to send one transactional email per verification request. Options evaluated:

| Option | Cost | Setup | Workers-native |
|--------|------|-------|----------------|
| MailChannels API | Free (for Workers) | SPF record only | Yes |
| Cloudflare Email Routing | N/A | N/A | Inbound only |
| SES / Resend / Postmark | ~$0.001/email | API key + domain verification | External |

**Decision: MailChannels for v1.** Free, no signup, works from Workers via `fetch()`. Requires adding an SPF record for `brainstem.cc` that includes MailChannels. If MailChannels availability becomes unreliable, swap to Resend (simple API, $0/month for <100 emails/day).

**SPF record addition:**
```
v=spf1 include:_spf.mx.cloudflare.net include:relay.mailchannels.net ~all
```

**DKIM**: MailChannels supports DKIM signing via a DNS TXT record. Required for deliverability. Set up a `mailchannels._domainkey.brainstem.cc` TXT record with the DKIM public key.

### Inbound Email Processing

Once routing and sender auth pass, the email body is processed:

1. Parse MIME with `postal-mime`
2. Extract `subject` → title, `text` or `html` → content
3. If HTML only, convert to markdown with `turndown`
4. Prepend metadata block:
   ```
   ---
   from: dan@gmail.com
   date: 2026-02-09T14:30:00Z
   subject: Meeting notes from today
   source: email
   ---
   ```
5. Save via shared inbox pipeline (R2 + GitHub + reindex)

### Rate Limiting

Even with sender verification, a compromised email account could flood the inbox. Defense:

- **Per-sender**: Max 50 emails/day per verified sender per installation
- **Per-installation**: Max 200 emails/day total
- **Enforcement**: Check `email_log` count in the email handler before saving
- **Soft limit**: Excess emails are logged with status `rate_limited` but not saved

## Alternatives Considered

### 1. UUID-as-Auth (No Sender Verification)

Anyone who knows `brain+{uuid}@brainstem.cc` can send to the inbox. Relies on UUID unguessability.

**Rejected.** The address will appear in forwarding rules, email headers, and potentially auto-complete. While UUIDs are hard to guess, they're not hard to discover once shared. Sender verification adds minimal complexity and meaningful protection.

### 2. Settings Page for Email Setup

A web UI at `brainstem.cc/settings` where users configure email, verify senders, and claim aliases.

**Rejected.** Breaks the MCP-native principle. Users would need to leave Claude, navigate to a settings page, and context-switch. The MCP tool approach keeps everything in the conversation. A settings page could be added later as a secondary interface.

### 3. Magic Link Confirmation (Instead of Reply-Based)

Confirmation email contains a link to `brainstem.cc/confirm/{id}`. User clicks to verify.

**Not rejected, but deferred.** Reply-based is simpler (no new HTTP endpoint, no browser required). Magic link can be added as a fallback in the confirmation email body if reply-based proves problematic.

### 4. GitHub-Email Matching (Auto-Verify)

Automatically verify sender if their email matches the GitHub account's primary or verified emails.

**Rejected for v1.** Requires storing and checking GitHub email addresses (privacy concern), breaks for users who forward from non-GitHub addresses, and adds a hidden auto-verify path that's hard to reason about. Users should explicitly add senders. Could be offered as a convenience later: "Your GitHub email dan@gmail.com can be auto-verified — add it?"

## Consequences

### Positive
- Email input works from any email client (mobile, desktop, web)
- Onboarding is conversational and stays within Claude
- Sender verification prevents unauthorized inbox writes
- Vanity aliases make addresses memorable and shareable
- Same inbox pipeline for all input modalities (MCP, email, clip)
- No external email service dependency (Cloudflare Email Routing is free)

### Negative
- Reply-based confirmation adds one async step to onboarding
- MailChannels dependency for outbound email (free tier reliability unclear)
- Email aliases are global namespace — potential for squatting
- MIME parsing adds a dependency (`postal-mime`)

### Risks
- **MailChannels deprecation**: They've paused new free-for-Workers signups before. Mitigation: keep the send function swappable, have Resend as backup.
- **Email deliverability**: Confirmation emails may land in spam without proper SPF/DKIM/DMARC. Mitigation: full DNS authentication setup before launch.
- **Alias squatting**: Users could claim vanity aliases they don't use. Mitigation: v1 limits to 1 vanity alias per installation. Future: inactive alias reclamation after 6 months.
