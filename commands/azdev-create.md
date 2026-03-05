---
name: azdev-create
description: Create stories and tasks in Azure DevOps current sprint
argument-hint: "<description of what to create>"
allowed-tools:
  - Bash
  - AskUserQuestion
---

<objective>
Create User Stories and Tasks in Azure DevOps from a natural language description. Parses the user's intent, creates work items via the API, and links tasks to their parent stories. All items are assigned to the current sprint.
</objective>

<execution_context>
Helper: ~/.claude/bin/azdev-tools.cjs
Config file: .planning/azdev-config.json
$CWD is the project directory where .planning/ lives.
</execution_context>

<context>
azdev-tools.cjs CLI contract used by this command:

  node ~/.claude/bin/azdev-tools.cjs create-work-item --type <type> --title "<title>" [--description "<html>"] [--parent <id>] [--sprint] [--assigned-to "<name>"] [--area "<path>"] [--tags "<comma-separated>"] --cwd $CWD
    -> Creates a work item in Azure DevOps
    -> --type: "User Story", "Task", "Bug", "Feature", or "Epic"
    -> --title: Work item title (required)
    -> --description: HTML description (optional)
    -> --parent: Parent work item ID to link as child (optional)
    -> --sprint: Assign to current active sprint (optional)
    -> --assigned-to: Display name of person to assign (optional)
    -> --area: Area path for the work item (optional)
    -> --tags: Comma-separated tags (optional)
    -> stdout: JSON {"status":"created","id":N,"type":"...","title":"...","url":"..."}
    -> exit 0 on success, exit 1 on error

  node ~/.claude/bin/azdev-tools.cjs get-sprint-items --me --cwd $CWD
    -> Fetches items in current sprint (for context on existing stories)
    -> stdout: JSON array

  node ~/.claude/bin/azdev-tools.cjs load-config --cwd $CWD
    -> Reads config
    -> stdout: JSON {"org":"...","project":"...","pat":"..."}
</context>

<process>

**Step 1 — Check prerequisites:**

1. Verify `~/.claude/bin/azdev-tools.cjs` exists. If not: "Azure DevOps tools not installed." Stop.
2. Run `node ~/.claude/bin/azdev-tools.cjs load-config --cwd $CWD`. If exit 1: "No config. Run `/azdev-setup`." Stop.

**Step 2 — Parse user intent:**

The user's argument describes what they want to create. Parse it into structured work items.

Common patterns:
- **Single story**: "Tilføj prisområde-kolonne til kundelisten" → 1 User Story
- **Story with tasks**: "Implementer CSV-eksport: 1) Backend endpoint 2) Frontend knap 3) Tests" → 1 User Story + 3 Tasks
- **Multiple stories**: User may describe several features → multiple User Stories
- **Tasks under existing story**: "Tilføj tasks til #42920: test, deploy" → Tasks with --parent 42920
- **Bug**: "Bug: faktura viser forkert beløb" → 1 Bug

If the argument references an existing story ID (e.g., "#42920" or "under 42920"), use that as the parent for tasks.

If the intent is ambiguous, use `AskUserQuestion` to clarify:
- "Should this be a story or a task?"
- "Should these be separate stories or tasks under one story?"

**Step 3 — Present plan for confirmation:**

Before creating anything, show the user what will be created:

```
Plan:

  [User Story] "Tilføj prisområde-kolonne til kundelisten"
    [Task] "Backend: Tilføj prisområde-felt til API response"
    [Task] "Frontend: Vis prisområde i kundetabellen"
    [Task] "Test: Skriv tests for prisområde-logik"

All items will be assigned to the current sprint.
```

Use `AskUserQuestion` with options: "Create" / "Edit" / "Cancel"

- **Create**: proceed to Step 4.
- **Edit**: ask what to change, update the plan, re-present.
- **Cancel**: stop.

**Step 4 — Create work items:**

Create items in order:
1. **Stories first** (they have no parent dependency within this batch)
2. **Tasks second** (they need the parent story ID from step 1)

For each item, run `create-work-item` with `--sprint` flag.

For tasks under a story created in this batch, use the ID returned from the story creation as `--parent`.

**Step 5 — Summary:**

Display results:

```
Created:

  ✓ #42950 [User Story] "Tilføj prisområde-kolonne til kundelisten"
    ✓ #42951 [Task] "Backend: Tilføj prisområde-felt til API response"
    ✓ #42952 [Task] "Frontend: Vis prisområde i kundetabellen"
    ✓ #42953 [Task] "Test: Skriv tests for prisområde-logik"

Sprint: Sprint 39 - 2026
URLs:
  https://verdo365.visualstudio.com/.../_workitems/edit/42950
```

</process>

<rules>
- Always use `--sprint` to assign items to the current sprint
- Story titles should be user-facing descriptions (Danish is fine)
- Task titles should be actionable and specific
- Create stories before tasks (tasks need parent ID)
- Never create work items without user confirmation
- If the user mentions an existing story ID as parent, use it directly (don't create a new story)
</rules>
