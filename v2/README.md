# claude-devsprint-plugin v2

> **Your agent finally (kinda) knows your project.**

Claude-devsprint-plugin v2 adds **persistent project memory** to Claude Code. Your architecture decisions, coding conventions, and sprint progress survive every session reset, context compaction, and model update.

---

## The Problem

Every new Claude session starts from zero. You spend 15–30 minutes re-explaining your architecture, your naming conventions, why you made certain decisions, and where you left off. Your agent has goldfish memory — and it's costing you an hour of productivity every day.

---

## The Fix

A `sprint-context.md` file that lives in your project root and gets automatically loaded at the start of every Claude session. Claude reads it. Claude remembers. You stop re-explaining.

Four slash commands keep it fresh:

| Command | What it does |
|---------|-------------|
| `/sprint-init` | One-time setup — answers a few questions, creates your context file |
| `/sprint-update` | Update after a session — captures what was done and decided |
| `/sprint-status` | Quick summary — what's in progress, blocked, and coming up |
| `/sprint-reset` | New sprint — archives old context, carries forward permanent knowledge |

---

## How It Works

```
Your Project/
├── CLAUDE.md                    ← tells Claude to load sprint context
├── sprint-context.md            ← your persistent project memory
└── ... rest of your project
```

`CLAUDE.md` contains `@sprint-context.md`. Claude Code reads `CLAUDE.md` automatically at session start, which imports `sprint-context.md`. No prompt engineering. No copy-pasting. Just open Claude and start working.

---

## What Gets Remembered

**Architecture Decisions** — what you chose, why, and what you rejected. Claude stops suggesting approaches you've already ruled out.

**Coding Conventions** — naming patterns, error handling, test structure, style rules. Claude writes code that looks like yours.

**Active Sprint** — what's in progress, blocked, and up next. Claude knows where you left off.

**Project Rules** — hard constraints Claude must never violate. The things that cause real damage when an agent gets them wrong.

**Session Notes** — last 3 sessions, auto-maintained. Continuity across context resets.

---

## Installation

```bash
git clone https://github.com/kloppnr1/claude-devsprint-plugin
cd claude-devsprint-plugin
./install.sh
```

Or one-liner (when hosted):

```bash
curl -fsSL https://raw.githubusercontent.com/kloppnr1/claude-devsprint-plugin/main/install.sh | bash
```

---

## Quick Start

```
1. Open Claude Code in your project directory
2. Run: /sprint-init
3. Answer 7 questions about your project (~5 minutes)
4. Claude creates sprint-context.md and updates CLAUDE.md

From now on: every session starts with full project context.
```

---

## Keeping Context Fresh

**After a working session:**
```
/sprint-update
```
Claude looks at what was done in the conversation and updates the context file automatically.

**At the start of a new sprint:**
```
/sprint-reset
```
Archives the old sprint (preserving architecture decisions and project rules), creates a clean slate for the new sprint.

**Quick check:**
```
/sprint-status
```
See what's in progress, blocked, and coming up without opening the full context file.

---

## What's in `sprint-context.md`

The context document has six sections:

```markdown
# Sprint Context: My Project

## Project Overview
What the project does + tech stack + repo layout

## Architecture Decisions
Table of key choices, rationale, and rejected alternatives

## Coding Conventions
Naming, error handling, testing, style

## Active Sprint
In progress / Blocked / Up next / Done this sprint

## Project Rules
Hard constraints — things Claude must never do

## Session Notes
Auto-maintained by /sprint-update. Last 3 sessions.
```

---

## Compatibility

- **Claude Code** — works with any version that supports `CLAUDE.md` imports (`@filename`)
- **Works standalone** — no Azure DevOps or GitHub required
- **Works alongside v1** — if you use the original devsprint commands (for Azure DevOps sprint management), v2 adds context persistence on top; both sets of commands coexist

---

## v1 vs v2

| Feature | v1 | v2 |
|---------|----|----|
| Azure DevOps sprint management | ✓ | ✓ (unchanged) |
| GitHub integration | ✓ | ✓ (unchanged) |
| Persistent project memory | ✗ | ✓ (new) |
| Architecture decision tracking | ✗ | ✓ (new) |
| Cross-session context | ✗ | ✓ (new) |
| Works without DevOps integration | ✗ | ✓ (new) |

---

## What's Missing (Roadmap to v1.0)

- [ ] **Hook-based auto-update** — automatically prompt `/sprint-update` when a session ends (requires Claude Code Stop hook support for file writes)
- [ ] **MCP server mode** — structured context management via MCP for richer querying and diffs
- [ ] **Context health scoring** — warn when context is stale or incomplete
- [ ] **Team context sharing** — commit `sprint-context.md` to git and let the team's agents share it
- [ ] **Context compression** — automatically summarize and compress session notes when they get long
- [ ] **Integration with v1 DevOps commands** — auto-sync sprint items from Azure DevOps into sprint-context.md

---

## Philosophy

This is deliberately minimal. A markdown file that gets read at session start. No database, no server, no sync. The complexity is in the discipline of keeping it updated — which the slash commands make easy.

The goal isn't to solve the memory problem perfectly. It's to solve it *enough* that you stop losing 30 minutes per session to re-explaining your project.

---

*Part of [claude-devsprint-plugin](https://github.com/kloppnr1/claude-devsprint-plugin)*
