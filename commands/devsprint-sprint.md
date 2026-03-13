---
name: devsprint-sprint
description: View current sprint backlog from Azure DevOps
argument-hint: "[--all] [--detailed]"
allowed-tools:
  - Bash
---

<objective>
Fetch and display the current sprint backlog from Azure DevOps using the MCP server. Renders a formatted sprint board in the terminal.
</objective>

<execution_context>
MCP server: azure-devops (registered in .mcp.json)
Helper (for rendering only): ~/.claude/bin/devsprint-tools.cjs
</execution_context>

<process>
1. **Fetch current sprint:**
   Call `mcp__azure-devops__ado_work_list_team_iterations` with the project and team to get iterations. Identify the current sprint (timeframe = current).

2. **Fetch sprint work items:**
   Call `mcp__azure-devops__ado_wit_get_work_items_for_iteration` with the current iteration to get all work items.

   Alternatively, call `mcp__azure-devops__ado_wit_my_work_items` to get items assigned to the current user.

3. **Display the sprint board:**
   Format the work items as a sprint board. Group by story, show child tasks underneath.

   For each story:
   ```
   ━━━ #{id} {title} [{state}] ━━━
   {If --detailed: description and acceptance criteria}

   Tasks:
     [{state}] #{taskId} {taskTitle} — {assignedTo}
     [{state}] #{taskId} {taskTitle} — {assignedTo}
     {If not --all and completed tasks exist: "+ N completed"}
   ```

   **Default (no flags):** Show only the user's items. Hide completed tasks (show "+ N completed" count). Hide resolved/closed stories.

   **If `--all`:** Show all stories and tasks including resolved/closed/done.

   **If `--detailed`:** Show description, acceptance criteria, and all tasks (verbose view).

4. **Sprint summary:**
   ```
   Sprint: {sprintName} ({startDate} — {finishDate})
   Stories: {total} ({active} active, {resolved} resolved)
   Tasks: {total} ({done}/{total} done)
   ```
</process>

<important>
- Do NOT output thinking, planning, or narration text. Just show the sprint board.
- After the board, output only a short summary line.
</important>

<success_criteria>
- Sprint board displayed using MCP data
- Default shows only current user's incomplete items
- --all shows everything including completed
- --detailed shows descriptions and acceptance criteria
- Clear sprint summary with dates and progress
</success_criteria>
