/**
 * Shared inbox save pipeline and email table management
 * Used by both the brain_inbox_save MCP tool and the inbound email handler
 */

import { sanitizeInboxTitle } from "./utils";
import { getInstallationToken, createRepoFile, type GitHubEnv } from "./github";
import { triggerAISearchReindex, type ReindexEnv } from "./cloudflare";

/** Minimal env type for inbox operations */
export interface InboxEnv extends GitHubEnv, ReindexEnv {
  R2: R2Bucket;
  DB: D1Database;
}

export interface SaveToInboxResult {
  filePath: string;
  r2: boolean;
  github: boolean;
  error?: string;
}

export interface SaveToInboxOptions {
  /** Custom file path (overrides auto-generation) */
  filePath?: string;
  /** YAML frontmatter to prepend before content */
  frontmatter?: string;
  /** Custom git commit message */
  commitMessage?: string;
}

/**
 * Save a note to the brain inbox: R2 + GitHub + AI Search reindex
 *
 * @param env - Worker environment bindings
 * @param installationId - Installation UUID
 * @param title - Note title (used for filename if filePath not provided)
 * @param content - Markdown content
 * @param options - Optional overrides
 */
export async function saveToInbox(
  env: InboxEnv,
  installationId: string,
  title: string,
  content: string,
  options: SaveToInboxOptions = {}
): Promise<SaveToInboxResult> {
  const r2Prefix = `brains/${installationId}/`;

  // Generate file path if not provided
  let filePath = options.filePath;
  if (!filePath) {
    const safeTitle = sanitizeInboxTitle(title);
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, 19);
    const filename = `${timestamp}-${safeTitle}.md`;
    filePath = `inbox/${filename}`;
  }

  // Prepend frontmatter if provided
  const fullContent = options.frontmatter
    ? `${options.frontmatter}\n${content}`
    : content;

  // Write to R2
  await env.R2.put(`${r2Prefix}${filePath}`, fullContent);

  // Write to GitHub repo
  const installation = await env.DB.prepare(
    "SELECT github_installation_id, repo_full_name FROM installations WHERE id = ?"
  ).bind(installationId).first<{ github_installation_id: number; repo_full_name: string }>();

  if (installation?.repo_full_name) {
    try {
      const [owner, repo] = installation.repo_full_name.split("/");
      const token = await getInstallationToken(env, installation.github_installation_id);
      const commitMessage = options.commitMessage || `Add brain inbox note: ${title}`;
      await createRepoFile(token, owner, repo, filePath, fullContent, commitMessage);
    } catch (ghError) {
      console.error("Failed to write to GitHub:", ghError);
      const ghMsg = ghError instanceof Error ? ghError.message : "unknown";
      // Trigger reindex even if GitHub fails (R2 write succeeded)
      triggerAISearchReindex(env).catch(e => console.error("Reindex trigger failed:", e));
      return { filePath, r2: true, github: false, error: ghMsg };
    }
  }

  // Trigger AI Search reindex (non-blocking)
  triggerAISearchReindex(env).catch(e => console.error("Reindex trigger failed:", e));

  return { filePath, r2: true, github: !!installation?.repo_full_name };
}

/**
 * Ensure email-related D1 tables exist (auto-migrate on first use)
 * Matches the ensureOAuthTables pattern in index.ts
 */
export async function ensureEmailTables(db: D1Database): Promise<void> {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS email_aliases (
      alias TEXT PRIMARY KEY,
      installation_id TEXT NOT NULL,
      type TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS verified_senders (
      id TEXT PRIMARY KEY,
      installation_id TEXT NOT NULL,
      email TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      confirmation_code TEXT,
      confirmation_expires_at TEXT,
      created_at TEXT NOT NULL,
      confirmed_at TEXT,
      UNIQUE(installation_id, email)
    )
  `).run();

  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_verified_senders_code
    ON verified_senders(confirmation_code)
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS email_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      received_at TEXT NOT NULL,
      installation_id TEXT,
      from_address TEXT,
      to_address TEXT,
      subject TEXT,
      status TEXT NOT NULL,
      error TEXT,
      inbox_path TEXT
    )
  `).run();
}
