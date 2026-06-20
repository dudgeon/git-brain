# Tasks-004: Multiple Repository Support

**Related:** [PRD-003](../prd/003-multi-repo-support.md) (plan + surface map), [ADR-011](../adr/011-multi-repo-support.md) (decisions)
**Approach:** Option A — repo = brain. Default write target = user-designated default brain (Q3).
**Last updated:** 2026-06-20

**Status: code complete (Phases 0–6.1) on branch `claude/relaxed-franklin-k2xzgw`.** `npm run typecheck` clean; `npm test` green (91 tests, 10 new). Deploy + live multi-brain verification deferred until the PR merges (deploying un-merged code to the shared production Worker would run the schema migration before review).

Phased so each phase is independently shippable and testable. Phases 1–3 deliver the core (a second repo becomes its own isolated brain, synced correctly). Phases 4–5 fix the multi-brain UX/write surfaces. Phase 6 backfills and verifies.

Standard per-change gate (CLAUDE.md): `npm test` → `npm run typecheck` → `npm run deploy` → `node test-user-mcp.mjs`.

---

## Phase 0: Schema & helpers (foundation) — ✅ DONE

- [x] **0.1** `ensureMultiRepoSchema` (lazy, memoized; PRAGMA-guarded `ALTER TABLE` + `CREATE UNIQUE INDEX idx_install_repo`).
- [x] **0.2** Resolution helpers: `getBrainForPush`, `getBrainsForInstallation`, `getBrainsForUser`, `getDefaultBrainForUser`, `setDefaultBrainForUser`, `ensureUserHasDefault` (single-default invariant enforced in `setDefaultBrainForUser`).
- [x] **0.3** Unit tests for the pure helpers (`resolveClipInstallation`, `parseRepositoryChanges`) in `src/multirepo.test.ts`.

## Phase 1: Repo-aware sync routing (correctness) — ✅ DONE

- [x] **1.1** Push webhook resolves brain by `getBrainForPush(installation_id, payload.repository.full_name)`.
- [x] **1.2** Uninstall webhook loops `deleteInstallation` over **all** brains for the installation, reindexing once.
- [x] **1.3** `deleteInstallation` only revokes sessions when it's the user's last brain; promotes a new default if the deleted brain was default; `{ reindex }` option for batch deletes.

## Phase 2: Multi-brain onboarding — ✅ DONE

- [x] **2.1** `handleSetupCallback` → `createBrainForRepo` per accessible repo, each with background `syncRepo`.
- [x] **2.2** Existing-install short-circuit removed; dedupe is now per (installation, repo) via `createBrainForRepo`.
- [x] **2.3** `renderSetupSuccessPage` lists every brain + `/mcp/{uuid}` URL.

## Phase 3: Repo add/remove webhook (new) — ✅ DONE (code)

- [x] **3.1** `installation_repositories` handled (`handleInstallationRepositories`): added → create brain + sync; removed → delete brain.
- [ ] **3.2** Ops: confirm the GitHub App subscribes to the `installation_repositories` event (verify via `GET /app/hook/deliveries`). **(manual, pending)**

## Phase 4: Discovery + default-brain UX — ✅ DONE

- [x] **4.1** `renderOAuthSuccessPage` lists all of the user's brains (one connect-block each).
- [x] **4.2** "Default for web clips" radio per brain → `POST /api/default-brain` → `setDefaultBrainForUser`; current default badged.
- [x] **4.3** `/bookmarklet` page features the default brain's bookmarklet and per-brain links (`?brain={id}`).

## Phase 5: Write-surface routing — ✅ DONE

- [x] **5.1** `/api/clip` resolves `getDefaultBrainForUser`; explicit override via `?brain=` or body `installation`/`brain` (ownership-checked in `resolveClipInstallation`).
- [x] **5.2** Vanity alias is already per-brain under Option A (`installation_id` = brain UUID); wording updated to "per brain". No scope change needed.
- [x] **5.3** Default email alias provisioning is per-brain (keyed on brain UUID) — verified, unchanged.

## Phase 6: Backfill + end-to-end verification

- [x] **6.1** `scripts/backfill-brains.mjs`: replays the idempotent setup callback for each installation (dry-run by default, `--apply` to execute). Non-destructive.
- [ ] **6.2** Bidirectional isolation test: two populated brains; search/list in A returns nothing from B and vice-versa. **(pending deploy)**
- [ ] **6.3** Update `test-user-mcp.mjs` to exercise two brains under one account; refresh credentials. **(pending deploy)**
- [x] **6.4** Docs updated: CLAUDE.md (multi-repo model, lifecycle, endpoints, schema) and `site/content.md` (success/OAuth/bookmarklet pages).

---

## Notes / decisions reference
- **Default brain (Q3):** auto-default first brain; promote most-recently-created on default deletion; single default per `user_id` enforced in `setDefaultBrainForUser`.
- **No cross-brain search (Q4):** keep `/mcp/{uuid}` strictly single-brain.
- **Label by `repo_full_name` (Q6):** no nickname column in v1.
- **Out of scope:** merged-brain-spanning-repos (Option C); table rename `installations`→`brains`.
