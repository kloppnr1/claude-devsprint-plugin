---
phase: 01-foundation
plan: "01"
subsystem: infra
tags: [nodejs, azure-devops, rest-api, pat-auth, base64, cli]

# Dependency graph
requires: []
provides:
  - "azdo-tools.cjs CLI script with save-config, load-config, and test commands"
  - "PAT base64 encoding/decoding pattern for Azure DevOps auth"
  - "Org URL normalization (https://dev.azure.com/org/ -> slug)"
  - ".planning/azdo-config.json config schema with encoded PAT"
  - "makeRequest helper for authenticated Azure DevOps HTTPS calls"
affects:
  - "02-foundation (azdo-setup and azdo-test skills)"
  - "02-sprint-data (sprint fetch skills)"
  - "03-analysis"
  - "04-status"

# Tech tracking
tech-stack:
  added: ["Node.js built-ins: fs, path, https, Buffer"]
  patterns:
    - "CJS module with shebang for direct node execution"
    - "PAT encoding: Buffer.from(':' + pat).toString('base64') (colon prefix = empty username)"
    - "--cwd flag for sandboxed execution outside project root"
    - "process.exit(0)/exit(1) pattern for CLI return codes"
    - "Separation of config helpers, HTTP helper, CLI commands, and router"

key-files:
  created:
    - "~/.claude/get-shit-done/bin/azdo-tools.cjs"
    - ".planning/phases/01-foundation/01-01-SUMMARY.md"
  modified:
    - ".gitignore (track .planning/ except azdo-config.json)"

key-decisions:
  - "PAT encoding uses colon-prefix base64: Buffer.from(':' + pat).toString('base64') matching HTTP Basic auth empty-username convention"
  - "Org normalization strips https://dev.azure.com/ prefix and trailing slashes to store only the slug"
  - "test command makes two requests: projects API (auth + vso.project scope) then work items API (vso.work scope)"
  - "404 on work items is treated as success (item not found = auth OK)"
  - "Updated .gitignore from blanket .planning/ exclusion to only exclude azdo-config.json for credential security"

patterns-established:
  - "CLI pattern: node azdo-tools.cjs <command> [options] [--cwd <path>]"
  - "Config location: {cwd}/.planning/azdo-config.json"
  - "Error output: console.error() to stderr, exit 1"
  - "Success output: JSON or plain text to stdout, exit 0"

requirements-completed: [API-01, API-02]

# Metrics
duration: 4min
completed: 2026-03-04
---

# Phase 1 Plan 01: Create azdo-tools.cjs Summary

**Node.js CLI helper for Azure DevOps API with PAT-based auth, config file I/O, org URL normalization, and dual-scope connection testing**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-04T13:01:59Z
- **Completed:** 2026-03-04T13:05:18Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Created `azdo-tools.cjs` at `~/.claude/get-shit-done/bin/` — the shared API layer for all Azure DevOps GSD skills
- Implemented save-config with org URL normalization and base64 PAT encoding (never stores plain text)
- Implemented load-config with PAT decoding — round-trip preserves org slug, project, and raw PAT exactly
- Implemented test command verifying both vso.project scope (GET /_apis/projects) and vso.work scope (GET /_apis/wit/workitems)
- Updated .gitignore to track planning artifacts while keeping credential file excluded

## Task Commits

Each task was committed atomically:

1. **Task 1: Create azdo-tools.cjs with config management and HTTP client** - `8234e84` (feat)
2. **Task 2: Verify config round-trip and CLI contracts** - (verification only, no new files — included in Task 1 commit)

**Supporting:** `db79b1f` (chore: update .gitignore to enable planning artifact tracking)

## Files Created/Modified
- `~/.claude/get-shit-done/bin/azdo-tools.cjs` - Azure DevOps CLI helper (outside project repo — GSD infrastructure file)
- `.gitignore` - Updated from `.planning/` blanket ignore to only exclude `.planning/azdo-config.json`

## Decisions Made
- PAT encoding uses `Buffer.from(':' + pat).toString('base64')` — the colon prefix represents an empty username, matching HTTP Basic auth convention for token-only auth
- Org normalization handles three input formats: `myorg` (slug), `https://dev.azure.com/myorg` (no slash), `https://dev.azure.com/myorg/` (trailing slash) — all produce `myorg`
- test command uses two API calls: projects endpoint verifies auth + vso.project scope; work items endpoint verifies vso.work scope (404 is acceptable — means auth OK, just no item #1)
- Updated .gitignore to track .planning/ files (except credentials) — necessary for GSD state tracking to function

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Updated .gitignore to enable planning artifact tracking**
- **Found during:** Task 1 commit
- **Issue:** `.planning/` was fully gitignored, preventing GSD state tracking (STATE.md, ROADMAP.md, SUMMARY.md) from being committed
- **Fix:** Changed blanket `.planning/` ignore to only exclude `.planning/azdo-config.json` (credentials file)
- **Files modified:** `.gitignore`
- **Verification:** `git status` confirms .planning/*.md files are now tracked
- **Committed in:** `db79b1f`

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Auto-fix necessary for GSD state tracking to function. No scope creep — azdo-config.json still excluded for credential security.

## Issues Encountered
None - plan executed as specified. All CLI contracts verified per Task 2 checklist.

## User Setup Required
None - no external service configuration required at this stage. Azure DevOps credentials will be configured in Plan 02 via `/gsd:azdo-setup`.

## Next Phase Readiness
- `azdo-tools.cjs` is complete and ready for Plan 02 to build the `/gsd:azdo-setup` and `/gsd:azdo-test` skill commands on top of it
- CLI contract is established: all skill files call `node azdo-tools.cjs <command> --cwd <path>`
- Config schema is locked: `{org, project, pat}` where pat is base64-encoded with colon prefix

## Self-Check: PASSED

- azdo-tools.cjs: FOUND at ~/.claude/get-shit-done/bin/azdo-tools.cjs (391 lines, exceeds 100-line minimum)
- 01-01-SUMMARY.md: FOUND at .planning/phases/01-foundation/01-01-SUMMARY.md
- Commit 8234e84: FOUND (feat: create azdo-tools.cjs)
- Commit db79b1f: FOUND (chore: update .gitignore)

---
*Phase: 01-foundation*
*Completed: 2026-03-04*
