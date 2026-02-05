# ADR-007: Inbox Processing via MCP

**Status:** Draft
**Date:** 2026-02-05
**Related:** ADR-004 (MCP Apps UI), ADR-006 (Brain Explorer)

## Context

Currently, inbox processing (organizing, categorizing, filing notes from `inbox/` to their proper locations) requires a full Claude Code session that clones the user's home-brain repo and follows the rules, skills, and procedures defined there. This approach works well but has significant drawbacks:

1. **Latency** — Claude Code must clone the repo, load context, and spin up tooling before processing begins
2. **Token inefficiency** — As repos grow, stuffing the entire repo into a Claude Opus call becomes expensive and hits context limits
3. **Heavy client requirement** — Users need Claude Code access; mobile/web Claude sessions can't trigger processing
4. **Repo coupling** — Processing logic lives in the brain repo itself, requiring repo access to understand the rules

The goal is to enable inbox processing via a lightweight MCP tool call that:
- Works from any Claude client (mobile, web, desktop)
- Is token-efficient (doesn't require loading the entire repo)
- Respects user-defined processing rules stored in the brain repo
- Provides sensible defaults when no custom rules exist

### What "Inbox Processing" Means

Based on observed usage patterns, inbox processing typically involves:

1. **Triage** — Review items in `inbox/`, decide disposition (keep, discard, merge, defer)
2. **Categorization** — Determine which domain/folder an item belongs to (e.g., `projects/`, `family/`, `resources/`)
3. **Transformation** — Reformat content (add frontmatter, standardize headers, extract tags)
4. **Filing** — Move items from `inbox/` to their destination folders
5. **Cross-referencing** — Update indices, link to related content, update summaries

### The Core Challenge: Entity Resolution Without Full Context

The hardest part of inbox processing isn't moving files — it's knowing *where things belong*. When a note mentions "Owen's swim meet schedule", smart processing should recognize:
- Owen is a person (a kid, specifically)
- There's existing content about Owen at `family/kids/owen/`
- Swim-related content lives at `family/activities/swim/`
- The note should probably go to `family/kids/owen/swim/` or similar

This requires **entity resolution** — matching mentions in new content to existing structures in the brain.

**Naive approaches fail:**

1. **Load entire brain** — For a 500-file brain, this could exceed 100k tokens just for context. Expensive, slow, doesn't scale.

2. **Maintain an entity index** — Keep a mapping like `Owen → family/kids/owen/`. Brittle: requires updates whenever structure changes, entities are added, or content moves. Gets stale.

3. **Folder listing + heuristics** — List folders, guess based on names. Misses semantic relationships (doesn't know Owen is a kid or that swim content exists).

### The Key Insight: AI Search IS the Entity Index

The brain's own content, indexed by AI Search, serves as a self-maintaining entity/location index:

```
Search: "Owen"
Results:
  - family/kids/owen/report-card-2025.md (score: 0.92)
  - family/kids/owen/school-schedule.md (score: 0.89)
  - inbox/birthday-party-notes.md (score: 0.71)

Search: "swim meet"
Results:
  - family/activities/swim/2025-schedule.md (score: 0.94)
  - family/kids/owen/swim-team-signup.md (score: 0.87)
```

From these results, Claude can infer:
- Owen's content lives under `family/kids/owen/`
- Swim content clusters at `family/activities/swim/` and intersects with Owen
- A note about "Owen's swim meet" likely belongs in `family/kids/owen/` (entity-primary) or `family/activities/swim/` (topic-primary), depending on user preference

**Why this works:**
- **Self-maintaining** — No separate index to update. Content changes → search results change automatically.
- **Scales** — Search is O(1), not O(files). Works the same for 50 files or 5,000.
- **Discovers structure implicitly** — File paths in search results reveal the brain's organization.
- **Semantic, not syntactic** — Finds "Owen" even when the note says "my son" if existing content establishes that relationship.
- **Handles ambiguity** — Multiple results let Claude (or the user) choose between valid options.

This is the foundational insight: **use AI Search not just for content retrieval, but for entity resolution and structure discovery.**

### User Customization

Processing rules are deeply personal. One user might want:
- All meeting notes filed to `work/meetings/` with a specific frontmatter template
- Recipes auto-tagged and filed to `home/recipes/`
- Anything mentioning kids filed to `family/`

Another user might want a flat structure with everything in `notes/` tagged by topic.

The system must support user-defined rules while providing useful defaults.

## Alternatives Considered

### 1. Server-Side AI Processing (Embedded Claude)

The MCP server has its own Claude API access. A `process_inbox` tool triggers server-side processing where the server:
1. Fetches inbox items and rules from R2
2. Makes Claude API calls to analyze and decide actions
3. Executes file moves/transformations
4. Returns a summary of actions taken

**Complexity:** Medium — requires API key management, rate limiting, error handling
**Token efficiency:** Excellent — server controls context, can use smaller models for categorization, batch efficiently
**User experience:** Opaque — user doesn't see the reasoning, can't intervene mid-process
**Cost model:** Complex — who pays for the Claude API calls? Platform cost or pass-through?
**Customization:** Full — rules fetched from user's brain, applied server-side

**Rejected.** The opacity is problematic. Users want to see and validate processing decisions, especially for important notes. Server-side processing also creates billing complexity and reduces user trust.

### 2. Client-Orchestrated with Granular Tools

Expose a suite of fine-grained MCP tools that the client Claude orchestrates:
- `inbox_list` — List inbox items with summaries (not full content)
- `inbox_get_rules` — Fetch processing rules from brain
- `inbox_get_item` — Fetch full content of specific item
- `inbox_classify` — Server suggests classification for an item
- `inbox_move` — Move item to destination folder
- `inbox_transform` — Apply template/transformation to item
- `inbox_delete` — Remove item from inbox

The client Claude calls these tools in sequence, makes decisions visible to the user, and executes actions.

**Complexity:** Low per-tool, but many tools to implement
**Token efficiency:** Good — summaries first, full content only when needed; rules loaded once per session
**User experience:** Excellent — user sees each decision, can intervene, full transparency
**Cost model:** Clear — uses client's existing Claude session
**Customization:** Full — rules loaded via tool, applied by client

**Viable, but chatty.** A 20-item inbox requires many tool calls. The user sees everything, which is good, but the back-and-forth adds latency.

### 3. Batched Analysis + Approval Flow

Combine analysis and execution into a two-phase approach:

**Phase 1: Analysis** — `inbox_analyze` tool returns:
```json
{
  "items": [
    { "path": "inbox/meeting-notes.md", "summary": "Q1 planning meeting",
      "suggested_action": "move", "destination": "work/meetings/2026-q1-planning.md",
      "confidence": 0.92, "reasoning": "Contains 'Q1 planning' in title, mentions work projects" },
    { "path": "inbox/recipe-pasta.md", "summary": "Pasta carbonara recipe",
      "suggested_action": "move", "destination": "home/recipes/pasta-carbonara.md",
      "confidence": 0.88, "reasoning": "Recipe format detected, matches 'recipes' rule" }
  ],
  "rules_applied": ["work-meetings", "recipes-auto-file"],
  "items_skipped": ["inbox/random-thought.md — no matching rule, confidence < 0.5"]
}
```

The client Claude presents this to the user, who can approve all, approve selectively, or modify.

**Phase 2: Execution** — `inbox_execute` tool takes approved actions:
```json
{
  "actions": [
    { "path": "inbox/meeting-notes.md", "action": "move", "destination": "work/meetings/2026-q1-planning.md" },
    { "path": "inbox/recipe-pasta.md", "action": "move", "destination": "home/recipes/pasta-carbonara.md" }
  ]
}
```

**Complexity:** Medium — two tools with structured I/O, server-side analysis logic
**Token efficiency:** Excellent — one round-trip for analysis, one for execution
**User experience:** Good — user reviews batch before execution, can modify
**Cost model:** Clear — client session
**Customization:** Full — rules influence server-side analysis

**Preferred approach.** Balances efficiency with transparency. The analysis phase can use AI Search and lightweight summarization; the execution phase is deterministic.

### 4. Event-Driven Automatic Processing

Process items automatically when `brain_inbox_save` is called. Rules are applied immediately, items are filed without user intervention.

**Complexity:** Medium — hooks into save flow, rule evaluation on write
**Token efficiency:** Excellent — no separate processing step
**User experience:** Mixed — zero effort but also zero control; user may not know where items went
**Customization:** Full — rules applied automatically

**Rejected for primary flow.** Users want to review inbox items, not have them auto-filed. However, this could be a user-configurable option for trusted categories (e.g., "auto-file all receipts to `finances/receipts/`").

### 5. Hybrid: Processing Hints at Save Time

Extend `brain_inbox_save` to accept optional `processing_hints`:
```json
{
  "title": "Q1 Planning Meeting",
  "content": "...",
  "processing_hints": {
    "category": "work/meetings",
    "tags": ["q1", "planning"],
    "skip_inbox": true
  }
}
```

When hints are provided, the item is filed directly to the destination. When omitted, it goes to `inbox/` for later processing.

This enables Claude to file items correctly at creation time when context is fresh, reducing later processing burden.

**Complexity:** Low — extends existing tool
**Token efficiency:** Excellent — no separate processing step for hinted items
**User experience:** Good — Claude makes filing decisions with user's input fresh
**Customization:** Implicit — filing decisions made at creation time based on conversation context

**Accepted as enhancement.** Reduces inbox processing burden by enabling smart filing at save time.

## Decision

### Phase 1: Batched Analysis + Approval (Alternative 3)

Implement two new MCP tools:

**`inbox_analyze`**
- Fetches inbox item summaries (title, first 100 chars, file metadata)
- Loads processing rules from `_brain_config/inbox_rules.md` (or uses defaults)
- Uses AI Search to find related content for classification hints
- Returns structured analysis with suggested actions, confidence scores, and reasoning
- Does NOT modify any files

**`inbox_execute`**
- Takes a list of approved actions from the analysis
- Executes file operations (move, transform, delete)
- Syncs changes to GitHub
- Returns execution status

### Phase 2: Processing Hints (Alternative 5)

Extend `brain_inbox_save` to accept optional `processing_hints` for direct filing.

### Rules Storage Format

Processing rules live in the user's brain at `_brain_config/inbox_rules.md`:

```markdown
# Inbox Processing Rules

## Auto-File Rules

### Work Meetings
- **Pattern:** Title contains "meeting" or content has "## Attendees"
- **Destination:** `work/meetings/{date}-{title-slug}.md`
- **Transform:** Add frontmatter with date and attendees extracted from content

### Recipes
- **Pattern:** Content matches recipe structure (ingredients + instructions)
- **Destination:** `home/recipes/{title-slug}.md`
- **Transform:** Ensure "## Ingredients" and "## Instructions" headers

## Default Behavior
- Items with no matching rule: Keep in inbox, flag for manual review
- Confidence threshold: 0.7 (below this, suggest but don't auto-approve)

## Folder Structure
- `work/` — Professional projects and meetings
- `home/` — Personal, family, household
- `resources/` — Reference material, bookmarks, snippets
```

The rules are human-readable markdown that Claude can interpret. This allows users to write rules in natural language without learning a DSL.

If `_brain_config/inbox_rules.md` doesn't exist, the system uses sensible defaults:
- Suggest filing based on keyword matching and AI Search similarity to existing content
- Present all suggestions for user approval (no auto-execute)
- Lower confidence threshold (0.5) when no rules defined

### Entity Resolution via AI Search

The `inbox_analyze` tool uses AI Search strategically for entity resolution:

1. **Extract entities from inbox item** — Parse title and content for named entities (people, projects, topics, locations)
2. **Multi-query search** — For each entity, search the brain to find where related content lives
3. **Path analysis** — Extract folder paths from search results to understand brain structure
4. **Confidence scoring** — Higher confidence when multiple searches point to the same location

**Example flow for "Owen's swim meet schedule":**

```
Entities extracted: ["Owen", "swim meet", "schedule"]

Search "Owen" → family/kids/owen/report-card.md, family/kids/owen/school.md
Search "swim meet" → family/activities/swim/2025-schedule.md
Search "schedule" → (too generic, skip)

Path analysis:
  - Owen content: family/kids/owen/ (2 hits)
  - Swim content: family/activities/swim/ (1 hit)
  - Intersection: family/kids/owen/ contains swim-related file

Suggested destination: family/kids/owen/swim-schedule-spring-2026.md
Confidence: 0.85
Reasoning: "Owen" entity strongly associated with family/kids/owen/;
           swim content exists there; follows existing naming pattern
```

This approach requires only 2-3 AI Search calls per inbox item (one per significant entity), returning ~3 results each. Total context for classification: ~500 tokens per item instead of loading the entire brain.

### Token Efficiency Summary

| Approach | Tokens per 20-item inbox |
|----------|-------------------------|
| Load entire brain (500 files) | ~100,000+ |
| Entity index + full item content | ~15,000 |
| **AI Search entity resolution** | ~2,000-3,000 |

The key savings:
1. **Search results, not full files** — AI Search returns paths + snippets, not full documents
2. **Entity-targeted queries** — 2-3 searches per item, not exhaustive traversal
3. **Structured output** — Classification decision returned as JSON, not prose
4. **Rules loaded once** — Processing rules fetched once, applied to all items

### MCP Apps UI (Future)

Following the pattern from ADR-004 and ADR-006, `inbox_analyze` could include an interactive UI:
- Display analysis results in a reviewable list
- Checkboxes to approve/reject individual actions
- Inline editing of destinations
- "Execute approved" button calls `inbox_execute` via `callServerTool`

This is deferred until the core tools are proven.

## Consequences

### Positive
- Inbox processing works from any Claude client (mobile, web, desktop, Code)
- Token-efficient design scales with brain size
- User-defined rules enable personalization without code changes
- Two-phase flow preserves user oversight and trust
- Compatible with existing `brain_inbox_save` flow

### Negative
- Two new tools to implement and maintain
- Rule interpretation relies on Claude's understanding of natural language rules (may have edge cases)
- Batched flow less suitable for single-item quick-file (use processing hints instead)

### Open Questions

1. **Rule interpretation: server vs client** — Should the server interpret natural language rules (requires embedded LLM), or should it return rules + entity data for the client Claude to interpret? Client interpretation is simpler but adds tokens; server interpretation requires Claude API access.

2. **Entity extraction quality** — Simple regex extraction works for obvious entities ("Owen", "Project X") but misses implicit references ("my son", "the main project"). Workers AI entity extraction (`@cf/...`) could improve this but adds latency/cost.

3. **Rule format** — Should rules be pure markdown (flexible but ambiguous) or structured YAML/JSON (precise but less readable)? Markdown feels more natural for users but may cause interpretation inconsistencies.

4. **Confidence calibration** — How do we tune confidence scores without labeled training data? Could track user overrides over time.

5. **Conflict resolution** — What happens when multiple rules match? Priority order? User prompt? Current design surfaces all options; user/Claude decides.

6. **Cross-entity relationships** — AI Search finds entities independently. How do we handle relationships ("Owen's swim meet" = Owen + swim, should go where Owen + swim intersect)? Current voting heuristic is simple but may miss nuance.

## Implementation Sketch

```typescript
// Entity extraction (simple heuristic - could use Workers AI for better extraction)
function extractEntities(text: string): string[] {
  // Extract capitalized phrases, quoted terms, hashtags
  const capitalized = text.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g) || [];
  const hashtags = text.match(/#\w+/g)?.map(t => t.slice(1)) || [];
  // Filter out common words, dedupe
  return [...new Set([...capitalized, ...hashtags])]
    .filter(e => !['The', 'This', 'That', 'Monday', 'Tuesday'].includes(e))
    .slice(0, 5); // Limit to top 5 entities
}

// Search for entity and extract path patterns
async function resolveEntity(env: Env, prefix: string, entity: string): Promise<string[]> {
  const results = await env.AI.autorag({ name: AUTORAG_NAME }).search(entity, {
    filters: { folder: { $startsWith: prefix } },
    rewrite_query: false,
    max_num_results: 3
  });

  // Extract parent folders from result paths
  return results.map(r => {
    const path = r.filename.replace(prefix, '');
    const parts = path.split('/');
    parts.pop(); // Remove filename
    return parts.join('/');
  }).filter(Boolean);
}

// inbox_analyze tool
server.tool("inbox_analyze", "Analyze inbox items and suggest processing actions", {}, async () => {
  const r2Prefix = `brains/${installationUuid}/`;

  // 1. List inbox items
  const inboxItems = await env.R2.list({ prefix: `${r2Prefix}inbox/` });

  // 2. Load rules (or use defaults)
  const rulesObj = await env.R2.get(`${r2Prefix}_brain_config/inbox_rules.md`);
  const rules = rulesObj ? await rulesObj.text() : DEFAULT_INBOX_RULES;

  // 3. For each item: extract entities, resolve via search, suggest destination
  const analysis = await Promise.all(inboxItems.objects.map(async (obj) => {
    const content = await (await env.R2.get(obj.key))!.text();
    const title = extractTitle(content);
    const entities = extractEntities(content);

    // Resolve each entity to folder paths via AI Search
    const entityPaths: Record<string, string[]> = {};
    for (const entity of entities) {
      entityPaths[entity] = await resolveEntity(env, r2Prefix, entity);
    }

    // Find most common path across entities (simple voting)
    const pathCounts: Record<string, number> = {};
    Object.values(entityPaths).flat().forEach(p => {
      pathCounts[p] = (pathCounts[p] || 0) + 1;
    });
    const topPath = Object.entries(pathCounts)
      .sort((a, b) => b[1] - a[1])[0];

    const suggestedDest = topPath
      ? `${topPath[0]}/${sanitizeFilename(title)}.md`
      : null;
    const confidence = topPath ? Math.min(0.5 + topPath[1] * 0.15, 0.95) : 0.3;

    return {
      path: obj.key.replace(r2Prefix, ''),
      title,
      entities,
      entity_locations: entityPaths,
      suggested_action: suggestedDest ? 'move' : 'keep',
      destination: suggestedDest,
      confidence,
      reasoning: suggestedDest
        ? `Entities ${Object.keys(entityPaths).join(', ')} found in ${topPath[0]}/`
        : 'No strong entity matches found'
    };
  }));

  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        items: analysis,
        rules_loaded: !!rulesObj,
        entity_resolution: "AI Search multi-query"
      }, null, 2)
    }]
  };
});
```

This implementation:
1. Extracts entities from each inbox item (names, projects, topics)
2. Searches the brain for each entity to find where related content lives
3. Uses path voting to determine the most likely destination
4. Returns confidence based on how many entities point to the same location

## Related

- ADR-004: MCP Apps UI — Pattern for interactive tool UIs
- ADR-006: Brain Explorer — File browsing and search UI
- GitHub Issue: (to be created)
