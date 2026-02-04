/**
 * Utility functions for Git Brain
 * These are pure functions with no Cloudflare Workers dependencies
 */

/**
 * Extract changed files from a GitHub push webhook payload
 */
export function extractChangedFiles(payload: { commits?: Array<{ added?: string[]; modified?: string[]; removed?: string[] }> }): { changed: string[]; removed: string[] } {
  const changedFiles = new Set<string>();
  const removedFiles = new Set<string>();
  const textExtensions = ["md", "txt", "json", "yaml", "yml", "toml", "rst", "adoc"];
  const sensitiveFiles = [".env", ".env.local", ".env.production", ".mcp.json", "credentials.json", "secrets.json", ".npmrc", ".pypirc"];

  for (const commit of payload.commits || []) {
    // Add added and modified files
    for (const file of [...(commit.added || []), ...(commit.modified || [])]) {
      const ext = file.split(".").pop()?.toLowerCase();
      const fileName = file.split("/").pop()?.toLowerCase() || "";

      if (sensitiveFiles.includes(fileName) || fileName.startsWith(".env.")) {
        continue;
      }

      if (textExtensions.includes(ext || "")) {
        changedFiles.add(file);
      }
    }

    // Collect removed files (same filtering as added/modified)
    for (const file of commit.removed || []) {
      const ext = file.split(".").pop()?.toLowerCase();
      const fileName = file.split("/").pop()?.toLowerCase() || "";

      if (sensitiveFiles.includes(fileName) || fileName.startsWith(".env.")) {
        continue;
      }

      if (textExtensions.includes(ext || "")) {
        removedFiles.add(file);
      }
    }
  }

  // If a file was removed in one commit but re-added in another, don't delete it
  for (const file of changedFiles) {
    removedFiles.delete(file);
  }

  return { changed: Array.from(changedFiles), removed: Array.from(removedFiles) };
}

/**
 * Sanitize a title for use in an inbox filename
 * Converts to lowercase, replaces non-alphanumeric chars with hyphens, truncates to 80 chars
 */
export function sanitizeInboxTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}
