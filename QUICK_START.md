# QUICK_START.md - TL;DR Version

## What You're Building

A system that lets you ask Claude (mobile/web/desktop) questions about your private GitHub knowledge base, with semantic search.

## Files in This Guide

| File | Purpose |
|------|---------|
| `QUICK_START.md` | You are here - the summary |
| `PRE_FLIGHT_CHECKLIST.md` | **Do this first** - account setup |
| `SETUP_GUIDE.md` | Architecture overview |
| `CLAUDE.md` | **Copy to your repo** - instructions for Claude Code |
| `PROMPTS.md` | **Copy/paste prompts** into Claude Code |
| `TROUBLESHOOTING.md` | When things break |

## The Build Sequence

```
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 0: PREP (30 min, manual)                                 │
│  ├─ Create Cloudflare account, enable R2                        │
│  ├─ Create API tokens                                           │
│  ├─ Create GitHub repo for MCP server                           │
│  └─ Configure Claude Code with Cloudflare MCP                   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 1: CLOUDFLARE SETUP (via Claude Code)                    │
│  ├─ Prompt 1.1: Scaffold project                                │
│  ├─ Prompt 1.2: Create R2 bucket                                │
│  └─ Prompt 1.3: Create AI Search instance                       │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 2: MCP SERVER (via Claude Code)                          │
│  ├─ Prompt 2.1: Basic MCP server structure                      │
│  ├─ Prompt 2.2: Implement search_brain tool                     │
│  ├─ Prompt 2.3: Implement get_document tool                     │
│  ├─ Prompt 2.4: Implement list tools                            │
│  └─ Prompt 2.5: Test locally                                    │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 3: SYNC PIPELINE (via Claude Code)                       │
│  ├─ Prompt 3.1: Create GitHub Action                            │
│  └─ Prompt 3.2: Test the sync                                   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 4: PRODUCTION (via Claude Code)                          │
│  ├─ Prompt 4.1: Add OAuth                                       │
│  └─ Prompt 4.2: Deploy and connect to Claude.ai                 │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 5: POLISH (via Claude Code)                              │
│  ├─ Prompt 5.1: End-to-end test                                 │
│  ├─ Prompt 5.2: Error handling                                  │
│  └─ Prompt 5.3: Documentation                                   │
└─────────────────────────────────────────────────────────────────┘
```

## Speed Run (if you know what you're doing)

```bash
# 1. Prep (do manually)
# - Cloudflare account with R2 enabled
# - API tokens (Workers + R2)
# - GitHub repo created

# 2. Start Claude Code
git clone git@github.com:YOU/home-brain-mcp.git
cd home-brain-mcp
# Copy CLAUDE.md into this directory
claude

# 3. In Claude Code, paste prompts from PROMPTS.md in order
# Claude will build everything for you

# 4. Deploy
wrangler deploy

# 5. Add to Claude.ai
# Settings → Connectors → Add custom connector
# URL: https://home-brain-mcp.YOUR_SUBDOMAIN.workers.dev/sse
```

## Expected Time Investment

| Phase | Time | Who |
|-------|------|-----|
| Pre-flight checklist | 30 min | You |
| Phase 1-2 (Claude Code) | 1-2 hours | Claude Code |
| Phase 3 (Sync setup) | 30 min | Claude Code |
| Phase 4 (OAuth + deploy) | 30-60 min | Claude Code |
| Phase 5 (Testing) | 30 min | You + Claude Code |
| **Total** | **3-5 hours** | |

## Expected Cost

**Free tier covers everything** for personal use:
- R2: 10GB free
- Workers: 100K requests/day free  
- AI Search: Currently in beta (free)
- Workers AI: 10K neurons/day free

## What You Get

After completing this guide:

1. ✅ Your home-brain repo auto-syncs to Cloudflare
2. ✅ Content is automatically embedded for semantic search
3. ✅ Claude mobile/web/desktop can search your knowledge base
4. ✅ You can ask "What did I write about X?" and get answers
5. ✅ Full document retrieval when you need it
6. ✅ Browse your knowledge base structure

## Next Steps After Building

- Add more content to your home-brain
- Fine-tune the system prompt in AI Search
- Add more MCP tools as needed
- Consider adding caching for frequent queries
