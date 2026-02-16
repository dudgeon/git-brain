import { McpAgent } from "agents/mcp";
import { McpServer, type RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  registerAppResource,
  RESOURCE_MIME_TYPE,
  getUiCapability,
} from "@modelcontextprotocol/ext-apps/server";
import {
  getInstallationToken,
  getInstallationRepos,
  fetchRepoContents,
  fetchFileContent,
  fetchRepoTarballFiles,
  createRepoFile,
  verifyWebhookSignature,
  type GitHubEnv,
} from "./github";
import { extractChangedFiles, sanitizeInboxTitle, validateAlias, generateConfirmationCode } from "./utils";
import { triggerAISearchReindex } from "./cloudflare";
import { saveToInbox, ensureEmailTables } from "./inbox";
import logoPng from "../site/brainstem_logo.png";
import diagramPng from "../site/brainstem-diagram.png";
import brainInboxHtml from "../ui/dist/index.html";
import bookmarkletTemplate from "../ui/dist/bookmarklet.js";

// Environment bindings type
export interface Env extends GitHubEnv {
  MCP_OBJECT: DurableObjectNamespace<HomeBrainMCP>;
  R2: R2Bucket;
  AI: Ai;
  DB: D1Database;
  AUTORAG_NAME: string;
  WORKER_URL: string; // Base URL for /doc/* endpoint
  GITHUB_REPO_URL: string; // GitHub repo URL for source links (e.g., https://github.com/dudgeon/home-brain)
  GITHUB_APP_NAME: string; // GitHub App name for install URL
  CLOUDFLARE_ACCOUNT_ID?: string; // Account ID for AI Search API
  CLOUDFLARE_API_TOKEN?: string; // API token with AI Search Edit permission
  GITHUB_CLIENT_ID?: string; // OAuth client ID from GitHub App
  GITHUB_CLIENT_SECRET?: string; // OAuth client secret from GitHub App
}

// User record type
interface User {
  id: string;
  github_user_id: number;
  github_login: string;
  created_at: string;
  last_login_at: string | null;
}

// Session record type
interface Session {
  id: string;
  user_id: string;
  github_access_token: string | null;
  created_at: string;
  expires_at: string;
}

// Brain summary structure (loaded from R2 if available)
interface BrainSummary {
  domains?: string[];
  topics?: string[];
  recentFiles?: string[];
  lastUpdated?: string;
}

// Shared CSS for all pages (Claude-inspired warm, minimal aesthetic)
const SITE_STYLES = `
*, *::before, *::after { box-sizing: border-box; }
html { font-size: 16px; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
body { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif; background: #FAF9F7; color: #1a1a1a; line-height: 1.6; margin: 0; padding: 48px 24px; min-height: 100vh; }
.container { max-width: 600px; margin: 0 auto; }
h1 { font-size: 2rem; font-weight: 600; margin: 0 0 0.5rem 0; color: #1a1a1a; }
h1.success { color: #38a169; }
.tagline { font-size: 1.25rem; color: #6b6b6b; margin: 0 0 2rem 0; font-weight: 400; }
h2 { font-size: 1.125rem; font-weight: 600; margin: 2rem 0 1rem 0; color: #1a1a1a; }
h3 { font-size: 1rem; font-weight: 600; margin: 1.5rem 0 0.75rem 0; color: #1a1a1a; }
p { margin: 0 0 1rem 0; color: #1a1a1a; }
.muted { color: #6b6b6b; }
a { color: #5a67d8; text-decoration: none; }
a:hover { text-decoration: underline; }
.btn { display: inline-block; padding: 12px 24px; border-radius: 8px; font-weight: 500; font-size: 1rem; text-decoration: none; transition: background-color 0.15s ease; cursor: pointer; border: none; }
.btn-primary { background: #5a67d8; color: white; }
.btn-primary:hover { background: #4c51bf; text-decoration: none; }
.btn-success { background: #38a169; color: white; }
.btn-success:hover { background: #2f855a; text-decoration: none; }
hr { border: none; border-top: 1px solid #e5e5e5; margin: 2rem 0; }
.step { margin-bottom: 1.5rem; }
.step-number { font-weight: 600; color: #5a67d8; }
.step-title { font-weight: 600; }
code { font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace; font-size: 0.875rem; }
code:not(pre code) { background: #f4f4f5; padding: 0.125rem 0.375rem; border-radius: 4px; }
pre { background: #f4f4f5; padding: 1rem; border-radius: 8px; overflow-x: auto; margin: 1rem 0; }
pre code { background: none; padding: 0; }
.highlight { background: #f0fdf4; border: 1px solid #bbf7d0; padding: 1rem; border-radius: 8px; word-break: break-all; font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace; font-size: 0.875rem; margin: 1rem 0; }
.highlight-warning { background: #fffbeb; border: 1px solid #fde68a; padding: 1rem; border-radius: 8px; margin: 1rem 0; }
.highlight-warning strong { color: #92400e; }
.secondary-links { color: #6b6b6b; font-size: 0.875rem; margin-top: 2rem; }
.secondary-links a { color: #6b6b6b; }
.secondary-links a:hover { color: #5a67d8; }
ol, ul { margin: 1rem 0; padding-left: 1.5rem; }
li { margin-bottom: 0.5rem; }
.footer { margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid #e5e5e5; font-size: 0.875rem; color: #6b6b6b; }
@media (max-width: 480px) { body { padding: 32px 16px; } h1 { font-size: 1.75rem; } .tagline { font-size: 1.125rem; } pre { font-size: 0.75rem; padding: 0.75rem; } }
`;

// MCP Server implementation using Durable Objects
export class HomeBrainMCP extends McpAgent<Env> {
  server = new McpServer({
    name: "home-brain",
    version: "1.0.0",
  });

  // Cached brain summary (loaded from R2)
  private brainSummary: BrainSummary | null = null;

  // R2 prefix for this installation (empty for legacy, "brains/{uuid}/" for per-user)
  private r2Prefix: string = "";

  // GitHub repo for this installation (for source links)
  private repoFullName: string = "";

  // Tool handles for conditional MCP Apps upgrade (ADR-009)
  private _inboxTool: RegisteredTool | null = null;
  private _inboxSaveTool: RegisteredTool | null = null;

  /**
   * Upgrade inbox tools with MCP Apps metadata for clients that support it.
   * Called from oninitialized callback after client capabilities are known.
   * See ADR-009 for rationale.
   */
  private upgradeToAppsTools() {
    const uri = HomeBrainMCP.INBOX_RESOURCE_URI;
    const appsMeta = {
      ui: { resourceUri: uri },
      "ui/resourceUri": uri,
    };

    this._inboxTool?.update({
      _meta: appsMeta,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      callback: async (args: any) => {
        const { title, content } = args as { title: string; content: string };
        const safeTitle = sanitizeInboxTitle(title);
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const filePath = `inbox/${timestamp}-${safeTitle}.md`;
        return {
          content: [{ type: "text" as const, text: `Note draft prepared: ${filePath}\nTitle: ${title}\n\nThis note has NOT been saved yet. In UI hosts, use the composer to review and save. In non-UI hosts, call brain_inbox_save with the title and content to save.` }],
          structuredContent: { title, content, filePath },
        };
      },
    });

    this._inboxSaveTool?.update({
      _meta: appsMeta,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      callback: async (args: any) => {
        const { title, content, filePath: providedPath } = args as { title: string; content: string; filePath?: string };
        try {
          const installationUuid = this.r2Prefix.replace("brains/", "").replace(/\/$/, "");
          if (!installationUuid) {
            return {
              content: [{ type: "text" as const, text: "Cannot save: no installation context. Use a personalized MCP URL." }],
              isError: true,
            };
          }

          const result = await saveToInbox(this.env, installationUuid, title, content, {
            filePath: providedPath,
          });

          if (result.error) {
            return {
              content: [{ type: "text" as const, text: `Note saved to brain inbox (R2 only): ${result.filePath}\nGitHub write failed: ${result.error}` }],
              structuredContent: { filePath: result.filePath, r2: result.r2, github: result.github, error: result.error },
            };
          }

          return {
            content: [{ type: "text" as const, text: `Note saved to brain inbox: ${result.filePath}` }],
            structuredContent: { filePath: result.filePath, r2: result.r2, github: result.github },
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown error";
          return {
            content: [{ type: "text" as const, text: `Failed to save note: ${message}` }],
            isError: true,
          };
        }
      },
    });

    this.server.sendToolListChanged();
  }

  /**
   * Get the R2 prefix for this DO instance
   * Checks multiple sources: DO name, stored state, or persistent storage
   */
  private async initR2Prefix(): Promise<void> {
    try {
      // Try to get the DO name - if created via idFromName(uuid), this will be the uuid
      const doName = (this.ctx as { id?: { name?: string } })?.id?.name;
      if (doName && /^[a-f0-9-]{36}$/.test(doName)) {
        this.r2Prefix = `brains/${doName}/`;
        return;
      }
    } catch {
      // Fall through to storage check
    }

    // Fall back to persistent storage (survives hibernation/reconnection)
    try {
      const stored = await this.ctx.storage.get<string>("installationId");
      if (stored) {
        this.r2Prefix = `brains/${stored}/`;
      }
      const storedRepo = await this.ctx.storage.get<string>("repoFullName");
      if (storedRepo) {
        this.repoFullName = storedRepo;
      }
    } catch {
      // No stored state
    }
  }

  /**
   * Override fetch to handle installation ID and repo from query params
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const installationId = url.searchParams.get("installation");
    const repo = url.searchParams.get("repo");

    // If installation ID provided, set prefix and persist to storage
    if (installationId && /^[a-f0-9-]{36}$/.test(installationId)) {
      this.r2Prefix = `brains/${installationId}/`;
      await this.ctx.storage.put("installationId", installationId);
      // Reload brain summary for this installation
      await this.loadBrainSummary();
    }

    // If repo provided, store for source links and persist
    if (repo) {
      this.repoFullName = repo;
      await this.ctx.storage.put("repoFullName", repo);
    }

    // Call parent fetch (McpAgent's SSE handler)
    return super.fetch(request);
  }

  async init() {
    // Determine R2 prefix for this installation (checks DO name, then persistent storage)
    await this.initR2Prefix();
    // Try to load brain summary from R2 (non-blocking, cached)
    await this.loadBrainSummary();
    // Register about tool — returns different content based on whether installation is scoped
    this.server.tool(
      "about",
      "Get information about Git Brain and what this MCP server does.",
      {},
      async () => {
        if (!this.r2Prefix) {
          return {
            content: [
              {
                type: "text" as const,
                text: `# Brainstem

Brainstem connects your private GitHub repos to AI chat clients as a searchable knowledge base.

## How to Connect

You're seeing this because you connected without a personalized MCP URL. To access your knowledge base:

1. **Connect your repo:** Visit https://brainstem.cc/setup to install the GitHub App on your repository
2. **Authenticate:** Visit https://brainstem.cc/oauth/authorize to get your MCP URL and bearer token
3. **Use your personalized URL:** Connect your AI client to \`https://brainstem.cc/mcp/{your-uuid}\`

Once connected with your personalized URL, you'll have access to search, document retrieval, folder browsing, and more.`,
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: `# Git Brain

Git Brain exposes private GitHub repos as remote MCP servers, making your personal knowledge base accessible to Claude.

## How It Works
- Content syncs from GitHub to Cloudflare R2 storage
- AI Search indexes documents for semantic search
- MCP server exposes tools to search, browse, and read content

## Available Tools
- **search_brain**: Semantic search across all content — use this for questions about the user's personal info, family, projects, or anything unlikely to be in public sources
- **get_document**: Read a specific file by path
- **list_recent**: See recently modified files
- **list_folders**: Browse the folder structure
- **brain_inbox** / **brain_inbox_save**: Save notes to the user's inbox
- **brain_account**: Set up email-to-brain forwarding, verify sender addresses, claim vanity aliases (e.g. "name@brainstem.cc")

## Email Input
Forward emails to your brainstem address to save them as inbox notes. IMPORTANT: When the user asks about email setup, forwarding, or email handling for brainstem — use the brain_account tool (action: "status" to start), do NOT search the brain for email-related docs.

## Prompts (Slash Commands)
If you need to explicitly invoke a tool, these prompts are available:
- **brain_search**: Explicitly search the knowledge base (invokes search_brain tool)
- **brain_inbox**: Add a quick note (invokes brain_inbox tool)

Note: When the user asks about their personal information, family, projects, or preferences — use the search_brain tool. You have been granted access to search on their behalf.`,
            },
          ],
        };
      }
    );

    // Register all MCP tools
    this.registerSearchBrain();
    this.registerGetDocument();
    this.registerListRecent();
    this.registerListFolders();
    this.registerInbox();

    // Register MCP App UI resource for brain_inbox composer
    this.registerInboxAppResource();

    // Register account management tool (email setup, aliases)
    this.registerBrainAccount();

    // Strip `execution: { taskSupport: 'forbidden' }` from all tool definitions.
    // MCP SDK 1.25.2 hardcodes this field into every tool. Claude.ai's proxy rejects
    // tool definitions with this unknown field (returns -32600 "Invalid content from server").
    // See ADR-009.
    const registeredTools = (this.server as unknown as { _registeredTools: Record<string, RegisteredTool> })._registeredTools;
    for (const tool of Object.values(registeredTools)) {
      delete (tool as Record<string, unknown>).execution;
    }

    // After MCP handshake, upgrade inbox tools with Apps metadata for capable clients (ADR-009)
    this.server.server.oninitialized = () => {
      try {
        const caps = this.server.server.getClientCapabilities();
        const uiCap = getUiCapability(caps as Parameters<typeof getUiCapability>[0]);
        if (uiCap) {
          this.upgradeToAppsTools();
        }
      } catch {
        // Client doesn't support Apps — keep standard tool definitions
      }
    };
  }

  /**
   * Load brain summary from R2 if available
   * This enriches the search tool description with actual content topics
   */
  private async loadBrainSummary(): Promise<void> {
    try {
      const obj = await this.env.R2.get(`${this.r2Prefix}_brain_summary.json`);
      if (obj) {
        const text = await obj.text();
        this.brainSummary = JSON.parse(text) as BrainSummary;
      }
    } catch {
      // Summary not available - that's fine, we'll use base description
      this.brainSummary = null;
    }
  }

  /**
   * Build the search tool description
   * Combines hard-coded base with dynamic summary if available
   */
  private buildSearchDescription(): string {
    // Lead with purpose and access clarification
    let description =
      `Search the user's personal knowledge base. You have been granted access to use this on their behalf — do not hesitate to search when relevant.`;

    // When to use: semantic categories, not just trigger phrases
    description +=
      `\n\nUSE THIS TOOL FOR:` +
      `\n• Information about the user, their family, projects, or preferences that is unlikely to be in your training data or public web sources` +
      `\n• Augmenting your own memory of past conversations or user context, which may be incomplete or outdated` +
      `\n• Anything the user refers to as "the brain", "my brain", "brainstem", "my notes", or "my knowledge base"` +
      `\n• Questions about the user's personal life, family details, ongoing projects, saved reference materials`;

    // Add dynamic topics if summary is available
    if (this.brainSummary?.domains?.length) {
      description += `\n\nKnowledge domains: ${this.brainSummary.domains.join(", ")} (non-exhaustive).`;
    }

    if (this.brainSummary?.topics?.length) {
      description += `\n\nSample topics: ${this.brainSummary.topics.slice(0, 10).join(", ")} (the knowledge base contains more).`;
    }

    // What this is NOT — specific and brief
    description +=
      `\n\nDO NOT USE FOR: General knowledge (Wikipedia-style facts), current events, or information available in public sources. ` +
      `This contains only what the user has personally saved.`;

    description += `\n\nReturns relevant passages with source document links.`;

    return description;
  }

  /**
   * Get the GitHub URL for a document (for source links in search results)
   */
  private getSourceUrl(path: string): string {
    // Use per-installation repo if set, otherwise fall back to env var (legacy)
    if (this.repoFullName) {
      return `https://github.com/${this.repoFullName}/blob/main/${path}`;
    }
    const repoUrl = this.env.GITHUB_REPO_URL || "https://github.com/dudgeon/home-brain";
    return `${repoUrl}/blob/main/${path}`;
  }

  /**
   * search_brain - Semantic search across the knowledge base
   * Uses pure vector search (no LLM generation) - lets the AI client do summarization
   */
  private registerSearchBrain() {
    this.server.tool(
      "search_brain",
      this.buildSearchDescription(),
      {
        query: z.string().describe("Natural language search query"),
        limit: z
          .number()
          .optional()
          .default(5)
          .describe("Maximum number of results (default: 5, max: 20)"),
      },
      async ({ query, limit }) => {
        try {
          const maxResults = Math.min(limit ?? 5, 20);

          // Use pure vector search (no LLM generation)
          // This returns semantically similar chunks without AI summarization
          // Scope to this installation's folder using "starts with" filter (ADR-002)
          const searchOptions: Record<string, unknown> = {
            query,
            max_num_results: maxResults,
          };
          if (this.r2Prefix) {
            searchOptions.filters = {
              type: "and",
              filters: [
                { type: "gt", key: "folder", value: `${this.r2Prefix}/` },
                { type: "lte", key: "folder", value: `${this.r2Prefix}z` },
              ],
            };
          }
          const response = await this.env.AI.autorag(this.env.AUTORAG_NAME).search(searchOptions as Parameters<ReturnType<typeof this.env.AI.autorag>["search"]>[0]);

          if (!response.data || response.data.length === 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "No results found for your query.",
                },
              ],
            };
          }

          // Format results with source links
          const output = response.data
            .map((r, i) => {
              const contentText = r.content.map((c) => c.text).join("\n");
              const sourceLink = this.getSourceUrl(r.filename);
              return `## ${i + 1}. ${r.filename}\n**Score:** ${r.score.toFixed(2)} | **Source:** ${sourceLink}\n\n${contentText}`;
            })
            .join("\n\n---\n\n");

          return {
            content: [
              {
                type: "text" as const,
                text: output,
              },
            ],
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown error";
          return {
            content: [
              {
                type: "text" as const,
                text: `Search failed: ${message}`,
              },
            ],
            isError: true,
          };
        }
      }
    );
  }

  /**
   * get_document - Retrieve a specific document by path
   */
  private registerGetDocument() {
    this.server.tool(
      "get_document",
      "Get the full content of a specific document by its path.",
      {
        path: z.string().describe("Path to the document (e.g., 'projects/cnc/notes.md')"),
      },
      async ({ path }) => {
        try {
          // Normalize path - remove leading slash if present
          const normalizedPath = path.startsWith("/") ? path.slice(1) : path;

          const object = await this.env.R2.get(`${this.r2Prefix}${normalizedPath}`);

          if (!object) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Document not found: ${path}`,
                },
              ],
              isError: true,
            };
          }

          const content = await object.text();

          return {
            content: [
              {
                type: "text" as const,
                text: `# ${path}\n\n${content}`,
              },
            ],
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown error";
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to retrieve document: ${message}`,
              },
            ],
            isError: true,
          };
        }
      }
    );
  }

  /**
   * list_recent - List recently modified files
   */
  private registerListRecent() {
    this.server.tool(
      "list_recent",
      "List recently modified files in the knowledge base.",
      {
        limit: z
          .number()
          .optional()
          .default(10)
          .describe("Number of files to return (default: 10)"),
        path_prefix: z
          .string()
          .optional()
          .describe("Optional path prefix to filter results"),
      },
      async ({ limit, path_prefix }) => {
        try {
          const maxFiles = Math.min(limit ?? 10, 50);

          // Build the full R2 prefix (installation prefix + user-specified prefix)
          let fullPrefix = this.r2Prefix;
          if (path_prefix) {
            const normalizedPathPrefix = path_prefix.startsWith("/")
              ? path_prefix.slice(1)
              : path_prefix;
            fullPrefix = `${this.r2Prefix}${normalizedPathPrefix}`;
          }

          // List objects from R2
          const listOptions: R2ListOptions = {
            limit: 1000, // Get more to sort by date
            prefix: fullPrefix || undefined,
          };

          const listed = await this.env.R2.list(listOptions);

          // Sort by uploaded date (most recent first)
          const sorted = listed.objects
            .filter((obj) => !obj.key.endsWith("/")) // Exclude "directories"
            .sort((a, b) => {
              const dateA = a.uploaded?.getTime() ?? 0;
              const dateB = b.uploaded?.getTime() ?? 0;
              return dateB - dateA;
            })
            .slice(0, maxFiles);

          if (sorted.length === 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "No files found.",
                },
              ],
            };
          }

          const fileList = sorted
            .map((obj) => {
              const date = obj.uploaded
                ? obj.uploaded.toISOString().split("T")[0]
                : "unknown";
              const size = formatBytes(obj.size);
              // Strip the installation prefix from displayed path
              const displayPath = this.r2Prefix ? obj.key.replace(this.r2Prefix, "") : obj.key;
              return `- **${displayPath}** (${size}, ${date})`;
            })
            .join("\n");

          return {
            content: [
              {
                type: "text" as const,
                text: `## Recent Files\n\n${fileList}`,
              },
            ],
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown error";
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to list files: ${message}`,
              },
            ],
            isError: true,
          };
        }
      }
    );
  }

  /**
   * brain_inbox - Compose a note for the inbox (preview before save in UI hosts)
   */
  private static readonly INBOX_RESOURCE_URI = "ui://brain-inbox/composer.html";

  private registerInbox() {
    // Compose tool — returns draft text, does NOT save directly.
    // In UI hosts (after upgrade): composer app handles countdown + editing + save.
    // In non-UI hosts: returns draft content only — use brain_inbox_save to actually save.
    // Registered without _meta so Claude.ai proxy doesn't reject it (ADR-009).
    this._inboxTool = this.server.registerTool(
      "brain_inbox",
      {
        description: "Preview a note before saving to the inbox (UI hosts only). In UI-capable hosts, shows an interactive composer with editing and countdown before save. For non-UI hosts or AI agents, use brain_inbox_save instead to save notes directly.",
        inputSchema: {
          title: z
            .string()
            .describe(
              "Short title for the note (used as filename, e.g. 'grocery-list')"
            ),
          content: z
            .string()
            .describe("The markdown content of the note"),
        },
      },
      async ({ title, content }) => {
        const safeTitle = sanitizeInboxTitle(title);
        const timestamp = new Date()
          .toISOString()
          .replace(/[:.]/g, "-")
          .slice(0, 19);
        const filePath = `inbox/${timestamp}-${safeTitle}.md`;

        return {
          content: [
            {
              type: "text" as const,
              text: `Note draft prepared: ${filePath}\nTitle: ${title}\n\nThis note has NOT been saved yet. In UI hosts, use the composer to review and save. In non-UI hosts, call brain_inbox_save with the title and content to save.`,
            },
          ],
        };
      }
    );

    // Save tool — directly saves a note to the inbox. Preferred for non-UI hosts and AI agents.
    // In UI hosts, the composer app may call this after countdown/edit.
    // Registered without _meta so Claude.ai proxy doesn't reject it (ADR-009).
    this._inboxSaveTool = this.server.registerTool(
      "brain_inbox_save",
      {
        description: "Save a note to the brain inbox. Creates a .md file in the inbox/ folder, writes to both R2 and the connected GitHub repo. Use this when the user wants to save a thought, note, or reminder. Provide a short title (used as filename) and the markdown content.",
        inputSchema: {
          title: z.string().describe("Short title for the note (used as filename, e.g. 'grocery-list')"),
          content: z.string().describe("The markdown content of the note"),
          filePath: z.string().optional().describe("Optional custom file path. If omitted, auto-generates as inbox/{timestamp}-{title}.md"),
        },
      },
      async ({ title, content, filePath: providedPath }) => {
        try {
          const installationUuid = this.r2Prefix.replace("brains/", "").replace(/\/$/, "");
          if (!installationUuid) {
            return {
              content: [{ type: "text" as const, text: "Cannot save: no installation context. Use a personalized MCP URL." }],
              isError: true,
            };
          }

          const result = await saveToInbox(this.env, installationUuid, title, content, {
            filePath: providedPath,
          });

          if (result.error) {
            return {
              content: [{ type: "text" as const, text: `Note saved to brain inbox (R2 only): ${result.filePath}\nGitHub write failed: ${result.error}` }],
            };
          }

          return {
            content: [{ type: "text" as const, text: `Note saved to brain inbox: ${result.filePath}` }],
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown error";
          return {
            content: [{ type: "text" as const, text: `Failed to save note: ${message}` }],
            isError: true,
          };
        }
      }
    );
  }

  /**
   * Register the MCP App UI resource for the brain_inbox composer
   */
  private registerInboxAppResource() {
    const uri = HomeBrainMCP.INBOX_RESOURCE_URI;
    registerAppResource(
      this.server,
      "Brain Inbox Composer",
      uri,
      { mimeType: RESOURCE_MIME_TYPE },
      async () => ({
        contents: [
          { uri, mimeType: RESOURCE_MIME_TYPE, text: brainInboxHtml },
        ],
      }),
    );
  }

  /**
   * brain_account - Manage email forwarding, verified senders, and vanity aliases
   */
  private registerBrainAccount() {
    this.server.tool(
      "brain_account",
      `IMPORTANT: When the user asks to set up email, configure email forwarding, or anything about sending emails to their brain — call this tool IMMEDIATELY with action "status" to start. Do NOT search the brain first.` +
      `\n\nThis tool sets up and manages email-to-brain forwarding. The brainstem server has built-in email processing — users forward emails to their @brainstem.cc address and they appear as inbox notes.` +
      `\n\nUSE THIS TOOL FOR:` +
      `\n• Setting up email forwarding to the brain inbox` +
      `\n• Verifying a personal email address as an authorized sender` +
      `\n• Claiming a vanity address like "name@brainstem.cc"` +
      `\n• Checking email configuration status` +
      `\n• Removing a previously verified email address` +
      `\n\nActions: request_email (start verification for a sender address), check_alias / request_alias (vanity addresses), remove_email, status (show current config — use this first).`,
      {
        action: z.enum([
          "request_email",
          "check_alias",
          "request_alias",
          "remove_email",
          "status",
        ]).describe("Action to perform"),
        email: z.string().email().optional().describe("Email address (for request_email, remove_email)"),
        alias: z.string().optional().describe("Vanity alias name without @brainstem.cc (for check_alias, request_alias)"),
      },
      async ({ action, email, alias }) => {
        const installationUuid = this.r2Prefix.replace("brains/", "").replace(/\/$/, "");
        if (!installationUuid) {
          return {
            content: [{ type: "text" as const, text: "Email setup requires a personalized MCP URL. Visit https://brainstem.cc/setup to get started." }],
            isError: true,
          };
        }

        try {
          await ensureEmailTables(this.env.DB);

          switch (action) {
            case "request_email":
              return await this.handleRequestEmail(installationUuid, email);
            case "check_alias":
              return await this.handleCheckAlias(alias);
            case "request_alias":
              return await this.handleRequestAlias(installationUuid, alias);
            case "remove_email":
              return await this.handleRemoveEmail(installationUuid, email);
            case "status":
              return await this.handleEmailStatus(installationUuid);
            default:
              return { content: [{ type: "text" as const, text: `Unknown action: ${action}` }], isError: true };
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : "Unknown error";
          return { content: [{ type: "text" as const, text: `Account operation failed: ${msg}` }], isError: true };
        }
      }
    );
  }

  private async handleRequestEmail(installationUuid: string, email?: string) {
    if (!email) {
      return { content: [{ type: "text" as const, text: "Please provide an email address to verify." }], isError: true };
    }

    // Ensure default alias exists (enable email on first use)
    const defaultAlias = `brain+${installationUuid}`;
    await this.env.DB.prepare(
      "INSERT OR IGNORE INTO email_aliases (alias, installation_id, type, created_at) VALUES (?, ?, 'default', ?)"
    ).bind(defaultAlias, installationUuid, new Date().toISOString()).run();

    // Check if already confirmed
    const existing = await this.env.DB.prepare(
      "SELECT status FROM verified_senders WHERE installation_id = ? AND email = ?"
    ).bind(installationUuid, email.toLowerCase()).first<{ status: string }>();

    if (existing?.status === "confirmed") {
      return {
        content: [{ type: "text" as const, text: `${email} is already verified for this brain.` }],
      };
    }

    // Generate confirmation code
    const code = generateConfirmationCode();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const brainstemAddress = `${defaultAlias}@brainstem.cc`;

    if (existing) {
      // Update existing pending entry with new code
      await this.env.DB.prepare(
        "UPDATE verified_senders SET confirmation_code = ?, confirmation_expires_at = ? WHERE installation_id = ? AND email = ?"
      ).bind(code, expiresAt, installationUuid, email.toLowerCase()).run();
    } else {
      // Insert new pending entry
      await this.env.DB.prepare(
        `INSERT INTO verified_senders (id, installation_id, email, status, confirmation_code, confirmation_expires_at, created_at)
         VALUES (?, ?, ?, 'pending', ?, ?, ?)`
      ).bind(crypto.randomUUID(), installationUuid, email.toLowerCase(), code, expiresAt, new Date().toISOString()).run();
    }

    // Also check for vanity alias
    const vanity = await this.env.DB.prepare(
      "SELECT alias FROM email_aliases WHERE installation_id = ? AND type = 'vanity'"
    ).bind(installationUuid).first<{ alias: string }>();
    const addresses = [brainstemAddress];
    if (vanity) addresses.push(`${vanity.alias}@brainstem.cc`);

    return {
      content: [{
        type: "text" as const,
        text: `To verify ${email}, send an email with the subject **${code}** to **${brainstemAddress}** from ${email}.\n\nThe code expires in 24 hours.${vanity ? `\n\nYou can also send to: ${vanity.alias}@brainstem.cc` : ""}`,
      }],
    };
  }

  private async handleCheckAlias(alias?: string) {
    if (!alias) {
      return { content: [{ type: "text" as const, text: "Please provide an alias to check." }], isError: true };
    }

    const validation = validateAlias(alias);
    if (!validation.valid) {
      return { content: [{ type: "text" as const, text: `Invalid alias: ${validation.error}` }] };
    }

    const existing = await this.env.DB.prepare(
      "SELECT alias FROM email_aliases WHERE alias = ?"
    ).bind(alias).first<{ alias: string }>();

    return {
      content: [{
        type: "text" as const,
        text: existing
          ? `${alias}@brainstem.cc is already taken.`
          : `${alias}@brainstem.cc is available!`,
      }],
    };
  }

  private async handleRequestAlias(installationUuid: string, alias?: string) {
    if (!alias) {
      return { content: [{ type: "text" as const, text: "Please provide an alias to claim." }], isError: true };
    }

    const validation = validateAlias(alias);
    if (!validation.valid) {
      return { content: [{ type: "text" as const, text: `Invalid alias: ${validation.error}` }], isError: true };
    }

    // Enforce 1 vanity alias per installation
    const existingVanity = await this.env.DB.prepare(
      "SELECT alias FROM email_aliases WHERE installation_id = ? AND type = 'vanity'"
    ).bind(installationUuid).first<{ alias: string }>();

    if (existingVanity) {
      return {
        content: [{ type: "text" as const, text: `You already have a vanity alias: ${existingVanity.alias}@brainstem.cc. Only one vanity alias per installation is allowed.` }],
        isError: true,
      };
    }

    // Try to claim (PK constraint prevents races)
    try {
      await this.env.DB.prepare(
        "INSERT INTO email_aliases (alias, installation_id, type, created_at) VALUES (?, ?, 'vanity', ?)"
      ).bind(alias, installationUuid, new Date().toISOString()).run();
    } catch {
      return { content: [{ type: "text" as const, text: `${alias}@brainstem.cc is already taken.` }] };
    }

    return {
      content: [{ type: "text" as const, text: `Claimed! Your brainstem address is now **${alias}@brainstem.cc**. Both this and brain+${installationUuid}@brainstem.cc will work.` }],
    };
  }

  private async handleRemoveEmail(installationUuid: string, email?: string) {
    if (!email) {
      return { content: [{ type: "text" as const, text: "Please provide an email address to remove." }], isError: true };
    }

    const result = await this.env.DB.prepare(
      "DELETE FROM verified_senders WHERE installation_id = ? AND email = ?"
    ).bind(installationUuid, email.toLowerCase()).run();

    if (result.meta.changes === 0) {
      return { content: [{ type: "text" as const, text: `${email} was not found in your verified senders.` }] };
    }

    return { content: [{ type: "text" as const, text: `Removed ${email} from verified senders.` }] };
  }

  private async handleEmailStatus(installationUuid: string) {
    const aliases = await this.env.DB.prepare(
      "SELECT alias, type FROM email_aliases WHERE installation_id = ?"
    ).bind(installationUuid).all<{ alias: string; type: string }>();

    const senders = await this.env.DB.prepare(
      "SELECT email, status, confirmed_at FROM verified_senders WHERE installation_id = ?"
    ).bind(installationUuid).all<{ email: string; status: string; confirmed_at: string | null }>();

    if (!aliases.results?.length) {
      return {
        content: [{ type: "text" as const, text: "Email forwarding is not set up yet. Use `request_email` with your email address to get started." }],
      };
    }

    let output = "## Email Configuration\n\n";

    output += "### Brainstem Addresses\n";
    for (const a of aliases.results) {
      output += `- **${a.alias}@brainstem.cc** (${a.type})\n`;
    }

    output += "\n### Verified Senders\n";
    if (senders.results?.length) {
      for (const s of senders.results) {
        const statusEmoji = s.status === "confirmed" ? "confirmed" : "pending";
        output += `- ${s.email} — ${statusEmoji}${s.confirmed_at ? ` (since ${s.confirmed_at.split("T")[0]})` : ""}\n`;
      }
    } else {
      output += "No verified senders yet.\n";
    }

    return { content: [{ type: "text" as const, text: output }] };
  }

  /**
   * list_folders - Browse the knowledge base structure
   */
  private registerListFolders() {
    this.server.tool(
      "list_folders",
      "List folders and files at a given path in the knowledge base.",
      {
        path: z
          .string()
          .optional()
          .default("")
          .describe("Path to list (empty or '/' for root)"),
      },
      async ({ path }) => {
        try {
          // Normalize user-provided path
          let userPath = path ?? "";
          if (userPath === "/") userPath = "";
          if (userPath && !userPath.endsWith("/")) userPath += "/";
          if (userPath.startsWith("/")) userPath = userPath.slice(1);

          // Build full R2 prefix (installation prefix + user path)
          const fullPrefix = `${this.r2Prefix}${userPath}`;

          const listed = await this.env.R2.list({
            prefix: fullPrefix,
            delimiter: "/",
          });

          // Strip installation prefix from folder paths for display
          const folders = (listed.delimitedPrefixes || []).map(f =>
            this.r2Prefix ? f.replace(this.r2Prefix, "") : f
          );
          const files = listed.objects.filter((obj) => obj.key !== fullPrefix);

          if (folders.length === 0 && files.length === 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `No contents found at path: ${path || "/"}`,
                },
              ],
            };
          }

          let output = `## Contents of ${path || "/"}\n\n`;

          if (folders.length > 0) {
            output += "### Folders\n";
            output += folders.map((f) => `- 📁 ${f}`).join("\n");
            output += "\n\n";
          }

          if (files.length > 0) {
            output += "### Files\n";
            output += files
              .map((f) => {
                // Strip installation prefix, then strip user path prefix
                const fullPath = this.r2Prefix ? f.key.replace(this.r2Prefix, "") : f.key;
                const name = fullPath.replace(userPath, "");
                const size = formatBytes(f.size);
                return `- 📄 ${name} (${size})`;
              })
              .join("\n");
          }

          return {
            content: [
              {
                type: "text" as const,
                text: output,
              },
            ],
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown error";
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to list contents: ${message}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    // Register prompts for explicit tool invocation via slash commands
    this.server.prompt(
      "brain_search",
      "Search your personal knowledge base (invokes search_brain tool)",
      { query: z.string().describe("What to search for in the knowledge base") },
      async ({ query }) => ({
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `Use the search_brain tool to search my knowledge base for: ${query}\n\nCall the search_brain tool now with this query.`,
            },
          },
        ],
      })
    );

    this.server.prompt(
      "brain_inbox",
      "Add a quick note to your brain inbox (invokes brain_inbox tool)",
      {
        title: z.string().describe("Title for the note"),
        content: z.string().describe("Content of the note"),
      },
      async ({ title, content }) => ({
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `Use the brain_inbox tool to save a note to my inbox with the following:\n\nTitle: ${title}\n\nContent:\n${content}\n\nCall the brain_inbox tool now with these parameters.`,
            },
          },
        ],
      })
    );
  }
}

// Helper function to format bytes
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/** WWW-Authenticate header value for 401 responses (RFC 9728) */
const WWW_AUTHENTICATE = `Bearer resource_metadata="https://brainstem.cc/.well-known/oauth-protected-resource"`;

/**
 * Validate bearer token from request, return user ID or a 401 Response
 */
async function authenticateRequest(
  request: Request,
  env: Env
): Promise<{ userId: string } | Response> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized", message: "Bearer token required" }), {
      status: 401,
      headers: { "Content-Type": "application/json", "WWW-Authenticate": WWW_AUTHENTICATE },
    });
  }

  const token = authHeader.slice(7);
  const session = await env.DB.prepare(
    "SELECT user_id FROM sessions WHERE id = ? AND expires_at > ?"
  ).bind(token, new Date().toISOString()).first<{ user_id: string }>();

  if (!session) {
    return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
      status: 401,
      headers: { "Content-Type": "application/json", "WWW-Authenticate": WWW_AUTHENTICATE },
    });
  }

  return { userId: session.user_id };
}

/**
 * Ensure OAuth-related D1 tables exist (auto-migrate)
 */
async function ensureOAuthTables(env: Env): Promise<void> {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS oauth_clients (
      client_id TEXT PRIMARY KEY,
      client_secret TEXT NOT NULL,
      client_name TEXT,
      redirect_uris TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS authorization_codes (
      code TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      code_challenge TEXT,
      code_challenge_method TEXT,
      user_id TEXT,
      github_access_token TEXT,
      expires_at TEXT NOT NULL,
      used INTEGER DEFAULT 0
    )
  `).run();
}

/**
 * Handle /.well-known/oauth-protected-resource (RFC 9728)
 */
function handleProtectedResourceMetadata(): Response {
  return new Response(JSON.stringify({
    resource: "https://brainstem.cc",
    authorization_servers: ["https://brainstem.cc"],
    bearer_methods_supported: ["header"],
  }), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

/**
 * Handle /.well-known/oauth-authorization-server (RFC 8414)
 */
function handleAuthorizationServerMetadata(): Response {
  return new Response(JSON.stringify({
    issuer: "https://brainstem.cc",
    authorization_endpoint: "https://brainstem.cc/oauth/authorize",
    token_endpoint: "https://brainstem.cc/oauth/token",
    registration_endpoint: "https://brainstem.cc/oauth/register",
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
  }), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

/**
 * Handle /oauth/register - Dynamic Client Registration (RFC 7591)
 */
async function handleOAuthRegister(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  await ensureOAuthTables(env);

  const body = await request.json() as {
    client_name?: string;
    redirect_uris?: string[];
    grant_types?: string[];
    response_types?: string[];
    token_endpoint_auth_method?: string;
  };

  if (!body.redirect_uris || !Array.isArray(body.redirect_uris) || body.redirect_uris.length === 0) {
    return new Response(JSON.stringify({ error: "invalid_client_metadata", error_description: "redirect_uris required" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const clientId = crypto.randomUUID();
  const clientSecret = crypto.randomUUID();

  await env.DB.prepare(
    "INSERT INTO oauth_clients (client_id, client_secret, client_name, redirect_uris, created_at) VALUES (?, ?, ?, ?, ?)"
  ).bind(clientId, clientSecret, body.client_name || null, JSON.stringify(body.redirect_uris), new Date().toISOString()).run();

  return new Response(JSON.stringify({
    client_id: clientId,
    client_secret: clientSecret,
    client_name: body.client_name || null,
    redirect_uris: body.redirect_uris,
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "client_secret_post",
  }), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Check that the authenticated user owns the given installation
 */
async function verifyInstallationOwnership(
  env: Env,
  userId: string,
  installationId: string
): Promise<boolean> {
  const installation = await env.DB.prepare(
    "SELECT user_id FROM installations WHERE id = ?"
  ).bind(installationId).first<{ user_id: string | null }>();
  return installation?.user_id === userId;
}

// Create the base MCP handler (Streamable HTTP transport for Claude.ai proxy compatibility)
const mcpHandler = HomeBrainMCP.serve("/mcp");

// Installation record type
interface Installation {
  id: string;
  github_installation_id: number;
  account_login: string;
  account_type: string;
  repo_full_name: string;
  created_at: string;
  last_sync_at: string | null;
  user_id: string | null;
}

// Webhook log entry type
interface WebhookLog {
  id: number;
  received_at: string;
  event_type: string;
  installation_id: string | null;
  payload_summary: string;
  status: string;
  error: string | null;
}

/**
 * Handle / - Homepage
 */
function handleHomepage(env: Env): Response {
  const appName = env.GITHUB_APP_NAME || "git-brain-stem";
  const html = `<!DOCTYPE html>
<html lang="en">
<head><link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🧠</text></svg>">
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Brain Stem - Give your AI a second brain</title>
  <meta name="description" content="Connect your private knowledge base to Claude Desktop, Claude Code, and other MCP-compatible AI clients.">
  <style>${SITE_STYLES}</style>
</head>
<body>
  <div class="container">
    <div style="text-align: center; margin-bottom: 2.5rem;">
      <img src="/logo.png" alt="Brain Stem" style="width: 180px; height: auto; margin-bottom: 1rem;">
      <p class="tagline" style="margin-bottom: 0;">Connect your GitHub-based PKM to any MCP-compatible AI client.</p>
    </div>

    <p>Brainstem connects your personal knowledge base on GitHub to AI chat clients like Claude Mobile, giving your AI fast, simple access to your notes and context. Currently supports <code>.md</code>, <code>.txt</code>, <code>.json</code>, <code>.yaml</code>, <code>.yml</code>, <code>.toml</code>, <code>.rst</code>, and <code>.adoc</code> files.</p>

    <img src="/diagram.png?v=2" alt="How Brainstem works" style="width: 100%; height: auto; margin: 1.5rem 0; border-radius: 8px;">

    <h2>How it works</h2>

    <div class="step">
      <p><span class="step-number">1.</span> <span class="step-title">You maintain a "second brain"</span></p>
      <p class="muted">Notes, docs, or a knowledge base in a private GitHub repo. Maybe you use Obsidian, Claude Code, or just markdown files.</p>
    </div>

    <div class="step">
      <p><span class="step-number">2.</span> <span class="step-title">Connect it to Brain Stem</span></p>
      <p class="muted">Install our GitHub App on your repo. We sync your files and index them for semantic search.</p>
    </div>

    <div class="step">
      <p><span class="step-number">3.</span> <span class="step-title">Your MCP-compatible AI client can access it</span></p>
      <p class="muted">Claude Desktop, Claude Code, Claude.ai, or other MCP-compatible clients can search and retrieve from your brain.</p>
    </div>

    <h2>Ways to save</h2>

    <div class="step">
      <p><span class="step-title">Email forwarding</span></p>
      <p class="muted">Forward any email to your brainstem address and it's saved as an inbox note. Set up via the <code>brain_account</code> tool in your AI client.</p>
    </div>

    <div class="step">
      <p><span class="step-title">Web clipper</span></p>
      <p class="muted">A browser bookmarklet that extracts and saves articles with one click. Available on your <a href="/oauth/authorize">OAuth success page</a>.</p>
    </div>

    <div class="step">
      <p><span class="step-title">Inbox tools</span></p>
      <p class="muted">Ask your AI to save notes, reminders, or thoughts directly via <code>brain_inbox</code> or <code>brain_inbox_save</code>.</p>
    </div>

    <h2>Tools</h2>
    <p class="muted">Brainstem exposes eight tools over MCP. Your AI client discovers them automatically when connected.</p>

    <div style="margin-top: 0.75rem;">
      <p style="margin-bottom: 0.5rem;"><code>search_brain</code> <span class="muted">&mdash; Semantic search across your knowledge base. Returns relevant passages with source links.</span></p>
      <p style="margin-bottom: 0.5rem;"><code>get_document</code> <span class="muted">&mdash; Retrieve the full contents of a file by path.</span></p>
      <p style="margin-bottom: 0.5rem;"><code>list_recent</code> <span class="muted">&mdash; List recently modified files, optionally filtered by path prefix.</span></p>
      <p style="margin-bottom: 0.5rem;"><code>list_folders</code> <span class="muted">&mdash; Browse the folder structure of your knowledge base.</span></p>
      <p style="margin-bottom: 0.5rem;"><code>brain_inbox</code> <span class="muted">&mdash; Save a note with an interactive preview (Claude Desktop).</span></p>
      <p style="margin-bottom: 0.5rem;"><code>brain_inbox_save</code> <span class="muted">&mdash; Save a note directly to the inbox (all clients).</span></p>
      <p style="margin-bottom: 0.5rem;"><code>brain_account</code> <span class="muted">&mdash; Set up email-to-brain forwarding and vanity aliases.</span></p>
      <p style="margin-bottom: 0.5rem;"><code>about</code> <span class="muted">&mdash; Information about your Brainstem instance and available tools.</span></p>
    </div>

    <p class="muted" style="text-align: center; margin-top: 1.5rem;">That's it. No complex setup. Push to GitHub, forward an email, clip a webpage, or ask your AI to take a note &mdash; it's all searchable within a minute.</p>

    <div style="margin-top: 1.5rem; padding: 1rem; border: 1px solid #ddd; border-radius: 6px; background: #fafafa;">
      <p style="margin: 0 0 0.5rem 0; font-weight: 600; font-size: 0.9rem;">Security &amp; Privacy</p>
      <p class="muted" style="margin: 0; font-size: 0.85rem;">Your files are stored on Cloudflare R2 (encrypted at rest) and indexed by Cloudflare AI Search. The platform operator has technical access to stored content for operational purposes. Do not connect repositories containing secrets, credentials, or highly sensitive data. You can disconnect and delete your data at any time by uninstalling the GitHub App.</p>
    </div>

    <hr>

    <div style="text-align: center;">
      <a href="https://github.com/apps/${escapeHtml(appName)}/installations/new" class="btn btn-primary">Connect Repository</a>
    </div>

    <p class="secondary-links" style="text-align: center;">
      Already connected? <a href="/oauth/authorize">Get your auth token</a> · <a href="/setup">View setup</a>
    </p>

    <div class="footer">
      <p>Brainstem is open source. <a href="https://github.com/dudgeon/git-brain">View on GitHub</a></p>
    </div>
  </div>
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

/**
 * Handle /setup - Landing page with "Connect Repository" button (redirects to homepage)
 */
function handleSetup(env: Env): Response {
  // /setup now just redirects to homepage since homepage has the connect button
  return handleHomepage(env);
}

/**
 * Handle /setup/callback - GitHub App installation callback
 */
async function handleSetupCallback(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const installationIdParam = url.searchParams.get("installation_id");
  const setupAction = url.searchParams.get("setup_action");

  // Handle cancellation
  if (setupAction === "cancel") {
    return new Response(`<!DOCTYPE html>
<html lang="en">
<head><link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🧠</text></svg>">
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Installation Cancelled - Brain Stem</title>
  <style>${SITE_STYLES}</style>
</head>
<body>
  <div class="container">
    <h1>Installation Cancelled</h1>
    <p>You cancelled the GitHub App installation. No worries — you can try again whenever you're ready.</p>
    <a href="/" class="btn btn-primary">Try Again</a>
  </div>
</body>
</html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  if (!installationIdParam) {
    return new Response("Missing installation_id parameter", { status: 400 });
  }

  const githubInstallationId = parseInt(installationIdParam, 10);
  if (isNaN(githubInstallationId)) {
    return new Response("Invalid installation_id", { status: 400 });
  }

  try {
    // Check if this installation already exists
    const existing = await env.DB.prepare(
      "SELECT id FROM installations WHERE github_installation_id = ?"
    ).bind(githubInstallationId).first<{ id: string }>();

    if (existing) {
      // Installation already exists, show existing endpoint
      const mcpUrl = `${env.WORKER_URL}/mcp/${existing.id}`;
      return renderSuccessPage(mcpUrl, "Already Connected");
    }

    // Get installation token to fetch repos
    const token = await getInstallationToken(env, githubInstallationId);
    const repos = await getInstallationRepos(token);

    if (repos.length === 0) {
      return new Response(`<!DOCTYPE html>
<html lang="en">
<head><link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🧠</text></svg>">
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>No Repositories - Brain Stem</title>
  <style>${SITE_STYLES}</style>
</head>
<body>
  <div class="container">
    <h1>No Repositories Found</h1>
    <p>The GitHub App installation doesn't have access to any repositories.</p>
    <p class="muted">Please ensure you granted access to at least one repository during installation.</p>
    <a href="/" class="btn btn-primary">Try Again</a>
  </div>
</body>
</html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    // For MVP, use the first repo
    const repo = repos[0];

    // Generate UUID for this installation
    const uuid = crypto.randomUUID();

    // Store in D1
    await env.DB.prepare(`
      INSERT INTO installations (id, github_installation_id, account_login, account_type, repo_full_name, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      uuid,
      githubInstallationId,
      repo.owner.login,
      repo.owner.type,
      repo.full_name,
      new Date().toISOString()
    ).run();

    // Trigger initial sync in background (don't block setup response)
    const [owner, repoName] = repo.full_name.split("/");
    ctx.waitUntil((async () => {
      try {
        const token = await getInstallationToken(env, githubInstallationId);
        await syncRepo(env, uuid, owner, repoName, token);
        await triggerAISearchReindex(env);
        console.log(`Initial sync complete for ${repo.full_name}`);
      } catch (error) {
        console.error(`Initial sync failed for ${repo.full_name}:`, error);
      }
    })());

    const mcpUrl = `${env.WORKER_URL}/mcp/${uuid}`;

    return renderSuccessPage(mcpUrl, repo.full_name);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Setup callback error:", error);
    return new Response(`<!DOCTYPE html>
<html lang="en">
<head><link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🧠</text></svg>">
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Setup Error - Brain Stem</title>
  <style>${SITE_STYLES}</style>
</head>
<body>
  <div class="container">
    <h1>Setup Error</h1>
    <p>Failed to complete setup: ${escapeHtml(message)}</p>
    <a href="/" class="btn btn-primary">Try Again</a>
  </div>
</body>
</html>`, { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 500 });
  }
}

/**
 * Render success page with MCP endpoint
 */
function renderSuccessPage(mcpUrl: string, repoName: string): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head><link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🧠</text></svg>">
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connected! - Brain Stem</title>
  <style>${SITE_STYLES}</style>
</head>
<body>
  <div class="container">
    <h1 class="success">Connected!</h1>
    <p>Your repository <strong>${escapeHtml(repoName)}</strong> is now connected. Content will be synced and searchable after your next push.</p>

    <hr>

    <h2>Step 1: Get your auth token</h2>
    <p>Brain Stem uses GitHub to verify you own your repos. Click below to authenticate and get your bearer token.</p>
    <a href="/oauth/authorize" class="btn btn-success">Authorize with GitHub</a>

    <hr>

    <h2>Step 2: Configure your AI client</h2>

    <h3>Claude Desktop / Claude Code</h3>
    <p>Add to your MCP config (on macOS: <code>~/.config/claude/mcp_servers.json</code>):</p>
    <pre><code>{
  "mcpServers": {
    "my-brain": {
      "url": "${escapeHtml(mcpUrl)}",
      "headers": {
        "Authorization": "Bearer YOUR_TOKEN_HERE"
      }
    }
  }
}</code></pre>
    <p class="muted">Replace <code>YOUR_TOKEN_HERE</code> with your bearer token from step 1.</p>

    <h3>Claude.ai (Web)</h3>
    <p>Settings → Connectors → Add custom connector → paste your endpoint URL and add the Authorization header.</p>

    <hr>

    <h2>Your endpoint</h2>
    <div class="highlight">${escapeHtml(mcpUrl)}</div>

    <hr>

    <h2>What else can you do?</h2>
    <p class="muted">Once connected, your AI has access to eight tools: search, document retrieval, folder browsing, note-taking, and email forwarding setup.</p>
    <ul>
      <li><strong>Save web pages:</strong> Get the bookmarklet from your <a href="/oauth/authorize">OAuth success page</a></li>
      <li><strong>Forward emails:</strong> Set up email-to-brain by asking your AI about <code>brain_account</code></li>
    </ul>

    <hr>

    <h2>Already installed?</h2>
    <p>Need a new token? You can <a href="/oauth/authorize">re-authorize with GitHub</a> at any time to get a fresh bearer token.</p>

    <div class="footer">
      <p>Questions? Check the <a href="https://github.com/dudgeon/git-brain/blob/main/TROUBLESHOOTING.md">troubleshooting guide</a>.</p>
    </div>
  </div>
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

/**
 * Log webhook attempt to D1 for diagnostics
 */
async function logWebhook(
  env: Env,
  eventType: string,
  installationId: string | null,
  payloadSummary: string,
  status: string,
  error: string | null = null
): Promise<void> {
  try {
    await env.DB.prepare(`
      INSERT INTO webhook_logs (received_at, event_type, installation_id, payload_summary, status, error)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      new Date().toISOString(),
      eventType,
      installationId,
      payloadSummary.slice(0, 500), // Truncate to fit
      status,
      error
    ).run();

    // Keep only last 100 logs
    await env.DB.prepare(`
      DELETE FROM webhook_logs WHERE id NOT IN (
        SELECT id FROM webhook_logs ORDER BY id DESC LIMIT 100
      )
    `).run();
  } catch (e) {
    // Don't fail webhook processing if logging fails
    console.error("Failed to log webhook:", e);
  }
}

/**
 * Handle /webhook/github - GitHub webhook endpoint
 */
async function handleGitHubWebhook(request: Request, env: Env): Promise<Response> {
  const signature = request.headers.get("x-hub-signature-256");
  const body = await request.text();
  const event = request.headers.get("x-github-event") || "unknown";

  // Verify webhook signature
  const isValid = await verifyWebhookSignature(body, signature, env.GITHUB_WEBHOOK_SECRET);
  if (!isValid) {
    console.error("Invalid webhook signature");
    await logWebhook(env, event, null, "signature verification failed", "rejected", "Invalid signature");
    return new Response("Invalid signature", { status: 401 });
  }

  const payload = JSON.parse(body);
  const githubInstallationId = payload.installation?.id?.toString() || null;

  console.log(`Received GitHub webhook: ${event}`);

  if (event === "push") {
    // Find installation by GitHub installation ID
    if (!githubInstallationId) {
      await logWebhook(env, event, null, "push without installation ID", "rejected", "Missing installation ID");
      return new Response("Missing installation ID in payload", { status: 400 });
    }

    const installation = await env.DB.prepare(
      "SELECT * FROM installations WHERE github_installation_id = ?"
    ).bind(parseInt(githubInstallationId)).first<Installation>();

    if (!installation) {
      await logWebhook(env, event, githubInstallationId, `push to unknown installation`, "ignored", "Installation not found in DB");
      return new Response("OK"); // Don't fail, just ignore
    }

    try {
      const token = await getInstallationToken(env, parseInt(githubInstallationId));
      const [owner, repo] = installation.repo_full_name.split("/");

      // Extract changed and removed files from push payload (incremental sync)
      const { changed, removed } = extractChangedFiles(payload);

      if (changed.length > 0 || removed.length > 0) {
        await syncChangedFiles(env, installation.id, owner, repo, token, changed, removed);
        const parts: string[] = [];
        if (changed.length > 0) parts.push(`synced ${changed.length} files: ${changed.slice(0, 3).join(", ")}${changed.length > 3 ? "..." : ""}`);
        if (removed.length > 0) parts.push(`deleted ${removed.length} files: ${removed.slice(0, 3).join(", ")}${removed.length > 3 ? "..." : ""}`);
        const summary = parts.join("; ");
        await logWebhook(env, event, installation.id, summary, "success");
        console.log(`Incremental sync for ${installation.repo_full_name}: ${summary}`);
      } else {
        await logWebhook(env, event, installation.id, "push with no syncable files", "success");
        console.log(`No syncable files changed in push to ${installation.repo_full_name}`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      await logWebhook(env, event, installation.id, "sync failed", "error", errorMsg);
      console.error("Webhook sync error:", error);
    }
  } else if (event === "installation" && payload.action === "deleted") {
    // Handle app uninstallation — purge R2 files, D1 records, sessions
    if (githubInstallationId) {
      const installation = await env.DB.prepare(
        "SELECT id FROM installations WHERE github_installation_id = ?"
      ).bind(parseInt(githubInstallationId)).first<{ id: string }>();

      if (installation) {
        try {
          const result = await deleteInstallation(env, installation.id);
          await logWebhook(env, `${event}:${payload.action}`, githubInstallationId,
            `Deleted installation: ${result.deleted} R2 objects purged`, "success");
        } catch (error) {
          const msg = error instanceof Error ? error.message : "Unknown";
          await logWebhook(env, `${event}:${payload.action}`, githubInstallationId,
            "deletion failed", "error", msg);
        }
      } else {
        await logWebhook(env, `${event}:${payload.action}`, githubInstallationId,
          "uninstalled (no DB record found)", "logged");
      }
    }
  } else if (event === "ping") {
    // GitHub sends ping when webhook is first configured
    await logWebhook(env, event, githubInstallationId, "webhook ping received", "success");
    console.log("Received ping from GitHub");
  } else {
    // Log other events for visibility
    await logWebhook(env, event, githubInstallationId, `unhandled event: ${payload.action || "no action"}`, "ignored");
  }

  return new Response("OK");
}

/**
 * Handle per-user MCP routing: /mcp/{uuid}
 */
async function handleUserMcp(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  installationId: string
): Promise<Response> {
  // Auth always required (ADR-002: workers.dev removed, brainstem.cc only)
  const requireAuth = true;

  // Verify installation exists
  const installation = await env.DB.prepare(
    "SELECT * FROM installations WHERE id = ?"
  ).bind(installationId).first<Installation>();

  if (!installation) {
    return new Response("Installation not found", { status: 404 });
  }

  // Auth check for brainstem.cc
  if (requireAuth) {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({
        error: "Unauthorized",
        message: "Bearer token required. Get one at: " + env.WORKER_URL + "/oauth/authorize",
      }), {
        status: 401,
        headers: { "Content-Type": "application/json", "WWW-Authenticate": WWW_AUTHENTICATE },
      });
    }

    const token = authHeader.slice(7);

    // Validate session
    const session = await env.DB.prepare(`
      SELECT s.user_id FROM sessions s
      WHERE s.id = ? AND s.expires_at > ?
    `).bind(token, new Date().toISOString()).first<{ user_id: string }>();

    if (!session) {
      return new Response(JSON.stringify({
        error: "Invalid or expired token",
        message: "Get a new token at: " + env.WORKER_URL + "/oauth/authorize",
      }), {
        status: 401,
        headers: { "Content-Type": "application/json", "WWW-Authenticate": WWW_AUTHENTICATE },
      });
    }

    // Verify user owns this installation
    if (installation.user_id && installation.user_id !== session.user_id) {
      return new Response(JSON.stringify({
        error: "Forbidden",
        message: "You don't have access to this installation",
      }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    // If installation has no user_id yet, link it to this user
    if (!installation.user_id) {
      await env.DB.prepare(
        "UPDATE installations SET user_id = ? WHERE id = ?"
      ).bind(session.user_id, installationId).run();
    }
  }

  // Rewrite URL to /mcp with installation query params
  // The DO's fetch handler will read these and configure itself
  const rewrittenUrl = new URL(request.url);
  rewrittenUrl.pathname = "/mcp";
  rewrittenUrl.searchParams.set("installation", installationId);
  rewrittenUrl.searchParams.set("repo", installation.repo_full_name);
  const rewrittenRequest = new Request(rewrittenUrl.toString(), request);

  // Forward to the MCP handler (Streamable HTTP transport)
  return mcpHandler.fetch(rewrittenRequest, env, ctx);
}

/**
 * Sync specific changed files from GitHub to R2
 */
async function syncChangedFiles(
  env: Env,
  installationUuid: string,
  owner: string,
  repo: string,
  token: string,
  changedFiles: string[],
  removedFiles: string[] = []
): Promise<void> {
  const prefix = `brains/${installationUuid}/`;

  for (const filePath of changedFiles) {
    try {
      // Fetch file content from GitHub
      const contents = await fetchRepoContents(token, owner, repo, filePath);
      if (contents.length > 0 && contents[0].download_url) {
        const content = await fetchFileContent(token, contents[0].download_url);

        // Write to per-user prefix only (no dual-write to root)
        await env.R2.put(`${prefix}${filePath}`, content);

        console.log(`Synced: ${filePath}`);
      }
    } catch (error) {
      console.error(`Failed to sync ${filePath}:`, error);
    }
  }

  // Delete removed files from R2
  for (const filePath of removedFiles) {
    await env.R2.delete(`${prefix}${filePath}`);
    console.log(`Deleted: ${filePath}`);
  }

  // Update last_sync_at
  await env.DB.prepare(
    "UPDATE installations SET last_sync_at = ? WHERE id = ?"
  ).bind(new Date().toISOString(), installationUuid).run();

  // Regenerate brain summary after any file changes (keeps metadata in sync)
  if (changedFiles.length > 0 || removedFiles.length > 0) {
    try {
      const allFiles: string[] = [];
      let cursor: string | undefined;
      do {
        const listed = await env.R2.list({ prefix, cursor });
        for (const obj of listed.objects) {
          const relative = obj.key.slice(prefix.length);
          if (relative && relative !== "_brain_summary.json") {
            allFiles.push(relative);
          }
        }
        cursor = listed.truncated ? listed.cursor : undefined;
      } while (cursor);
      await generateBrainSummary(env, prefix, allFiles);
    } catch (e) {
      console.error("Failed to regenerate brain summary:", e);
    }
  }

  // Trigger AI Search re-indexing (non-blocking, best-effort)
  // The cooldown is 3 minutes, so rapid syncs may skip reindex
  triggerAISearchReindex(env).catch(e => console.error("Reindex trigger failed:", e));
}

/**
 * Delete an installation: purge R2 files, D1 records, sessions, and trigger AI Search reindex
 */
async function deleteInstallation(env: Env, installationUuid: string): Promise<{ deleted: number }> {
  const prefix = `brains/${installationUuid}/`;
  let totalDeleted = 0;

  // Paginated R2 list + bulk delete (up to 1000 keys per page)
  let cursor: string | undefined;
  do {
    const listed = await env.R2.list({ prefix, limit: 1000, cursor });
    if (listed.objects.length > 0) {
      await env.R2.delete(listed.objects.map(o => o.key));
      totalDeleted += listed.objects.length;
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  // Get user_id before deleting installation
  const inst = await env.DB.prepare(
    "SELECT user_id FROM installations WHERE id = ?"
  ).bind(installationUuid).first<{ user_id: string | null }>();

  // Delete D1 installation record
  await env.DB.prepare("DELETE FROM installations WHERE id = ?").bind(installationUuid).run();

  // Revoke all sessions for the owning user
  if (inst?.user_id) {
    await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(inst.user_id).run();
  }

  // Clean up email-related data for this installation
  await env.DB.prepare("DELETE FROM email_aliases WHERE installation_id = ?").bind(installationUuid).run().catch(() => {});
  await env.DB.prepare("DELETE FROM verified_senders WHERE installation_id = ?").bind(installationUuid).run().catch(() => {});
  await env.DB.prepare("DELETE FROM email_log WHERE installation_id = ?").bind(installationUuid).run().catch(() => {});

  // Trigger AI Search reindex to drop stale vectors
  await triggerAISearchReindex(env);

  console.log(`Deleted installation ${installationUuid}: ${totalDeleted} R2 objects purged`);
  return { deleted: totalDeleted };
}

/**
 * Sync a repository from GitHub to R2 (FULL sync)
 * Downloads the entire repo as a tarball (1 subrequest) and extracts files.
 * This avoids the Workers 50-subrequest limit that previously caused partial syncs.
 */
async function syncRepo(
  env: Env,
  installationUuid: string,
  owner: string,
  repo: string,
  token: string
): Promise<void> {
  const prefix = `brains/${installationUuid}/`;
  const textExtensions = ["md", "txt", "json", "yaml", "yml", "toml", "rst", "adoc"];
  const sensitiveFiles = [".env", ".env.local", ".env.production", ".mcp.json", "credentials.json", "secrets.json", ".npmrc", ".pypirc"];
  const skipDirs = ["node_modules", ".git", ".github", "dist", "build", "__pycache__"];

  // Download entire repo as tarball and extract matching files (1 external subrequest)
  const files = await fetchRepoTarballFiles(token, owner, repo, {
    textExtensions,
    sensitiveFiles,
    skipDirs,
  });

  console.log(`Tarball extracted ${files.length} syncable files`);

  // Store each file in R2 (internal binding — no subrequest limit)
  const syncedFiles: string[] = [];
  for (const file of files) {
    try {
      await env.R2.put(`${prefix}${file.path}`, file.content);
      syncedFiles.push(file.path);
    } catch (error) {
      console.error(`Failed to store ${file.path}:`, error);
    }
  }

  // Generate brain summary for per-user prefix
  await generateBrainSummary(env, prefix, syncedFiles);

  // Update last_sync_at
  await env.DB.prepare(
    "UPDATE installations SET last_sync_at = ? WHERE id = ?"
  ).bind(new Date().toISOString(), installationUuid).run();

  console.log(`Sync complete for ${owner}/${repo} -> ${prefix} (${syncedFiles.length} files)`);
}

/**
 * Generate brain summary from synced files
 * Creates _brain_summary.json with domains, topics, and recent files
 */
async function generateBrainSummary(
  env: Env,
  r2Prefix: string,
  syncedFiles: string[]
): Promise<void> {
  // Extract domains from top-level directories
  const domains = new Set<string>();
  const topics: string[] = [];

  for (const file of syncedFiles) {
    // Get top-level directory as domain
    const parts = file.split("/");
    if (parts.length > 1) {
      domains.add(parts[0]);
    }

    // Extract topics from README.md files (first heading)
    if (file.toLowerCase().endsWith("readme.md")) {
      try {
        const obj = await env.R2.get(`${r2Prefix}${file}`);
        if (obj) {
          const content = await obj.text();
          // Find first markdown heading
          const headingMatch = content.match(/^#\s+(.+)$/m);
          if (headingMatch && headingMatch[1]) {
            const topic = headingMatch[1].trim();
            // Skip generic headings
            if (!["readme", "index", "home", "overview"].includes(topic.toLowerCase())) {
              topics.push(topic);
            }
          }
        }
      } catch {
        // Ignore errors reading individual files
      }
    }
  }

  // Limit topics to avoid overly long descriptions
  const sampleTopics = topics.slice(0, 15);

  // Get recent files (last 10 synced)
  const recentFiles = syncedFiles.slice(-10);

  const summary = {
    domains: Array.from(domains).sort(),
    topics: sampleTopics,
    recentFiles,
    lastUpdated: new Date().toISOString(),
    fileCount: syncedFiles.length,
  };

  // Write summary to R2
  await env.R2.put(
    `${r2Prefix}_brain_summary.json`,
    JSON.stringify(summary, null, 2)
  );

  console.log(`Generated brain summary: ${domains.size} domains, ${sampleTopics.length} topics, ${syncedFiles.length} files`);
}

/**
 * Handle /debug/sync-file/{uuid} - Sync a single file for testing
 * POST body: { "path": "path/to/file.md" }
 */
async function handleDebugSyncFile(request: Request, env: Env, installationId: string): Promise<Response> {
  try {
    const body = await request.json() as { path?: string };
    const filePath = body.path;

    if (!filePath) {
      return new Response(JSON.stringify({ error: "Missing 'path' in request body" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const installation = await env.DB.prepare(
      "SELECT * FROM installations WHERE id = ?"
    ).bind(installationId).first<Installation>();

    if (!installation) {
      return new Response(JSON.stringify({ error: "Installation not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const token = await getInstallationToken(env, installation.github_installation_id);
    const [owner, repo] = installation.repo_full_name.split("/");
    const prefix = `brains/${installationId}/`;

    // Fetch and sync the single file
    const contents = await fetchRepoContents(token, owner, repo, filePath);
    if (contents.length === 0 || !contents[0].download_url) {
      return new Response(JSON.stringify({ error: `File not found: ${filePath}` }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const content = await fetchFileContent(token, contents[0].download_url);

    await env.R2.put(`${prefix}${filePath}`, content);

    // Update last_sync_at
    await env.DB.prepare(
      "UPDATE installations SET last_sync_at = ? WHERE id = ?"
    ).bind(new Date().toISOString(), installationId).run();

    return new Response(JSON.stringify({
      success: true,
      message: `Synced ${filePath}`,
      locations: [`${prefix}${filePath}`],
    }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Debug sync-file error:", error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

/**
 * Handle /debug/sync/{uuid} - Manual sync trigger for testing
 */
async function handleDebugSync(env: Env, installationId: string): Promise<Response> {
  try {
    const installation = await env.DB.prepare(
      "SELECT * FROM installations WHERE id = ?"
    ).bind(installationId).first<Installation>();

    if (!installation) {
      return new Response(JSON.stringify({ error: "Installation not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const token = await getInstallationToken(env, installation.github_installation_id);
    const [owner, repo] = installation.repo_full_name.split("/");

    console.log(`Manual sync triggered for ${installation.repo_full_name}`);

    await syncRepo(env, installationId, owner, repo, token);

    return new Response(JSON.stringify({
      success: true,
      message: `Synced ${installation.repo_full_name}`,
      installationId,
    }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Debug sync error:", error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

/**
 * Handle /debug/status/{uuid} - Show diagnostic information for an installation
 */
async function handleDebugStatus(env: Env, installationId: string): Promise<Response> {
  try {
    // Get installation record
    const installation = await env.DB.prepare(
      "SELECT * FROM installations WHERE id = ?"
    ).bind(installationId).first<Installation>();

    if (!installation) {
      return new Response(JSON.stringify({ error: "Installation not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Count files in R2 for this installation
    const prefix = `brains/${installationId}/`;
    const r2List = await env.R2.list({ prefix, limit: 1000 });
    const fileCount = r2List.objects.filter(o => !o.key.endsWith("/")).length;

    // Count files at root (for AI Search)
    const rootList = await env.R2.list({ limit: 1000 });
    const rootFileCount = rootList.objects.filter(o => !o.key.endsWith("/") && !o.key.startsWith("brains/")).length;

    // Get recent webhook logs for this installation
    const webhookLogs = await env.DB.prepare(`
      SELECT * FROM webhook_logs
      WHERE installation_id = ? OR installation_id = ?
      ORDER BY id DESC LIMIT 10
    `).bind(installationId, installation.github_installation_id.toString()).all<WebhookLog>();

    // Get brain summary if exists
    let brainSummary = null;
    try {
      const summaryObj = await env.R2.get(`${prefix}_brain_summary.json`);
      if (summaryObj) {
        brainSummary = JSON.parse(await summaryObj.text());
      }
    } catch {
      // No summary
    }

    // Check if AI Search is configured
    let aiSearchStatus = "unknown";
    try {
      // Try a simple search to verify AI Search is working
      const testResult = await env.AI.autorag(env.AUTORAG_NAME).search({
        query: "test",
        max_num_results: 1,
      });
      aiSearchStatus = testResult.data ? `working (${testResult.data.length} results for test query)` : "working (no results)";
    } catch (e) {
      aiSearchStatus = `error: ${e instanceof Error ? e.message : "unknown"}`;
    }

    const status = {
      installation: {
        id: installation.id,
        github_installation_id: installation.github_installation_id,
        account_login: installation.account_login,
        repo_full_name: installation.repo_full_name,
        created_at: installation.created_at,
        last_sync_at: installation.last_sync_at,
      },
      storage: {
        files_in_prefix: fileCount,
        files_at_root: rootFileCount,
        r2_prefix: prefix,
      },
      brain_summary: brainSummary,
      ai_search: {
        name: env.AUTORAG_NAME,
        status: aiSearchStatus,
      },
      recent_webhooks: webhookLogs.results || [],
      diagnostics: {
        checked_at: new Date().toISOString(),
        sync_working: installation.last_sync_at !== null,
        days_since_sync: installation.last_sync_at
          ? Math.floor((Date.now() - new Date(installation.last_sync_at).getTime()) / (1000 * 60 * 60 * 24))
          : null,
      },
    };

    return new Response(JSON.stringify(status, null, 2), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

/**
 * Handle /debug/webhooks - Show all recent webhook logs
 */
async function handleDebugWebhooks(env: Env): Promise<Response> {
  try {
    const webhookLogs = await env.DB.prepare(`
      SELECT * FROM webhook_logs ORDER BY id DESC LIMIT 50
    `).all<WebhookLog>();

    return new Response(JSON.stringify({
      count: webhookLogs.results?.length || 0,
      logs: webhookLogs.results || [],
    }, null, 2), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    // Table might not exist yet
    if (message.includes("no such table")) {
      return new Response(JSON.stringify({
        error: "webhook_logs table not created yet",
        hint: "Run the migration to create the table",
      }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Parse cookies from Cookie header
 */
function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const cookie of cookieHeader.split(";")) {
    const [name, ...rest] = cookie.trim().split("=");
    if (name) {
      cookies[name] = rest.join("=");
    }
  }
  return cookies;
}

/**
 * Create or update user in D1, return user ID
 */
async function upsertUser(env: Env, githubUserId: number, githubLogin: string): Promise<string> {
  // Check if user exists
  const existing = await env.DB.prepare(
    "SELECT id FROM users WHERE github_user_id = ?"
  ).bind(githubUserId).first<{ id: string }>();

  if (existing) {
    // Update last_login_at
    await env.DB.prepare(
      "UPDATE users SET github_login = ?, last_login_at = ? WHERE id = ?"
    ).bind(githubLogin, new Date().toISOString(), existing.id).run();
    return existing.id;
  }

  // Create new user
  const userId = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO users (id, github_user_id, github_login, created_at, last_login_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(userId, githubUserId, githubLogin, new Date().toISOString(), new Date().toISOString()).run();

  return userId;
}

/**
 * Handle /oauth/authorize - Redirect to GitHub OAuth
 * Supports PKCE (code_challenge, code_challenge_method) and DCR clients (client_id, redirect_uri)
 */
function handleOAuthAuthorize(request: Request, env: Env): Response {
  if (!env.GITHUB_CLIENT_ID) {
    return new Response("OAuth not configured", { status: 500 });
  }

  const url = new URL(request.url);
  const state = crypto.randomUUID();
  const redirectUri = `${env.WORKER_URL}/oauth/callback`;

  // Support redirect_uri from query params (for ChatGPT / Claude.ai DCR clients)
  const clientRedirectUri = url.searchParams.get("redirect_uri");
  const clientId = url.searchParams.get("client_id");
  const codeChallenge = url.searchParams.get("code_challenge");
  const codeChallengeMethod = url.searchParams.get("code_challenge_method");
  const clientState = url.searchParams.get("state"); // Preserve client's state to return in callback

  // Build GitHub OAuth URL
  const githubAuthUrl = new URL("https://github.com/login/oauth/authorize");
  githubAuthUrl.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  githubAuthUrl.searchParams.set("redirect_uri", redirectUri);
  githubAuthUrl.searchParams.set("scope", "read:user");
  githubAuthUrl.searchParams.set("state", state);

  // Store our state, client redirect, PKCE params, client_id, and client's state in cookie
  const cookieParts = [state, clientRedirectUri || "", codeChallenge || "", codeChallengeMethod || "", clientId || "", clientState || ""];
  const cookieData = cookieParts.join("|");

  return new Response(null, {
    status: 302,
    headers: {
      Location: githubAuthUrl.toString(),
      "Set-Cookie": `oauth_state=${encodeURIComponent(cookieData)}; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Path=/`,
    },
  });
}

/**
 * Handle /oauth/callback - Exchange code for token, create session
 * Supports PKCE: stores authorization code with code_challenge for later verification
 */
async function handleOAuthCallback(request: Request, env: Env): Promise<Response> {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
    return new Response("OAuth not configured", { status: 500 });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return new Response(`<!DOCTYPE html>
<html lang="en">
<head><link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🧠</text></svg>">
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorization Cancelled - Brain Stem</title>
  <style>${SITE_STYLES}</style>
</head>
<body>
  <div class="container">
    <h1>Authorization Cancelled</h1>
    <p>You cancelled the GitHub authorization. You'll need to authorize to get a bearer token for your AI client.</p>
    <a href="/oauth/authorize" class="btn btn-primary">Try Again</a>
  </div>
</body>
</html>`, { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 400 });
  }

  if (!code || !state) {
    return new Response("Missing code or state", { status: 400 });
  }

  // Verify state from cookie (format: state|redirectUri|codeChallenge|codeChallengeMethod|clientId|clientState)
  const cookies = parseCookies(request.headers.get("Cookie") || "");
  const cookieData = decodeURIComponent(cookies.oauth_state || "");
  const [expectedState, clientRedirectUri, codeChallenge, codeChallengeMethod, oauthClientId, clientState] = cookieData.split("|");

  if (state !== expectedState) {
    return new Response("Invalid state - possible CSRF attack", { status: 400 });
  }

  // Exchange code for access token with GitHub
  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });

  const tokenData = await tokenResponse.json() as { access_token?: string; error?: string };

  if (tokenData.error || !tokenData.access_token) {
    return new Response(`Token exchange failed: ${tokenData.error || "no token"}`, { status: 400 });
  }

  // Get GitHub user info
  const userResponse = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "brain-stem",
    },
  });

  if (!userResponse.ok) {
    return new Response("Failed to get user info from GitHub", { status: 400 });
  }

  const githubUser = await userResponse.json() as { id: number; login: string };

  // Create or update user in D1
  const userId = await upsertUser(env, githubUser.id, githubUser.login);

  // Link any unclaimed installations to this user (by GitHub login)
  await env.DB.prepare(`
    UPDATE installations SET user_id = ? WHERE account_login = ? AND user_id IS NULL
  `).bind(userId, githubUser.login).run();

  // Clear the state cookie
  const clearCookie = "oauth_state=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/";

  // If there's a client redirect URI (DCR/Claude.ai/ChatGPT flow), issue authorization code
  if (clientRedirectUri) {
    const authCode = crypto.randomUUID();
    const codeExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await ensureOAuthTables(env);
    await env.DB.prepare(
      "INSERT INTO authorization_codes (code, client_id, redirect_uri, code_challenge, code_challenge_method, user_id, github_access_token, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      authCode,
      oauthClientId || "",
      clientRedirectUri,
      codeChallenge || null,
      codeChallengeMethod || null,
      userId,
      tokenData.access_token,
      codeExpiresAt.toISOString()
    ).run();

    const redirectUrl = new URL(clientRedirectUri);
    redirectUrl.searchParams.set("code", authCode);
    if (clientState) {
      redirectUrl.searchParams.set("state", clientState);
    }
    return new Response(null, {
      status: 302,
      headers: {
        Location: redirectUrl.toString(),
        "Set-Cookie": clearCookie,
      },
    });
  }

  // No client redirect — direct browser flow, create session immediately
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year

  await env.DB.prepare(`
    INSERT INTO sessions (id, user_id, github_access_token, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(sessionId, userId, tokenData.access_token, new Date().toISOString(), expiresAt.toISOString()).run();

  // Look up the user's installation UUID for the success page
  const installation = await env.DB.prepare(
    "SELECT id FROM installations WHERE user_id = ? LIMIT 1"
  ).bind(userId).first<{ id: string }>();

  // Show success page with token
  return renderOAuthSuccessPage(env, sessionId, githubUser.login, expiresAt, clearCookie, installation?.id || null);
}

/**
 * Render OAuth success page showing the bearer token
 */
function renderOAuthSuccessPage(
  env: Env,
  sessionId: string,
  githubLogin: string,
  expiresAt: Date,
  clearCookie: string,
  installationUuid: string | null
): Response {
  const mcpUrl = installationUuid
    ? `${env.WORKER_URL}/mcp/${installationUuid}`
    : null;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🧠</text></svg>">
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authenticated! - Brainstem</title>
  <style>${SITE_STYLES}
.copy-field { display: flex; gap: 8px; align-items: stretch; margin: 0.75rem 0; }
.copy-field input { flex: 1; font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace; font-size: 0.875rem; padding: 10px 12px; border: 1px solid #d4d4d8; border-radius: 8px; background: #f4f4f5; color: #1a1a1a; outline: none; }
.copy-field input:focus { border-color: #5a67d8; }
.copy-btn { padding: 10px 16px; border: 1px solid #d4d4d8; border-radius: 8px; background: white; color: #1a1a1a; font-size: 0.875rem; font-weight: 500; cursor: pointer; white-space: nowrap; transition: all 0.15s ease; }
.copy-btn:hover { background: #f4f4f5; border-color: #a1a1aa; }
.copy-btn.copied { background: #f0fdf4; border-color: #bbf7d0; color: #166534; }
.field-label { font-size: 0.875rem; font-weight: 500; color: #52525b; margin-bottom: 4px; }
.field-note { font-size: 0.8125rem; color: #6b6b6b; margin-top: 4px; }
.warning-box { background: #fef3c7; border: 1px solid #fde68a; padding: 0.75rem 1rem; border-radius: 8px; margin: 1rem 0; font-size: 0.875rem; }
.warning-box strong { color: #92400e; }
.info-box { background: #eff6ff; border: 1px solid #bfdbfe; padding: 0.75rem 1rem; border-radius: 8px; margin: 1rem 0; font-size: 0.875rem; color: #1e40af; }
.bookmarklet-link { display: inline-block; padding: 10px 20px; background: #1a1a1a; color: white; border-radius: 8px; font-size: 0.9375rem; font-weight: 600; text-decoration: none; cursor: grab; transition: all 0.15s ease; }
.bookmarklet-link:hover { background: #333; transform: translateY(-1px); }
.bookmarklet-link:active { cursor: grabbing; }
  </style>
</head>
<body>
  <div class="container">
    <h1 class="success">Authenticated!</h1>
    <p>Welcome, <strong>${escapeHtml(githubLogin)}</strong>.</p>

    ${mcpUrl ? `
    <hr>
    <h2>Connect to Claude.ai</h2>
    <p>In <a href="https://claude.ai/settings/connectors" target="_blank">Claude.ai Settings &rarr; Connectors</a> &rarr; Add custom connector</p>

    <div class="field-label">Remote server MCP url</div>
    <div class="copy-field">
      <input type="text" readonly value="${escapeHtml(mcpUrl)}" id="mcp-url">
      <button class="copy-btn" onclick="copyField('mcp-url', this)">Copy</button>
    </div>
    <div class="info-box">OAuth Client ID and Client Secret are not needed &mdash; Claude.ai handles authentication automatically.</div>
    ` : `
    <hr>
    <div class="warning-box"><strong>No installation found.</strong> <a href="/">Connect a repository</a> first, then return here to get your MCP URL.</div>
    `}

    <hr>
    <h2>Claude Code / Desktop</h2>
    <p>Add to your MCP config:</p>

    <div class="field-label">Bearer Token</div>
    <div class="copy-field">
      <input type="text" readonly value="${escapeHtml(sessionId)}" id="bearer-token">
      <button class="copy-btn" onclick="copyField('bearer-token', this)">Copy</button>
    </div>
    <div class="field-note">Expires: ${expiresAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>

    ${mcpUrl ? `
    <pre><code>{
  "mcpServers": {
    "my-brain": {
      "url": "${escapeHtml(mcpUrl)}",
      "headers": {
        "Authorization": "Bearer ${escapeHtml(sessionId)}"
      }
    }
  }
}</code></pre>
    ` : ''}

    ${mcpUrl ? `
    <hr>
    <h2>Web Clipper</h2>
    <p>Save articles from any browser. <a href="/bookmarklet">Full setup instructions &rarr;</a></p>
    <p style="margin-top: 0.75rem;">Drag this to your bookmarks bar:</p>
    <p style="text-align: center; margin: 0.75rem 0;">
      <a class="bookmarklet-link" href="${(() => { const js = bookmarkletTemplate.replace(/__TOKEN__/g, sessionId).replace(/__API__/g, env.WORKER_URL + '/api/clip').trim().replace(/;$/, ''); return 'javascript:void(' + encodeURIComponent(js) + ')'; })()}">Save to Brain</a>
    </p>
    ` : ''}

    <div class="info-box">Need a new token? You can <a href="/oauth/authorize">re-authorize with GitHub</a> anytime.</div>
  </div>
  <script>
function copyField(id, btn) {
  const input = document.getElementById(id);
  navigator.clipboard.writeText(input.value).then(() => {
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
  });
}
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Set-Cookie": clearCookie,
    },
  });
}

function renderBookmarkletPage(
  env: Env,
  sessionId: string,
  installationUuid: string | null
): Response {
  const bookmarkletJs = bookmarkletTemplate.replace(/__TOKEN__/g, sessionId).replace(/__API__/g, `${env.WORKER_URL}/api/clip`).trim().replace(/;$/, '');
  const bookmarkletHref = `javascript:void(${encodeURIComponent(bookmarkletJs)})`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🧠</text></svg>">
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Web Clipper - Brainstem</title>
  <style>${SITE_STYLES}
.bookmarklet-link { display: inline-block; padding: 12px 24px; background: #1a1a1a; color: white; border-radius: 8px; font-size: 1rem; font-weight: 600; text-decoration: none; cursor: grab; transition: all 0.15s ease; }
.bookmarklet-link:hover { background: #333; transform: translateY(-1px); }
.bookmarklet-link:active { cursor: grabbing; }
.instructions { background: #f4f4f5; border-radius: 8px; padding: 1rem 1.25rem; margin: 1rem 0; }
.instructions ol { margin: 0.5rem 0 0; padding-left: 1.25rem; }
.instructions li { margin: 0.4rem 0; line-height: 1.5; }
.shortcut-section { margin-top: 2rem; }
.shortcut-section h3 { margin-bottom: 0.5rem; }
.code-block { background: #f4f4f5; border: 1px solid #d4d4d8; border-radius: 8px; padding: 1rem; font-family: ui-monospace, SFMono-Regular, monospace; font-size: 0.8125rem; overflow-x: auto; white-space: pre-wrap; word-break: break-all; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Web Clipper</h1>
    <p>Save articles and web pages to your brain inbox from any browser.</p>

    ${installationUuid ? `
    <hr>
    <h2>Bookmarklet</h2>
    <div class="instructions">
      <p><strong>Drag this link to your bookmarks bar:</strong></p>
      <p style="margin-top: 0.75rem; text-align: center;">
        <a class="bookmarklet-link" href="${bookmarkletHref}">Save to Brain</a>
      </p>
      <ol>
        <li>Drag the button above to your browser's bookmarks bar</li>
        <li>Navigate to any article or web page</li>
        <li>Click "Save to Brain" in your bookmarks bar</li>
        <li>Optionally add a context note when prompted</li>
        <li>The article will be extracted and saved to your brain inbox</li>
      </ol>
    </div>

    <div class="shortcut-section">
      <h3>iOS Shortcut</h3>
      <p>Save links from any iOS app via the Share Sheet:</p>
      <div class="instructions">
        <ol>
          <li>Open the <strong>Shortcuts</strong> app on your iPhone/iPad</li>
          <li>Create a new shortcut with a <strong>Share Sheet</strong> trigger (accepts URLs)</li>
          <li>Add a <strong>"Get Name"</strong> action (extracts page title)</li>
          <li>Add an <strong>"Ask for Input"</strong> action with prompt: "Add a note (optional)"</li>
          <li>Add a <strong>"Get Contents of URL"</strong> action:</li>
        </ol>
        <div class="code-block">Method: POST
URL: ${escapeHtml(env.WORKER_URL)}/api/clip
Headers:
  Authorization: Bearer ${escapeHtml(sessionId)}
  Content-Type: application/json
Body (JSON):
  url: [Share Sheet Input]
  title: [Name]
  context: [Ask for Input result]</div>
        <ol start="6">
          <li>Add a <strong>"Show Notification"</strong> action: "Saved to brain!"</li>
        </ol>
      </div>
    </div>
    ` : `
    <hr>
    <div class="warning-box"><strong>No installation found.</strong> <a href="/setup">Connect a repository</a> first.</div>
    `}
  </div>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

/**
 * Handle /oauth/token - Token endpoint (RFC 6749)
 * Exchanges authorization code for access token, with PKCE verification
 */
async function handleOAuthToken(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Parse form data or JSON
  const contentType = request.headers.get("Content-Type") || "";
  let grantType: string | null = null;
  let code: string | null = null;
  let codeVerifier: string | null = null;
  let clientId: string | null = null;

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const formData = await request.formData();
    grantType = formData.get("grant_type") as string;
    code = formData.get("code") as string;
    codeVerifier = formData.get("code_verifier") as string;
    clientId = formData.get("client_id") as string;
  } else if (contentType.includes("application/json")) {
    const body = await request.json() as Record<string, string>;
    grantType = body.grant_type || null;
    code = body.code || null;
    codeVerifier = body.code_verifier || null;
    clientId = body.client_id || null;
  }

  if (grantType !== "authorization_code") {
    return new Response(JSON.stringify({ error: "unsupported_grant_type" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!code) {
    return new Response(JSON.stringify({ error: "invalid_request", error_description: "Missing code" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  await ensureOAuthTables(env);

  // Try authorization_codes table first (DCR/PKCE flow)
  const authCode = await env.DB.prepare(
    "SELECT * FROM authorization_codes WHERE code = ? AND expires_at > ? AND used = 0"
  ).bind(code, new Date().toISOString()).first<{
    code: string; client_id: string; redirect_uri: string;
    code_challenge: string | null; code_challenge_method: string | null;
    user_id: string; github_access_token: string | null; expires_at: string;
  }>();

  if (authCode) {
    // Mark code as used immediately
    await env.DB.prepare("UPDATE authorization_codes SET used = 1 WHERE code = ?").bind(code).run();

    // Verify PKCE if code_challenge was set
    if (authCode.code_challenge) {
      if (!codeVerifier) {
        return new Response(JSON.stringify({ error: "invalid_grant", error_description: "code_verifier required" }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
      }

      // Compute S256 challenge from verifier
      const encoder = new TextEncoder();
      const digest = await crypto.subtle.digest("SHA-256", encoder.encode(codeVerifier));
      const computedChallenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

      if (computedChallenge !== authCode.code_challenge) {
        return new Response(JSON.stringify({ error: "invalid_grant", error_description: "PKCE verification failed" }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
      }
    }

    // Verify client_id matches if provided
    if (clientId && authCode.client_id && clientId !== authCode.client_id) {
      return new Response(JSON.stringify({ error: "invalid_grant", error_description: "client_id mismatch" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    // Create session
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year

    await env.DB.prepare(
      "INSERT INTO sessions (id, user_id, github_access_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)"
    ).bind(sessionId, authCode.user_id, authCode.github_access_token, new Date().toISOString(), expiresAt.toISOString()).run();

    const expiresIn = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
    return new Response(JSON.stringify({
      access_token: sessionId,
      token_type: "Bearer",
      expires_in: expiresIn,
    }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Fallback: legacy flow where code IS the session ID
  const session = await env.DB.prepare(`
    SELECT s.*, u.github_login
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.id = ? AND s.expires_at > ?
  `).bind(code, new Date().toISOString()).first<Session & { github_login: string }>();

  if (!session) {
    return new Response(JSON.stringify({ error: "invalid_grant", error_description: "Invalid or expired code" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const expiresIn = Math.floor((new Date(session.expires_at).getTime() - Date.now()) / 1000);

  return new Response(JSON.stringify({
    access_token: session.id,
    token_type: "Bearer",
    expires_in: expiresIn,
  }), {
    headers: { "Content-Type": "application/json" },
  });
}

// Export combined handler with all routes
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Serve static assets
    if (url.pathname === "/logo.png") {
      return new Response(logoPng, {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=86400",
        },
      });
    }
    if (url.pathname === "/diagram.png") {
      return new Response(diagramPng, {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=86400",
        },
      });
    }

    // OAuth discovery endpoints (RFC 9728, RFC 8414)
    if (url.pathname === "/.well-known/oauth-protected-resource") {
      return handleProtectedResourceMetadata();
    }
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      return handleAuthorizationServerMetadata();
    }

    // Handle / - homepage
    if (url.pathname === "/" || url.pathname === "") {
      return handleHomepage(env);
    }

    // Handle /setup - landing page (redirects to homepage)
    if (url.pathname === "/setup") {
      return handleSetup(env);
    }

    // Handle /setup/callback - GitHub App callback
    if (url.pathname === "/setup/callback") {
      return handleSetupCallback(request, env, ctx);
    }

    // Handle /webhook/github - GitHub webhooks
    if (url.pathname === "/webhook/github" && request.method === "POST") {
      return handleGitHubWebhook(request, env);
    }

    // Handle /oauth/authorize - Start OAuth flow
    if (url.pathname === "/oauth/authorize") {
      return handleOAuthAuthorize(request, env);
    }

    // Handle /oauth/callback - OAuth callback from GitHub
    if (url.pathname === "/oauth/callback") {
      return handleOAuthCallback(request, env);
    }

    // Handle /oauth/register - Dynamic Client Registration (RFC 7591)
    if (url.pathname === "/oauth/register") {
      return handleOAuthRegister(request, env);
    }

    // Handle /oauth/token - Token endpoint
    if (url.pathname === "/oauth/token") {
      return handleOAuthToken(request, env);
    }

    // Handle /api/clip - Web clipping endpoint (bookmarklet / iOS Shortcut)
    if (url.pathname === "/api/clip") {
      if (request.method === "OPTIONS") {
        const { corsHeaders } = await import("./clip");
        return new Response(null, { status: 204, headers: corsHeaders() });
      }
      if (request.method === "POST") {
        const { handleClip, addCorsHeaders, corsHeaders } = await import("./clip");
        try {
          const auth = await authenticateRequest(request, env);
          if (auth instanceof Response) return addCorsHeaders(auth);
          // Resolve user's installation
          const installation = await env.DB.prepare(
            "SELECT id FROM installations WHERE user_id = ? LIMIT 1"
          ).bind(auth.userId).first<{ id: string }>();
          if (!installation) {
            return addCorsHeaders(new Response(JSON.stringify({ ok: false, error: "No installation found. Visit /setup first." }), {
              status: 404, headers: { "Content-Type": "application/json" },
            }));
          }
          return addCorsHeaders(await handleClip(request, env, installation.id));
        } catch (err) {
          const message = err instanceof Error ? err.message : "Internal server error";
          return new Response(JSON.stringify({ ok: false, error: message }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders() },
          });
        }
      }
    }

    // Handle /bookmarklet - Bookmarklet delivery page (authenticated)
    if (url.pathname === "/bookmarklet" && request.method === "GET") {
      const auth = await authenticateRequest(request, env);
      if (auth instanceof Response) return auth;
      const installation = await env.DB.prepare(
        "SELECT id FROM installations WHERE user_id = ? LIMIT 1"
      ).bind(auth.userId).first<{ id: string }>();
      const sessionId = request.headers.get("Authorization")?.slice(7) || "";
      return renderBookmarkletPage(env, sessionId, installation?.id || null);
    }

    // All /debug/* endpoints require authentication
    if (url.pathname.startsWith("/debug/")) {
      const auth = await authenticateRequest(request, env);
      if (auth instanceof Response) return auth;

      // /debug/reindex - Manually trigger AI Search reindex
      if (url.pathname === "/debug/reindex" && request.method === "POST") {
        const result = await triggerAISearchReindex(env);
        return new Response(JSON.stringify(result, null, 2), {
          status: result.success ? 200 : 500,
          headers: { "Content-Type": "application/json" },
        });
      }

      // /debug/sync/{uuid} - Manual sync trigger
      const syncMatch = url.pathname.match(/^\/debug\/sync\/([a-f0-9-]{36})$/);
      if (syncMatch && request.method === "POST") {
        if (!(await verifyInstallationOwnership(env, auth.userId, syncMatch[1]))) {
          return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } });
        }
        return handleDebugSync(env, syncMatch[1]);
      }

      // /debug/sync-file/{uuid} - Sync a single file
      const syncFileMatch = url.pathname.match(/^\/debug\/sync-file\/([a-f0-9-]{36})$/);
      if (syncFileMatch && request.method === "POST") {
        if (!(await verifyInstallationOwnership(env, auth.userId, syncFileMatch[1]))) {
          return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } });
        }
        return handleDebugSyncFile(request, env, syncFileMatch[1]);
      }

      // /debug/delete/{uuid} - Delete an installation (purge R2, D1, sessions)
      const deleteMatch = url.pathname.match(/^\/debug\/delete\/([a-f0-9-]{36})$/);
      if (deleteMatch && request.method === "POST") {
        if (!(await verifyInstallationOwnership(env, auth.userId, deleteMatch[1]))) {
          return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } });
        }
        try {
          const result = await deleteInstallation(env, deleteMatch[1]);
          return new Response(JSON.stringify({ success: true, ...result }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown error";
          return new Response(JSON.stringify({ error: message }), {
            status: 500, headers: { "Content-Type": "application/json" },
          });
        }
      }

      // /debug/status/{uuid} - Show diagnostic info
      const statusMatch = url.pathname.match(/^\/debug\/status\/([a-f0-9-]{36})$/);
      if (statusMatch) {
        if (!(await verifyInstallationOwnership(env, auth.userId, statusMatch[1]))) {
          return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } });
        }
        return handleDebugStatus(env, statusMatch[1]);
      }

      // /debug/webhooks - Show recent webhook logs
      if (url.pathname === "/debug/webhooks") {
        return handleDebugWebhooks(env);
      }

      return new Response("Not found", { status: 404 });
    }

    // Handle per-user MCP: /mcp/{uuid}
    const mcpUserMatch = url.pathname.match(/^\/mcp\/([a-f0-9-]{36})$/);
    if (mcpUserMatch) {
      return handleUserMcp(request, env, ctx, mcpUserMatch[1]);
    }

    // /doc/* endpoint removed (ADR-002 Phase 0) — use get_document MCP tool instead

    // /mcp Streamable HTTP transport (POST, GET, DELETE)
    // With installation query param (set by handleUserMcp): full MCP with all tools
    // Without installation param (bare /mcp): generic MCP with about-only tool
    if (url.pathname === "/mcp" && (request.method === "POST" || request.method === "GET" || request.method === "DELETE" || request.method === "OPTIONS")) {
      // GET without mcp-session-id header is not a Streamable HTTP request — return 404
      if (request.method === "GET" && !request.headers.get("mcp-session-id")) {
        return new Response(JSON.stringify({
          error: "Not found",
          message: "Use /mcp/{uuid} with a bearer token. Visit /setup to get started.",
        }), { status: 404, headers: { "Content-Type": "application/json" } });
      }
      return mcpHandler.fetch(request, env, ctx);
    }
    // Legacy /mcp/message path (SSE transport) — forward to handler for backward compatibility
    if (url.pathname === "/mcp/message" && request.method === "POST") {
      return mcpHandler.fetch(request, env, ctx);
    }

    return new Response("Not found", { status: 404 });
  },

  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    try {
      const { handleInboundEmail } = await import("./email");
      await handleInboundEmail(message, env);
    } catch (error) {
      // Never throw from email handler — log and silently drop
      console.error("Email handler error:", error);
    }
  },
};
