/**
 * Brain Inbox Composer — MCP App
 *
 * Flow:
 * 1. ontoolinputpartial: streaming preview as Claude generates the note
 * 2. ontoolresult: draft received (not yet saved) → show editable preview with 5s countdown
 * 3. If user taps/edits: countdown pauses, "Save now" button available
 * 4. If countdown expires: auto-save via callServerTool("brain_inbox_save")
 * 5. Save result displayed with R2/GitHub status
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
// Minimal Markdown renderer
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
// DOM References
// ============================================================================

const mainEl = document.querySelector(".main") as HTMLElement;

const composingEl = document.getElementById("composing")!;
const composeTitleEl = document.getElementById("compose-title")!;
const previewContentEl = document.getElementById("preview-content")!;

const draftEl = document.getElementById("draft")!;
const countdownBarEl = document.getElementById("countdown-bar")!;
const countdownLabelEl = document.getElementById("countdown-label")!;
const editTitleEl = document.getElementById("edit-title") as HTMLInputElement;
const editContentEl = document.getElementById("edit-content") as HTMLTextAreaElement;
const saveBtnEl = document.getElementById("save-btn")!;
const cancelBtnEl = document.getElementById("cancel-btn")!;

const savingEl = document.getElementById("saving")!;

const resultEl = document.getElementById("result")!;
const resultIconEl = document.getElementById("result-icon")!;
const resultTitleEl = document.getElementById("result-title")!;
const resultPathEl = document.getElementById("result-path")!;
const resultDetailsEl = document.getElementById("result-details")!;
const previewFinalEl = document.getElementById("preview-final-content")!;
const anotherBtn = document.getElementById("another-btn")!;

// ============================================================================
// State
// ============================================================================

const COUNTDOWN_SECONDS = 5;
let draftFilePath = "";
let countdownTimer: number | null = null;
let countdownPaused = false;
let countdownRemaining = COUNTDOWN_SECONDS;

// ============================================================================
// View helpers
// ============================================================================

function showOnly(el: HTMLElement) {
  composingEl.style.display = "none";
  draftEl.style.display = "none";
  savingEl.style.display = "none";
  resultEl.style.display = "none";
  el.style.display = "";
}

// ============================================================================
// Countdown
// ============================================================================

function startCountdown() {
  countdownRemaining = COUNTDOWN_SECONDS;
  countdownPaused = false;
  countdownBarEl.style.transition = "none";
  countdownBarEl.style.width = "100%";
  // Force reflow then animate
  void countdownBarEl.offsetWidth;
  countdownBarEl.style.transition = `width ${COUNTDOWN_SECONDS}s linear`;
  countdownBarEl.style.width = "0%";
  updateCountdownLabel();

  countdownTimer = window.setInterval(() => {
    if (countdownPaused) return;
    countdownRemaining -= 1;
    updateCountdownLabel();
    if (countdownRemaining <= 0) {
      clearCountdown();
      doSave();
    }
  }, 1000);
}

function pauseCountdown() {
  if (countdownPaused) return;
  countdownPaused = true;
  // Freeze the bar at current position
  const computed = getComputedStyle(countdownBarEl);
  countdownBarEl.style.transition = "none";
  countdownBarEl.style.width = computed.width;
  countdownLabelEl.textContent = "Countdown paused — edit your note, then save.";
}

function clearCountdown() {
  if (countdownTimer !== null) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

function updateCountdownLabel() {
  if (!countdownPaused) {
    countdownLabelEl.textContent = `Saving in ${countdownRemaining}s…`;
  }
}

// ============================================================================
// Save
// ============================================================================

async function doSave() {
  const title = editTitleEl.value;
  const content = editContentEl.value;
  const filePath = draftFilePath;

  showOnly(savingEl);

  try {
    const result = await app.callServerTool({
      name: "brain_inbox_save",
      arguments: { title, content, filePath },
    });
    showSaveResult(result);
  } catch (e) {
    console.error("Save failed:", e);
    showOnly(resultEl);
    resultIconEl.textContent = "❌";
    resultTitleEl.textContent = "Save failed";
    resultPathEl.textContent = "";
    resultDetailsEl.innerHTML = `<span class="status-fail">${escapeHtml(String(e))}</span>`;
  }
}

function showSaveResult(result: CallToolResult) {
  showOnly(resultEl);

  const structured = result.structuredContent as
    | { filePath?: string; r2?: boolean; github?: boolean; error?: string }
    | undefined;

  const text = result.content
    ?.filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n") ?? "";

  if (result.isError) {
    resultIconEl.textContent = "❌";
    resultTitleEl.textContent = "Save failed";
    resultPathEl.textContent = "";
    resultDetailsEl.innerHTML = `<span class="status-fail">${escapeHtml(text)}</span>`;
  } else if (structured) {
    const isPartial = structured.r2 && !structured.github;
    resultIconEl.textContent = isPartial ? "⚠️" : "✅";
    resultTitleEl.textContent = isPartial ? "Partially saved" : "Note saved";
    resultPathEl.textContent = structured.filePath ? `📄 ${structured.filePath}` : "";
    if (isPartial) {
      resultDetailsEl.innerHTML =
        `<span class="status-ok">R2 ✓</span> · <span class="status-fail">GitHub ✗ ${structured.error ? escapeHtml(structured.error) : ""}</span>`;
    } else {
      resultDetailsEl.innerHTML =
        `<span class="status-ok">R2 ✓</span> · <span class="status-ok">GitHub ✓</span>`;
    }
  } else {
    resultIconEl.textContent = "✅";
    resultTitleEl.textContent = "Note saved";
    resultPathEl.textContent = "";
    resultDetailsEl.textContent = text;
  }

  previewFinalEl.innerHTML = renderMarkdown(editContentEl.value);
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
    mainEl.style.padding = `${top}px ${right}px ${bottom}px ${left}px`;
  }
}

// ============================================================================
// MCP App
// ============================================================================

const app = new App({ name: "Brain Inbox Composer", version: "1.0.0" });

app.onerror = console.error;
app.onteardown = async () => {
  clearCountdown();
  return {};
};
app.onhostcontextchanged = handleHostContext;

// Streaming partial input — progressive note preview
app.ontoolinputpartial = (params) => {
  const args = params.arguments as { title?: string; content?: string } | undefined;
  if (!args) return;

  showOnly(composingEl);

  if (args.title) composeTitleEl.textContent = args.title;
  if (args.content) previewContentEl.innerHTML = renderMarkdown(args.content);
};

// Final input
app.ontoolinput = (params) => {
  const args = params.arguments as { title?: string; content?: string } | undefined;
  if (!args) return;
  if (args.title) composeTitleEl.textContent = args.title;
  if (args.content) previewContentEl.innerHTML = renderMarkdown(args.content);
};

// Tool result — draft received (not saved yet), start countdown
app.ontoolresult = (result: CallToolResult) => {
  // This fires for BOTH brain_inbox (compose) and brain_inbox_save.
  // brain_inbox returns structuredContent with title/content/filePath.
  // brain_inbox_save returns structuredContent with r2/github status.
  const structured = result.structuredContent as Record<string, unknown> | undefined;

  // If this is a save result (has r2 field), show save confirmation
  if (structured && "r2" in structured) {
    showSaveResult(result);
    return;
  }

  // Otherwise it's the compose draft — show editable preview with countdown
  const title = (structured?.title as string) ?? "";
  const content = (structured?.content as string) ?? "";
  draftFilePath = (structured?.filePath as string) ?? "";

  editTitleEl.value = title;
  editContentEl.value = content;

  showOnly(draftEl);
  startCountdown();
};

app.ontoolcancelled = () => {
  clearCountdown();
  composeTitleEl.textContent = "Cancelled";
};

// Pause countdown when user starts editing
editTitleEl.addEventListener("focus", pauseCountdown);
editContentEl.addEventListener("focus", pauseCountdown);
editTitleEl.addEventListener("input", pauseCountdown);
editContentEl.addEventListener("input", pauseCountdown);

// Save button
saveBtnEl.addEventListener("click", () => {
  clearCountdown();
  doSave();
});

// Cancel button
cancelBtnEl.addEventListener("click", () => {
  clearCountdown();
  showOnly(resultEl);
  resultIconEl.textContent = "🚫";
  resultTitleEl.textContent = "Note discarded";
  resultPathEl.textContent = "";
  resultDetailsEl.textContent = "The note was not saved.";
  previewFinalEl.innerHTML = "";
});

// "Save another note" button
anotherBtn.addEventListener("click", async () => {
  try {
    await app.sendMessage({
      role: "user",
      content: [{ type: "text", text: "Save another note to my brain inbox." }],
    });
  } catch (e) {
    console.error("sendMessage failed:", e);
  }
});

// Connect
app.connect().then(() => {
  const ctx = app.getHostContext();
  if (ctx) handleHostContext(ctx);
});
