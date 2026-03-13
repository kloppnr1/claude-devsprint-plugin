---
name: devsprint-create
description: Create stories and tasks in Azure DevOps current sprint
argument-hint: "<description of what to create>"
allowed-tools:
  - Bash
  - AskUserQuestion
  - Skill
---

<feedback_rule>
**CRITICAL — Free-text feedback rule:**
When the user chooses "Edit" or any option meaning "change something", respond with plain text "Hvad vil du ændre?" and STOP. Wait for their free-text reply. Do NOT use `AskUserQuestion` with multiple-choice guesses — that creates frustrating loops. Only use `AskUserQuestion` for structured choices (yes/no, pick from a list), never for open-ended feedback.
</feedback_rule>

<context_rule>
**NEVER mention context usage, context limits, or suggest starting a new session.** NEVER offer to "save findings for later" or "continue in a new session" or "take this up in a fresh session". Auto-compact handles context automatically. Just keep working.
</context_rule>

<objective>
Create User Stories and Tasks in Azure DevOps from a natural language description. Parses the user's intent, creates work items via MCP tools, and links tasks to their parent stories. All items are assigned to the current sprint.
</objective>

<execution_context>
MCP server: azure-devops (registered in .mcp.json)
$CWD is the project directory where .planning/ lives.
</execution_context>

<context>
MCP tools used by this command:

  mcp__azure-devops__ado_wit_create_work_item
    -> Creates a work item in Azure DevOps
    -> Parameters: project, type (User Story/Task/Bug), title, description (optional), areaPath (optional), iterationPath (optional), assignedTo (optional), parentId (optional), additionalFields (optional)
    -> Returns: created work item with id, url, etc.

  mcp__azure-devops__ado_wit_my_work_items
    -> Fetches items assigned to current user (for context on existing stories)

  mcp__azure-devops__ado_work_list_team_iterations
    -> Gets current sprint iteration path (needed for iterationPath parameter)
</context>

<process>

**Step 1 — Get current sprint iteration path:**

Call `mcp__azure-devops__ado_work_list_team_iterations` with the project and team, timeframe "current", to get the current sprint's iteration path. Store as `currentIterationPath`.

**Step 2 — Parse user intent:**

The user's argument describes what they want to create. Parse it into structured work items.

Common patterns:
- **Single story**: "Tilføj prisområde-kolonne til kundelisten" → 1 User Story
- **Story with tasks**: "Implementer CSV-eksport: 1) Backend endpoint 2) Frontend knap 3) Tests" → 1 User Story + 3 Tasks
- **Multiple stories**: User may describe several features → multiple User Stories
- **Tasks under existing story**: "Tilføj tasks til #42920: test, deploy" → Tasks with parentId 42920
- **Bug**: "Bug: faktura viser forkert beløb" → 1 User Story (parent) + 1 Bug (child)

If the argument references an existing story ID (e.g., "#42920" or "under 42920"), use that as the parent for tasks.

If the intent is ambiguous, use `AskUserQuestion` to clarify:
- "Should this be a story or a task?"
- "Should these be separate stories or tasks under one story?"

**Step 3 — Present plan for confirmation:**

Show the user what will be created, then proceed directly to Step 4 (no confirmation needed — incorrect items can be deleted in Azure DevOps):

```
Creating:

  [User Story] "Tilføj prisområde-kolonne til kundelisten"
    [Task] "Backend: Tilføj prisområde-felt til API response"
    [Task] "Frontend: Vis prisområde i kundetabellen"
    [Task] "Test: Skriv tests for prisområde-logik"

All items will be assigned to the current sprint.
```

**Step 4 — Create work items:**

Create items in order:
1. **Stories first** (they have no parent dependency within this batch)
2. **Tasks second** (they need the parent story ID from step 1)

For each item, call `mcp__azure-devops__ado_wit_create_work_item` with:
- `project`: "Verdo Agile Development"
- `type`: "User Story", "Task", or "Bug"
- `title`: the work item title
- `iterationPath`: `currentIterationPath` (assigns to current sprint)
- `assignedTo`: "Martin Klopp Jensen"
- `parentId`: parent story ID (for tasks/bugs)
- `description`: HTML description if applicable

For tasks under a story created in this batch, use the ID returned from the story creation as `parentId`.

**Step 5 — Summary:**

Display results with the story ID prominently shown:

```
╔══════════════════════════════════════════╗
║  Story #42950 oprettet                   ║
╚══════════════════════════════════════════╝

  ✓ #42950 [User Story] "Tilføj prisområde-kolonne til kundelisten"
    ✓ #42951 [Task] "Backend: Tilføj prisområde-felt til API response"
    ✓ #42952 [Task] "Frontend: Vis prisområde i kundetabellen"
    ✓ #42953 [Task] "Test: Skriv tests for prisområde-logik"

Sprint: Sprint 39 - 2026
```

**Step 6 — Show next step:**

After displaying the summary, show the next step as plain text. Do NOT prompt or use `AskUserQuestion`.

Display: "Next step: `/devsprint-plan {storyId}` to analyze and create spec."

</process>

<rules>
- Always assign to current sprint using iterationPath
- Always assign to "Martin Klopp Jensen"
- Story titles should be user-facing descriptions (Danish is fine)
- Task titles should be actionable and specific
- Create stories before tasks (tasks need parent ID)
- Never create work items without user confirmation
- If the user mentions an existing story ID as parent, use it directly (don't create a new story)
- NEVER create Tasks under Bugs. Bugs are standalone work items with no children. Only User Stories can have child Tasks.
- Bugs MUST always have a parent User Story. Always create a User Story first, then create the Bug as its child.
</rules>
