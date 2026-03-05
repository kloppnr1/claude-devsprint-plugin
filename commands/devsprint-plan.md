---
name: devsprint-plan
description: Analyze and plan sprint stories — all assigned or a single story by ID
argument-hint: "[story-id]"
allowed-tools:
  - Read
  - Write
  - Bash
  - AskUserQuestion
---

<objective>
Fetch assigned stories from the current Azure DevOps sprint, ask the user which repo each story belongs to, interactively verify each story with the user, update story descriptions in Azure DevOps, generate a detailed STORY.md spec per story (optimized for both human reading and AI-driven implementation), and present each for user approval. Write devsprint-task-map.json for status tracking during execution.

If a story ID is provided as argument, only process that single story (skip multi-story summary, go straight to analysis).
</objective>

<execution_context>
Helper: ~/.claude/bin/devsprint-tools.cjs
Config file: .planning/devsprint-config.json
$CWD is the project directory where .planning/ lives.
</execution_context>

<context>
devsprint-tools.cjs CLI contracts:

  node ~/.claude/bin/devsprint-tools.cjs load-config --cwd $CWD
    -> stdout: JSON {"org":"...","project":"...","pat":"<raw-decoded>"}
    -> exit 0 on success, exit 1 if no config

  node ~/.claude/bin/devsprint-tools.cjs get-sprint --cwd $CWD
    -> stdout: JSON {"iterationId":"...","name":"...","path":"...","startDate":"...","finishDate":"..."}
    -> exit 0 on success, exit 1 on error

  node ~/.claude/bin/devsprint-tools.cjs get-sprint-items --me --cwd $CWD
    -> stdout: JSON array [{id, type, title, state, description, acceptanceCriteria, parentId, assignedTo, tags}]
    -> tags: array of strings (e.g., ["research", "blocked"])
    -> --me: filter to authenticated user's items (parent stories + child tasks)
    -> exit 0 on success, exit 1 on error

  node ~/.claude/bin/devsprint-tools.cjs update-description --id <workItemId> --description "<html>" --cwd $CWD
    -> stdout: JSON {"status":"updated","id":N}
    -> Uses PATCH API with application/json-patch+json content type
    -> exit 0 on success, exit 1 on error

  node ~/.claude/bin/devsprint-tools.cjs list-repos --cwd $CWD
    -> stdout: JSON array [{"name":"...","id":"...","remoteUrl":"...","lastPushDate":"..."}]
    -> Lists Git repositories in the Azure DevOps project
    -> exit 0 on success, exit 1 on error

  node ~/.claude/bin/devsprint-tools.cjs update-acceptance-criteria --id <workItemId> --criteria "<html>" --cwd $CWD
    -> stdout: JSON {"status":"updated","id":N}
    -> Updates the Acceptance Criteria field of a work item. Accepts HTML.
    -> exit 0 on success, exit 1 on error

  node ~/.claude/bin/devsprint-tools.cjs add-comment --id <workItemId> --text "<html>" --cwd $CWD
    -> stdout: JSON {"status":"created","id":N,"commentId":N}
    -> Adds a comment (Discussion) to a work item. Text accepts HTML for rich formatting.
    -> exit 0 on success, exit 1 on error

  node ~/.claude/bin/devsprint-tools.cjs delete-comment --id <workItemId> --comment-id <commentId> --cwd $CWD
    -> stdout: JSON {"status":"deleted","id":N,"commentId":N}
    -> Deletes a comment from a work item.
    -> exit 0 on success, exit 1 on error
</context>

<process>

**Step 0 — Parse arguments:**

Check if the user passed a story ID as argument (e.g., `/devsprint-plan 42920` or `/devsprint-plan #42920`).
- If a numeric ID is provided: set `singleStoryMode = true` and `targetStoryId = <the ID>`.
- If no argument: set `singleStoryMode = false` (process all assigned stories).
- If argument is a task ID (not a story), it will be resolved to its parent story in Step 3.

**Step 1 — Check prerequisites:**

1. Verify `~/.claude/bin/devsprint-tools.cjs` exists via Bash `test -f ~/.claude/bin/devsprint-tools.cjs`.
   If it does not exist: tell the user "Azure DevOps tools not installed. Check that ~/.claude/bin/devsprint-tools.cjs exists." Stop.

2. Run `node ~/.claude/bin/devsprint-tools.cjs load-config --cwd $CWD`.
   If exit 1: tell the user "No Azure DevOps config found. Run `/devsprint-setup` to configure your connection." Stop.

**Step 2 — Fetch sprint metadata:**

Run `node ~/.claude/bin/devsprint-tools.cjs get-sprint --cwd $CWD`.
- If exit 1: show the error message to the user. Stop.
- If exit 0: parse the JSON. Extract `name` for display.

**Step 3 — Fetch assigned stories:**

Run `node ~/.claude/bin/devsprint-tools.cjs get-sprint-items --me --cwd $CWD`.
- If exit 1: show the error message to the user. Stop.
- If exit 0: parse the JSON array.

Filter to top-level stories only:
- Items where `type === "User Story"` AND (`parentId === null` OR `parentId` is not present in the items list).
- Collect child tasks for each story: items where `parentId === storyId`.

**Filter out completed stories:**
- Remove stories where `state` is "Resolved", "Closed", or "Done".
- If ALL stories are completed, display: "All your stories are already resolved. Nothing to plan." Stop.
- In `singleStoryMode`: if the target story is completed, display: "Story #{targetStoryId} is already {state}. Nothing to plan." Stop.

**Single-story filtering (if `singleStoryMode`):**
- Find the item matching `targetStoryId` in the fetched items.
- If the matching item is a Task (not a User Story), use its `parentId` to find the parent story. Process that parent story only.
- If the matching item IS a User Story, process it directly.
- If `targetStoryId` is not found in the sprint items, tell the user: "Story #{targetStoryId} not found in your current sprint items." Stop.
- After filtering, continue with only this one story — skip Step 5 (multi-story summary) and go directly to Step 4.

**Story mode detection:**

For each story, check its `tags` array (case-insensitive). If tags include `"research"`, mark the story as `researchMode = true`. This affects Steps 4.5, 5.5, and 8:
- **Deeper analysis** — read more broadly in the repo, explore related systems and patterns, not just files matching keywords
- **More user involvement** — ask exploratory questions to understand the problem space before converging on a solution
- **Spec format** — STORY.md includes a "Research Findings" section and the acceptance criteria focus on what to investigate/document rather than what to build

**Step 4 — Ask user for target repo per story:**

For each story to process, ask the user which Azure DevOps repository it belongs to.

1. **Fetch repos from Azure DevOps:** Run `node ~/.claude/bin/devsprint-tools.cjs list-repos --cwd $CWD`.
   Parse the JSON array of `{name, id, remoteUrl}`.

2. **Check existing task map:** If `$CWD/.planning/devsprint-task-map.json` exists, check if this story already has a `repoPath` mapping. If so, use the repo name from that path as the default suggestion.

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

1. **Switch to the target repo directory** and map the repo structure:
   - Identify tech stack from project files (package.json, *.csproj, *.sln, Cargo.toml, etc.).
   - Run `git branch -a` to see available branches.
   - Map top-level directory structure to understand architecture layers.

2. **Targeted code search based on story keywords:**
   - Extract key nouns from the story title, description, and task titles (e.g., "prisområde", "faktura", "blob storage").
   - Use `grep -r` or equivalent to find files/classes matching those keywords in the repo.
   - For each match: **read the file** (or relevant section) to understand what it does and how it relates to the story.
   - Follow imports and references to map the relevant code flow (e.g., Controller → Service → Repository).
   - Goal: identify the **specific files that will need changes**, not just the general architecture.

   **If `researchMode`:** go broader — don't just search for story keywords:
   - Explore related subsystems, similar patterns already in the codebase, and adjacent features
   - Read config files, database schemas, API contracts, and test files to understand the full picture
   - Look at git log for recent changes in related areas (`git log --oneline -20 -- {relevant paths}`)
   - Document alternative approaches you discover (e.g., "there's already a similar pattern in X that could be reused")
   - Goal: build a **comprehensive understanding** of the problem space, not just find files to edit

3. **Check for existing work:** Check if a feature branch for this story already exists:
   - Run `git branch -a | grep -i {storyId}` to find branches matching the story ID.
   - If a matching branch exists, get the diff against the default branch to see existing progress.

4. **Produce a repo analysis summary** for each story:
   - **Tech stack**: detected from repo (e.g., "C# / .NET 8", "TypeScript / React 18", "Python / FastAPI")
   - **Key files**: specific files/classes that are relevant to this story, with a one-line description of each (e.g., "`src/Services/PriceAreaService.cs` — resolves DK1/DK2 based on postal code")
   - **Code flow**: the path through the codebase that this story touches (e.g., "PriceController.GetArea() → PriceAreaService.Resolve() → PostalCodeRepository.Lookup()")
   - **Architecture observations**: key patterns or layers in the repo (e.g., "API controller + service layer + DB migration")
   - **Existing branch**: if a feature branch for this story was found, note it and summarize progress
   - **Risks or concerns**: anything notable (e.g., "large repo", "complex build setup", "no existing tests for this area")

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

**Assess information completeness** before asking for confirmation. Check:
- Does the story have enough detail to write a specific Goal? (not just a title)
- Are there concrete acceptance criteria, or do they need to be derived?
- Did the repo analysis find specific files, or is the relevant code unclear?
- Are there implicit assumptions that should be made explicit?

If information is insufficient, **ask targeted questions** instead of guessing:
```
I need more detail to write a good spec for #{id}:

1. {specific question — e.g., "Which postal codes map to DK1 vs DK2?"}
2. {specific question — e.g., "Should this be a new endpoint or extend the existing /prices?"}
3. {specific question — e.g., "The repo has no tests — should I include test requirements?"}
```

Only proceed to confirmation when you have enough detail for every STORY.md section.

**If `researchMode`:** replace the standard verification with a deeper research dialogue. This is a multi-round conversation, not a single confirm/deny:

1. **Present research findings** from the broader repo analysis (Step 4.5):
   ```
   ### #{id} — {title} (research)

   **Problem space:**
   {What the story is asking to investigate/solve — framed as questions, not solutions}

   **What I found in the codebase:**
   - {Finding 1: e.g., "There's already a PriceAreaService but it hardcodes DK1 for all customers"}
   - {Finding 2: e.g., "The PostalCode table has a Region column but it's always NULL"}
   - {Finding 3: e.g., "Similar logic exists in BillingService for tax zone lookup"}

   **Possible approaches:**
   - A: {approach + pros/cons}
   - B: {approach + pros/cons}
   - C: {approach + pros/cons}

   **Open questions I can't answer from code alone:**
   - {e.g., "Is the postal code → price area mapping maintained externally or should it be in the DB?"}
   - {e.g., "Should this affect existing contracts or only new ones?"}
   ```

2. **Ask the user to react**: "Which approach makes sense? What am I missing? Are there constraints I should know about?"

3. **Iterate**: based on user feedback, refine the understanding. Do additional code analysis if the user points you in a new direction. Repeat until the user says the understanding is solid.

4. **Converge**: summarize the agreed approach and confirm before moving to spec generation.

The goal is to **explore the problem together** before committing to a plan. Research stories often don't have clear requirements upfront — the plan process IS the requirements process.

Use `AskUserQuestion` with:
- Question: "Is this understanding correct for #{id}?"
- Options: "Yes" / "No, let me correct it"

If "Yes": store the verified understanding (summary text + work type) for this story.
If "No, let me correct it": ask "What is the correct understanding?" as a free-text follow-up. Then re-present the corrected version for confirmation. Repeat until approved.

The verified understanding per story is used in later steps for project file generation.

**Step 5.6 — Update story description in Azure DevOps:**

For each verified story, **replace** the description with the verified analysis. Azure DevOps keeps revision history, so the original description is not lost.

Construct the new description in HTML (Azure DevOps descriptions use HTML, not markdown):
```html
<b>Arbejdstype:</b> {Code change/Manual/operational/Blocked}<br>
<br>
<b>Opsummering:</b> {verified understanding text}<br>
<br>
<b>Opgaver:</b><br>
{for each child task: "- {task.title} ({task.state})<br>"}
<br>
<i>Sprint-analyse verificeret {today's date}</i>
```

Then run:
```
node ~/.claude/bin/devsprint-tools.cjs update-description --id {storyId} --description "{newDescriptionHtml}" --cwd $CWD
```

If update fails, warn the user but continue (non-blocking error). The verified understanding is still used locally for file generation.

**Also update the Acceptance Criteria field** with user-friendly criteria (not technical). These should be written so a product owner or tester can verify them without reading code. Use simple HTML:

```html
<ul>
<li>Bruger kan se {feature} i {location}</li>
<li>{Observable outcome from user perspective}</li>
</ul>
```

Rules for user-facing acceptance criteria:
- Write in the same language as the story (Danish if story is Danish)
- No file paths, class names, or technical implementation details
- Focus on what the user sees/experiences, not how it's built
- Each criterion should be verifiable by a non-developer
- Include any blocked/skipped items with explanation

Run:
```
node ~/.claude/bin/devsprint-tools.cjs update-acceptance-criteria --id {storyId} --criteria "{html}" --cwd $CWD
```

If update fails, warn but continue (non-blocking).

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

> **Sprint**: {sprintName} | **Repo**: {repoName} | **Type**: {work type} | **State**: {story.state} {If researchMode: "| **Tags**: research"}

## Goal

{One sentence: what is the end result when this story is done? Be specific — not "upload files" but "historical invoices from the last 5 years are uploaded to Systemate Blob Storage in the structure {dataareaid}/{accountnum}/"}

## Background

{2-4 sentences of context from the verified understanding. Include:}
- Why this work is needed (business reason)
- What system/feature it relates to
- Any prior work or existing functionality that this builds on
- Key domain concepts a developer needs to understand

{If researchMode, include this section — otherwise skip:}
## Research Findings

{Summary of the research dialogue from Step 5.5. This captures what was discovered and decided.}

### Problem Analysis
- {Key insight about the problem space}
- {What was unclear and how it was resolved}

### Approaches Considered
- **{Approach A}**: {description} — {why chosen / why rejected}
- **{Approach B}**: {description} — {why chosen / why rejected}

### Agreed Approach
{The approach the user confirmed during the research dialogue. This is what the implementation should follow.}

{End of research-only section}

## Acceptance Criteria

{Derived from story.acceptanceCriteria AND child tasks. Each criterion must be specific and testable.}
{If researchMode: criteria focus on what to investigate, document, or prototype — e.g., "Document the mapping between postal codes and price areas" or "Prototype approach A and measure performance"}

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
*Generated by /devsprint-plan — {today's date}*
```

Formatting rules:
- Strip all HTML from description and acceptanceCriteria.
- If the story description contains specific details (file paths, class names, API info, contacts, config), extract them into the appropriate sections — do NOT just dump the description into "Background".
- If acceptanceCriteria is empty, derive testable criteria from the child tasks and the verified understanding.
- If the story has NO description and NO acceptance criteria, mark it clearly: "Insufficient detail — requires manual clarification before implementation."
- Do NOT include any HTML tags in the generated file.
- The "Open Questions & Blockers" section must NEVER be empty when the story description mentions unresolved items (e.g., "afklaring af...", "åbent:", "TBD", "TODO").

**Step 10.5 — Self-review before presenting:**

Before showing STORY.md to the user, run it through this checklist. Fix any issues silently before presenting.

| Check | Pass criteria |
|-------|--------------|
| Goal is specific | Contains concrete nouns (file paths, feature names, systems) — not just "implement story" |
| Acceptance criteria are testable | Each criterion describes an observable outcome, not a vague quality |
| Key Files lists real paths | Every path was confirmed to exist during repo analysis |
| Code flow is traced | At least one call chain is documented (A → B → C) |
| No vague placeholders | No "{TBD}", "relevant files", "as needed", "etc." without specifics |
| Open Questions captures unknowns | Everything marked "afklaring", "TBD", "TODO" in the source is listed here |
| Out of Scope is explicit | At least one item, or "N/A — story is self-contained" |
| Implementation Notes are actionable | An AI agent reading only this file could start coding without asking questions (except items in Open Questions) |

If a check fails and the information exists (in the story, repo, or verified understanding), fix it. If the information doesn't exist, add it to Open Questions instead of guessing.

**Step 11 — Present for approval:**

After generating STORY.md, show the user the full content. Use `AskUserQuestion`:

"Review the generated story spec:

STORY.md has been written to {repoPath}/.planning/stories/{storyId}.md

[Show the full STORY.md content]

Approve, request changes, or skip? (approve/changes/skip)"

- If "approve": keep the file, post spec to Azure DevOps (Step 11.1), then move to next story.
- If "changes": ask "What would you like to change?" then regenerate incorporating the feedback, and re-present for approval. Repeat until approved or skipped.
- If "skip": delete the file. Note the skip in the final summary.

**Step 11.1 — Post spec as Azure DevOps comment:**

After a story is approved, post a **summary** of the STORY.md as an HTML-formatted comment on the work item in Azure DevOps. This makes the spec visible to team members in the Discussion tab.

**Convert STORY.md to an HTML summary** for the comment. Do NOT dump the full markdown — create a clean, structured HTML version with:
- `<h2>` for the story title
- `<h3>` for sections (Goal, Acceptance Criteria, Key Files, Blocked Tasks, Out of Scope, Tasks)
- `<ul>/<li>` for lists
- `<table>` for the key files and tasks tables
- `<code>` for file paths and code references
- `<b>` for emphasis, `<i>` for metadata
- Skip verbose sections (full Implementation Notes, Architecture details) — those live in the local STORY.md

Run:
```
node ~/.claude/bin/devsprint-tools.cjs add-comment --id {storyId} --text "{htmlSummary}" --cwd $CWD
```

If the comment post fails, warn the user but continue (non-blocking error). The local STORY.md is the source of truth.

**Step 11.5 — Write devsprint-task-map.json:**

After all repos have been processed (approved or skipped), update the task map for status tracking.

**Merge behavior:** If `$CWD/.planning/devsprint-task-map.json` already exists, read it first and merge:
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

Write the complete map to `$CWD/.planning/devsprint-task-map.json` using the Write tool:
```json
{
  "version": 1,
  "sprintName": "{sprintName from Step 2}",
  "generatedAt": "{ISO timestamp}",
  "mappings": [ ... entries for approved repos ... ]
}
```

If all repos were skipped (no approved entries) and no existing file, do NOT write the file.

This file is used for automatic Azure DevOps status updates during execution: tasks are identified by their IDs and can be transitioned New → Active → Resolved using `devsprint-tools.cjs update-state`.

**Step 12 — Final summary:**

After processing all repos, display:
```
=== Analysis Complete ===

Stories planned:
  #{storyId} {storyTitle} → {repoPath}/.planning/stories/{storyId}.md (approved)

Skipped:
  #{storyId} {storyTitle}: user skipped

Task map written to: $CWD/.planning/devsprint-task-map.json

Next steps:
  Run `/devsprint-execute {storyId}` to implement a story.
```

If `singleStoryMode`: simplify the summary to just show the single story result.

**Step 13 — Prompt to start execution:**

After displaying the final summary, immediately prompt the user to start execution. The prompt depends on which mode was used:

**If `singleStoryMode`** (planned a single story):
- Ask: "Start execute for #{targetStoryId}?"
- Options: "Yes — execute now" / "No — I'm done for now"
- If yes: run `/devsprint-execute {targetStoryId}` via the Skill tool.
- If no: end with "Planning complete. Run `/devsprint-execute {targetStoryId}` when you're ready."

**If all-stories mode** (planned the full sprint):
- Ask: "Start executing the full sprint?"
- Options: "Yes — execute all stories" / "No — I'm done for now"
- If yes: run `/devsprint-execute` (no argument) via the Skill tool to execute the full sprint.
- If no: end with "Planning complete. Run `/devsprint-execute` when you're ready."

</process>

<error_handling>

**Common errors and responses:**

- Story has no description: Generate "What This Is" with "(No description provided). This work is tracked as Azure DevOps story #{story.id}: \"{story.title}\"."

- Story has no acceptance criteria AND no child tasks: Generate a single placeholder requirement: `- [ ] Implement story #{story.id}: {story.title}`.

- Empty sprint or no assigned stories: Display "No stories assigned to you in the current sprint. Nothing to analyze."

- Story ID not found (single-story mode): Display "Story #{targetStoryId} not found in your current sprint items. Run `/devsprint-sprint` to see your assigned items."

- Repo path does not exist or has no .git: Warn user and re-ask for repo.

</error_handling>

<success_criteria>
- Single-story mode: `/devsprint-plan 42920` processes only story #42920 without multi-story summary
- All-stories mode: `/devsprint-plan` (no args) processes all assigned stories as before
- Task/child ID argument resolves to parent story automatically
- User selects repo from Azure DevOps project repos (fetched via list-repos)
- Repo choice is stored in devsprint-task-map.json for use during execution
- Each story is interactively verified with the user before file generation (Step 5.5)
- Verified analysis replaces the story description in Azure DevOps (Step 5.6)
- STORY.md contains specific, concrete details (file paths, class names, contacts, blockers) — not generic placeholders
- Open questions and blockers from the story description are explicitly captured
- Stories are correctly categorized by work type (code change vs manual/operational vs blocked)
- User can approve or request changes per repo before files are finalized
- No HTML artifacts appear in any generated file
- devsprint-task-map.json merges with existing entries (does not overwrite unrelated stories)
- Task IDs in the map can be used to update status (New → Active → Resolved) during execution
</success_criteria>
