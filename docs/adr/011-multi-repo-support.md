# ADR-011: Multiple Repository Support (Repo = Brain)

**Status:** Accepted
**Date:** 2026-06-20
**Related:** [PRD-003](../prd/003-multi-repo-support.md), [Tasks-004](../tasks/004-multi-repo-support.md), ADR-001 (GitHub App), ADR-002 (Security Isolation)

## Context

A "brain" is currently 1:1 with a GitHub App installation, and `handleSetupCallback` syncs only the first repo (`repos[0]`, `src/index.ts:1609`). A user therefore cannot connect a second repository as a separate, isolated brain — especially not when both repos live under the same GitHub account (one App install per account). Several write/discovery surfaces also resolve the user's installation with `... LIMIT 1`, which is already non-deterministic for anyone owning more than one installation today.

The driving requirement: **connect multiple repos and keep each as a separate, non-commingled brain, accessed one at a time** (not merged into a single corpus).

The full surface map, options analysis, data model, and test plan live in [PRD-003](../prd/003-multi-repo-support.md). This ADR records the decisions.

## Decision

### 1. A brain is one repository (Option A)

Decouple "brain" from "GitHub installation." The `installations` table moves from one-row-per-installation to **one-row-per-(installation, repo)**. The row's `id` (UUID) remains the brain identity: the R2 prefix (`brains/{uuid}/`), the MCP URL (`/mcp/{uuid}`), the AI Search folder filter, and the email sub-address all stay keyed on it.

**Why Option A over a multi-repo-in-one-brain model (Option B):**
- It directly satisfies "don't commingle / access one, not the other."
- Because every isolation primitive and all 8 MCP tools already key on the brain UUID, the **entire tool layer, R2 layout, AI Search filter, and email routing are unchanged.** Option B would require rewriting every tool, changing the R2 layout, and migrating existing data — for a weaker isolation story.
- It works for same-account multi-repo (multiple brain rows share one `github_installation_id`).

A future "merged brain spanning repos" (Option C) remains possible additively (a `brain_repos` join table) without invalidating this model.

### 2. Onboarding auto-creates a brain per accessible repo (Q2)

`handleSetupCallback` iterates **all** repos the installation can access and creates a brain (+ background `syncRepo`) for each, instead of just `repos[0]`. The existing-install short-circuit becomes repo-aware (dedupe on `(github_installation_id, repo_full_name)`). The success page lists every resulting `/mcp/{uuid}` URL.

### 3. Lifecycle is repo-aware

- **Push webhook** resolves the brain by `github_installation_id` **and** `payload.repository.full_name` (today it uses `.first()` on the installation — wrong with multiple repos).
- **`installation_repositories`** webhook (added/removed) is now handled: added repos create brains, removed repos delete their brain.
- **Uninstall** (`installation.deleted`) deletes **all** brains sharing that `github_installation_id`, not just one.

### 4. A user-designated default brain is the write target (Q3)

This is the one decision that deviated from the recommendation. Web clip (`/api/clip`) and the bookmarklet resolve the user's **default brain** rather than `... LIMIT 1`.

- New column `is_default_for_user INTEGER DEFAULT 0` on `installations`. Exactly one default per `user_id`, enforced in code.
- The first brain created for a user is auto-defaulted; deleting the default promotes the most-recently-created remaining brain.
- The OAuth success / brains page gets a "Set as default" control (`setDefaultBrainForUser`). No new MCP tool.
- Clip payloads may include an optional explicit `brain`/`installation` override.

Email is unaffected by this default: every inbound email is already addressed to a specific brain via its sub-address or alias.

### 5. Brains stay strictly isolated — no cross-brain search (Q4)

No aggregate search endpoint/tool. Each `/mcp/{uuid}` sees only its own brain. This preserves the segregation guarantee.

### 6. Vanity aliases are scoped per brain (Q5)

`handleRequestAlias` uniqueness/scoping changes from per-installation to per-brain, so a user can route `work@brainstem.cc` → Brain A and `home@brainstem.cc` → Brain B.

### 7. Brains are labeled by `repo_full_name` (Q6)

No nickname column in v1. The repo full name is the human-facing label on the success/brains page.

### 8. Existing extra repos are backfilled on deploy (Q7)

A one-off script materializes brains (+ sync) for repos that were granted to existing installs but never synced because of the old `repos[0]` behavior.

## Consequences

**Positive**
- Solves the stated need with the smallest blast radius: tool layer, R2, AI Search, and email routing untouched.
- Fixes present-tense bugs: arbitrary-brain `LIMIT 1` selection (BUG-7) and the silent `repos[0]` drop (BUG-6).
- Schema change is additive (one index + one column) — safe to apply live; trivially reversible.

**Negative / trade-offs**
- Users who'd prefer one merged knowledge base across repos get many small brains/URLs instead. Mitigated by the per-user default brain and the all-brains success page; a true merged brain is deferred (Option C).
- The `installations` table name becomes a misnomer ("brain"). Renaming is deferred to avoid a high-churn migration; semantics are documented in PRD-003 §4.
- A single-default-per-user invariant must be maintained in application code (SQLite lacks a convenient partial unique constraint for it).

**Follow-ups / ops**
- Confirm the GitHub App is subscribed to the `installation_repositories` webhook event (verify via `GET /app/hook/deliveries`).
- Add the bidirectional tenant-isolation test (two populated brains) — closes the gap noted in BACKLOG "Verify AI Search tenant isolation."
- Reconcile the duplicate ADR-002/004 numbering and the AI Search cooldown doc mismatch (tracked in BACKLOG; this ADR intentionally takes number **011** to avoid a new collision).

## Implementation

Phased build in [Tasks-004](../tasks/004-multi-repo-support.md).
