/**
 * Web clipping handler for brainstem
 * Receives article content from bookmarklet/iOS Shortcut, saves to brain inbox
 */

import TurndownService from "turndown";
import { sanitizeInboxTitle, buildClipFrontmatter } from "./utils";
import { saveToInbox, type InboxEnv } from "./inbox";

export interface ClipRequest {
  url: string;
  title?: string;
  html?: string;
  content?: string;
  context?: string;
}

/** CORS headers for cross-origin bookmarklet requests */
export function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

/** Add CORS headers to an existing response */
export function addCorsHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders())) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Handle a web clip request
 * Expects authenticated userId and resolved installationId
 */
export async function handleClip(
  request: Request,
  env: InboxEnv,
  installationId: string,
): Promise<Response> {
  // Size limit: 1MB
  const contentLength = request.headers.get("Content-Length");
  if (contentLength && parseInt(contentLength) > 1_048_576) {
    return jsonResponse({ ok: false, error: "Content too large (max 1MB)" }, 413);
  }

  // Parse request body
  let body: ClipRequest;
  try {
    body = await request.json() as ClipRequest;
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON" }, 400);
  }

  // Validate required fields
  if (!body.url || typeof body.url !== "string") {
    return jsonResponse({ ok: false, error: "url is required" }, 400);
  }

  // Determine title (fall back to URL hostname)
  let title: string;
  try {
    title = body.title || new URL(body.url).hostname;
  } catch {
    title = body.title || body.url;
  }

  // Determine content: prefer content > html > URL-only bookmark
  let markdown: string;
  if (body.content && typeof body.content === "string") {
    markdown = body.content;
  } else if (body.html && typeof body.html === "string") {
    const turndown = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
    });
    markdown = turndown.turndown(body.html);
  } else {
    // URL-only bookmark
    let displayUrl: string;
    try {
      displayUrl = new URL(body.url).hostname;
    } catch {
      displayUrl = body.url;
    }
    markdown = `Clipped from [${displayUrl}](${body.url})`;
  }

  // Build frontmatter
  const context = body.context && typeof body.context === "string" ? body.context.trim() : undefined;
  const frontmatter = buildClipFrontmatter(body.url, title, context || undefined);

  // Prepend article title as H1
  const fullContent = `# ${title}\n\n${markdown}`;

  // Save via shared pipeline
  const result = await saveToInbox(env, installationId, title, fullContent, {
    frontmatter,
    commitMessage: `Add web clip: ${title}`,
  });

  if (!result.r2) {
    return jsonResponse({ ok: false, error: "Failed to save to storage" }, 500);
  }

  return jsonResponse({
    ok: true,
    filePath: result.filePath,
    github: result.github,
  });
}

function jsonResponse(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(),
    },
  });
}
