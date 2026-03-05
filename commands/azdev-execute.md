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
Execute the story spec for one or more analyzed stories. For each story: create a feature branch, navigate to the target repo, set tasks to Active in Azure DevOps, implement the work described in the story spec, auto-resolve tasks and story when complete, and create a PR to develop.
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

**Step 1 — Check prerequisites:**

1. Verify `~/.claude/bin/azdev-tools.cjs` exists via Bash `test -f`.
   If missing: tell user "Azure DevOps tools not installed. Check that ~/.claude/bin/azdev-tools.cjs exists." Stop.

2. Run `node ~/.claude/bin/azdev-tools.cjs load-config --cwd $CWD`.
   If exit 1: tell user "No Azure DevOps config found. Run `/azdev-setup` to configure your connection." Stop.

3. Check that `$CWD/.planning/azdev-task-map.json` exists via Bash `test -f`.
   If missing: tell user "No task map found. Run `/azdev-plan` first to analyze your sprint stories." Stop.

4. Read `$CWD/.planning/azdev-task-map.json` using the Read tool. Parse the JSON.
   If the `mappings` array is empty: tell user "Task map has no story mappings. Run `/azdev-plan` and approve at least one story." Stop.

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

**Step 3 — Load story spec:**

1. Read `{current.repoPath}/.planning/stories/{current.storyId}.md` using the Read tool.
   If missing: tell user "No story spec found at {current.repoPath}/.planning/stories/{current.storyId}.md. Run `/azdev-plan {current.storyId}` to generate it." Stop.

2. Parse the story spec — it contains goal, acceptance criteria, technical context (key files, architecture), implementation notes, open questions, and tasks. This is your single source of truth for the implementation.

**Step 4 — Create feature branch:**

Run: `node ~/.claude/bin/azdev-tools.cjs create-branch --repo {current.repoPath} --story-id {current.storyId} --title "{current.storyTitle}"`

- If exit 0: parse JSON. Store `branch` as `current.branchName` and `base` as `current.baseBranch`.
  - If `created === true`: "Created branch {branch} from {base}"
  - If `created === false`: "Checked out existing branch {branch}"
- If exit 1: show error and stop.

**Step 5 — Activate tasks in Azure DevOps:**

Track which task IDs are successfully activated in a list called `activatedTaskIds`.

For each task ID in `current.taskIds`:
1. Run `node ~/.claude/bin/azdev-tools.cjs update-state --id {taskId} --state "Active" --cwd $CWD`
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

This is the main implementation phase. The story spec (`stories/{current.storyId}.md`) contains everything you need: goal, acceptance criteria, key files, implementation notes, and open questions. Do NOT re-analyze the codebase.

1. **Navigate to the target repo**: Use `{current.repoPath}` as the working directory for all file operations.

2. **Follow the story spec**: Use the acceptance criteria and implementation notes as your guide. The spec describes exactly what to do.

3. **For each piece of work**:
   - Read ONLY the specific files listed in the "Key Files" section or that you need to edit.
   - Implement the changes described in the implementation notes using Edit/Write tools.
   - Run any tests or build commands if the project has them (check package.json scripts, Makefile, etc.).

4. **Match tasks to work**: As you complete work that corresponds to a specific Azure DevOps task (from `current.taskTitles`), note which tasks have been completed.

5. **Handle issues**: If you encounter blockers or need clarification, use `AskUserQuestion` to consult the user. Do not guess at requirements.

6. **Commit changes**: After meaningful chunks of work, commit changes via git. Use descriptive commit messages referencing the story ID (e.g., "feat: implement API endpoint for #{storyId}"). Do NOT ask the user — just commit directly on the feature branch.

IMPORTANT: Do NOT spend time exploring or understanding the codebase broadly. The `/azdev-plan` command already did that analysis and wrote the story spec. Trust the spec. Only read files that you are about to modify.

**Step 7 — Auto-resolve activated tasks:**

After the implementation work is done, automatically resolve the tasks that were activated in Step 5:

For each task ID in `activatedTaskIds`:
1. Run `node ~/.claude/bin/azdev-tools.cjs update-state --id {taskId} --state "Resolved" --cwd $CWD`
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

Run `node ~/.claude/bin/azdev-tools.cjs get-child-states --id {current.storyId} --cwd $CWD`
- Parse the JSON result.
- If `allResolved === true`:
  Automatically resolve the story:
  Run `node ~/.claude/bin/azdev-tools.cjs update-state --id {current.storyId} --state "Resolved" --cwd $CWD`
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
{Brief summary of what was implemented, based on the story spec}

## Tasks resolved
- #{taskId} — {taskTitle}
- #{taskId} — {taskTitle}

## Test plan
- [ ] Verify acceptance criteria from story
- [ ] Run automated tests
- [ ] Code review
```

Run: `node ~/.claude/bin/azdev-tools.cjs create-pr --repo {current.repoPath} --branch {current.branchName} --base {current.baseBranch} --title "#{current.storyId} {current.storyTitle}" --body "{prBody}" --story-id {current.storyId} --cwd $CWD`

- If exit 0: parse JSON. Store `pr` URL for the summary. PR is automatically linked to the story.
- If exit 1: warn user. The branch may already be pushed — suggest creating PR manually in Azure DevOps.

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

- Story spec is missing but task map exists: The user may have deleted the spec. Tell them to re-run `/azdev-plan {storyId}` to regenerate.

- Git operations fail in target repo: Warn user with error details. Continue with implementation if possible, or ask user to resolve the git issue manually.

- `develop` branch does not exist on remote: Warn the user. Ask if they want to target a different base branch (e.g., `main`).

- PR creation fails: Warn user with error. The branch is already pushed, so suggest creating the PR manually in Azure DevOps.

</error_handling>

<success_criteria>
- Task map is loaded and validated before any work begins
- User selects which story to execute (or auto-selects if only one)
- A feature branch is created from develop before any code changes
- All child tasks are set to Active in Azure DevOps before implementation starts
- Implementation follows the story spec (acceptance criteria + implementation notes)
- Tasks that were activated are automatically resolved after implementation — no user prompt
- Parent story is automatically resolved when all child tasks are resolved — no user prompt
- Feature branch is pushed and a PR to develop is created
- Clear summary shows what was done, PR link, and what remains
- Non-blocking errors (failed state transitions) are warned but don't halt execution
- User is only asked for input when selecting a story (multiple mappings) or when encountering blockers during implementation
</success_criteria>
