# claude-azdev-skill

Azure DevOps sprint integration for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Connects your sprint backlog to your local repos — analyzes stories, generates project plans, executes work, and keeps Azure DevOps in sync.

## Quick overview

```
/azdev-setup            →  Connect to Azure DevOps (one-time)
/azdev-sprint           →  See your sprint backlog (default: your items, --all for everything)
/azdev-plan [story-id]   →  Analyze stories → pick repos → verify → generate plans
/azdev-execute [story-id] → Execute one story (interactive) or all stories (autonomous)
```

**The typical workflow:**
1. Run `/azdev-plan` — fetches your stories, asks which repo each belongs to, verifies your understanding, and generates project plans
2. Run `/azdev-execute` — works through the plan, writes code, and updates Azure DevOps as tasks get done

## What it does

1. **Connect** — Configure your Azure DevOps org, project, and Personal Access Token
2. **View sprint** — Fetch the current sprint backlog with stories, tasks, descriptions, and acceptance criteria
3. **Plan** — Run `/azdev-plan` to analyze stories, pick target repos, verify understanding with the user, update descriptions in Azure DevOps, and generate a story spec (`STORY.md`) in each target repo
4. **Execute** — Navigate to target repos and implement. Task status updates (New → Active → Resolved) are tracked via `azdev-task-map.json`

## Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI installed
- Node.js (no external dependencies — uses built-in modules only)
- An Azure DevOps Personal Access Token with these scopes:
  - `vso.project` — read project/iteration data
  - `vso.work` — read work items
  - `vso.work_write` — update work item state
  - `vso.code` — create pull requests via Azure DevOps REST API

## Installation

```bash
git clone <this-repo> && cd claude-azdev-skill
./install.sh
```

This copies commands and the helper script to `~/.claude/`. Restart Claude Code to pick up changes.

### Configure credentials

Run the setup command in any project directory:

```
/azdev-setup
```

This prompts for:
- **Organization URL** — e.g., `https://dev.azure.com/yourorg` or just `yourorg`
- **Project name** — your Azure DevOps project
- **PAT** — your Personal Access Token

Credentials are stored in `.planning/azdev-config.json` (PAT is base64-encoded). This file is project-local — add it to `.gitignore`.

### Verify connection

```
/azdev-test
```

Confirms your credentials work and have the required scopes.

## Commands

### `/azdev-setup`

Interactive setup wizard for Azure DevOps credentials. On re-run, shows current values (PAT masked) and lets you update individual fields.

### `/azdev-test`

Tests the stored credentials against the Azure DevOps API. Verifies both `vso.project` and `vso.work` scopes. Shows a clear success/failure message with suggested fixes.

### `/azdev-sprint`

Fetches and displays the current sprint backlog with ANSI-colored state indicators. Shows:
- Sprint name and dates
- User stories with description and acceptance criteria
- Tasks grouped under their parent story
- State (blue=Active, green=Resolved, etc.), assigned user, and other metadata

Defaults to showing only your assigned items (`--me`). Use `--all` to see the entire sprint.

### `/azdev-plan [story-id]`

The main analysis pipeline. Run without arguments to plan all assigned stories, or pass a story ID to plan a single story (e.g., `/azdev-plan 42920`). Already resolved stories are automatically skipped.

**What it does, step by step:**

1. **Fetch stories** — pulls your assigned stories from the current sprint via Azure DevOps API
2. **Pick repos** — lists Azure DevOps project repos and asks which one each story belongs to. Resolves the local clone path automatically (scans sibling directories of `$CWD`)
3. **Deep repo analysis** — for each story, searches the target repo for files matching story keywords, reads relevant code, traces call chains, and checks for existing feature branches
4. **Interactive verification** — presents its understanding of each story (summary, work type, repo analysis, tasks) and asks you to confirm or correct. If the story description is sparse, asks targeted follow-up questions instead of guessing
5. **Update Azure DevOps** — replaces the story description with the verified analysis (markdown format, revision history preserved)
6. **Generate story spec** — writes `STORY.md` to `{repoPath}/.planning/stories/{storyId}.md` with: goal, background, testable acceptance criteria, key files with paths, architecture/code flow, implementation notes, contacts, open questions, and out-of-scope items
7. **Self-review** — checks the generated spec against a quality checklist (specific goal, real file paths, traced code flow, no vague placeholders, blockers captured) and fixes issues before presenting
8. **User approval** — shows the full spec for approve/changes/skip
9. **Task map** — writes/merges `.planning/azdev-task-map.json` mapping story IDs → repos → task IDs for status tracking during execution

**Research mode:** Stories tagged with `research` in Azure DevOps get a deeper treatment — broader codebase exploration, a multi-round dialogue where you discuss findings and possible approaches together, and a STORY.md that includes a "Research Findings" section with problem analysis, approaches considered, and the agreed approach. Acceptance criteria focus on what to investigate or prototype rather than what to build.

### `/azdev-execute [story-id]`

Execute story plans. Two modes depending on arguments:

- **`/azdev-execute 42920`** — single story, interactive. Creates a feature branch, implements the story spec, resolves tasks, creates a PR. Asks for input on blockers.
- **`/azdev-execute`** — all stories, fully autonomous. Loops through every story in the task map without user interaction. Errors on one story don't block the next. Outputs a full summary with all PR links at the end.

PRs are created via the Azure DevOps REST API and automatically **linked to the story** via `workItemRefs`.

## Status tracking

The `azdev-task-map.json` file maps Azure DevOps task IDs to local repos. During execution, use `azdev-tools.cjs update-state` to transition tasks:

- **Start work** → set tasks to **Active**
- **Complete work** → set tasks to **Resolved**
- **Check story** → use `get-child-states` to verify all children are done before resolving the story

PRs are created via the Azure DevOps REST API and automatically linked to the parent story. Status updates require the `vso.work_write` PAT scope, and PR creation requires `vso.code`.

## Helper script CLI

The `azdev-tools.cjs` script handles all Azure DevOps API communication. It can be used standalone:

```bash
# Save/load credentials
node azdev-tools.cjs save-config --org <url> --project <name> --pat <token> --cwd <path>
node azdev-tools.cjs load-config --cwd <path>

# Test connection
node azdev-tools.cjs test --cwd <path>

# Sprint data
node azdev-tools.cjs get-sprint --cwd <path>
node azdev-tools.cjs get-sprint-items [--me] --cwd <path>

# Work item updates
node azdev-tools.cjs update-state --id <workItemId> --state <state> --cwd <path>
node azdev-tools.cjs update-description --id <workItemId> --description "<text>" --cwd <path>

# Child task state check (for story resolution logic)
node azdev-tools.cjs get-child-states --id <storyId> --cwd <path>

# Git branching
node azdev-tools.cjs create-branch --repo <path> --story-id <id> --title <title> [--base <branch>]

# Push and create PR (via Azure DevOps REST API, linked to story)
node azdev-tools.cjs create-pr --repo <path> --branch <name> --base <branch> --title <title> --body <body> --story-id <id> --cwd <path>

# List project repositories
node azdev-tools.cjs list-repos [--top <N>] --cwd <path>

# Display sprint board (fetch + render in one command)
node azdev-tools.cjs show-sprint [--me] --cwd <path>
```

All commands output JSON to stdout and use exit code 0/1 for success/failure.

## Project structure

```
claude-azdev-skill/
├── install.sh                     # One-command installer
├── bin/
│   └── azdev-tools.cjs          # Node.js helper — all Azure DevOps API calls
├── commands/
│   ├── azdev-setup.md            # /azdev-setup — credential configuration
│   ├── azdev-test.md             # /azdev-test — connection verification
│   ├── azdev-sprint.md           # /azdev-sprint — sprint backlog display
│   ├── azdev-plan.md             # /azdev-plan — story analysis & project bootstrap
│   └── azdev-execute.md          # /azdev-execute — story execution (single or all)
└── README.md
```

## Security

- PAT is stored base64-encoded in `.planning/azdev-config.json` — this is light obfuscation, not encryption
- Always add `azdev-config.json` to `.gitignore` — the setup command checks for this
- The PAT never leaves your local machine except in API calls to your Azure DevOps instance
- No external dependencies — the helper script uses only Node.js built-in modules (`https`, `fs`, `path`)

## License

MIT
