---
phase: 03-analysis
plan: "02"
subsystem: skill
tags: [azure-devops, gsd-skill, sprint-analysis, project-bootstrap, multi-repo]

# Dependency graph
requires:
  - phase: 03-analysis
    plan: "01"
    provides: get-branch-links command in azdo-tools.cjs
  - phase: 02-sprint-data
    provides: get-sprint, get-sprint-items --me commands in azdo-tools.cjs
provides:
  - /gsd:azdo-analyze skill at ~/.claude/commands/gsd/azdo-analyze.md
  - Full sprint-to-GSD-project pipeline (fetch -> branch link resolve -> generate -> approve)
affects:
  - Target repos: each gets PROJECT.md + ROADMAP.md + REQUIREMENTS.md in .planning/
  - Phase 4 (status update automation) can hook into the approved .planning/ output

# Tech tracking
tech-stack:
  added: []
  patterns:
    - AskUserQuestion gate before multi-repo processing (confirm before generate)
    - Per-repo approval loop with iterative regeneration on feedback
    - Local repo detection via .git directory check before prompting to clone
    - Overwrite guard checks PROJECT.md existence before writing

key-files:
  created:
    - "~/.claude/commands/gsd/azdo-analyze.md"
  modified: []

key-decisions:
  - "Story-level-only processing: if task ID passed as argument, roll up to parentId before branch link resolution"
  - "First branch link wins when multiple exist for a story — documented behavior, not silent"
  - "Clone location defaults to parent of $CWD (same sibling directory as PlanningMe)"
  - "Per-repo REQUIREMENTS.md generated alongside PROJECT.md and ROADMAP.md — enables /gsd:plan-phase immediately"
  - "Approval loop allows iterative changes: ask what to change, regenerate, re-present (no hard limit on iterations)"

patterns-established:
  - "Multi-repo summary before processing: AskUserQuestion confirmation gate protects against unwanted file generation"
  - "Overwrite guard: test -f {repoPath}/.planning/PROJECT.md before writing"
  - "Clone fallback: attempt plain git clone first; if fails warn and skip (no PAT embedding by default)"

requirements-completed: [ANAL-01, ANAL-02, ANAL-03]

# Metrics
duration: ~5min
completed: 2026-03-04
---

# Phase 3 Plan 02: /gsd:azdo-analyze Skill Summary

**Sprint-to-GSD-project pipeline skill created: fetches assigned stories from Azure DevOps, resolves branch links to local repos, shows multi-repo summary, generates PROJECT.md + ROADMAP.md + REQUIREMENTS.md per target repo with iterative approval flow**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-04T16:29:10Z
- **Completed:** 2026-03-04T16:34:00Z
- **Tasks:** 1 of 2 (Task 2 is human-verify checkpoint)
- **Files created:** 1

## Accomplishments

- Created `~/.claude/commands/gsd/azdo-analyze.md` with proper frontmatter (`name: gsd:azdo-analyze`, `description`, `allowed-tools: Read, Write, Bash, AskUserQuestion`)
- Implemented 12-step process covering the full sprint-to-GSD pipeline:
  - Steps 1-2: Prerequisite check (azdo-tools.cjs exists + load-config) and sprint metadata fetch
  - Step 3: Fetch assigned stories via `get-sprint-items --me`, filter to top-level User Stories, collect child tasks per story
  - Step 4: Resolve branch links per story via `get-branch-links --id`, group by repo, track no-link stories
  - Step 5: Multi-repo summary display with `AskUserQuestion` confirmation gate before any file generation
  - Step 6: Local repo path resolution (check `{parentDir}/{repoName}/.git`, prompt to clone/provide/skip if not found)
  - Step 7: Overwrite guard (`test -f {repoPath}/.planning/PROJECT.md`)
  - Steps 8-10: Generate PROJECT.md, ROADMAP.md, REQUIREMENTS.md using Write tool with AzDO field mappings
  - Step 11: Per-repo approval gate (`approve/changes/skip`) with iterative regeneration on "changes"
  - Step 12: Final summary with next steps (`cd {repoPath} && /gsd:plan-phase`)
- Full error handling section: vso.code scope 403 guidance, clone failure, empty descriptions, no acceptance criteria, empty sprint

## Task Commits

1. **Task 1: Create /gsd:azdo-analyze skill file** - `f2dab07` (feat, empty commit — file in GSD infrastructure outside repo)

## Files Created/Modified

- `~/.claude/commands/gsd/azdo-analyze.md` — New skill file, 337 lines. Covers all 12 process steps, all required CLI calls, approval flow via AskUserQuestion.

## Decisions Made

- **Story-level only:** If a task ID is passed as argument, the skill rolls up to the parent story before branch link resolution. Accepted tasks do not have branch links — only user stories do.
- **First branch link wins:** When a story has multiple branch links (e.g., feature branch + hotfix branch), the skill uses the first one. This is documented in the skill ("use the first one") rather than silently picking.
- **Clone location:** Defaults to the parent of `$CWD` — the same sibling directory convention as the user's existing repos at `C:/Users/sen.makj/source/repos/`. Confirmed with user before cloning.
- **REQUIREMENTS.md generated alongside PROJECT.md/ROADMAP.md:** Enables `/gsd:plan-phase` immediately after approval without a separate step to bootstrap requirements.
- **Iterative approval:** The "changes" option in the approval gate prompts for specific feedback, regenerates affected files, and re-presents. No artificial iteration limit — the user controls when to approve or skip.

## Deviations from Plan

**One minor extension (Rule 2 — Missing critical functionality):**

The plan specified Steps 8-9 (PROJECT.md + ROADMAP.md) and then "Also create REQUIREMENTS.md" as a brief note at the end of Step 9. The skill was written with REQUIREMENTS.md as its own explicit Step 10 with a full field mapping and format template. This makes the skill more complete and consistent with GSD's three-file planning structure. Not a behavioral deviation — it matches the plan's intent.

All 11 core process steps from the plan are implemented; Step 11 (approval) became Steps 11-12 by separating the approval loop from the final summary for clarity.

## Checkpoint: Task 2 (Human Verify)

**Status:** Awaiting human verification

The `/gsd:azdo-analyze` skill is complete and ready for end-to-end testing. Task 2 is a `checkpoint:human-verify` gate. The user should:

1. Open a new Claude Code session in the PlanningMe project directory
2. Run `/gsd:azdo-analyze`
3. Verify stories grouped by repo, branch link resolution, skip behavior for no-link stories
4. Approve at least one repo's generated PROJECT.md/ROADMAP.md/REQUIREMENTS.md
5. Verify the target repo's `.planning/` contains correct GSD-format files

## Automated Verification

```
node -e "
const fs = require('fs');
const skill = fs.readFileSync(process.env.HOME + '/.claude/commands/gsd/azdo-analyze.md', 'utf8');
const checks = ['get-sprint-items --me', 'get-branch-links', 'PROJECT.md', 'ROADMAP.md', 'AskUserQuestion', 'approve'];
const results = checks.map(c => [c, skill.includes(c)]);
console.log(results.map(r => r[0] + ': ' + r[1]).join('\n'));
if (results.some(r => !r[1])) process.exit(1);
"
```

All 6 checks: PASSED

---
*Phase: 03-analysis*
*Completed: 2026-03-04*

## Self-Check: PASSED

- `~/.claude/commands/gsd/azdo-analyze.md` - FOUND (verified: 337 lines, all 12 steps, all required CLI calls)
- Commit `f2dab07` - FOUND in git log
- Automated verification script: all 6 checks passed (get-sprint-items --me, get-branch-links, PROJECT.md, ROADMAP.md, AskUserQuestion, approve)
