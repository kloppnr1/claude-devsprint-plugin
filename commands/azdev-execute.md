---
name: azdev-execute
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
- With story ID (`/azdev-execute 42920`): single-story mode — interactive, can ask user questions on blockers.
- Without arguments (`/azdev-execute`): all-stories mode — autonomous loop, never asks questions, skips blockers and moves to next story.
</objective>

<execution_context>
Helper: ~/.claude/bin/azdev-tools.cjs
Config file: .planning/azdev-config.json
Task map: .planning/azdev-task-map.json
$CWD is the project directory where .planning/ lives.
</execution_context>

<context>
azdev-tools.cjs CLI contracts used by this command:

  node ~/.claude/bin/azdev-tools.cjs load-config --cwd $CWD
    -> stdout: JSON {"org":"...","project":"...","pat":"<raw-decoded>"}
    -> exit 0 on success, exit 1 if no config

  node ~/.claude/bin/azdev-tools.cjs update-state --id <workItemId> --state <state> --cwd $CWD
    -> stdout: JSON {"status":"updated","id":N,"state":"<newState>"}
    -> Valid states: "New", "Active", "Resolved", "Closed"
    -> exit 0 on success, exit 1 on error (invalid transition, 403, etc.)

  node ~/.claude/bin/azdev-tools.cjs get-child-states --id <storyId> --cwd $CWD
    -> stdout: JSON {"allResolved": bool, "children": [{"id":N,"title":"...","state":"..."}]}
    -> allResolved is true when every child is Resolved, Closed, or Done
    -> exit 0 on success, exit 1 on error

  node ~/.claude/bin/azdev-tools.cjs create-branch --repo <path> --story-id <id> --title <title> [--base <branch>]
    -> Stashes dirty changes, fetches base branch (develop, fallback main), creates feature/<id>-<slug>
    -> stdout: JSON {"branch":"...","base":"...","created":true|false}
    -> exit 0 on success, exit 1 on error

  node ~/.claude/bin/azdev-tools.cjs create-pr --repo <path> --branch <name> --base <branch> --title <title> --body <body> --story-id <id> --cwd $CWD
    -> Pushes branch to origin, creates PR via Azure DevOps REST API, links to story
    -> stdout: JSON {"pr":"<url>","prId":N,"branch":"...","base":"...","pushed":true,"linked":true|false}
    -> exit 0 on success, exit 1 on error

azdev-task-map.json structure (written by /azdev-plan):
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

Check if the user passed a story ID as argument (e.g., `/azdev-execute 42920` or `/azdev-execute #42920`).

- If a numeric ID is provided: `mode = "single"`, `targetStoryId = <the ID>`.
- If no argument: `mode = "all"`.

**Behavioral rules by mode:**
- `single` mode: interactive. Use `AskUserQuestion` when encountering blockers or ambiguity during implementation. Stop on errors.
- `all` mode: fully autonomous. Do NOT use `AskUserQuestion` at any point. If you encounter a blocker on one story, log the error and move on to the next story. The user expects to walk away and come back to completed work.

**Step 2 — Check prerequisites:**

1. Verify `~/.claude/bin/azdev-tools.cjs` exists via Bash `test -f`.
   If missing: tell user "Azure DevOps tools not installed. Check that ~/.claude/bin/azdev-tools.cjs exists." Stop.

2. Run `node ~/.claude/bin/azdev-tools.cjs load-config --cwd $CWD`.
   If exit 1: tell user "No Azure DevOps config found. Run `/azdev-setup` to configure your connection." Stop.

3. Check that `$CWD/.planning/azdev-task-map.json` exists via Bash `test -f`.
   If missing: tell user "No task map found. Run `/azdev-plan` first to analyze your sprint stories." Stop.

4. Read `$CWD/.planning/azdev-task-map.json` using the Read tool. Parse the JSON.
   If the `mappings` array is empty: tell user "Task map has no story mappings. Run `/azdev-plan` and approve at least one story." Stop.

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

For each mapping in `storiesToExecute` (index `i`, starting at 1):

Display:
```
━━━ [{i}/{total}] Story #{storyId} — {storyTitle} ━━━
```

Execute Steps 4a–4h below. In `all` mode: if any step encounters a non-fatal error, log it and continue to the next step or next story. In `single` mode: stop on errors and consult the user.

  **Step 4a — Check story state:**

  Run `node ~/.claude/bin/azdev-tools.cjs get-child-states --id {storyId} --cwd $CWD` to check current state.

  Also fetch the story's own state from the sprint items:
  Run `node ~/.claude/bin/azdev-tools.cjs get-sprint-items --me --cwd $CWD` and find the item matching `storyId`.

  - If the story state is "Resolved", "Closed", or "Done": log "Story #{storyId} already resolved — skipping", record as "skipped — already resolved", continue to next story.
  - If `allResolved === true`: log "All tasks for #{storyId} already resolved — skipping", record as "skipped — all tasks resolved", continue to next story.
  - If some tasks are already resolved: note which ones. Only activate and work on the remaining tasks in subsequent steps. Display: "Skipping {N} already resolved tasks. Working on {M} remaining."

  **Step 4b — Load story spec:**

  1. Read `{repoPath}/.planning/stories/{storyId}.md` using the Read tool.
     If missing:
     - `single` mode: tell user "No story spec found. Run `/azdev-plan {storyId}` to generate it." Stop.
     - `all` mode: log error, record as "skipped — no story spec", continue to next story.

  2. Parse the story spec — it contains goal, acceptance criteria, technical context (key files, architecture), implementation notes, open questions, and tasks. This is your single source of truth for the implementation.

  **Step 4c — Create feature branch:**

  Run: `node ~/.claude/bin/azdev-tools.cjs create-branch --repo {repoPath} --story-id {storyId} --title "{storyTitle}"`

  - If exit 0: parse JSON. Store `branch` as `branchName` and `base` as `baseBranch`.
    - If `created === true`: "Created branch {branch} from {base}"
    - If `created === false`: "Checked out existing branch {branch}"
  - If exit 1:
    - `single` mode: show error and stop.
    - `all` mode: log error, record as "skipped — branch creation failed", continue to next story.

  **Step 4d — Activate tasks in Azure DevOps:**

  Track which task IDs are successfully activated in a list called `activatedTaskIds`.

  For each task ID in `taskIds` (skip already-resolved tasks from Step 4a):
  1. Run `node ~/.claude/bin/azdev-tools.cjs update-state --id {taskId} --state "Active" --cwd $CWD`
  2. If exit 0: add to `activatedTaskIds`.
  3. If exit 1: warn but continue. The task may already be Active or in a non-transitionable state. Do NOT add to `activatedTaskIds`.

  Display:
  ```
  Task status updates:
    #{taskId} ({taskTitle}): Active ✓
    #{taskId} ({taskTitle}): already Active (skipped)
  ```

  **Step 4e — Execute the work:**

  This is the main implementation phase. The story spec contains everything needed: goal, acceptance criteria, key files, implementation notes, and open questions. Do NOT re-analyze the codebase.

  1. **Navigate to the target repo**: Use `{repoPath}` as the working directory for all file operations.

  2. **Follow the story spec**: Use the acceptance criteria and implementation notes as your guide.

  3. **For each piece of work**:
     - Read ONLY the specific files listed in the "Key Files" section or that you need to edit.
     - Implement the changes described in the implementation notes using Edit/Write tools.

  **MANDATORY: Run all tests after implementation.** Detect the project type and run the appropriate test command:
     - .NET: `dotnet test` (from solution root)
     - Node/TypeScript: `npm test` or `npx vitest run` (check package.json scripts)
     - Python: `pytest`
     - If tests fail: fix the code and re-run until all tests pass. Do NOT proceed to task resolution with failing tests.
     - If the project has no test infrastructure, run the build command (`dotnet build`, `npm run build`, etc.) to verify compilation.

  4. **Match tasks to work**: As you complete work that corresponds to a specific Azure DevOps task (from `taskTitles`), note which tasks have been completed.

  5. **Handle blockers**:
     - `single` mode: use `AskUserQuestion` to consult the user. Do not guess at requirements.
     - `all` mode: make your best judgment call and proceed. Log any assumptions. Do NOT ask the user.
     - If the story spec has "Open Questions & Blockers": skip blocked items, implement what you can.

  6. **Commit changes**: After meaningful chunks of work, commit changes via git. Use descriptive commit messages referencing the story ID (e.g., "feat: implement API endpoint for #{storyId}"). Do NOT ask — just commit directly on the feature branch.

  IMPORTANT: Do NOT spend time exploring or understanding the codebase broadly. The `/azdev-plan` command already did that analysis and wrote the story spec. Trust the spec. Only read files that you are about to modify.

  **Step 4f — Auto-resolve activated tasks:**

  For each task ID in `activatedTaskIds`:
  1. Run `node ~/.claude/bin/azdev-tools.cjs update-state --id {taskId} --state "Resolved" --cwd $CWD`
  2. Log result.

  Display:
  ```
  Task resolution:
    #{taskId} ({taskTitle}): Resolved ✓
    #{taskId} ({taskTitle}): Resolved ✓
  ```

  **Step 4g — Auto-resolve story if all tasks done:**

  Run `node ~/.claude/bin/azdev-tools.cjs get-child-states --id {storyId} --cwd $CWD`
  - If `allResolved === true`:
    Run `node ~/.claude/bin/azdev-tools.cjs update-state --id {storyId} --state "Resolved" --cwd $CWD`
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

  Run: `node ~/.claude/bin/azdev-tools.cjs create-pr --repo {repoPath} --branch {branchName} --base {baseBranch} --title "#{storyId} {storyTitle}" --body "{prBody}" --story-id {storyId} --cwd $CWD`

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
  {If tasks remain: "Run `/azdev-execute {storyId}` to continue on remaining tasks."}
  {If all resolved: "Review and merge the PRs, then run `/azdev-sprint` to see updated sprint status."}
```

</process>

<error_handling>

**Common errors and responses:**

- `update-state` returns exit 1 with "invalid state transition": The task may already be in the target state or in a state that doesn't allow the transition (e.g., Closed → Active). Warn but continue. Non-blocking.

- `update-state` returns 403: "Insufficient permissions. Your PAT may not have `vso.work_write` scope. Regenerate your PAT with `vso.work_write` and run `/azdev-setup`."

- Task map references a repo path that no longer exists:
  - `single` mode: warn the user and ask for the correct path.
  - `all` mode: skip the story, record as "skipped — repo not found at {path}".

- Story spec is missing but task map exists: Tell user to run `/azdev-plan {storyId}` to regenerate.

- Git operations fail in target repo: Attempt `git stash`, retry. If still failing:
  - `single` mode: warn user with error details.
  - `all` mode: skip the story, record the error.

- `develop` branch does not exist on remote:
  - `single` mode: ask if user wants to target a different base branch.
  - `all` mode: try `main` as fallback.

- PR creation fails: Branch is already pushed. Suggest creating the PR manually in Azure DevOps.

**In `all` mode only:** Never stop the loop for per-story errors. Only STOP the entire execution for:
- Missing azdev-tools.cjs (nothing can work without it)
- Missing config (no API access)
- Missing or empty task map (nothing to execute)

</error_handling>

<success_criteria>
- `/azdev-execute 42920` runs a single story interactively
- `/azdev-execute` runs all stories autonomously without user prompts
- Already-resolved stories and tasks are skipped automatically
- Each story gets its own feature branch from develop
- Tasks are activated before work and resolved after — automatically
- Stories are resolved when all children are resolved — automatically
- Each story gets a PR linked to the Azure DevOps story
- In `all` mode: errors on one story do not block the next
- In `single` mode: user is consulted on blockers
- Clear summary with PR links at the end
</success_criteria>
