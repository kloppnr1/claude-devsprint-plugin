# Phase 3: Analysis - Research

**Researched:** 2026-03-04
**Domain:** Azure DevOps REST API (Git branch links, repository lookup), Node.js child_process for git clone, GSD project bootstrapping (PROJECT.md + ROADMAP.md generation)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Task selection**: Story-level only — if a task ID is passed, roll up to its parent story
- **`--me` filter**: Analyze only items assigned to the authenticated user
- **All stories processed at once** across all target repos in one go
- **Always fetch fresh from Azure DevOps API** (no caching)
- **Unified analysis per story** (story + all child tasks together)
- **Repo resolution**: Resolve target repo from the branch link on the user story (Azure DevOps API). No manual repo mapping. Branch link is the source of truth.
- **If repo not found locally**: prompt user whether to clone. If yes, clone and continue.
- **No REPO-01/REPO-02 manual mapping needed** — replaced by branch link resolution
- **Analysis output**: Full GSD-style project bootstrap in each target repo (PROJECT.md + ROADMAP.md from DevOps story data)
- **Essentially a smart `/gsd:new-project`** using Azure DevOps data as input instead of user questions
- **Plans live in the target repo's `.planning/`** — standard GSD structure
- **Multi-repo handling**: One sprint can span multiple repos; process all in one go, bootstrap GSD in each target repo
- **Approval flow**: User reviews and approves the generated PROJECT.md/ROADMAP.md per target repo
- **Phase 4 implication (captured early)**: Status updates should happen automatically when GSD completes execution — no manual command needed

### Claude's Discretion

- How to extract repo info from branch link API response
- PROJECT.md/ROADMAP.md generation structure and mapping from DevOps fields
- Clone location if repo not found locally
- How to present multi-repo summary before processing

### Deferred Ideas (OUT OF SCOPE)

- Automatic status updates on execution completion — Phase 4 scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| REPO-01 | System asks user for local repo path when encountering a new DevOps project | Superseded by branch link resolution — no manual mapping needed; branch link on user story is the source of truth for repo resolution |
| REPO-02 | System remembers repo mappings for subsequent sessions | Superseded by branch link resolution — each run fetches fresh from API; no stored mapping needed |
| ANAL-01 | User can select a task from the sprint backlog for AI analysis | `get-sprint-items --me` already returns story+task hierarchy; new `get-branch-links` command fetches ArtifactLink relations from work items using `$expand=relations` |
| ANAL-02 | AI analyzes the selected task and produces a technical breakdown (subtasks, approach, risks) | Claude skill generates PROJECT.md + ROADMAP.md from story title, description, acceptanceCriteria, and child tasks — equivalent to `/gsd:new-project` with AzDO data as input |
| ANAL-03 | User can review the analysis result and approve or request changes | Approval loop per repo: show generated PROJECT.md/ROADMAP.md, AskUserQuestion approve/edit, re-generate on rejection |
</phase_requirements>

---

## Summary

Phase 3 builds on the existing `azdo-tools.cjs` and `get-sprint-items --me` output from Phase 2 to implement a complete "sprint-to-GSD-project" pipeline. The key insight from the CONTEXT.md is that the user redesigned the approach: **branch links on user stories replace manual repo mapping entirely**. Each Azure DevOps user story that has a branch link attached contains the `repositoryId` of the target repo encoded in an `ArtifactLink` relation URL (`vstfs:///Git/Ref/{projectId}/{repositoryId}/GB{branchName}`). This repositoryId is then used to look up the full repository details (including `remoteUrl` and `name`) via the Git Repositories API.

The second key insight is that the analysis output is not a custom data structure — it is a standard **GSD project bootstrap**: `PROJECT.md` and `ROADMAP.md` written directly into the target repo's `.planning/` directory. The skill synthesizes these documents from the Azure DevOps story data (title, description, acceptance criteria, child tasks) and then hands off to standard GSD commands. This avoids building any custom analysis output format and leverages the entire existing GSD execution pipeline.

The new `/gsd:azdo-analyze` skill orchestrates: fetch sprint items (reusing existing `get-sprint-items --me`), extract branch links via a new `get-branch-links` command, resolve local repo paths (check if cloned, prompt to clone if not), show multi-repo summary, then generate and write PROJECT.md + ROADMAP.md per repo, and present each for approval.

**Primary recommendation:** Add one new azdo-tools.cjs command (`get-branch-links`), add a new `/gsd:azdo-analyze` skill, and use the existing GSD PROJECT.md + ROADMAP.md templates as the output format. All repo resolution happens via the Azure DevOps Git API with no stored mappings.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js built-in `https` | Node 22 | API calls — `makeRequest()` already in `azdo-tools.cjs` | No new deps; zero external dependencies rule |
| Node.js built-in `child_process` | Node 22 | Execute `git clone` for repos not found locally | Built-in; no external deps; simple `execSync` wrapper |
| Node.js built-in `fs` / `path` | Node 22 | Write PROJECT.md / ROADMAP.md to target repo's `.planning/` | Same pattern as existing config I/O |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `AskUserQuestion` tool | GSD built-in | Prompt per repo: approve/edit generated files; prompt if no branch link found | Only for interactive approval gates |
| `Bash` tool | GSD built-in | Execute azdo-tools.cjs commands and `git clone` from skill | Bridge between Claude skill and Node.js helper |
| `Write` tool | GSD built-in | Write PROJECT.md and ROADMAP.md directly to target repo | Claude writes markdown files directly without exec |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Branch link extraction from API | Stored repo mapping (original REPO-01/02) | Branch link is always fresh and correct — stored mappings go stale when devs switch branches/repos |
| Claude writing PROJECT.md directly (`Write` tool) | `azdo-tools.cjs` writing the files | Claude has better judgment for synthesizing prose; the tool is better for raw data; split at the natural boundary |
| `child_process.execSync` for git clone | `child_process.exec` async | `execSync` simpler in CLI context; clone is user-triggered and blocking is acceptable in interactive skill |

**Installation:**

No new npm packages required. All new logic uses Node.js built-ins only.

---

## Architecture Patterns

### Recommended Project Structure

```
~/.claude/
├── commands/gsd/
│   ├── azdo-setup.md         # (existing)
│   ├── azdo-test.md          # (existing)
│   ├── azdo-sprint.md        # (existing)
│   └── azdo-analyze.md       # (new) /gsd:azdo-analyze skill
└── get-shit-done/bin/
    └── azdo-tools.cjs        # (extended) add get-branch-links command

.planning/
└── azdo-config.json          # (existing) no changes

[target-repo-1]/
└── .planning/
    ├── PROJECT.md            # (new, generated) synthesized from AzDO story
    └── ROADMAP.md            # (new, generated) synthesized from AzDO story

[target-repo-2]/
└── .planning/
    ├── PROJECT.md            # (new, generated)
    └── ROADMAP.md            # (new, generated)
```

### Pattern 1: Branch Link Extraction Pipeline

**What:** Fetch work item with expanded relations, filter for ArtifactLink relations with `name: "Branch"`, parse the vstfs URI to extract repositoryId, then look up repository details.
**When to use:** For each user story that needs analysis.

```
Step 1: GET /{org}/{project}/_apis/wit/workitems/{id}?$expand=relations&api-version=7.1
        -> Response includes relations[] array
        -> Filter: rel === "ArtifactLink" && attributes.name === "Branch"
        -> Each matching relation has url: "vstfs:///Git/Ref/{projectId}/{repositoryId}/GB{branchName}"

Step 2: Parse vstfs URI
        -> Split on "/" after "vstfs:///Git/Ref/"
        -> Parts: [projectId, repositoryId, "GB{branchName}"]
        -> repositoryId = parts[1] (GUID)
        -> branchName = parts[2].replace(/^GB/, '')  // strip "GB" prefix

Step 3: GET /{org}/{project}/_apis/git/repositories/{repositoryId}?api-version=7.1
        -> Response: { id, name, remoteUrl, defaultBranch, project: { name } }
        -> remoteUrl is the HTTPS clone URL: "https://dev.azure.com/org/proj/_git/reponame"
```

### Pattern 2: azdo-tools.cjs `get-branch-links` Command

**What:** New CLI command that takes a work item ID and returns branch link data for that story.
**When to use:** Called once per user story to resolve its target repo.

```javascript
// New command: get-branch-links --id <workItemId> [--cwd <path>]
// stdout: JSON array of { repositoryId, repositoryName, remoteUrl, branchName }
// exit 0 if relations found (may return [] if no branch link)
// exit 1 on API error

async function cmdGetBranchLinks(cwd, args) {
  const idIdx = args.indexOf('--id');
  const id = idIdx !== -1 ? args[idIdx + 1] : null;
  if (!id) { console.error('Missing --id'); process.exit(1); }

  const cfg = loadConfig(cwd);
  const encodedPat = Buffer.from(':' + cfg.pat).toString('base64');

  // Step 1: Fetch work item with expanded relations
  const wiUrl = `${cfg.org}/${cfg.project}/_apis/wit/workitems/${id}?$expand=relations&api-version=7.1`;
  const wiRes = await makeRequest(wiUrl, encodedPat);
  if (wiRes.status !== 200) throw new Error(`Failed to fetch work item ${id}: HTTP ${wiRes.status}`);
  const workItem = JSON.parse(wiRes.body);

  // Step 2: Filter for branch ArtifactLinks
  const branchLinks = (workItem.relations || []).filter(r =>
    r.rel === 'ArtifactLink' && r.attributes && r.attributes.name === 'Branch'
  );

  if (branchLinks.length === 0) {
    console.log(JSON.stringify([]));
    process.exit(0);
  }

  // Step 3: Resolve repository details for each branch link
  const results = [];
  for (const link of branchLinks) {
    const { repositoryId, branchName } = parseVstfsRefUri(link.url);
    const repoUrl = `${cfg.org}/${cfg.project}/_apis/git/repositories/${repositoryId}?api-version=7.1`;
    const repoRes = await makeRequest(repoUrl, encodedPat);
    if (repoRes.status === 200) {
      const repo = JSON.parse(repoRes.body);
      results.push({
        repositoryId: repo.id,
        repositoryName: repo.name,
        remoteUrl: repo.remoteUrl,
        branchName,
      });
    }
  }

  console.log(JSON.stringify(results));
  process.exit(0);
}

function parseVstfsRefUri(vstfsUrl) {
  // Format: vstfs:///Git/Ref/{projectId}/{repositoryId}/GB{branchName}
  // Example: vstfs:///Git/Ref/abc123/def456/GBfeature/my-branch
  const parts = vstfsUrl.replace('vstfs:///Git/Ref/', '').split('/');
  // parts[0] = projectId, parts[1] = repositoryId, parts[2..] = GBbranchName (may contain slashes)
  const repositoryId = parts[1];
  const branchNameRaw = parts.slice(2).join('/');
  const branchName = branchNameRaw.startsWith('GB') ? branchNameRaw.slice(2) : branchNameRaw;
  return { repositoryId, branchName };
}
```

### Pattern 3: Local Repo Detection and Clone

**What:** Check if a repo is already cloned locally before prompting. Use `git remote -v` or just check for `.git` directory at the expected path.
**When to use:** After resolving `remoteUrl` from the API, determine local path.

```javascript
// In the skill (Claude-side logic, using Bash tool):
// 1. Extract repo name from remoteUrl: remoteUrl.split('/').pop()
// 2. Common local paths to check: process.cwd() + '/' + repoName, parent directory, home dir
// 3. Use `git remote -v` comparison OR check if any local path contains the same remoteUrl

// Bash: find local clone by checking git remote URLs
// git remote -v in each sibling directory to find matching remoteUrl
// Simpler: Ask user if not found — they know where they cloned it
```

**Clone location (Claude's discretion):** When no local path is found, suggest cloning to the **same parent directory** as the PlanningMe repo (i.e., `C:/Users/sen.makj/source/repos/{repoName}`). This aligns with the observed layout.

### Pattern 4: GSD Project Bootstrap from AzDO Data

**What:** Generate PROJECT.md and ROADMAP.md in the target repo's `.planning/` directory using Azure DevOps story data as input — equivalent to a headless `/gsd:new-project`.
**When to use:** For each resolved target repo, after user approves the bootstrap.

**Mapping: Azure DevOps fields → GSD PROJECT.md sections:**

| AzDO Field | GSD PROJECT.md Section |
|------------|------------------------|
| `title` | `# [Project Name]` (use repo name for header, story title for What This Is) |
| `description` (stripped HTML) | `## What This Is` — 2-3 sentences |
| `description` core value sentence | `## Core Value` — single most important thing |
| `acceptanceCriteria` (stripped HTML, each criterion) | `## Requirements > Active` — each criterion becomes a checkbox requirement |
| Child task titles | `## Requirements > Active` — additional granular requirements |
| Deduced constraints | `## Constraints` — tech stack from repo name/description |

**Mapping: Azure DevOps fields → GSD ROADMAP.md sections:**

| AzDO Field | GSD ROADMAP.md Section |
|------------|------------------------|
| Story title | `# Roadmap: {story title}` |
| Acceptance criteria (one per phase if multiple) | Phase success criteria |
| Child tasks grouped by area | Phase plans |
| Single story = 1-2 phases | Phase structure (coarse by default) |

### Pattern 5: Multi-Repo Summary Display

**What:** Before processing, show a summary to set user expectations.
**When to use:** After all branch links are resolved, before any file generation.

```
=== Analysis: Sprint 42 ===

You have 3 stories across 2 repos:

Repo: PaymentService (https://dev.azure.com/org/proj/_git/PaymentService)
  [US] #1234 — Add checkout flow (Active)
  [US] #1235 — Implement refunds (New)

Repo: AdminDashboard (https://dev.azure.com/org/proj/_git/AdminDashboard)
  [US] #1238 — Add transaction history (New)

1 story has no branch link and will be skipped:
  [US] #1240 — Investigate performance (New)

Proceed to generate GSD projects for 2 repos? (yes/no)
```

### Anti-Patterns to Avoid

- **Assuming every story has a branch link:** Stories in "New" state often have no branch link. Skip gracefully with a message, don't abort the entire run.
- **Hardcoding the clone location:** Use the parent of the PlanningMe repo as the default clone location, but confirm with the user before cloning.
- **Fetching work item relations in the batch call:** `POST /wit/workitemsbatch` does NOT support `$expand=relations`. Must use individual `GET /wit/workitems/{id}?$expand=relations` per story.
- **Calling get-branch-links for child tasks:** Only user stories have branch links. Roll up to parent story first before fetching branch links (decision: story-level only).
- **Writing PROJECT.md/ROADMAP.md without user approval:** Always show the generated content and get per-repo approval before writing files.
- **Overwriting existing `.planning/` in target repo:** If the target repo already has a `.planning/` directory with a PROJECT.md, warn the user and ask before overwriting.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Repo URL to local path mapping | Custom stored JSON mapping | Branch link → API lookup → `remoteUrl` comparison at runtime | Stored mappings go stale; API is always current |
| Project bootstrapping | Custom analysis output format | GSD PROJECT.md + ROADMAP.md templates | Enables standard `/gsd:plan-phase` immediately after; no custom tooling needed |
| HTML stripping | New function | Existing `stripHtml()` in `azdo-tools.cjs` | Already handles all Azure DevOps HTML field cases |
| Authentication | New auth layer | Existing `loadConfig()` + PAT encoding | Same pattern as Phase 1 and 2 |
| Work item ID rollup (task → story) | Manual parentId traversal in skill | Already available: `parentId` field in `get-sprint-items` output | Phase 2 already fetches parent stories of user's tasks |

**Key insight:** The entire output of this phase (PROJECT.md + ROADMAP.md) is the exact same thing GSD creates for any new project. The skill is essentially a data transformer: AzDO story → GSD project structure. Reuse the template format verbatim rather than inventing a new output shape.

---

## Common Pitfalls

### Pitfall 1: Branch Relation Not Named "Branch" Consistently

**What goes wrong:** The `attributes.name` field on `ArtifactLink` relations is not always "Branch" — it may be "Fixed in Changeset", "Branch", "Build", etc. Some integrations set different names.
**Why it happens:** Azure DevOps uses `attributes.name` to identify the artifact link type, but the value depends on how the link was created (UI, CLI, API).
**How to avoid:** Filter by BOTH `rel === 'ArtifactLink'` AND the vstfs URI starting with `vstfs:///Git/Ref/` — this is more reliable than checking `attributes.name` alone.
**Warning signs:** `branchLinks.length === 0` for stories that have a visible branch link in the Azure DevOps UI.

```javascript
// More robust filter: check the URL format directly
const branchLinks = (workItem.relations || []).filter(r =>
  r.rel === 'ArtifactLink' &&
  r.url && r.url.startsWith('vstfs:///Git/Ref/')
);
```

### Pitfall 2: Branch Name Contains Forward Slashes

**What goes wrong:** Branch names like `feature/US-1234-add-checkout` contain slashes. When the vstfs URI is split on `/`, this creates extra parts.
**Why it happens:** The vstfs URI format encodes the entire branch name (after `GB`) as the remainder of the path. Git branches commonly use `/` as a namespace separator.
**How to avoid:** After parsing `repositoryId` (parts[1]), join everything from parts[2] onwards, then strip the `GB` prefix.
**Warning signs:** `branchName` is truncated (e.g., `feature` instead of `feature/US-1234-add-checkout`).

```javascript
function parseVstfsRefUri(vstfsUrl) {
  // vstfs:///Git/Ref/{projectId}/{repositoryId}/GB{branchName-may-have-slashes}
  const path = vstfsUrl.replace('vstfs:///Git/Ref/', '');
  const parts = path.split('/');
  const repositoryId = parts[1];
  // Branch name: join remaining parts, remove "GB" prefix from first segment
  const branchRaw = parts.slice(2).join('/');
  const branchName = branchRaw.startsWith('GB') ? branchRaw.slice(2) : branchRaw;
  return { repositoryId, branchName };
}
```

### Pitfall 3: `$expand=relations` Not Available in Batch Endpoint

**What goes wrong:** Developer tries to add `$expand=relations` to the `POST /wit/workitemsbatch` request to fetch relations for all sprint items in one call. This is not supported.
**Why it happens:** The batch endpoint only supports `fields` and `errorPolicy` parameters. `$expand` is only supported on the single item `GET` endpoint.
**How to avoid:** Accept that branch link fetching requires one API call per story. Stories per sprint are typically 5-20, so N individual calls is acceptable. Do NOT try to get relations in the batch call.
**Warning signs:** 400 Bad Request when adding `$expand` to the batch body.

### Pitfall 4: Repository API Returns 404 for Cross-Project Repos

**What goes wrong:** The branch link's repositoryId may belong to a different Azure DevOps project than the one configured. The repository lookup uses `/{org}/{configuredProject}/_apis/git/repositories/{id}` which may 404 for cross-project repos.
**Why it happens:** Azure DevOps allows branch links to reference repos in any project in the same organization, but the API path requires the correct project.
**How to avoid:** If the repo lookup returns 404, retry with just `/{org}/_apis/git/repositories/{id}?api-version=7.1` (organization-level lookup without project scope). This broader scope works across projects.
**Warning signs:** HTTP 404 on repository lookup despite the repositoryId being valid.

```javascript
// Fallback: try org-level repo lookup if project-scoped returns 404
async function resolveRepository(org, project, repositoryId, encodedPat) {
  const projectUrl = `${org}/${project}/_apis/git/repositories/${repositoryId}?api-version=7.1`;
  const res = await makeRequest(projectUrl, encodedPat);
  if (res.status === 200) return JSON.parse(res.body);

  // Fallback: org-level lookup (handles cross-project repos)
  const orgUrl = `${org}/_apis/git/repositories/${repositoryId}?api-version=7.1`;
  const fallbackRes = await makeRequest(orgUrl, encodedPat);
  if (fallbackRes.status === 200) return JSON.parse(fallbackRes.body);

  throw new Error(`Repository ${repositoryId} not found`);
}
```

### Pitfall 5: `workItemRelations` from Phase 2 Does Not Include Story Details

**What goes wrong:** The `get-sprint-items` output from Phase 2 gives all items but was fetched via `workitemsbatch` which doesn't include `relations`. For Phase 3, the skill needs to call `get-branch-links` separately for each story ID obtained from Phase 2.
**Why it happens:** Two different APIs: batch gives fields, individual GET with `$expand=relations` gives relations. They cannot be combined.
**How to avoid:** Phase 3 skill first calls `get-sprint-items --me` to get story IDs, then calls `get-branch-links --id {storyId}` for each top-level story (not tasks). Story IDs are those with `type === "User Story"` and `parentId === null` (or parentId not in sprint items).
**Warning signs:** Attempting to read `relations` from the get-sprint-items JSON and finding no `relations` field.

### Pitfall 6: Existing `.planning/` in Target Repo

**What goes wrong:** The target repo already has a `.planning/` directory (the developer already ran `/gsd:new-project` on it). Overwriting silently loses their work.
**Why it happens:** Phase 3 may be run multiple times, or the developer initialized GSD manually before this skill existed.
**How to avoid:** Before writing, check if `{targetRepo}/.planning/PROJECT.md` exists. If it does, ask the user: "This repo already has a GSD project. Overwrite? (yes/no)". Default to no.
**Warning signs:** User complains that their customized PROJECT.md was replaced.

---

## Code Examples

Verified patterns from official Microsoft Learn documentation.

### Fetch Work Item with Relations Expanded

```javascript
// Source: https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/get-work-item?view=azure-devops-rest-7.1
// Required PAT scope: vso.work (already verified in Phase 1)
// $expand=relations returns WorkItemRelation[] with rel, url, attributes
const wiUrl = `${cfg.org}/${cfg.project}/_apis/wit/workitems/${storyId}?$expand=relations&api-version=7.1`;
const wiRes = await makeRequest(wiUrl, encodedPat);
// wiRes.body: { id, fields: {...}, relations: [{rel, url, attributes: {name, comment}}] }
const workItem = JSON.parse(wiRes.body);

// Filter for git branch artifact links
const branchLinks = (workItem.relations || []).filter(r =>
  r.rel === 'ArtifactLink' && r.url && r.url.startsWith('vstfs:///Git/Ref/')
);
```

### Parse vstfs Branch URI

```javascript
// Source: Analysis of the vstfs:///Git/Ref/ format documented in:
// https://github.com/MicrosoftDocs/vsts-rest-api-specs/issues/699
// Format: vstfs:///Git/Ref/{projectId}/{repositoryId}/GB{branchName}
function parseVstfsRefUri(vstfsUrl) {
  const path = vstfsUrl.replace('vstfs:///Git/Ref/', '');
  const parts = path.split('/');
  const repositoryId = parts[1];                    // GUID
  const branchRaw = parts.slice(2).join('/');       // "GBfeature/my-branch"
  const branchName = branchRaw.startsWith('GB') ? branchRaw.slice(2) : branchRaw;
  return { projectId: parts[0], repositoryId, branchName };
}
```

### Lookup Git Repository by ID

```javascript
// Source: https://learn.microsoft.com/en-us/rest/api/azure/devops/git/repositories/get?view=azure-devops-rest-7.1
// Required PAT scope: vso.code
// Response includes: id, name, remoteUrl, defaultBranch, project.name
const repoUrl = `${cfg.org}/${cfg.project}/_apis/git/repositories/${repositoryId}?api-version=7.1`;
const repoRes = await makeRequest(repoUrl, encodedPat);
if (repoRes.status === 200) {
  const repo = JSON.parse(repoRes.body);
  // repo.remoteUrl = "https://dev.azure.com/org/proj/_git/RepoName"
  // repo.name = "RepoName"
  // repo.id = "5febef5a-833d-4e14-b9c0-14cb638f91e6"
  // repo.defaultBranch = "refs/heads/master"
}
```

### Git Clone via Node.js child_process

```javascript
// Source: Node.js built-in child_process documentation
// Used to clone repo when not found locally — called from azdo-tools.cjs or skill
const { execSync } = require('child_process');

function cloneRepo(remoteUrl, targetPath) {
  // For Azure DevOps HTTPS URLs, PAT auth is embedded in the URL
  // Format: https://{pat}@dev.azure.com/{org}/{proj}/_git/{repo}
  // OR use credential helper already set up on the system (preferred)
  execSync(`git clone "${remoteUrl}" "${targetPath}"`, {
    stdio: 'inherit',  // show progress to user
    timeout: 120000,   // 2 minute timeout
  });
}
```

**Note:** For HTTPS clone with PAT authentication, the URL format is `https://{any-username}:{pat}@dev.azure.com/{org}/{project}/_git/{repo}`. However, it is cleaner to let git use the existing credential manager already set up on the system by cloning without embedding credentials. The skill should attempt a plain `git clone {remoteUrl}` first.

### Skill: azdo-tools.cjs get-branch-links Contract

```
node ~/.claude/get-shit-done/bin/azdo-tools.cjs get-branch-links --id <storyId> [--cwd <path>]
  -> stdout: JSON array [{ repositoryId, repositoryName, remoteUrl, branchName }]
  -> Returns [] if the story has no branch link (not an error)
  -> exit 0 on success, exit 1 on API error
  -> Required PAT scope: vso.work + vso.code
```

### GSD PROJECT.md from AzDO Story — Template Mapping

```markdown
# {repo.name}

## What This Is

{story.description — first 2-3 sentences, cleaned up for prose quality}
This work is tracked as Azure DevOps story #{story.id}: "{story.title}".

## Core Value

{derived from story description — the single must-work thing, typically from the first sentence}

## Requirements

### Validated

(None yet — ship to validate)

### Active

{for each line in story.acceptanceCriteria:}
- [ ] {criterion text}
{for each child task in story.childTasks:}
- [ ] {task.title}

### Out of Scope

(Defined during phase planning)

## Context

- Azure DevOps Story: #{story.id} — {story.title}
- Sprint: {sprintName}
- Branch: {branchName} in {repo.name}
- State: {story.state}

## Constraints

- **Tech stack**: Inferred from repo name and description (specify during phase planning)
- **Auth**: Azure DevOps PAT for API access

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| (Defined during phase planning) | | |

---
*Last updated: {date} after analysis via /gsd:azdo-analyze*
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual repo mapping (REPO-01/02 as designed) | Branch link resolution via ArtifactLink API | Phase 3 CONTEXT.md decision | Eliminates need to store and maintain repo mappings; always uses current branch link |
| Custom analysis output (subtasks + approach + risks doc) | GSD PROJECT.md + ROADMAP.md bootstrap | Phase 3 CONTEXT.md decision | Analysis output is immediately actionable via `/gsd:plan-phase` without any custom tooling |
| Individual work item GETs for fields | `POST /wit/workitemsbatch` for fields, individual GET for relations | Phase 2 vs Phase 3 | Relations require individual GET with `$expand=relations`; batch only handles fields |

**Deprecated/outdated:**
- REPO-01/REPO-02 (manual ask-and-remember mapping): replaced by branch link resolution. The requirements still exist in REQUIREMENTS.md but their implementation approach changed per the CONTEXT.md decisions.

---

## Open Questions

1. **PAT scope: does existing PAT have `vso.code` for git repository lookup?**
   - What we know: Phase 1 verified `vso.project` and `vso.work` scopes. The Git Repositories API (`/_apis/git/repositories`) requires `vso.code`.
   - What's unclear: Whether the user's existing PAT has `vso.code`.
   - Recommendation: Add a PAT scope check in the skill preamble. If the repos endpoint returns 403, tell user to regenerate PAT with `vso.code` scope added. Document the required scope in the skill header comment.

2. **What if a story has multiple branch links (e.g., feature branch + hotfix branch)?**
   - What we know: The `relations` array can contain multiple entries with `rel === 'ArtifactLink'` and `vstfs:///Git/Ref/` URLs.
   - What's unclear: How common this is in the user's project.
   - Recommendation: If multiple branch links are found for a story, use the most recently created one (by `attributes.authorizedDate` if present) or present both to the user as a choice. For Phase 3, pick the first one and document the behavior.

3. **Does the user's git credential helper already support Azure DevOps HTTPS clones?**
   - What we know: The user has repos already cloned locally, so their git credential setup works for the existing repos.
   - What's unclear: Whether it works for a `git clone` of a new repo without interactive prompts.
   - Recommendation: Attempt plain `git clone {remoteUrl}` first. If it fails (non-zero exit), fall back to embedding PAT in URL: `https://pat:{pat}@dev.azure.com/...`. The azdo-tools.cjs command has the PAT available.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | None — no test framework installed (established in Phase 1) |
| Config file | None |
| Quick run command | `node ~/.claude/get-shit-done/bin/azdo-tools.cjs get-branch-links --id {storyId} --cwd C:/Users/sen.makj/source/repos/PlanningMe` |
| Full suite command | Manual smoke test via `/gsd:azdo-analyze` skill with real credentials |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REPO-01 | Branch link resolved from user story ArtifactLink | smoke | `node ~/.claude/get-shit-done/bin/azdo-tools.cjs get-branch-links --id {storyId} --cwd $CWD` exits 0 with JSON array | ❌ Wave 0 |
| REPO-02 | Repository remoteUrl and name returned from branch link | smoke | Output of get-branch-links includes `repositoryName` and `remoteUrl` fields | ❌ Wave 0 |
| ANAL-01 | Skill fetches stories with `--me` filter and gets branch links for each story | manual | Run `/gsd:azdo-analyze` and verify it shows stories grouped by repo | manual-only |
| ANAL-02 | PROJECT.md and ROADMAP.md written to target repo `.planning/` | smoke | `ls {target-repo}/.planning/PROJECT.md {target-repo}/.planning/ROADMAP.md` — both exist after skill run | ❌ Wave 0 |
| ANAL-03 | User can reject generated PROJECT.md and trigger regeneration | manual | Run skill, select "Request changes", verify skill re-generates | manual-only |

### Sampling Rate

- **Per task commit:** `node ~/.claude/get-shit-done/bin/azdo-tools.cjs get-branch-links --id {storyId} --cwd $CWD; echo "exit: $?"` (requires live credentials)
- **Per wave merge:** Both `get-branch-links` returns valid JSON and repository lookup returns `remoteUrl`
- **Phase gate:** `/gsd:azdo-analyze` must show multi-repo summary, generate files, and present approval gate before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `~/.claude/get-shit-done/bin/azdo-tools.cjs` — extend with `get-branch-links` command
- [ ] `~/.claude/commands/gsd/azdo-analyze.md` — new skill file

*(No test framework needed — smoke tests use the CLI tool directly with real credentials)*

---

## Sources

### Primary (HIGH confidence)

- [Work Items - Get Work Item - REST API (Azure DevOps Work Item Tracking) v7.1](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/get-work-item?view=azure-devops-rest-7.1) — `$expand=relations` parameter, `WorkItemRelation` schema (rel, url, attributes), `WorkItemExpand` enum values
- [Repositories - Get - REST API (Azure DevOps Git) v4.1](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/repositories/get?view=azure-devops-rest-4.1) — Response schema: `id`, `name`, `remoteUrl`, `defaultBranch`, `sshUrl`; organization-level and project-scoped endpoints
- `~/.claude/get-shit-done/bin/azdo-tools.cjs` — existing `makeRequest()`, `loadConfig()`, `stripHtml()` — all reusable for Phase 3
- `~/.claude/get-shit-done/templates/project.md` — GSD PROJECT.md template structure used for output generation
- `~/.claude/get-shit-done/templates/roadmap.md` — GSD ROADMAP.md template structure used for output generation

### Secondary (MEDIUM confidence)

- [Azure DevOps REST API - Work Item Relation Type URL Format (GitHub issue #699)](https://github.com/MicrosoftDocs/vsts-rest-api-specs/issues/699) — Confirms `vstfs:///Git/Ref/{projectId}/{repositoryId}/GB{branchName}` format for branch artifact links
- [Artifact Link Types - List - REST API (Azure DevOps Work Item Tracking) v7.1](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/artifact-link-types/list?view=azure-devops-rest-7.1) — Lists available artifact link types including Git Branch
- WebSearch result confirming `rel === "ArtifactLink"` and URL starting with `vstfs:///Git/Ref/` as the reliable branch link filter (multiple sources agree)

### Tertiary (LOW confidence)

- Assumption that `attributes.name === "Branch"` is set by Azure DevOps UI — not guaranteed for all link creation paths; secondary URL-based filter (`vstfs:///Git/Ref/`) used as more reliable alternative. Recommendation: use both filters combined with OR.
- PAT scope `vso.code` requirement for Git Repositories API — documented as required scope but not verified against the user's existing PAT.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all new code uses existing `azdo-tools.cjs` patterns with Node.js built-ins only
- Branch link extraction API: HIGH — `$expand=relations` documented in official API docs; `vstfs:///Git/Ref/` format confirmed by multiple sources
- Git Repository API: HIGH — response schema (id, name, remoteUrl) verified from official docs with sample response
- vstfs URI parsing: MEDIUM — format is consistently documented but the `attributes.name` reliability is LOW; URI-based filter is more reliable
- GSD bootstrap mapping: HIGH — PROJECT.md and ROADMAP.md templates are read from the GSD codebase directly
- Clone via child_process: HIGH — standard Node.js built-in pattern

**Research date:** 2026-03-04
**Valid until:** 2026-09-04 (Azure DevOps REST API v7.1 is versioned and backward-compatible)
