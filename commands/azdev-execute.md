---
name: azdev-execute
description: Execute project plans and update Azure DevOps task status automatically
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
Execute the project plan for one or more analyzed stories. For each story: create a feature branch, navigate to the target repo, set tasks to Active in Azure DevOps, work through the ROADMAP.md phases using PROJECT.md and REQUIREMENTS.md as guidance, auto-resolve tasks and story when complete, and create a PR to develop.
</objective>

<execution_context>
Helper: ~/.claude/azdev-skill/bin/azdev-tools.cjs
Config file: .planning/azdev-config.json
Task map: .planning/azdev-task-map.json
$CWD is the project directory where .planning/ lives.
</execution_context>

<context>
azdev-tools.cjs CLI contracts used by this command:

  node ~/.claude/azdev-skill/bin/azdev-tools.cjs load-config --cwd $CWD
    -> stdout: JSON {"org":"...","project":"...","pat":"<raw-decoded>"}
    -> exit 0 on success, exit 1 if no config

  node ~/.claude/azdev-skill/bin/azdev-tools.cjs update-state --id <workItemId> --state <state> --cwd $CWD
    -> stdout: JSON {"status":"updated","id":N,"state":"<newState>"}
    -> Valid states: "New", "Active", "Resolved", "Closed"
    -> exit 0 on success, exit 1 on error (invalid transition, 403, etc.)

  node ~/.claude/azdev-skill/bin/azdev-tools.cjs get-child-states --id <storyId> --cwd $CWD
    -> stdout: JSON {"allResolved": bool, "children": [{"id":N,"title":"...","state":"..."}]}
    -> allResolved is true when every child is Resolved, Closed, or Done
    -> exit 0 on success, exit 1 on error

  node ~/.claude/azdev-skill/bin/azdev-tools.cjs create-branch --repo <path> --story-id <id> --title <title> [--base <branch>]
    -> Stashes dirty changes, fetches base branch (develop, fallback main), creates feature/<id>-<slug>
    -> stdout: JSON {"branch":"...","base":"...","created":true|false}
    -> exit 0 on success, exit 1 on error

  node ~/.claude/azdev-skill/bin/azdev-tools.cjs create-pr --repo <path> --branch <name> --base <branch> --title <title> --body <body>
    -> Pushes branch to origin, creates PR using gh CLI
    -> stdout: JSON {"pr":"<url>","branch":"...","base":"...","pushed":true}
    -> exit 0 on success, exit 1 on error

azdev-task-map.json structure (written by /azdev-analyze):
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

**Step 1 — Check prerequisites:**

1. Verify `~/.claude/azdev-skill/bin/azdev-tools.cjs` exists via Bash `test -f`.
   If missing: tell user "Azure DevOps tools not installed. Check that ~/.claude/azdev-skill/bin/azdev-tools.cjs exists." Stop.

2. Run `node ~/.claude/azdev-skill/bin/azdev-tools.cjs load-config --cwd $CWD`.
   If exit 1: tell user "No Azure DevOps config found. Run `/azdev-setup` to configure your connection." Stop.

3. Check that `$CWD/.planning/azdev-task-map.json` exists via Bash `test -f`.
   If missing: tell user "No task map found. Run `/azdev-analyze` first to analyze your sprint stories and generate project plans." Stop.

4. Read `$CWD/.planning/azdev-task-map.json` using the Read tool. Parse the JSON.
   If the `mappings` array is empty: tell user "Task map has no approved story mappings. Run `/azdev-analyze` and approve at least one repo." Stop.

**Step 2 — Select story to execute:**

If the user passed a story ID as argument:
- Find the mapping where `storyId` matches. If not found: "Story #{id} is not in the task map. Available stories: {list}." Stop.

If no argument was passed:
- If there is exactly 1 mapping: use it automatically.
- If there are multiple mappings: present a selection using `AskUserQuestion`:
  "Which story do you want to execute?"
  Options: one per mapping, labeled "#{storyId} -- {storyTitle} ({repoPath})"
  The user selects one.

Store the selected mapping as `current`.

**Step 3 — Load project plan:**

1. Read `{current.repoPath}/.planning/PROJECT.md` using the Read tool.
   If missing: tell user "No PROJECT.md found at {current.repoPath}/.planning/. Run `/azdev-analyze` to generate it." Stop.

2. Read `{current.repoPath}/.planning/ROADMAP.md` using the Read tool.
   If missing: warn user but continue — the roadmap is helpful but not strictly required.

3. Read `{current.repoPath}/.planning/REQUIREMENTS.md` using the Read tool.
   If missing: warn user but continue.

**Step 4 — Create feature branch:**

Run: `node ~/.claude/azdev-skill/bin/azdev-tools.cjs create-branch --repo {current.repoPath} --story-id {current.storyId} --title "{current.storyTitle}"`

- If exit 0: parse JSON. Store `branch` as `current.branchName` and `base` as `current.baseBranch`.
  - If `created === true`: "Created branch {branch} from {base}"
  - If `created === false`: "Checked out existing branch {branch}"
- If exit 1: show error and stop.

**Step 5 — Activate tasks in Azure DevOps:**

Track which task IDs are successfully activated in a list called `activatedTaskIds`.

For each task ID in `current.taskIds`:
1. Run `node ~/.claude/azdev-skill/bin/azdev-tools.cjs update-state --id {taskId} --state "Active" --cwd $CWD`
2. If exit 0: add to `activatedTaskIds` and note success.
3. If exit 1: warn user but continue. The task may already be Active or in a state that doesn't allow transition to Active (e.g., already Resolved). This is non-blocking. Do NOT add to `activatedTaskIds`.

Display a brief status:
```
Task status updates:
  #{taskId} ({taskTitle}): Active ✓
  #{taskId} ({taskTitle}): Active ✓
  #{taskId} ({taskTitle}): already Active (skipped)
```

**Step 6 — Execute the work:**

This is the main implementation phase. Work through the project plan:

1. **Navigate to the target repo**: Use `{current.repoPath}` as the working directory for all file operations.

2. **Follow the ROADMAP.md phases**: Read each phase's goal, requirements, and success criteria. Execute the plans in order.

3. **For each phase/plan**:
   - Read the relevant source files in the repo to understand the current code.
   - Implement the changes described in the plan using Edit/Write tools.
   - Run any tests or build commands if the project has them (check for package.json scripts, Makefile, etc.).
   - After implementing a plan, update ROADMAP.md to mark it complete (change `- [ ]` to `- [x]`).

4. **Match tasks to work**: As you complete work that corresponds to a specific Azure DevOps task (from `current.taskTitles`), note which tasks have been completed.

5. **Handle issues**: If you encounter blockers or need clarification, use `AskUserQuestion` to consult the user. Do not guess at requirements.

6. **Commit changes**: After meaningful chunks of work, commit changes via git. Use descriptive commit messages referencing the story ID (e.g., "feat: implement API endpoint for #{storyId}"). Do NOT ask the user — just commit directly on the feature branch.

**Step 7 — Auto-resolve activated tasks:**

After the implementation work is done, automatically resolve the tasks that were activated in Step 5:

For each task ID in `activatedTaskIds`:
1. Run `node ~/.claude/azdev-skill/bin/azdev-tools.cjs update-state --id {taskId} --state "Resolved" --cwd $CWD`
2. If exit 0: note success.
3. If exit 1: warn user with error details.

Display:
```
Task resolution:
  #{taskId} ({taskTitle}): Resolved ✓
  #{taskId} ({taskTitle}): Resolved ✓
```

**Step 8 — Auto-resolve story if all tasks done:**

After resolving tasks, check if the parent story can be resolved:

Run `node ~/.claude/azdev-skill/bin/azdev-tools.cjs get-child-states --id {current.storyId} --cwd $CWD`
- Parse the JSON result.
- If `allResolved === true`:
  Automatically resolve the story:
  Run `node ~/.claude/azdev-skill/bin/azdev-tools.cjs update-state --id {current.storyId} --state "Resolved" --cwd $CWD`
  Display: "Story #{current.storyId} resolved ✓"

- If `allResolved === false`:
  Display remaining open tasks:
  ```
  Story #{current.storyId} still has open tasks:
    #{childId} -- {childTitle} ({childState})
  ```

**Step 9 — Push and create PR to develop:**

Build a PR body string containing:
```
## Azure DevOps Story
#{current.storyId} — {current.storyTitle}

## Changes
{Brief summary of what was implemented, based on the ROADMAP.md phases completed}

## Tasks resolved
- #{taskId} — {taskTitle}
- #{taskId} — {taskTitle}

## Test plan
- [ ] Verify acceptance criteria from story
- [ ] Run automated tests
- [ ] Code review
```

Run: `node ~/.claude/azdev-skill/bin/azdev-tools.cjs create-pr --repo {current.repoPath} --branch {current.branchName} --base {current.baseBranch} --title "#{current.storyId} {current.storyTitle}" --body "{prBody}"`

- If exit 0: parse JSON. Store `pr` URL for the summary.
- If exit 1: warn user. The branch may already be pushed — suggest creating PR manually.

**Step 10 — Final summary:**

Display:
```
=== Execution Summary ===

Story: #{current.storyId} -- {current.storyTitle}
Repo: {current.repoPath}
Branch: {current.branchName}

Tasks resolved: {count}/{total}
  #{taskId} -- {taskTitle}: Resolved
  #{taskId} -- {taskTitle}: Active (remaining)

Story status: {Resolved | Active (X tasks remaining)}

PR: {prUrl}

Files modified:
  {list of files changed during execution}

Next steps:
  {If tasks remain: "Run `/azdev-execute` again to continue working on remaining tasks."}
  {If story resolved: "Story complete! Review and merge the PR, then run `/azdev-sprint` to see updated sprint status."}
```

</process>

<error_handling>

**Common errors and responses:**

- `update-state` returns exit 1 with "invalid state transition": The task may already be in the target state or in a state that doesn't allow the transition (e.g., Closed → Active). Warn the user but continue. Suggest checking the work item in Azure DevOps if the transition seems wrong.

- `update-state` returns 403: "Insufficient permissions. Your PAT may not have `vso.work_write` scope. Regenerate your PAT with `vso.work_write` and run `/azdev-setup`."

- Task map references a repo path that no longer exists: Warn the user and ask for the correct path. If user cannot provide one, skip that story.

- PROJECT.md is missing but task map exists: The user may have deleted the project files. Tell them to re-run `/azdev-analyze` to regenerate.

- Git operations fail in target repo: Warn user with error details. Continue with implementation if possible, or ask user to resolve the git issue manually.

- `develop` branch does not exist on remote: Warn the user. Ask if they want to target a different base branch (e.g., `main`).

- `gh pr create` fails: Warn user with error. The branch is already pushed, so suggest creating the PR manually in the browser.

</error_handling>

<success_criteria>
- Task map is loaded and validated before any work begins
- User selects which story to execute (or auto-selects if only one)
- A feature branch is created from develop before any code changes
- All child tasks are set to Active in Azure DevOps before implementation starts
- Implementation follows the project plan (ROADMAP.md phases)
- Tasks that were activated are automatically resolved after implementation — no user prompt
- Parent story is automatically resolved when all child tasks are resolved — no user prompt
- Feature branch is pushed and a PR to develop is created
- Clear summary shows what was done, PR link, and what remains
- Non-blocking errors (failed state transitions) are warned but don't halt execution
- User is only asked for input when selecting a story (multiple mappings) or when encountering blockers during implementation
</success_criteria>
