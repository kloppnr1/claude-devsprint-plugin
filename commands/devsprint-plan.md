---
name: devsprint-plan
description: Analyze and plan sprint stories — all assigned or a single story by ID
argument-hint: "[story-id]"
allowed-tools:
  - Read
  - Write
  - Bash
  - AskUserQuestion
  - mcp__azure-devops__ado_work_list_team_iterations
  - mcp__azure-devops__ado_wit_my_work_items
  - mcp__azure-devops__ado_wit_get_work_items_for_iteration
  - mcp__azure-devops__ado_wit_get_work_item
  - mcp__azure-devops__ado_wit_update_work_item
  - mcp__azure-devops__ado_wit_add_work_item_comment
  - mcp__azure-devops__ado_wit_update_work_item_comment
  - mcp__azure-devops__ado_repo_list_repos_by_project
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
Azure DevOps access: via MCP server (@azure-devops/mcp) — tools prefixed with `mcp__azure-devops__ado_`.
Local helpers (file I/O only): ~/.claude/bin/devsprint-tools.cjs — used for parse-file, report-status, clear-status.
$CWD is the project directory where .planning/ lives.
</execution_context>

<context>
MCP tool reference (Azure DevOps operations):

  mcp__azure-devops__ado_work_list_team_iterations
    -> Lists team iterations. Use with project "Verdo Agile Development" and timeframe "current" to get the current sprint.
    -> Returns iteration details: id, name, path, startDate, finishDate.

  mcp__azure-devops__ado_wit_my_work_items
    -> Returns work items assigned to the authenticated user.
    -> Equivalent to the old get-sprint-items --me. Returns items with id, type, title, state, description, acceptanceCriteria, parentId, assignedTo, tags.

  mcp__azure-devops__ado_wit_get_work_items_for_iteration
    -> Returns ALL work items in a specific sprint iteration (not just assigned to you).
    -> Use to get the full iteration picture when needed.

  mcp__azure-devops__ado_wit_get_work_item
    -> Fetches a single work item by ID. Use expand=Relations to get child work item links and attachments.
    -> Returns: id, type, title, state, description, acceptanceCriteria, assignedTo, tags, relations (including child links and attachment URLs).
    -> To get children: extract child IDs from relations (where rel === "System.LinkTypes.Hierarchy-Forward"), then batch-fetch them.

  mcp__azure-devops__ado_wit_update_work_item
    -> Updates a work item's fields (description, acceptance criteria, state, etc.).
    -> Use for both update-description and update-acceptance-criteria operations.

  mcp__azure-devops__ado_wit_add_work_item_comment
    -> Adds a comment (Discussion) to a work item. Text accepts HTML for rich formatting.

  mcp__azure-devops__ado_wit_update_work_item_comment
    -> Updates or deletes a comment on a work item.

  mcp__azure-devops__ado_repo_list_repos_by_project
    -> Lists Git repositories in the Azure DevOps project.
    -> Returns: name, id, remoteUrl, etc.

Local CLI helpers (kept — local file I/O only):

  node ~/.claude/bin/devsprint-tools.cjs parse-file --file <path> --cwd $CWD
    -> Extracts text from binary files (.msg, .eml, .docx, or plain text fallback)
    -> stdout: JSON {"status":"ok","type":"msg|eml|docx|text","subject":"...","from":"...","to":"...","date":"...","body":"..."}
    -> exit 0 on success, exit 1 on error

  node ~/.claude/bin/devsprint-tools.cjs report-status --command plan --step "{step}" --detail "{detail}" --cwd $CWD
    -> Reports dashboard status. Add --story-id and --story-title when processing a specific story.

  node ~/.claude/bin/devsprint-tools.cjs clear-status --story-id {storyId} --cwd $CWD
    -> Clears dashboard status for a story.
</context>

<process>

**Step 0 — Parse arguments:**

Check if the user passed a work item ID as argument (e.g., `/devsprint-plan 42920` or `/devsprint-plan #42920`).
- If a numeric ID is provided: set `singleItemMode = true` and `targetItemId = <the ID>`. The type (story vs task) will be determined in Step 2.
- If no argument: set `singleItemMode = false` (process all assigned stories).

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

**Step 0.5 — Concurrency guard (per-story lock):**

Only one run (plan, execute, or PR-fix) may be active for a given story at a time. Before proceeding, check the agent status file:

```bash
cat "$CWD/.planning/devsprint-agent-status.json" 2>/dev/null
```

If the file exists and has an `active` object (not null), check:
- If `active.stories` contains a key matching the target `storyId` (in single-story mode), OR
- If `active.storyId` matches the target `storyId`

Then **abort immediately** with this message:
> "Story #{storyId} already has an active run (step: {active.stories[storyId].step}). Wait for it to finish before starting another."

In all-stories mode (no specific storyId): skip any story that appears in `active.stories` — do not abort the entire run, just skip that story and log it.

If the agent status has no `active` entry, or the target story is not in it, proceed normally.

**Step 1 — Check prerequisites:**

No prerequisites to check — MCP server handles Azure DevOps authentication via OAuth. Proceed directly.

**Step 1.5 — Dashboard status reporting (applies to ALL steps):**

Report status to the dashboard at EVERY major step by running:
`node ~/.claude/bin/devsprint-tools.cjs report-status --command plan --step "{step}" --detail "{detail}" --cwd $CWD`

If a story is being processed, always include: `--story-id {storyId} --story-title "{storyTitle}"`

Report at these points:
- Step 2 (all-stories mode only): `--step "Fetching sprint" --detail "Loading sprint metadata"`
- Step 3 (all-stories mode only): `--step "Loading stories" --detail "Fetching assigned work items"`
- Step 2 (single-story mode): `--step "Loading story" --detail "Fetching #{storyId}"`
- Step 2.5/3.6: `--step "Downloading attachments" --detail "Fetching {N} file(s) for #{storyId}"`
- Step 3.5: `--step "Checking existing" --detail "Checking for previous analysis"`
- Step 4: `--step "Resolving repo" --detail "Auto-detecting target repo for #{storyId}"`
- Step 4.5: `--step "Analyzing repo" --detail "Scanning {repoName} for #{storyId}"`
- Step 5.5: `--step "Verifying understanding" --detail "#{storyId} {short title}"`
- Step 5.6: `--step "Updating fields" --detail "Writing description for #{storyId}"`
- Step 8: `--step "Generating spec" --detail "Writing STORY.md for #{storyId}"`
- Step 10.5: `--step "Self-review" --detail "Validating spec quality for #{storyId}"`
- Step 11: `--step "Awaiting review" --detail "Presenting #{storyId} for approval"`
- Step 11.1: `--step "Posting spec comment" --detail "Adding spec to #{storyId} discussion"`
- Step 11.5: `--step "Writing task map" --detail "Updating devsprint-task-map.json"`

**CRITICAL — Sub-agent status reporting:**
When you launch sub-agents (e.g., for parallel repo analysis or spec generation), EACH agent's prompt MUST include the `report-status` command and instructions to call it at key points. Include this in every agent prompt:
```
DASHBOARD STATUS: Report your progress by running this command at each major step:
  node ~/.claude/bin/devsprint-tools.cjs report-status --command plan --story-id {storyId} --story-title "{storyTitle}" --step "<step>" --detail "<detail>" --cwd {$CWD}

Report at these points:
  - Starting analysis: --step "Analyzing repo" --detail "Scanning {repoName} for #{storyId}"
  - Found key files: --step "Analyzing repo" --detail "Mapping code flow for #{storyId}"
  - Checking existing branch: --step "Analyzing repo" --detail "Checking branches for #{storyId}"
  - Writing spec: --step "Generating spec" --detail "Writing STORY.md for #{storyId}"
  - Updating fields: --step "Updating fields" --detail "Writing description for #{storyId}"
  - Posting comment: --step "Posting spec comment" --detail "Adding spec to #{storyId} discussion"
```
Without this, the dashboard status will go STALE during parallel agent work. Every agent MUST report status.

**Step 2 — Fetch stories:**

**If `singleItemMode`:** Skip sprint metadata fetch. Fetch the work item directly:
Call `mcp__azure-devops__ado_wit_get_work_item` with the `targetItemId` and expand=Relations.
- If error: show error. Stop.
- If success: parse the response. Find the target item.

**If the target item is a User Story:** also fetch child tasks. Extract child IDs from the relations (where rel === "System.LinkTypes.Hierarchy-Forward"), then batch-fetch them with `mcp__azure-devops__ado_wit_get_work_item` for each child ID. Alternatively, call `mcp__azure-devops__ado_wit_my_work_items` with project "Verdo Agile Development" and filter for items where `parentId === targetItemId` — these are the child tasks.

**Determine item type and planning scope:**

1. If the target item's `type === "User Story"`: Find child tasks from the relations or my-work-items response (filtered by `parentId === targetItemId`).

   Filter child tasks to only those in **New** or **Active** state (exclude Resolved, Closed, Done). Call these `plannable tasks`.

   **If plannable tasks count > 1:**

   **If `headless = true`:** Write a question using the headless protocol asking the user to choose scope:
   ```json
   {
     "storyId": {targetItemId},
     "storyTitle": "{story title}",
     "timestamp": "{ISO timestamp}",
     "questions": [
       {
         "id": "scope",
         "text": "#{targetItemId} har {N} tasks. Vil du planlægge hele storyen eller kun én bestemt task?",
         "type": "choice",
         "options": ["Hele storyen", {for each plannable task: "Task #{task.id} — {task.title}"}]
       }
     ]
   }
   ```
   Poll for answers. Then:
   - If answer is "Hele storyen": set `planningScope = "story"`, `targetStoryId = targetItemId`.
   - If answer is a specific task: set `planningScope = "task"`, `targetTaskId = {selected task ID}`, `targetStoryId = targetItemId`. The parent story context is already fetched.

   **If `headless = false`:** Ask the user:
   - Question: "#{targetItemId} har {N} tasks. Vil du planlægge hele storyen eller kun én bestemt task?"
   - Options: "Hele storyen" / one option per plannable task: "Task #{task.id} — {task.title}"
   - If "Hele storyen": set `planningScope = "story"`, `targetStoryId = targetItemId`.
   - If a specific task is selected: set `planningScope = "task"`, `targetTaskId = {selected task ID}`, `targetStoryId = targetItemId`.

   **If plannable tasks count is 0 or 1:** set `planningScope = "story"`, `targetStoryId = targetItemId`. No question needed.

2. If the target item's `type === "Task"`: the user passed a task ID. Determine what to plan:

   **If `headless = true`:** Default to `planningScope = "task"` (they specifically requested this task). Set `targetTaskId = targetItemId`. Use the task's `parentId` to fetch the parent story for context:
   Call `mcp__azure-devops__ado_wit_get_work_item` with the parentId and expand=Relations.

   **If `headless = false`:** Ask the user:
   - Question: "#{targetItemId} is a task under story #{parentId} ({parentStoryTitle}). What do you want to plan?"
   - Options: "Only this task" / "The whole story"
   - If "Only this task": set `planningScope = "task"`, `targetTaskId = targetItemId`. Fetch parent story for context.
   - If "The whole story": set `planningScope = "story"`, `targetStoryId = parentId`. Fetch parent story and its children.

3. **Completed-check depends on scope:**
   - If `planningScope = "story"` and the story's state is "Resolved", "Closed", or "Done": display "Story #{targetStoryId} is already {state}. Nothing to plan." Stop.
   - If `planningScope = "task"` and the **task's** state is "Resolved", "Closed", or "Done": display "Task #{targetTaskId} is already {state}. Nothing to plan." Stop.
   - If `planningScope = "task"` and the task is New/Active but the **parent story** is Resolved: proceed normally. This is the "post-merge fix" scenario — a new task was added to an already-completed story.

- For `sprintName`, read it from existing `$CWD/.planning/devsprint-task-map.json` if available, otherwise use "unknown".
- Skip Step 5 (multi-story summary) and go directly to Step 4.

**Step 2.5 — Download and parse attachments (if any):**

For each story being processed, check if the work item response includes attachment URLs in the relations (attachments appear as relations with rel === "AttachedFile").

If the story has attachments:
1. Create the directory `$CWD/.planning/attachments/{storyId}/` if it doesn't exist.
2. For each attachment:
   a. Download the attachment file using Bash `curl` with the attachment URL (the MCP work item response includes the URL). If authentication is needed, use the WebFetch tool.
   b. Save to `$CWD/.planning/attachments/{storyId}/{attachment.name}`
   c. Run `node ~/.claude/bin/devsprint-tools.cjs parse-file --file "$CWD/.planning/attachments/{storyId}/{attachment.name}" --cwd $CWD`
   d. Store the parsed content (subject, from, to, date, body) alongside the story data. This content is used in Step 4.5 (repo analysis) and Step 5.5 (verification) as additional context for understanding the story.
3. Display: "Downloaded {N} attachment(s) for #{storyId}: {comma-separated file names}"

For images (.png, .jpg, .gif, .bmp, .svg): skip `parse-file` — instead, use the Read tool to view the image directly during Step 4.5 analysis.

The attachment content is treated as supplementary story context — it should be incorporated into the story spec (STORY.md) under a "## Attached Reference Material" section, summarizing the key information extracted from each attachment.

**If NOT `singleItemMode`:** Fetch the full sprint:
Call `mcp__azure-devops__ado_work_list_team_iterations` with project "Verdo Agile Development" and timeframe "current".
- If error: show the error message to the user. Stop.
- If success: parse the response. Extract `name` for display.

**Step 3 — Fetch assigned stories (skip if `singleItemMode`):**

Call `mcp__azure-devops__ado_wit_my_work_items` with project "Verdo Agile Development".
- If error: show the error message to the user. Stop.
- If success: parse the response.

Filter to top-level stories only:
- Items where `type === "User Story"` AND (`parentId === null` OR `parentId` is not present in the items list).
- Collect child tasks for each story: items where `parentId === storyId`.

**Filter out completed stories:**
- Remove stories where `state` is "Resolved", "Closed", or "Done".
- If ALL stories are completed, display: "All your stories are already resolved. Nothing to plan." Stop.

**Step 3.5 — Check for existing analysis:**

For each story to process, check if it has already been analyzed in a previous session:

1. Check if `$CWD/.planning/devsprint-task-map.json` exists and contains a mapping for this item's ID with a non-null `repoPath`. For tasks, also check if the parent story has a mapping.
2. If found, check if the spec file exists: `{repoPath}/.planning/stories/{id}.md` (where `id` is the story or task ID).
3. If BOTH exist (task map entry + spec file): the item has been previously analyzed.

For previously analyzed stories: display "#{id} — allerede analyseret, beholder eksisterende spec." and **skip this story entirely** — no repo analysis, no spec generation, no DevOps update. Mark as "kept existing" in the final summary. No prompt needed.

If the user passes `--reanalyze` flag in the arguments: re-analyze all stories regardless of existing specs. Parse this flag in Step 0 alongside other arguments.

For stories WITHOUT an existing analysis: proceed normally (no question asked).

**Step 3.6 — Fetch attachments (all-stories mode only):**

In all-stories mode, the my-work-items response may not include attachment info. For each story that will be analyzed (not skipped in Step 3.5), fetch its full details with attachments:

1. Call `mcp__azure-devops__ado_wit_get_work_item` with the storyId and expand=Relations — the response includes attachment URLs in relations if any exist.
2. If the story has attachments, follow the same download+parse flow as Step 2.5.

This adds one MCP call per story but ensures attachments are available for all modes.

**Story mode detection:**

For each story, check its `tags` array (case-insensitive). If tags include `"research"`, mark the story as `researchMode = true`. This affects Steps 4.5, 5.5, and 8:
- **Deeper analysis** — read more broadly in the repo, explore related systems and patterns, not just files matching keywords
- **More user involvement** — ask exploratory questions to understand the problem space before converging on a solution
- **Spec format** — STORY.md includes a "Research Findings" section and the acceptance criteria focus on what to investigate/document rather than what to build

**Step 4 — Resolve target repo:**

For each item to process (story or task), auto-detect the target repository. Only ask the user if auto-detection fails.

For tasks (`planningScope = "task"`): first check the parent story's mapping in the task map, since the task inherits its repo.

1. **Check existing task map first:** If `$CWD/.planning/devsprint-task-map.json` exists, check if this item (or its parent story) already has a `repoPath` mapping. If so, use that repo directly — display "#{id} → {repoName} (from task map)" and skip to step 5.

2. **Check if all other stories map to the same repo:** If the task map has other mappings and they ALL point to the same repo, use that repo — display "#{id} → {repoName} (same as other stories)".

3. **Scan parent directory:** Check if the parent directory of `$CWD` has exactly one repo folder (directory with `.git`). If exactly one: use that repo.

4. **Only ask if none of the above resolves a repo:**
   - Fetch repos from Azure DevOps: Call `mcp__azure-devops__ado_repo_list_repos_by_project` with project "Verdo Agile Development".
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

**Skip this step entirely if `singleItemMode` is true.** Go directly to Step 5.5.

Display summary in this format and continue immediately to Step 5.5 (no confirmation needed):
```
=== Analysis: {sprintName} ===

You have {N} stories:

  [US] #{id} -- {title} ({state}) → {repoName}
  [US] #{id} -- {title} ({state}) → {repoName}

Analyzing...
```

**Step 5.5 — Interactive verification:**

For each item (story or task), present the following to the user:

**If `planningScope = "task"`:** Present a task-focused verification:
```
### #{taskId} — {taskTitle} ({state})
**Parent story:** #{parentStory.id} — {parentStory.title}

**My understanding:**
{2-3 sentences summarizing what this specific task requires}

**Target repo:** {repoName} ({repoPath})

**Repo analysis** (from Step 4.5):
  Key files: {files relevant to this task}
  {If existing branch found: "Existing branch: {branchName}"}
```

**If `planningScope = "story"`:** Present the standard story verification:
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

**Step 5.6 — Update work item description in Azure DevOps:**

**If `skipDevOpsUpdate === true`: skip this entire step.**

For each verified item, **replace** the description with the verified analysis. Azure DevOps keeps revision history, so the original description is not lost.

**If `planningScope = "task"`:** Update the **task** work item (not the parent story):
```html
<b>Opsummering:</b> {verified understanding of this specific task}<br>
<br>
<b>Parent story:</b> #{parentStory.id} — {parentStory.title}<br>
<br>
<i>Task-analyse verificeret {today's date}</i>
```

**If `planningScope = "story"`:** Update the **story** work item:
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

Then call `mcp__azure-devops__ado_wit_update_work_item` with the work item ID and the new description HTML.
Where the work item ID is the task ID or story ID depending on `planningScope`.

If update fails, warn the user but continue (non-blocking error). The verified understanding is still used locally for file generation.

**Also update the Acceptance Criteria field** (story scope only — tasks don't have this field in Azure DevOps). Write user-friendly criteria (not technical) so a product owner or tester can verify without reading code. Use simple HTML:

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

Call `mcp__azure-devops__ado_wit_update_work_item` with the storyId and the acceptance criteria HTML.

If update fails, warn but continue (non-blocking).

**Step 8 — Generate spec file:**

**If `planningScope = "task"`:** generate a TASK.md. See **Step 8T** below.
**Otherwise:** generate a STORY.md as described here.

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

{If the story has attachments with parsed content:}
## Attached Reference Material

{For each attachment, summarize the key information extracted:}

### {attachment.name}
{If .msg: "**Email from** {from} **to** {to} — {date}"}
{If .msg: "**Subject:** {subject}"}
{Summarize the body content — extract actionable details, requirements, specifications, or context that is relevant to the implementation. Do NOT dump the raw body text — distill it into useful information.}

{If the attachment is an image: "**Screenshot/image** — [description of what the image shows, relevant to the story]"}
{end if}

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

**Step 8T — Generate TASK.md (only when `planningScope = "task"`):**

Use the `Write` tool to create `{repoPath}/.planning/stories/{taskId}.md`. Same directory as story specs — the ID makes it unique.

A task spec is **focused and concise** — it covers only the single task, not the full story. It references the parent story for broader context.

```markdown
# #{task.id} — {task.title}

> **Sprint**: {sprintName} | **Repo**: {repoName} | **Parent story**: #{parentStory.id} {parentStory.title} | **State**: {task.state}

## Goal

{One sentence: what is the concrete deliverable when this task is done?}

## Parent Story Context

{2-3 sentences summarizing the parent story's purpose, so the developer understands where this task fits. Extract from parentStory.description.}

## Acceptance Criteria

- [ ] {Specific, testable criterion derived from the task title and parent story context}
- [ ] {Additional criteria if the task description or parent acceptance criteria add requirements}

## Key Files

{From repo analysis — only files relevant to THIS task, not the full story:}
- `path/to/File.cs` — {what it does and why it's relevant to this task}

## Implementation Notes

{Concrete technical guidance for this specific task:}
- {e.g., "Add a new method to ExistingService.cs that calls the Settl API"}
- {e.g., "Follow the pattern in SimilarFeature.cs for the query structure"}

## Open Questions & Blockers

{Anything unresolved for this specific task:}
- [ ] {e.g., "API credentials for Settl — where are they stored?"}

{If none: "None — ready for implementation."}

---
*Generated by /devsprint-plan — {today's date}*
```

The same CRITICAL RULES apply as for STORY.md: extract specific details, no vague placeholders, concrete file paths from repo analysis.

**Step 10.5 — Self-review before presenting:**

Before showing the spec to the user, run it through this checklist. Fix any issues silently before presenting.

| Check | Pass criteria |
|-------|--------------|
| Goal is specific | Contains concrete nouns (file paths, feature names, systems) — not just "implement task/story" |
| Acceptance criteria are testable | Each criterion describes an observable outcome, not a vague quality |
| Key Files lists real paths | Every path was confirmed to exist during repo analysis |
| Code flow is traced | At least one call chain is documented (A → B → C). For TASK.md: optional if the task is simple/isolated. |
| No vague placeholders | No "{TBD}", "relevant files", "as needed", "etc." without specifics |
| Open Questions captures unknowns | Everything marked "afklaring", "TBD", "TODO" in the source is listed here |
| Out of Scope is explicit | At least one item, or "N/A — self-contained" (STORY.md only — TASK.md skips this section) |
| Implementation Notes are actionable | An AI agent reading only this file could start coding without asking questions (except items in Open Questions) |

If a check fails and the information exists (in the item, repo, or verified understanding), fix it. If the information doesn't exist, add it to Open Questions instead of guessing.

**Step 11 — Present for approval:**

**If `headless = true`:** Auto-approve the spec. The user can review it later in the dashboard. Skip the interactive review and go directly to Step 11.1.

**If `headless = false`:** After generating the spec, show the user the full content:

"Spec written to {repoPath}/.planning/stories/{itemId}.md"

[Show the full spec content]

Then display: **"Ændringer?"** and STOP. Wait for the user's free-text reply. This is a simple free-text flow — no `AskUserQuestion`.

- If the user writes changes/corrections: incorporate them, re-write the file, **re-present the FULL updated content**, and ask "Ændringer?" again. Repeat until the user is satisfied.
- If the user says "ok", "nej", "fortsæt", "lgtm", or similar affirmative/continue: keep the file, post spec to Azure DevOps (Step 11.1), then move to next item.
- If the user says "skip": delete the file. Note the skip in the final summary.

**Step 11.1 — Post spec as Azure DevOps comment:**

**If `skipDevOpsUpdate === true`: skip this entire step.**

After a spec is approved, post a **summary** as an HTML-formatted comment on the work item in Azure DevOps. For tasks, post the comment on the **task** work item (not the parent story).

**Convert the spec to an HTML summary** for the comment. Do NOT dump the full markdown — create a clean, structured HTML version with:
- `<h2>` for the title
- `<h3>` for sections (Goal, Acceptance Criteria, Key Files, Open Questions)
- `<ul>/<li>` for lists
- `<table>` for the key files table
- `<code>` for file paths and code references
- `<b>` for emphasis, `<i>` for metadata
- Skip verbose sections (full Implementation Notes, Architecture details) — those live in the local spec file

Call `mcp__azure-devops__ado_wit_add_work_item_comment` with the work item ID and the HTML summary.
Where the work item ID is the story ID or task ID depending on `planningScope`.

If the comment post fails, warn the user but continue (non-blocking error). The local spec file is the source of truth.

**Step 11.5 — Write devsprint-task-map.json:**

After all repos have been processed (approved or skipped), update the task map for status tracking.

**Merge behavior:** If `$CWD/.planning/devsprint-task-map.json` already exists, read it first and merge:
- Keep existing mappings for stories NOT being re-planned.
- Add or replace mappings for the story/stories just processed.
- Update `generatedAt` timestamp.

If the file does not exist, create it fresh.

For each **approved** item, create a mapping entry:
- `storyId`: the Azure DevOps story ID (number). For task-only planning, use the **parent story ID**.
- `storyTitle`: the story title (parent story title for tasks)
- `repoPath`: the resolved local repo path (from Step 4)
- `taskIds`: array of task IDs. For task-only planning, include only the planned task ID.
- `taskTitles`: object mapping task ID → title. For task-only planning, include only the planned task.

**Task-only planning behavior:** When `planningScope = "task"`, the task map entry uses the parent story as the key (since execution runs per-story). If a mapping for the parent story already exists, merge the new task into its `taskIds`/`taskTitles` — do not overwrite the existing entry.

Write the complete map to `$CWD/.planning/devsprint-task-map.json` using the Write tool:
```json
{
  "version": 1,
  "sprintName": "{sprintName from Step 2}",
  "generatedAt": "{ISO timestamp}",
  "mappings": [ ... entries for approved items ... ]
}
```

If all items were skipped (no approved entries) and no existing file, do NOT write the file.

This file maps stories/tasks to their local repo paths for execution.

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

If `singleItemMode`: simplify the summary to just show the single item result. For tasks, show:
```
Task planned:
  #{taskId} {taskTitle} (under #{parentStoryId}) → {repoPath}/.planning/stories/{taskId}.md (approved)
```

**Step 12.5 — Clear dashboard status and clean up:**

Run `node ~/.claude/bin/devsprint-tools.cjs clear-status --story-id {storyId} --cwd $CWD` to mark this story as idle (without affecting other running stories). If processing multiple stories, call this for each story individually.

If `headless = true`: clean up any leftover question/answer files for processed stories:
```bash
rm -f "$CWD/.planning/questions/{storyId}.json" "$CWD/.planning/answers/{storyId}.json"
```

**Step 13 — Prompt to start execution:**

After displaying the final summary, show the next step as plain text. Do NOT prompt or use `AskUserQuestion`.

**If `singleItemMode`** and `planningScope = "task"`:
- Display: "Planning complete. Run `/devsprint-execute {parentStoryId}` to implement the story (includes this task)."

**If `singleItemMode`** and `planningScope = "story"`:
- Display: "Planning complete. Run `/devsprint-execute {targetStoryId}` to implement."

**If all-stories mode** (planned the full sprint):
- Display: "Planning complete. Run `/devsprint-execute` to implement all stories."

</process>

<error_handling>

**Common errors and responses:**

- Story has no description: Generate "What This Is" with "(No description provided). This work is tracked as Azure DevOps story #{story.id}: \"{story.title}\"."

- Story has no acceptance criteria AND no child tasks: Generate a single placeholder requirement: `- [ ] Implement story #{story.id}: {story.title}`.

- Empty sprint or no assigned stories: Display "No stories assigned to you in the current sprint. Nothing to analyze."

- Work item ID not found: Display "#{targetItemId} not found. Run `/devsprint-sprint` to see your assigned items."

- Repo path does not exist or has no .git: Warn user and re-ask for repo.

</error_handling>

<success_criteria>
- Single-story mode: `/devsprint-plan 42920` processes only story #42920 without multi-story summary
- Single-task mode: `/devsprint-plan 42934` detects the item is a Task, asks user whether to plan the task or its parent story (headless defaults to task-only)
- Task-only planning generates a focused TASK.md (lighter than STORY.md) with parent story context
- All-stories mode: `/devsprint-plan` (no args) processes all assigned stories as before
- Repo is auto-detected from task map or parent directory; user is only asked when auto-detection fails
- Repo choice is stored in devsprint-task-map.json for use during execution
- Each item's analysis is shown to the user (Step 5.5) — non-research items continue automatically, research stories use interactive dialogue
- Verified analysis replaces the description in Azure DevOps (Step 5.6)
- Spec files contain specific, concrete details (file paths, class names, contacts, blockers) — not generic placeholders
- Open questions and blockers from the description are explicitly captured
- Stories are correctly categorized by work type (code change vs manual/operational vs blocked)
- User can review and request changes to specs via free-text flow (no AskUserQuestion)
- No HTML artifacts appear in any generated file
- devsprint-task-map.json merges with existing entries (does not overwrite unrelated stories)
- Task-only planning merges into the parent story's task map entry (does not create a separate mapping)
- Task IDs in the map can be used to update status (New → Active → Resolved) during execution
</success_criteria>
