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

/**
 * Alias validation result
 */
export interface AliasValidation {
  valid: boolean;
  error?: string;
}

const RESERVED_ALIASES = new Set([
  "brain", "admin", "support", "help", "info", "postmaster", "abuse",
  "noreply", "no-reply", "webmaster", "security", "root", "hostmaster",
  "mailer-daemon", "www", "mail", "ftp", "api", "app", "dashboard",
  "status", "billing", "system", "test", "dev", "staging",
]);

/**
 * Validate a vanity alias for use as an email local-part
 * Rules: 3-30 chars, lowercase alphanumeric + hyphens + dots,
 * must start/end with alphanumeric, no consecutive dots/hyphens
 */
export function validateAlias(alias: string): AliasValidation {
  if (alias.length < 3) return { valid: false, error: "Alias must be at least 3 characters" };
  if (alias.length > 30) return { valid: false, error: "Alias must be at most 30 characters" };
  if (alias !== alias.toLowerCase()) return { valid: false, error: "Alias must be lowercase" };
  if (!/^[a-z0-9]/.test(alias)) return { valid: false, error: "Alias must start with a letter or number" };
  if (!/[a-z0-9]$/.test(alias)) return { valid: false, error: "Alias must end with a letter or number" };
  if (!/^[a-z0-9.-]+$/.test(alias)) return { valid: false, error: "Alias can only contain lowercase letters, numbers, dots, or hyphens" };
  if (/[.-]{2}/.test(alias)) return { valid: false, error: "Alias must not contain consecutive dots or hyphens" };
  if (RESERVED_ALIASES.has(alias)) return { valid: false, error: "This alias is reserved" };
  return { valid: true };
}

/**
 * Generate a 6-character confirmation code for email verification
 * Uses uppercase alphanumeric chars, excluding confusable characters (I, O, 0, 1)
 */
export function generateConfirmationCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const randomValues = new Uint8Array(6);
  crypto.getRandomValues(randomValues);
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[randomValues[i] % chars.length];
  }
  return code;
}

/**
 * Extract the bare email address from a potentially formatted address
 * e.g., '"Dan Smith" <dan@gmail.com>' → 'dan@gmail.com'
 */
export function normalizeEmailAddress(address: string): string {
  const match = address.match(/<([^>]+)>/);
  return (match ? match[1] : address).trim().toLowerCase();
}

/**
 * Resolve an installation UUID from a brainstem email address
 * Returns the UUID if it's a sub-address (brain+{uuid}@brainstem.cc),
 * or the local-part for alias lookup
 */
export function parseEmailRecipient(toAddress: string): { type: "uuid"; uuid: string } | { type: "alias"; localPart: string } | null {
  const match = toAddress.match(/^([^@]+)@brainstem\.cc$/i);
  if (!match) return null;
  const localPart = match[1].toLowerCase();

  // Sub-address format: brain+{uuid}
  const subAddrMatch = localPart.match(/^brain\+([a-f0-9-]{36})$/);
  if (subAddrMatch) return { type: "uuid", uuid: subAddrMatch[1] };

  return { type: "alias", localPart };
}

/**
 * Build YAML frontmatter for an email-sourced inbox note
 */
export function buildEmailFrontmatter(from: string, date: string | undefined, subject: string | undefined): string {
  const safeSub = (subject || "(no subject)").replace(/"/g, '\\"');
  return [
    "---",
    "source: email",
    `from: ${from}`,
    `date: ${date || new Date().toISOString()}`,
    `subject: "${safeSub}"`,
    "---",
  ].join("\n");
}

/**
 * Build YAML frontmatter for a web-clipped inbox note
 */
export function buildClipFrontmatter(url: string, title?: string, context?: string): string {
  const lines = [
    "---",
    "source: clip",
    `url: ${url}`,
    `date: ${new Date().toISOString()}`,
  ];
  if (title) {
    lines.push(`title: "${title.replace(/"/g, '\\"')}"`);
  }
  if (context) {
    lines.push(`context: "${context.replace(/"/g, '\\"')}"`);
  }
  lines.push("---");
  return lines.join("\n");
}
