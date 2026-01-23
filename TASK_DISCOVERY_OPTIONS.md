# Task Discovery Options for Git Brain

## Problem Statement

Find incomplete markdown checkbox tasks (e.g., `- [ ] Task description`) scattered across a GitHub repository. While semantic embeddings search can find tasks based on meaning, we need approaches that can reliably find ALL syntactic task patterns regardless of semantic similarity.

## Standard Markdown Task Syntax

```markdown
- [ ] Incomplete task
- [x] Completed task
* [ ] Alternate bullet style
+ [ ] Another bullet style
1. [ ] Numbered list task
```

## Approach 1: Pattern-Based Search Tool (find_tasks)

Add a new MCP tool that performs regex/pattern matching across R2 files.

### Implementation
```typescript
this.server.tool(
  "find_tasks",
  "Find markdown checkbox tasks in the knowledge base. Searches for standard task syntax like '- [ ]' (incomplete) or '- [x]' (complete).",
  {
    status: z.enum(["incomplete", "complete", "all"]).optional().default("incomplete"),
    path_prefix: z.string().optional(),
    limit: z.number().optional().default(50),
  },
  async ({ status, path_prefix, limit }) => {
    // Iterate through R2 objects, read each file, search for patterns
    // Return tasks with file path, line number, and surrounding context
  }
);
```

### Pattern Matching Logic
```typescript
const patterns = {
  incomplete: /^(\s*[-*+]|\d+\.)\s+\[[ ]\]\s+(.+)$/gm,
  complete: /^(\s*[-*+]|\d+\.)\s+\[[xX]\]\s+(.+)$/gm,
};
```

### Output Format
```markdown
## Found 15 incomplete tasks

### domains/family/owen/swim/README.md
- Line 23: [ ] Register for spring session
- Line 24: [ ] Order new goggles
**Source:** https://github.com/dudgeon/home-brain/blob/main/domains/family/owen/swim/README.md

### projects/home-automation/backlog.md
- Line 8: [ ] Set up motion sensors in garage
- Line 12: [ ] Configure HomeKit integration
**Source:** https://github.com/dudgeon/home-brain/blob/main/projects/home-automation/backlog.md
```

### Pros
- **Complete coverage**: Finds ALL syntactic tasks, not just semantically similar ones
- **Fast**: Simple pattern matching, no AI processing
- **Deterministic**: Same query always returns same results
- **Separate concern**: Doesn't complicate the embeddings search tool
- **Context-rich**: Can include surrounding lines for context

### Cons
- **R2 iteration cost**: Must read and scan all files (or filtered subset)
- **No ranking**: Results are chronological or alphabetical, not relevance-ranked
- **Regex limitations**: May miss non-standard task formats
- **Memory**: Need to buffer results before returning (but limited by `limit` param)

### Performance Considerations
- **Optimization 1**: Cache task index in Durable Object state, refresh periodically
- **Optimization 2**: Filter by `path_prefix` to reduce files scanned
- **Optimization 3**: Use R2 conditional requests (etag) to skip unchanged files
- **Optimization 4**: Implement cursor-based pagination for large result sets

### Cost Estimate
- **Class A Operations** (R2 List): ~$0.0045 per 1000 files listed
- **Class B Operations** (R2 Get): ~$0.0036 per 1000 files read
- For a 500-file repo: ~$0.002 per full scan (negligible)

---

## Approach 2: Cached Task Index

Build and maintain a task index in R2 or Durable Object storage.

### Implementation
```typescript
// Cached in DO state or R2 as _task_index.json
interface TaskIndex {
  tasks: Array<{
    path: string;
    line: number;
    status: "incomplete" | "complete";
    text: string;
    context: string; // surrounding heading or paragraph
    lastChecked: string;
  }>;
  lastUpdated: string;
}
```

### Index Generation Strategies

**Option A: GitHub Action** (similar to brain summary)
- Weekly scheduled job + manual trigger
- Scans repo, extracts tasks, uploads `_task_index.json` to R2
- Consistent with current architecture

**Option B: On-demand in Worker**
- First `find_tasks` call triggers full scan and cache
- Subsequent calls use cached index
- Implement TTL or manual refresh

**Option C: Incremental updates**
- Track which files changed (using R2 uploaded timestamps)
- Only re-scan changed files
- Merge updates into existing index

### Tool Interface
```typescript
this.server.tool(
  "find_tasks",
  "Find markdown checkbox tasks using a cached index. Much faster than real-time scanning.",
  {
    status: z.enum(["incomplete", "complete", "all"]).optional().default("incomplete"),
    path_prefix: z.string().optional(),
    limit: z.number().optional().default(50),
    refresh_cache: z.boolean().optional(), // Force rebuild
  },
  async ({ status, path_prefix, limit, refresh_cache }) => {
    const index = await this.loadTaskIndex(refresh_cache);
    // Filter and return from index
  }
);
```

### Pros
- **Very fast**: O(1) lookup from pre-computed index
- **Reduced R2 costs**: Only scan files when index is stale
- **Enriched metadata**: Can pre-compute context, groupings, priorities
- **Scalable**: Works well even with thousands of files

### Cons
- **Staleness**: Index may be outdated until next refresh
- **Complexity**: Need index generation + refresh logic
- **Storage**: Additional R2 object or DO state storage
- **Sync timing**: If using GitHub Action, delays between push and index update

### Recommended: GitHub Action (Consistent with Current Architecture)

Since you already have `generate-summary.yml` running weekly, add task extraction to it:

```yaml
- name: Extract tasks
  run: |
    # Find all markdown files with tasks
    find . -name "*.md" -type f -exec grep -Hn "^[[:space:]]*[-*+] \[ \]" {} + > tasks.txt || true
    # Convert to JSON structure
    node .github/scripts/build-task-index.js

- name: Upload task index to R2
  run: |
    rclone copy _task_index.json r2:home-brain-store/
```

---

## Approach 3: Hybrid Search (Pattern + Embeddings)

Combine pattern matching with semantic search for intelligent ranking.

### Implementation
```typescript
this.server.tool(
  "search_tasks",
  "Search for tasks using natural language, then filter to actual checkbox tasks.",
  {
    query: z.string(),
    status: z.enum(["incomplete", "complete", "all"]).optional(),
    limit: z.number().optional().default(10),
  },
  async ({ query, status, limit }) => {
    // 1. Semantic search via AI Search
    const semanticResults = await this.env.AI.autorag(...);

    // 2. Filter results to only chunks containing task patterns
    const tasksOnly = semanticResults.filter(chunk => {
      return /^[-*+] \[ \]/.test(chunk.content);
    });

    // 3. Return ranked tasks
  }
);
```

### Pros
- **Relevance ranking**: "Tasks about swim team" finds semantically relevant tasks
- **Leverages existing infrastructure**: Uses AI Search already in place
- **Best of both worlds**: Semantic understanding + syntactic precision

### Cons
- **May miss tasks**: If a task chunk isn't in top N semantic results, it's filtered out
- **Higher latency**: Two-step process (search + filter)
- **More complex**: Harder to reason about what will/won't be found
- **Not exhaustive**: Can't guarantee finding ALL tasks in a scope

### When This Shines
- User asks: "What tasks do I have related to home automation?"
- User asks: "Show me incomplete tasks about Owen's swim schedule"

### When This Fails
- User asks: "Show me ALL incomplete tasks" (may miss some)
- Tasks in documents with poor semantic context

---

## Approach 4: Enhanced list_recent with Task Filter

Extend the existing `list_recent` tool to optionally show tasks from recent files.

### Implementation
```typescript
this.server.tool(
  "list_recent",
  "List recently modified files, optionally extracting tasks from them.",
  {
    limit: z.number().optional().default(10),
    path_prefix: z.string().optional(),
    extract_tasks: z.boolean().optional(), // NEW
    task_status: z.enum(["incomplete", "complete", "all"]).optional(),
  },
  async ({ limit, path_prefix, extract_tasks, task_status }) => {
    // Existing logic to list recent files
    // If extract_tasks: read each file and extract tasks
  }
);
```

### Pros
- **Minimal new code**: Extends existing tool
- **Scoped by recency**: Natural filter (recent activity = relevant tasks)
- **Familiar interface**: Users already know `list_recent`

### Cons
- **Not exhaustive**: Only searches recent files
- **Overloaded tool**: Mixes two concerns (file listing + task extraction)
- **Unclear naming**: "list_recent" doesn't suggest task finding

---

## Approach 5: Client-Side Filtering

Let Claude use existing tools (`search_brain`, `get_document`, `list_recent`) and filter tasks itself.

### How It Works
1. Claude asks: "Find incomplete tasks"
2. Claude calls `list_recent` to get recently modified files
3. Claude calls `get_document` on each file
4. Claude extracts tasks using its own pattern matching

### Pros
- **No server changes**: Works with current implementation
- **Flexible**: Claude can apply arbitrary logic
- **Zero cost**: No additional R2 operations

### Cons
- **Extremely slow**: Sequential API calls, high latency
- **High token usage**: Claude processes full file contents
- **Limited scope**: Can only check ~10-20 files before hitting practical limits
- **Inconsistent**: Depends on Claude's reasoning, may miss tasks

### Verdict
**Not recommended** - Too slow and unreliable for practical use.

---

## Recommended Approach

**Short term (Minimal Effort)**: Approach 1 - Pattern-Based Search Tool

Implement `find_tasks` as a new MCP tool with:
- Simple regex pattern matching
- Filters: `status` (incomplete/complete/all), `path_prefix`, `limit`
- Returns tasks with file path, line number, context, and GitHub source link
- No caching (scan R2 on each call)

**Medium term (Better Performance)**: Approach 2 - Cached Task Index

Move to cached index approach:
- Add task extraction to existing `generate-summary.yml` GitHub Action
- Store `_task_index.json` in R2
- `find_tasks` tool reads from index (instant response)
- Weekly auto-refresh + manual trigger option

**Long term (Best UX)**: Approach 1 + Approach 3

Offer both tools:
- `find_tasks`: Exhaustive, pattern-based (for "show me all tasks")
- `search_tasks`: Semantic + pattern hybrid (for "tasks about X")

---

## Implementation Plan

### Phase 1: Basic Pattern Search (1-2 hours)

1. Add `find_tasks` tool to `src/index.ts`
2. Implement R2 iteration with pattern matching
3. Format output with context and source links
4. Test with `node test-mcp.mjs`

### Phase 2: Optimization (1-2 hours)

1. Add path prefix filtering
2. Implement result limiting/pagination
3. Add surrounding context extraction (nearest heading)
4. Performance testing with realistic repo size

### Phase 3: Task Index (2-3 hours)

1. Create `build-task-index.js` script for GitHub Action
2. Update `generate-summary.yml` to extract tasks
3. Modify `find_tasks` to read from `_task_index.json`
4. Add cache refresh logic

---

## Example Usage

### Pattern-Based Search
```
User: Show me all incomplete tasks
Claude: [calls find_tasks with status="incomplete"]

Result: Found 23 incomplete tasks across 8 files
- domains/family/owen/swim/README.md (3 tasks)
- projects/cnc/backlog.md (7 tasks)
- tasks.md (13 tasks)
...
```

### Semantic Search
```
User: What tasks do I have related to Owen's swim team?
Claude: [calls search_tasks with query="Owen swim team"]

Result: Found 3 relevant incomplete tasks
1. Register Owen for spring swim session (domains/family/owen/swim/README.md:23)
2. Order new goggles for Owen (domains/family/owen/swim/README.md:24)
3. Sign up for volunteer slots at next swim meet (domains/family/owen/swim/volunteer.md:12)
```

### Scoped Search
```
User: Show me incomplete tasks in the projects folder
Claude: [calls find_tasks with status="incomplete", path_prefix="projects/"]

Result: Found 12 incomplete tasks in projects/
- projects/cnc/backlog.md (7 tasks)
- projects/home-automation/backlog.md (3 tasks)
- projects/garden/plans.md (2 tasks)
```

---

## Questions to Consider

1. **How often do tasks change?** If frequently, caching may cause frustration. If rarely, caching is a clear win.

2. **How many files typically contain tasks?** If many (>100), caching becomes more important for performance.

3. **Do you want task metadata?** Priority markers (`- [ ] (P1) Task`), due dates, assignees, tags? This would require more sophisticated parsing.

4. **Should tasks be editable via MCP?** If yes, need write-back tools (future enhancement).

5. **Do you want task grouping?** By file, by project, by date range, by priority?

6. **Should completed tasks be archived?** Or always queryable?

---

## Conclusion

**Recommended immediate action**: Implement Approach 1 (Pattern-Based Search Tool) as a new `find_tasks` MCP tool. This gives you:

- Complete task coverage (no missed tasks)
- Fast implementation (few hours)
- Clean separation from semantic search
- Foundation for future enhancements (caching, metadata, etc.)

Once you've validated the tool is useful, consider adding Approach 2 (Cached Task Index) via your existing GitHub Action infrastructure for better performance.

The hybrid approach (Approach 3) can be added later as a separate `search_tasks` tool if you find yourself frequently wanting semantic task search.
