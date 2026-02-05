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

### The Hard Problem: Novel and Ambiguous Entities

The approach above works well for established entities with dedicated content. But it fails for:

**1. Novel entities** — A note about "Poker night with Dave" where Dave is a new friend with no existing content. Search returns nothing useful. The item gets stuck in inbox with no suggestion.

**2. Name collisions** — "Dave" matches father-in-law Dave who has content at `family/in-laws/dave/`. But this is friend Dave, a different person. Wrong match.

**3. Tangential mentions** — Dave appears in cousin Ben's notes ("Ben and Dave grabbed lunch") as a supporting character. Search finds Ben's folder. But new content *about* Dave shouldn't go in Ben's folder.

The core issue: **search results are hypotheses, not answers**. The system must evaluate result quality and distinguish between:
- **Primary content** — Files *about* an entity (dedicated folder, entity in title)
- **Tangential mentions** — Files that *mention* an entity incidentally
- **No match** — Entity doesn't exist in the brain yet

### Evaluating Match Quality

Several signals indicate whether a search result is a confident match:

**Strong match signals:**
- Entity appears in the **file path** (e.g., `family/kids/owen/` for "Owen")
- Multiple files cluster in the **same folder** (2+ hits in `friends/dave/`)
- High semantic similarity **score** (> 0.85)
- Result content is **primarily about** the entity, not just mentioning it

**Weak match signals:**
- Entity only appears **within content**, not in paths
- Results are **scattered** across unrelated folders
- Lower similarity scores (0.6-0.75)
- Entity is a **supporting character** in results about something else

**Novel entity signals:**
- No results above **threshold** (e.g., score < 0.6)
- All results are **tangential mentions**
- Disambiguating context in inbox item (e.g., "my friend Dave from poker") **doesn't match** any result context

### Disambiguation via Context

Bare entity names are ambiguous. But inbox items usually have disambiguating context:

```
Inbox item: "Notes from poker with Dave S."
Context entities: ["poker", "Dave S."]

Search "Dave S." → No results (novel entity)
Search "poker" → hobbies/poker/2025-games.md (score: 0.91)

Analysis:
- "Dave S." is novel (no strong matches)
- "poker" has established home at hobbies/poker/
- Suggested: hobbies/poker/dave-s-notes.md OR friends/dave-s/poker.md (ask user)
```

The system should extract **contextual entity mentions** ("Dave S.", "my friend Dave", "father-in-law Dave") rather than bare names. More specific queries yield better disambiguation.

### Detecting Primary vs Tangential Content

When search returns results, check whether the entity is primary or tangential:

```typescript
function isPrimaryContent(searchResult, entity: string): boolean {
  // Entity in path = primary content
  if (searchResult.filename.toLowerCase().includes(entity.toLowerCase())) {
    return true;
  }

  // Entity in title/H1 = primary content
  const content = searchResult.content;
  const titleMatch = content.match(/^#\s+(.+)/m);
  if (titleMatch && titleMatch[1].toLowerCase().includes(entity.toLowerCase())) {
    return true;
  }

  // Otherwise, likely tangential
  return false;
}
```

Filter results to primary content before path voting. If no primary content exists, the entity is likely novel.

### Handling Novel Entities

When confidence is low and no primary content exists, the system should:

1. **Acknowledge uncertainty** — Don't force a bad match
2. **Suggest domain-based filing** — Infer domain from content type (recipe → `home/recipes/`, meeting → `work/meetings/`)
3. **Propose new location** — "This appears to be a new person. Suggested: `friends/dave-s/` or `people/dave-s/`"
4. **Ask the user** — "Where should content about Dave S. live?"

```json
{
  "path": "inbox/poker-with-dave.md",
  "title": "Poker with Dave S.",
  "entities": ["Dave S.", "poker"],
  "entity_analysis": {
    "Dave S.": { "status": "novel", "matches": [], "confidence": 0.2 },
    "poker": { "status": "matched", "location": "hobbies/poker/", "confidence": 0.91 }
  },
  "suggested_action": "create_location",
  "options": [
    { "path": "friends/dave-s/poker-notes.md", "reasoning": "New person, topic is poker" },
    { "path": "hobbies/poker/dave-s.md", "reasoning": "File under established poker location" }
  ],
  "requires_input": true,
  "prompt": "Dave S. appears to be new. Where should content about them live?"
}
```

### Learning from User Decisions

When the user chooses a location for a novel entity, that decision should:
1. **Apply immediately** — File the current item
2. **Inform future matches** — Next time "Dave S." appears, search will find this content
3. **Optionally create a stub** — Create `friends/dave-s/README.md` with basic info so the location is established

This creates a **bootstrap loop**: novel entities get locations through user decision, then AI Search finds them for future items. The brain learns its own structure.

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

2. **Entity extraction quality** — Simple regex extraction works for obvious entities ("Owen", "Project X") but misses implicit references ("my son", "the main project"). Workers AI NER models could improve this but add latency/cost.

3. **Primary content detection** — The `isPrimaryContent` heuristic (entity in path, in H1, high score + early mention) may have false positives/negatives. How do we tune this without labeled data?

4. **Novel entity bootstrap** — When creating a location for a novel entity, should we create a stub file (e.g., `friends/dave-s/README.md`) so future searches find it? Or wait for the user to add more content?

5. **Name collision handling** — "Dave" (friend) vs "Dave" (father-in-law) both have content. How do we disambiguate? Options:
   - Require contextual extraction ("my friend Dave" vs "Dave (father-in-law)")
   - Use user-defined aliases in rules (`Dave S. = friends/dave-s/`)
   - Ask user to disambiguate when collision detected

6. **Tangential mention threshold** — Current design filters tangential mentions entirely. But tangential data has signal: if "Dave" is mentioned 5x across different domains, that suggests Dave is important even without dedicated content. Should we use mention frequency?

7. **Cross-entity relationships** — AI Search finds entities independently. How do we handle relationships ("Owen's swim meet" = Owen + swim, should go where Owen + swim intersect)? Current voting heuristic is simple but may miss nuance.

8. **Learning from corrections** — When user overrides a suggestion (moves file somewhere else), how do we learn? Options: update rules file, store correction log for future context, or rely on new content establishing the pattern.

## Implementation Sketch

```typescript
interface SearchResult {
  filename: string;
  content: string;
  score: number;
}

interface EntityMatch {
  status: 'matched' | 'tangential' | 'novel';
  location: string | null;
  confidence: number;
  primaryContent: boolean;
}

// Check if search result is PRIMARY content about the entity (not just a mention)
function isPrimaryContent(result: SearchResult, entity: string): boolean {
  const entityLower = entity.toLowerCase();
  const pathLower = result.filename.toLowerCase();

  // Entity appears in file path = dedicated content
  if (pathLower.includes(entityLower.replace(/\s+/g, '-'))) {
    return true;
  }

  // Entity in H1 title = primary content
  const titleMatch = result.content.match(/^#\s+(.+)/m);
  if (titleMatch?.[1].toLowerCase().includes(entityLower)) {
    return true;
  }

  // High score + entity in first 200 chars = likely primary
  if (result.score > 0.85 && result.content.slice(0, 200).toLowerCase().includes(entityLower)) {
    return true;
  }

  return false;
}

// Resolve entity: search, filter to primary content, determine match quality
async function resolveEntity(
  env: Env,
  prefix: string,
  entity: string
): Promise<EntityMatch> {
  const results = await env.AI.autorag({ name: AUTORAG_NAME }).search(entity, {
    filters: { folder: { $startsWith: prefix } },
    rewrite_query: false,
    max_num_results: 5
  });

  if (results.length === 0 || results[0].score < 0.5) {
    return { status: 'novel', location: null, confidence: 0.2, primaryContent: false };
  }

  // Filter to primary content only
  const primaryResults = results.filter(r => isPrimaryContent(r, entity));

  if (primaryResults.length === 0) {
    // Results exist but all are tangential mentions
    return {
      status: 'tangential',
      location: extractFolder(results[0].filename, prefix),
      confidence: 0.35,
      primaryContent: false
    };
  }

  // Extract folder from best primary result
  const bestMatch = primaryResults[0];
  const folder = extractFolder(bestMatch.filename, prefix);

  // Confidence based on: score, number of primary hits, path clustering
  const folderCounts = primaryResults.reduce((acc, r) => {
    const f = extractFolder(r.filename, prefix);
    acc[f] = (acc[f] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const clusterBonus = (folderCounts[folder] || 1) > 1 ? 0.1 : 0;
  const confidence = Math.min(bestMatch.score + clusterBonus, 0.95);

  return {
    status: 'matched',
    location: folder,
    confidence,
    primaryContent: true
  };
}

function extractFolder(filename: string, prefix: string): string {
  const path = filename.replace(prefix, '');
  const parts = path.split('/');
  parts.pop(); // Remove filename
  return parts.join('/') || '/';
}

// Analyze a single inbox item
async function analyzeItem(env: Env, r2Prefix: string, obj: R2Object) {
  const content = await (await env.R2.get(obj.key))!.text();
  const title = extractTitle(content);
  const entities = extractEntities(content);

  // Resolve each entity
  const entityAnalysis: Record<string, EntityMatch> = {};
  for (const entity of entities) {
    entityAnalysis[entity] = await resolveEntity(env, r2Prefix, entity);
  }

  // Determine suggested action based on entity analysis
  const matchedEntities = Object.entries(entityAnalysis)
    .filter(([_, m]) => m.status === 'matched');
  const novelEntities = Object.entries(entityAnalysis)
    .filter(([_, m]) => m.status === 'novel');

  if (matchedEntities.length > 0) {
    // Vote among matched entities for best location
    const locationVotes: Record<string, number> = {};
    matchedEntities.forEach(([_, m]) => {
      if (m.location) {
        locationVotes[m.location] = (locationVotes[m.location] || 0) + m.confidence;
      }
    });

    const [bestLocation, score] = Object.entries(locationVotes)
      .sort((a, b) => b[1] - a[1])[0];

    return {
      path: obj.key.replace(r2Prefix, ''),
      title,
      entities: entityAnalysis,
      suggested_action: 'move',
      destination: `${bestLocation}/${sanitizeFilename(title)}.md`,
      confidence: Math.min(score / matchedEntities.length, 0.95),
      reasoning: `Strong match: ${matchedEntities.map(([e]) => e).join(', ')} → ${bestLocation}/`
    };
  }

  if (novelEntities.length > 0) {
    // All entities are novel - suggest creating new location
    const primaryEntity = novelEntities[0][0];
    return {
      path: obj.key.replace(r2Prefix, ''),
      title,
      entities: entityAnalysis,
      suggested_action: 'create_location',
      options: inferNewLocations(primaryEntity, content),
      confidence: 0.3,
      requires_input: true,
      reasoning: `Novel entity "${primaryEntity}" - no existing content found. User input needed.`
    };
  }

  // Only tangential matches - low confidence, keep in inbox
  return {
    path: obj.key.replace(r2Prefix, ''),
    title,
    entities: entityAnalysis,
    suggested_action: 'keep',
    destination: null,
    confidence: 0.25,
    reasoning: 'Only tangential mentions found - keeping in inbox for manual review'
  };
}

// Infer possible locations for a novel entity based on content type
function inferNewLocations(entity: string, content: string): Array<{path: string, reasoning: string}> {
  const slug = sanitizeFilename(entity);
  const options = [];

  // Check content type heuristics
  if (content.match(/## (Ingredients|Instructions)/i)) {
    options.push({ path: `recipes/${slug}.md`, reasoning: 'Recipe format detected' });
  }
  if (content.match(/## (Attendees|Agenda|Action Items)/i)) {
    options.push({ path: `work/meetings/${slug}.md`, reasoning: 'Meeting notes format' });
  }
  if (content.match(/(birthday|party|wedding|anniversary)/i)) {
    options.push({ path: `family/events/${slug}.md`, reasoning: 'Family event detected' });
  }

  // Default: create entity folder
  options.push({ path: `people/${slug}/index.md`, reasoning: 'New person - create dedicated folder' });
  options.push({ path: `notes/${slug}.md`, reasoning: 'General notes location' });

  return options.slice(0, 3);
}
```

This implementation:
1. **Distinguishes primary vs tangential content** — Only considers files *about* an entity, not files that merely mention it
2. **Handles novel entities explicitly** — Returns `create_location` action with suggested paths when no primary content exists
3. **Confidence reflects match quality** — High confidence only when primary content clusters in one location
4. **Surfaces uncertainty** — Returns `requires_input: true` when user decision is needed

## Related

- ADR-004: MCP Apps UI — Pattern for interactive tool UIs
- ADR-006: Brain Explorer — File browsing and search UI
- GitHub Issue: (to be created)
