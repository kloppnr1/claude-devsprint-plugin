---
name: azdev-analyze
description: Analyze sprint stories and bootstrap GSD projects in target repos
argument-hint: ""
allowed-tools:
  - Read
  - Write
  - Bash
  - AskUserQuestion
---

<objective>
Fetch assigned stories from the current Azure DevOps sprint, resolve their branch links to local repos, display a multi-repo summary, generate PROJECT.md + ROADMAP.md + REQUIREMENTS.md per target repo, and present each for user approval. This is the sprint-to-GSD-project pipeline.
</objective>

<execution_context>
Helper: ~/.claude/get-shit-done/bin/azdev-tools.cjs
Config file: .planning/azdev-config.json
GSD templates: ~/.claude/get-shit-done/templates/project.md and ~/.claude/get-shit-done/templates/roadmap.md
$CWD is the project directory where .planning/ lives (the PlanningMe repo or equivalent).
</execution_context>

<context>
azdev-tools.cjs CLI contracts:

  node ~/.claude/get-shit-done/bin/azdev-tools.cjs load-config --cwd $CWD
    -> stdout: JSON {"org":"...","project":"...","pat":"<raw-decoded>"}
    -> exit 0 on success, exit 1 if no config

  node ~/.claude/get-shit-done/bin/azdev-tools.cjs get-sprint --cwd $CWD
    -> stdout: JSON {"iterationId":"...","name":"...","path":"...","startDate":"...","finishDate":"..."}
    -> exit 0 on success, exit 1 on error

  node ~/.claude/get-shit-done/bin/azdev-tools.cjs get-sprint-items --me --cwd $CWD
    -> stdout: JSON array [{id, type, title, state, description, acceptanceCriteria, parentId, assignedTo}]
    -> --me: filter to authenticated user's items (parent stories + child tasks)
    -> exit 0 on success, exit 1 on error

  node ~/.claude/get-shit-done/bin/azdev-tools.cjs get-branch-links --id <storyId> --cwd $CWD
    -> stdout: JSON array [{ repositoryId, repositoryName, remoteUrl, branchName }]
    -> Returns [] if no branch link found (not an error)
    -> exit 0 on success, exit 1 on API error
    -> Required PAT scopes: vso.work + vso.code

  node ~/.claude/get-shit-done/bin/azdev-tools.cjs update-description --id <workItemId> --description "<html>" --cwd $CWD
    -> stdout: JSON {"status":"updated","id":N}
    -> Uses PATCH API with application/json-patch+json content type
    -> exit 0 on success, exit 1 on error
</context>

<process>

**Step 1 — Check prerequisites:**

1. Verify `~/.claude/get-shit-done/bin/azdev-tools.cjs` exists via Bash `test -f ~/.claude/get-shit-done/bin/azdev-tools.cjs`.
   If it does not exist: tell the user "Azure DevOps tools not installed. Check that ~/.claude/get-shit-done/bin/azdev-tools.cjs exists." Stop.

2. Run `node ~/.claude/get-shit-done/bin/azdev-tools.cjs load-config --cwd $CWD`.
   If exit 1: tell the user "No Azure DevOps config found. Run `/azdev-setup` to configure your connection." Stop.

3. Note: The Git Repositories API (called internally by `get-branch-links`) requires the `vso.code` PAT scope in addition to `vso.work`. If step 4 (below) produces errors about repository lookup, advise the user to regenerate their PAT with `vso.code` scope added and re-run `/azdev-setup`.

**Step 2 — Fetch sprint metadata:**

Run `node ~/.claude/get-shit-done/bin/azdev-tools.cjs get-sprint --cwd $CWD`.
- If exit 1: show the error message to the user. Stop.
- If exit 0: parse the JSON. Extract `name` for display.

**Step 3 — Fetch assigned stories:**

Run `node ~/.claude/get-shit-done/bin/azdev-tools.cjs get-sprint-items --me --cwd $CWD`.
- If exit 1: show the error message to the user. Stop.
- If exit 0: parse the JSON array.

Filter to top-level stories only:
- Items where `type === "User Story"` AND (`parentId === null` OR `parentId` is not present in the items list).
- Collect child tasks for each story: items where `parentId === storyId`.

Argument handling: If the user passed an argument to this skill (e.g., a task ID), find the item in the list and use its `parentId` to roll up to the parent story. Process that parent story (story-level only per locked decision).

**Step 4 — Resolve branch links:**

For each top-level story (not child tasks), run:
  `node ~/.claude/get-shit-done/bin/azdev-tools.cjs get-branch-links --id {storyId} --cwd $CWD`

- Parse the JSON array result.
- If multiple branch links exist for a story, use the first one (Claude's discretion).
- Group stories by target repo using `repositoryName`.
- Track stories with an empty array (`[]`) separately as "no branch link".

**Step 5 — Show multi-repo summary and confirm:**

Display summary in this format:
```
=== Analysis: {sprintName} ===

You have {N} stories across {M} repos:

Repo: {repoName} ({remoteUrl})
  [US] #{id} -- {title} ({state})
  [US] #{id} -- {title} ({state})

Repo: {repoName} ({remoteUrl})
  [US] #{id} -- {title} ({state})

{K} story/stories have no branch link and will be skipped:
  [US] #{id} -- {title} ({state})

Proceed to generate GSD projects for {M} repos? (yes/no)
```

Use `AskUserQuestion` tool for confirmation. If the user says "no" or anything other than "yes", stop with: "Analysis cancelled. No changes made."

**Step 5.5 — Interactive verification per story:**

For each story that has a branch link (not skipped), present the following to the user:

```
### #{id} — {title} ({state})

**My understanding:**
{2-3 sentences summarizing what the story is about, based on description + acceptance criteria + child tasks}

**Work type:** [Code change / Manual/operational / Blocked]

**Tasks:**
{list of child tasks with their state}
```

Use `AskUserQuestion` with:
- Question: "Is this understanding correct for #{id}?"
- Options: "Yes" / "No, let me correct it"

If "Yes": store the verified understanding (summary text + work type) for this story.
If "No, let me correct it": ask "What is the correct understanding?" as a free-text follow-up. Then re-present the corrected version for confirmation. Repeat until approved.

The verified understanding per story is used in Steps 8-10 for better GSD file generation.

**Step 5.6 — Update story description in Azure DevOps:**

For each verified story, **replace** the description with the verified analysis. Azure DevOps keeps revision history, so the original description is not lost.

Construct the new description HTML:
```html
<strong>Arbejdstype:</strong> {Code change/Manual/operational/Blocked}<br>
<strong>Opsummering:</strong> {verified understanding text}<br>
<strong>Opgaver:</strong><br>
{for each child task: "- {task.title} ({task.state})<br>"}
<br>
<em>Sprint-analyse verificeret {today's date}</em>
```

Then run:
```
node ~/.claude/get-shit-done/bin/azdev-tools.cjs update-description --id {storyId} --description "{newDescriptionHtml}" --cwd $CWD
```

If update fails, warn the user but continue (non-blocking error). The verified understanding is still used locally for GSD generation.

**Step 6 — For each target repo, resolve local path:**

For each repo group:
1. Extract repo name from `remoteUrl`: the last path segment of the URL (e.g., `RepoName` from `https://dev.azure.com/org/proj/_git/RepoName`).
2. Determine the parent directory: the parent directory of `$CWD` (e.g., if `$CWD` is `C:/Users/sen.makj/source/repos/PlanningMe`, the parent is `C:/Users/sen.makj/source/repos/`).
3. Check if `{parentDir}/{repoName}/.git` exists via Bash. If it does, use `{parentDir}/{repoName}` as the local path.
4. If NOT found, use `AskUserQuestion`:
   "Repo {repoName} not found locally at {expectedPath}. What would you like to do?
   (1) Clone it to {expectedPath}
   (2) Provide a different local path
   (3) Skip this repo"

   - If clone: run `git clone "{remoteUrl}" "{expectedPath}"` via Bash. If clone fails (non-zero exit), warn user and skip this repo. Continue with remaining repos.
   - If different path: use the path the user provides.
   - If skip: exclude this repo from generation.

**Step 7 — Check for existing .planning/ in target repo:**

For each repo that will be processed:
- Check if `{repoPath}/.planning/PROJECT.md` exists via Bash `test -f`.
- If it exists, use `AskUserQuestion`:
  "Repo {repoName} already has a GSD project at {repoPath}/.planning/PROJECT.md. Overwrite it? (yes/no)"
  If the user says "no", skip this repo. Default to no if unclear.

**Step 8 — Generate PROJECT.md for each target repo:**

Read the GSD template at `~/.claude/get-shit-done/templates/project.md` to confirm the exact section structure.

Use the `Write` tool to create `{repoPath}/.planning/PROJECT.md`. Ensure `.planning/` directory exists first (create via Bash `mkdir -p "{repoPath}/.planning"` if needed).

**IMPORTANT:** Use the **verified understanding** from Step 5.5 (not the raw AzDO description) for "What This Is" and "Core Value" sections. The verified understanding has been validated by the user and correctly describes what the work actually involves.

Map Azure DevOps fields to GSD PROJECT.md sections:

```markdown
# {repo.repositoryName}

## What This Is

{verified understanding from Step 5.5 — the user-approved summary of what this story is about}
This work is tracked as Azure DevOps story #{story.id}: "{story.title}".

## Core Value

{Derived from the verified understanding — the single must-work thing. One sentence.}

## Requirements

### Validated

(None yet — ship to validate)

### Active

{For each criterion in story.acceptanceCriteria (split on newlines, skip blank lines):}
- [ ] {criterion text}
{For each child task in the story's child tasks:}
- [ ] {task.title}

### Out of Scope

(Defined during phase planning)

## Context

- Azure DevOps Story: #{story.id} -- {story.title}
- Sprint: {sprintName}
- Branch: {branchName} in {repo.repositoryName}
- State: {story.state}
- Work type: {verified work type from Step 5.5}

## Constraints

- **Tech stack**: Inferred from repo name and description (specify during phase planning)
- **Auth**: Azure DevOps PAT for API access

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| (Defined during phase planning) | | |

---
*Last updated: {today's date} after analysis via /azdev-analyze*
```

Formatting rules:
- Strip all HTML from description and acceptanceCriteria before writing (already done by azdev-tools.cjs stripHtml for sprint items; acceptance criteria from `get-sprint-items` is already plain text).
- If acceptanceCriteria is empty or null, omit the acceptance criteria checkboxes — just include the child task checkboxes.
- If description is empty, write "(No description provided)" in What This Is.
- Do NOT include any HTML tags in the generated file.

**Step 9 — Generate ROADMAP.md for each target repo:**

Read the GSD template at `~/.claude/get-shit-done/templates/roadmap.md` for exact section structure.

Use the `Write` tool to create `{repoPath}/.planning/ROADMAP.md`.

**IMPORTANT:** Use the **verified work type** from Step 5.5 to decide the roadmap structure:
- **Code change**: Generate full phase details with implementation plans.
- **Manual/operational**: Generate a simplified roadmap noting the work is manual — no detailed code phases needed. Include a single "Execute manual steps" phase.
- **Blocked**: Note the blocker in the overview and generate a single "Unblock and implement" phase.

Map Azure DevOps fields:
```markdown
# Roadmap: {story.title}

## Overview

This roadmap tracks the implementation of Azure DevOps story #{story.id}: {story.title}, as part of sprint {sprintName}. The work is organized into phases based on the acceptance criteria and child tasks.

{If work type is Manual/operational: "Note: This story involves manual/operational work, not code changes. Phases reflect manual steps to complete."}
{If work type is Blocked: "Note: This story is currently blocked. Phase 1 focuses on resolving the blocker."}

## Phases

- [ ] **Phase 1: Implementation** - {Use verified understanding to write a more accurate phase description}

## Phase Details

### Phase 1: Implementation
**Goal**: {Use verified understanding to write an accurate goal}
**Depends on**: Nothing (first phase)
**Requirements**: [{requirement IDs from REQUIREMENTS.md, e.g., REQ-01, REQ-02}]
**Success Criteria** (what must be TRUE):
{For each acceptance criterion:}
  1. {criterion text}
**Plans**: TBD

Plans:
- [ ] 01-01: Initial implementation

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Implementation | 0/1 | Not started | - |
```

Adapt the phase structure if child tasks naturally group into multiple phases (e.g., separate frontend/backend phases). Keep it simple — single story = 1-2 phases is the default.

**Step 10 — Generate REQUIREMENTS.md for each target repo:**

Use the `Write` tool to create `{repoPath}/.planning/REQUIREMENTS.md`.

Derive requirement IDs from acceptance criteria and child tasks. Format:

```markdown
# Requirements: {repo.repositoryName}

## Active Requirements

| ID | Description | Source | Status |
|----|-------------|--------|--------|
| REQ-01 | {first acceptance criterion or child task} | AzDO #{story.id} | Active |
| REQ-02 | {second criterion} | AzDO #{story.id} | Active |

## Requirement Details

### REQ-01: {short name}

**Description**: {full criterion text}
**Source**: Azure DevOps story #{story.id}, acceptance criteria
**Status**: Active
**Acceptance**: {same criterion text}

---
*Generated from Azure DevOps sprint analysis via /azdev-analyze*
*Sprint: {sprintName}*
*Story: #{story.id} -- {story.title}*
```

Number requirements sequentially (REQ-01, REQ-02, ...). Use acceptance criteria first, then child task titles for any remaining requirements.

**Step 11 — Present for approval per repo:**

After generating the three files for a repo, show the user the generated content. Use `AskUserQuestion`:

"Review the generated GSD project for {repoName}:

PROJECT.md has been written to {repoPath}/.planning/PROJECT.md
ROADMAP.md has been written to {repoPath}/.planning/ROADMAP.md
REQUIREMENTS.md has been written to {repoPath}/.planning/REQUIREMENTS.md

[Show key sections: What This Is, Core Value, Requirements Active list, Roadmap phases]

Approve, request changes, or skip? (approve/changes/skip)"

- If "approve": keep the written files, move to next repo.
- If "changes": ask "What would you like to change?" then regenerate the affected files incorporating the feedback, and re-present for approval. Repeat until approved or skipped.
- If "skip": delete the generated files (run `rm "{repoPath}/.planning/PROJECT.md" "{repoPath}/.planning/ROADMAP.md" "{repoPath}/.planning/REQUIREMENTS.md"` via Bash). Note the skip in the final summary.

**Step 11.5 — Write azdev-task-map.json:**

After all repos have been processed (approved or skipped), write the task map for status tracking.

For each **approved** repo, create a mapping entry:
- `storyId`: the Azure DevOps story ID (number)
- `storyTitle`: the story title
- `repoPath`: the resolved local repo path
- `taskIds`: array of child task IDs that belong to this story (only code-type tasks that GSD will work on)
- `taskTitles`: object mapping task ID (as string key) to task title

Write the complete map to `$CWD/.planning/azdev-task-map.json` using the Write tool:
```json
{
  "version": 1,
  "sprintName": "{sprintName from Step 2}",
  "generatedAt": "{ISO timestamp}",
  "mappings": [ ... entries for approved repos ... ]
}
```

If all repos were skipped (no approved entries), do NOT write the file. The absence of `azdev-task-map.json` means no automatic status updates will happen — execute-phase checks for file existence before calling update-state.

This file is consumed by `/gsd:execute-phase` for automatic Azure DevOps status updates: tasks are marked Active at execution start and Resolved at execution end.

**Step 12 — Final summary:**

After processing all repos, display:
```
=== Analysis Complete ===

GSD projects bootstrapped:
  {repoName}: {repoPath}/.planning/ (approved)
  {repoName}: {repoPath}/.planning/ (approved)

Skipped:
  {repoName}: no branch link
  {repoName}: user skipped

Next steps:
  cd {repoPath} && /gsd:plan-phase
```

If multiple repos were approved, list each with its next step.

</process>

<error_handling>

**Common errors and responses:**

- `get-branch-links` returns 403 for repository lookup: "The Git Repositories API requires the `vso.code` PAT scope. Please regenerate your PAT at https://dev.azure.com with `vso.code` added, then run `/azdev-setup` to update the config."

- `git clone` fails: Warn the user with the error output, skip this repo, continue with remaining repos.

- Story has no description: Generate "What This Is" with "(No description provided). This work is tracked as Azure DevOps story #{story.id}: \"{story.title}\"."

- Story has no acceptance criteria AND no child tasks: Generate a single placeholder requirement: `- [ ] Implement story #{story.id}: {story.title}`.

- Empty sprint or no assigned stories: Display "No stories assigned to you in the current sprint. Nothing to analyze."

</error_handling>

<success_criteria>
- All assigned user stories are retrieved via get-sprint-items --me
- Branch links resolve stories to target repos automatically (no manual mapping)
- Multi-repo summary is shown before any file generation
- Each story is interactively verified with the user before GSD generation (Step 5.5)
- Verified analysis is appended to AzDO story description (Step 5.6)
- PROJECT.md and ROADMAP.md and REQUIREMENTS.md use the verified understanding (not raw AzDO data)
- Stories are correctly categorized by work type (code change vs manual/operational vs blocked)
- User can approve or request changes per repo before files are finalized
- Stories without branch links are listed but skipped gracefully with a message
- No HTML artifacts appear in any generated file
- After approval, standard /gsd:plan-phase can be run in the target repo
- azdev-task-map.json is written to $CWD/.planning/ with story-to-task mappings for all approved repos
- The task map file is consumed by /gsd:execute-phase for automatic Azure DevOps status updates at execution boundaries
</success_criteria>
