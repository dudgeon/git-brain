# ADR-006: Brain Explorer MCP App

**Status:** Accepted
**Date:** 2026-02-02

## Context

The `search_brain` tool returns plain text results — filenames, scores, and snippets. To read a result, the user must ask Claude to call `get_document` in a separate turn. Browsing the knowledge base folder structure requires iterative `list_folders` calls. Each interaction costs a chat turn, making exploration slow and friction-heavy.

ADR-004 established the MCP Apps pattern with the Brain Inbox Composer. The same infrastructure (`registerAppTool`, `registerAppResource`, `vite-plugin-singlefile`) can be reused for a more ambitious interactive UI.

## Decision

Augment `search_brain` with an interactive **Brain Explorer** app that renders search results as clickable cards and supports folder browsing, document viewing, fullscreen reading, and model context updates — all without additional chat turns.

### What the Explorer Does

1. **Streaming search preview** — `ontoolinputpartial` shows "Searching for: {query}..." as the query streams in
2. **Interactive result cards** — `ontoolresult` renders results with filename, score badge (color-coded), and snippet. Clicking a card opens the document viewer
3. **Document viewer** — Calls `get_document` via `callServerTool`, renders markdown content, shows file path and size
4. **Folder browser** — "Browse" button calls `list_folders` via `callServerTool`, shows directory tree with drill-down into subfolders and click-to-open for files
5. **Model context sync** — `updateModelContext` pushes the currently viewed document to Claude's context (debounced 500ms, truncated to 4KB), so Claude knows what the user is reading
6. **Fullscreen mode** — Toggle via `requestDisplayMode` for distraction-free reading
7. **Navigation stack** — Back button returns from viewer to results or folder view

### Architecture

```
search_brain tool call
  ├─ _meta.ui.resourceUri → "ui://brain-explorer/explorer.html"
  ├─ content: [{ type: "text", text: "..." }]  (backward compat)
  └─ structuredContent: { query, results: [...] }  (UI consumption)

User clicks result card:
  └─ callServerTool("get_document", { path })
       ├─ structuredContent: { path, content, size }
       └─ updateModelContext({ content: [{ type: "text", text: "User is viewing: ..." }] })

User clicks Browse:
  └─ callServerTool("list_folders", { path })
       └─ structuredContent: { path, folders: [...], files: [...] }
```

### Tools Modified

Four existing tools were converted from `this.server.tool()` to `registerAppTool()`:

| Tool | Change |
|------|--------|
| `search_brain` | Added `_meta.ui.resourceUri`, `structuredContent: { query, results }` |
| `get_document` | Added `_meta.ui.resourceUri`, `structuredContent: { path, content, size }` |
| `list_folders` | Added `_meta.ui.resourceUri`, `structuredContent: { path, folders, files }` |
| `list_recent` | Added `_meta.ui.resourceUri`, `structuredContent: { files }` |

**No breaking changes**: All tool names, parameters, descriptions, and text `content` responses remain identical. Non-UI hosts ignore `_meta.ui` and `structuredContent`. The `visibility` defaults to `["model", "app"]`, meaning Claude can still call these tools directly (same as before), and the explorer app can also call them via `callServerTool`.

### Build Pipeline

```
ui/brain-explorer/src/app.ts  →  vite + vite-plugin-singlefile  →  ui/dist/brain-explorer.html
ui/dist/brain-explorer.html   →  wrangler text import  →  embedded in Worker bundle
```

The explorer builds alongside the inbox composer in `npm run build:ui`. Both use `emptyOutDir: false` to coexist in `ui/dist/`.

## Alternatives Considered

1. **New dedicated tool** — Create a separate `explore_brain` tool instead of augmenting `search_brain`. Rejected: adds tool clutter, and the search results are the natural entry point for exploration.
2. **React-based app** — Consistent with ADR-004, chose vanilla JS to keep bundle size small and avoid React dependency for a relatively simple UI.
3. **Separate resource per tool** — Each tool could have its own UI resource. Rejected: the explorer is a single coherent experience that handles all four tools' outputs.

## Consequences

- **Worker bundle size** increases by ~395KB (the inlined explorer HTML). Combined with the inbox composer (~393KB), total UI overhead is ~788KB, well within Cloudflare's 10MB limit.
- **Four tools now use `registerAppTool`** instead of `this.server.tool()`. This changes the registration mechanism but not the tool behavior for non-UI hosts.
- **`structuredContent`** is added to four tool responses. This is additional data in the response payload but is ignored by hosts that don't support it.
- **Model context updates** mean Claude will see "User is viewing document: {path}" messages when the user browses documents in the explorer. This improves conversational relevance but adds context window usage.

## Related

- [ADR-004: MCP Apps UI](004-mcp-apps-ui.md) — Established the pattern with Brain Inbox Composer
- [MCP Apps Extension Spec](https://github.com/modelcontextprotocol/ext-apps)
