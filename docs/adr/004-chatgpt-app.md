# ADR-004: ChatGPT App Directory Listing

> **Status:** Proposed
> **Date:** 2026-02-02
> **Decision:** Evaluate and plan submission of Git Brain as a ChatGPT app via the OpenAI Apps SDK

## Context and Problem Statement

Git Brain currently serves Claude users exclusively via the MCP protocol. OpenAI's ChatGPT now supports MCP-based apps through the Apps SDK, with a public App Directory for discovery. Listing Git Brain as a ChatGPT app would expand the addressable audience to all ChatGPT users.

A ChatGPT app is fundamentally: a production MCP server + tool metadata + auth + privacy/policy compliance + submission review. Since Git Brain already has a production MCP server with OAuth, the incremental work is primarily about tightening metadata, meeting OpenAI's specific auth expectations, adding a privacy policy, and passing review.

## Decision Drivers

1. **Audience expansion** — ChatGPT has a larger user base than Claude; listing in the directory makes Git Brain discoverable
2. **Low marginal cost** — We already have a production MCP server with OAuth; most infrastructure is reusable
3. **Platform risk** — Depending on a single client (Claude) is fragile; supporting ChatGPT diversifies
4. **Public listing implications** — The App Directory is public; this means Git Brain must be ready for general-audience use, not just friends-and-family

## Analysis

### What We Already Have

| Requirement | Current State | Gap |
|-------------|--------------|-----|
| Production HTTPS MCP endpoint | `https://brainstem.cc/mcp/{uuid}` | None — already production |
| OAuth 2.1 with PKCE | Implemented (S256, DCR) | Need to verify OpenAI's specific redirect URI + review flow |
| Tool definitions | 6 tools defined | Need annotations (`readOnlyHint`, `openWorldHint`, `destructiveHint`) |
| Privacy policy | None | Must create and publish |
| Developer account | None on OpenAI Platform | Must create and verify |
| Test credentials | Exist locally | Must provide reviewable demo account with sample data |
| Widget UI | None | Optional — can submit tools-only app |

### Gap Analysis

#### 1. Tool Annotations (Required — Common Rejection Cause)

Every tool must have correct MCP annotations. Current tools and their required annotations:

| Tool | `readOnlyHint` | `destructiveHint` | `openWorldHint` | Notes |
|------|---------------|-------------------|-----------------|-------|
| `about` | `true` | `false` | `false` | Pure metadata, no side effects |
| `search_brain` | `true` | `false` | `false` | Read-only search over user's own data |
| `get_document` | `true` | `false` | `false` | Read-only document retrieval |
| `list_recent` | `true` | `false` | `false` | Read-only listing |
| `list_folders` | `true` | `false` | `false` | Read-only listing |
| `brain_inbox` | `false` | `false` | `true` | Writes to R2 (creates content); `openWorldHint` because it persists data outside the conversation |

Tool names are **locked after publication** — updating names, signatures, or descriptions requires resubmission. Design for versionability from day 1.

**Action:** Add `annotations` to all tool definitions in `src/index.ts`. Review tool descriptions for clarity and accuracy — no promotional language, no "prefer me" phrasing.

#### 2. OAuth Compatibility with OpenAI

OpenAI's ChatGPT acts as the OAuth client. It expects:
- **Dynamic Client Registration (DCR)** at the endpoint advertised in `/.well-known/oauth-authorization-server` — we already have `/oauth/register`
- **PKCE (S256)** — already implemented
- **ChatGPT's redirect URI** must be allowlisted — need to determine the exact URI (likely similar to `https://chatgpt.com/aip/...` or provided during DCR)
- **Review redirect URI** — OpenAI's review team uses a separate redirect URI that must also be allowlisted; without it, reviewers can't test auth and the app is rejected

**Action:** Determine OpenAI's redirect URIs (from DCR registration or documentation), ensure they're accepted by our OAuth flow. Since we use DCR, the redirect URI comes from the client registration request — verify we don't restrict registered URIs too narrowly.

#### 3. Test Credentials for Review

Reviewers must be able to authenticate and use the app end-to-end without any setup steps they can't perform (no GitHub App installation, no 2FA they can't complete).

**Options:**
- **A: Pre-provisioned demo account** — Create a dedicated installation with sample repo data, issue a long-lived session token, provide credentials to reviewers. Reviewers skip the GitHub App installation flow entirely.
- **B: Public demo brain** — Create a read-only installation with curated sample content (e.g., a public repo) that doesn't require GitHub auth. Reviewer can search, browse, and read documents.

**Recommended: Option A** with a pre-provisioned installation containing representative sample data. Provide reviewers with GitHub OAuth test credentials or a bypass mechanism.

#### 4. Privacy Policy (Required)

Must be published at a stable URL and must cover:
- Categories of personal data collected (GitHub username, repo contents, session tokens)
- Purposes of data collection (search, sync, authentication)
- Recipients (Cloudflare infrastructure — R2, D1, AI Search; no third-party sharing)
- User controls (can uninstall GitHub App to trigger deletion; can request manual deletion)
- Data retention (sessions expire after 1 year; repo content persists until uninstall)

**Action:** Draft privacy policy and host at `https://brainstem.cc/privacy`.

#### 5. Content and Safety Constraints

- App must be suitable for general audiences including ages 13-17
- No ads, no restricted data categories (PCI, PHI, government IDs, secrets)
- Data minimization — don't return internal IDs or telemetry in tool outputs

**Risk assessment:** Git Brain syncs private repo content chosen by the user. The content itself is user-controlled. We don't collect restricted categories. The app is a personal knowledge base tool — inherently general-audience appropriate. However, we should ensure tool outputs don't leak internal UUIDs or debug information.

**Action:** Audit tool response shapes to ensure they return only user-relevant data.

#### 6. Operational Requirements

- **Global data residency** — Our Cloudflare Worker runs globally; this should satisfy the requirement (EU-only projects can't submit)
- **Stability and low latency** — Already production; monitor for latency issues under ChatGPT's traffic patterns
- **Logging and metrics** — We have webhook logs in D1; should add basic request logging for MCP tool calls for debugging

#### 7. Widget UI (Optional)

A widget is not required. Tools-only apps are accepted. Given our tools return text/markdown content, a widget could enhance document display but is not necessary for initial submission.

**Recommendation:** Submit as tools-only initially. Consider adding a widget in a future iteration if approved.

If we later add a widget:
- Must register a `widgetDomain` (dedicated origin, unique per app)
- Must declare a strict CSP (`connect_domains`, `resource_domains`)
- CSP must match exactly — dev-mode permissiveness masks production CSP failures

### Account and Organizational Prerequisites

| Requirement | Status |
|-------------|--------|
| OpenAI Platform account | Needed |
| Verified developer identity | Needed |
| Owner role in submitting org | Needed |
| Customer support contact | Needed (can use existing email) |

## Considered Options

### Option 1: Submit to ChatGPT App Directory (Recommended)

Full submission following the process above. App becomes publicly discoverable.

**Pros:**
- Maximum discoverability
- Validates Git Brain as a multi-platform product
- Forces us to clean up tool metadata, add privacy policy, improve auth — all good hygiene

**Cons:**
- Public means anyone can use it — must be ready for scale and support
- Tool definitions locked after publish; changes require resubmission
- Review process adds latency to iterations
- Must maintain OpenAI account and comply with ongoing policy changes

### Option 2: Developer Mode Only (No Directory Listing)

Use OpenAI's developer mode to make Git Brain connectable via MCP URL without directory listing.

**Pros:**
- No review process
- Can iterate freely on tool definitions
- Still works for users who know the URL

**Cons:**
- Not discoverable — no growth channel
- Still need auth compatibility with ChatGPT's OAuth flow
- Misses the forcing function of review to improve quality

### Option 3: Defer Until Multi-Tenant is Hardened

Wait until AI Search tenant isolation is verified and ScopedR2/ScopedAISearch wrappers are implemented before exposing to a wider audience.

**Pros:**
- Lower risk of cross-tenant data leakage under higher load
- More confidence in security posture

**Cons:**
- Delays market entry
- Current single-user state works; can gate signups if needed
- Isolation can be hardened in parallel with submission

## Decision Outcome

**Recommended: Option 1 (Submit to Directory)**, with Option 3's security hardening as a parallel workstream.

## Implementation Plan

### Phase 1: Tool Metadata and Annotations
- Add `readOnlyHint`, `destructiveHint`, `openWorldHint` annotations to all 6 tools
- Review and tighten tool descriptions (clear, accurate, no promotional language)
- Ensure tool inputs are minimal and purpose-driven
- Audit tool response shapes — remove internal IDs and debug data from outputs

### Phase 2: Privacy and Policy
- Draft and publish privacy policy at `https://brainstem.cc/privacy`
- Set up customer support contact
- Review content against general-audience requirements

### Phase 3: Auth Compatibility
- Test OAuth flow with ChatGPT's DCR and redirect URIs
- Ensure our DCR endpoint accepts ChatGPT's redirect URI
- Create pre-provisioned demo installation with sample data for reviewers
- Document test credentials for submission

### Phase 4: OpenAI Account Setup
- Create OpenAI Platform account
- Verify developer identity
- Create project with global data residency

### Phase 5: Submission
- Test end-to-end in ChatGPT developer mode
- Fill submission fields (MCP URL, OAuth metadata, listing info, compliance confirmations)
- Submit for review
- Address any rejection feedback and resubmit

### Phase 6: Post-Approval
- Click Publish when approved
- Monitor for issues under ChatGPT traffic
- Harden multi-tenant isolation (parallel workstream)

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Rejection for tool annotation errors | Medium | Low (resubmit) | Carefully audit annotations against actual behavior |
| Rejection for auth reviewability | Medium | Low (resubmit) | Pre-provision demo account with clear instructions |
| Cross-tenant leakage under wider use | Low | Critical | Harden isolation before significant traffic; gate signups if needed |
| Tool definition lock-in | Medium | Medium | Design tool surface carefully; use generic names that won't need changing |
| Policy changes by OpenAI | Low | Medium | Monitor OpenAI developer communications |

## Consequences

### Positive
- Git Brain becomes available to ChatGPT's user base
- Forces improvement of tool metadata, auth, and privacy posture
- Validates multi-platform MCP server architecture
- Diversifies away from single-client dependency

### Negative
- Ongoing compliance burden with OpenAI policies
- Tool definitions locked after publish — less iteration agility
- Must maintain test credentials and demo data for future resubmissions
- Public app means public support expectations

## References

- [OpenAI Apps SDK](https://developers.openai.com/apps-sdk/)
- [App Submission Guidelines](https://developers.openai.com/apps-sdk/app-submission-guidelines/)
- [Submit Your App](https://developers.openai.com/apps-sdk/deploy/submission/)
- [Build Your MCP Server](https://developers.openai.com/apps-sdk/build/mcp-server/)
- [Authentication](https://developers.openai.com/apps-sdk/build/auth/)
- [MCP Concepts](https://developers.openai.com/apps-sdk/concepts/mcp-server/)
