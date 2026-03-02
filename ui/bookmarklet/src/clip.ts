/**
 * Brain Clipper Bookmarklet
 * Extracts article content using Readability.js, prompts for context,
 * and POSTs to the brainstem /api/clip endpoint.
 *
 * Built as a self-contained IIFE — __TOKEN__ and __API__ are replaced
 * at render time by the server.
 */

import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";

const TOKEN = "__TOKEN__";
const API = "__API__";

function notify(msg: string, success = true) {
  const el = document.createElement("div");
  el.textContent = msg;
  el.style.cssText = `position:fixed;top:20px;right:20px;z-index:2147483647;background:${success ? "#1a1a1a" : "#991b1b"};color:white;padding:12px 20px;border-radius:8px;font:14px/1.4 system-ui,-apple-system,sans-serif;box-shadow:0 4px 12px rgba(0,0,0,0.15);transition:opacity 0.3s;`;
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

(function clip() {
  // Extract article content
  let title: string = document.title;
  let content: string | null = null;

  try {
    const clone = document.cloneNode(true) as Document;
    const article = new Readability(clone).parse();
    if (article) {
      title = article.title || document.title;
      // Convert HTML→markdown client-side (Workers lack DOM for Turndown)
      const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
      content = td.turndown(article.content);
    }
  } catch {
    // Readability or Turndown failed — will save as URL-only bookmark
  }

  // Prompt for context note
  const context = prompt("Add a note (optional):");
  if (context === null) {
    // User cancelled the prompt
    return;
  }

  notify("Saving to brain...");

  const payload: Record<string, string> = {
    url: location.href,
    title,
  };
  if (content) payload.content = content;
  if (context) payload.context = context;

  fetch(API, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  })
    .then((r) => r.json())
    .then((d: { ok: boolean; error?: string }) => {
      notify(d.ok ? "Saved to brain!" : "Error: " + d.error, d.ok);
    })
    .catch((e: Error) => {
      notify("Failed: " + e.message, false);
    });
})();
