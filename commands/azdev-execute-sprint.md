---
name: azdev-execute-sprint
description: Execute all stories in the sprint backlog without interruption
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Agent
---

<objective>
Execute ALL stories in the task map sequentially, without user interaction. For each story: create a feature branch from develop, activate tasks, implement the project plan, auto-resolve tasks and story, push, and create a PR to develop. Move on to the next story automatically. Stop only on fatal errors (missing config, no task map).
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

<important>
This command runs FULLY AUTONOMOUSLY. Do NOT use AskUserQuestion at any point. If you encounter a blocker on one story, log the error and move on to the next story. The user expects to walk away and come back to a completed sprint.
</important>

<process>

**Step 1 — Check prerequisites:**

1. Verify `~/.claude/bin/azdev-tools.cjs` exists via Bash `test -f`.
   If missing: tell user "Azure DevOps tools not installed. Check that ~/.claude/bin/azdev-tools.cjs exists." STOP completely.

2. Run `node ~/.claude/bin/azdev-tools.cjs load-config --cwd $CWD`.
   If exit 1: tell user "No Azure DevOps config found. Run `/azdev-setup` to configure your connection." STOP completely.

3. Check that `$CWD/.planning/azdev-task-map.json` exists via Bash `test -f`.
   If missing: tell user "No task map found. Run `/azdev-plan` first." STOP completely.

4. Read `$CWD/.planning/azdev-task-map.json` using the Read tool. Parse the JSON.
   If the `mappings` array is empty: tell user "Task map has no story mappings. Run `/azdev-plan` and approve at least one repo." STOP completely.

Store the full `mappings` array. Initialize an empty `sprintResults` list to collect per-story outcomes.

Display:
```
=== Sprint Execution: {sprintName} ===
Stories to execute: {mappings.length}
  {for each mapping: "#{storyId} — {storyTitle} ({repoPath})"}

Starting autonomous execution...
```

**Step 2 — Loop through all stories:**

For each mapping in `mappings` (index `i`, starting at 1):

Display:
```
━━━ [{i}/{total}] Story #{storyId} — {storyTitle} ━━━
```

Execute Steps 2a–2g below. If any step encounters a non-fatal error, log it and continue to the next step or next story. Collect the outcome in `sprintResults`.

  **Step 2a — Check story state:**

  Run `node ~/.claude/bin/azdev-tools.cjs check-children --id {storyId} --cwd $CWD` and fetch the story's state from sprint items.

  - If the story state is "Resolved", "Closed", or "Done": log "Story #{storyId} already resolved — skipping", record as "skipped — already resolved", continue to next story.
  - If `allResolved === true`: log "All tasks for #{storyId} already resolved — skipping", record as "skipped — all tasks resolved", continue to next story.
  - If some tasks are already resolved: note which ones. Only activate and work on the remaining tasks in subsequent steps.

  **Step 2b — Load story spec:**

  1. Read `{repoPath}/.planning/stories/{storyId}.md`.
     If missing: log error "No story spec at {repoPath}/.planning/stories/{storyId}.md", record story as "skipped — no story spec", continue to next story.

  **Step 2c — Create feature branch:**

  Run: `node ~/.claude/bin/azdev-tools.cjs create-branch --repo {repoPath} --story-id {storyId} --title "{storyTitle}"`

  - If exit 0: parse JSON. Store `branch` as `branchName` and `base` as `baseBranch`.
  - If exit 1: log error, record story as "skipped — branch creation failed", continue to next story.

  **Step 2d — Activate tasks:**

  Track `activatedTaskIds` for this story.

  For each task ID in `taskIds`:
  1. Run `node ~/.claude/bin/azdev-tools.cjs update-state --id {taskId} --state "Active" --cwd $CWD`
  2. If exit 0: add to `activatedTaskIds`.
  3. If exit 1: log warning, continue.

  Brief status display.

  **Step 2e — Execute the work:**

  This is the main implementation phase. The story spec (`stories/{storyId}.md`) contains everything needed: goal, acceptance criteria, key files, implementation notes, and open questions. Do NOT re-analyze the codebase.

  1. Use `{repoPath}` as working directory for all file operations.
  2. Follow the implementation notes and acceptance criteria from the story spec.
  3. Read ONLY the specific files mentioned in the "Key Files" section or that you need to edit.
  4. Implement changes using Edit/Write tools.
  5. Run tests/build if available (check package.json scripts, Makefile, etc.).
  6. Match completed work to Azure DevOps tasks from `taskTitles`.
  7. If the story spec has "Open Questions & Blockers": skip blocked items, implement what you can.
  8. On other blockers: make your best judgment call and proceed. Log any assumptions made. Do NOT ask the user.
  9. Commit after meaningful chunks. Use descriptive messages: "feat: {description} (#{storyId})".

  IMPORTANT: Do NOT spend time exploring or understanding the codebase broadly. The `/azdev-plan` command already did that and wrote the story spec. Trust the spec. Only read files you are about to modify.

  **Step 2f — Auto-resolve activated tasks:**

  For each task ID in `activatedTaskIds`:
  1. Run `node ~/.claude/bin/azdev-tools.cjs update-state --id {taskId} --state "Resolved" --cwd $CWD`
  2. Log result.

  **Step 2g — Auto-resolve story:**

  Run `node ~/.claude/bin/azdev-tools.cjs get-child-states --id {storyId} --cwd $CWD`
  - If `allResolved === true`: resolve the story automatically.
  - If `allResolved === false`: log which tasks remain open.

  **Step 2h — Push and create PR:**

  Build a PR body string with story info, changes summary, resolved tasks, and test plan checklist.

  Run: `node ~/.claude/bin/azdev-tools.cjs create-pr --repo {repoPath} --branch {branchName} --base {baseBranch} --title "#{storyId} {storyTitle}" --body "{prBody}" --story-id {storyId} --cwd $CWD`

  - If exit 0: parse JSON. Store `pr` URL in `sprintResults`.
  - If exit 1: log error. Record "PR not created" and move on.

  Record story outcome: "completed" (with PR URL), "partial" (some tasks remain), or "skipped" (with reason).

**Step 3 — Sprint summary:**

Display:
```
╔══════════════════════════════════════════╗
║         Sprint Execution Complete        ║
╚══════════════════════════════════════════╝

Sprint: {sprintName}
Stories processed: {total}

{for each story in sprintResults:}
  {status icon} #{storyId} — {storyTitle}
     Branch: {branchName}
     Tasks: {resolvedCount}/{totalCount} resolved
     Story: {Resolved ✓ | Active (X tasks remaining)}
     PR: {prUrl | "not created — {reason}"}

{end for}

Summary:
  ✓ Completed: {count}
  ◐ Partial:   {count}
  ✗ Skipped:   {count}

Pull requests created:
  {list of PR URLs}

Next steps:
  - Review and merge the PRs
  - Run `/azdev-sprint` to see updated sprint status
```

</process>

<error_handling>

**Critical principle: never stop the loop.** Individual story failures must not block the remaining stories.

**Per-story error handling:**

- Missing story spec: Skip the story. Record as "skipped — no story spec".
- Git errors (dirty tree, missing branch, merge conflicts): Attempt `git stash`, retry. If still failing, skip the story and record the error.
- `update-state` failures: Log and continue. Non-blocking.
- PR creation failure: Log error. Branch is already pushed, so record "PR not created" and move on.
- Implementation blockers: Make best-effort judgment. Log assumptions. Do NOT stop to ask.
- Repo path doesn't exist: Skip the story. Record as "skipped — repo not found at {path}".

**Only STOP the entire sprint execution for:**
- Missing azdev-tools.cjs (nothing can work without it)
- Missing config (no API access)
- Missing or empty task map (nothing to execute)

</error_handling>

<success_criteria>
- All stories in the task map are processed sequentially without user interaction
- Each story gets its own feature branch from develop
- Tasks are activated before work and resolved after work — automatically
- Stories are resolved when all children are resolved — automatically
- Each story gets a PR to develop
- Errors on one story do not block the next
- Clear sprint-level summary with all PR links at the end
- Zero user prompts during execution (AskUserQuestion is NOT in allowed-tools)
</success_criteria>
