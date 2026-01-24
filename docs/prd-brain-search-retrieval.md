# PRD: Enhanced Brain Search with Source Links and Document Retrieval

**Status:** Draft
**Version:** 1.0
**Date:** 2026-01-24
**Author:** Product / Engineering

---

## Executive Summary

Enhance the Git Brain MCP server's search capabilities to provide richer context and enable seamless navigation between search results and full document content. Currently, search returns text chunks without source attribution or easy access to complete documents. This PRD proposes adding GitHub source links to search results and a dedicated retrieval tool for accessing full documents.

---

## Background

### Current State

Git Brain exposes a `search_brain` tool that performs semantic search via Cloudflare AI Search (AutoRAG). Current behavior:

- **Input:** Search query string + optional limit
- **Output:** Array of text chunks matching the query
- **Limitations:**
  - No indication of which file/document each chunk came from
  - No way to access the full document containing a relevant chunk
  - Users must manually use `list_folders` + `get_document` to find source files
  - Breaks the user's workflow when they need more context

### Existing Related Functionality

- `get_document(path)` - Retrieves full document from R2 by file path
- `/doc/{path}` HTTP endpoint - Direct document access
- Search results currently have file paths in metadata (internal to AutoRAG) but don't expose them

---

## Problem Statement

When Claude (or users via Claude) searches the knowledge base:

1. **Lost provenance:** Search chunks appear without source attribution, making it unclear where information came from
2. **Context gap:** Users can't easily get more context from the surrounding document when a chunk is interesting but incomplete
3. **Manual workflow:** Finding the source document requires guessing paths or browsing folders
4. **Poor discoverability:** Users don't know a retrieval mechanism exists (get_document) or how to use it effectively

This creates friction and reduces the value of search results, especially for:
- Verifying information accuracy
- Understanding broader context
- Exploring related content in the same document
- Navigating to GitHub to edit or view history

---

## Goals & Objectives

### Primary Goals

1. **Improve search result attribution** - Every chunk should clearly indicate its source file
2. **Enable seamless context expansion** - Users should easily access full documents from search results
3. **Encourage GitHub engagement** - Provide clickable links to view/edit source files in GitHub
4. **Guide Claude's behavior** - Help Claude understand when to retrieve full documents for better context

### Success Metrics

- Search results include source URLs in 100% of cases
- Users can navigate from chunk → full document in 1 click/tool call
- Reduction in manual folder browsing after search (measure via tool usage patterns)
- Claude autonomously uses retrieval tool when appropriate (qualitative assessment)

### Non-Goals

- Changing the underlying search algorithm or relevance ranking
- Adding write-back capabilities (separate feature)
- Supporting non-GitHub source systems (out of scope for v1)

---

## Proposed Solution

### High-Level Approach

**Enhance `search_brain` output** to include GitHub source URLs alongside each chunk, and **introduce a new `retrieve_documents` tool** for fetching full document content. The search tool's response should guide Claude to use retrieval when more context is needed.

### User Stories

**As an AI assistant (Claude):**
- I want to see where each search result came from so I can attribute information correctly
- I want to be prompted to retrieve full documents when a chunk is interesting but incomplete
- I want to understand when to use search vs. retrieval

**As an end user:**
- I want to click on a search result to view the full document in GitHub
- I want to see file history and metadata for sources Claude references
- I want to edit source documents directly when Claude surfaces relevant content

---

## Functional Requirements

### FR1: Search Results Include Source URLs

**Requirement:** Each chunk returned by `search_brain` must include:
- **GitHub URL** - Direct link to the file in the `home-brain` repository
- **File path** - Relative path within the repo (e.g., `domains/family/owen/swim/README.md`)
- **Line range (optional)** - If AutoRAG provides chunk position, include line numbers

**Format (proposed):**
```json
{
  "chunks": [
    {
      "content": "Owen's swim practice is on Tuesdays and Thursdays...",
      "score": 0.92,
      "source": {
        "path": "domains/family/owen/swim/README.md",
        "url": "https://github.com/dudgeon/home-brain/blob/main/domains/family/owen/swim/README.md",
        "lines": "15-23"  // optional
      }
    }
  ]
}
```

**Acceptance Criteria:**
- All search results include `source.path` and `source.url`
- URLs are valid and clickable (open to correct file in GitHub)
- URLs point to the main branch (or configurable default branch)
- URLs work for nested folder structures

---

### FR2: New `retrieve_documents` Tool

**Requirement:** Add a dedicated MCP tool for fetching full document content by path or URL.

**Tool Signature:**
```typescript
{
  name: "retrieve_documents",
  description: "Retrieve full document content from the knowledge base. Use this when you need complete context around a search result or want to read an entire document. Accepts file paths or GitHub URLs.",
  parameters: {
    sources: string | string[]  // File path(s) or GitHub URL(s)
  }
}
```

**Behavior:**
- Accepts single path/URL or array of paths/URLs
- Resolves GitHub URLs to R2 file paths (strip base URL + parse path)
- Fetches document(s) from R2 via existing `R2.get()` logic
- Returns full content with metadata (path, size, last modified)
- Handles missing files gracefully (return error for that file, continue with others)

**Acceptance Criteria:**
- Tool works with both file paths (`domains/family/README.md`) and GitHub URLs
- Supports batch retrieval (multiple files in one call)
- Returns content as text (not binary) for supported formats
- Includes metadata: path, size, last_modified timestamp
- Errors are descriptive (e.g., "File not found: path/to/missing.md")

---

### FR3: Search Response Guidance for Claude

**Requirement:** The `search_brain` tool's response should include guidance that prompts Claude to use `retrieve_documents` when appropriate.

**Proposed Response Format:**
```json
{
  "chunks": [ /* array of chunks with sources */ ],
  "guidance": "These are excerpts from larger documents. If you need more context or want to see the complete document, use the 'retrieve_documents' tool with the source path or URL."
}
```

**Alternative (simpler):** Add guidance to the tool's **description** instead of response:

```
search_brain description:
"Search returns text excerpts with source links. For complete context, use 'retrieve_documents' with the source path/URL from search results."
```

**Acceptance Criteria:**
- Claude is prompted to use retrieval tool when search results are incomplete
- Guidance is clear and actionable
- Does not clutter search output excessively

---

### FR4: URL as Primary Identifier

**Requirement:** Use GitHub URLs as the canonical identifier for documents (rather than internal indices).

**Rationale:**
- URLs are human-readable and meaningful
- URLs enable direct navigation to GitHub UI
- R2 paths can be derived from URLs programmatically
- Simpler than maintaining a separate ID system

**Implementation Notes:**
- GitHub URL format: `https://github.com/{owner}/{repo}/blob/{branch}/{path}`
- Parsing logic: Extract `{path}` from URL, use as R2 key
- Handle edge cases: URL encoding, special characters in filenames
- Support relative paths as fallback (e.g., `domains/family/README.md` without full URL)

**Acceptance Criteria:**
- Both full GitHub URLs and relative paths work in `retrieve_documents`
- URL parsing is robust (handles encoded characters, nested paths)
- URLs in search results match expected GitHub format
- Configuration supports custom GitHub base URL (for future multi-repo support)

---

## Technical Design Considerations

### AutoRAG Response Structure

Current AutoRAG response (from `AI.run()`):
```typescript
{
  data: [
    {
      content: [{ text: "chunk text..." }],
      metadata: { /* may include file path */ }
    }
  ]
}
```

**Question:** Does AutoRAG metadata include source file paths?
**Action Required:** Verify AutoRAG response structure and determine how to extract source paths.

**Options:**
1. **AutoRAG includes paths** - Extract from `metadata.path` or similar field
2. **AutoRAG doesn't include paths** - Need to query Vectorize index directly or store path in chunk metadata during indexing
3. **Hybrid approach** - Enhance indexing to ensure paths are embedded in chunk metadata

---

### R2 Object Metadata

R2 objects already have metadata (uploaded by `sync-to-r2.yml`). Possible to enhance with:
- Relative path within repo
- GitHub base URL
- Last commit hash (for versioning)

**Current metadata (assumed):**
- `customMetadata.source_path` - Relative path in repo
- Standard R2 fields: `uploaded`, `size`, `httpMetadata`

**Enhancement:** Add `customMetadata.github_url` during sync to avoid runtime URL construction.

---

### Batch Retrieval Performance

`retrieve_documents` should support batch retrieval to minimize round-trips when Claude needs multiple files.

**Considerations:**
- Parallel R2 fetches (use `Promise.all()`)
- Size limits (don't fetch 50 files at once - add reasonable limit, e.g., 10)
- Response size (multiple large docs could exceed Worker response limits)

**Proposed Limits:**
- Max 10 documents per retrieval call
- Max 5MB total response size
- Return error if limits exceeded with actionable message

---

### URL Parsing & Validation

GitHub URL format: `https://github.com/{owner}/{repo}/blob/{branch}/{path}`

**Parsing logic:**
```typescript
function parseGitHubUrl(url: string): { path: string } | null {
  const pattern = /github\.com\/[^/]+\/[^/]+\/blob\/[^/]+\/(.+)$/;
  const match = url.match(pattern);
  return match ? { path: decodeURIComponent(match[1]) } : null;
}
```

**Fallback:** If not a GitHub URL, treat as direct R2 path.

---

### Environment Configuration

Add to `wrangler.toml`:
```toml
[vars]
GITHUB_REPO_OWNER = "dudgeon"
GITHUB_REPO_NAME = "home-brain"
GITHUB_DEFAULT_BRANCH = "main"
```

This enables constructing GitHub URLs in search results.

---

## User Experience Flow

### Before (Current)

1. User: "What swim times does Owen need for Sectionals?"
2. Claude calls `search_brain("Owen sectionals swim times")`
3. Response: `["Owen needs to achieve AA times for 50 Free (28.5s)..."]`
4. Claude responds with information
5. **User wants more context** → Must manually browse folders or ask Claude to explore

### After (Proposed)

1. User: "What swim times does Owen need for Sectionals?"
2. Claude calls `search_brain("Owen sectionals swim times")`
3. Response:
   ```json
   {
     "chunks": [{
       "content": "Owen needs to achieve AA times for 50 Free (28.5s)...",
       "source": {
         "path": "domains/family/owen/swim/sectionals-2025.md",
         "url": "https://github.com/dudgeon/home-brain/blob/main/domains/family/owen/swim/sectionals-2025.md"
       }
     }]
   }
   ```
4. Claude sees partial information, decides to get full context
5. Claude calls `retrieve_documents("domains/family/owen/swim/sectionals-2025.md")`
6. Response includes full document with all events, times, and context
7. Claude provides comprehensive answer with source attribution
8. User can click GitHub URL to view/edit source

---

## Implementation Phases

### Phase 1: Search Source Attribution (MVP)
- ✅ Extract file paths from AutoRAG responses
- ✅ Construct GitHub URLs from paths
- ✅ Add `source` field to search result chunks
- ✅ Add environment config for GitHub repo details
- ✅ Test with existing search queries

**Deliverable:** `search_brain` returns chunks with `source.path` and `source.url`

### Phase 2: Document Retrieval Tool
- ✅ Implement `retrieve_documents` tool with Zod schema
- ✅ Add URL parsing logic
- ✅ Support both single and batch retrieval
- ✅ Handle errors gracefully
- ✅ Add metadata to responses (size, last modified)

**Deliverable:** New MCP tool `retrieve_documents` available to Claude

### Phase 3: Response Guidance
- ✅ Update `search_brain` description to mention retrieval tool
- ✅ (Optional) Add guidance field to search responses
- ✅ Test Claude's behavior - does it use retrieval appropriately?

**Deliverable:** Claude autonomously uses retrieval when context is needed

### Phase 4: Optimization & Polish
- ✅ Batch retrieval performance tuning
- ✅ Response size limits and validation
- ✅ Enhanced error messages
- ✅ Logging and observability

**Deliverable:** Production-ready, performant retrieval experience

---

## Open Questions

### Q1: AutoRAG Metadata Structure
**Question:** Does Cloudflare AutoRAG include source file paths in chunk metadata?
**Action:** Inspect actual AutoRAG responses to confirm metadata structure
**Risk:** If paths aren't included, may need to re-index with enhanced metadata

### Q2: Line Number Accuracy
**Question:** Can we reliably determine line numbers for chunks within documents?
**Options:**
- AutoRAG provides chunk position → Calculate line numbers
- Store line offsets during indexing
- Skip line numbers in v1 (just link to file)

**Recommendation:** Skip line numbers in v1, add in v2 if AutoRAG supports it

### Q3: Multi-Repo Support
**Question:** Should we design for multiple source repos from the start?
**Current Scope:** Single repo (`home-brain`)
**Future:** User may want to add other repos as separate brains

**Recommendation:** Use repo-agnostic paths internally, but hard-code GitHub config in v1. Add multi-repo in Phase 2 of service evolution.

### Q4: Caching Strategy
**Question:** Should we cache retrieved documents in KV to reduce R2 reads?
**Tradeoff:** Faster retrieval vs. stale content vs. added complexity

**Recommendation:** No caching in v1. Add KV caching in future iteration if R2 costs/latency become issues.

### Q5: Response Format for Guidance
**Question:** Should guidance be in search response payload or just in tool description?
**Option A:** Add `guidance` field to every response (more explicit)
**Option B:** Put guidance in tool description (less verbose)

**Recommendation:** Start with Option B (description), test Claude's behavior, add Option A if needed

---

## Success Criteria

### Must Have (P0)
- ✅ All search results include source URLs
- ✅ `retrieve_documents` tool works with paths and URLs
- ✅ URLs are valid GitHub links
- ✅ Claude can retrieve full documents from search results

### Should Have (P1)
- ✅ Batch retrieval supports multiple documents
- ✅ Response includes metadata (size, last modified)
- ✅ Error handling is graceful and descriptive
- ✅ Tool descriptions guide Claude's usage

### Nice to Have (P2)
- ⬜ Line numbers in source attribution
- ⬜ Response caching for frequently accessed docs
- ⬜ Support for non-markdown files (PDFs, images)
- ⬜ Document version history

---

## Out of Scope

The following are explicitly **not** part of this PRD:

- **Write operations** - Creating/updating documents (separate PRD)
- **Multi-repo support** - Single repo only in v1
- **Advanced search filters** - Metadata filtering, date ranges, etc.
- **Search result ranking changes** - Using AutoRAG's default ranking
- **Authentication/authorization** - Assumes existing security model
- **Local file caching** - No KV caching in v1

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| AutoRAG doesn't provide file paths in metadata | High | Verify early; if missing, re-index with custom metadata |
| Large batch retrievals exceed Worker limits | Medium | Add size limits (10 docs, 5MB) with clear error messages |
| URL parsing breaks with special characters | Low | Robust URL encoding/decoding; extensive testing |
| Claude doesn't use retrieval tool appropriately | Medium | Iterate on tool descriptions; add response guidance if needed |
| R2 read costs increase significantly | Low | Monitor usage; add KV caching if needed |

---

## Appendix: Example Tool Definitions

### Enhanced `search_brain`

```typescript
server.tool({
  name: "search_brain",
  description: `Search the knowledge base using semantic search. Returns excerpts (chunks) from relevant documents with source links.

Use this for: personal notes, project docs, family information, home automation, etc.
Do NOT use for: general knowledge, current events, or information not in the knowledge base.

**Important:** Search returns excerpts. For complete context, use 'retrieve_documents' with the source path/URL from results.`,

  parameters: z.object({
    query: z.string().describe("Search query"),
    limit: z.number().optional().default(5).describe("Max results")
  }),

  execute: async ({ query, limit }) => {
    // ... search logic ...
    return {
      chunks: results.map(r => ({
        content: r.text,
        score: r.score,
        source: {
          path: r.metadata.path,
          url: `https://github.com/${owner}/${repo}/blob/main/${r.metadata.path}`
        }
      }))
    };
  }
});
```

### New `retrieve_documents`

```typescript
server.tool({
  name: "retrieve_documents",
  description: `Retrieve full document content from the knowledge base. Use this when:
- You need complete context around a search result
- A search excerpt is interesting but incomplete
- You want to read an entire document referenced in search results

Accepts GitHub URLs or file paths. Supports batch retrieval (up to 10 documents).`,

  parameters: z.object({
    sources: z.union([z.string(), z.array(z.string())])
      .describe("GitHub URL(s) or file path(s) to retrieve")
  }),

  execute: async ({ sources }) => {
    const paths = Array.isArray(sources) ? sources : [sources];

    // Validate limits
    if (paths.length > 10) {
      throw new Error("Maximum 10 documents per request");
    }

    // Parse URLs to paths
    const resolvedPaths = paths.map(s =>
      s.startsWith('http') ? parseGitHubUrl(s).path : s
    );

    // Fetch from R2
    const docs = await Promise.all(
      resolvedPaths.map(async path => {
        const obj = await env.R2.get(path);
        if (!obj) return { path, error: "Not found" };

        return {
          path,
          content: await obj.text(),
          metadata: {
            size: obj.size,
            lastModified: obj.uploaded,
            url: `https://github.com/${owner}/${repo}/blob/main/${path}`
          }
        };
      })
    );

    return { documents: docs };
  }
});
```

---

## Timeline Estimate

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| Phase 1: Search Attribution | 1-2 days | Verify AutoRAG metadata structure |
| Phase 2: Retrieval Tool | 2-3 days | Phase 1 complete |
| Phase 3: Guidance | 1 day | Phase 2 complete |
| Phase 4: Polish | 1-2 days | Testing and iteration |
| **Total** | **5-8 days** | Assumes no major blockers |

---

## Approval & Next Steps

**Reviewers:**
- [ ] Product Owner - Approve scope and priorities
- [ ] Engineering Lead - Validate technical approach
- [ ] End User / Stakeholder - Confirm user experience flow

**Next Actions:**
1. Review and approve PRD
2. Verify AutoRAG metadata structure (technical spike)
3. Create implementation issues/tasks
4. Assign to engineer
5. Schedule for sprint

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-01-24 | Product/Eng | Initial draft |

