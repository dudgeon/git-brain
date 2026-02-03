# ADR-004: MCP Apps Interactive UI

**Status:** Accepted
**Date:** 2026-02-02

## Context

Git Brain's MCP tools return plain text/markdown responses. The `brain_inbox` tool creates notes but provides no visual feedback beyond a confirmation string. Users have no way to preview notes as they're being composed, see save status per destination (R2 vs GitHub), or interact with results without additional chat turns.

The MCP Apps extension (`@modelcontextprotocol/ext-apps`) enables MCP servers to serve interactive HTML UIs that render inline in supporting hosts (Claude Desktop). This creates an opportunity to add rich visual feedback to existing tools.

## Decision

Add MCP Apps UI support to Git Brain, starting with the `brain_inbox` tool as a **Brain Inbox Composer** app.

### What the Composer Does

1. **Streaming preview** — Uses `ontoolinputpartial` to render note content progressively as Claude generates it (title + markdown body)
2. **Save confirmation** — On `ontoolresult`, displays file path, per-destination status (R2 ✓/✗, GitHub ✓/✗), and the final rendered note
3. **Continued interaction** — A "Save another note" button uses `sendMessage` to prompt Claude for a follow-up note without the user typing

### Architecture

```
brain_inbox tool call
  ├─ _meta.ui.resourceUri → "ui://brain-inbox/composer.html"
  ├─ registerAppTool (server-side, replaces server.tool)
  └─ registerAppResource (serves bundled HTML)

UI build pipeline:
  ui/brain-inbox/src/app.ts  →  vite + vite-plugin-singlefile  →  ui/dist/index.html
  ui/dist/index.html  →  wrangler text import  →  embedded in Worker bundle
```

The UI is a vanilla JS app (~388KB bundled, ~95KB gzip) that imports `@modelcontextprotocol/ext-apps` for the `App` class and host styling integration. It includes a minimal inline markdown renderer (no external dependency).

### Graceful Degradation

- **Non-UI hosts** (Claude.ai web, Claude Code, mobile): The tool still returns `content: [{ type: "text", text: "..." }]` as before. The `_meta.ui` field is ignored by hosts that don't support MCP Apps.
- **No breaking changes**: All existing text-only behavior is preserved.

## Alternatives Considered

1. **No UI** — Status quo. Simple but provides no visual feedback during note creation.
2. **Full Brain Explorer app first** — More ambitious (search + browse + document viewer with `callServerTool`). Deferred as a follow-up since it requires more design work and the composer is a self-contained proof of the pattern.
3. **React-based app** — The ext-apps SDK provides a `useApp` hook for React. Chose vanilla JS to avoid React's bundle size for a small UI and reduce build complexity.

## Consequences

- **Build pipeline**: `npm run deploy` now runs `npm run build:ui` first (vite build). The built HTML is checked into `ui/dist/` via the build step, not committed to git.
- **Bundle size**: Worker bundle increased by ~388KB (the inlined HTML). This is within Cloudflare's 10MB limit.
- **Dependencies added**: `@modelcontextprotocol/ext-apps` (runtime), `vite` + `vite-plugin-singlefile` (devDependencies).
- **Host support**: MCP Apps is an extension spec — currently supported in Claude Desktop. Claude.ai web support is TBD.

## Future Work

- **Brain Explorer app**: Interactive search results + folder browsing + document viewer using `callServerTool` and `updateModelContext`
- **Capability detection**: Use `getUiCapability` to conditionally register app tools only when the client supports MCP Apps
