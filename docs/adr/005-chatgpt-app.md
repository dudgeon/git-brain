# ADR-005: Expose Brainstem Tools as a ChatGPT App

**Status:** Deferred (tool core extraction not needed for initial submission — revisit if per-platform description overrides are needed)
**Date:** 2026-02-03 (updated 2026-02-16)
**Decision:** Publish Brainstem as a ChatGPT App using the Apps SDK (MCP-based), while keeping the existing MCP server as the single source of truth. Refactor tool definitions and execution into a shared core so that new tools and changes ship once and are available to both Claude MCP clients and ChatGPT Apps.

## Context

Brainstem currently exposes MCP tools for Claude and other MCP clients. ChatGPT supports full MCP capabilities in developer mode for testing, but we need a production ChatGPT App that can be distributed through the ChatGPT app directory. The goal is to avoid any regression for existing MCP / MCP App experiences, and keep a single codebase so new features are available everywhere. **Functional requirement:** the published app must work in normal (non-developer) mode for end users; developer mode is for testing only.

Apps built with the Apps SDK use MCP servers as their tool backend and can optionally render UI components. Apps can be submitted for publication to the ChatGPT app directory after testing in developer mode. OAuth 2.1 with dynamic client registration and PKCE is expected for authenticated MCP servers.

## Decision Drivers

- Preserve the current Claude MCP + MCP Apps experience with no functional degradation.
- Enable ChatGPT App distribution without forking the product.
- Ensure the ChatGPT App works in normal (non-developer) mode.
- Keep a single source of truth for tool schemas and logic.
- Minimize duplicated auth or tool routing logic.
- Allow future tool additions to ship simultaneously to both channels.

## Options Considered

1. **Publish a ChatGPT App using the Apps SDK (MCP-backed), reuse the existing MCP server**
   - Pros: Minimal architecture changes. Maintains full tool parity and UI resources. Single tool backend. Compatible with app directory distribution.
   - Cons: Requires app submission and compliance with Apps SDK auth and metadata requirements.

2. **Expose a separate REST API + OpenAPI schema for GPT Actions**
   - Pros: Works without MCP; compatible with Custom GPT Actions.
   - Cons: Duplicated tool schemas and auth flow, no MCP App UI, higher divergence risk.

3. **Build a proxy layer that translates GPT Actions -> MCP**
   - Pros: One tool backend.
   - Cons: Additional hop, new service to operate, extra failure modes and latency.

4. **Fork the product into separate ChatGPT and MCP implementations**
   - Pros: Maximum control per platform.
   - Cons: High maintenance cost, guaranteed divergence.

## Decision

Proceed with **Option 1** as the primary path: publish Brainstem as a ChatGPT App using the Apps SDK, backed by the same MCP server. Refactor code so tool definitions and execution live in a shared core, with the MCP server acting as a thin transport adapter. Maintain the existing MCP endpoints and UI resources so Claude and MCP clients are unaffected.

We will keep Option 2 as a future fallback if ChatGPT App distribution requires non-MCP interfaces, but it is not part of the initial plan.

## Architecture Changes

- **Minimal Tool Core Extraction (Preferred Scope)**
  - Extract tool handler functions (and their input schemas/descriptions) into separate modules (e.g., `src/tools/search.ts`, `src/tools/getDocument.ts`).
  - Keep tool registration in the adapter layer (`src/index.ts`) so the MCP server remains the single integration point.
  - Pass state via getters, not captured values. Example: `getR2Prefix()`, `getRepoFullName()`, `getBrainSummary()`. This avoids stale scope when the DO updates per-request state.
  - Keep `_meta.ui` and `registerAppTool` in the adapter layer to avoid UI regressions for Claude Desktop.
  - Migrate one tool at a time and run the existing verification steps after each migration.
  - This avoids introducing a registry abstraction unless or until we need cross-adapter composition.

  Example (getter pattern):
  ```ts
  // src/tools/search.ts
  export function createSearchTool(deps: {
    getR2Prefix: () => string;
    getBrainSummary: () => BrainSummary | null;
    ai: Ai;
    autoragName: string;
    getSourceUrl: (path: string) => string;
  }) {
    return {
      name: "search_brain",
      description: buildSearchDescription(deps.getBrainSummary),
      schema: { /* zod schema */ },
      handler: async ({ query, limit }) => {
        const prefix = deps.getR2Prefix();
        // use prefix at call time to avoid stale scope
      },
    };
  }

  // src/index.ts (adapter)
  const search = createSearchTool({
    getR2Prefix: () => this.r2Prefix,
    getBrainSummary: () => this.brainSummary,
    ai: this.env.AI,
    autoragName: this.env.AUTORAG_NAME,
    getSourceUrl: (path) => this.getSourceUrl(path),
  });
  this.server.tool(search.name, search.description, search.schema, search.handler);
  ```

- **Optional: Tool Registry (Deferred)**
  - If we later need multiple adapters (e.g., additional transports), introduce a thin registry that exports `{ name, description, schema, handler, meta }` tuples.
  - Keep this out of the initial scope to minimize change surface area and risk.

- **MCP Adapter (current)**
  - Continue to register tools on `McpServer` using the shared registry.
  - Keep all existing `_meta.ui` and App UI resource registration intact.

- **ChatGPT App Packaging**
  - Use the Apps SDK submission flow in the OpenAI dashboard. Pre-reqs include org verification and Owner role; submitters add MCP server details (and OAuth metadata), confirm policy compliance, and complete required submission fields.
  - MCP server requirements: publicly accessible domain, not local/testing, and a CSP that allows the exact domains the app fetches from.
  - Directory listing assets: app name and icon, short and long descriptions, tags/categories (where supported), and optional onboarding instructions or screenshots. Screenshots must match required dimensions.
  - Tool metadata must pass submission guidelines: clear names/descriptions and required annotations (`readOnlyHint`, `destructiveHint`, `openWorldHint`) set appropriately.
  - Once published, tool names/signatures/descriptions are locked; changes require resubmission.
  - Known gap: confirm exact asset sizes and any additional required listing fields directly in the submission UI before implementation begins.

- **Auth Compatibility**
  - Ensure current OAuth + DCR + PKCE flows remain compatible with MCP authorization requirements.
  - Add/verify required OAuth metadata and `WWW-Authenticate` headers already present.

## Consequences

- **Positive**
  - ChatGPT App and Claude MCP clients stay in lockstep feature parity.
  - No regression to existing MCP flows.
  - Shared tool registry reduces drift and review overhead.

- **Negative / Tradeoffs**
  - App submission/review process introduces external gating.
  - ChatGPT App updates require "Refresh" in the app settings to pull new tool schemas.
  - Some ChatGPT surfaces (e.g., deep research) may limit write actions.

## Risks & Mitigations

- **Plan / rollout restrictions:** MCP capabilities differ by plan and workspace settings; developer mode is for testing only.
  - Mitigation: Ensure the published app works in normal mode; document plan requirements and admin steps; keep read-only tool paths for limited modes.

- **Write-action safety:** ChatGPT requires explicit confirmation for write actions.
  - Mitigation: Mark read-only tools explicitly; keep write actions minimal and clearly described.

- **UI rendering differences:** ChatGPT UI iframe constraints may differ from Claude Desktop.
  - Mitigation: Validate UI responsiveness; keep the UI bundle self-contained.

- **Stale installation scoping:** Extracted handlers could capture old `r2Prefix` or `repoFullName` values.
  - Mitigation: Use getter functions passed into handlers so scoped values are resolved at call time.

- **Loss of UI metadata:** Moving tool definitions can drop `_meta.ui` or app-only visibility.
  - Mitigation: Keep UI registration and `_meta.ui` in the adapter layer.

- **Stale or missing dynamic tool descriptions:** `buildSearchDescription()` depends on live summary state.
  - Mitigation: Keep description composition in the adapter or pass a getter that reads current summary.

- **Auth assumptions leaking:** Shared handlers might get called from adapters that did not authenticate.
  - Mitigation: Keep auth and installation ownership checks in each adapter and treat handlers as trusted-core only.

- **Schema drift between adapters:** Hand-edited schemas can diverge over time.
  - Mitigation: Centralize schemas in the extracted modules and have adapters import them directly.

- **Bundling or runtime regressions:** New modules could import non-Worker-compatible dependencies.
  - Mitigation: Keep extracted modules dependency-free and within existing Worker-compatible imports.

## Open Questions

- Do we want to provide a "read-only" ChatGPT App variant for deep research compatibility?
- Should we split write actions into a separate, opt-in tool group for admin control?

## References

- Apps SDK (MCP + UI): https://developers.openai.com/docs/apps/quickstart
- Connect from ChatGPT (publishing + refresh guidance): https://developers.openai.com/docs/mcp/connect-from-chatgpt
- ChatGPT developer mode (MCP capabilities + confirmations): https://help.openai.com/en/articles/10119604-work-with-apps-in-chatgpt
- Apps SDK auth (OAuth 2.1 + DCR + PKCE): https://developers.openai.com/docs/apps/auth
- Apps submission requirements: https://developers.openai.com/docs/apps/submission
- App listing metadata: https://developers.openai.com/docs/apps/app-listing-metadata
- User interaction guidelines (submission): https://developers.openai.com/docs/apps/user-interaction-guidelines
- Tool metadata and annotations: https://developers.openai.com/docs/apps/optimizing-app-metadata
