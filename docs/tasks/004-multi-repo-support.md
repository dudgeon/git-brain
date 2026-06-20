# Tasks-004: Multiple Repository Support

**Related:** [PRD-003](../prd/003-multi-repo-support.md) (plan + surface map), [ADR-011](../adr/011-multi-repo-support.md) (decisions)
**Approach:** Option A — repo = brain. Default write target = user-designated default brain (Q3).
**Last updated:** 2026-06-20

Phased so each phase is independently shippable and testable. Phases 1–3 deliver the core (a second repo becomes its own isolated brain, synced correctly). Phases 4–5 fix the multi-brain UX/write surfaces. Phase 6 backfills and verifies.

Standard per-change gate (CLAUDE.md): `npm test` → `npm run typecheck` → `npm run deploy` → `node test-user-mcp.mjs`.

---

## Phase 0: Schema & helpers (foundation)

- [ ] **0.1** Add migration (auto-run on boot, matching `ensureOAuthTables` pattern):
  - `CREATE UNIQUE INDEX idx_install_repo ON installations(github_installation_id, repo_full_name)`
  - `ALTER TABLE installations ADD COLUMN is_default_for_user INTEGER DEFAULT 0`
- [ ] **0.2** Add resolution helpers: `getBrainForPush`, `getBrainsForInstallation`, `getBrainsForUser`, `getDefaultBrainForUser`, `setDefaultBrainForUser` (single-default invariant enforced here).
- [ ] **0.3** Unit tests for the helpers (esp. single-default invariant + promote-on-delete).

## Phase 1: Repo-aware sync routing (correctness)

- [ ] **1.1** Push webhook: resolve brain by `(github_installation_id, payload.repository.full_name)` instead of `.first()` (`src/index.ts:1802`).
- [ ] **1.2** Uninstall webhook: loop `deleteInstallation` over **all** brains for the installation (`src/index.ts:1838`).
- [ ] **1.3** Tests: push targets the right brain among siblings; uninstall purges all siblings.

## Phase 2: Multi-brain onboarding

- [ ] **2.1** `handleSetupCallback`: create a brain per accessible repo (auto-default the first for the user); kick off `syncRepo` per brain in `ctx.waitUntil`.
- [ ] **2.2** Make the existing-install short-circuit repo-aware (`src/index.ts:1576`).
- [ ] **2.3** Success page lists every resulting brain + `/mcp/{uuid}` URL.
- [ ] **2.4** Test: install granting 2 repos → 2 brains, each syncs only its repo.

## Phase 3: Repo add/remove webhook (new)

- [ ] **3.1** Handle `installation_repositories` (`added` → create brain + sync; `removed` → delete brain).
- [ ] **3.2** Ops: confirm the GitHub App subscribes to the `installation_repositories` event (verify via `GET /app/hook/deliveries` with the local key).
- [ ] **3.3** Test: add repo → new brain; remove repo → brain purged.

## Phase 4: Discovery + default-brain UX

- [ ] **4.1** `renderOAuthSuccessPage`: list all of the user's brains (replace `LIMIT 1`, `src/index.ts:2643`) with a connect-block per brain.
- [ ] **4.2** Add "Set as default" control per brain → `setDefaultBrainForUser`; mark the current default.
- [ ] **4.3** `/bookmarklet` page: feature the default brain's bookmarklet; list others below (replace `LIMIT 1`, `src/index.ts:3095`).

## Phase 5: Write-surface routing

- [ ] **5.1** `/api/clip`: resolve `getDefaultBrainForUser` (replace `LIMIT 1`, `src/index.ts:3072`); accept optional explicit `brain`/`installation` override in payload (`src/clip.ts`).
- [ ] **5.2** Vanity alias scope → per-brain in `handleRequestAlias` (Q5).
- [ ] **5.3** Confirm each brain provisions its default email alias on first `brain_account` touch.
- [ ] **5.4** Tests: clip lands in default; explicit override targets the named brain; `work@`/`home@` route to distinct brains.

## Phase 6: Backfill + end-to-end verification

- [ ] **6.1** One-off `scripts/backfill-brains.mjs`: for each existing installation, list accessible repos and create+sync brains for any beyond the original `repos[0]` (non-destructive standalone script).
- [ ] **6.2** Bidirectional isolation test: two populated brains; search/list in A returns nothing from B and vice-versa (closes BACKLOG "Verify AI Search tenant isolation" gap).
- [ ] **6.3** Update `test-user-mcp.mjs` to exercise two brains under one account; refresh credentials per CLAUDE.md.
- [ ] **6.4** Docs: update CLAUDE.md (Customer Lifecycle, Known Limitations, tool/endpoint tables) and `site/content.md` for any user-facing page changes (success/bookmarklet pages).

---

## Notes / decisions reference
- **Default brain (Q3):** auto-default first brain; promote most-recently-created on default deletion; single default per `user_id` enforced in `setDefaultBrainForUser`.
- **No cross-brain search (Q4):** keep `/mcp/{uuid}` strictly single-brain.
- **Label by `repo_full_name` (Q6):** no nickname column in v1.
- **Out of scope:** merged-brain-spanning-repos (Option C); table rename `installations`→`brains`.
