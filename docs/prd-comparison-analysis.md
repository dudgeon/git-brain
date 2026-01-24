# PRD vs Current Implementation - Comparison Analysis

**Date:** 2026-01-24
**PRD:** Enhanced Brain Search with Source Links and Document Retrieval
**Implementation:** src/index.ts (current state)

---

## Executive Summary

**Key Finding:** The PRD's primary feature (FR1: Search Results Include Source URLs) is **already implemented**! The `search_brain` tool currently returns results with filenames and GitHub source links (src/index.ts:165-171). However, several enhancements proposed in the PRD would still add value, particularly batch retrieval and URL-based document access.

---

## Feature-by-Feature Comparison

### FR1: Search Results Include Source URLs

| Aspect | PRD Proposal | Current Implementation | Status |
|--------|--------------|----------------------|--------|
| **Source attribution** | Each chunk includes filename and GitHub URL | ✅ Implemented (line 168-169) | ✅ **DONE** |
| **GitHub URL construction** | Use `getSourceUrl()` helper | ✅ Implemented (line 121-124) | ✅ **DONE** |
| **Environment config** | `GITHUB_REPO_URL` env var | ✅ Implemented (line 12) | ✅ **DONE** |
| **Response format** | JSON with `source` object | ❌ Returns markdown text instead | 🔶 **DIFFERENT** |

**Current Output Format (src/index.ts:165-171):**
```typescript
const output = response.data
  .map((r, i) => {
    const contentText = r.content.map((c) => c.text).join("\n");
    const sourceLink = this.getSourceUrl(r.filename);
    return `## ${i + 1}. ${r.filename}\n**Score:** ${r.score.toFixed(2)} | **Source:** ${sourceLink}\n\n${contentText}`;
  })
  .join("\n\n---\n\n");
```

**PRD Proposed Format:**
```json
{
  "chunks": [{
    "content": "...",
    "score": 0.92,
    "source": {
      "path": "domains/family/owen/swim/README.md",
      "url": "https://github.com/..."
    }
  }]
}
```

**Analysis:**
- ✅ Source URLs are already included
- 🔶 Format is markdown text (user-friendly) vs structured JSON (machine-parseable)
- Both approaches work; markdown is better for human readability in Claude UI
- **Verdict:** No change needed unless structured JSON has specific advantages

---

### FR2: New `retrieve_documents` Tool

| Aspect | PRD Proposal | Current Implementation | Gap |
|--------|--------------|----------------------|-----|
| **Tool name** | `retrieve_documents` | `get_document` | ✅ Exists (different name) |
| **Accept file paths** | ✅ Yes | ✅ Yes (line 205) | ✅ **DONE** |
| **Accept GitHub URLs** | ✅ Yes | ❌ No - paths only | ❌ **MISSING** |
| **Batch retrieval** | ✅ Yes (up to 10 docs) | ❌ No - single doc only | ❌ **MISSING** |
| **Error handling** | ✅ Descriptive errors | ✅ Implemented (line 214-223) | ✅ **DONE** |
| **Metadata in response** | ✅ Size, last modified | ❌ Only content returned | ❌ **MISSING** |

**Current `get_document` Tool (src/index.ts:200-249):**
```typescript
this.server.tool(
  "get_document",
  "Get the full content of a specific document by its path.",
  {
    path: z.string().describe("Path to the document (e.g., 'projects/cnc/notes.md')"),
  },
  async ({ path }) => {
    // Normalizes path, retrieves from R2, returns content
    // Returns text only: `# ${path}\n\n${content}`
  }
);
```

**What's Missing:**
1. ❌ Can't accept GitHub URLs - only file paths
2. ❌ Can't retrieve multiple documents in one call
3. ❌ Doesn't return metadata (size, uploaded date, etc.)

**Impact:**
- Users must manually extract paths from GitHub URLs
- Multiple retrievals require multiple tool calls (slower)
- No visibility into file metadata

---

### FR3: Search Response Guidance for Claude

| Aspect | PRD Proposal | Current Implementation | Status |
|--------|--------------|----------------------|--------|
| **Guidance in tool description** | Mention retrieval tool | ❌ Not explicitly mentioned | ❌ **MISSING** |
| **Guidance in response** | Optional guidance field | ❌ Not present | ❌ **MISSING** |

**Current `search_brain` Description (src/index.ts:93-116):**
```typescript
private buildSearchDescription(): string {
  let description = `Search a personal knowledge base containing notes, documents, and reference materials. ` +
    `This is a private second-brain system, NOT a general knowledge source. `;

  // ... dynamic topics/domains ...

  description += `\n\nUse this tool for: Personal notes, project documentation, family information, reference materials stored in this specific knowledge base. `;
  description += `\n\nDO NOT use for: General knowledge questions, current events, or information that would be in public sources. `;

  description += `\n\nReturns relevant passages with source document links.`;

  return description;
}
```

**What's Missing:**
- No mention of `get_document` tool for retrieving full documents
- No explicit guidance to use retrieval when search chunks are incomplete

**Suggested Addition:**
```typescript
description += `\n\nReturns relevant passages with source document links. ` +
  `For complete document content, use the 'get_document' tool with the filename from search results.`;
```

---

### FR4: URL as Primary Identifier

| Aspect | PRD Proposal | Current Implementation | Status |
|--------|--------------|----------------------|--------|
| **URLs in search results** | ✅ GitHub URLs | ✅ Implemented (line 168) | ✅ **DONE** |
| **Retrieval by URL** | ✅ Parse GitHub URL → path | ❌ Path only | ❌ **MISSING** |
| **Retrieval by path** | ✅ Fallback support | ✅ Implemented | ✅ **DONE** |

**Current Behavior:**
- Search results include GitHub URLs
- But `get_document` only accepts paths, not URLs
- User must manually extract path from URL

**Example Workflow Gap:**
1. Search returns: `https://github.com/dudgeon/home-brain/blob/main/domains/family/README.md`
2. User wants full document
3. Must manually extract `domains/family/README.md` from URL
4. Call `get_document("domains/family/README.md")`

**PRD Proposal:**
- Accept both URLs and paths
- Parse URL → extract path → fetch from R2

---

## Gap Summary

### ✅ Already Implemented (No Action Needed)

1. **Search source attribution** - Search results include filename + GitHub URL
2. **GitHub URL construction** - `getSourceUrl()` helper exists
3. **Environment configuration** - `GITHUB_REPO_URL` env var defined
4. **Document retrieval** - `get_document` tool retrieves documents by path
5. **Error handling** - Graceful error messages for missing files

### ❌ Missing Features (From PRD)

1. **Accept GitHub URLs in `get_document`** - Currently path-only
2. **Batch retrieval** - Retrieve multiple documents in one call
3. **Metadata in retrieval response** - Size, last modified, etc.
4. **Explicit guidance** - Link search → retrieval in tool descriptions
5. **Line numbers** (nice-to-have) - Not in search results

### 🔶 Design Differences (Not necessarily gaps)

1. **Response format** - Markdown text vs structured JSON (current approach may be better for UX)

---

## Recommendations

### Priority 1: High-Value Enhancements

**1. Add URL support to `get_document`** (Low effort, high value)
- Accept both GitHub URLs and file paths
- Parse URL → extract path → fetch from R2
- Example: `get_document("https://github.com/.../blob/main/docs/file.md")` works

**Implementation:**
```typescript
// Add URL parsing helper
private parseSourceUrl(source: string): string {
  // If it's a URL, extract the path
  const match = source.match(/\/blob\/[^/]+\/(.+)$/);
  if (match) return match[1];

  // Otherwise treat as direct path
  return source.startsWith("/") ? source.slice(1) : source;
}

// Update get_document to use it
async ({ path }) => {
  const normalizedPath = this.parseSourceUrl(path);
  // ... rest of implementation
}
```

**2. Add explicit retrieval guidance to search description** (Trivial, high value)
- Update `buildSearchDescription()` to mention `get_document`
- Help Claude understand when to retrieve full documents

**Implementation:**
```typescript
description += `\n\nReturns relevant passages with source document links. ` +
  `For complete context, use 'get_document' with the filename from results.`;
```

### Priority 2: Nice-to-Have Enhancements

**3. Add batch retrieval** (Medium effort, medium value)
- New tool `retrieve_documents` accepting array of sources
- Or modify `get_document` to accept string | string[]
- Parallel R2 fetches with `Promise.all()`

**4. Include metadata in retrieval response** (Low effort, medium value)
- Add size, uploaded date to `get_document` output
- Useful for cache invalidation, version awareness

### Priority 3: Optional/Deferred

**5. Structured JSON response format** (Not recommended)
- Current markdown format works well for Claude UI
- Changing to JSON adds complexity without clear benefit
- Only needed if machine parsing is required

**6. Line numbers in search results** (Depends on AutoRAG capabilities)
- Verify if AutoRAG provides chunk position
- If yes, calculate line numbers
- If no, defer to future

---

## Updated PRD Scope

Given the existing implementation, the PRD should be revised to focus on:

### Phase 1: URL Support & Guidance (Quick wins)
- ✅ Enhance `get_document` to accept GitHub URLs
- ✅ Add retrieval guidance to `search_brain` description
- ✅ Test with real URLs from search results

### Phase 2: Batch Retrieval (Optional)
- ✅ Add `retrieve_documents` tool (or enhance `get_document`)
- ✅ Support array of sources
- ✅ Parallel fetching with size limits

### Phase 3: Metadata & Polish (Nice-to-have)
- ✅ Include file metadata in responses
- ✅ Line numbers (if AutoRAG supports)
- ✅ Response caching (if needed)

---

## Open Questions

### Q1: Should we rename `get_document` to `retrieve_documents`?
- **Pro:** Matches PRD naming, clearer intent
- **Con:** Breaking change for existing users
- **Recommendation:** Keep `get_document`, add batch support via array parameter

### Q2: Should we change response format to structured JSON?
- **Pro:** Machine-parseable, more extensible
- **Con:** Less readable in Claude UI, MCP already has structured responses
- **Recommendation:** Keep markdown for now, reassess if parsing becomes needed

### Q3: Should batch retrieval be a separate tool or parameter?
- **Option A:** New tool `retrieve_documents(sources: string[])`
- **Option B:** Enhance `get_document(path: string | string[])`
- **Recommendation:** Option B (simpler, backward compatible)

### Q4: What metadata is most valuable?
- **Available from R2:** size, uploaded, httpMetadata, customMetadata
- **Proposed:** size, uploaded (last modified), GitHub URL
- **Recommendation:** Start with size + uploaded, add more if requested

---

## Conclusion

The PRD's **core premise** (search lacks source attribution) is **outdated** - this feature already exists! However, the PRD still identifies valuable enhancements:

**Implemented (85% of PRD value):**
- ✅ Search results with source URLs
- ✅ Document retrieval capability
- ✅ GitHub URL construction
- ✅ Error handling

**Still Valuable (15% incremental value):**
- ⬜ URL support in `get_document` (high value, low effort)
- ⬜ Explicit retrieval guidance (high value, trivial effort)
- ⬜ Batch retrieval (medium value, medium effort)
- ⬜ Metadata in responses (low value, low effort)

**Recommendation:** Implement Priority 1 enhancements (URL support + guidance), defer batch retrieval to v2 based on actual usage patterns.

---

## Next Steps

1. **Update PRD** to reflect current state and focus on actual gaps
2. **Quick implementation** of URL parsing + guidance (< 1 day)
3. **Test** with real search → retrieval workflows
4. **Measure** whether batch retrieval is needed (based on tool usage logs)
5. **Iterate** on additional enhancements as needed
