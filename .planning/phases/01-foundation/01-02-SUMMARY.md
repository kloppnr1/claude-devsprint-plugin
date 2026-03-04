---
phase: 01-foundation
plan: "02"
subsystem: infra
tags: [azure-devops, gsd-skill, interactive-wizard, pat-auth, credential-management]

# Dependency graph
requires:
  - phase: 01-foundation
    plan: "01"
    provides: "azdo-tools.cjs CLI with save-config, load-config, and test commands"
provides:
  - "/gsd:azdo-setup skill — interactive wizard for org URL, project, and PAT credential setup"
  - "/gsd:azdo-test skill — standalone connection verifier with clear pass/fail output"
  - "End-to-end Azure DevOps credential flow verified with real credentials"
affects:
  - "02-sprint-data (sprint fetch skills use azdo-setup as prerequisite)"
  - "All future GSD skills that require Azure DevOps connectivity"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "GSD skill files follow frontmatter + <objective> + <process> + <success_criteria> structure"
    - "AskUserQuestion for interactive prompts (never hardcoded values)"
    - "PAT masking: first 4 + '...' + last 4 chars shown in re-run display"
    - "Auto-run connection test after credential save"

key-files:
  created:
    - "~/.claude/commands/gsd/azdo-setup.md"
    - "~/.claude/commands/gsd/azdo-test.md"
    - ".planning/phases/01-foundation/01-02-SUMMARY.md"
  modified:
    - "~/.claude/get-shit-done/bin/azdo-tools.cjs (normaliseOrg bug fix for *.visualstudio.com URLs)"

key-decisions:
  - "Skill files live outside project repo (~/.claude/commands/gsd/) — not committed to project git"
  - "azdo-config.json already covered by .gitignore via .planning/ exclusion (no additional gitignore change needed)"
  - "normaliseOrg treats any https?:// prefixed input as a full URL and returns as-is — handles both dev.azure.com and *.visualstudio.com without special-casing"

patterns-established:
  - "GSD skill pattern: AskUserQuestion for all interactive prompts, Bash for CLI tool calls, no inline Node.js logic"
  - "Credential display pattern: show org + project in plain text, PAT masked with first4...last4"
  - "Re-run pattern: load-config first, show existing values, offer update/keep before prompting"

requirements-completed: [API-01, API-02]

# Metrics
duration: ~30min (includes checkpoint verification)
completed: 2026-03-04
---

# Phase 1 Plan 02: Create azdo-setup and azdo-test Skill Files Summary

**Two GSD skill commands for Azure DevOps credential setup and connection testing, verified end-to-end with real *.visualstudio.com credentials including a bug fix to azdo-tools.cjs org URL normalization**

## Performance

- **Duration:** ~30 min (includes checkpoint verification session)
- **Started:** 2026-03-04T14:00:00Z
- **Completed:** 2026-03-04T13:26:36Z
- **Tasks:** 2 (1 auto + 1 checkpoint:human-verify)
- **Files modified:** 3 (2 new skill files, 1 bug fix in azdo-tools.cjs)

## Accomplishments
- Created `/gsd:azdo-setup` skill: interactive wizard prompting for org URL, project name, and PAT via `AskUserQuestion`, auto-runs connection test after saving, shows masked PAT on re-run
- Created `/gsd:azdo-test` skill: standalone connection verifier with clear success/failure output and fix suggestion directing user to `/gsd:azdo-setup`
- Fixed `normaliseOrg` bug in `azdo-tools.cjs` — previously failed for `*.visualstudio.com` URLs; now any `https?://` prefixed input is returned as-is
- Verified complete end-to-end flow with real Azure DevOps credentials (verdo365.visualstudio.com) — connection test passes and reports "Connected to https://verdo365.visualstudio.com/Verdo%20Agile%20Development"

## Task Commits

Skill files are in `~/.claude/commands/gsd/` outside the project repo — not committed to project git. Bug fix in `azdo-tools.cjs` is also in GSD infrastructure (`~/.claude/get-shit-done/bin/`) outside the project repo.

1. **Task 1: Create azdo-setup.md and azdo-test.md skill files** — files created at `~/.claude/commands/gsd/` (outside project repo, no project commit)
2. **Task 2: Verify full Azure DevOps setup and test flow** — checkpoint approved by user after end-to-end verification with real credentials

**Plan metadata:** (docs commit — see state updates below)

## Files Created/Modified
- `~/.claude/commands/gsd/azdo-setup.md` — Interactive setup wizard skill (4,128 bytes, 7-step process)
- `~/.claude/commands/gsd/azdo-test.md` — Standalone connection test skill (1,625 bytes, 4-step process)
- `~/.claude/get-shit-done/bin/azdo-tools.cjs` — Bug fix: `normaliseOrg` now handles `*.visualstudio.com` and any full URL correctly

## Decisions Made
- Skill files live in `~/.claude/commands/gsd/` (GSD infrastructure) rather than the project repo — consistent with all other GSD skills, not committed to project git
- `.planning/azdo-config.json` was already covered by the `.planning/` gitignore entry established in Plan 01 — no additional gitignore change required in Plan 02
- `normaliseOrg` uses a simple `https?://` prefix check to detect full URLs — covers dev.azure.com, *.visualstudio.com, and on-prem instances without special-casing each domain

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed normaliseOrg not handling *.visualstudio.com URLs in azdo-tools.cjs**
- **Found during:** Task 2 (checkpoint:human-verify — user ran /gsd:azdo-setup with real credentials)
- **Issue:** `normaliseOrg` only stripped `https://dev.azure.com/` prefix. When user entered `https://verdo365.visualstudio.com/`, the function did not recognise it as a full URL and would incorrectly treat it as a plain slug, prepending `https://dev.azure.com/` to produce a malformed URL
- **Fix:** Replaced domain-specific prefix stripping with a general `https?://` detection — any URL-prefixed input is now returned as-is (stripped of trailing slashes). Plain slugs still default to `https://dev.azure.com/slug`
- **Files modified:** `~/.claude/get-shit-done/bin/azdo-tools.cjs`
- **Verification:** Connection test passes: "Connected to https://verdo365.visualstudio.com/Verdo%20Agile%20Development"
- **Committed in:** Fix applied during checkpoint verification (outside project repo)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Bug fix was essential for correctness — without it, any user with a *.visualstudio.com Azure DevOps account would fail. Fix is minimal and backward-compatible (dev.azure.com slugs and full URLs still work as before).

## Issues Encountered
None beyond the auto-fixed bug above. The checkpoint verification flow worked as designed once the normaliseOrg bug was resolved.

## User Setup Required
None — credential configuration is handled interactively by `/gsd:azdo-setup` at project setup time.

## Next Phase Readiness
- Both GSD skill commands are live and verified with real credentials
- `azdo-tools.cjs` is production-ready (bug fixed, full URL handling confirmed)
- Phase 1 foundation complete — ready for Phase 2 (sprint data fetch skills)
- Any future sprint data skill can assume `/gsd:azdo-setup` has been run and `azdo-config.json` exists

## Self-Check: PASSED

- azdo-setup.md: FOUND at ~/.claude/commands/gsd/azdo-setup.md (4,128 bytes)
- azdo-test.md: FOUND at ~/.claude/commands/gsd/azdo-test.md (1,625 bytes)
- azdo-tools.cjs: FOUND at ~/.claude/get-shit-done/bin/azdo-tools.cjs (normaliseOrg bug fixed)
- End-to-end verification: CONFIRMED by user (connection test passed with verdo365.visualstudio.com)

---
*Phase: 01-foundation*
*Completed: 2026-03-04*
