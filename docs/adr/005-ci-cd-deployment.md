# ADR-005: CI/CD Deployment Strategy

**Status:** Proposed
**Date:** 2026-02-04

## Context

Git Brain development often happens via Claude Code sessions — including from Claude mobile, where the user cannot run local commands like `npm run deploy`. Currently, deployment requires someone with Cloudflare credentials to manually run the deploy command after changes are pushed.

The desired workflow:
1. User chats with Claude on mobile (or any Claude interface)
2. Claude makes code changes and pushes to GitHub
3. Changes automatically deploy to production
4. Production doesn't break

This creates tension between **velocity** (deploy quickly from mobile) and **safety** (don't break production).

## Decision Drivers

- **Mobile-first authoring**: User should be able to ship changes without access to a terminal
- **No manual gates**: Avoid requiring PR approvals or manual deploy triggers for routine changes
- **Safety net**: Catch obvious errors (type errors, syntax errors) before they hit production
- **Rollback capability**: If something breaks, recover quickly
- **Simplicity**: Minimize infrastructure and process overhead

## Options Considered

### Option 1: Deploy on push to main

```
push to main → typecheck → deploy
```

**Pros:**
- Simplest possible pipeline
- Claude can push directly to main and changes go live

**Cons:**
- No review step — bugs go straight to production
- Rollback requires another push or manual Cloudflare intervention
- Encourages working directly on main (bad git hygiene)

### Option 2: Deploy on PR merge with required checks

```
push to branch → create PR → typecheck (required) → merge → deploy
```

**Pros:**
- Typecheck runs before code reaches main
- PR creates a review opportunity (even if auto-merged)
- Git history stays clean

**Cons:**
- Extra step: Claude must create PR, then merge it
- From mobile, user would need to approve/merge the PR somehow
- More friction for quick iterations

### Option 3: Auto-merge PRs when checks pass

```
push to branch → create PR → typecheck → auto-merge if green → deploy
```

**Pros:**
- Safety of PR checks without manual merge step
- Claude pushes, walks away, changes deploy if valid

**Cons:**
- Auto-merge can be surprising if you wanted to review first
- Need to configure branch protection + auto-merge settings
- Still requires PR creation step

### Option 4: Deploy feature branches to preview, promote to production

```
push to claude/* branch → deploy to preview URL → manual promote to production
```

**Pros:**
- Can test changes before they hit production
- Preview URLs are isolated

**Cons:**
- Cloudflare Workers doesn't have built-in preview environments
- Would need a separate Worker (`home-brain-mcp-preview`) with separate D1/R2 bindings
- Significant infrastructure overhead
- Still requires manual promotion step

### Option 5: Hybrid — auto-deploy main + PR checks for protection

```
claude/* branch → PR with typecheck → squash merge to main → auto-deploy
```

With branch protection rules:
- `main` requires PR (no direct push)
- PRs require `typecheck` status check to pass
- PRs can be merged by anyone (including GitHub Actions bot via auto-merge)

**Pros:**
- Every change gets typechecked before production
- Git history stays clean (squash merge)
- Auto-merge means no manual step after PR creation
- Can still do manual review if desired (just don't enable auto-merge on that PR)

**Cons:**
- Slightly more complex GitHub configuration
- PR creation is an extra step for Claude

## Decision

**Option 5: Hybrid with auto-merge PRs**

This balances safety and velocity:

1. **Claude pushes to a feature branch** (already the default behavior)
2. **Claude creates a PR** targeting `main`
3. **GitHub Actions runs typecheck** on the PR
4. **PR auto-merges** if typecheck passes (using GitHub's auto-merge feature or a merge action)
5. **Push to main triggers deploy** to Cloudflare

For the mobile use case, steps 2-5 happen automatically after Claude pushes. The user sees "I've pushed the changes" and can trust they'll deploy if valid.

### Why not deploy directly from feature branches?

- Keeps `main` as the source of truth for what's in production
- Squash merge keeps history clean
- Branch protection prevents accidental direct pushes

### Rollback strategy

If a bad deploy happens:
1. **Revert commit on main** → triggers new deploy with previous code
2. **Or**: Use Cloudflare dashboard to rollback to previous deployment (manual but instant)

Cloudflare Workers keeps recent deployments, so rollback is always possible via dashboard even if git is in a bad state.

## Implementation

### GitHub Actions workflows

**`.github/workflows/typecheck.yml`** — runs on PRs:
```yaml
name: Typecheck
on:
  pull_request:
    branches: [main]

jobs:
  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run typecheck
```

**`.github/workflows/deploy.yml`** — runs on push to main:
```yaml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run typecheck  # belt and suspenders
      - run: npm run deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

### GitHub repository settings

1. **Branch protection on `main`:**
   - Require PR before merging
   - Require `typecheck` status check to pass
   - Allow auto-merge

2. **Repository secrets:**
   - `CLOUDFLARE_API_TOKEN`: API token with Workers edit permission

### Claude workflow

When making changes, Claude should:
1. Create/switch to a feature branch
2. Make changes and commit
3. Push the branch
4. Create a PR with auto-merge enabled: `gh pr create --fill && gh pr merge --auto --squash`

The `--auto` flag means the PR merges automatically once checks pass. Claude doesn't need to wait.

## Consequences

**Positive:**
- Mobile-friendly: push and forget, changes deploy if valid
- Safety net: typecheck catches obvious errors before production
- Clean git history: all changes go through PRs with squash merge
- Rollback is straightforward via git revert or Cloudflare dashboard

**Negative:**
- PR creation adds ~10 seconds to Claude's workflow
- Auto-merge might be surprising if user expected to review
- No runtime verification (typecheck doesn't catch logic bugs)

**Future improvements:**
- Add `test-user-mcp.mjs` as a post-deploy smoke test (requires bearer token as secret)
- Add Slack/Discord notification on deploy success/failure
- Consider preview deployments if we need to test changes before production

## References

- [GitHub Auto-merge](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/automatically-merging-a-pull-request)
- [GitHub Branch Protection](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [Cloudflare Wrangler GitHub Action](https://github.com/cloudflare/wrangler-action)
