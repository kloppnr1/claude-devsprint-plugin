---
name: devsprint-execute
description: Execute story or task plans — implement, push, and create PR
argument-hint: "[story-id or task-id]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
  - Agent
  - mcp__azure-devops__ado_wit_get_work_items_for_iteration
  - mcp__azure-devops__ado_wit_my_work_items
  - mcp__azure-devops__ado_wit_update_work_item
  - mcp__azure-devops__ado_wit_get_work_item
  - mcp__azure-devops__ado_repo_create_pull_request
  - mcp__azure-devops__ado_wit_link_work_item_to_pull_request
---

<feedback_rule>
**CRITICAL — Free-text feedback rule:**
When the user needs to provide open-ended feedback or corrections, respond with a plain-text question and STOP. Wait for their free-text reply. Do NOT use `AskUserQuestion` with multiple-choice guesses for open-ended input — that creates frustrating loops. Only use `AskUserQuestion` for structured choices (yes/no, pick from a list).
</feedback_rule>

<context_rule>
**NEVER mention context usage, context limits, or suggest starting a new session.** NEVER offer to "save findings for later" or "continue in a new session" or "take this up in a fresh session". Auto-compact handles context automatically. Just keep working.
</context_rule>

<objective>
Execute one or all stories/tasks from the task map. For each item: create a feature branch, implement the work from the spec, push, and create a PR. The work item is NOT auto-resolved — the user must verify the PR and approve from the dashboard.

**Mode depends on arguments:**
- With story ID (`/devsprint-execute 42920`): single-story mode — interactive, can ask user questions on blockers.
- With task ID (`/devsprint-execute 42934`): single-task mode — only implements that specific task. Detects task vs story by checking if a task spec (`{taskId}.md`) exists, or by fetching the work item type from Azure DevOps.
- Without arguments (`/devsprint-execute`): all-stories mode — autonomous loop, never asks questions, skips blockers and moves to next story.
</objective>

<execution_context>
Local helper (git/file ops only): ~/.claude/bin/devsprint-tools.cjs
Azure DevOps API: MCP tools prefixed with `mcp__azure-devops__ado_`
Task map: .planning/devsprint-task-map.json
$CWD is the project directory where .planning/ lives.
</execution_context>

<context>
**MCP tools** for Azure DevOps operations (authentication handled automatically via OAuth):

  mcp__azure-devops__ado_wit_my_work_items
    -> Returns the current user's work items from the current sprint
    -> Use project name "Verdo Agile Development"

  mcp__azure-devops__ado_wit_get_work_items_for_iteration
    -> Returns all work items for a specific iteration/sprint
    -> Use project name "Verdo Agile Development"

  mcp__azure-devops__ado_wit_get_work_item
    -> Returns a single work item by ID
    -> Use project name "Verdo Agile Development"

  mcp__azure-devops__ado_wit_update_work_item
    -> Updates fields on a work item (e.g., state)
    -> Use project name "Verdo Agile Development"
    -> Valid states: "New", "Active", "Resolved", "Closed"

  mcp__azure-devops__ado_repo_create_pull_request
    -> Creates a pull request in an Azure DevOps Git repository
    -> Use project name "Verdo Agile Development"

  mcp__azure-devops__ado_wit_link_work_item_to_pull_request
    -> Links a work item to a pull request
    -> Use project name "Verdo Agile Development"

**Local CLI contracts** (kept for local git and file operations):

  node ~/.claude/bin/devsprint-tools.cjs create-branch --repo <path> --story-id <id> --title <title> [--base <branch>]
    -> Stashes dirty changes, fetches base branch (develop, fallback main), creates feature/<id>-<slug>
    -> stdout: JSON {"branch":"...","base":"...","created":true|false}
    -> exit 0 on success, exit 1 on error

  node ~/.claude/bin/devsprint-tools.cjs report-status --command execute --story-id <id> --story-title "<title>" --step "<step>" --detail "<detail>" --repo "<repoName>" --cwd $CWD
    -> Reports execution progress to the dashboard

  node ~/.claude/bin/devsprint-tools.cjs clear-status --story-id <id> --cwd $CWD
    -> Clears agent status for a story in the dashboard

  node ~/.claude/bin/devsprint-screenshot.cjs --url <url> --output <path> [--width 1280] [--height 900] [--wait 2000] [--full-page]
    -> Takes a browser screenshot using Puppeteer (auto-installs if needed)
    -> stdout: JSON {"status":"ok","output":"<absolute-path>","url":"...","viewport":{...}}
    -> exit 0 on success, exit 1 on error

devsprint-execution-log.json structure (written by /devsprint-execute after each story):
  {
    "executions": [
      {
        "storyId": 12345,
        "storyTitle": "As a user I want...",
        "status": "completed|partial|skipped",
        "branch": "feature/12345-...",
        "baseBranch": "develop",
        "prUrl": "https://...",
        "prId": 123,
        "testsPassed": 42,
        "testsFailed": 0,
        "testCommand": "dotnet test",
        "testSuiteStatus": "all passed|failures|no test infrastructure",
        "skipReason": null,
        "completedAt": "2025-01-15T12:00:00.000Z"
      }
    ]
  }

devsprint-task-map.json structure (written by /devsprint-plan):
  {
    "version": 1,
    "sprintName": "Sprint 5",
    "generatedAt": "2025-01-15T10:00:00.000Z",
    "mappings": [
      {
        "storyId": 12345,
        "storyTitle": "As a user I want...",
        "repoPath": "/home/user/repos/MyApp"
      }
    ]
  }
</context>

<process>

**Step 1 — Parse arguments and determine mode:**

Check if the user passed a work item ID as argument (e.g., `/devsprint-execute 42920` or `/devsprint-execute #42920`).

- If a numeric ID is provided: `mode = "single"`, `targetItemId = <the ID>`. The type (story vs task) is determined in Step 3c.
- If no argument: `mode = "all"`.

Check for the `--headless` flag in the arguments:
- If present: set `headless = true`. This makes single-story mode fully autonomous (same as all-stories mode) — no `AskUserQuestion`, blockers are logged and skipped. Used by the dashboard to spawn execution in the background.
- If not present: set `headless = false` (default).

**Check for user comment (headless mode only):**

When `headless = true` and a `targetItemId` is set, check if the user sent a comment from the dashboard:

```bash
cat "$CWD/.planning/execution-context/{targetItemId}.txt" 2>/dev/null
```

If the file exists and has content: store the text as `userComment`. This is a free-text instruction from the user that MUST be respected during execution. Common examples:
- "Skip task #42913" — do not implement that specific task
- "Use the existing PriceService pattern" — architectural guidance
- "Only do the backend, skip frontend tasks" — scope limitation
- "Deploy to staging after commit" — post-implementation instruction

The `userComment` must be passed into every sub-agent prompt as additional context:
```
USER COMMENT: {userComment}
Respect this instruction throughout execution.
```

After reading, delete the file to prevent it from affecting future runs:
```bash
rm -f "$CWD/.planning/execution-context/{targetItemId}.txt"
```

**Behavioral rules by mode:**
- `single` mode (default): mostly autonomous. The agent makes best judgment calls on blockers and continues. Only uses `AskUserQuestion` if the story spec explicitly marks something as "BLOKERER implementation". Stop on critical errors.
- `single` mode with `--headless`: fully autonomous, identical to `all` mode. NEVER uses `AskUserQuestion`. Blockers are logged as "skipped" and the agent continues. Critical errors are logged, not stopped on.
- `all` mode: fully autonomous. The agent does NOT use `AskUserQuestion` at any point. If you encounter a blocker on one story, log the error and move on to the next story. The user expects to walk away and come back to completed work.

**Context isolation:** In both modes, each story runs inside its own Agent to keep the main conversation lightweight and prevent context exhaustion. The orchestrator only handles pre-flight checks, agent launching, log writing, and the final summary.

**Step 1.5 — Concurrency guard (per-story lock):**

Only one run (plan, execute, or PR-fix) may be active for a given story at a time. Before proceeding, check the agent status file:

```bash
cat "$CWD/.planning/devsprint-agent-status.json" 2>/dev/null
```

If the file exists and has an `active` object (not null), check:
- If `active.stories` contains a key matching the target `storyId` (in single mode), OR
- If `active.storyId` matches the target `storyId`

Then **abort immediately** with this message:
> "Story #{storyId} already has an active run (step: {active.stories[storyId].step}). Wait for it to finish before starting another."

In `all` mode (no specific storyId): skip any story that appears in `active.stories` — do not abort the entire run, just skip that story and log it.

If the agent status has no `active` entry, or the target story is not in it, proceed normally.

**Step 2 — Check prerequisites:**

1. Check that `$CWD/.planning/devsprint-task-map.json` exists via Bash `test -f`.
   If missing: tell user "No task map found. Run `/devsprint-plan` first to analyze your sprint stories." Stop.

2. Read `$CWD/.planning/devsprint-task-map.json` using the Read tool. Parse the JSON.
   If the `mappings` array is empty: tell user "Task map has no story mappings. Run `/devsprint-plan` and approve at least one story." Stop.

**Step 2.5 — Load execution log:**

Read `$CWD/.planning/devsprint-execution-log.json` if it exists. This file tracks previous execution results.

Structure:
```json
{
  "executions": [
    {
      "storyId": 12345,
      "taskId": null,
      "executionScope": "story",
      "status": "completed",
      "branch": "feature/12345-...",
      "prUrl": "https://...",
      "testsPassed": 42,
      "testsFailed": 0,
      "testSuiteStatus": "all passed",
      "completedAt": "2025-01-15T12:00:00.000Z"
    },
    {
      "storyId": 12345,
      "taskId": 12346,
      "executionScope": "task",
      "status": "completed",
      "branch": "feature/12346-...",
      "prUrl": "https://...",
      "completedAt": "2025-01-16T09:00:00.000Z"
    }
  ]
}
```

Note: a story can have both a story-level entry AND multiple task-level entries. This happens when a story is executed, then later individual tasks are added and executed separately (post-merge fix scenario).

If the file doesn't exist, initialize as `{"executions": []}`. Store as `executionLog`.

**Step 3 — Pre-flight status check and story selection:**

**Step 3a — Fetch live Azure DevOps state:**

Call `mcp__azure-devops__ado_wit_my_work_items` (project: "Verdo Agile Development") to get all sprint items with their current states.

For each mapping in the task map, determine its status by checking:
1. The execution log (was it previously executed?)
2. The Azure DevOps state (is the story Resolved/Closed?)
3. Whether the story title contains "BLOKERET" (blocked)
4. Whether the mapping has `repoPath` (is it actionable?)

Classify each story into one of these categories:
- `already-executed` — found in execution log with status "completed" AND story is Resolved/Closed in DevOps
- `already-resolved` — story is Resolved/Closed/Done in DevOps (even if not in log)
- `blocked` — title contains "BLOKERET"
- `not-actionable` — no repoPath
- `partial` — found in execution log with status "partial"
- `pending` — not yet executed, has work to do

**Step 3b — Display pre-flight status:**

Display a clear status table showing ALL stories and what will happen:

```
╔══════════════════════════════════════════════════════╗
║              Pre-flight Status Check                 ║
╠══════════════════════════════════════════════════════╣
║ Sprint: {sprintName}                                 ║
╚══════════════════════════════════════════════════════╝

{for each mapping in task map, sorted by category:}

Already completed:
  ✓ #{storyId} — {storyTitle}
    Executed: {completedAt} | PR: {prUrl}
  ✓ #{storyId} — {storyTitle}
    Resolved in DevOps

Skipping:
  ⊘ #{storyId} — {storyTitle} (BLOKERET)
  ⊘ #{storyId} — {storyTitle} (no repo assigned)

Will execute:
  → #{storyId} — {storyTitle}
    State: {devOpsState} | Repo: {repoPath}
  → #{storyId} — {storyTitle} (RESUMING)
    Previous: {completedAt}

Summary: {pendingCount} to execute, {completedCount} already done, {skippedCount} skipped
```

**Step 3c — Select stories to execute:**

If `mode === "single"`:

**Determine if the ID is a story or task:**

1. First check: does a spec file exist at `{repoPath}/.planning/stories/{targetItemId}.md` for any mapping in the task map? If yes, the spec tells you the type:
   - If the spec header contains `**Parent story**:`: it's a **task spec**. Set `executionScope = "task"`, `targetTaskId = targetItemId`. Extract the parent story ID from the spec. Find the task map mapping using the parent story ID.
   - Otherwise: it's a **story spec**. Set `executionScope = "story"`, `targetStoryId = targetItemId`. Find the mapping normally.

2. If no spec file found: check if `targetItemId` matches a `storyId` in the task map directly. If yes: `executionScope = "story"`.

3. If still not found: check if `targetItemId` appears in any mapping's `taskIds` array. If yes: `executionScope = "task"`, use that mapping's `storyId` as the parent.

4. If still not found: call `mcp__azure-devops__ado_wit_get_work_item` to fetch the work item and check its type. If it's a Task, use its `parentId` to find the mapping. If it's a Story, look for it in the task map.

5. If the mapping is still not found: "#{targetItemId} is not in the task map. Available stories: {list}." Stop.

**Completed-check depends on scope:**

- If `executionScope = "story"`:
  - If the story is `already-executed` or `already-resolved`: display "#{targetItemId} already completed. Use `--force` to re-execute." and stop.

- If `executionScope = "task"`:
  - Check the **task's** state in Azure DevOps (not the parent story). The parent story may be Resolved while this new task is still New/Active.
  - If the **task** is Resolved/Closed/Done: display "Task #{targetTaskId} already completed." and stop.
  - If the task is New or Active: proceed — even if the parent story is Resolved. This is the "post-merge fix" scenario where a new task is added to an already-completed story.
  - Check the execution log for an entry with matching `taskId` (not just `storyId`). Only skip if a task-level entry exists with status "completed".

- Store as a single-item list: `storiesToExecute = [matching mapping]`. Also store `executionScope` and `targetTaskId` (if task mode).

If `mode === "all"`:
- Only include stories classified as `pending` or `partial`.
- Skip `already-executed`, `already-resolved`, `blocked`, and `not-actionable`.
- If no stories remain to execute: display "All stories are already completed or skipped. Nothing to execute." Stop.
- Store as: `storiesToExecute = [pending + partial stories]`.

Display:
```
{mode === "all" ? "Starting autonomous execution of {storiesToExecute.length} stories..." : ""}
```

Initialize an empty `executionResults` list to collect per-story outcomes.

**Step 4 — Execute each story:**

**CRITICAL — Context isolation (both modes):**
Every story MUST be executed inside its own Agent (subagent_type: `general-purpose`) to prevent context window exhaustion in the main conversation. The orchestrator stays lightweight — it only launches agents and collects results. This applies to BOTH `all` and `single` mode.

For each mapping in `storiesToExecute` (index `i`, starting at 1):

Display:
```
{If executionScope = "task":}
━━━ [{i}/{total}] Task #{targetTaskId} — {taskTitle} (under #{storyId}) ━━━
{Else:}
━━━ [{i}/{total}] Story #{storyId} — {storyTitle} ━━━
```

Launch an Agent with the full execution instructions for this single story (Steps 4a–4h). The agent prompt must include:
- **CRITICAL context rule: NEVER mention context usage, context limits, or suggest starting a new session. NEVER offer to "save findings for later" or "continue in a new session". Auto-compact handles context automatically — just keep working.**
- The story/task mapping (storyId, storyTitle, repoPath) and `executionScope` ("story" or "task")
- If `executionScope = "task"`: the `targetTaskId` and the path to the task spec: `{repoPath}/.planning/stories/{targetTaskId}.md`
- If `executionScope = "story"`: the path to the story spec: `{repoPath}/.planning/stories/{storyId}.md`
- **MCP tool instructions**: The agent MUST use MCP tools for all Azure DevOps operations:
  - To update work item state: call `mcp__azure-devops__ado_wit_update_work_item` (project: "Verdo Agile Development")
  - To fetch work item details: call `mcp__azure-devops__ado_wit_get_work_item` (project: "Verdo Agile Development")
  - To fetch sprint items: call `mcp__azure-devops__ado_wit_my_work_items` (project: "Verdo Agile Development")
  - To create a PR: call `mcp__azure-devops__ado_repo_create_pull_request` (project: "Verdo Agile Development")
  - To link work item to PR: call `mcp__azure-devops__ado_wit_link_work_item_to_pull_request` (project: "Verdo Agile Development")
- **Local CLI contracts** (for git and file operations only):
  - `node ~/.claude/bin/devsprint-tools.cjs create-branch --repo <path> --story-id <id> --title <title>` — creates feature branch locally
  - `node ~/.claude/bin/devsprint-tools.cjs report-status ...` — reports progress to dashboard
  - `node ~/.claude/bin/devsprint-tools.cjs clear-status ...` — clears dashboard status
  - `node ~/.claude/bin/devsprint-screenshot.cjs ...` — takes browser screenshots
- The TDD workflow (RED → GREEN → REFACTOR)
- Instruction to verify the FULL test suite passes BEFORE writing any code (baseline check on base branch). If tests fail, skip the story.
- Instruction to run the FULL test suite (`dotnet test` / `npm test` / `pytest`) after all implementation — not just new tests. All tests must pass before resolving the story.
- Instruction to return a JSON summary: `{"storyId": N, "taskId": N|null, "executionScope": "story|task", "status": "completed|partial|skipped", "branch": "...", "prUrl": "...", "testsPassed": N, "testsFailed": N, "testCommand": "...", "testSuiteStatus": "all passed|failures|no test infrastructure", "uiVerified": true|false, "screenshotPath": ".planning/screenshots/{itemId}.png"|null, "error": "..."}`
- **Dashboard status reporting** — the agent MUST report its progress to the dashboard at each major step by running:
  `node ~/.claude/bin/devsprint-tools.cjs report-status --command execute --story-id {storyId} --story-title "{storyTitle}" --step "<step>" --detail "<detail>" --repo "{repoName}" --cwd $CWD`
  Report status at these points:
  - Step 4a: `--step "Checking story state" --detail "Fetching story state from Azure DevOps"`
  - Step 4b: `--step "Loading story spec" --detail "Reading {storyId}.md"`
  - Step 4b.1: `--step "Running baseline tests" --detail "{testCommand}" --command "{testCommand}"`
  - Step 4c: `--step "Creating feature branch" --detail "feature/{storyId}-..." --branch "feature/{storyId}-..."`
  - Step 4d: `--step "Writing tests" --detail "Adding test cases"`
  - Step 4d: `--step "Implementing" --detail "Writing implementation code"`
  - Step 4d (full suite): `--step "Running full test suite" --detail "{testCommand}" --command "{testCommand}"`
  - Step 4d.5: `--step "UI verification" --detail "Checking visual output for frontend changes"`
  - Step 4e: `--step "Creating PR" --detail "Pushing and creating pull request"`
  - Step 4f: `--step "Complete" --detail "Story #{storyId} finished — awaiting user approval"`

**Mode-specific agent instructions:**
- `all` mode or `headless`: Include instruction to NEVER use `AskUserQuestion` — fully autonomous. On blockers, make best judgment and continue. Critical errors are logged, not stopped on.
- `single` mode (not headless): Include instruction to make best judgment and continue on blockers, like `all` mode. Only use `AskUserQuestion` if the story spec explicitly marks something as "BLOKERER implementation". Stop on critical errors (missing spec, test baseline failures).

Do NOT run agents in background — run them sequentially so each story completes before the next starts. Parse the agent's returned summary, add to `executionResults`, and **immediately write to the execution log** (Step 4f) before launching the next agent. This ensures progress is persisted even if a later story crashes or the session is interrupted.

Steps 4a–4h below describe the work the agent performs:

Execute Steps 4a–4h below. In `all` mode or `--headless`: if any step encounters a non-fatal error, log it and continue to the next step. In `single` mode (not headless): stop on errors and consult the user via `AskUserQuestion`.

  **Step 4a — Check work item state:**

  Call `mcp__azure-devops__ado_wit_my_work_items` (project: "Verdo Agile Development") and find the relevant item.

  **If `executionScope = "task"`:**
  - Find the item matching `targetTaskId`. Check the **task's** state (not the parent story).
  - If the task state is "Resolved", "Closed", or "Done": log "Task #{targetTaskId} already resolved — skipping", record as "skipped — already resolved", continue to next.
  - If the parent story is Resolved but the task is New/Active: proceed normally. This is expected in the "post-merge fix" scenario.

  **If `executionScope = "story"`:**
  - Find the item matching `storyId`.
  - If the story state is "Resolved", "Closed", or "Done": log "Story #{storyId} already resolved — skipping", record as "skipped — already resolved", continue to next story.

  Otherwise: proceed with execution.

  **Step 4b — Load spec:**

  Determine which spec file to load:
  - If `executionScope = "task"`: read `{repoPath}/.planning/stories/{targetTaskId}.md`
  - If `executionScope = "story"`: read `{repoPath}/.planning/stories/{storyId}.md`

  1. Read the spec file using the Read tool.
     If missing:
     - `single` mode: tell user "No spec found. Run `/devsprint-plan {targetItemId}` to generate it." Stop.
     - `all` mode: log error, record as "skipped — no spec", continue to next story.

  2. Parse the spec — it contains goal, acceptance criteria, technical context (key files), and implementation notes. This is your single source of truth for the implementation. A task spec is focused on a single task; a story spec covers the full story.

  **Step 4b.1 — MANDATORY: Verify existing test suite passes BEFORE any code changes:**

  Before creating a branch or writing any code, run the full test suite on the current base branch to confirm a green baseline. This catches pre-existing failures that must be fixed before new work begins.

  1. Navigate to `{repoPath}`.
  2. Detect test commands:
     - If `*.sln` exists: run `dotnet test` from repo root.
     - If `package.json` exists with a `test` script: run `npm test` or `npx vitest run`.
     - If `pytest.ini` or `pyproject.toml` exists: run `pytest`.
     - Run ALL that apply (e.g., both `dotnet test` AND `npx vitest run` for a fullstack repo).
  3. If any tests fail:
     - `single` mode: tell user "Existing tests fail on {baseBranch}. Fix these before proceeding." List the failing tests. Stop.
     - `all` mode: log "Existing tests fail on {baseBranch} for story #{storyId} — skipping", record as "skipped — pre-existing test failures", continue to next story.
  4. If all tests pass: display "Baseline tests green — proceeding." and continue.

  **Step 4c — Create feature branch:**

  Determine the branch name based on scope:
  - If `executionScope = "task"`: use `--story-id {targetTaskId}` and the task title
  - If `executionScope = "story"`: use `--story-id {storyId}` and the story title

  Run: `node ~/.claude/bin/devsprint-tools.cjs create-branch --repo {repoPath} --story-id {itemId} --title "{itemTitle}"`

  - If exit 0: parse JSON. Store `branch` as `branchName` and `base` as `baseBranch`.
    - If `created === true`: "Created branch {branch} from {base}"
    - If `created === false`: "Checked out existing branch {branch}"
  - If exit 1:
    - `single` mode: show error and stop.
    - `all` mode: log error, record as "skipped — branch creation failed", continue to next story.

  **Step 4d — Execute the work (TDD approach):**

  This is the main implementation phase using **Test-Driven Development**. The story spec contains everything needed: goal, acceptance criteria, key files, implementation notes, and open questions. Do NOT re-analyze the codebase.

  1. **Navigate to the target repo**: Use `{repoPath}` as the working directory for all file operations.

  2. **Follow the story spec**: Use the acceptance criteria and implementation notes as your guide.

  3. **TDD cycle — for each piece of work:**

     **a. RED — Write failing tests first:**
     - Derive test cases from the acceptance criteria and implementation notes in the story spec.
     - Each acceptance criterion should map to at least one test.
     - Write tests in the project's existing test framework and conventions:
       - .NET: xUnit/NUnit in the existing Tests project (create test file if needed)
       - Node/TypeScript: vitest/jest following existing test patterns
       - Python: pytest following existing test patterns
     - If no test project exists: create one following the repo's conventions.
     - Read ONLY the specific files listed in "Key Files" or that you need to edit.
     - Run the tests — they MUST fail (confirms the test is valid). If a test passes before implementation, the test is not testing new behavior — revise it.
     - Commit the failing tests: `test: add tests for #{storyId} — {brief description}` (tests are committed separately so they exist as documentation even if implementation is incomplete).

     **b. GREEN — Implement just enough to pass:**
     - Implement the minimum code to make the failing tests pass.
     - Follow the implementation notes from the story spec.
     - Run all tests (new + existing) — all must pass.
     - If tests fail: fix the implementation, NOT the tests (unless the test had a genuine bug).

     **c. REFACTOR — Clean up if needed:**
     - Only refactor if the implementation is clearly messy. Keep it minimal.
     - Run tests again after refactoring to ensure nothing broke.
     - Commit implementation: `feat: implement {description} for #{storyId}`

     Repeat the RED→GREEN→REFACTOR cycle for each logical unit of work.

  4. **MANDATORY — Full test suite run:**

     After all TDD cycles are complete, you MUST run the **entire** project test suite — not just the tests you wrote. This catches regressions.

     - .NET: `dotnet test` (from solution root — runs ALL test projects)
     - Node/TypeScript: `npm test` or `npx vitest run` (runs ALL tests)
     - Python: `pytest` (runs ALL tests)
     - If the project has no test infrastructure: run the build command (`dotnet build`, `npm run build`, etc.) to verify compilation.

     **ALL tests must pass (new AND existing).** Do NOT proceed to Step 4e (story resolution) if any test fails. Fix failures first.

     Capture and store the test results for the summary:
     - `testsPassed`: total number of passing tests
     - `testsFailed`: total number of failing tests
     - `testCommand`: the command that was run (e.g., `dotnet test`)
     - `testSuiteStatus`: "all passed" | "failures" | "no test infrastructure"

  5. **Handle blockers**:
     - Both `single` and `all` mode: make your best judgment call and proceed. Log any assumptions.
     - Only use `AskUserQuestion` (in `single` mode without `--headless`) if the story spec explicitly marks something as "BLOKERER implementation" — this indicates the spec author determined it cannot be resolved without user input.
     - `all` mode or `--headless`: NEVER use `AskUserQuestion`. Make best judgment and continue. Log blockers as skipped.
     - If the story spec has "Open Questions & Blockers": skip items marked as blocking, implement what you can.

  6. **Commit changes**: Tests and implementation should already be committed from the TDD cycles above. If any uncommitted changes remain, commit them with descriptive messages referencing the story ID.

  IMPORTANT: Do NOT spend time exploring or understanding the codebase broadly. The `/devsprint-plan` command already did that analysis and wrote the story spec. Trust the spec. Only read files that you are about to modify.

  **Step 4d.5 — UI verification (if frontend changes detected):**

  After implementation is complete and all tests pass, check if any frontend/UI files were modified in this branch:

  1. Run `git diff --name-only {baseBranch}...HEAD` in `{repoPath}` and check for UI-related file changes:
     - `.html`, `.htm`, `.css`, `.scss`, `.less`
     - `.tsx`, `.jsx`, `.vue`, `.svelte`
     - `.razor`, `.cshtml`
     - Files in directories named `components/`, `views/`, `pages/`, `wwwroot/`, `public/`, `ClientApp/`

  2. If NO UI files changed: skip this step entirely.

  3. If UI files changed, attempt visual verification:

     **a. Detect and start the application:**
     - Check `package.json` for `start` or `dev` scripts → run `npm start` or `npm run dev` in the background
     - Check for `.csproj` with web SDK → run `dotnet run` in the background
     - Check for existing dev server URL in story spec or project config
     - If no dev server can be started: skip visual verification, log "UI changes detected but no dev server available for visual check"
     - Wait up to 10 seconds for the server to become available (check with `curl -s -o /dev/null -w "%{http_code}" http://localhost:<port>`)

     **b. Take screenshot:**
     Run: `node ~/.claude/bin/devsprint-screenshot.cjs --url http://localhost:<port>/<relevant-path> --output {repoPath}/.planning/screenshots/{storyId}.png --full-page`

     If the story spec mentions a specific page or route to verify, use that URL. Otherwise use the root URL.

     **c. Analyze the screenshot:**
     Use the Read tool to view the screenshot image. As a multimodal AI, you can see the rendered UI. Check for:
     - Layout issues: misaligned elements, overlapping content, broken grids
     - Missing content: blank areas where content should be, missing text or icons
     - Styling problems: wrong colors, broken borders, invisible text on same-color background
     - Responsive issues: content overflowing its container, cut off text
     - General visual quality: does it look polished and intentional?

     **d. Fix and re-verify:**
     If visual issues are found:
     - Fix the CSS/HTML/component code
     - Run tests again to ensure nothing broke
     - Take a new screenshot and verify the fix
     - Repeat up to 3 times maximum

     **e. Clean up:**
     - Stop any dev server you started (kill the background process)
     - Keep the final screenshot at `{repoPath}/.planning/screenshots/{storyId}.png` — it serves as visual documentation
     - Commit the screenshot: `docs: add UI verification screenshot for #{storyId}`

     Report status: `--step "UI verification" --detail "Checking visual output for frontend changes"`

  **Step 4e — Push and create PR:**

  Build a PR body string containing:
  ```
  ## Azure DevOps Story
  #{storyId} — {storyTitle}

  ## Changes
  {Brief summary of what was implemented, based on the story spec}

  {If UI screenshot exists at .planning/screenshots/{storyId}.png:}
  ## UI Verification
  Screenshot taken after implementation — visual check passed.

  ![UI Screenshot](.planning/screenshots/{storyId}.png)
  {end if}

  ## How to verify
  {Step-by-step instructions for manually verifying the changes work. Derive these from the story spec's acceptance criteria and the actual implementation. Be specific — include exact URLs, menu paths, test data, or commands to run. Example:}
  {1. Run the application / open the page at ...}
  {2. Navigate to ... / click ...}
  {3. Verify that ... shows/works as expected}
  {4. Edge case: try ... and confirm ...}
  {Include at least 3 concrete steps. If the change is backend-only (API, migration, CLI), describe how to invoke it and what output to expect. If it's a UI change, describe what to see on screen.}

  ## Test plan
  - [ ] Manual verification (see steps above)
  - [x] Automated tests passed ({testsPassed} tests)
  - [x] UI visually verified via screenshot
  - [ ] Code review
  ```

  **Note on screenshot in PR:** The screenshot is committed to the branch at `.planning/screenshots/{storyId}.png`. Azure DevOps renders images from the repo in PR descriptions using relative paths. If the image doesn't render inline, the reviewer can still find it in the branch's `.planning/screenshots/` folder.

  Determine PR title and linked work item:
  - If `executionScope = "task"`: title = `"#{targetTaskId} {taskTitle}"`, link to task ID
  - If `executionScope = "story"`: title = `"#{storyId} {storyTitle}"`, link to story ID

  **Push, create PR, and link work item (3 steps):**

  a. **Push the branch** via Bash in the target repo:
     ```bash
     cd {repoPath} && git push -u origin {branchName}
     ```
     - If push fails: warn user. The branch exists locally but was not pushed. Suggest pushing manually.

  b. **Create the PR** by calling `mcp__azure-devops__ado_repo_create_pull_request` with:
     - Project: "Verdo Agile Development"
     - Repository name (derived from repoPath — the last path segment, e.g., "NewSettlement.CustomerSupport")
     - Source branch: `{branchName}`
     - Target branch: `{baseBranch}`
     - Title: `{prTitle}`
     - Description: `{prBody}`
     - Store the returned PR ID as `prId` and construct the PR URL.

  c. **Link the work item to the PR** by calling `mcp__azure-devops__ado_wit_link_work_item_to_pull_request` with:
     - The work item ID (`targetTaskId` for task scope, `storyId` for story scope)
     - The PR ID from step b

  - If PR creation succeeds: store PR URL in results. Display "PR created: {prUrl}"
  - If PR creation fails:
    - `single` mode: warn user. The branch is already pushed — suggest creating PR manually in Azure DevOps.
    - `all` mode: log error. Record "PR not created" and move on.
  - If work item linking fails: warn but continue — the PR exists, linking can be done manually.

  Record story outcome: "completed" (with PR URL), "partial" (work remains), or "skipped" (with reason).

  **Step 4f — Write to execution log:**

  After each story completes (whether completed, partial, or skipped), immediately append the result to the execution log file at `$CWD/.planning/devsprint-execution-log.json`.

  1. Read the current execution log (or use the in-memory `executionLog` from Step 2.5).
  2. Find any existing entry to upsert:
     - If `executionScope = "task"`: match by `taskId` (a story can have multiple task-level entries).
     - If `executionScope = "story"`: match by `storyId` (and `taskId` is null).
  3. Write the updated log back to disk using the Write tool.

  Each entry contains:
  ```json
  {
    "storyId": 12345,
    "taskId": null,
    "executionScope": "story",
    "storyTitle": "As a user I want...",
    "taskTitle": null,
    "status": "completed|partial|skipped",
    "branch": "feature/12345-...",
    "baseBranch": "develop",
    "prUrl": "https://...",
    "prId": 123,
    "testsPassed": 42,
    "testsFailed": 0,
    "testCommand": "dotnet test",
    "testSuiteStatus": "all passed",
    "skipReason": null,
    "completedAt": "2025-01-15T12:00:00.000Z"
  }
  ```

  For task-scope execution, `taskId` and `taskTitle` are populated, and `executionScope` is `"task"`. This allows a story to have one story-level entry AND multiple task-level entries in the log (the "post-merge fix" scenario).

  This ensures that if execution is interrupted mid-way through the story list, the next run picks up where it left off. The log is written after EACH item, not just at the end.

**Step 5 — Summary:**

Display:
```
╔══════════════════════════════════════════╗
║           Execution Complete             ║
╚══════════════════════════════════════════╝

Sprint: {sprintName}
Stories processed: {total executed this run} | Previously completed: {from log} | Skipped: {blocked + not-actionable}

This run:
{for each story in executionResults:}
  {status icon} #{storyId} — {storyTitle}
     Branch: {branchName}
     Tests: {testsPassed} passed, {testsFailed} failed ({testCommand}) — {testSuiteStatus}
     PR: {prUrl | "not created — {reason}"}
{end for}

Previously completed (from execution log):
{for each story in executionLog where status === "completed" and NOT in this run:}
  ✓ #{storyId} — {storyTitle}
     Completed: {completedAt} | PR: {prUrl}
{end for}

{If multiple stories:}
Totals (this run):
  ✓ Completed: {count}
  ◐ Partial:   {count}
  ✗ Skipped:   {count}
{end if}

All pull requests (this run + previous):
  {list of PR URLs from executionResults + executionLog}

Execution log: .planning/devsprint-execution-log.json
```

**Clear agent dashboard status** after the summary is displayed:
Run `node ~/.claude/bin/devsprint-tools.cjs clear-status --story-id {storyId} --cwd $CWD` to mark this story as idle in the dashboard (without affecting other running stories).

```
Next steps:
  {If status is partial: "Run `/devsprint-execute {storyId}` to retry."}
  {If all completed: "Review and merge the PRs, then approve each story from the dashboard to close it."}
```

</process>

<error_handling>

**Common errors and responses:**

- `mcp__azure-devops__ado_wit_update_work_item` fails with "invalid state transition": The story may already be in the target state or in a state that doesn't allow the transition (e.g., Closed → Active). Warn but continue. Non-blocking.

- MCP tool returns 403 or authentication error: "Azure DevOps MCP authentication failed. Check that the Azure DevOps MCP server is configured and authenticated." Stop.

- Task map references a repo path that no longer exists:
  - `single` mode: warn the user and ask for the correct path.
  - `all` mode: skip the story, record as "skipped — repo not found at {path}".

- Spec is missing but task map exists: Tell user to run `/devsprint-plan {itemId}` to generate it.

- Git operations fail in target repo: Attempt `git stash`, retry. If still failing:
  - `single` mode: warn user with error details.
  - `all` mode: skip the story, record the error.

- `develop` branch does not exist on remote:
  - `single` mode: ask if user wants to target a different base branch.
  - `all` mode: try `main` as fallback.

- PR creation fails: Branch is already pushed. Suggest creating the PR manually in Azure DevOps.

**In `all` mode only:** Never stop the loop for per-story errors. Only STOP the entire execution for:
- Missing or empty task map (nothing to execute)
- MCP authentication failure (no API access at all)

</error_handling>

<success_criteria>
- `/devsprint-execute 42920` runs a single story interactively
- `/devsprint-execute` runs all stories autonomously without user prompts
- Pre-flight status check shows ALL stories with clear status BEFORE execution starts
- Already-executed stories (from execution log) are skipped automatically
- Already-resolved stories (from Azure DevOps) are skipped automatically
- Execution log (`devsprint-execution-log.json`) is written after EACH story — survives interruptions
- Re-running `/devsprint-execute` only processes stories not yet completed
- Each story gets its own feature branch from develop
- Stories are NOT auto-resolved — user must verify the PR and click "Approve" on the dashboard to close
- Each story gets a PR linked to the Azure DevOps story
- In `all` mode: errors on one story do not block the next
- In `single` mode: user is consulted on blockers
- Existing test suite is verified green BEFORE any code changes (Step 4b.1)
- Full test suite (`dotnet test` / `npm test`) runs after implementation — not just new tests
- Test results (passed/failed counts) are included in the summary output
- PR is NOT created if the full test suite has failures
- Clear summary with PR links and test results at the end
- UI changes trigger automatic visual verification via screenshot
- Screenshots are saved as documentation in `.planning/screenshots/`
- Visual issues are self-corrected (up to 3 attempts) before proceeding
</success_criteria>
