# claude-devsprint-plugin

An Azure DevOps plugin for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) that turns your sprint backlog into working code.

Point it at your sprint, and it will read your stories, analyze the relevant repos, write implementation plans, generate code, create PRs, and resolve tasks — all without leaving your terminal. Run `/devsprint-execute` and walk away. Come back to pull requests linked to your stories, tasks marked as resolved, and a summary of everything it did.
Your sprint board stays in sync because the plugin updates it as it works.

## What can it do?

- **View your sprint** from the terminal — stories, tasks, state, descriptions, all color-coded
- **Create stories and tasks** from natural language — just describe what you need
- **Analyze stories** — reads the target repo, traces code paths, identifies the files that need changes, and writes a detailed implementation spec
- **Execute stories autonomously** — creates a feature branch, writes the code, runs tests, commits, pushes, creates a PR linked to the story, and resolves all tasks
- **Batch mode** — run `/devsprint-execute` with no arguments and it loops through every story in your sprint. Errors on one story don't block the next
- **Fix PR comments** — `/devsprint-pr-fix <story-id>` fetches review comments, fixes them, and pushes

Zero external dependencies. Just Node.js built-ins and the Azure DevOps REST API.

## What it looks like

### View your sprint board

```
> /devsprint-sprint

━━━ Sprint: Sprint 12 ━━━
Dates:     2026-03-02 → 2026-03-13
Items:     8

┌─ [US] #1201 — Add price area column to customer list
│  State: ACTIVE  │  Assigned: Alex Chen
│
│   ■ #1202 — Backend: Add price area field to API response  [DONE]
│   ■ #1203 — Frontend: Display price area in customer table [NEW]
│   ■ #1204 — Tests: Price area resolution logic             [NEW]
└──────

┌─ [US] #1205 — CSV export of customer data
│  State: NEW  │  Assigned: Alex Chen
│
│   ■ #1206 — Backend: CSV endpoint                          [NEW]
│   ■ #1207 — Frontend: Download button                      [NEW]
│   ■ #1208 — Tests: CSV generation                          [NEW]
└──────
```

### Create stories from natural language

```
> /devsprint-create Add CSV export: 1) Backend endpoint 2) Frontend button 3) Tests

Creating:
  [User Story] "Add CSV export of customer data"
    [Task] "Backend: Create CSV endpoint"
    [Task] "Frontend: Add download button"
    [Task] "Tests: CSV generation and download"

╔══════════════════════════════════════════╗
║  Story #1205 created                     ║
╚══════════════════════════════════════════╝

  ✓ #1205 [User Story] "Add CSV export of customer data"
    ✓ #1206 [Task] "Backend: Create CSV endpoint"
    ✓ #1207 [Task] "Frontend: Add download button"
    ✓ #1208 [Task] "Tests: CSV generation and download"

Sprint: Sprint 12

Next step: /devsprint-plan 1205 to analyze and create spec.
```

### Plan a story — analyze repo, generate spec

```
> /devsprint-plan 1205

=== Analysis: Sprint 12 ===

#1205 → ContosoCRM (from task map)

### #1205 — CSV export of customer data (New)

My understanding:
  Export customer data as CSV from the web portal. Backend endpoint
  returns CSV with configurable columns, frontend adds download button.

Work type: Code change
Target repo: ContosoCRM

Repo analysis:
  Tech stack: C# / .NET 8 + React 18 / TypeScript
  Key files:
    src/Api/Controllers/CustomerController.cs — existing customer endpoints
    src/Api/Services/CustomerService.cs — business logic
    src/Web/components/CustomerList.tsx — customer table component
  Code flow: CustomerController → CustomerService → CustomerRepository

STORY.md written to ContosoCRM/.planning/stories/1205.md

Changes?
> ok

Planning complete. Run /devsprint-execute 1205 to implement.
```

### Execute — autonomous implementation

```
> /devsprint-execute

╔══════════════════════════════════════════════════════╗
║              Pre-flight Status Check                 ║
╚══════════════════════════════════════════════════════╝

Already completed:
  ✓ #1201 — Add price area column to customer list
    Executed: 2026-03-07 | PR: https://dev.azure.com/.../pullrequest/891

Will execute:
  → #1205 — CSV export of customer data
    State: New | Tasks: 0/3 done | Repo: ContosoCRM

Summary: 1 to execute, 1 already done

━━━ [1/1] Story #1205 — CSV export of customer data ━━━

  Baseline tests green — proceeding.
  Created branch feature/1205-csv-export from develop

  Task status updates:
    #1206 (Backend: CSV endpoint): Active ✓
    #1207 (Frontend: Download button): Active ✓
    #1208 (Tests: CSV generation): Active ✓

  ... implementing ...

  Task resolution:
    #1206 (Backend: CSV endpoint): Resolved ✓
    #1207 (Frontend: Download button): Resolved ✓
    #1208 (Tests: CSV generation): Resolved ✓

  Story #1205 resolved ✓

╔══════════════════════════════════════════╗
║           Execution Complete             ║
╚══════════════════════════════════════════╝

  ✓ #1205 — CSV export of customer data
     Branch: feature/1205-csv-export
     Tasks: 3/3 resolved
     Tests: 14 passed, 0 failed (dotnet test) — all passed
     Story: Resolved ✓
     PR: https://dev.azure.com/.../pullrequest/894
```

## Quick start

```
/devsprint-setup              →  Connect to Azure DevOps (one-time)
/devsprint-sprint             →  See your sprint board
/devsprint-create <description> → Create stories & tasks from natural language
/devsprint-plan [story-id]    →  Analyze stories → generate specs
/devsprint-execute [story-id] →  Implement, commit, push, create PR, resolve tasks
/devsprint-pr-fix <story-id>  →  Fix PR review comments automatically
```

**The typical workflow:**
1. `/devsprint-sprint` — see what's in the sprint
2. `/devsprint-create` — add missing stories or tasks (optional)
3. `/devsprint-plan` — analyze stories, auto-detect repos, generate implementation specs
4. `/devsprint-execute` — implement everything, create PRs, resolve tasks automatically

## Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI installed
- Node.js (no external dependencies — uses built-in modules only)
- An Azure DevOps Personal Access Token with these scopes:
  - `vso.project` — read project/iteration data
  - `vso.work` — read work items
  - `vso.work_write` — create/update work items
  - `vso.code` — create pull requests

## Installation

```bash
git clone https://github.com/kloppnr1/claude-devsprint-plugin.git
cd claude-devsprint-plugin
./install.sh
```

This copies commands and the helper script to `~/.claude/`. Restart Claude Code to pick up changes.

### Configure credentials

Run the setup command in any project directory:

```
/devsprint-setup
```

This prompts for:
- **Organization URL** — e.g., `https://dev.azure.com/yourorg` or just `yourorg`
- **Project name** — your Azure DevOps project
- **PAT** — your Personal Access Token
- **Team** — auto-detected from the project's team list (you pick from options)
- **Area path** — auto-resolved from your team's settings (no manual input needed)

Team and area ensure that new work items land in the right place on the board. Credentials are stored in `.planning/devsprint-config.json` (PAT is base64-encoded). This file is project-local — add it to `.gitignore`.

### Verify connection

```
/devsprint-test
```

Confirms your credentials work and have the required scopes.

## Commands

### `/devsprint-setup`

Interactive setup wizard for Azure DevOps credentials. On re-run, shows current values (PAT masked) and lets you update individual fields.

### `/devsprint-test`

Tests the stored credentials against the Azure DevOps API. Verifies both `vso.project` and `vso.work` scopes. Shows a clear success/failure message with suggested fixes.

### `/devsprint-sprint`

Fetches and displays the current sprint backlog with ANSI-colored state indicators. Shows:
- Sprint name and dates
- User stories with description and acceptance criteria
- Tasks grouped under their parent story
- State (blue=Active, green=Resolved, etc.), assigned user, and other metadata

Defaults to showing only your assigned items (`--me`). Use `--all` to see the entire sprint.

### `/devsprint-create <description>`

Create stories and tasks from a natural language description. Parses your intent, creates work items via the Azure DevOps API — all assigned to the current sprint.

Examples:
- `/devsprint-create Add notification preferences page` — creates a single User Story
- `/devsprint-create Add CSV export: 1) Backend endpoint 2) Frontend button 3) Tests` — creates a story with 3 tasks
- `/devsprint-create Add tasks to #1205: write tests, update docs` — creates tasks under an existing story

### `/devsprint-plan [story-id]`

The main analysis pipeline. Run without arguments to plan all assigned stories, or pass a story ID to plan a single story (e.g., `/devsprint-plan 1205`). Already resolved stories are automatically skipped. Previously analyzed stories are skipped unless `--reanalyze` is passed.

**What it does, step by step:**

1. **Fetch stories** — pulls your assigned stories from the current sprint via Azure DevOps API
2. **Auto-detect repos** — checks task map history, sibling directories, and project repos. Only asks the user when auto-detection fails (first time for a new repo)
3. **Deep repo analysis** — for each story, searches the target repo for files matching story keywords, reads relevant code, traces call chains, and checks for existing feature branches
4. **Show analysis** — presents its understanding of each story (summary, work type, repo analysis, tasks). Non-research stories continue automatically; research stories get an interactive dialogue
5. **Update Azure DevOps** — replaces the story description and acceptance criteria with the verified analysis (see warning below)
6. **Generate story spec** — writes `STORY.md` to `{repoPath}/.planning/stories/{storyId}.md` with: goal, background, testable acceptance criteria, key files with paths, architecture/code flow, implementation notes, contacts, open questions, and out-of-scope items
7. **Self-review** — checks the generated spec against a quality checklist (specific goal, real file paths, traced code flow, no vague placeholders, blockers captured) and fixes issues before presenting
8. **Spec review** — shows the full spec and asks "Changes?" — type corrections or "ok" to continue
9. **Post to Azure DevOps** — adds a summary of the approved spec as a comment on the story
10. **Task map** — writes/merges `.planning/devsprint-task-map.json` mapping story IDs → repos → task IDs for status tracking during execution

> **Warning: Azure DevOps fields are overwritten.** By default, `/devsprint-plan` **replaces** the Description and Acceptance Criteria fields on each story with its verified analysis. Azure DevOps keeps revision history, so nothing is lost — but the original text is no longer visible without checking the history. If you want to keep the original fields untouched, add `--no-devops-update` to skip all Azure DevOps writes (description, acceptance criteria, and comments). The local STORY.md spec is still generated.

**Research mode:** Stories tagged with `research` in Azure DevOps get a deeper treatment — broader codebase exploration, a multi-round dialogue where you discuss findings and possible approaches together, and a STORY.md that includes a "Research Findings" section with problem analysis, approaches considered, and the agreed approach.

### `/devsprint-execute [story-id]`

Execute story plans. Two modes depending on arguments:

- **`/devsprint-execute 1205`** — single story. Creates a feature branch, implements the story spec, resolves tasks, creates a PR. Mostly autonomous — only asks for input on items explicitly marked as blocking in the spec.
- **`/devsprint-execute`** — all stories, fully autonomous. Loops through every story in the task map without user interaction. Errors on one story don't block the next. Outputs a full summary with all PR links at the end.

PRs are created via the Azure DevOps REST API and automatically linked to the story via `workItemRefs`.

### `/devsprint-pr-fix <story-id>`

Fix PR review comments. Takes a story ID, finds the matching PR automatically (by title prefix `#{storyId}`), fetches unresolved review comments, checks out the PR branch, fixes all issues, runs tests, and pushes.

```
/devsprint-pr-fix 1205
```

## Helper script CLI

The `devsprint-tools.cjs` script handles all Azure DevOps API communication. It can be used standalone:

```bash
# Credentials
node devsprint-tools.cjs save-config --org <url> --project <name> --pat <token> [--team <team>] [--area <area>] --cwd <path>
node devsprint-tools.cjs load-config --cwd <path>
node devsprint-tools.cjs test --cwd <path>

# Teams & areas
node devsprint-tools.cjs list-teams --cwd <path>
node devsprint-tools.cjs get-team-area --team "<team name>" --cwd <path>

# Sprint
node devsprint-tools.cjs get-sprint --cwd <path>
node devsprint-tools.cjs get-sprint-items [--me] --cwd <path>
node devsprint-tools.cjs show-sprint [--me] --cwd <path>

# Work items
node devsprint-tools.cjs create-work-item --type <type> --title "<title>" [--description "<html>"] [--parent <id>] [--sprint] [--assigned-to "<name>"] [--area "<path>"] [--tags "<tags>"] --cwd <path>
node devsprint-tools.cjs update-state --id <workItemId> --state <state> --cwd <path>
node devsprint-tools.cjs update-description --id <workItemId> --description "<text>" --cwd <path>
node devsprint-tools.cjs update-acceptance-criteria --id <workItemId> --criteria "<html>" --cwd <path>
node devsprint-tools.cjs get-child-states --id <storyId> --cwd <path>

# Comments
node devsprint-tools.cjs add-comment --id <workItemId> --text "<html>" --cwd <path>
node devsprint-tools.cjs delete-comment --id <workItemId> --comment-id <commentId> --cwd <path>

# Git
node devsprint-tools.cjs create-branch --repo <path> --story-id <id> --title <title> [--base <branch>]
node devsprint-tools.cjs create-pr --repo <path> --branch <name> --base <branch> --title <title> --body <body> --story-id <id> --cwd <path>

# Pull requests
node devsprint-tools.cjs find-pr --story-id <id> --cwd <path>              # Find PR by story ID (searches all repos)
node devsprint-tools.cjs get-pr --pr-id <id> [--repo-name <name>] --cwd <path>  # Fetch PR details
node devsprint-tools.cjs get-pr-threads --pr-id <id> [--repo-name <name>] [--active-only] --cwd <path>

# Repositories
node devsprint-tools.cjs list-repos [--top <N>] --cwd <path>
node devsprint-tools.cjs get-branch-links --id <workItemId> --cwd <path>
```

All commands output JSON to stdout and use exit code 0/1 for success/failure.

## Project structure

```
claude-devsprint-plugin/
├── install.sh                     # One-command installer
├── bin/
│   └── devsprint-tools.cjs          # Node.js helper — all Azure DevOps API calls
├── commands/
│   ├── devsprint-setup.md            # /devsprint-setup — credential configuration
│   ├── devsprint-test.md             # /devsprint-test — connection verification
│   ├── devsprint-sprint.md           # /devsprint-sprint — sprint backlog display
│   ├── devsprint-create.md           # /devsprint-create — create stories & tasks
│   ├── devsprint-plan.md             # /devsprint-plan — story analysis & spec generation
│   ├── devsprint-execute.md          # /devsprint-execute — story execution & PR creation
│   └── devsprint-pr-fix.md           # /devsprint-pr-fix — fix PR review comments
├── CONTRIBUTING.md
└── README.md
```

## Security

- PAT is stored base64-encoded in `.planning/devsprint-config.json` — this is light obfuscation, not encryption
- Always add `devsprint-config.json` to `.gitignore` — the setup command checks for this
- The PAT never leaves your local machine except in API calls to your Azure DevOps instance
- No external dependencies — the helper script uses only Node.js built-in modules (`https`, `fs`, `path`)

## License

MIT
