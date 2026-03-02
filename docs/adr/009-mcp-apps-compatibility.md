# ADR-009: Claude.ai MCP Proxy Compatibility

## Context

All MCP tool calls through Claude.ai's proxy returned JSON-RPC error `-32600` ("Anthropic Proxy: Invalid content from server"). Direct MCP clients (Claude Code, Claude Desktop, Node.js SDK) worked fine.

### Root Cause Analysis

The server used `HomeBrainMCP.serveSSE("/mcp")` (legacy SSE transport) while Claude.ai's proxy communicates via **Streamable HTTP** transport. These are fundamentally different:

| | Legacy SSE | Streamable HTTP |
|---|---|---|
| Initialize | `GET /mcp` → SSE event stream | `POST /mcp` with JSON body |
| Messages | `POST /mcp/message?sessionId=...` | `POST /mcp` with `mcp-session-id` header |
| Session ID | Query parameter | HTTP header |

When Claude.ai's proxy sent POST requests to `/mcp`, the SSE handler didn't understand them, producing malformed responses that the proxy rejected.

### Investigation Path

Three hypotheses were tested before identifying the transport issue:

1. **`_meta` on tool definitions** — `registerAppTool` adds `_meta` with UI metadata. Replaced with standard `server.registerTool()`. Did NOT fix the error because ALL tools failed, not just inbox tools.

2. **`execution` field** — MCP SDK 1.25.2 hardcodes `execution: { taskSupport: "forbidden" }` into every tool definition. Stripped from all tools. Did NOT fix the error.

3. **`registerAppResource`** — Temporarily removed the `ui://` resource registration. Did NOT fix the error.

4. **Transport protocol mismatch** — Testing `POST /mcp/{uuid}` directly confirmed the server returned 404 for Streamable HTTP requests. This was the root cause.

---

## Decision

### 1. Switch to Streamable HTTP transport

Replace `HomeBrainMCP.serveSSE("/mcp")` with `HomeBrainMCP.serve("/mcp")` (defaults to Streamable HTTP).

### 2. Conditional MCP Apps tool enhancement

Register all tools with standard `server.registerTool()` (no `_meta`). After the MCP handshake, upgrade inbox tools with MCP Apps metadata only for capable clients via `RegisteredTool.update()`.

This ensures:
- Standard clients (Claude.ai, Claude Code) get clean tool definitions
- MCP Apps clients (Claude Desktop) get enhanced UI after capability detection

### How It Works

1. **Register standard tools in `init()`** — Use `server.registerTool()` for `brain_inbox` and `brain_inbox_save`. No `_meta`, no `structuredContent`. Store the returned `RegisteredTool` handles.

2. **Detect client capabilities after handshake** — Set `server.server.oninitialized` callback to check for MCP Apps support via `getUiCapability()`.

3. **Upgrade for capable clients** — Call `RegisteredTool.update()` to add `_meta` with UI resource URI and replace callbacks with versions that return `structuredContent`. Then notify client via `sendToolListChanged()`.

4. **Always register App resources** — `registerAppResource` for the HTML resource is harmless if never requested.

### Route Handling

Updated the Worker's fetch handler for Streamable HTTP:

```
/mcp/{uuid}          → Auth check → rewrite to /mcp with query params → mcpHandler
/mcp POST/DELETE     → mcpHandler (Streamable HTTP)
/mcp GET + session   → mcpHandler (Streamable HTTP SSE stream)
/mcp GET (no session)→ 404 with setup instructions
/mcp/message POST    → mcpHandler (legacy SSE backward compat)
```

---

## Alternatives Considered

### A: Keep SSE transport, fix proxy compatibility

**Status:** Rejected

Claude.ai's proxy uses Streamable HTTP. The MCP spec recommends Streamable HTTP as the modern transport. No benefit to staying on legacy SSE.

### B: Strip `_meta` / `execution` without changing transport

**Status:** Rejected (attempted, didn't work)

These fields were not the root cause. The transport mismatch caused the error regardless of tool definition contents.

### C: Separate tool names for Apps vs standard clients

**Status:** Rejected

Creates naming confusion and doubles the tool surface area.

---

## Consequences

**Positive:**
- All MCP tools work through Claude.ai's proxy
- Claude Desktop retains full MCP Apps UI (upgraded after capability detection)
- Modern Streamable HTTP transport (header-based sessions, single endpoint)
- Legacy SSE `/mcp/message` path still works for backward compatibility

**Negative:**
- Slightly more complex tool registration logic (two-phase: register then upgrade)
- `oninitialized` timing dependency — tools must be registered before the callback fires

---

## Verification

1. `npm test` — 74 unit tests pass
2. `npm run typecheck` — no TS errors
3. `npm run deploy` — deploy to Cloudflare
4. `node test-user-mcp.mjs` — Streamable HTTP transport, all 8 tools listed, `about` tool call succeeds
5. `curl -X POST /mcp/{uuid}` — Streamable HTTP initialize/tools/list/tools/call all return valid responses
6. Test via Claude.ai MCP connector — confirm no `-32600` error
7. Test via Claude Desktop — confirm composer UI renders (MCP Apps upgrade)
