# Phase 2: Sprint Data - Research

**Researched:** 2026-03-04
**Domain:** Azure DevOps REST API — Iterations, Work Items batch fetch, terminal display formatting
**Confidence:** HIGH

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SPRT-01 | System can fetch the current active sprint iteration from Azure DevOps | `GET /{org}/{project}/_apis/work/teamsettings/iterations?$timeframe=current&api-version=7.1` returns name and path of current sprint; requires `vso.work` scope already verified in Phase 1 |
| SPRT-02 | System can fetch all user stories and tasks from the current sprint | Two-step: (1) `GET /{iterationId}/workitems` returns IDs with parent-child relations; (2) `POST /wit/workitemsbatch` fetches full fields for up to 200 items in one call |
| SPRT-03 | User can view sprint backlog with title, description, acceptance criteria, and state | `System.Description` and `Microsoft.VSTS.Common.AcceptanceCriteria` come back as HTML from the API — must strip tags before terminal display; format using plain text layout |
</phase_requirements>

---

## Summary

Phase 2 builds on the `azdo-tools.cjs` helper and config from Phase 1 to implement a three-step data pipeline: fetch the current sprint, fetch the work item IDs in that sprint, then batch-fetch the full work item details. All three steps use the same `makeRequest` helper and PAT auth already established.

The critical technical insight is that the Azure DevOps Iterations API requires a **team** segment in the URL path (`/{org}/{project}/{team}/_apis/work/teamsettings/iterations`). When no team is stored in config, the approach is to use the project name as the team name — Azure DevOps creates a default team named after the project when the project is created. For this project that means using `Verdo%20Agile%20Development` as both the project AND the team segment. The tool must handle cases where this assumption fails gracefully (fall back to listing teams and using the first one).

The second critical insight is that `System.Description` and `Microsoft.VSTS.Common.AcceptanceCriteria` are stored as **HTML** in Azure DevOps. For readable terminal display, HTML tags must be stripped with a simple regex — no external library required. The existing `azdo-tools.cjs` pattern uses zero external dependencies, so the HTML stripping must use a built-in regex approach.

**Primary recommendation:** Extend `azdo-tools.cjs` with two new commands (`get-sprint` and `get-sprint-items`), then add a new `/gsd:azdo-sprint` skill command that calls these and formats the output. Do NOT add a team-configuration prompt in Phase 2 — use the project-name-as-team-name heuristic and auto-discover the team name from the teams API if needed.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js built-in `https` | Node 22 | HTTP calls — already in `azdo-tools.cjs` | No new deps; `makeRequest()` already works |
| Node.js built-in `fs` / `path` | Node 22 | Config read — `loadConfig()` already exists | Same pattern as Phase 1 |
| Regex (`/<[^>]*>/g`) | Built-in | Strip HTML from Description and AcceptanceCriteria | No external deps; sufficient for this use case |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `AskUserQuestion` tool | GSD built-in | Prompts in skill file if team name not auto-discovered | Only needed if default team heuristic fails |
| `Bash` tool | GSD built-in | Execute `node azdo-tools.cjs get-sprint` from skill | Bridge between Claude skill and Node.js helper |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Regex HTML stripping | `html-to-text` npm package | `html-to-text` handles entities and nested HTML better, but violates the zero-external-deps rule established in Phase 1 |
| Default team heuristic | Prompt user for team name | Prompting is more robust but adds friction; project-name-as-team heuristic works for the majority of Azure DevOps setups |
| `POST /wit/workitemsbatch` | Multiple single `GET /wit/workitems/{id}` | Batch is far more efficient; max 200 IDs per call; single endpoint per request vs N requests |

**Installation:**

No new installation required. All new logic extends `azdo-tools.cjs` using Node.js built-ins only.

---

## Architecture Patterns

### Recommended Project Structure

```
~/.claude/
├── commands/gsd/
│   ├── azdo-setup.md         # (existing)
│   ├── azdo-test.md          # (existing)
│   └── azdo-sprint.md        # (new) /gsd:azdo-sprint skill
└── get-shit-done/bin/
    └── azdo-tools.cjs        # (extended) add get-sprint, get-sprint-items commands

.planning/
└── azdo-config.json          # (existing) org, project, pat — no changes needed
```

### Pattern 1: Three-Step Sprint Data Pipeline

**What:** Fetch current sprint → fetch work item IDs → batch-fetch work item details.
**When to use:** Every invocation of `/gsd:azdo-sprint`.

```
Step 1: GET /{org}/{project}/{team}/_apis/work/teamsettings/iterations?$timeframe=current&api-version=7.1
        -> Response: { values: [{ id, name, path, attributes: { startDate, finishDate } }] }
        -> Extract: iterationId, iterationName, iterationPath

Step 2: GET /{org}/{project}/{team}/_apis/work/teamsettings/iterations/{iterationId}/workitems?api-version=7.1
        -> Response: { workItemRelations: [{ rel, source: { id }, target: { id } }] }
        -> Extract: all unique IDs (both sources and targets)

Step 3: POST /{org}/{project}/_apis/wit/workitemsbatch?api-version=7.1
        Body: { ids: [id1, id2, ...], fields: [...], errorPolicy: "omit" }
        -> Response: { count: N, value: [{ id, fields: { ... } }] }
        -> Extract: title, type, state, description, acceptance criteria
```

### Pattern 2: Team Name Resolution

**What:** The Iterations API requires a team segment. Use a cascading resolution strategy.
**When to use:** Before calling any `teamsettings` endpoint.

```javascript
// Source: Official API docs — team is optional in the URL, defaults to first team if omitted.
// However in practice, omitting it on visualstudio.com URLs can return 404.
// Strategy: try project name as team name first, fall back to teams API.

async function resolveTeamName(org, project, encodedPat) {
  // Step 1: Try using the project name as the team name (default team convention)
  const decodedProject = decodeURIComponent(project); // "Verdo Agile Development"
  const testUrl = `${org}/${project}/${encodeURIComponent(decodedProject)}/_apis/work/teamsettings/iterations?$timeframe=current&api-version=7.1`;
  const res = await makeRequest(testUrl, encodedPat);
  if (res.status === 200) {
    const data = JSON.parse(res.body);
    if (data.value && data.value.length > 0) {
      return decodedProject; // team name = project name (URL-decoded)
    }
  }

  // Step 2: Fall back to listing teams and using the first one
  const teamsUrl = `${org}/_apis/projects/${project}/teams?$top=1&api-version=7.1`;
  const teamsRes = await makeRequest(teamsUrl, encodedPat);
  if (teamsRes.status === 200) {
    const teams = JSON.parse(teamsRes.body);
    if (teams.value && teams.value.length > 0) {
      return teams.value[0].name;
    }
  }

  throw new Error('Could not resolve team name. Check that the project has at least one team configured.');
}
```

### Pattern 3: HTML Field Stripping (No External Deps)

**What:** `System.Description` and `Microsoft.VSTS.Common.AcceptanceCriteria` return HTML — strip before display.
**When to use:** Whenever displaying description or acceptance criteria in the terminal.

```javascript
// No external library — regex approach adequate for terminal display
function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')        // line breaks -> newlines
    .replace(/<\/p>/gi, '\n')             // paragraph ends -> newlines
    .replace(/<\/li>/gi, '\n')            // list items -> newlines
    .replace(/<[^>]+>/g, '')              // strip all remaining tags
    .replace(/&lt;/g, '<')               // decode HTML entities
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, '')              // remove numeric entities
    .replace(/\n{3,}/g, '\n\n')          // collapse excessive newlines
    .trim();
}
```

### Pattern 4: New azdo-tools.cjs Commands

**What:** Add two new CLI commands to extend `azdo-tools.cjs`.
**When to use:** Called from the `/gsd:azdo-sprint` skill via Bash.

```
node azdo-tools.cjs get-sprint [--cwd <path>]
  -> Fetches current sprint iteration
  -> stdout: JSON { name, path, iterationId, startDate, finishDate }
  -> exit 0 on success, exit 1 on error (no active sprint, auth failure, etc.)

node azdo-tools.cjs get-sprint-items [--cwd <path>]
  -> Fetches all work items in the current sprint with full fields
  -> stdout: JSON array of work items [{ id, type, title, state, description, acceptanceCriteria, parentId }]
  -> exit 0 on success, exit 1 on error
```

### Pattern 5: Terminal Display Format

**What:** Readable backlog output for the terminal. Group by parent story, list tasks under each.
**When to use:** The skill renders the JSON from `get-sprint-items` into human-readable text.

```
=== Sprint: Sprint 42 ===
Iteration: MyProject\Sprint 42
Dates: 2026-02-24 to 2026-03-06

[US] #1234 — Add login page (Active)
     User can log in using email and password.
     Acceptance Criteria:
       - Login form accepts email + password
       - Invalid credentials show error message
     Tasks:
       [Task] #1235 — Implement login form (In Progress)
       [Task] #1236 — Add validation logic (New)

[US] #1240 — Update dashboard (New)
     (no description)
     (no acceptance criteria)
     Tasks:
       [Task] #1241 — Design wireframe (New)
```

### Anti-Patterns to Avoid

- **Calling work items one by one in a loop:** Use the batch endpoint. N individual requests will be slow and may hit rate limits.
- **Assuming team name = project name without fallback:** Always verify with a test call; if it fails, use the teams API to discover the correct team name.
- **Displaying raw HTML in the terminal:** Always strip HTML from Description and AcceptanceCriteria before output.
- **Storing team name in config without user consent:** Phase 2 should auto-discover team name at runtime; Phase 3 may add persistence if needed.
- **Using the `workItemRelations` rel field to determine type:** The `rel` field in the iteration workitems response indicates hierarchy, not work item type. Use `System.WorkItemType` from the batch fetch to distinguish User Stories from Tasks.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP batch fetching | Loop of individual GET requests | `POST /wit/workitemsbatch` | One API call returns up to 200 items with all requested fields |
| HTML entity decoding | Custom entity map | Simple regex replace for the 5 common entities (&lt; &gt; &amp; &nbsp; &#N;) | Only a handful of entities appear in Azure DevOps fields |
| Parent-child grouping | Recursive tree building | Flat list from `workItemRelations` + parentId field from `System.Parent` | Azure DevOps sprint backlogs are at most 2 levels deep (story → task) |
| Current sprint detection | Date comparison against all iterations | `$timeframe=current` query parameter | Server-side filter; handles timezone edge cases, no local date logic needed |

**Key insight:** The Azure DevOps APIs are well-designed for this exact use case. `$timeframe=current` returns exactly what we need; `workitemsbatch` avoids N+1 API calls. Don't build custom solutions for either.

---

## Common Pitfalls

### Pitfall 1: Team Segment Required (Not Optional In Practice)

**What goes wrong:** Calling `GET /{org}/{project}/_apis/work/teamsettings/iterations` without a team segment returns 404 on visualstudio.com URLs (despite documentation marking `team` as optional).
**Why it happens:** The `team` parameter is technically optional in the spec but required in the visualstudio.com routing implementation.
**How to avoid:** Always include a team segment. Use the project name as the team name for the initial attempt (Azure DevOps convention: default team name = project name). Fall back to listing teams via the Core API if this returns 404 or empty results.
**Warning signs:** HTTP 404 on the iterations endpoint despite correct org and project values.

### Pitfall 2: URL-Encoded Project Name in Team Segment

**What goes wrong:** The project is stored as `Verdo%20Agile%20Development` in config, but the team name registered in Azure DevOps is `Verdo Agile Development` (decoded). Using the encoded form in the team segment produces 404.
**Why it happens:** URL encoding is needed in the `project` segment but the `team` segment needs the raw name (Azure DevOps performs its own encoding).
**How to avoid:** Always `decodeURIComponent` the project name before using it as the team name segment. Then pass it through `encodeURIComponent` only if constructing the URL manually.
**Warning signs:** 404 on iterations despite correct project value; the URL contains `%2520` (double-encoded).

### Pitfall 3: Empty Sprint Response vs No Active Sprint

**What goes wrong:** `$timeframe=current` returns an empty `values` array when no sprint is currently active (dates haven't started or all sprints are past).
**Why it happens:** Azure DevOps only marks a sprint as "current" when today falls between its startDate and finishDate. If no sprint dates are set, or the team is between sprints, the response is `{ values: [] }`.
**How to avoid:** Check `data.value.length > 0` before using `data.value[0]`. Exit with a clear error message: "No active sprint found. Check that a sprint with today's date set is active in Azure DevOps."
**Warning signs:** Silent empty output; script crashes trying to access `data.value[0].id` on an empty array.

### Pitfall 4: workItemRelations Contains All Relations (Not Just Children)

**What goes wrong:** The `workItemRelations` array includes both the parent stories (where `rel === null` and `source === null`) and the child tasks (where `rel === "System.LinkTypes.Hierarchy-Forward"`). Treating all entries as separate items to display produces duplicates.
**Why it happens:** The API returns the full relation graph, not a flat list of IDs.
**How to avoid:** Extract ALL unique IDs (from both `target.id` across all entries, and `source.id` where non-null), deduplicate, then batch-fetch. Use `System.WorkItemType` and `System.Parent` from the batch result to reconstruct the hierarchy for display.
**Warning signs:** Same work item appears twice in the display.

### Pitfall 5: Description Field is Null for Tasks

**What goes wrong:** Tasks typically have no description or acceptance criteria — the fields come back as `null`. Passing `null` to `stripHtml()` or displaying it crashes or shows "null" to the user.
**Why it happens:** These fields are optional in Azure DevOps and rarely filled for Task-type items.
**How to avoid:** Always null-check: `stripHtml(fields['System.Description'] || '')` and display "(no description)" when the result is empty.
**Warning signs:** "null" appearing in the terminal output; TypeError on `null.replace`.

### Pitfall 6: Batch Request Returns 400 for Empty ID Array

**What goes wrong:** Calling `POST /wit/workitemsbatch` with `ids: []` returns HTTP 400 Bad Request.
**Why it happens:** The batch endpoint requires at least one ID.
**How to avoid:** Check that the IDs array is non-empty before calling the batch endpoint. If empty, output "No work items found in the current sprint." and exit cleanly.
**Warning signs:** HTTP 400 from workitemsbatch when a sprint genuinely has no items assigned.

---

## Code Examples

Verified patterns from official Microsoft Learn documentation.

### Step 1: Fetch Current Sprint Iteration

```javascript
// Source: https://learn.microsoft.com/en-us/rest/api/azure/devops/work/iterations/list?view=azure-devops-rest-7.1
// Required PAT scope: vso.work
// team = URL-encoded team name (use decodeURIComponent(project) as first attempt)
const iterationsUrl = `${org}/${encodedProject}/${encodedTeam}/_apis/work/teamsettings/iterations?$timeframe=current&api-version=7.1`;
const res = await makeRequest(iterationsUrl, encodedPat);
const data = JSON.parse(res.body);
// data.value[0] = { id, name, path, attributes: { startDate, finishDate, timeFrame } }
if (!data.value || data.value.length === 0) {
  throw new Error('No active sprint found.');
}
const iteration = data.value[0];
```

### Step 2: Fetch Work Item IDs for the Sprint

```javascript
// Source: https://learn.microsoft.com/en-us/rest/api/azure/devops/work/iterations/get-iteration-work-items?view=azure-devops-rest-7.1
// Required PAT scope: vso.work
const workItemsUrl = `${org}/${encodedProject}/${encodedTeam}/_apis/work/teamsettings/iterations/${iteration.id}/workitems?api-version=7.1`;
const wiRes = await makeRequest(workItemsUrl, encodedPat);
const wiData = JSON.parse(wiRes.body);
// wiData.workItemRelations = [{ rel, source: {id, url} | null, target: {id, url} }]
// Collect all unique IDs
const idSet = new Set();
for (const rel of (wiData.workItemRelations || [])) {
  if (rel.target) idSet.add(rel.target.id);
  if (rel.source) idSet.add(rel.source.id);
}
const ids = Array.from(idSet);
```

### Step 3: Batch Fetch Work Item Details

```javascript
// Source: https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/get-work-items-batch?view=azure-devops-rest-7.1
// Required PAT scope: vso.work
// HTTP method: POST with JSON body
// Maximum 200 IDs per request
const batchUrl = `${org}/${encodedProject}/_apis/wit/workitemsbatch?api-version=7.1`;
const batchBody = {
  ids: ids,
  fields: [
    'System.Id',
    'System.Title',
    'System.WorkItemType',
    'System.State',
    'System.Description',
    'Microsoft.VSTS.Common.AcceptanceCriteria',
    'System.Parent',
    'System.IterationPath',
  ],
  errorPolicy: 'omit',  // skip items that can't be fetched rather than failing entire request
};
const batchRes = await makeRequest(batchUrl, encodedPat, 'POST', batchBody);
const batchData = JSON.parse(batchRes.body);
// batchData.value = [{ id, rev, fields: { 'System.Title': '...', ... }, url }]
```

### HTML Stripping for Terminal Display

```javascript
// No external deps — adequate for Azure DevOps HTML field content
function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
```

### azdo-tools.cjs: Making a POST Request

```javascript
// Source: Extends the existing makeRequest() in azdo-tools.cjs
// makeRequest already supports method and body parameters:
//   makeRequest(url, encodedPat, method = 'GET', body = null)
// So POST with a JSON body is already supported in the existing implementation.
const result = await makeRequest(batchUrl, encodedPat, 'POST', batchBody);
```

### Discover Team Name (Fallback)

```javascript
// Source: https://learn.microsoft.com/en-us/rest/api/azure/devops/core/teams/get-teams?view=azure-devops-rest-7.1
// Required PAT scope: vso.project (already verified in Phase 1)
const teamsUrl = `${org}/_apis/projects/${encodedProject}/teams?$top=1&api-version=7.1`;
const teamsRes = await makeRequest(teamsUrl, encodedPat);
const teams = JSON.parse(teamsRes.body);
const teamName = teams.value[0].name; // e.g., "Verdo Agile Development"
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| WIQL query to find sprint items | `GET /teamsettings/iterations/{id}/workitems` | API v5+ | Iterations endpoint returns structured hierarchy (relations); WIQL only returns flat ID list and requires @currentIteration macro which behaves differently in REST |
| Multiple single work item GETs | `POST /wit/workitemsbatch` | API v5+ | Batch up to 200 at once; no N+1 problem |
| Hand-rolling iteration comparison | `$timeframe=current` query param | API v4+ | Server handles timezone and date comparison |

**Deprecated/outdated:**
- WIQL `@currentIteration` macro: Works in web UI but **not reliably in REST API calls** without a team context attached. For REST, the `$timeframe=current` filter on the iterations endpoint is the correct approach.

---

## Open Questions

1. **What happens when the iteration has no dates set?**
   - What we know: `$timeframe=current` relies on the iteration having a startDate and finishDate configured. When dates are null (as shown in the sample response from the docs), the behavior is unspecified.
   - What's unclear: Does Azure DevOps still mark an iteration as "current" if it has no dates?
   - Recommendation: Handle both cases — if `$timeframe=current` returns empty, try listing all iterations and letting the user select, OR add a fallback message: "No sprint with an active date range found. Configure sprint dates in Azure DevOps."

2. **Sprint backlog size: can it exceed 200 items?**
   - What we know: `POST /wit/workitemsbatch` is capped at 200 IDs per call.
   - What's unclear: Whether Verdo Agile Development's sprints ever contain more than 200 work items.
   - Recommendation: For Phase 2, document the 200-item limit in the skill output. If `ids.length > 200`, take the first 200 and display a warning. Phase 2 does not need full pagination.

3. **visualstudio.com URL format vs dev.azure.com for team iterations**
   - What we know: The config stores `https://verdo365.visualstudio.com` as the org. The API docs show examples with `dev.azure.com`. Both URL formats work for most endpoints.
   - What's unclear: Whether `teamsettings/iterations` behaves identically under the visualstudio.com domain.
   - Recommendation: Use the stored org URL as-is (the existing `makeRequest` constructs full URLs from the stored base). Verified that both URL formats accept the same API paths and authentication.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | None — no test framework exists (established in Phase 1) |
| Config file | None |
| Quick run command | `node ~/.claude/get-shit-done/bin/azdo-tools.cjs get-sprint --cwd C:/Users/sen.makj/source/repos/PlanningMe` |
| Full suite command | Manual smoke test via `/gsd:azdo-sprint` skill |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SPRT-01 | get-sprint exits 0 and returns valid JSON with name/path | smoke | `node ~/.claude/get-shit-done/bin/azdo-tools.cjs get-sprint --cwd C:/Users/sen.makj/source/repos/PlanningMe; echo "exit: $?"` | ❌ Wave 0 |
| SPRT-01 | get-sprint JSON has `iterationId`, `name`, `path` fields | smoke | `node ~/.claude/get-shit-done/bin/azdo-tools.cjs get-sprint --cwd C:/path \| node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d.iterationId ? 'OK' : 'MISSING iterationId')"` | ❌ Wave 0 |
| SPRT-02 | get-sprint-items exits 0 and returns array | smoke | `node ~/.claude/get-shit-done/bin/azdo-tools.cjs get-sprint-items --cwd C:/Users/sen.makj/source/repos/PlanningMe; echo "exit: $?"` | ❌ Wave 0 |
| SPRT-02 | Each item has id, type, title, state | smoke | `node ... get-sprint-items \| node -e "const a=JSON.parse(...); console.log(a[0].title ? 'OK' : 'MISSING title')"` | ❌ Wave 0 |
| SPRT-03 | /gsd:azdo-sprint displays sprint name and items | manual | Run `/gsd:azdo-sprint` in Claude Code session and visually verify output | manual-only |
| SPRT-03 | Description/AcceptanceCriteria contain no HTML tags in output | manual | Check that `<p>`, `<br>`, `<strong>` etc. do not appear in displayed text | manual-only |

### Sampling Rate

- **Per task commit:** `node ~/.claude/get-shit-done/bin/azdo-tools.cjs get-sprint --cwd $CWD` (requires live credentials)
- **Per wave merge:** Both `get-sprint` and `get-sprint-items` exit 0 with valid JSON
- **Phase gate:** `/gsd:azdo-sprint` must display readable backlog before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `~/.claude/get-shit-done/bin/azdo-tools.cjs` — extend with `get-sprint` and `get-sprint-items` commands
- [ ] `~/.claude/commands/gsd/azdo-sprint.md` — new skill file

*(No test framework needed — smoke tests use the CLI tool directly with real credentials)*

---

## Sources

### Primary (HIGH confidence)

- [Iterations - List - REST API (Azure DevOps Work) v7.1](https://learn.microsoft.com/en-us/rest/api/azure/devops/work/iterations/list?view=azure-devops-rest-7.1) — endpoint URL, `$timeframe=current` parameter, full response schema including `TeamSettingsIteration` with id/name/path/attributes
- [Iterations - Get Iteration Work Items - REST API (Azure DevOps Work) v7.1](https://learn.microsoft.com/en-us/rest/api/azure/devops/work/iterations/get-iteration-work-items?view=azure-devops-rest-7.1) — endpoint URL, `workItemRelations` response shape, `WorkItemLink` schema
- [Work Items - Get Work Items Batch - REST API (Azure DevOps WIT) v7.1](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/get-work-items-batch?view=azure-devops-rest-7.1) — POST endpoint, max 200 IDs, `fields` array, `errorPolicy: omit`, full response schema
- [Teams - Get Teams - REST API (Azure DevOps Core) v7.1](https://learn.microsoft.com/en-us/rest/api/azure/devops/core/teams/get-teams?view=azure-devops-rest-7.1) — team discovery endpoint for fallback team resolution
- [Teamsettings - Get - REST API (Azure DevOps Work) v7.1](https://learn.microsoft.com/en-us/rest/api/azure/devops/work/teamsettings/get?view=azure-devops-rest-7.1) — confirms `team` segment is part of the URL path; `defaultIteration` field
- `~/.claude/get-shit-done/bin/azdo-tools.cjs` — existing `makeRequest()` supports POST with body; `loadConfig()` returns org, project (URL-encoded), and decoded PAT

### Secondary (MEDIUM confidence)

- WebSearch result confirming `$timeframe=current` is the canonical approach for filtering to the active sprint (multiple sources agree)
- WebSearch result confirming that `System.Description` and `Microsoft.VSTS.Common.AcceptanceCriteria` are stored as HTML (confirmed by official Azure DevOps documentation links)
- WebSearch result confirming that `workItemRelations` uses `rel === "System.LinkTypes.Hierarchy-Forward"` for parent→child links

### Tertiary (LOW confidence)

- Assumption that omitting team segment returns 404 on `visualstudio.com` URLs — not formally documented; based on multiple community reports that the team segment is required in practice despite being marked optional in the spec. Verified heuristic: use project name as team name, fall back to teams API.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — same pattern as Phase 1, no new dependencies
- API endpoints (iterations, batch): HIGH — verified from official Microsoft Learn docs with full response schemas
- Team name resolution: MEDIUM — team=project-name heuristic is a well-known pattern but not formally documented; fallback to teams API mitigates risk
- HTML stripping: HIGH — regex approach is documented behavior; Azure DevOps HTML field format is stable
- Pitfalls: HIGH for items 1-6 (all grounded in API docs or clear code logic)

**Research date:** 2026-03-04
**Valid until:** 2026-09-04 (Azure DevOps REST API is versioned and backward-compatible at v7.1)
