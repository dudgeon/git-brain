# ERD-001: Input Modalities Data Model

**Date**: 2026-02-09
**Related**: PRD-002, ADR-008

This document defines the data model changes required to support email processing, web clipping (bookmarklet/share sheet), and the `brain_account` MCP tool.

---

## Existing Tables (Unchanged)

```
┌─────────────────────────────┐
│ users                       │
├─────────────────────────────┤
│ id TEXT PK                  │  ← UUID v4
│ github_user_id INTEGER UQ   │
│ github_login TEXT           │
│ created_at TEXT             │
│ last_login_at TEXT          │
└──────────┬──────────────────┘
           │ 1
           │
           │ N
┌──────────▼──────────────────┐     ┌─────────────────────────────┐
│ sessions                    │     │ installations               │
├─────────────────────────────┤     ├─────────────────────────────┤
│ id TEXT PK (= bearer token) │     │ id TEXT PK                  │ ← UUID v4
│ user_id TEXT FK→users       │     │ github_installation_id INT  │
│ github_access_token TEXT    │     │ account_login TEXT          │
│ created_at TEXT             │     │ account_type TEXT           │
│ expires_at TEXT             │     │ repo_full_name TEXT         │
└─────────────────────────────┘     │ created_at TEXT             │
                                    │ last_sync_at TEXT           │
                                    │ user_id TEXT FK→users       │
                                    └──────────┬──────────────────┘
                                               │
                                    (new tables below hang off installations)
```

---

## New Tables

### `email_aliases`

Maps vanity addresses and the default `brain+{uuid}` address to installations. Every installation gets a row with `type='default'` on creation. Users can add a vanity alias via the `brain_account` MCP tool.

```
┌───────────────────────────────────────────────────────────────┐
│ email_aliases                                                 │
├───────────────────────────────────────────────────────────────┤
│ alias TEXT PK                 │ "dan" or "brain+{uuid}"       │
│ installation_id TEXT FK       │ → installations.id            │
│ type TEXT NOT NULL            │ 'default' | 'vanity'          │
│ created_at TEXT NOT NULL      │                               │
└───────────────────────────────────────────────────────────────┘

UNIQUE(alias)
INDEX idx_alias_installation ON email_aliases(installation_id)
```

**Design notes:**
- The `alias` column stores just the local part (before `@brainstem.cc`)
- Default aliases (`brain+{uuid}`) are auto-created when email is first enabled
- Vanity aliases (`dan`) are user-requested, first-come-first-served
- An installation can have at most one vanity alias (enforced in application logic, not schema — allows future relaxation)
- The `type` column distinguishes default from vanity for display and cleanup

**Reserved aliases** (enforced in application logic):
```
brain, admin, support, help, info, postmaster, abuse, noreply,
no-reply, webmaster, security, root, hostmaster, mailer-daemon
```

### `verified_senders`

Tracks which external email addresses are authorized to send email into a given brain. Populated via the MCP confirmation flow.

```
┌───────────────────────────────────────────────────────────────┐
│ verified_senders                                              │
├───────────────────────────────────────────────────────────────┤
│ id TEXT PK                    │ UUID v4                       │
│ installation_id TEXT FK       │ → installations.id            │
│ email TEXT NOT NULL           │ e.g., "dan@gmail.com"         │
│ status TEXT NOT NULL          │ 'pending' | 'confirmed'       │
│ confirmation_id TEXT          │ UUID for matching reply        │
│ confirmation_expires_at TEXT  │ 24h TTL for confirmation      │
│ created_at TEXT NOT NULL      │                               │
│ confirmed_at TEXT             │                               │
└───────────────────────────────────────────────────────────────┘

UNIQUE(installation_id, email)
INDEX idx_sender_confirmation ON verified_senders(confirmation_id)
INDEX idx_sender_status ON verified_senders(installation_id, status)
```

**Design notes:**
- `confirmation_id` is a UUID embedded in the outbound confirmation email's `Message-ID` header. When the user replies, the `In-Reply-To` header contains this UUID, allowing the Worker to match the reply.
- `confirmation_expires_at` prevents stale pending records from being confirmed weeks later. Default: 24 hours.
- A given email can be a verified sender for multiple installations (a user might forward from the same address to multiple brains).
- Expired pending records are cleaned up lazily (on next `request_email` call or via periodic cleanup).

### `email_log`

Lightweight audit log for inbound emails. Useful for debugging delivery issues and rate limiting.

```
┌───────────────────────────────────────────────────────────────┐
│ email_log                                                     │
├───────────────────────────────────────────────────────────────┤
│ id INTEGER PK AUTOINCREMENT  │                               │
│ received_at TEXT NOT NULL     │ ISO 8601                      │
│ installation_id TEXT          │ → installations.id (nullable) │
│ from_address TEXT             │ sender                        │
│ to_address TEXT               │ recipient                     │
│ subject TEXT                  │ truncated to 200 chars         │
│ status TEXT NOT NULL          │ see below                     │
│ error TEXT                    │ error detail (nullable)       │
│ inbox_path TEXT               │ R2 path if saved (nullable)   │
└───────────────────────────────────────────────────────────────┘

-- Keep only last 200 entries (same pattern as webhook_logs)
```

**Status values:** `saved`, `confirmed` (sender verification reply), `rejected_sender`, `rejected_unroutable`, `error`

---

## Relationships Diagram

```
users ──1:N──▶ sessions
  │
  └──1:N──▶ installations
                │
                ├──1:N──▶ email_aliases        (default + vanity addresses)
                │
                ├──1:N──▶ verified_senders     (who can email into this brain)
                │
                └──1:N──▶ email_log            (inbound email audit trail)
```

---

## Users Table Addition

```sql
-- Add to existing users table (migration)
ALTER TABLE users ADD COLUMN default_installation_id TEXT;
```

This column is nullable. When null, the system picks the user's first (oldest) installation. Primarily a forward-looking addition for future modalities (web clipping, share sheet) where the user session doesn't inherently specify which brain to target. For email, routing is always unambiguous (the recipient address maps to one installation).

---

## R2 Path Structure (Unchanged)

All input modalities write to the same R2 prefix:

```
brains/{uuid}/inbox/{timestamp}-{sanitized-title}.md
```

The save pipeline is shared. Source metadata varies by modality:

| Modality | Title Source | Content Source |
|----------|-------------|----------------|
| MCP (`brain_inbox_save`) | Tool parameter | Tool parameter |
| Email | Subject line | Email body (text or HTML→markdown) |
| Bookmarklet/Share | Page title or user input | Extracted article or selected text |

---

## Migration Plan

New tables are additive — no existing data is modified. A single D1 migration script:

```sql
-- Migration: 002_email_and_clip.sql

CREATE TABLE IF NOT EXISTS email_aliases (
  alias TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'vanity',
  created_at TEXT NOT NULL,
  FOREIGN KEY (installation_id) REFERENCES installations(id)
);

CREATE TABLE IF NOT EXISTS verified_senders (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  confirmation_id TEXT,
  confirmation_expires_at TEXT,
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  FOREIGN KEY (installation_id) REFERENCES installations(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sender_unique
  ON verified_senders(installation_id, email);
CREATE INDEX IF NOT EXISTS idx_sender_confirmation
  ON verified_senders(confirmation_id);

CREATE TABLE IF NOT EXISTS email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at TEXT NOT NULL,
  installation_id TEXT,
  from_address TEXT,
  to_address TEXT,
  subject TEXT,
  status TEXT NOT NULL,
  error TEXT,
  inbox_path TEXT
);

-- Users table addition for clip default brain
-- Note: D1 supports ALTER TABLE ADD COLUMN
ALTER TABLE users ADD COLUMN default_installation_id TEXT;
```

---

## Vanity Alias Availability Check

The `brain_account` tool's `check_alias` and `request_alias` actions need to validate alias availability. The check is a simple D1 query:

```sql
SELECT alias FROM email_aliases WHERE alias = ? LIMIT 1
```

Combined with reserved-word filtering in application logic:

```typescript
const RESERVED_ALIASES = new Set([
  'brain', 'admin', 'support', 'help', 'info', 'postmaster',
  'abuse', 'noreply', 'no-reply', 'webmaster', 'security',
  'root', 'hostmaster', 'mailer-daemon', 'www', 'mail', 'ftp',
  'api', 'app', 'dashboard', 'status', 'billing',
]);

function validateAlias(alias: string): { valid: boolean; reason?: string } {
  // Length: 3-30 characters
  if (alias.length < 3 || alias.length > 30) {
    return { valid: false, reason: 'Alias must be 3-30 characters' };
  }
  // Characters: lowercase alphanumeric, hyphens, dots (no leading/trailing)
  if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(alias)) {
    return { valid: false, reason: 'Alias must be lowercase letters, numbers, hyphens, or dots' };
  }
  // No consecutive dots or hyphens
  if (/[.-]{2,}/.test(alias)) {
    return { valid: false, reason: 'No consecutive dots or hyphens' };
  }
  // Reserved words
  if (RESERVED_ALIASES.has(alias)) {
    return { valid: false, reason: `"${alias}" is reserved` };
  }
  // Must not start with "brain+" (reserved for default addresses)
  if (alias.startsWith('brain+')) {
    return { valid: false, reason: 'Cannot start with "brain+"' };
  }
  return { valid: true };
}
```

The `check_alias` action is read-only and returns availability without claiming. The `request_alias` action atomically checks + creates. A race condition is possible but harmless — D1 will reject the duplicate due to the PRIMARY KEY constraint, and the tool returns "already taken."
