/**
 * Inbound email handler for brainstem
 * Handles verification codes, sender auth, MIME parsing, and inbox save
 */

import PostalMime from "postal-mime";
import TurndownService from "turndown";
import {
  sanitizeInboxTitle,
  normalizeEmailAddress,
  parseEmailRecipient,
  buildEmailFrontmatter,
} from "./utils";
import { saveToInbox, ensureEmailTables, type InboxEnv } from "./inbox";

/** Env type for email handler (same bindings as inbox + DB for email tables) */
export type EmailEnv = InboxEnv;

/**
 * Handle an inbound email message from Cloudflare Email Routing
 * This function NEVER throws — all errors are logged to email_log
 */
export async function handleInboundEmail(
  message: ForwardableEmailMessage,
  env: EmailEnv,
): Promise<void> {
  const from = normalizeEmailAddress(message.from);
  const to = message.to.toLowerCase();
  let subject = "";

  try {
    await ensureEmailTables(env.DB);

    // 1. Resolve recipient → installation
    const parsed = parseEmailRecipient(to);
    if (!parsed) {
      await logEmail(env.DB, null, from, to, "", "rejected_unroutable");
      return;
    }

    let installationId: string | null = null;
    if (parsed.type === "uuid") {
      // Verify the installation exists
      const inst = await env.DB.prepare(
        "SELECT id FROM installations WHERE id = ?"
      ).bind(parsed.uuid).first<{ id: string }>();
      installationId = inst?.id ?? null;
    } else {
      // Alias lookup
      const alias = await env.DB.prepare(
        "SELECT installation_id FROM email_aliases WHERE alias = ?"
      ).bind(parsed.localPart).first<{ installation_id: string }>();
      installationId = alias?.installation_id ?? null;
    }

    if (!installationId) {
      await logEmail(env.DB, null, from, to, "", "rejected_unroutable");
      return;
    }

    // Extract subject from headers (before full MIME parse for efficiency)
    subject = message.headers.get("subject")?.trim() || "";

    // 2. Check if this is a verification email (subject is exactly a 6-char code)
    const codeCandidate = subject.toUpperCase().trim();
    if (/^[A-Z0-9]{6}$/.test(codeCandidate)) {
      const confirmed = await tryConfirmSender(env.DB, installationId, from, codeCandidate);
      if (confirmed) {
        await logEmail(env.DB, installationId, from, to, subject, "confirmed");
        return;
      }
      // Not a match — fall through to regular email processing
    }

    // 3. Verify sender is confirmed
    const sender = await env.DB.prepare(
      "SELECT id FROM verified_senders WHERE installation_id = ? AND email = ? AND status = 'confirmed'"
    ).bind(installationId, from).first<{ id: string }>();

    if (!sender) {
      await logEmail(env.DB, installationId, from, to, subject, "rejected_sender");
      return;
    }

    // 4. Rate limiting
    const today = new Date().toISOString().slice(0, 10) + "T00:00:00Z";

    const senderCount = await env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM email_log WHERE installation_id = ? AND from_address = ? AND received_at >= ? AND status = 'saved'"
    ).bind(installationId, from, today).first<{ cnt: number }>();

    if (senderCount && senderCount.cnt >= 50) {
      await logEmail(env.DB, installationId, from, to, subject, "rate_limited");
      return;
    }

    const installationCount = await env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM email_log WHERE installation_id = ? AND received_at >= ? AND status = 'saved'"
    ).bind(installationId, today).first<{ cnt: number }>();

    if (installationCount && installationCount.cnt >= 200) {
      await logEmail(env.DB, installationId, from, to, subject, "rate_limited");
      return;
    }

    // 5. Parse MIME body
    const parser = new PostalMime();
    const rawEmail = new Response(message.raw);
    const email = await parser.parse(await rawEmail.arrayBuffer());

    // Use parsed subject if we didn't get it from headers
    if (!subject && email.subject) {
      subject = email.subject;
    }

    // 6. Transform to markdown
    const noteContent = emailToMarkdown(email);
    const noteTitle = subject || "(no subject)";

    // 7. Build frontmatter
    const frontmatter = buildEmailFrontmatter(from, email.date || undefined, subject || undefined);

    // 8. Save via shared pipeline
    const result = await saveToInbox(env, installationId, noteTitle, noteContent, {
      frontmatter,
      commitMessage: `Add email note: ${noteTitle}`,
    });

    await logEmail(env.DB, installationId, from, to, subject, "saved", null, result.filePath);

    // 9. Clean up old email_log entries (older than 7 days)
    await env.DB.prepare(
      "DELETE FROM email_log WHERE received_at < ?"
    ).bind(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()).run();

  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("Email handler error:", error);
    try {
      await logEmail(env.DB, null, from, to, subject, "error", msg);
    } catch {
      // Last-resort: can't even log
      console.error("Failed to log email error:", msg);
    }
  }
}

/**
 * Try to match a verification code and confirm the sender
 * Returns true if confirmation succeeded
 */
async function tryConfirmSender(
  db: D1Database,
  installationId: string,
  fromAddress: string,
  code: string,
): Promise<boolean> {
  const pending = await db.prepare(
    `SELECT id, email FROM verified_senders
     WHERE confirmation_code = ? AND installation_id = ? AND status = 'pending'
     AND confirmation_expires_at > ?`
  ).bind(code, installationId, new Date().toISOString())
    .first<{ id: string; email: string }>();

  if (!pending) return false;

  // Verify the from address matches the pending email
  if (normalizeEmailAddress(pending.email) !== fromAddress) return false;

  // Mark as confirmed
  await db.prepare(
    "UPDATE verified_senders SET status = 'confirmed', confirmed_at = ?, confirmation_code = NULL WHERE id = ?"
  ).bind(new Date().toISOString(), pending.id).run();

  return true;
}

/**
 * Convert a parsed email to markdown content
 */
function emailToMarkdown(email: { text?: string; html?: string; subject?: string }): string {
  if (email.text) {
    return email.text;
  }

  if (email.html) {
    const turndown = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
    });
    return turndown.turndown(email.html);
  }

  // No body — use subject as content
  return email.subject || "(empty email)";
}

/**
 * Log an email event to the email_log table
 */
async function logEmail(
  db: D1Database,
  installationId: string | null,
  from: string,
  to: string,
  subject: string,
  status: string,
  error?: string | null,
  inboxPath?: string | null,
): Promise<void> {
  await db.prepare(
    `INSERT INTO email_log (received_at, installation_id, from_address, to_address, subject, status, error, inbox_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    new Date().toISOString(),
    installationId,
    from,
    to,
    (subject || "").slice(0, 200),
    status,
    error ?? null,
    inboxPath ?? null,
  ).run();
}
