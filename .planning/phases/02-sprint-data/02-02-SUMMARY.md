---
phase: 02-sprint-data
plan: "02"
subsystem: api
tags: [azure-devops, gsd-skill, sprint, terminal-formatting, claude-slash-command]

# Dependency graph
requires:
  - phase: 02-sprint-data
    plan: "01"
    provides: get-sprint and get-sprint-items CLI commands in azdo-tools.cjs
provides:
  - /gsd:azdo-sprint skill command for viewing current sprint backlog in terminal
  - Grouped work item display (parent stories with child tasks indented)
  - HTML-free formatted sprint output with type abbreviations (US, Task, Bug)
affects: [future sprint-based planning phases, any phase needing sprint context in Claude Code]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "GSD skill files in ~/.claude/commands/gsd/ — infrastructure not committed to project repo"
    - "Skill calls azdo-tools.cjs CLI via Bash tool, parses JSON stdout, formats for terminal"
    - "Work item grouping: top-level items (no parentId) rendered first, children indented under parent; orphaned tasks (parentId not in sprint) promoted to top-level"
    - "Type abbreviation map: User Story -> US, Task -> Task, Bug -> Bug, others use full type name"

key-files:
  created:
    - "~/.claude/commands/gsd/azdo-sprint.md"
  modified: []

key-decisions:
  - "Skill file lives in GSD infrastructure (not project repo) consistent with azdo-setup.md and azdo-test.md conventions established in Phase 1"
  - "Orphaned tasks (parentId references item not in sprint) promoted to top-level rather than dropped — prevents data loss in partial sprint views"
  - "Description truncated to 3 lines with '...' to keep terminal output scannable without losing context"

patterns-established:
  - "Sprint display: header (name, path, dates, count) then separator then grouped items — consistent terminal layout for future sprint commands"
  - "Error-first process steps: check prerequisites and config before making API calls — surfaces setup issues immediately"

requirements-completed: [SPRT-03]

# Metrics
duration: ~10min
completed: 2026-03-04
---

# Phase 2 Plan 02: Azure Sprint Skill Summary

**/gsd:azdo-sprint GSD skill command delivering terminal-formatted sprint backlog with grouped work items (stories + child tasks), HTML-free output, and prerequisite validation**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-03-04T14:01:38Z
- **Completed:** 2026-03-04T14:11:00Z
- **Tasks:** 2 (1 auto + 1 human-verify)
- **Files modified:** 1 created

## Accomplishments
- `/gsd:azdo-sprint` skill file created at `~/.claude/commands/gsd/azdo-sprint.md` with full frontmatter, objective, context, and 5-step process
- Sprint header display: name, iteration path, dates (YYYY-MM-DD), total item count
- Work item grouping: top-level stories/bugs rendered with description (3-line truncation), acceptance criteria, and indented child tasks
- Edge case handling: empty sprint, no active sprint, missing config, missing GSD installation
- User visually verified end-to-end: sprint backlog displayed correctly with no HTML artifacts

## Task Commits

Each task was committed atomically:

1. **Task 1: Create /gsd:azdo-sprint skill file** - `c28e9eb` (feat)
2. **Task 2: Verify sprint backlog display end-to-end** - human-verify checkpoint, user approved (no code changes)

**Plan metadata:** (this commit — docs: complete plan)

_Note: azdo-sprint.md is GSD infrastructure at ~/.claude/commands/gsd/ and is not tracked in the project repo per established convention._

## Files Created/Modified
- `~/.claude/commands/gsd/azdo-sprint.md` - New /gsd:azdo-sprint skill command: 5-step process fetching sprint metadata and items via azdo-tools.cjs, formats grouped terminal output with type abbreviations and truncated descriptions

## Decisions Made
- Skill file placed in GSD infrastructure (`~/.claude/commands/gsd/`) not project repo — consistent with all other GSD skills established in Phase 1
- Orphaned tasks (parentId not present in sprint item list) promoted to top-level rather than dropped, preventing data loss
- Description capped at 3 lines with trailing `...` to keep output scannable in a terminal without overwhelming context

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - Azure DevOps credentials were configured in Phase 1. The /gsd:azdo-sprint skill is immediately usable in any Claude Code session within a project that has run /gsd:azdo-setup.

## Next Phase Readiness
- Phase 2 sprint data pipeline is complete: CLI commands (Plan 01) + user-facing skill command (Plan 02)
- `/gsd:azdo-sprint` verified against live Azure DevOps sprint data
- Foundation in place for Phase 3 (sprint analysis, GSD plan generation from sprint backlog)
- No blockers — all SPRT requirements complete

---
*Phase: 02-sprint-data*
*Completed: 2026-03-04*
