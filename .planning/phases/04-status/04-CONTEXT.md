# Phase 4: Status - Context

**Gathered:** 2026-03-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Automatic work item status updates in Azure DevOps as a side effect of GSD execution. No standalone command — status changes are woven into the execute-phase pipeline. When execution starts, tasks move to Active. When execution completes, tasks move to Resolved. Story status follows child task completion.

</domain>

<decisions>
## Implementation Decisions

### Trigger mechanism
- No standalone `/gsd:azdev-status` command — purely automatic during execute-phase
- Status updates are a side effect of the execution pipeline, not a separate workflow
- Overrides Phase 3's earlier "no manual command" note — confirmed: automatic only

### Timing
- **New → Active**: When the first plan starts executing (beginning of execute-phase)
- **Active → Resolved**: When all plans in the phase complete successfully
- Updates happen at execution boundaries, not during individual task steps

### Task-level updates
- Only update DevOps tasks that execution actually works on (mapped in the plan)
- Non-code tasks (e.g. "send email to vendor") are left untouched
- Task-to-plan mapping from azdev-analyze determines which tasks are "ours"

### Story-level updates
- Story → Active as soon as the first child task starts executing
- Story → Resolved only when ALL child tasks are Resolved (including non-code tasks resolved manually outside GSD)
- GSD must check all sibling task states before attempting to resolve the story

### Completion with open tasks
- When execution finishes but non-code tasks remain open: notify the user
- Show which tasks are still open and that the story stays Active until all are resolved
- Example: "Execution done. 2 tasks still open: [Send email to vendor], [Schedule meeting]. Story stays Active until all resolved."

### Claude's Discretion
- Where to persist the DevOps work item → GSD plan task mapping (azdev-config.json, PROJECT.md metadata, or separate link file)
- Error handling on status update failures (retry strategy, whether to block execution)
- How to hook into execute-phase (GSD hook, wrapper, or inline in execution flow)
- Exact API call structure for state transitions (already have makePatchRequest pattern)

</decisions>

<specifics>
## Specific Ideas

- The plan created by azdev-analyze should map DevOps task IDs to GSD plan tasks — this mapping is the source of truth for which tasks to update
- Status updates should feel invisible — the user shouldn't have to think about them
- The notification about remaining open tasks should be informative, not blocking

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `makePatchRequest()` in azdev-tools.cjs — already handles JSON Patch with `application/json-patch+json` header
- `update-description` command — existing PATCH pattern: `{op: 'replace', path: '/fields/System.Description', value: ...}`
- State update follows same pattern: `{op: 'replace', path: '/fields/System.State', value: 'Active'}`
- `getSprintData()`, `loadConfig()`, PAT encoding all ready to use

### Established Patterns
- CLI commands in azdev-tools.cjs follow `cmd<Name>(cwd, args)` → `loadConfig()` → `makeRequest()` → JSON output → `process.exit()`
- Skills in `~/.claude/commands/gsd/azdo-*.md`
- Config in `.planning/azdev-config.json` per project

### Integration Points
- New CLI command needed: `update-state` (or similar) in azdev-tools.cjs
- Hook into GSD's execute-phase pipeline — needs to call status update at start and end of execution
- azdev-analyze must persist task ID mapping so execute-phase knows which DevOps items to update
- Must read sibling task states from DevOps API to determine if story can be resolved

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-status*
*Context gathered: 2026-03-04*
