---
name: devsprint-execute
description: Execute story plans and update Azure DevOps task status automatically
argument-hint: "[story-id]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
  - Agent
---

<objective>
Execute one or all stories from the task map. For each story: create a feature branch, activate tasks in Azure DevOps, implement the work from the story spec, auto-resolve tasks and story, push, and create a PR.

**Mode depends on arguments:**
- With story ID (`/devsprint-execute 42920`): single-story mode — interactive, can ask user questions on blockers.
- Without arguments (`/devsprint-execute`): all-stories mode — autonomous loop, never asks questions, skips blockers and moves to next story.
</objective>

<execution_context>
Helper: ~/.claude/bin/devsprint-tools.cjs
Config file: .planning/devsprint-config.json
Task map: .planning/devsprint-task-map.json
$CWD is the project directory where .planning/ lives.
</execution_context>

<context>
devsprint-tools.cjs CLI contracts used by this command:

  node ~/.claude/bin/devsprint-tools.cjs load-config --cwd $CWD
    -> stdout: JSON {"org":"...","project":"...","pat":"<raw-decoded>"}
    -> exit 0 on success, exit 1 if no config

  node ~/.claude/bin/devsprint-tools.cjs update-state --id <workItemId> --state <state> --cwd $CWD
    -> stdout: JSON {"status":"updated","id":N,"state":"<newState>"}
    -> Valid states: "New", "Active", "Resolved", "Closed"
    -> exit 0 on success, exit 1 on error (invalid transition, 403, etc.)

  node ~/.claude/bin/devsprint-tools.cjs get-child-states --id <storyId> --cwd $CWD
    -> stdout: JSON {"allResolved": bool, "children": [{"id":N,"title":"...","state":"..."}]}
    -> allResolved is true when every child is Resolved, Closed, or Done
    -> exit 0 on success, exit 1 on error

  node ~/.claude/bin/devsprint-tools.cjs create-branch --repo <path> --story-id <id> --title <title> [--base <branch>]
    -> Stashes dirty changes, fetches base branch (develop, fallback main), creates feature/<id>-<slug>
    -> stdout: JSON {"branch":"...","base":"...","created":true|false}
    -> exit 0 on success, exit 1 on error

  node ~/.claude/bin/devsprint-tools.cjs create-pr --repo <path> --branch <name> --base <branch> --title <title> --body <body> --story-id <id> --cwd $CWD
    -> Pushes branch to origin, creates PR via Azure DevOps REST API, links to story
    -> stdout: JSON {"pr":"<url>","prId":N,"branch":"...","base":"...","pushed":true,"linked":true|false}
    -> exit 0 on success, exit 1 on error

devsprint-task-map.json structure (written by /devsprint-plan):
  {
    "version": 1,
    "sprintName": "Sprint 5",
    "generatedAt": "2025-01-15T10:00:00.000Z",
    "mappings": [
      {
        "storyId": 12345,
        "storyTitle": "As a user I want...",
        "repoPath": "/home/user/repos/MyApp",
        "taskIds": [12346, 12347, 12348],
        "taskTitles": { "12346": "Create API endpoint", "12347": "Add frontend form", "12348": "Write tests" }
      }
    ]
  }
</context>

<process>

**Step 1 — Parse arguments and determine mode:**

Check if the user passed a story ID as argument (e.g., `/devsprint-execute 42920` or `/devsprint-execute #42920`).

- If a numeric ID is provided: `mode = "single"`, `targetStoryId = <the ID>`.
- If no argument: `mode = "all"`.

**Behavioral rules by mode:**
- `single` mode: interactive. Use `AskUserQuestion` when encountering blockers or ambiguity during implementation. Stop on errors.
- `all` mode: fully autonomous. Do NOT use `AskUserQuestion` at any point. If you encounter a blocker on one story, log the error and move on to the next story. The user expects to walk away and come back to completed work.

**Step 2 — Check prerequisites:**

1. Verify `~/.claude/bin/devsprint-tools.cjs` exists via Bash `test -f`.
   If missing: tell user "Azure DevOps tools not installed. Check that ~/.claude/bin/devsprint-tools.cjs exists." Stop.

2. Run `node ~/.claude/bin/devsprint-tools.cjs load-config --cwd $CWD`.
   If exit 1: tell user "No Azure DevOps config found. Run `/devsprint-setup` to configure your connection." Stop.

3. Check that `$CWD/.planning/devsprint-task-map.json` exists via Bash `test -f`.
   If missing: tell user "No task map found. Run `/devsprint-plan` first to analyze your sprint stories." Stop.

4. Read `$CWD/.planning/devsprint-task-map.json` using the Read tool. Parse the JSON.
   If the `mappings` array is empty: tell user "Task map has no story mappings. Run `/devsprint-plan` and approve at least one story." Stop.

**Step 3 — Select stories to execute:**

If `mode === "single"`:
- Find the mapping where `storyId` matches `targetStoryId`. If not found: "Story #{targetStoryId} is not in the task map. Available stories: {list}." Stop.
- Store as a single-item list: `storiesToExecute = [matching mapping]`.

If `mode === "all"`:
- Use all mappings: `storiesToExecute = mappings`.

Display:
```
=== Execution: {sprintName} ===
Mode: {single ? "Single story" : "All stories (autonomous)"}
Stories: {storiesToExecute.length}
  {for each: "#{storyId} — {storyTitle} ({repoPath})"}

{mode === "all" ? "Starting autonomous execution..." : ""}
```

Initialize an empty `executionResults` list to collect per-story outcomes.

**Step 4 — Execute each story:**

**CRITICAL — Context isolation in `all` mode:**
In `all` mode, each story MUST be executed inside its own Agent (subagent_type: `general-purpose`) to prevent context window exhaustion. The orchestrator stays lightweight — it only launches agents and collects results.

For each mapping in `storiesToExecute` (index `i`, starting at 1):

Display:
```
━━━ [{i}/{total}] Story #{storyId} — {storyTitle} ━━━
```

**If `mode === "all"`:**
Launch an Agent with the full execution instructions for this single story (Steps 4a–4h). The agent prompt must include:
- The story mapping (storyId, storyTitle, repoPath, taskIds, taskTitles)
- The path to the story spec: `{repoPath}/.planning/stories/{storyId}.md`
- The path to the config: `$CWD/.planning/devsprint-config.json`
- All devsprint-tools.cjs CLI contracts needed (update-state, get-child-states, create-branch, create-pr)
- The TDD workflow (RED → GREEN → REFACTOR)
- Instruction to NEVER use AskUserQuestion (autonomous mode)
- Instruction to run the FULL test suite (`dotnet test` / `npm test` / `pytest`) after all implementation — not just new tests. All tests must pass before resolving tasks.
- Instruction to return a JSON summary: `{"storyId": N, "status": "completed|partial|skipped", "branch": "...", "prUrl": "...", "tasksResolved": [...], "tasksRemaining": [...], "testsPassed": N, "testsFailed": N, "testCommand": "...", "testSuiteStatus": "all passed|failures|no test infrastructure", "error": "..."}`

Do NOT run agents in background — run them sequentially so each story completes before the next starts. Parse the agent's returned summary and add to `executionResults`.

**If `mode === "single"`:**
Execute Steps 4a–4h directly in the main conversation (no agent needed — interactive mode benefits from direct user communication).

Steps 4a–4h below describe the work the agent (or main conversation in single mode) performs:

Execute Steps 4a–4h below. In `all` mode (inside agent): if any step encounters a non-fatal error, log it and continue to the next step. In `single` mode: stop on errors and consult the user.

  **Step 4a — Check story state:**

  Run `node ~/.claude/bin/devsprint-tools.cjs get-child-states --id {storyId} --cwd $CWD` to check current state.

  Also fetch the story's own state from the sprint items:
  Run `node ~/.claude/bin/devsprint-tools.cjs get-sprint-items --me --cwd $CWD` and find the item matching `storyId`.

  - If the story state is "Resolved", "Closed", or "Done": log "Story #{storyId} already resolved — skipping", record as "skipped — already resolved", continue to next story.
  - If `allResolved === true`: log "All tasks for #{storyId} already resolved — skipping", record as "skipped — all tasks resolved", continue to next story.
  - If some tasks are already resolved: note which ones. Only activate and work on the remaining tasks in subsequent steps. Display: "Skipping {N} already resolved tasks. Working on {M} remaining."

  **Step 4b — Load story spec:**

  1. Read `{repoPath}/.planning/stories/{storyId}.md` using the Read tool.
     If missing:
     - `single` mode: tell user "No story spec found. Run `/devsprint-plan {storyId}` to generate it." Stop.
     - `all` mode: log error, record as "skipped — no story spec", continue to next story.

  2. Parse the story spec — it contains goal, acceptance criteria, technical context (key files, architecture), implementation notes, open questions, and tasks. This is your single source of truth for the implementation.

  **Step 4c — Create feature branch:**

  Run: `node ~/.claude/bin/devsprint-tools.cjs create-branch --repo {repoPath} --story-id {storyId} --title "{storyTitle}"`

  - If exit 0: parse JSON. Store `branch` as `branchName` and `base` as `baseBranch`.
    - If `created === true`: "Created branch {branch} from {base}"
    - If `created === false`: "Checked out existing branch {branch}"
  - If exit 1:
    - `single` mode: show error and stop.
    - `all` mode: log error, record as "skipped — branch creation failed", continue to next story.

  **Step 4d — Activate tasks in Azure DevOps:**

  Track which task IDs are successfully activated in a list called `activatedTaskIds`.

  For each task ID in `taskIds` (skip already-resolved tasks from Step 4a):
  1. Run `node ~/.claude/bin/devsprint-tools.cjs update-state --id {taskId} --state "Active" --cwd $CWD`
  2. If exit 0: add to `activatedTaskIds`.
  3. If exit 1: warn but continue. The task may already be Active or in a non-transitionable state. Do NOT add to `activatedTaskIds`.

  Display:
  ```
  Task status updates:
    #{taskId} ({taskTitle}): Active ✓
    #{taskId} ({taskTitle}): already Active (skipped)
  ```

  **Step 4e — Execute the work (TDD approach):**

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

     Repeat the RED→GREEN→REFACTOR cycle for each task or logical unit of work.

  4. **MANDATORY — Full test suite run:**

     After all TDD cycles are complete, you MUST run the **entire** project test suite — not just the tests you wrote. This catches regressions.

     - .NET: `dotnet test` (from solution root — runs ALL test projects)
     - Node/TypeScript: `npm test` or `npx vitest run` (runs ALL tests)
     - Python: `pytest` (runs ALL tests)
     - If the project has no test infrastructure: run the build command (`dotnet build`, `npm run build`, etc.) to verify compilation.

     **ALL tests must pass (new AND existing).** Do NOT proceed to Step 4f (task resolution) if any test fails. Fix failures first.

     Capture and store the test results for the summary:
     - `testsPassed`: total number of passing tests
     - `testsFailed`: total number of failing tests
     - `testCommand`: the command that was run (e.g., `dotnet test`)
     - `testSuiteStatus`: "all passed" | "failures" | "no test infrastructure"

  5. **Match tasks to work**: As you complete work that corresponds to a specific Azure DevOps task (from `taskTitles`), note which tasks have been completed.

  6. **Handle blockers**:
     - `single` mode: use `AskUserQuestion` to consult the user. Do not guess at requirements.
     - `all` mode: make your best judgment call and proceed. Log any assumptions. Do NOT ask the user.
     - If the story spec has "Open Questions & Blockers": skip blocked items, implement what you can.

  7. **Commit changes**: Tests and implementation should already be committed from the TDD cycles above. If any uncommitted changes remain, commit them with descriptive messages referencing the story ID.

  IMPORTANT: Do NOT spend time exploring or understanding the codebase broadly. The `/devsprint-plan` command already did that analysis and wrote the story spec. Trust the spec. Only read files that you are about to modify.

  **Step 4f — Auto-resolve activated tasks:**

  For each task ID in `activatedTaskIds`:
  1. Run `node ~/.claude/bin/devsprint-tools.cjs update-state --id {taskId} --state "Resolved" --cwd $CWD`
  2. Log result.

  Display:
  ```
  Task resolution:
    #{taskId} ({taskTitle}): Resolved ✓
    #{taskId} ({taskTitle}): Resolved ✓
  ```

  **Step 4g — Auto-resolve story if all tasks done:**

  Run `node ~/.claude/bin/devsprint-tools.cjs get-child-states --id {storyId} --cwd $CWD`
  - If `allResolved === true`:
    Run `node ~/.claude/bin/devsprint-tools.cjs update-state --id {storyId} --state "Resolved" --cwd $CWD`
    Display: "Story #{storyId} resolved ✓"
  - If `allResolved === false`:
    Display remaining open tasks:
    ```
    Story #{storyId} still has open tasks:
      #{childId} -- {childTitle} ({childState})
    ```

  **Step 4h — Push and create PR:**

  Build a PR body string containing:
  ```
  ## Azure DevOps Story
  #{storyId} — {storyTitle}

  ## Changes
  {Brief summary of what was implemented, based on the story spec}

  ## Tasks resolved
  - #{taskId} — {taskTitle}
  - #{taskId} — {taskTitle}

  ## Test plan
  - [ ] Verify acceptance criteria from story
  - [ ] Run automated tests
  - [ ] Code review
  ```

  Run: `node ~/.claude/bin/devsprint-tools.cjs create-pr --repo {repoPath} --branch {branchName} --base {baseBranch} --title "#{storyId} {storyTitle}" --body "{prBody}" --story-id {storyId} --cwd $CWD`

  - If exit 0: parse JSON. Store `pr` URL in results. PR is automatically linked to the story.
  - If exit 1:
    - `single` mode: warn user. The branch is already pushed — suggest creating PR manually in Azure DevOps.
    - `all` mode: log error. Record "PR not created" and move on.

  Record story outcome: "completed" (with PR URL), "partial" (some tasks remain), or "skipped" (with reason).

**Step 5 — Summary:**

Display:
```
╔══════════════════════════════════════════╗
║           Execution Complete             ║
╚══════════════════════════════════════════╝

Sprint: {sprintName}
Stories processed: {total}

{for each story in executionResults:}
  {status icon} #{storyId} — {storyTitle}
     Branch: {branchName}
     Tasks: {resolvedCount}/{totalCount} resolved
     Tests: {testsPassed} passed, {testsFailed} failed ({testCommand}) — {testSuiteStatus}
     Story: {Resolved ✓ | Active (X tasks remaining)}
     PR: {prUrl | "not created — {reason}"}
{end for}

{If multiple stories:}
Summary:
  ✓ Completed: {count}
  ◐ Partial:   {count}
  ✗ Skipped:   {count}
{end if}

Pull requests:
  {list of PR URLs}

Next steps:
  {If tasks remain: "Run `/devsprint-execute {storyId}` to continue on remaining tasks."}
  {If all resolved: "Review and merge the PRs, then run `/devsprint-sprint` to see updated sprint status."}
```

</process>

<error_handling>

**Common errors and responses:**

- `update-state` returns exit 1 with "invalid state transition": The task may already be in the target state or in a state that doesn't allow the transition (e.g., Closed → Active). Warn but continue. Non-blocking.

- `update-state` returns 403: "Insufficient permissions. Your PAT may not have `vso.work_write` scope. Regenerate your PAT with `vso.work_write` and run `/devsprint-setup`."

- Task map references a repo path that no longer exists:
  - `single` mode: warn the user and ask for the correct path.
  - `all` mode: skip the story, record as "skipped — repo not found at {path}".

- Story spec is missing but task map exists: Tell user to run `/devsprint-plan {storyId}` to regenerate.

- Git operations fail in target repo: Attempt `git stash`, retry. If still failing:
  - `single` mode: warn user with error details.
  - `all` mode: skip the story, record the error.

- `develop` branch does not exist on remote:
  - `single` mode: ask if user wants to target a different base branch.
  - `all` mode: try `main` as fallback.

- PR creation fails: Branch is already pushed. Suggest creating the PR manually in Azure DevOps.

**In `all` mode only:** Never stop the loop for per-story errors. Only STOP the entire execution for:
- Missing devsprint-tools.cjs (nothing can work without it)
- Missing config (no API access)
- Missing or empty task map (nothing to execute)

</error_handling>

<success_criteria>
- `/devsprint-execute 42920` runs a single story interactively
- `/devsprint-execute` runs all stories autonomously without user prompts
- Already-resolved stories and tasks are skipped automatically
- Each story gets its own feature branch from develop
- Tasks are activated before work and resolved after — automatically
- Stories are resolved when all children are resolved — automatically
- Each story gets a PR linked to the Azure DevOps story
- In `all` mode: errors on one story do not block the next
- In `single` mode: user is consulted on blockers
- Full test suite (`dotnet test` / `npm test`) runs after implementation — not just new tests
- Test results (passed/failed counts) are included in the summary output
- Tasks are NOT resolved if the full test suite has failures
- Clear summary with PR links and test results at the end
</success_criteria>
