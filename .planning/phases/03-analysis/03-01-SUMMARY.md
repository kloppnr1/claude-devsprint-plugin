---
phase: 03-analysis
plan: "01"
subsystem: api
tags: [azure-devops, rest-api, git, branch-links, vstfs, node-cjs]

# Dependency graph
requires:
  - phase: 02-sprint-data
    provides: makeRequest, loadConfig, stripHtml helpers in azdo-tools.cjs
provides:
  - get-branch-links CLI command in azdo-tools.cjs
  - parseVstfsRefUri helper for vstfs:///Git/Ref/ URI parsing
  - resolveRepository helper with cross-project fallback
affects:
  - 03-analysis plan 02 (azdo-analyze skill will call get-branch-links per story)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - URL-based vstfs URI filter (r.url.startsWith('vstfs:///Git/Ref/')) more reliable than attributes.name check
    - Two-tier repository lookup: project-scoped first, org-level fallback for cross-project repos
    - Per-link error isolation: failed repo lookups emit stderr warning and are skipped, not fatal

key-files:
  created: []
  modified:
    - "~/.claude/get-shit-done/bin/azdo-tools.cjs"

key-decisions:
  - "URL-based ArtifactLink filter (vstfs:///Git/Ref/ prefix) used instead of attributes.name === 'Branch' — more reliable per Pitfall 1 in RESEARCH.md"
  - "resolveRepository falls back to org-level GET if project-scoped returns 404 — handles cross-project repos (Pitfall 4)"
  - "Individual repo lookup failures are non-fatal: stderr warning emitted, result skipped, remaining links processed"

patterns-established:
  - "Branch link extraction: GET /wit/workitems/{id}?$expand=relations, filter rel=ArtifactLink + vstfs URL prefix"
  - "vstfs URI parsing: strip prefix, split on /, repositoryId=parts[1], branchName=parts.slice(2).join('/').replace(/^GB/,'')"

requirements-completed: [REPO-01, REPO-02]

# Metrics
duration: 15min
completed: 2026-03-04
---

# Phase 3 Plan 01: Branch Link Resolution Summary

**get-branch-links CLI command added to azdo-tools.cjs: resolves vstfs:///Git/Ref/ artifact links from Azure DevOps work items into repository details (name, remoteUrl, branchName) with cross-project fallback**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-03-04T16:00:00Z
- **Completed:** 2026-03-04T16:15:00Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- Added `parseVstfsRefUri` helper that correctly handles branch names with forward slashes (e.g., `feature/US-1234-add-checkout`) by joining all parts after repositoryId
- Added `resolveRepository` helper with two-tier lookup: project-scoped first, org-level fallback for cross-project repos
- Added `cmdGetBranchLinks` command: fetches work item with `$expand=relations`, filters using URL prefix (`vstfs:///Git/Ref/`) rather than unreliable `attributes.name`, resolves each branch link to repo details, returns `[]` for stories with no branch link
- Wired into CLI router with `case 'get-branch-links'`; updated help text and JSDoc header

## Task Commits

Each task was committed atomically:

1. **Task 1 + Task 2: add get-branch-links command** - `0066539` (feat)

**Plan metadata:** pending (docs: complete plan)

_Note: Both tasks were committed together since azdo-tools.cjs is GSD infrastructure outside the PlanningMe repo — only planning files are tracked in this repo._

## Files Created/Modified

- `~/.claude/get-shit-done/bin/azdo-tools.cjs` - Extended with parseVstfsRefUri, resolveRepository, cmdGetBranchLinks; updated CLI router, help text, and JSDoc header

## Decisions Made

- **URL-based ArtifactLink filter:** Used `r.url.startsWith('vstfs:///Git/Ref/')` instead of `r.attributes.name === 'Branch'` — the `attributes.name` field is not consistently set across all link creation paths (UI, CLI, API). The vstfs URL prefix is the canonical discriminator.
- **Non-fatal repo resolution failures:** If `resolveRepository` throws for a specific branch link (both project-scoped and org-level return non-200), the link is skipped with a stderr warning and the remaining links are still processed. This prevents a single bad repo reference from aborting the entire command.
- **Two-tier repository lookup:** Project-scoped first (`/{org}/{project}/_apis/git/repositories/{id}`), org-level fallback (`/{org}/_apis/git/repositories/{id}`) for cross-project repos where the repositoryId belongs to a different project than the configured one.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required beyond existing PAT. Note: PAT must include `vso.code` scope for the Git Repositories API (in addition to `vso.work` already verified in Phase 1). The command's help text documents this requirement.

## Next Phase Readiness

- `get-branch-links --id <storyId> --cwd <path>` is ready to call from the `/gsd:azdo-analyze` skill (Plan 02)
- The command returns `[]` gracefully for stories without branch links — skill can handle this case
- Cross-project repos are resolved transparently via org-level fallback
- REPO-01 and REPO-02 requirements are satisfied via branch link resolution (replacing the original ask-and-remember approach)

---
*Phase: 03-analysis*
*Completed: 2026-03-04*

## Self-Check: PASSED

- `~/.claude/get-shit-done/bin/azdo-tools.cjs` - modified and verified (parseVstfsRefUri, resolveRepository, cmdGetBranchLinks exist; help text shows get-branch-links; missing --id exits 1)
- Commit `0066539` - verified in git log
