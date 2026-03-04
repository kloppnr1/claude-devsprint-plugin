# claude-azdev-skill

Azure DevOps sprint integration for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). View your sprint backlog, analyze user stories, generate project plans, and update work item status — all from the terminal.

## What it does

- **`/azdev-setup`** — Configure your Azure DevOps connection
- **`/azdev-sprint`** — View the current sprint backlog
- **`/azdev-analyze`** — Analyze your stories, review code changes, and generate project plans
- **`/azdev-execute`** — Execute project plans and update task status in Azure DevOps

## Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI
- Node.js 18+ (no npm dependencies — uses built-in modules only)
- Azure DevOps PAT with scopes: `vso.project`, `vso.work`, `vso.work_write`, `vso.code`

## Installation

```bash
# Clone the repo
git clone https://github.com/kloppnr1/claude-azdev-skill.git

# Copy commands to Claude Code
cp claude-azdev-skill/commands/azdev-*.md ~/.claude/commands/

# Copy helper script
mkdir -p ~/.claude/azdev-skill/bin
cp claude-azdev-skill/bin/azdev-tools.cjs ~/.claude/azdev-skill/bin/
```

Restart Claude Code. The `/azdev-*` commands are now available.

## Usage

```
/azdev-setup           # First time: configure credentials
/azdev-sprint          # View current sprint backlog
/azdev-analyze         # Analyze stories and generate project plans
/azdev-execute         # Execute a plan and update task status
```

## How it works

- **Command files** (`.md`) in `commands/` define Claude Code slash commands that orchestrate the workflow
- **Helper script** (`bin/azdev-tools.cjs`) handles all Azure DevOps REST API v7.1 calls — pure Node.js, zero dependencies
- **Config** is project-local at `.planning/azdev-config.json`

```
claude-azdev-skill/
├── bin/
│   └── azdev-tools.cjs       # Azure DevOps API helper
├── commands/
│   ├── azdev-setup.md         # /azdev-setup
│   ├── azdev-test.md          # /azdev-test
│   ├── azdev-sprint.md        # /azdev-sprint
│   ├── azdev-analyze.md       # /azdev-analyze
│   └── azdev-execute.md       # /azdev-execute
├── LICENSE
└── README.md
```

## Security

- PAT is base64-encoded (not encrypted) in `.planning/azdev-config.json`
- Always add `azdev-config.json` to `.gitignore`
- No external dependencies — only Node.js built-ins (`https`, `fs`, `path`)

## License

MIT
