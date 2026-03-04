# Phase 4: Status - Research

**Researched:** 2026-03-04
**Domain:** Azure DevOps Work Item State Transitions + GSD execute-phase integration
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Trigger mechanism:**
- No standalone `/gsd:azdev-status` command — purely automatic during execute-phase
- Status updates are a side effect of the execution pipeline, not a separate workflow

**Timing:**
- New → Active: When the first plan starts executing (beginning of execute-phase)
- Active → Resolved: When all plans in the phase complete successfully
- Updates happen at execution boundaries, not during individual task steps

**Task-level updates:**
- Only update DevOps tasks that execution actually works on (mapped in the plan)
- Non-code tasks (e.g. "send email to vendor") are left untouched
- Task-to-plan mapping from azdev-analyze determines which tasks are "ours"

**Story-level updates:**
- Story → Active as soon as the first child task starts executing
- Story → Resolved only when ALL child tasks are Resolved (including non-code tasks resolved manually outside GSD)
- GSD must check all sibling task states before attempting to resolve the story

**Completion with open tasks:**
- When execution finishes but non-code tasks remain open: notify the user
- Show which tasks are still open and that the story stays Active until all are resolved
- Example: "Execution done. 2 tasks still open: [Send email to vendor], [Schedule meeting]. Story stays Active until all resolved."

### Claude's Discretion

- Where to persist the DevOps work item → GSD plan task mapping (azdev-config.json, PROJECT.md metadata, or separate link file)
- Error handling on status update failures (retry strategy, whether to block execution)
- How to hook into execute-phase (GSD hook, wrapper, or inline in execution flow)
- Exact API call structure for state transitions (already have makePatchRequest pattern)

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| STAT-01 | System can update work item status in Azure DevOps (New → Active → Closed) | Azure DevOps PATCH API with System.State field, `makePatchRequest()` already present in azdev-tools.cjs, batch GET API for sibling state checks |
</phase_requirements>

---

## Summary

Phase 4 adds automatic Azure DevOps work item state transitions as a side effect of the GSD execute-phase pipeline. When execution starts, tasks and their parent story move from New → Active. When execution completes successfully, tasks and (conditionally) the story move to Resolved. The user never issues a manual status command — state updates happen silently at execution boundaries.

The technical implementation is straightforward: the Azure DevOps PATCH Work Items API (already used in the project for `update-description`) accepts `/fields/System.State` with `"add"` or `"replace"` operations using `application/json-patch+json` content type. The `makePatchRequest()` helper in `azdev-tools.cjs` already handles this format correctly. A new `update-state` CLI command follows the same `cmd<Name>()` pattern as all other commands.

The non-trivial parts are: (1) persisting the DevOps task ID ↔ GSD plan mapping so execute-phase knows which items to update, (2) checking sibling task states before resolving the story (requires a GET call with `$expand=relations` or a batch GET), and (3) hooking into execute-phase at the right points without modifying the GSD core workflow engine. The recommended approach is to update the `azdev-analyze` skill to write a mapping file (e.g. `.planning/azdev-task-map.json`), and update `execute-phase.md` (the project-local skill wrapper at `~/.claude/commands/gsd/execute-phase.md` or a new `azdo-execute.md` wrapper) to call `update-state` at the start and end boundaries.

**Primary recommendation:** Add `update-state` command to `azdev-tools.cjs`, update `azdev-analyze.md` to write `.planning/azdev-task-map.json`, then add status update calls to the execute-phase skill's `initialize` step (mark Active) and `update_roadmap` step (mark Resolved after verification passes).

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Azure DevOps WIT REST API | 7.1 | PATCH work item state, GET work item + relations | Already used throughout the project |
| Node.js built-ins (https, fs, path) | Node LTS | HTTP requests, file I/O | No external deps — project constraint |
| `makePatchRequest()` in azdev-tools.cjs | — | JSON Patch PATCH requests | Already exists, handles `application/json-patch+json` |
| `makeRequest()` in azdev-tools.cjs | — | GET requests for sibling state reads | Already exists |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `loadConfig()` in azdev-tools.cjs | — | Read org/project/PAT from azdev-config.json | Always first in any CLI command |
| `getSprintData()` in azdev-tools.cjs | — | Sprint + team resolution | Only needed if sprint-scoped reads required |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `.planning/azdev-task-map.json` | PROJECT.md metadata block | JSON file is simpler to parse in Node.js; PROJECT.md is human-focused |
| `.planning/azdev-task-map.json` | Frontmatter in PLAN.md files | Frontmatter approach requires reading every plan file; JSON map is O(1) lookup |
| Modifying execute-phase.md (GSD infra) | New azdo-execute.md skill wrapper | Modifying core GSD infra risks breakage; project-local skill is cleaner |

**Installation:** No new packages needed — all built on existing Node.js built-ins and azdev-tools.cjs patterns.

---

## Architecture Patterns

### Recommended Project Structure

The new files and modifications for Phase 4:

```
~/.claude/get-shit-done/bin/
└── azdev-tools.cjs          # Add: update-state command

~/.claude/commands/gsd/
├── azdev-analyze.md          # Modify: write azdev-task-map.json after approval
└── execute-phase.md         # Modify: call update-state at start and end

{project}/.planning/
└── azdev-task-map.json       # New: maps DevOps IDs to GSD plan IDs
```

### Pattern 1: update-state CLI Command

**What:** New command in `azdev-tools.cjs` following the `cmd<Name>(cwd, args)` pattern. Accepts `--id` (work item ID) and `--state` (target state string). Uses `makePatchRequest()` with the existing `application/json-patch+json` approach.

**When to use:** Called at start of execute-phase (Active) and end of execute-phase (Resolved).

**Example:**
```javascript
// Source: Modeled on cmdUpdateDescription() in azdev-tools.cjs
// API: https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/update?view=azure-devops-rest-7.1
async function cmdUpdateState(cwd, args) {
  const idIdx = args.indexOf('--id');
  const stateIdx = args.indexOf('--state');
  const id = idIdx !== -1 ? args[idIdx + 1] : null;
  const state = stateIdx !== -1 ? args[stateIdx + 1] : null;

  if (!id || !state) {
    console.error('Usage: azdev-tools.cjs update-state --id <workItemId> --state <state>');
    process.exit(1);
  }

  try {
    const cfg = loadConfig(cwd);
    const encodedPat = Buffer.from(':' + cfg.pat).toString('base64');

    const patchUrl = `${cfg.org}/${cfg.project}/_apis/wit/workitems/${id}?api-version=7.1`;
    const patchBody = [
      {
        op: 'add',
        path: '/fields/System.State',
        value: state,          // e.g. 'Active', 'Resolved', 'New'
      },
    ];

    const res = await makePatchRequest(patchUrl, encodedPat, patchBody);

    if (res.status === 200) {
      console.log(JSON.stringify({ status: 'updated', id: Number(id), state }));
      process.exit(0);
    } else {
      const errorBody = res.body ? JSON.parse(res.body) : {};
      throw new Error(`Failed to update state for ${id}: HTTP ${res.status} — ${errorBody.message || res.body}`);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
```

**CLI contract:**
```
node ~/.claude/get-shit-done/bin/azdev-tools.cjs update-state --id <workItemId> --state <state> [--cwd <path>]
  -> stdout: JSON {"status":"updated","id":N,"state":"Active"}
  -> exit 0 on success, exit 1 on error
```

### Pattern 2: get-work-item-children CLI Command

**What:** New command (or extend existing) to fetch all child task IDs + states for a given story. Used before resolving a story to check whether all sibling tasks are Resolved. Calls GET with `$expand=relations` then batch-fetches child task states.

**When to use:** At the end of execute-phase, before attempting to resolve the story.

**Example:**
```javascript
// Source: Azure DevOps WIT REST API 7.1 — expand relations, then batch GET
// Step 1: GET parent with expanded relations to find child IDs
const wiUrl = `${cfg.org}/${cfg.project}/_apis/wit/workitems/${storyId}?$expand=relations&api-version=7.1`;
const wiRes = await makeRequest(wiUrl, encodedPat);
const workItem = JSON.parse(wiRes.body);

// Step 2: Filter to child relations (Hierarchy-Forward = parent→child link)
const childIds = (workItem.relations || [])
  .filter(r => r.rel === 'System.LinkTypes.Hierarchy-Forward')
  .map(r => {
    const parts = r.url.split('/');
    return Number(parts[parts.length - 1]);
  });

// Step 3: Batch GET child states
const batchUrl = `${cfg.org}/${cfg.project}/_apis/wit/workitemsbatch?api-version=7.1`;
const batchBody = {
  ids: childIds,
  fields: ['System.Id', 'System.Title', 'System.State'],
  errorPolicy: 'omit',
};
const batchRes = await makeRequest(batchUrl, encodedPat, 'POST', batchBody);
const children = JSON.parse(batchRes.body).value || [];

// Step 4: Check if all are Resolved
const openTasks = children.filter(c => c.fields['System.State'] !== 'Resolved');
```

**CLI contract:**
```
node ~/.claude/get-shit-done/bin/azdev-tools.cjs get-child-states --id <storyId> [--cwd <path>]
  -> stdout: JSON {"allResolved":bool,"children":[{"id":N,"title":"...","state":"..."},...]}
  -> exit 0 always (caller decides what to do with open tasks)
```

### Pattern 3: azdev-task-map.json — Persistence Format

**What:** JSON file written by `azdev-analyze.md` after user approval. Maps DevOps story/task IDs to the GSD project they belong to, and which plan tasks correspond to which DevOps task IDs.

**When to use:** Written once by azdev-analyze. Read by execute-phase at start and end to know which DevOps items to update.

**Recommended format:**
```json
{
  "version": 1,
  "mappings": [
    {
      "storyId": 12345,
      "storyTitle": "US - Add checkout flow",
      "repoPath": "/c/Users/sen.makj/source/repos/MyRepo",
      "taskIds": [12346, 12347],
      "taskTitles": {
        "12346": "Implement checkout API",
        "12347": "Add unit tests for checkout"
      }
    }
  ]
}
```

**Location:** `.planning/azdev-task-map.json` in the PlanningMe repo (where azdev-config.json lives).

**Alternative locations considered:**
- In each target repo's `.planning/`: Spreads the data; execute-phase runs from the PlanningMe CWD so cross-repo reads add complexity
- In PLAN.md frontmatter: Requires modifying PLAN files; hard to parse in Node.js

### Pattern 4: execute-phase Hook Points

**What:** The execute-phase.md skill (at `~/.claude/commands/gsd/execute-phase.md`) wraps `execute-phase.md` workflow. The skill invokes `@C:/Users/sen.makj/.claude/get-shit-done/workflows/execute-phase.md`. Status update calls should be added to the skill wrapper, NOT to the core GSD workflow.

**Hook points:**
- **Mark Active:** After `initialize` step completes (line ~37 in execute-phase workflow) — before first wave spawns
- **Mark Resolved:** After `update_roadmap` step (phase complete, verification passed) — before `offer_next`

**Recommended approach:** Modify the local `execute-phase.md` skill to call `update-state` at these two boundaries:

```bash
# At start of execute-phase (after init, before first wave):
node ~/.claude/get-shit-done/bin/azdev-tools.cjs update-state \
  --id {storyId} --state "Active" --cwd $CWD 2>/dev/null || true
# Also update each mapped task ID to Active

# At end of execute-phase (after verification passes):
node ~/.claude/get-shit-done/bin/azdev-tools.cjs get-child-states \
  --id {storyId} --cwd $CWD
# If all resolved: update story to Resolved
# Else: show notification about open tasks
```

### Anti-Patterns to Avoid

- **Modifying the GSD core workflow files** (`~/.claude/get-shit-done/workflows/execute-phase.md`): These are GSD infrastructure — changes affect all projects, not just this one. Add hooks in the local skill wrapper instead.
- **Blocking execution on state update failure:** If DevOps API is down or state transition fails, execution should continue. State updates are a side effect, not a prerequisite.
- **Updating story to Resolved without checking siblings:** If non-code tasks are still open, prematurely resolving the story violates the locked decision.
- **Calling get-sprint-items to check siblings:** Use the parent story's relations + batch GET instead — sprint item fetch is slow and includes irrelevant items.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP PATCH with JSON Patch body | Custom fetch logic | `makePatchRequest()` (existing) | Already handles `Content-Type: application/json-patch+json` and error handling |
| Config/PAT loading | New config reader | `loadConfig()` (existing) | Already handles base64 decode, missing config errors |
| Finding child work item IDs | Custom relation parser | GET with `$expand=relations`, filter `System.LinkTypes.Hierarchy-Forward` | Standard API pattern — relation type strings are fixed by Azure DevOps |
| Batch state reads | N individual GET calls | `workitemsbatch` POST endpoint (existing `makeRequest()`) | Already used in `get-sprint-items`; avoids N serial HTTP calls |

**Key insight:** Everything needed already exists in `azdev-tools.cjs`. Phase 4 is about wiring, not invention.

---

## Common Pitfalls

### Pitfall 1: Invalid State Transition (HTTP 400)
**What goes wrong:** PATCH returns HTTP 400 with message "TF401320: Rule Error for field System.State" when the target state is not a valid transition from the current state.
**Why it happens:** Azure DevOps process templates define allowed state transitions. Not every process uses New/Active/Resolved — Agile process uses "New/Active/Resolved/Closed", Scrum uses "New/Approved/Committed/Done". The project uses "Verdo Agile Development" which likely follows the Agile template.
**How to avoid:** Read the current state before patching. If `current === target`, skip the call. If the transition fails, log to stderr and continue (non-blocking).
**Warning signs:** HTTP 400 response with `TF401320` in error message.

### Pitfall 2: op "add" vs "replace" for System.State
**What goes wrong:** Using `"replace"` when the field path doesn't exist yet, or `"add"` inconsistently.
**Why it happens:** Azure DevOps WIT API docs show `"add"` for `/fields/System.State` updates (not `"replace"`). The existing `update-description` command uses `"replace"` — this was fine for Description because it always has an existing value. For State, `"add"` works for both set and update operations.
**How to avoid:** Use `op: "add"` for `/fields/System.State`. This is confirmed by Microsoft's own examples (source: MS Learn WIT Update docs, see Code Examples section).
**Warning signs:** HTTP 400 on PATCH with no clear error about state rules.

### Pitfall 3: Story Resolved Prematurely
**What goes wrong:** Story moves to Resolved while non-code tasks (e.g. "Send email to vendor") are still New or Active.
**Why it happens:** If only GSD-managed task IDs are checked, unmanaged tasks are invisible.
**How to avoid:** Always fetch ALL child task states (via get-child-states command) before resolving the story. Compare GSD-mapped task IDs against full children list to find unmanaged open tasks.
**Warning signs:** DevOps shows story Resolved but tasks are still in New/Active state.

### Pitfall 4: Task Map Out of Date
**What goes wrong:** azdev-task-map.json references task IDs from a previous sprint. Execute-phase updates wrong items.
**Why it happens:** The map is written once by azdev-analyze and reused across sessions.
**How to avoid:** Include story state check at execute-phase start: if story is already Resolved or Closed, skip status updates and warn the user. Also consider storing sprint iteration ID in the map for validation.
**Warning signs:** State update succeeds but the wrong sprint's story gets moved.

### Pitfall 5: PAT Scope Requirement
**What goes wrong:** State updates fail with 403 Forbidden.
**Why it happens:** `update-state` requires `vso.work_write` PAT scope. The existing PAT was set up with `vso.work` (read) + `vso.project` + `vso.code` during Phase 1. Write scope (`vso.work_write`) may not have been granted.
**How to avoid:** Document the required scope in the skill. On 403, show a specific message: "Status update failed: PAT needs `vso.work_write` scope. Regenerate at https://dev.azure.com/{org}/_usersSettings/tokens and re-run `/gsd:azdev-setup`."
**Warning signs:** HTTP 403 on PATCH but HTTP 200 on GET for same work item.

---

## Code Examples

Verified patterns from official sources:

### State Update (PATCH /fields/System.State)
```javascript
// Source: https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/update?view=azure-devops-rest-7.1
// API: PATCH {org}/{project}/_apis/wit/workitems/{id}?api-version=7.1
// Content-Type: application/json-patch+json (handled by makePatchRequest)

const patchBody = [
  {
    op: 'add',
    path: '/fields/System.State',
    value: 'Active',   // Or 'Resolved', 'New', etc.
  },
];
// Response 200: { id: N, rev: N, fields: { 'System.State': 'Active', ... } }
// Response 400: Invalid state transition (TF401320 rule error)
// Response 403: Missing vso.work_write PAT scope
```

### Get Children + Their States
```javascript
// Source: https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/get-work-item?view=azure-devops-rest-7.1
// Step 1: Expand relations to find child IDs
// GET {org}/{project}/_apis/wit/workitems/{storyId}?$expand=relations&api-version=7.1

const relations = workItem.relations || [];
const childIds = relations
  .filter(r => r.rel === 'System.LinkTypes.Hierarchy-Forward')
  .map(r => Number(r.url.split('/').pop()));

// Step 2: Batch GET states
// POST {org}/{project}/_apis/wit/workitemsbatch?api-version=7.1
// Body: { ids: [...], fields: ['System.Id','System.Title','System.State'], errorPolicy: 'omit' }

const openTasks = batchResult.value.filter(
  item => item.fields['System.State'] !== 'Resolved'
);
```

### azdev-task-map.json Read Pattern (in execute-phase skill)
```javascript
// Read from .planning/azdev-task-map.json if it exists
const mapPath = path.join(cwd, '.planning', 'azdev-task-map.json');
if (fs.existsSync(mapPath)) {
  const map = JSON.parse(fs.readFileSync(mapPath, 'utf-8'));
  // map.mappings[0].storyId, map.mappings[0].taskIds
}
// If map not found: skip status updates silently (non-blocking)
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `"replace"` op for field updates | `"add"` op works for both set and update | Always correct per API docs | Use `"add"` consistently |
| Separate API calls per child | Batch GET via `workitemsbatch` | API 6.0+ | Single call for all sibling states |
| Polling for child completion | One-shot check at execution boundary | Locked decision | No polling — check once at end |

**Deprecated/outdated:**
- Querying children via WIQL: Heavier query language; batch GET with relations expand is simpler for this use case.

---

## Open Questions

1. **Exact state names in the project's DevOps process**
   - What we know: Agile template uses "New/Active/Resolved/Closed"; Scrum uses "New/Approved/Committed/Done". The project uses "Verdo Agile Development".
   - What's unclear: The actual process template name and its exact state labels. The CONTEXT.md says "New → Active → Closed" but the API response may use "Resolved" between Active and Closed.
   - Recommendation: The `update-state` command should accept the state string as a parameter (not hardcode it). The skill documentation should note the actual states used. The executor can verify by reading the current state from a GET call first, or by inspecting a live work item via `/gsd:azdev-sprint`.

2. **Whether execute-phase.md should be modified vs. a new azdo-execute.md wrapper**
   - What we know: `execute-phase.md` at `~/.claude/commands/gsd/` wraps the GSD workflow. The CONTEXT.md says "how to hook into execute-phase" is Claude's discretion.
   - What's unclear: Modifying `execute-phase.md` affects all GSD projects. A new `azdo-execute.md` skill would be project-specific but requires users to use a different command name.
   - Recommendation: Modify `execute-phase.md` to conditionally call status updates if `.planning/azdev-task-map.json` exists. This keeps the single command name while making the feature opt-in (map file = feature active).

3. **PAT write scope for existing users**
   - What we know: Phase 1 set up PAT during setup. `vso.work_write` may or may not have been included.
   - What's unclear: Whether the current stored PAT already has write scope.
   - Recommendation: Add a `test-write` check to `azdev-tools.cjs` or include scope verification in the skill's error handling. If 403, provide the upgrade instruction.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | None — smoke tests via CLI tool with real credentials (same pattern as Phase 3) |
| Config file | None |
| Quick run command | `node ~/.claude/get-shit-done/bin/azdev-tools.cjs update-state --id {testItemId} --state Active --cwd .` |
| Full suite command | Manual smoke test — run execute-phase on a test story and verify DevOps state changes |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| STAT-01 (task Active) | Task moves to Active when execute-phase starts | smoke | `node ~/.claude/get-shit-done/bin/azdev-tools.cjs update-state --id {id} --state Active --cwd . && echo OK` | ❌ Wave 0 |
| STAT-01 (task Resolved) | Task moves to Resolved when execute-phase completes | smoke | `node ~/.claude/get-shit-done/bin/azdev-tools.cjs update-state --id {id} --state Resolved --cwd . && echo OK` | ❌ Wave 0 |
| STAT-01 (sibling check) | Story stays Active when non-code siblings remain open | smoke | `node ~/.claude/get-shit-done/bin/azdev-tools.cjs get-child-states --id {storyId} --cwd . \| node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); process.exit(d.allResolved ? 0 : 1)"` | ❌ Wave 0 |
| STAT-01 (story Resolved) | Story moves to Resolved when all children Resolved | manual | Run execute-phase with a story whose tasks are all code tasks, verify story state in DevOps | manual-only |

### Sampling Rate
- **Per task commit:** `node ~/.claude/get-shit-done/bin/azdev-tools.cjs update-state --id {id} --state Active --cwd .` exits 0
- **Per wave merge:** Manual check — verify story state in Azure DevOps UI
- **Phase gate:** Full manual smoke test before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `azdev-tools.cjs` — add `update-state` command (covers STAT-01 task state updates)
- [ ] `azdev-tools.cjs` — add `get-child-states` command (covers STAT-01 sibling check)
- [ ] `.planning/azdev-task-map.json` schema — defined by azdev-analyze.md modification
- [ ] No test framework needed — same pattern as Phase 3 (smoke tests via CLI with real credentials)

---

## Sources

### Primary (HIGH confidence)
- [Microsoft Learn: Work Items - Update (REST API 7.1)](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/update?view=azure-devops-rest-7.1) — PATCH request format, `op: "add"` for System.State, HTTP 200 response shape, vso.work_write scope requirement
- [Microsoft Learn: Work Items - Get Work Items Batch (REST API 7.1)](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/get-work-items-batch?view=azure-devops-rest-7.1) — Batch GET pattern for sibling state reads
- `~/.claude/get-shit-done/bin/azdev-tools.cjs` (local) — existing `makePatchRequest()`, `makeRequest()`, `loadConfig()`, `cmdUpdateDescription()` patterns
- `~/.claude/commands/gsd/execute-phase.md` (local) — hook point locations: `initialize` step and `update_roadmap` step
- `~/.claude/commands/gsd/azdev-analyze.md` (local) — where task-map write logic should be added
- `.planning/phases/04-status/04-CONTEXT.md` — locked decisions and discretion areas

### Secondary (MEDIUM confidence)
- WebSearch (2026-03-04) — confirmed `System.LinkTypes.Hierarchy-Forward` as the relation type for parent→child links in Azure DevOps

### Tertiary (LOW confidence)
- State names ("New/Active/Resolved/Closed") assumed from Agile process template — not verified against the actual "Verdo Agile Development" process. **Flag for validation during execution.**

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all existing code verified in-project; API docs verified at Microsoft Learn
- Architecture: HIGH — patterns derived directly from existing `cmdUpdateDescription()` and execute-phase workflow structure
- State names: LOW — assumed Agile process template; actual process states for "Verdo Agile Development" not confirmed
- Hook points: HIGH — execute-phase workflow steps clearly named; modification approach confirmed by reading workflow file

**Research date:** 2026-03-04
**Valid until:** 2026-04-04 (Azure DevOps API 7.1 is stable; GSD workflow files are local and versioned)
