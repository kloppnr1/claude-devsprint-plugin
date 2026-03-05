---
name: azdev-plan
description: Analyze and plan sprint stories — all assigned or a single story by ID
argument-hint: "[story-id]"
allowed-tools:
  - Read
  - Write
  - Bash
  - AskUserQuestion
---

<objective>
Fetch assigned stories from the current Azure DevOps sprint, ask the user which repo each story belongs to, interactively verify each story with the user, update story descriptions in Azure DevOps, generate a detailed STORY.md spec per story (optimized for both human reading and AI-driven implementation), and present each for user approval. Write azdev-task-map.json for status tracking during execution.

If a story ID is provided as argument, only process that single story (skip multi-story summary, go straight to analysis).
</objective>

<execution_context>
Helper: ~/.claude/bin/azdev-tools.cjs
Config file: .planning/azdev-config.json
$CWD is the project directory where .planning/ lives.
</execution_context>

<context>
azdev-tools.cjs CLI contracts:

  node ~/.claude/bin/azdev-tools.cjs load-config --cwd $CWD
    -> stdout: JSON {"org":"...","project":"...","pat":"<raw-decoded>"}
    -> exit 0 on success, exit 1 if no config

  node ~/.claude/bin/azdev-tools.cjs get-sprint --cwd $CWD
    -> stdout: JSON {"iterationId":"...","name":"...","path":"...","startDate":"...","finishDate":"..."}
    -> exit 0 on success, exit 1 on error

  node ~/.claude/bin/azdev-tools.cjs get-sprint-items --me --cwd $CWD
    -> stdout: JSON array [{id, type, title, state, description, acceptanceCriteria, parentId, assignedTo}]
    -> --me: filter to authenticated user's items (parent stories + child tasks)
    -> exit 0 on success, exit 1 on error

  node ~/.claude/bin/azdev-tools.cjs update-description --id <workItemId> --description "<html>" --cwd $CWD
    -> stdout: JSON {"status":"updated","id":N}
    -> Uses PATCH API with application/json-patch+json content type
    -> exit 0 on success, exit 1 on error

  node ~/.claude/bin/azdev-tools.cjs list-repos --cwd $CWD
    -> stdout: JSON array [{"name":"...","id":"...","remoteUrl":"...","lastPushDate":"..."}]
    -> Lists Git repositories in the Azure DevOps project
    -> exit 0 on success, exit 1 on error
</context>

<process>

**Step 0 — Parse arguments:**

Check if the user passed a story ID as argument (e.g., `/azdev-plan 42920` or `/azdev-plan #42920`).
- If a numeric ID is provided: set `singleStoryMode = true` and `targetStoryId = <the ID>`.
- If no argument: set `singleStoryMode = false` (process all assigned stories).
- If argument is a task ID (not a story), it will be resolved to its parent story in Step 3.

**Step 1 — Check prerequisites:**

1. Verify `~/.claude/bin/azdev-tools.cjs` exists via Bash `test -f ~/.claude/bin/azdev-tools.cjs`.
   If it does not exist: tell the user "Azure DevOps tools not installed. Check that ~/.claude/bin/azdev-tools.cjs exists." Stop.

2. Run `node ~/.claude/bin/azdev-tools.cjs load-config --cwd $CWD`.
   If exit 1: tell the user "No Azure DevOps config found. Run `/azdev-setup` to configure your connection." Stop.

**Step 2 — Fetch sprint metadata:**

Run `node ~/.claude/bin/azdev-tools.cjs get-sprint --cwd $CWD`.
- If exit 1: show the error message to the user. Stop.
- If exit 0: parse the JSON. Extract `name` for display.

**Step 3 — Fetch assigned stories:**

Run `node ~/.claude/bin/azdev-tools.cjs get-sprint-items --me --cwd $CWD`.
- If exit 1: show the error message to the user. Stop.
- If exit 0: parse the JSON array.

Filter to top-level stories only:
- Items where `type === "User Story"` AND (`parentId === null` OR `parentId` is not present in the items list).
- Collect child tasks for each story: items where `parentId === storyId`.

**Single-story filtering (if `singleStoryMode`):**
- Find the item matching `targetStoryId` in the fetched items.
- If the matching item is a Task (not a User Story), use its `parentId` to find the parent story. Process that parent story only.
- If the matching item IS a User Story, process it directly.
- If `targetStoryId` is not found in the sprint items, tell the user: "Story #{targetStoryId} not found in your current sprint items." Stop.
- After filtering, continue with only this one story — skip Step 5 (multi-story summary) and go directly to Step 4.

**Step 4 — Ask user for target repo per story:**

For each story to process, ask the user which Azure DevOps repository it belongs to.

1. **Fetch repos from Azure DevOps:** Run `node ~/.claude/bin/azdev-tools.cjs list-repos --cwd $CWD`.
   Parse the JSON array of `{name, id, remoteUrl}`.

2. **Check existing task map:** If `$CWD/.planning/azdev-task-map.json` exists, check if this story already has a `repoPath` mapping. If so, use the repo name from that path as the default suggestion.

3. **Ask the user** using `AskUserQuestion`:
   - Question: "Which repo should story #{id} ({title}) be planned in?"
   - Options: list the Azure DevOps repo names as options (max 4, prioritize repos already in the task map). The user can also type a custom name/path via "Other".

4. **Resolve the local path:**
   - Scan the parent directory of `$CWD` for a folder matching the selected repo name: `test -d "{parentDir}/{repoName}/.git"`
   - If found: use `{parentDir}/{repoName}` as the path.
   - If NOT found: ask the user for the local path to the repo using `AskUserQuestion`: "Repo '{repoName}' not found at {parentDir}/{repoName}. Where is it cloned locally?"
   - If the user provides a custom path: verify it exists and contains `.git` via Bash. If not, warn and re-ask.

5. Store the resolved `repoPath` for this story. Continue to Step 4.5.

**Step 4.5 — Repo analysis per story:**

After resolving the target repo for each story, analyze the repo to understand the codebase.

For each story with a resolved local repo path:

1. **Switch to the target repo directory** and look at the repo structure:
   - Look at key directories, tech stack indicators (package.json, *.csproj, *.sln, etc.).
   - Run `git branch -a` to see available branches.

2. **Check for existing work:** Check if a feature branch for this story already exists:
   - Run `git branch -a | grep -i {storyId}` to find branches matching the story ID.
   - If a matching branch exists, get the diff against the default branch to see existing progress.

3. **Produce a repo analysis summary** for each story:
   - **Tech stack**: detected from repo (e.g., "C# / .NET", "TypeScript / React", "Python / FastAPI")
   - **Architecture observations**: key patterns or layers in the repo (e.g., "API controller + service layer + DB migration")
   - **Existing branch**: if a feature branch for this story was found, note it and summarize progress
   - **Risks or concerns**: anything notable (e.g., "large repo", "complex build setup")

Store this analysis per story — it is used in Step 5.5 for the interactive verification and in Steps 8-10 for project file generation.

**Step 5 — Show summary and confirm:**

**Skip this step entirely if `singleStoryMode` is true.** Go directly to Step 5.5.

Display summary in this format:
```
=== Analysis: {sprintName} ===

You have {N} stories:

  [US] #{id} -- {title} ({state}) → {repoName}
  [US] #{id} -- {title} ({state}) → {repoName}

Proceed to analyze? (yes/no)
```

Use `AskUserQuestion` tool for confirmation. If the user says "no" or anything other than "yes", stop with: "Analysis cancelled. No changes made."

**Step 5.5 — Interactive verification per story:**

For each story, present the following to the user:

```
### #{id} — {title} ({state})

**My understanding:**
{2-3 sentences summarizing what the story is about, based on description + acceptance criteria + child tasks}

**Work type:** [Code change / Manual/operational / Blocked]

**Target repo:** {repoName} ({repoPath})

**Repo analysis** (from Step 4.5):
  Tech stack: {detected tech stack}
  Architecture: {key patterns/layers}
  {If existing branch found: "Existing branch: {branchName} — {progress summary}"}
  {If risks/concerns: "Risks: {risks}"}

**Tasks:**
{list of child tasks with their state}
```

Use `AskUserQuestion` with:
- Question: "Is this understanding correct for #{id}?"
- Options: "Yes" / "No, let me correct it"

If "Yes": store the verified understanding (summary text + work type) for this story.
If "No, let me correct it": ask "What is the correct understanding?" as a free-text follow-up. Then re-present the corrected version for confirmation. Repeat until approved.

The verified understanding per story is used in later steps for project file generation.

**Step 5.6 — Update story description in Azure DevOps:**

For each verified story, **replace** the description with the verified analysis. Azure DevOps keeps revision history, so the original description is not lost.

Construct the new description in markdown:
```markdown
**Arbejdstype:** {Code change/Manual/operational/Blocked}

**Opsummering:** {verified understanding text}

**Opgaver:**
{for each child task: "- {task.title} ({task.state})"}

*Sprint-analyse verificeret {today's date}*
```

Then run:
```
node ~/.claude/bin/azdev-tools.cjs update-description --id {storyId} --description "{newDescriptionHtml}" --cwd $CWD
```

If update fails, warn the user but continue (non-blocking error). The verified understanding is still used locally for file generation.

**Step 7 — Check for existing .planning/ in target repo:**

For each repo that will be processed:
- Check if `{repoPath}/.planning/stories/{storyId}.md` exists via Bash `test -f`.
- If it exists, use `AskUserQuestion`:
  "Story #{storyId} already has a spec at {repoPath}/.planning/stories/{storyId}.md. Overwrite it? (yes/no)"
  If the user says "no", skip this story. Default to no if unclear.

**Step 8 — Generate STORY.md for each story:**

Use the `Write` tool to create `{repoPath}/.planning/stories/{storyId}.md`. Ensure the directory exists first (create via Bash `mkdir -p "{repoPath}/.planning/stories"` if needed).

This is the single source of truth for the story — designed to be readable by humans AND actionable by an AI coding agent. Every section must contain **specific, concrete details** from the verified understanding, the story description, and the repo analysis. Never use vague placeholders.

**CRITICAL RULES for writing STORY.md:**
- Extract EVERY specific detail from the story description: file paths, class names, API endpoints, contact persons, config values, naming conventions, etc.
- If the story mentions "see X for details", read X during repo analysis (Step 4.5) and include what you found.
- Blockers and open questions must be called out explicitly — they prevent the AI from guessing.
- Acceptance criteria must be testable: "it works" is not testable, "running X produces Y" is.
- Include concrete file paths from the repo analysis — the AI agent needs to know WHERE to make changes.

```markdown
# #{story.id} — {story.title}

> **Sprint**: {sprintName} | **Repo**: {repoName} | **Type**: {work type} | **State**: {story.state}

## Goal

{One sentence: what is the end result when this story is done? Be specific — not "upload files" but "historical invoices from the last 5 years are uploaded to Systemate Blob Storage in the structure {dataareaid}/{accountnum}/"}

## Background

{2-4 sentences of context from the verified understanding. Include:}
- Why this work is needed (business reason)
- What system/feature it relates to
- Any prior work or existing functionality that this builds on
- Key domain concepts a developer needs to understand

## Acceptance Criteria

{Derived from story.acceptanceCriteria AND child tasks. Each criterion must be specific and testable.}

- [ ] {Specific, testable criterion — e.g., "PDFs are uploaded to blob path {dataareaid}/{accountnum}/{filename}"}
- [ ] {Another criterion — e.g., "Upload covers invoices from {date range}"}
- [ ] {Criterion from child task if it adds a distinct requirement}

## Technical Context

### Key Files
{From repo analysis — list the specific files/classes/modules that are relevant to this story:}
- `path/to/RelevantService.cs` — {what it does and why it's relevant}
- `path/to/Config.json` — {what config is relevant}

### Architecture
{How the relevant part of the codebase is structured:}
- {e.g., "Export pipeline: ExportService → PdfIndexService → BlobUploader"}
- {e.g., "Config is loaded from appsettings.json, section 'BlobStorage'"}

### Tech Stack
- {e.g., ".NET 8 / C# console app"}
- {e.g., "Azure Blob Storage SDK"}

### Existing Branch
{If a feature branch for this story already exists from Step 4.5:}
- Branch: `{branchName}`
- Progress: {what's already done based on diff analysis}
- {Or "None — starting from scratch"}

## Implementation Notes

{Specific technical details extracted from the story description, acceptance criteria, and repo analysis. This is the "how" — concrete enough that an AI can act on it without guessing.}

- {e.g., "New file structure is {dataareaid}/{accountnum}/ — see DataMigration.PdfIndexService for the mapping logic"}
- {e.g., "Use existing export tool at path/to/tool — it already handles export and upload"}
- {e.g., "Blob storage connection string is in appsettings.json under 'SystemateBlobStorage'"}

## Contacts

{Only if the story mentions specific people:}
- {e.g., "Lars Hansen (lah@systemate.dk) — Systemate contact for blob storage"}
- {e.g., "CC: Christian Dam Nykjær (cdn@systemate.dk)"}

## Open Questions & Blockers

{Anything that is NOT yet resolved. The AI agent must NOT guess at these — they require human input.}

- [ ] {e.g., "Datasikkerhed: Afklaring af hvordan data krypteres under upload — BLOKERER implementation"}
- [ ] {e.g., "Er der rate limits på blob storage API'et?"}

{If no open questions: "None — ready for implementation."}

## Out of Scope

{What this story explicitly does NOT cover:}
- {e.g., "Migration of invoices older than 5 years"}
- {e.g., "Changes to the self-service frontend — that's a separate story"}

## Tasks (Azure DevOps)

| ID | Title | State |
|----|-------|-------|
{For each child task:}
| #{task.id} | {task.title} | {task.state} |

---
*Generated by /azdev-plan — {today's date}*
```

Formatting rules:
- Strip all HTML from description and acceptanceCriteria.
- If the story description contains specific details (file paths, class names, API info, contacts, config), extract them into the appropriate sections — do NOT just dump the description into "Background".
- If acceptanceCriteria is empty, derive testable criteria from the child tasks and the verified understanding.
- If the story has NO description and NO acceptance criteria, mark it clearly: "Insufficient detail — requires manual clarification before implementation."
- Do NOT include any HTML tags in the generated file.
- The "Open Questions & Blockers" section must NEVER be empty when the story description mentions unresolved items (e.g., "afklaring af...", "åbent:", "TBD", "TODO").

**Step 11 — Present for approval:**

After generating STORY.md, show the user the full content. Use `AskUserQuestion`:

"Review the generated story spec:

STORY.md has been written to {repoPath}/.planning/stories/{storyId}.md

[Show the full STORY.md content]

Approve, request changes, or skip? (approve/changes/skip)"

- If "approve": keep the file, move to next story.
- If "changes": ask "What would you like to change?" then regenerate incorporating the feedback, and re-present for approval. Repeat until approved or skipped.
- If "skip": delete the file. Note the skip in the final summary.

**Step 11.5 — Write azdev-task-map.json:**

After all repos have been processed (approved or skipped), update the task map for status tracking.

**Merge behavior:** If `$CWD/.planning/azdev-task-map.json` already exists, read it first and merge:
- Keep existing mappings for stories NOT being re-planned.
- Add or replace mappings for the story/stories just processed.
- Update `generatedAt` timestamp.

If the file does not exist, create it fresh.

For each **approved** repo, create a mapping entry:
- `storyId`: the Azure DevOps story ID (number)
- `storyTitle`: the story title
- `repoPath`: the resolved local repo path (from Step 4)
- `taskIds`: array of child task IDs that belong to this story
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

If all repos were skipped (no approved entries) and no existing file, do NOT write the file.

This file is used for automatic Azure DevOps status updates during execution: tasks are identified by their IDs and can be transitioned New → Active → Resolved using `azdev-tools.cjs update-state`.

**Step 12 — Final summary:**

After processing all repos, display:
```
=== Analysis Complete ===

Stories planned:
  #{storyId} {storyTitle} → {repoPath}/.planning/stories/{storyId}.md (approved)

Skipped:
  #{storyId} {storyTitle}: user skipped

Task map written to: $CWD/.planning/azdev-task-map.json

Next steps:
  Run `/azdev-execute {storyId}` to implement a story.
```

If `singleStoryMode`: simplify the summary to just show the single story result.

</process>

<error_handling>

**Common errors and responses:**

- Story has no description: Generate "What This Is" with "(No description provided). This work is tracked as Azure DevOps story #{story.id}: \"{story.title}\"."

- Story has no acceptance criteria AND no child tasks: Generate a single placeholder requirement: `- [ ] Implement story #{story.id}: {story.title}`.

- Empty sprint or no assigned stories: Display "No stories assigned to you in the current sprint. Nothing to analyze."

- Story ID not found (single-story mode): Display "Story #{targetStoryId} not found in your current sprint items. Run `/azdev-sprint` to see your assigned items."

- Repo path does not exist or has no .git: Warn user and re-ask for repo.

</error_handling>

<success_criteria>
- Single-story mode: `/azdev-plan 42920` processes only story #42920 without multi-story summary
- All-stories mode: `/azdev-plan` (no args) processes all assigned stories as before
- Task/child ID argument resolves to parent story automatically
- User selects repo from Azure DevOps project repos (fetched via list-repos)
- Repo choice is stored in azdev-task-map.json for use during execution
- Each story is interactively verified with the user before file generation (Step 5.5)
- Verified analysis replaces the story description in Azure DevOps (Step 5.6)
- STORY.md contains specific, concrete details (file paths, class names, contacts, blockers) — not generic placeholders
- Open questions and blockers from the story description are explicitly captured
- Stories are correctly categorized by work type (code change vs manual/operational vs blocked)
- User can approve or request changes per repo before files are finalized
- No HTML artifacts appear in any generated file
- azdev-task-map.json merges with existing entries (does not overwrite unrelated stories)
- Task IDs in the map can be used to update status (New → Active → Resolved) during execution
</success_criteria>
