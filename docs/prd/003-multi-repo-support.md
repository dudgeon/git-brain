# PRD-003: Multiple Repository Support

**Status:** ✅ Decisions locked 2026-06-20 (see [§9 Decisions](#9-decisions-locked-2026-06-20)). Approach: **Option A — repo = brain.** Ready for implementation — see [ADR-011](../adr/011-multi-repo-support.md) and [Tasks-004](../tasks/004-multi-repo-support.md).
**Author:** Claude (planning session)
**Last updated:** 2026-06-20
**Related:** [ADR-011 Multi-Repo Support](../adr/011-multi-repo-support.md), [Tasks-004](../tasks/004-multi-repo-support.md), [ADR-001 GitHub App](../adr/001-github-app.md), [ADR-002 Security Isolation](../adr/002-security-isolation.md), [ADR-002 OAuth Authentication](../adr/002-oauth-authentication.md), [ADR-008 Email Input](../adr/008-email-input.md), [BACKLOG → Multi-repo support](../BACKLOG.md)

---

## 1. Problem & Motivation

A user wants to connect **more than one repository** to Brainstem and keep each as a **separate, non-commingled brain** that can be accessed independently (one brain at a time, not as a merged corpus).

Today this is **not possible for repos under the same GitHub account**, and is **silently broken** in several places for users who already own more than one installation (e.g., one on their personal account + one on an org).

### Current behavior (code-verified 2026-06-20)

| Fact | Location | Consequence |
|------|----------|-------------|
| A "brain" is 1:1 with a row in the `installations` table, keyed on a brain UUID (`id`). | `installations` schema; `handleUserMcp` | Brain UUID = R2 prefix = MCP URL = AI Search filter scope. Isolation is keyed entirely on this UUID. |
| Setup callback syncs **only `repos[0]`** of an installation. | `src/index.ts:1609` (`// For MVP, use the first repo`) | If a user grants the App access to N repos, only one is ever synced. The rest are silently ignored. |
| Setup callback dedupes on `github_installation_id` alone (`.first()`). | `src/index.ts:1576` | Re-running setup for an installation returns the existing brain; a second repo on the same install never produces a second brain. |
| Push webhook resolves the brain by `github_installation_id` only (`.first()`). | `src/index.ts:1802` | With multiple repos under one installation, pushes could be applied to the **wrong** brain (whichever row `.first()` returns). |
| Uninstall webhook deletes the brain by `github_installation_id` (`.first()`). | `src/index.ts:1838` | If one installation backed multiple brains, only one would be purged → orphaned R2/D1 data. |
| `installation_repositories` (repos added/removed from an install) is **not handled**. | webhook handler (`src/index.ts:1795`+) | Adding/removing a repo from an existing install has no effect. |
| Clip, bookmarklet, and OAuth-success surfaces pick a brain with `... LIMIT 1`. | `src/index.ts:2643`, `:3072`, `:3095` | Non-deterministic which brain a user sees / clips into when they own more than one. Already buggy today for personal+org owners. |

### What already works per-brain (no change needed under the recommended design)

Because nearly everything is keyed on the **brain UUID** (`brains/{uuid}/` R2 prefix), these surfaces are already correctly isolated and need **no logic change** if each repo becomes its own brain:

- R2 storage layout (`brains/{uuid}/...`) — `src/inbox.ts:48`, `syncRepo`/`syncChangedFiles`
- AI Search tenant filter (`folder` `gt`/`lte` on `brains/{uuid}/`) — `src/index.ts:443`
- MCP tools: `search_brain`, `get_document`, `list_recent`, `list_folders`, `brain_inbox(_save)`, `brain_account`
- MCP routing + ownership check at `/mcp/{uuid}` — `src/index.ts:1882`
- Email routing: sub-address `brain+{uuid}@brainstem.cc` and per-brain aliases already resolve to a specific brain — `src/email.ts:41`, `parseEmailRecipient` in `src/utils.ts`
- `_brain_summary.json`, debug endpoints, Brain Explorer/Inbox UIs

This asymmetry is the central design lever: **keeping "one repo = one brain UUID" lets us reuse all per-brain isolation for free.**

---

## 2. Goals / Non-Goals

### Goals
- A single user can connect **multiple repos** and get a **distinct brain (UUID + MCP URL)** per repo, even when the repos live under the **same GitHub account/installation**.
- Each brain stays **fully isolated** (storage, search, email, clip) — no commingling.
- The user can **discover and access** each brain's URL independently.
- Every write surface (MCP inbox, email, web clip) routes to a **deterministic, intended** brain.
- Lifecycle correctness: adding a repo creates a brain; removing a repo (or uninstalling) deletes exactly the right brain(s).

### Non-Goals (this PRD)
- A single brain that **merges/searches across multiple repos** (this is a separate capability — see Intent Question Q1 / Option B).
- Human-friendly brain naming/renaming beyond `repo_full_name` (nice-to-have, flagged in Q5).
- Cross-brain aggregate search (flagged in Q4; default is to keep brains isolated).
- Per-repo billing/quotas.

---

## 3. Design Options (the core decision)

**This is the decision that gates the whole build.** It is captured as Intent Question **Q1** and must be answered before implementation.

### Option A — Repo = Brain (recommended)
Decouple "brain" from "GitHub installation." One `installations` row per **(installation, repo)** pair. Each repo gets its own brain UUID, R2 prefix, MCP URL, and isolation scope. A GitHub installation with 3 repos → 3 brains.

- **Pros:** Matches the user's stated need ("access one brain, not the other") exactly. Reuses 100% of existing per-brain isolation (R2, AI Search, email, clip, tools) with **zero changes to the tool layer**. Minimal schema change. Naturally supports same-account multi-repo.
- **Cons:** Many small brains for users who'd prefer one merged knowledge base. The word "installation" in the schema/table becomes a misnomer (it's now "brain").
- **Surfaces touched:** setup/onboarding, webhook routing, uninstall, lifecycle events, and the three `LIMIT 1` write/discovery surfaces. **Tool layer untouched.**

### Option B — Installation = Brain, repos namespaced inside
One brain per installation; repos stored under `brains/{uuid}/{repoSlug}/...`. One MCP URL exposes all of the install's repos; tools gain an optional `repo` filter and search spans repos by default.

- **Pros:** One URL/knowledge base spanning related repos; fewer connectors to manage.
- **Cons:** **Does not satisfy the segregation requirement** (data is commingled in one brain/search scope). Requires invasive changes to every tool (`search_brain`, `get_document`, `list_*`, inbox path building), the AI Search filter strategy, the brain summary, and the R2 layout + a migration of existing data. Highest effort, highest risk.

### Option C — Both (brain is first-class; a brain contains 1..N repos; user chooses at setup)
A `brains` table decoupled from repos, plus a `brain_repos` join table. User decides at connect time whether a repo joins an existing brain or starts a new one.

- **Pros:** Most flexible; supports both "separate" and "merged" mental models.
- **Cons:** Largest schema + data-model change; most UX surface; combines the cost of A and B. Over-engineered until there's demand for merged brains.

**Recommendation:** **Option A** for the first release (directly solves the user's problem at the lowest risk), with the data model named so that a later move to Option C is additive (see §4). Treat Option B/"merged brain" as a separate future feature, not a blocker.

> The rest of this PRD details **Option A**. If Q1 resolves to B or C, large parts of §5–§7 change.

---

## 4. Data Model (Option A)

Keep the `installations` table but **relax its 1-row-per-installation assumption** to 1-row-per-(installation, repo). The row's `id` remains the brain UUID.

```sql
-- New: allow many brains per GitHub installation; make (install, repo) the natural key.
CREATE UNIQUE INDEX IF NOT EXISTS idx_install_repo
  ON installations(github_installation_id, repo_full_name);

-- DECIDED (Q3): user-designated default brain — the write target for clip/bookmarklet
-- (and any future unaddressed write). Convention: exactly one row with is_default_for_user=1 per user_id.
ALTER TABLE installations ADD COLUMN is_default_for_user INTEGER DEFAULT 0;

-- Q6 decided "label brains by repo_full_name" → no nickname column needed for v1.
```

Notes:
- No row needs to move; existing single-repo installs already conform (1 row, 1 repo).
- `id` (brain UUID) stays the primary key and the unit of isolation. **Do not** change the R2 prefix scheme.
- Renaming the table to `brains` is cosmetic and risky (touches many queries) — defer; document the semantics instead. (See contradiction BUG-6.)
- To keep a future Option C cheap, treat `installations` as the "brain" entity now; a `brain_repos` join table can be added later without breaking this.

### Default-brain lifecycle (Q3)
- The **first** brain created for a `user_id` is auto-marked `is_default_for_user = 1`.
- Setting a new default clears the flag on the user's other brains in the same transaction (enforce single-default invariant in code; SQLite has no partial-unique-per-user constraint we want to rely on).
- If the default brain is deleted (uninstall / repo removed), promote the most-recently-created remaining brain to default.
- **Setting surface:** a "Set as default" control per brain on the OAuth success / brains-management page (§5.8). No new MCP tool required.

### Resolution helpers to add
- `getBrainForPush(env, githubInstallationId, repoFullName)` → the one brain row.
- `getBrainsForInstallation(env, githubInstallationId)` → all brains (for uninstall + repo-removed).
- `getBrainsForUser(env, userId)` → all of a user's brains (OAuth success page, brains chooser).
- `getDefaultBrainForUser(env, userId)` → the `is_default_for_user = 1` brain (clip/bookmarklet target).
- `setDefaultBrainForUser(env, userId, brainId)` → flips the default atomically.

---

## 5. Implementation Plan by Access Surface (Option A)

Legend: **[no-op]** = already correct per-brain; **[change]** = needs work; **[new]** = new code.

### 5.1 Onboarding / Setup — **[change]**
`handleSetupCallback` (`src/index.ts` ~1540–1644)
- Replace `const repo = repos[0]` with iteration over **all** accessible repos (or a repo-picker — Intent Q2).
- For each selected repo with no existing brain row (dedupe on `(github_installation_id, repo_full_name)`), create a brain UUID, insert a row, and kick off `syncRepo` in `ctx.waitUntil`.
- Render a success page listing **every** resulting brain + its `/mcp/{uuid}` URL (not just one).
- Fix the existing-install short-circuit (`src/index.ts:1576`) to be repo-aware so adding repos later still creates brains.

### 5.2 Push webhook — **[change]**
`handleWebhook` push branch (`src/index.ts:1795`+)
- Read `payload.repository.full_name` and resolve the brain via `getBrainForPush(installationId, repoFullName)`. Today it uses `.first()` on `github_installation_id` — **wrong** with multiple repos.
- Everything downstream (`extractChangedFiles` → `syncChangedFiles`) is already per-brain and needs no change once the right brain row is selected.

### 5.3 Repo add/remove webhook — **[new]**
Handle `installation_repositories` (action `added`/`removed`) and the `repositories_added`/`repositories_removed` arrays.
- `added`: create a brain + initial `syncRepo` for each new repo (same path as 5.1).
- `removed`: call `deleteInstallation` for the specific brain(s) whose `repo_full_name` was removed.
- **Ops dependency:** confirm the GitHub App is subscribed to the `installation_repositories` (a.k.a. "Repository" / installation-repositories) webhook event in App settings. (Verify with `GET /app/hook/deliveries` using the local key.)

### 5.4 Uninstall webhook — **[change]**
`installation.deleted` branch (`src/index.ts:1835`+)
- Replace `.first()` with `getBrainsForInstallation(...)` and loop `deleteInstallation` over **all** brains for that `github_installation_id`. Otherwise sibling brains leak R2 + D1 + email rows.

### 5.5 MCP routing & tools — **[no-op]**
- `/mcp/{uuid}` routing, ownership check, and all 8 tools are already scoped by brain UUID. No change under Option A.
- Optional enhancement (Intent Q4/Q6): a small `list_brains`/`about`-augmentation so a connected client can tell the user their other brains' URLs. Keep brains isolated by default.

### 5.6 Email input — **[mostly no-op]**
`src/email.ts`, `parseEmailRecipient`
- Sub-address `brain+{uuid}@` and alias lookups already resolve to a specific brain. No routing change.
- Ensure **each** brain provisions its default alias row when first touched (today the default alias is created in `brain_account` status; confirm it runs per-brain).
- **DECIDED (Q5): one vanity alias per brain.** Change the uniqueness/scoping in `handleRequestAlias` from per-installation to per-brain so e.g. `work@` → Brain A and `home@` → Brain B.

### 5.7 Web clip (`/api/clip`) & bookmarklet (`/bookmarklet`) — **[change]**
`src/index.ts:3060`+ (`/api/clip`), `:3090`+ (`/bookmarklet`), `src/clip.ts`
- Today both do `SELECT id FROM installations WHERE user_id = ? LIMIT 1` → arbitrary brain. **DECIDED (Q3): resolve the user's designated default brain** (`getDefaultBrainForUser`) instead of `LIMIT 1`.
- Also accept an optional explicit `brain`/`installation` field in the clip payload to override the default (lets a user target a non-default brain without changing their default).
- `/bookmarklet` page: render the **default brain's** bookmarklet prominently, and offer the other brains' bookmarklets below (one bookmarklet per brain URL/token). This interacts with the iOS Shortcut PRD.

### 5.8 OAuth success / discovery surfaces — **[change]**
`renderOAuthSuccessPage` (`src/index.ts:2641`+), `/bookmarklet` page
- Replace the single-installation `LIMIT 1` lookup with **list all** of the user's brains and render one connect-block (MCP URL + copy button) per brain.
- Add a **"Set as default"** control (radio per brain) wired to `setDefaultBrainForUser` — this is the surface where Q3's default is chosen. Mark the current default visibly.
- This also fixes the present-tense bug where a personal+org user only ever sees one brain (BUG-7).

### 5.9 Debug & ops — **[change, small]**
- `/debug/status/{uuid}` stays per-brain.
- Add a `/debug/brains` (owner-scoped) listing of a user's brains for support/diagnostics.
- One-off **backfill script** (`scripts/`): for each existing installation, list its accessible repos and create brain rows + sync for any repo beyond the original `repos[0]`. (Not a destructive endpoint — a standalone script per CLAUDE.md guidance.)

---

## 6. Migration & Backfill

- **Schema:** additive only (new index + optional columns). Safe to apply live.
- **Existing data:** every current brain is already a valid 1-repo brain — no row migration.
- **Previously-ignored repos:** for installs that had >1 repo selected (only `repos[0]` synced), run the §5.9 backfill to materialize the missing brains. Gate behind Intent Q7 (auto vs. opt-in).
- **Rollback:** because the change is additive and the UUID scheme is unchanged, reverting the code leaves existing single-repo brains fully functional.

---

## 7. Testing Plan

Unit (Vitest, extend `src/*.test.ts`):
- `getBrainForPush` selects the correct row by `(installation_id, repo_full_name)`.
- Setup creates N brains for N repos; idempotent on re-run.
- `installation_repositories` add creates exactly one brain; remove deletes exactly one.
- Uninstall deletes **all** sibling brains.
- Clip/bookmarklet resolve to the intended brain (default vs. explicit param).

Integration / prod (per CLAUDE.md "verify before asking user"):
- Two repos under one GitHub account → two distinct `/mcp/{uuid}` URLs, each returning only its own data (`test-user-mcp.mjs` against both; update its credentials per CLAUDE.md).
- Cross-brain isolation: search/list in brain A returns nothing from brain B (bidirectional — closes the gap noted in BACKLOG "Verify AI Search tenant isolation").
- Email: `brain+{uuidA}@` saves to A only; `brain+{uuidB}@` to B only.
- Push to repo A updates brain A and not B; uninstall purges both.

---

## 8. Documentation Contradictions Found (logged to BACKLOG)

While mapping the surfaces, I found several doc/code contradictions. Each is logged in `docs/BACKLOG.md` as a **BUG** or **ENH**; summarized here for the planning record:

- **BUG-1 (doc integrity):** Duplicate ADR-002 files — `002-security-isolation.md` and `002-oauth-authentication.md`. The BACKLOG "Related documents" index only lists the former; the latter is orphaned.
- **BUG-2 (doc integrity / ambiguous refs):** Duplicate ADR-004 — `004-mcp-apps-ui.md` and `004-chatgpt-app.md`. The label "ADR-004" resolves to different docs by context (CLAUDE.md "ADR-004: inbox composer" → mcp-apps-ui; `tasks/003` "ADR-004 (gap analysis)" → chatgpt-app). BACKLOG papers over this with "ADR-004a/004b" but the filenames still collide.
- **BUG-3 (stated goal vs. implementation):** `adr/002-oauth-authentication.md` lists design goal *"Support multi-repo access (one token for all user's installations)."* The implementation contradicts this — every multi-install surface uses `LIMIT 1`, and setup only syncs `repos[0]`.
- **BUG-4 (doc/code inconsistency):** AI Search reindex cooldown is documented as **~30s** in CLAUDE.md ("AI Search Reindex API") but as **3 minutes** in code comments (`src/index.ts:2016`, `syncChangedFiles`). One is wrong.
- **ENH-5 (doc accuracy):** CLAUDE.md "Test Script Output" example lists **7** tools (omits `brain_inbox_save`) while the rest of the doc says **8 tools**. Update the sample output.
- **BUG-6 (silent data omission):** Setup's `// For MVP, use the first repo` (`src/index.ts:1609`) silently drops all but one selected repo. Neither the CLAUDE.md "Customer Lifecycle" section nor "Known Limitations" mentions this. Users reasonably expect every granted repo to sync. (This PRD is the fix.)
- **BUG-7 (present-tense correctness):** The three `LIMIT 1` lookups (OAuth success `:2643`, `/bookmarklet` `:3095`, `/api/clip` `:3072`) are **already** non-deterministic for any user who owns >1 installation today (e.g., personal + org). Clips can land in an unintended brain; the success page hides the other brain.

---

## 9. Decisions (locked 2026-06-20)

Captured via the interactive artifact (`docs/prd/003-multi-repo-support.html`) and confirmed by the owner. Recorded in [ADR-011](../adr/011-multi-repo-support.md).

| # | Question | Decision | vs. recommendation |
|---|----------|----------|--------------------|
| **Q1** | Brain granularity | **Repo = separate brain (Option A)** | ✅ as recommended |
| **Q2** | Onboarding | **Auto-create a brain for every accessible repo** | ✅ as recommended |
| **Q3** | Default write target (clip/bookmarklet) | **A user-designated default brain** | ⚠️ changed (rec. was per-brain target, no global default) |
| **Q4** | Cross-brain search | **No — keep brains strictly isolated** | ✅ as recommended |
| **Q5** | Vanity email alias scope | **One vanity alias per brain** | ✅ as recommended |
| **Q6** | Brain naming | **Show `repo_full_name` as the label** (no nickname column) | ✅ as recommended |
| **Q7** | Backfill previously-ignored repos | **Auto-create brains for them on deploy** | ✅ as recommended |

**Implications of the Q3 deviation:** a `is_default_for_user` flag, a default-brain lifecycle (auto-default first brain; promote on delete), and a "Set as default" control on the OAuth success/brains page (§4, §5.7, §5.8). Clip/bookmarklet resolve the default instead of `LIMIT 1`, with an optional explicit override.

---

## Appendix: Surface Change Matrix (Option A)

| Surface | File / anchor | Status |
|---|---|---|
| Setup callback | `src/index.ts:1540`+ | change |
| Push webhook | `src/index.ts:1795`+ | change |
| `installation_repositories` event | webhook handler | new |
| Uninstall webhook | `src/index.ts:1835`+ | change |
| `syncRepo` / `syncChangedFiles` | `src/index.ts:1955`,`:2068` | no-op |
| `/mcp/{uuid}` routing + ownership | `src/index.ts:1872`+ | no-op |
| MCP tools (search/get/list/inbox/account) | `src/index.ts` tool regs | no-op |
| Email routing | `src/email.ts`, `parseEmailRecipient` | mostly no-op |
| Vanity alias scope | `handleRequestAlias` | change (Q5) |
| `/api/clip` | `src/index.ts:3060`+, `src/clip.ts` | change (Q3) |
| `/bookmarklet` page + build | `src/index.ts:3090`+, `ui/bookmarklet/` | change (Q3) |
| OAuth success page | `src/index.ts:2641`+ | change |
| Debug status/brains | `src/index.ts:2285`+ | change (add list) |
| Backfill script | `scripts/` (new) | new |
| `_brain_summary.json` | `generateBrainSummary` | no-op |
