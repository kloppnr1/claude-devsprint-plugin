# PlanningMe

## What This Is

A set of GSD skills that integrate with Azure DevOps, enabling AI-assisted sprint task management. The skills pull user stories and tasks from the current sprint, analyze and break them down into technical plans, and eventually execute them — all within the GSD workflow.

## Core Value

Seamlessly bridge Azure DevOps sprint tasks into GSD's planning and execution engine so the user can go from "pick a task" to "analyzed and planned" with minimal friction.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Connect to Azure DevOps REST API using a Personal Access Token
- [ ] Fetch user stories and tasks from the current sprint
- [ ] Display sprint backlog with relevant details (title, description, acceptance criteria, state)
- [ ] Select one or more tasks for AI analysis
- [ ] AI analyzes selected tasks and produces a technical breakdown
- [ ] Map tasks to local repos (ask user first time, remember mapping)
- [ ] Update task status in Azure DevOps (e.g. New → Active → Closed)

### Out of Scope

- Web UI or standalone application — this is purely GSD skills
- MCP server — all DevOps interaction via helper scripts within skills
- Full code execution and PR creation — deferred to v2 after analysis flow is validated
- Multi-user support — personal tool for one developer
- Cross-repo tasks — each task maps to exactly one repo

## Context

- User has multiple projects/repos in Azure DevOps with varied tech stacks
- All repos are cloned locally; GSD needs to know which local path maps to which DevOps project
- User has PAT (Personal Access Token) for Azure DevOps API access
- Built as GSD skills (new `/gsd:` commands) with a Node.js helper script (`azdo-tools.cjs` or similar) for API calls
- Follows GSD's existing patterns: skills in `~/.claude/get-shit-done/`, helper scripts in `bin/`

## Constraints

- **Tech stack**: Node.js for helper scripts (consistent with existing GSD tooling)
- **API**: Azure DevOps REST API v6+
- **Auth**: Personal Access Token (PAT) stored securely
- **Architecture**: GSD skill files + shared helper script, no external dependencies beyond Node.js built-ins

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Pure GSD skills (no MCP server) | Simpler architecture, stays within GSD ecosystem | — Pending |
| v1 = fetch + analyze only | Validate the analysis flow before adding code execution/PR creation | — Pending |
| Ask-and-remember for repo mapping | Flexible, no upfront config needed, adapts as new projects appear | — Pending |
| Node.js helper script for API | Consistent with existing `gsd-tools.cjs` pattern | — Pending |

---
*Last updated: 2026-03-04 after initialization*
