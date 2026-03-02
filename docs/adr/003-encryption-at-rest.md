# ADR-003: User Data Encryption at Rest

**Status:** Accepted
**Date:** 2026-02-01
**Supersedes:** N/A
**Related:** ADR-002 (Security Isolation)

## Context

All user files synced from GitHub are stored as plaintext UTF-8 strings in a shared R2 bucket (`home-brain-store`) at paths `brains/{uuid}/`. The Cloudflare account owner — i.e., the platform operator — can read any user's files via the Cloudflare dashboard or R2 API.

The backlog item "User data encryption at rest" asks whether we should encrypt file contents so they are opaque outside the MCP runtime.

### The Central Constraint

Cloudflare AI Search reads R2 directly to build its vector index. The worker triggers reindex jobs (`POST /ai-search/instances/{name}/jobs`) but never pushes content — AI Search crawls R2 on its own. If files in R2 are encrypted with application-layer keys, AI Search indexes ciphertext, rendering semantic search useless.

Semantic search is the product's core value proposition. Any encryption approach must be evaluated against this constraint.

### Existing Encryption

R2 already encrypts all objects at rest using AES-256-GCM with Cloudflare-managed keys. This is automatic, always-on, and transparent to all readers (including AI Search). It protects against physical disk theft and infrastructure-level attacks, but not against the Cloudflare account owner or Cloudflare employees.

## Alternatives Considered

### 1. Application-Layer Encryption + Plaintext Search Sidecar

Encrypt files in R2 with per-installation AES-256-GCM keys. Maintain a second, unencrypted copy in a separate R2 prefix that AI Search indexes.

- **Complexity:** Medium — crypto module, HKDF key derivation, dual-write to R2
- **Search quality:** Unaffected
- **Threat model:** The plaintext sidecar has the exact same exposure as the current setup. This is security theater.
- **Cost:** 2x R2 storage

**Rejected.** The plaintext copy negates the encryption entirely.

### 2. Encrypt Everything, Replace AI Search with Vectorize + Workers AI

Remove AI Search. Build a custom pipeline: on sync, generate embeddings via Workers AI (`@cf/bge-base-en-v1.5`), store vectors in Vectorize, then encrypt the source file and write to R2. Search queries Vectorize for nearest vectors, then decrypts matching R2 objects.

- **Complexity:** High — replace entire search backend, implement chunking, embedding generation, retrieval + ranking
- **Search quality:** Likely worse initially. AI Search provides optimized RAG with chunking, re-ranking, and snippet extraction out of the box. A naive Vectorize implementation needs significant work to match.
- **Threat model:** Best coverage of any feasible option. Plaintext exists only transiently in Worker memory during sync and search. R2 contains only ciphertext. No sidecar.
- **Cost:** Workers AI free tier (10k neurons/day), Vectorize free tier (5M vectors). Likely sufficient for personal use.
- **Migration:** Full re-sync required. Delete AI Search instance. Create Vectorize index.

**Deferred.** The only approach that provides meaningful encryption at rest, but the implementation cost is substantial and search quality would regress without significant investment.

### 3. R2 SSE-C (Server-Side Encryption with Customer-Provided Keys)

Use R2's native `ssecKey` parameter on all `put`/`get` calls. R2 encrypts/decrypts at the storage layer.

- **Complexity:** Low-medium — add `ssecKey` to ~20 R2 call sites, derive per-installation keys via HKDF
- **Search quality:** Destroyed. AI Search cannot provide SSE-C keys when reading objects.
- **Threat model:** Marginal improvement over R2 default encryption. Cloudflare transiently holds the key during each encrypt/decrypt operation. The Worker holds the master key in env secrets.

**Rejected.** Breaks search completely. Would only be viable combined with Alternative 2.

### 4. Selective Encryption (Content Encrypted, Metadata Plaintext)

Encrypt file bodies but keep paths and custom metadata unencrypted. AI Search indexes filenames/metadata only.

- **Complexity:** Medium
- **Search quality:** Severely degraded. No semantic search over content — only filename/metadata matching. The product becomes an encrypted file browser, not a searchable knowledge base.
- **Threat model:** File paths and structure are exposed (operator can see `finances/tax-2025.md` but not its contents).

**Rejected.** Guts the core product value.

### 5. Transparency + R2 Default Encryption (Status Quo, Documented)

Accept that R2 already encrypts at rest with Cloudflare-managed keys. Document the trust model explicitly: users trust both Cloudflare (infrastructure provider) and the platform operator. Focus effort on access control (ADR-002) and transparency rather than application-layer encryption.

- **Complexity:** Very low — documentation and minor audit logging
- **Search quality:** Unaffected
- **Threat model:** Same as current. Protects against external attackers (TLS, Cloudflare access controls) and physical disk theft (R2 default encryption). Does not protect against the platform operator or Cloudflare employees. But this is explicit and documented.
- **Cost:** Zero

**Accepted for Phase 1.** Honest and pragmatic. Most SaaS products operate at this trust level. Users already trust GitHub with the same data.

### 6. Client-Side / End-to-End Encryption

Encrypt on the client (Claude) before content reaches the server. The server stores and indexes only ciphertext.

- **Complexity:** Prohibitive. No mechanism for Claude to hold persistent encryption keys, encrypt search queries into vector space, or decrypt results. Would require a local MCP proxy and fundamentally different architecture.
- **Search quality:** Cannot work with semantic search without impractical cryptographic schemes (FHE, SSE).

**Rejected.** Architecturally impossible with the remote MCP model.

### 7. Per-User R2 Buckets + AI Search Instances

Create a dedicated R2 bucket and AI Search instance per installation via API. Each AI Search instance points at its own single-tenant bucket, preserving full R2/AI Search interoperability.

As of January 2026, AI Search supports programmatic instance creation (`POST /accounts/{id}/ai-search/instances`), making this feasible.

- **Complexity:** Medium-high — dynamic bucket creation, AI Search instance lifecycle, runtime bucket targeting (R2 bindings are static in wrangler.toml, so requires S3-compatible API or dynamic binding resolution)
- **Search quality:** Unaffected — each AI Search instance indexes its own bucket normally
- **Tenant isolation:** Hard isolation. No folder-prefix filtering needed. No cross-tenant leakage risk. Clean data lifecycle (delete bucket = delete everything).
- **Operator access:** Does **not** solve the operator-read problem. The Cloudflare account owner has full access to all R2 buckets and AI Search instances in their account. There is no IAM mechanism to make a bucket unreadable by the account owner within a single Cloudflare account.
- **Cost:** Each R2 bucket and AI Search instance is a separate billable resource. Free tier limits may constrain scaling.

**Deferred for Phase 2.** Valuable for tenant isolation even though it doesn't address operator access.

### (Future) Bring Your Own Account (BYOA)

Users provide their own Cloudflare account. R2 + AI Search run in their account; the Worker runs in ours. The operator never has credentials to the user's storage.

This is the only architecture that achieves true operator-blindness, but it is a fundamentally different product model requiring users to have Cloudflare accounts and manage their own infrastructure credentials.

**Noted as Phase 3 aspiration.** Only worth pursuing if there is concrete enterprise/team demand.

## Decision

### Phase 1 (Now): Transparency

1. **Document the trust model** on the homepage, README, and setup flow. Users should understand, before connecting a repository, that the platform operator has technical access to their synced content.
2. **Complete ADR-002 Phase 3** (ScopedR2/ScopedAISearch wrappers) to prevent accidental cross-tenant access in application code.

### Phase 2 (Future): Per-User Isolation

Migrate to per-user R2 buckets and AI Search instances for hard tenant isolation. This eliminates the cross-tenant leakage risk from shared-bucket folder filtering and provides clean per-user data lifecycle. Does not solve operator access but significantly improves the isolation model.

### Phase 3 (Aspirational): BYOA

If enterprise users require contractual guarantees that the operator cannot access their data, explore a BYOA model where users' R2 and AI Search resources run in their own Cloudflare accounts.

## Consequences

- Users are informed about the security model before connecting sensitive repositories
- No degradation to search quality or product functionality
- The door remains open for stronger encryption in the future via Alternative 2 or 7
- Any application-layer encryption scheme where the Worker holds decryption keys is ultimately bypassable by the operator (who controls the Worker code) — this is an inherent limitation of the server-side trust model, not a fixable gap
