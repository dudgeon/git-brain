import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// Environment bindings type
export interface Env {
  MCP_OBJECT: DurableObjectNamespace<HomeBrainMCP>;
  R2: R2Bucket;
  AI: Ai;
  AUTORAG_NAME: string;
  WORKER_URL: string; // Base URL for /doc/* endpoint
  GITHUB_REPO_URL: string; // GitHub repo URL for source links (e.g., https://github.com/dudgeon/home-brain)
}

// Brain summary structure (loaded from R2 if available)
interface BrainSummary {
  domains?: string[];
  topics?: string[];
  recentFiles?: string[];
  lastUpdated?: string;
}

// MCP Server implementation using Durable Objects
export class HomeBrainMCP extends McpAgent<Env> {
  server = new McpServer({
    name: "home-brain",
    version: "1.0.0",
  });

  // Cached brain summary (loaded from R2)
  private brainSummary: BrainSummary | null = null;

  async init() {
    // Try to load brain summary from R2 (non-blocking, cached)
    await this.loadBrainSummary();
    // Register about tool using deprecated .tool() API with empty zod schema
    this.server.tool(
      "about",
      "Get information about Git Brain and what this MCP server does.",
      {},
      async () => ({
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
- about: This information
- search_brain: Semantic search across all content
- get_document: Read a specific file by path
- list_recent: See recently modified files
- list_folders: Browse the folder structure`,
          },
        ],
      })
    );

    // Register all MCP tools
    this.registerSearchBrain();
    this.registerGetDocument();
    this.registerListRecent();
    this.registerListFolders();
  }

  /**
   * Load brain summary from R2 if available
   * This enriches the search tool description with actual content topics
   */
  private async loadBrainSummary(): Promise<void> {
    try {
      const obj = await this.env.R2.get("_brain_summary.json");
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
    // Base description - always present, explains the general nature
    let description = `Search a personal knowledge base containing notes, documents, and reference materials. ` +
      `This is a private second-brain system, NOT a general knowledge source. `;

    // Add dynamic topics if summary is available
    if (this.brainSummary?.domains?.length) {
      description += `\n\nKnowledge domains include (but are not limited to): ${this.brainSummary.domains.join(", ")}. `;
    }

    if (this.brainSummary?.topics?.length) {
      description += `\n\nSample topics: ${this.brainSummary.topics.slice(0, 10).join(", ")}. `;
      description += `Note: This is a sample - the knowledge base may contain additional topics not listed here. `;
    }

    // Guidance on when to use (and not use)
    description += `\n\nUse this tool for: Personal notes, project documentation, family information, reference materials stored in this specific knowledge base. `;
    description += `\n\nDO NOT use for: General knowledge questions, current events, or information that would be in public sources. ` +
      `If unsure whether information is in this knowledge base, it's worth trying a search. `;

    description += `\n\nReturns relevant passages with source document links.`;

    return description;
  }

  /**
   * Get the GitHub URL for a document (for source links in search results)
   */
  private getSourceUrl(path: string): string {
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
          const response = await this.env.AI.autorag(this.env.AUTORAG_NAME).search({
            query,
            max_num_results: maxResults,
          });

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

          const object = await this.env.R2.get(normalizedPath);

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

          // List objects from R2, optionally filtered by prefix
          const listOptions: R2ListOptions = {
            limit: 1000, // Get more to sort by date
          };
          if (path_prefix) {
            listOptions.prefix = path_prefix.startsWith("/")
              ? path_prefix.slice(1)
              : path_prefix;
          }

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
              return `- **${obj.key}** (${size}, ${date})`;
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
          // Normalize path
          let prefix = path ?? "";
          if (prefix === "/") prefix = "";
          if (prefix && !prefix.endsWith("/")) prefix += "/";
          if (prefix.startsWith("/")) prefix = prefix.slice(1);

          const listed = await this.env.R2.list({
            prefix,
            delimiter: "/",
          });

          const folders = listed.delimitedPrefixes || [];
          const files = listed.objects.filter((obj) => obj.key !== prefix);

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
                const name = f.key.replace(prefix, "");
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

// Create the base MCP handler
const mcpHandler = HomeBrainMCP.serveSSE("/mcp");

// Export combined handler with /doc/* route for direct document access
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Handle /doc/* requests - serve documents directly from R2
    if (url.pathname.startsWith("/doc/")) {
      const path = url.pathname.slice(5); // Remove "/doc/" prefix
      if (!path) {
        return new Response("Document path required", { status: 400 });
      }

      try {
        const object = await env.R2.get(path);
        if (!object) {
          return new Response(`Document not found: ${path}`, { status: 404 });
        }

        const content = await object.text();

        // Determine content type based on extension
        const ext = path.split(".").pop()?.toLowerCase();
        const contentType =
          ext === "md" ? "text/markdown; charset=utf-8" :
          ext === "json" ? "application/json; charset=utf-8" :
          ext === "txt" ? "text/plain; charset=utf-8" :
          "text/plain; charset=utf-8";

        return new Response(content, {
          headers: {
            "Content-Type": contentType,
            "Access-Control-Allow-Origin": "*",
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return new Response(`Error retrieving document: ${message}`, { status: 500 });
      }
    }

    // Fall through to MCP handler for /mcp
    return mcpHandler.fetch(request, env, ctx);
  },
};
