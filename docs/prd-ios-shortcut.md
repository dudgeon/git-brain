# PRD: Save to Brain iOS Shortcut

**Status:** Draft
**Date:** 2026-02-14
**Version:** v5.3 candidate

---

## Problem

The desktop bookmarklet doesn't work on mobile Safari. iOS users have no reliable way to save web content to their brain. The current `/bookmarklet` page includes manual instructions for building an iOS Shortcut from scratch (6 steps), which is cumbersome and error-prone.

The Web Share Target API (which would let a PWA appear in the share sheet) is [not supported by Safari/WebKit](https://bugs.webkit.org/show_bug.cgi?id=194593) and has no implementation timeline.

## Solution

A **pre-built iOS Shortcut** distributed via iCloud link that:
1. Appears in the native iOS **share sheet** (Safari, Twitter, YouTube, any app)
2. Sends the shared URL + title to `POST /api/clip`
3. Optionally prompts for a context note
4. Shows a success/failure notification

No app to install. No App Store review. Works on iOS 15+.

## User Journey

### First-time setup (~60 seconds)

1. User visits `/save` on their iPhone (linked from OAuth success page)
2. Page shows their bearer token with a **Copy** button
3. User taps **"Add Shortcut"** → opens iCloud link → Shortcuts app
4. Taps **"Add Shortcut"** in the Shortcuts app
5. Shortcut opens → prompts "Paste your Brainstem token" → user pastes
6. Token is saved to device. Setup complete.

### Ongoing usage (~3 seconds)

1. User is reading an article, tweet, video, etc.
2. Taps the **Share** button (native iOS share sheet)
3. Taps **"Save to Brain"** in the share sheet
4. Optional: types a brief context note (or taps Skip)
5. Notification: "Saved to brain!" (or error message)

## Shortcut Design

### Trigger
- **Share Sheet** accepting: URLs, Text

### Actions (pseudocode)

```
1. Read token from file "Shortcuts/Brainstem/token.txt"
2. IF token is empty:
     a. Ask for Input: "Paste your Brainstem token"
     b. Save Input to file "Shortcuts/Brainstem/token.txt"
     c. Set token = Input
3. SET url = Shortcut Input (from share sheet)
4. SET title = Get Name of [url]
5. Ask for Input: "Add a note (optional)" [default: empty]
6. SET context = Input (may be empty)
7. Get Contents of URL:
     URL: https://brainstem.cc/api/clip
     Method: POST
     Headers:
       Authorization: Bearer [token]
       Content-Type: application/json
     Body (JSON):
       url: [url]
       title: [title]
       context: [context]  (omit if empty)
8. IF response contains "ok": true
     Show Notification: "Saved to brain!"
   ELSE
     Show Notification: "Error: [error message]"
```

### Token Storage

The bearer token is stored in a text file at `Shortcuts/Brainstem/token.txt` in the device's iCloud Drive (Shortcuts folder). This:
- Persists across shortcut updates (iCloud link re-imports won't erase it)
- Is accessible only to the Shortcuts app
- Survives device restarts

### Error Handling

| Scenario | Behavior |
|----------|----------|
| No token stored | Prompt to enter token |
| 401 Unauthorized | Show "Token expired — visit brainstem.cc/save to get a new one" |
| Network error | Show "Couldn't reach Brainstem — check your connection" |
| 413 / 500 | Show error message from server response |

## Server Changes

### New: `GET /save` page

Replaces (or supplements) the current `/bookmarklet` page with a mobile-optimized page:

- **Desktop visitors:** Shows the bookmarklet drag-to-install (existing behavior)
- **Mobile visitors:** Shows:
  1. Bearer token with Copy button (auto-detected from auth)
  2. "Add Shortcut" button (links to iCloud shortcut)
  3. Brief setup instructions (3 steps: copy token → add shortcut → paste token)

The page requires authentication (bearer token via cookie or session). Unauthenticated visitors are redirected to OAuth.

**Implementation:** This is a new route handler in `src/index.ts` that detects mobile via User-Agent and renders the appropriate content. The existing `/bookmarklet` route can redirect to `/save`.

### Changes to `/api/clip`

None required. The existing endpoint already handles:
- URL-only saves (just `{ url }` with optional `title` and `context`)
- Bearer token authentication
- CORS headers
- Error responses with `{ ok: false, error: "..." }`

### Changes to OAuth success page

Add a callout: "On iPhone? Visit brainstem.cc/save to set up Save to Brain in your share sheet."

## Distribution

### iCloud Link (primary)

1. Create the shortcut manually on a Mac/iPhone
2. Share via "Copy iCloud Link" → produces `https://www.icloud.com/shortcuts/...`
3. This URL is permanent and publicly accessible
4. Embed on `/save` page and OAuth success page

### Why not dynamic .shortcut generation?

Since iOS 15, `.shortcut` files must be signed with Apple's toolchain. Programmatic generation would require:
- A Mac server running the `shortcuts sign` CLI (or Cherri compiler)
- Apple signing identity management
- Risk of Apple revoking the signing identity

The static iCloud link approach is simpler, more reliable, and follows Apple's intended distribution model.

### Shortcut Updates

If we need to update the shortcut logic:
1. Edit the shortcut on device
2. Re-share via iCloud (generates a new link)
3. Update the link on `/save` page
4. Existing users keep the old version (no auto-update)
5. Can prompt users to update via a version check (future enhancement)

## Content Extraction

The shortcut sends **URL-only** saves to `/api/clip`. The server saves a bookmark-style note with frontmatter:

```yaml
---
source: clip
url: https://example.com/article
date: 2026-02-14
title: Example Article
context: interesting take on X  # if provided
---

# Example Article

Clipped from [example.com](https://example.com/article)
```

**Why not extract article content?**
- Cloudflare Workers have no browser DOM — can't run Readability server-side
- The Shortcuts app has no JavaScript execution for content extraction
- URL-only bookmarks are still valuable — the URL is preserved and searchable
- Full extraction remains available via the desktop bookmarklet

**Future:** Cloudflare Browser Rendering could enable server-side extraction. This would be a separate enhancement.

## Scope

### In scope (v5.3)
- Pre-built iOS Shortcut (manual creation, iCloud distribution)
- `/save` page with mobile detection, token display, and shortcut link
- Updated OAuth success page with mobile callout
- Redirect `/bookmarklet` → `/save`

### Out of scope
- Dynamic shortcut generation / signing
- PWA (mobile brain interface — separate backlog item)
- Server-side content extraction
- Android support (Web Share Target PWA — separate backlog item)
- Shortcut auto-update mechanism

## Success Criteria

1. User can install the shortcut from `/save` in under 60 seconds
2. Saving a URL from Safari share sheet takes under 5 seconds
3. Saved clips appear in brain search results within 2 minutes
4. Works on iOS 15+ (iPhone and iPad)

## Implementation Sequence

1. **Create the shortcut** manually on a Mac/iPhone, test end-to-end against prod `/api/clip`
2. **Share via iCloud** to get the permanent link
3. **Build `/save` page** — mobile-optimized, shows token + shortcut link + instructions
4. **Update OAuth success page** — add mobile callout
5. **Redirect `/bookmarklet` → `/save`**
6. **Update CLAUDE.md and backlog**

## Decisions

1. **Shortcut name:** "Save to Brain" — clear and descriptive in the share sheet
2. **Context note UX:** Simple "Add a note (optional)" prompt — no title confirmation
3. **Token expiry:** Friendly error message ("Token expired — visit brainstem.cc/save to get a new one"). Token refresh mechanism deferred to backlog.

## References

- [Web Share Target API — WebKit Bug #194593](https://bugs.webkit.org/show_bug.cgi?id=194593) (unimplemented)
- [WebKit standards position: neutral with concerns](https://github.com/WebKit/standards-positions/issues/11)
- [Shortcuts File Format Documentation](https://zachary7829.github.io/blog/shortcuts/fileformat)
- [Cherri — Shortcuts programming language](https://cherrilang.org/)
- [Apple: Share Sheet in Shortcuts](https://support.apple.com/guide/shortcuts/apd163eb9f95/ios)
- Existing: `POST /api/clip` endpoint, `/bookmarklet` page
