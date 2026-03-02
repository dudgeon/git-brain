/**
 * Brain Explorer — MCP App
 *
 * Flow:
 * 1. ontoolinputpartial: show "Searching for: {query}..." as query streams in
 * 2. ontoolresult: render search results as interactive cards
 * 3. Click result → callServerTool("get_document") → render in viewer → updateModelContext
 * 4. Browse button → callServerTool("list_folders") → folder tree
 * 5. Fullscreen toggle for document reading
 */
import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import "./global.css";
import "./app.css";

// ============================================================================
// Minimal Markdown renderer (shared with brain-inbox)
// ============================================================================

function renderMarkdown(md: string): string {
  let html = escapeHtml(md);
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) =>
    `<pre><code>${code.trim()}</code></pre>`
  );
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  html = html.replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>");
  html = html.replace(/^- (.+)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);
  html = html.replace(/\n\n/g, "</p><p>");
  html = `<p>${html}</p>`;
  html = html.replace(/<p>\s*<\/p>/g, "");
  html = html.replace(/<p>(<h[1-3]>)/g, "$1");
  html = html.replace(/(<\/h[1-3]>)<\/p>/g, "$1");
  html = html.replace(/<p>(<pre>)/g, "$1");
  html = html.replace(/(<\/pre>)<\/p>/g, "$1");
  html = html.replace(/<p>(<ul>)/g, "$1");
  html = html.replace(/(<\/ul>)<\/p>/g, "$1");
  html = html.replace(/<p>(<blockquote>)/g, "$1");
  html = html.replace(/(<\/blockquote>)<\/p>/g, "$1");
  return html;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ============================================================================
// Types
// ============================================================================

interface SearchResult {
  index: number;
  filename: string;
  score: number;
  snippet: string;
  sourceUrl: string;
}

interface FolderEntry {
  name: string;
  fullPath: string;
  size: number;
}

// ============================================================================
// DOM References
// ============================================================================

const explorerEl = document.querySelector(".explorer") as HTMLElement;
const toolbarEl = document.getElementById("toolbar")!;
const backBtn = document.getElementById("back-btn")!;
const breadcrumbEl = document.getElementById("breadcrumb")!;
const browseBtn = document.getElementById("browse-btn")!;
const fullscreenBtn = document.getElementById("fullscreen-btn")!;

const resultsEl = document.getElementById("results")!;
const resultsHeaderEl = document.getElementById("results-header")!;
const resultsListEl = document.getElementById("results-list")!;

const foldersEl = document.getElementById("folders")!;
const foldersListEl = document.getElementById("folders-list")!;

const viewerEl = document.getElementById("viewer")!;
const viewerMetaEl = document.getElementById("viewer-meta")!;
const viewerContentEl = document.getElementById("viewer-content")!;

const loadingEl = document.getElementById("loading")!;
const loadingTextEl = document.getElementById("loading-text")!;

// ============================================================================
// State
// ============================================================================

type View = "results" | "folders" | "viewer";
let currentView: View = "results";
let currentQuery = "";
let currentFolderPath = "";
let currentDocPath = "";
let isFullscreen = false;
let contextUpdateTimer: number | null = null;

// Navigation stack for back button
const viewStack: { view: View; folderPath?: string }[] = [];

// ============================================================================
// View management
// ============================================================================

function showView(view: View) {
  resultsEl.style.display = view === "results" ? "" : "none";
  foldersEl.style.display = view === "folders" ? "" : "none";
  viewerEl.style.display = view === "viewer" ? "" : "none";
  currentView = view;
  updateToolbar();
}

function pushView(view: View) {
  viewStack.push({ view: currentView, folderPath: currentFolderPath });
  showView(view);
}

function popView() {
  const prev = viewStack.pop();
  if (prev) {
    if (prev.folderPath !== undefined) currentFolderPath = prev.folderPath;
    showView(prev.view);
  }
}

function updateToolbar() {
  backBtn.style.display = viewStack.length > 0 ? "" : "none";

  if (currentView === "results" && currentQuery) {
    breadcrumbEl.textContent = `Search: "${currentQuery}"`;
  } else if (currentView === "folders") {
    breadcrumbEl.textContent = currentFolderPath ? `/${currentFolderPath}` : "/";
  } else if (currentView === "viewer") {
    breadcrumbEl.textContent = currentDocPath;
  } else {
    breadcrumbEl.textContent = "";
  }
}

function showLoading(text: string) {
  loadingTextEl.textContent = text;
  loadingEl.style.display = "";
}

function hideLoading() {
  loadingEl.style.display = "none";
}

// ============================================================================
// Search results rendering
// ============================================================================

function renderResults(query: string, results: SearchResult[]) {
  currentQuery = query;

  if (results.length === 0) {
    resultsHeaderEl.textContent = `No results for "${query}"`;
    resultsListEl.innerHTML = '<div class="empty-state">Try a different search query.</div>';
    showView("results");
    return;
  }

  // Hide the header since we'll show the count in the drawer summary
  resultsHeaderEl.textContent = "";

  const cards = results
    .map(
      (r) => `
    <div class="result-card" data-path="${escapeHtml(r.filename)}">
      <div class="result-header">
        <span class="result-filename">${escapeHtml(r.filename)}</span>
        <span class="result-score ${scoreClass(r.score)}">${r.score.toFixed(2)}</span>
      </div>
      <div class="result-snippet">${escapeHtml(r.snippet)}</div>
    </div>
  `
    )
    .join("");

  // Wrap results in a collapsible drawer (collapsed by default)
  resultsListEl.innerHTML = `
    <details class="results-drawer">
      <summary class="results-summary">${results.length} result${results.length === 1 ? "" : "s"} for "${escapeHtml(query)}"</summary>
      <div class="results-cards">${cards}</div>
    </details>
  `;

  // Attach click handlers
  resultsListEl.querySelectorAll(".result-card").forEach((card) => {
    card.addEventListener("click", () => {
      const path = (card as HTMLElement).dataset.path;
      if (path) openDocument(path);
    });
  });

  showView("results");
}

function scoreClass(score: number): string {
  if (score >= 0.7) return "score-high";
  if (score >= 0.4) return "score-mid";
  return "score-low";
}

// ============================================================================
// Document viewer
// ============================================================================

async function openDocument(path: string) {
  pushView("viewer");
  currentDocPath = path;
  updateToolbar();
  showLoading("Loading document...");
  viewerMetaEl.textContent = "";
  viewerContentEl.innerHTML = "";

  try {
    const result = await app.callServerTool({
      name: "get_document",
      arguments: { path },
    });

    hideLoading();

    const structured = result.structuredContent as
      | { path?: string; content?: string; size?: number }
      | undefined;

    if (result.isError) {
      viewerContentEl.innerHTML = `<div class="error">${escapeHtml(getResultText(result))}</div>`;
      return;
    }

    const content = structured?.content ?? getResultText(result);
    const size = structured?.size;

    viewerMetaEl.innerHTML = `<span class="viewer-path">${escapeHtml(path)}</span>${size ? ` <span class="viewer-size">(${formatBytes(size)})</span>` : ""}`;
    viewerContentEl.innerHTML = renderMarkdown(content);

    // Push to model context (debounced)
    scheduleContextUpdate(path, content);
  } catch (e) {
    hideLoading();
    viewerContentEl.innerHTML = `<div class="error">Failed to load document: ${escapeHtml(String(e))}</div>`;
  }
}

// ============================================================================
// Folder browser
// ============================================================================

async function browseFolders(path: string) {
  if (currentView !== "folders") {
    pushView("folders");
  }
  currentFolderPath = path;
  updateToolbar();
  showLoading("Loading folders...");
  foldersListEl.innerHTML = "";

  try {
    const result = await app.callServerTool({
      name: "list_folders",
      arguments: { path: path || "/" },
    });

    hideLoading();

    const structured = result.structuredContent as
      | { path?: string; folders?: string[]; files?: FolderEntry[] }
      | undefined;

    if (result.isError) {
      foldersListEl.innerHTML = `<div class="error">${escapeHtml(getResultText(result))}</div>`;
      return;
    }

    const folders = structured?.folders ?? [];
    const files = structured?.files ?? [];

    if (folders.length === 0 && files.length === 0) {
      foldersListEl.innerHTML = '<div class="empty-state">Empty folder.</div>';
      return;
    }

    let html = "";

    for (const folder of folders) {
      const displayName = folder.replace(/\/$/, "").split("/").pop() || folder;
      html += `<div class="folder-item folder-dir" data-path="${escapeHtml(folder)}">
        <span class="folder-icon">&#x1F4C1;</span>
        <span class="folder-name">${escapeHtml(displayName)}/</span>
      </div>`;
    }

    for (const file of files) {
      html += `<div class="folder-item folder-file" data-path="${escapeHtml(file.fullPath)}">
        <span class="folder-icon">&#x1F4C4;</span>
        <span class="folder-name">${escapeHtml(file.name)}</span>
        <span class="folder-size">${formatBytes(file.size)}</span>
      </div>`;
    }

    foldersListEl.innerHTML = html;

    // Attach handlers
    foldersListEl.querySelectorAll(".folder-dir").forEach((el) => {
      el.addEventListener("click", () => {
        const p = (el as HTMLElement).dataset.path;
        if (p) browseFolders(p);
      });
    });

    foldersListEl.querySelectorAll(".folder-file").forEach((el) => {
      el.addEventListener("click", () => {
        const p = (el as HTMLElement).dataset.path;
        if (p) openDocument(p);
      });
    });
  } catch (e) {
    hideLoading();
    foldersListEl.innerHTML = `<div class="error">Failed to load folders: ${escapeHtml(String(e))}</div>`;
  }
}

// ============================================================================
// Model context updates
// ============================================================================

function scheduleContextUpdate(path: string, content: string) {
  if (contextUpdateTimer !== null) {
    clearTimeout(contextUpdateTimer);
  }
  contextUpdateTimer = window.setTimeout(() => {
    // Truncate content for context (keep it reasonable)
    const truncated = content.length > 4000 ? content.slice(0, 4000) + "\n\n[truncated]" : content;
    app.updateModelContext({
      content: [
        {
          type: "text",
          text: `User is viewing document: ${path}\n\n${truncated}`,
        },
      ],
    });
  }, 500);
}

// ============================================================================
// Helpers
// ============================================================================

function getResultText(result: CallToolResult): string {
  return (
    result.content
      ?.filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("\n") ?? ""
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

// ============================================================================
// Host Context
// ============================================================================

function handleHostContext(ctx: McpUiHostContext) {
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
  if (ctx.safeAreaInsets) {
    const { top, right, bottom, left } = ctx.safeAreaInsets;
    explorerEl.style.padding = `${top}px ${right}px ${bottom}px ${left}px`;
  }
  // Show fullscreen button if available
  if (ctx.availableDisplayModes?.includes("fullscreen")) {
    fullscreenBtn.style.display = "";
  }
  if (ctx.displayMode) {
    isFullscreen = ctx.displayMode === "fullscreen";
    explorerEl.classList.toggle("fullscreen", isFullscreen);
    fullscreenBtn.textContent = isFullscreen ? "\u2716" : "\u26F6";
  }
}

// ============================================================================
// MCP App
// ============================================================================

const app = new App({ name: "Brain Explorer", version: "1.0.0" });

app.onerror = console.error;
app.onteardown = async () => {
  if (contextUpdateTimer !== null) clearTimeout(contextUpdateTimer);
  return {};
};
app.onhostcontextchanged = handleHostContext;

// Streaming partial input — show search query as it streams
app.ontoolinputpartial = (params) => {
  const args = params.arguments as { query?: string } | undefined;
  if (!args) return;

  showView("results");
  if (args.query) {
    resultsHeaderEl.textContent = `Searching for "${args.query}"...`;
    resultsListEl.innerHTML = '<div class="searching"><span class="loading-spinner"></span></div>';
  }
};

// Final tool input
app.ontoolinput = (params) => {
  const args = params.arguments as { query?: string } | undefined;
  if (args?.query) {
    resultsHeaderEl.textContent = `Searching for "${args.query}"...`;
  }
};

// Tool result — render search results as interactive cards
app.ontoolresult = (result: CallToolResult) => {
  hideLoading();

  const structured = result.structuredContent as
    | { query?: string; results?: SearchResult[] }
    | undefined;

  if (structured?.results) {
    renderResults(structured.query ?? "", structured.results);
  } else {
    // Fallback: show raw text
    resultsHeaderEl.textContent = "Search Results";
    resultsListEl.innerHTML = `<div class="preview-content">${renderMarkdown(getResultText(result))}</div>`;
    showView("results");
  }
};

app.ontoolcancelled = () => {
  resultsHeaderEl.textContent = "Search cancelled";
  resultsListEl.innerHTML = "";
};

// Toolbar handlers
backBtn.addEventListener("click", popView);

browseBtn.addEventListener("click", () => {
  browseFolders("");
});

fullscreenBtn.addEventListener("click", async () => {
  const newMode = isFullscreen ? "inline" : "fullscreen";
  try {
    const result = await app.requestDisplayMode({ mode: newMode });
    isFullscreen = result.mode === "fullscreen";
    explorerEl.classList.toggle("fullscreen", isFullscreen);
    fullscreenBtn.textContent = isFullscreen ? "\u2716" : "\u26F6";
  } catch (e) {
    console.error("Failed to toggle fullscreen:", e);
  }
});

// Connect
app.connect().then(() => {
  const ctx = app.getHostContext();
  if (ctx) handleHostContext(ctx);
});
