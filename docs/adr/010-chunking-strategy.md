# ADR-010: Chunking Strategy for AI Search

## Context

Git Brain stores complete files in R2 and delegates all chunking to Cloudflare AI Search. AI Search uses recursive chunking (splitting at paragraph/sentence boundaries) with configurable chunk size and overlap, set in the Cloudflare dashboard. The application has no code-level control over how chunks are formed, what context they carry, or how they're embedded.

This works acceptably for short documents (most brain content is <2000 tokens), but has a structural weakness: chunks from the middle or end of a document lose their document-level context. A chunk containing "Owen's first 50 free" carries no signal that it belongs to `domains/family/swim-team.md` beyond the `r.filename` metadata returned at query time.

### What AI Search Exposes

| Parameter | Scope | Where configured |
|-----------|-------|-----------------|
| Chunk size (tokens) | Instance-level | Cloudflare dashboard |
| Chunk overlap (%) | Instance-level | Cloudflare dashboard |
| `max_num_results` | Per-query | Code (`searchOptions`) |
| Metadata filters | Per-query | Code (`filters`) |

There is no API to inject per-chunk metadata, customize split boundaries, or add document-level context to individual chunks.

### Options Considered

#### Option A: Pre-chunk files into separate R2 objects

Split each source file into chunk-sized R2 objects (e.g., `path/to/file.md/chunk-001.md`), each prepended with the document's frontmatter and path context. AI Search would then treat each chunk as a standalone document.

**Pros:** Full control over chunk boundaries and context propagation.

**Cons:** Double-chunking (our split, then AI Search's split). Breaks `get_document`, `list_recent`, `list_folders`, and brain summary — all assume 1 R2 object = 1 source file. Significant implementation complexity. Fighting the abstraction rather than working with it.

**Decision: Rejected.** The tool breakage and double-chunking make this impractical without a way to disable AI Search's internal chunking.

#### Option B: Enrich files with frontmatter at sync time

During `syncRepo` and `syncChangedFiles`, prepend a YAML frontmatter block to files that lack one before writing to R2:

```yaml
---
path: domains/family/swim-team.md
domain: family
---
```

AI Search's recursive chunker would include this in early chunks of each file. Later chunks in long documents would still lose it, but most brain documents are short enough that the frontmatter falls within the first (often only) chunk.

**Pros:** Simple to implement. Doesn't break any tools. Gives AI Search more semantic signal. Files that already have frontmatter (inbox items, clips) are unaffected.

**Cons:** Doesn't help later chunks in long documents. Modifies R2 content relative to the source repo (cosmetic divergence). Needs care not to double-prepend on re-sync.

**Decision: Adopt.** Low cost, meaningful improvement for the common case (short documents).

#### Option C: Post-retrieval enrichment

When `search_brain` returns chunks, fetch document-level context (frontmatter, first heading, path) from R2 and prepend it to each chunk before returning to Claude. This is a read-time enhancement that doesn't touch R2 or AI Search.

```typescript
// Before (current):
const contentText = r.content.map((c) => c.text).join("\n");

// After:
const header = await getDocumentHeader(env.R2, r.filename); // first ~10 lines
const contentText = header + "\n\n" + r.content.map((c) => c.text).join("\n");
```

**Pros:** Works for all chunks regardless of document length. Doesn't modify stored files. R2 reads are cheap (~0.36/million). Fully reversible.

**Cons:** Adds one R2 `get` per search result (5-20 extra reads per query). Slightly increases response latency. Header extraction needs to handle files without frontmatter gracefully.

**Decision: Adopt.** Complements Option B by covering long documents where frontmatter falls outside later chunks.

#### Option D: Dashboard tuning (chunk size + overlap)

Adjust the AI Search instance settings to use smaller chunks (~256 tokens) with moderate overlap (~15-20%). Smaller chunks improve precision for the short-document, high-specificity queries typical of a personal knowledge base.

**Decision: Adopt.** Free, reversible, and the first thing to try. Requires a full reindex after changing settings.

## Decision

**Implement B + C + D in phases:**

1. **Phase 1 — Dashboard tuning (D):** Adjust chunk size and overlap in the Cloudflare dashboard for `home-brain-search`. Trigger reindex. Evaluate search quality improvement.

2. **Phase 2 — Frontmatter injection (B):** During sync, prepend a `path` + `domain` frontmatter block to files that don't already have YAML frontmatter. Skip files that already start with `---`. Regenerate on full sync; incremental sync applies to changed files only.

3. **Phase 3 — Post-retrieval enrichment (C):** In `search_brain`, fetch the first N lines of each result's source document from R2 and prepend as context. Cache headers in the Durable Object to avoid repeated reads for the same file across queries.

Phases are independent and can be shipped separately. Phase 1 requires no code changes. Phases 2 and 3 are code changes that can be evaluated independently.

## Consequences

- Search quality should improve, especially for queries where the matched chunk lacks document-level context ("what's the status of X" matching a bullet point in a larger planning doc).
- R2 content will diverge slightly from the source GitHub repo (Phase 2 adds frontmatter). This is acceptable — R2 is a search index, not a mirror. `get_document` already serves R2 content, not GitHub content.
- Post-retrieval enrichment (Phase 3) adds latency proportional to result count. For the default 5 results, this is ~5 parallel R2 reads (~10-20ms total). Acceptable.
- If Cloudflare ships native document-level metadata for AI Search chunks, Phase 2 becomes unnecessary and Phase 3 can be simplified. Monitor [AI Search release notes](https://developers.cloudflare.com/ai-search/platform/release-note/).

## References

- [Cloudflare AI Search — Chunking](https://developers.cloudflare.com/ai-search/configuration/chunking/)
- [Cloudflare AI Search — Retrieval Configuration](https://developers.cloudflare.com/ai-search/configuration/retrieval-configuration/)
- [AI Search indexing improvements (Feb 2026)](https://developers.cloudflare.com/changelog/2026-02-09-indexing-improvements/)
- [ADR-002: Security Isolation](002-security-isolation.md) — folder metadata filtering for tenant isolation
- [ADR-003: Encryption at Rest](003-encryption-at-rest.md) — discusses AI Search's R2 access requirements
