# Phase 3: Analysis - Context

**Gathered:** 2026-03-04
**Status:** Ready for planning

<domain>
## Phase Boundary

User can run a single command that fetches all their assigned stories from the current sprint, resolves target repos from branch links, clones if needed, and bootstraps a GSD project (PROJECT.md + ROADMAP.md) in each target repo from the DevOps story data. After approval, it's standard GSD from there.

PlanningMe is NOT an orchestrator — it's just the home for azdo skills and the helper script. Actual planning and execution happen in target repos using standard GSD workflows.

</domain>

<decisions>
## Implementation Decisions

### Task selection
- Story-level only — if a task ID is passed, roll up to its parent story
- `--me` filter — analyze only items assigned to the authenticated user
- All stories processed at once across all target repos in one go
- Always fetch fresh from Azure DevOps API (no caching)
- Unified analysis per story (story + all child tasks together)

### Repo resolution
- Resolve target repo from the branch link on the user story (Azure DevOps API)
- No manual repo mapping — branch link is the source of truth
- If repo not found locally: prompt user whether to clone. If yes, clone and continue
- No REPO-01/REPO-02 manual mapping needed — replaced by branch link resolution

### Analysis output
- Full GSD-style project bootstrap in each target repo
- Generates PROJECT.md and ROADMAP.md from DevOps story data (title, description, acceptance criteria, child tasks)
- Essentially a smart `/gsd:new-project` using Azure DevOps data as input instead of user questions
- Plans live in the target repo's `.planning/` — standard GSD structure

### Multi-repo handling
- One sprint can span multiple repos (different stories → different branch links → different repos)
- Process all in one go, bootstrap GSD in each target repo
- User approves each generated PROJECT.md/ROADMAP.md

### Approval flow
- User reviews and approves the generated PROJECT.md/ROADMAP.md per target repo
- After approval, standard GSD takes over (plan-phase, execute-phase in target repo)

### Phase 4 implication (captured early)
- Status updates (New → Active → Closed) should happen automatically when GSD completes execution in a target repo
- No manual /gsd:azdo-status command needed

### Claude's Discretion
- How to extract repo info from branch link API response
- PROJECT.md/ROADMAP.md generation structure and mapping from DevOps fields
- Clone location if repo not found locally
- How to present multi-repo summary before processing

</decisions>

<specifics>
## Specific Ideas

- The command should show a summary like "You have 3 stories across 2 repos" before processing
- Branch link on user story is the single source of truth for repo resolution
- The analyze command replaces the need for manual repo mapping entirely

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `azdo-tools.cjs` — already has `getSprintData()`, `getAuthenticatedUser()`, `cmdGetSprintItems()` with `--me` filter, `makeRequest()` for API calls, `stripHtml()`, `loadConfig()`
- `/gsd:azdo-sprint` skill — sprint display already working
- `/gsd:azdo-setup` and `/gsd:azdo-test` — config and auth already handled

### Established Patterns
- CLI commands in azdo-tools.cjs, skills in ~/.claude/commands/gsd/
- Config in .planning/azdo-config.json per project
- Node.js with built-ins only (no external dependencies)
- All skills use /gsd:azdo-* prefix

### Integration Points
- New CLI command needed in azdo-tools.cjs: fetch branch links from work item
- New skill: /gsd:azdo-analyze
- Output feeds into standard GSD: PROJECT.md + ROADMAP.md in target repos
- Phase 4 will hook into GSD's execution completion to update DevOps status

</code_context>

<deferred>
## Deferred Ideas

- Automatic status updates on execution completion — Phase 4 scope, but decision captured: should be automatic, not manual

</deferred>

---

*Phase: 03-analysis*
*Context gathered: 2026-03-04*
