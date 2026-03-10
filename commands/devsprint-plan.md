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

<feedback_rule>
**CRITICAL — Free-text feedback rule:**
When the user chooses an option that means "change something" / "correct something" / "edit" (e.g., "Ændringer", "No, let me correct it", "Edit"), you MUST respond with a single plain-text question like "Hvad vil du ændre?" and then STOP and WAIT for the user's free-text reply. Do NOT use `AskUserQuestion` with multiple-choice options to guess what they want to change — that creates frustrating loops. Only use `AskUserQuestion` for structured choices (yes/no, pick from a list), never for open-ended feedback collection.
</feedback_rule>

<context_rule>
**NEVER mention context usage, context limits, or suggest starting a new session.** NEVER offer to "save findings for later" or "continue in a new session" or "take this up in a fresh session". Auto-compact handles context automatically. Just keep working.
</context_rule>

<objective>
Fetch assigned stories from the current Azure DevOps sprint, auto-detect the target repo per story, analyze the codebase, update story descriptions in Azure DevOps, generate a detailed STORY.md spec per story (optimized for both human reading and AI-driven implementation), and present each for review. Write devsprint-task-map.json for status tracking during execution. Minimizes prompts — only asks the user when auto-detection fails or for spec review feedback.

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

  node ~/.claude/bin/devsprint-tools.cjs get-work-item <id> --cwd $CWD
    -> Fetches a single work item by ID with its children (same output format as get-sprint-items)
    -> stdout: JSON array [{id, type, title, state, description, acceptanceCriteria, parentId, assignedTo, tags}]
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

Check for the `--no-devops-update` flag in the arguments:
- If present: set `skipDevOpsUpdate = true`. This skips ALL writes to Azure DevOps (description, acceptance criteria, and comments). The local STORY.md spec is still generated normally.
- If not present: set `skipDevOpsUpdate = false` (default — Azure DevOps fields are updated).

Check for the `--headless` flag in the arguments:
- If present: set `headless = true`. In headless mode, NEVER use `AskUserQuestion`. Instead, write questions to `.planning/questions/{storyId}.json` and poll for answers at `.planning/answers/{storyId}.json`. See **Headless question/answer protocol** below.
- If not present: set `headless = false` (default — interactive mode with `AskUserQuestion`).

Check for the `--reanalyze` flag in the arguments:
- If present: set `forceReanalyze = true`. This forces re-analysis of all stories even if they have existing specs.
- If not present: set `forceReanalyze = false` (default — previously analyzed stories are skipped automatically).

**Headless question/answer protocol (only when `headless = true`):**

When running headless, you cannot use `AskUserQuestion`. Instead, use file-based communication with the dashboard:

1. **Writing questions:** When you need user input (repo selection, verification, research dialogue, etc.), write all questions to a single file:
   ```
   mkdir -p "$CWD/.planning/questions"
   ```
   Then use the Write tool to create `$CWD/.planning/questions/{storyId}.json`:
   ```json
   {
     "storyId": 42920,
     "storyTitle": "Story title here",
     "timestamp": "2026-03-09T10:00:00Z",
     "questions": [
       { "id": "q1", "text": "Which repo should this story target?", "type": "choice", "options": ["RepoA", "RepoB", "Other"] },
       { "id": "q2", "text": "Any additional context for this story?", "type": "text" }
     ]
   }
   ```
   Question types: `"text"` (free-form textarea) or `"choice"` (radio buttons with `options` array).

2. **Waiting for answers:** After writing the questions file, poll for answers every 5 seconds:
   ```bash
   test -f "$CWD/.planning/answers/{storyId}.json" && echo "found" || echo "waiting"
   ```
   Keep polling until the file exists (max 10 minutes, then auto-continue with best-effort defaults).

3. **Reading answers:** Once the answers file exists, read `$CWD/.planning/answers/{storyId}.json`:
   ```json
   {
     "storyId": 42920,
     "storyTitle": "Story title here",
     "answers": [
       { "id": "q1", "answer": "RepoA" },
       { "id": "q2", "answer": "Some extra context" }
     ]
   }
   ```
   Use the answers to continue the plan as if the user had answered interactively.

4. **Cleanup:** After reading answers, delete BOTH files:
   ```bash
   rm -f "$CWD/.planning/questions/{storyId}.json" "$CWD/.planning/answers/{storyId}.json"
   ```

5. **When NOT to ask questions in headless mode:** If auto-detection succeeds (repo found in task map, parent dir, etc.), do NOT write questions — just continue silently. Only write questions when you genuinely need user input that cannot be auto-resolved.

6. **Non-research stories in headless mode:** For non-research stories where information is sufficient, skip the interactive verification entirely — auto-approve and continue to spec generation. Only write questions if the information completeness check (Step 5.5) identifies missing critical details.

**Step 1 — Check prerequisites:**

1. Verify `~/.claude/bin/devsprint-tools.cjs` exists via Bash `test -f ~/.claude/bin/devsprint-tools.cjs`.
   If it does not exist: tell the user "Azure DevOps tools not installed. Check that ~/.claude/bin/devsprint-tools.cjs exists." Stop.

2. Run `node ~/.claude/bin/devsprint-tools.cjs load-config --cwd $CWD`.
   If exit 1: tell the user "No Azure DevOps config found. Run `/devsprint-setup` to configure your connection." Stop.

**Step 1.5 — Dashboard status reporting (applies to ALL steps):**

Report status to the dashboard at EVERY major step by running:
`node ~/.claude/bin/devsprint-tools.cjs report-status --step "{step}" --detail "{detail}" --cwd $CWD`

If a story is being processed, always include: `--story-id {storyId} --story-title "{storyTitle}"`

Report at these points:
- Step 2 (all-stories mode only): `--step "Fetching sprint" --detail "Loading sprint metadata"`
- Step 3 (all-stories mode only): `--step "Loading stories" --detail "Fetching assigned work items"`
- Step 2 (single-story mode): `--step "Loading story" --detail "Fetching #{storyId}"`
- Step 3.5: `--step "Checking existing" --detail "Checking for previous analysis"`
- Step 4: `--step "Resolving repo" --detail "Auto-detecting target repo for #{storyId}"`
- Step 4.5: `--step "Analyzing repo" --detail "Scanning {repoName} for #{storyId}"`
- Step 5.5: `--step "Verifying understanding" --detail "#{storyId} {short title}"`
- Step 5.6: `--step "Updating DevOps" --detail "Writing description for #{storyId}"`
- Step 8: `--step "Generating spec" --detail "Writing STORY.md for #{storyId}"`
- Step 10.5: `--step "Self-review" --detail "Validating spec quality for #{storyId}"`
- Step 11: `--step "Awaiting review" --detail "Presenting #{storyId} for approval"`
- Step 11.1: `--step "Posting to DevOps" --detail "Adding spec comment to #{storyId}"`
- Step 11.5: `--step "Writing task map" --detail "Updating devsprint-task-map.json"`

**CRITICAL — Sub-agent status reporting:**
When you launch sub-agents (e.g., for parallel repo analysis or spec generation), EACH agent's prompt MUST include the `report-status` command and instructions to call it at key points. Include this in every agent prompt:
```
DASHBOARD STATUS: Report your progress by running this command at each major step:
  node ~/.claude/bin/devsprint-tools.cjs report-status --story-id {storyId} --story-title "{storyTitle}" --step "<step>" --detail "<detail>" --cwd {$CWD}

Report at these points:
  - Starting analysis: --step "Analyzing repo" --detail "Scanning {repoName} for #{storyId}"
  - Found key files: --step "Analyzing repo" --detail "Mapping code flow for #{storyId}"
  - Checking existing branch: --step "Analyzing repo" --detail "Checking branches for #{storyId}"
  - Writing spec: --step "Generating spec" --detail "Writing STORY.md for #{storyId}"
  - Updating DevOps: --step "Updating DevOps" --detail "Writing description for #{storyId}"
  - Posting comment: --step "Posting to DevOps" --detail "Adding spec comment to #{storyId}"
```
Without this, the dashboard status will go STALE during parallel agent work. Every agent MUST report status.

**Step 2 — Fetch stories:**

**If `singleStoryMode`:** Skip sprint metadata fetch. Fetch the story directly:
Run `node ~/.claude/bin/devsprint-tools.cjs get-work-item {targetStoryId} --cwd $CWD`.
- If exit 1: show error. Stop.
- If exit 0: parse the JSON array. Find the story item and its child tasks.
- If the target ID is a Task (not a User Story), use its `parentId` to find the parent story. Process that parent story.
- If the story's state is "Resolved", "Closed", or "Done": display "Story #{targetStoryId} is already {state}. Nothing to plan." Stop.
- For `sprintName`, read it from existing `$CWD/.planning/devsprint-task-map.json` if available, otherwise use "unknown".
- Skip Step 5 (multi-story summary) and go directly to Step 4.

**If NOT `singleStoryMode`:** Fetch the full sprint:
Run `node ~/.claude/bin/devsprint-tools.cjs get-sprint --cwd $CWD`.
- If exit 1: show the error message to the user. Stop.
- If exit 0: parse the JSON. Extract `name` for display.

**Step 3 — Fetch assigned stories (skip if `singleStoryMode`):**

Run `node ~/.claude/bin/devsprint-tools.cjs get-sprint-items --me --cwd $CWD`.
- If exit 1: show the error message to the user. Stop.
- If exit 0: parse the JSON array.

Filter to top-level stories only:
- Items where `type === "User Story"` AND (`parentId === null` OR `parentId` is not present in the items list).
- Collect child tasks for each story: items where `parentId === storyId`.

**Filter out completed stories:**
- Remove stories where `state` is "Resolved", "Closed", or "Done".
- If ALL stories are completed, display: "All your stories are already resolved. Nothing to plan." Stop.

**Step 3.5 — Check for existing analysis:**

For each story to process, check if it has already been analyzed in a previous session:

1. Check if `$CWD/.planning/devsprint-task-map.json` exists and contains a mapping for this story's ID with a non-null `repoPath`.
2. If found, check if `{repoPath}/.planning/stories/{storyId}.md` exists.
3. If BOTH exist (task map entry + spec file): the story has been previously analyzed.

For previously analyzed stories: display "#{id} — allerede analyseret, beholder eksisterende spec." and **skip this story entirely** — no repo analysis, no spec generation, no DevOps update. Mark as "kept existing" in the final summary. No prompt needed.

If the user passes `--reanalyze` flag in the arguments: re-analyze all stories regardless of existing specs. Parse this flag in Step 0 alongside other arguments.

For stories WITHOUT an existing analysis: proceed normally (no question asked).

**Story mode detection:**

For each story, check its `tags` array (case-insensitive). If tags include `"research"`, mark the story as `researchMode = true`. This affects Steps 4.5, 5.5, and 8:
- **Deeper analysis** — read more broadly in the repo, explore related systems and patterns, not just files matching keywords
- **More user involvement** — ask exploratory questions to understand the problem space before converging on a solution
- **Spec format** — STORY.md includes a "Research Findings" section and the acceptance criteria focus on what to investigate/document rather than what to build

**Step 4 — Ask user for target repo per story:**

For each story to process, auto-detect the target repository. Only ask the user if auto-detection fails.

1. **Check existing task map first:** If `$CWD/.planning/devsprint-task-map.json` exists, check if this story already has a `repoPath` mapping. If so, use that repo directly — display "#{id} → {repoName} (from task map)" and skip to step 5.

2. **Check if all other stories map to the same repo:** If the task map has other mappings and they ALL point to the same repo, use that repo — display "#{id} → {repoName} (same as other stories)".

3. **Scan parent directory:** Check if the parent directory of `$CWD` has exactly one repo folder (directory with `.git`). If exactly one: use that repo.

4. **Only ask if none of the above resolves a repo:**
   - Fetch repos from Azure DevOps: Run `node ~/.claude/bin/devsprint-tools.cjs list-repos --cwd $CWD`.
   - **If `headless = true`:** Write a question file using the headless protocol. Use `type: "choice"` with the repo names as options. Then poll for the answer.
   - **If `headless = false`:** Ask the user using `AskUserQuestion`:
     - Question: "Which repo should story #{id} ({title}) be planned in?"
     - Options: list the Azure DevOps repo names as options (max 4, prioritize repos already in the task map). The user can also type a custom name/path via "Other".

5. **Resolve the local path:**
   - Scan the parent directory of `$CWD` for a folder matching the selected repo name: `test -d "{parentDir}/{repoName}/.git"`
   - If found: use `{parentDir}/{repoName}` as the path.
   - **If `headless = true` and NOT found:** Write a question asking for the local path, then poll for the answer.
   - **If `headless = false` and NOT found:** Ask the user for the local path to the repo using `AskUserQuestion`: "Repo '{repoName}' not found at {parentDir}/{repoName}. Where is it cloned locally?"
   - If the user provides a custom path: verify it exists and contains `.git` via Bash. If not, warn and re-ask.

6. Store the resolved `repoPath` for this story. Continue to Step 4.5.

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

Display summary in this format and continue immediately to Step 5.5 (no confirmation needed):
```
=== Analysis: {sprintName} ===

You have {N} stories:

  [US] #{id} -- {title} ({state}) → {repoName}
  [US] #{id} -- {title} ({state}) → {repoName}

Analyzing...
```

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

**If `headless = true`:** Write questions using the headless protocol (file-based). Each missing piece of information becomes a question with `type: "text"`. Then poll for answers and incorporate them before continuing.

**If `headless = false`:** Ask directly in the conversation:
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

**For non-research stories:** Display the verification summary (it's useful for the user to see) but continue automatically to spec generation. No prompt needed. Store the understanding (summary text + work type) for this story. **In headless mode:** same behavior — auto-continue without questions if info is sufficient.

**For research stories (`researchMode`):** Keep the interactive dialogue — this IS the requirements process.
- **If `headless = true`:** Write the research findings and open questions as a question file using the headless protocol. Include the findings summary as context in the question text, and ask the user to pick an approach and answer open questions. Poll for answers, then continue.
- **If `headless = false`:** Use `AskUserQuestion` with:
  - Question: "Is this understanding correct for #{id}?"
  - Options: "Yes" / "No, let me correct it"
If "Yes": store the verified understanding and continue.
If "No, let me correct it": respond with plain text "Hvad skal rettes?" and STOP. Wait for the user's free-text reply. Incorporate feedback, re-present, confirm again.

**For ALL stories:** If the information completeness check (above) identifies missing critical details, still ask targeted questions before continuing — regardless of research mode.

The verified understanding per story is used in later steps for project file generation.

**Step 5.6 — Update story description in Azure DevOps:**

**If `skipDevOpsUpdate === true`: skip this entire step.**

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

**If `headless = true`:** Auto-approve the spec. The user can review it later in the dashboard (the spec panel shows STORY.md content). Skip the interactive review and go directly to Step 11.1. The dashboard will show the story as "planned" once the task map is written.

**If `headless = false`:** After generating STORY.md, show the user the full content:

"STORY.md has been written to {repoPath}/.planning/stories/{storyId}.md"

[Show the full STORY.md content]

Then display: **"Ændringer?"** and STOP. Wait for the user's free-text reply. This is a simple free-text flow — no `AskUserQuestion`.

- If the user writes changes/corrections: incorporate them, re-write the STORY.md file, **re-present the FULL updated content**, and ask "Ændringer?" again. Repeat until the user is satisfied.
- If the user says "ok", "nej", "fortsæt", "lgtm", or similar affirmative/continue: keep the file, post spec to Azure DevOps (Step 11.1), then move to next story.
- If the user says "skip": delete the file. Note the skip in the final summary.

**Step 11.1 — Post spec as Azure DevOps comment:**

**If `skipDevOpsUpdate === true`: skip this entire step.**

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

This file maps stories to their local repo paths for execution.

**Step 12 — Final summary:**

After processing all repos, display:
```
=== Analysis Complete ===

Stories planned:
  #{storyId} {storyTitle} → {repoPath}/.planning/stories/{storyId}.md (approved)

Kept existing:
  #{storyId} {storyTitle} (already analyzed — kept existing spec)

Skipped:
  #{storyId} {storyTitle}: user skipped

Task map written to: $CWD/.planning/devsprint-task-map.json

Next steps:
  Run `/devsprint-execute {storyId}` to implement a story.
```

If `singleStoryMode`: simplify the summary to just show the single story result.

**Step 12.5 — Clear dashboard status and clean up:**

Run `node ~/.claude/bin/devsprint-tools.cjs clear-status --cwd $CWD` to mark the agent as idle.

If `headless = true`: clean up any leftover question/answer files for processed stories:
```bash
rm -f "$CWD/.planning/questions/{storyId}.json" "$CWD/.planning/answers/{storyId}.json"
```

**Step 13 — Prompt to start execution:**

After displaying the final summary, show the next step as plain text. Do NOT prompt or use `AskUserQuestion`.

**If `singleStoryMode`** (planned a single story):
- Display: "Planning complete. Run `/devsprint-execute {targetStoryId}` to implement."

**If all-stories mode** (planned the full sprint):
- Display: "Planning complete. Run `/devsprint-execute` to implement all stories."

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
- Repo is auto-detected from task map or parent directory; user is only asked when auto-detection fails
- Repo choice is stored in devsprint-task-map.json for use during execution
- Each story's analysis is shown to the user (Step 5.5) — non-research stories continue automatically, research stories use interactive dialogue
- Verified analysis replaces the story description in Azure DevOps (Step 5.6)
- STORY.md contains specific, concrete details (file paths, class names, contacts, blockers) — not generic placeholders
- Open questions and blockers from the story description are explicitly captured
- Stories are correctly categorized by work type (code change vs manual/operational vs blocked)
- User can review and request changes to STORY.md via free-text flow (no AskUserQuestion)
- No HTML artifacts appear in any generated file
- devsprint-task-map.json merges with existing entries (does not overwrite unrelated stories)
- Task IDs in the map can be used to update status (New → Active → Resolved) during execution
</success_criteria>
