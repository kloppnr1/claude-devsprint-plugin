---
name: devsprint-test
description: Test Azure DevOps connection and verify credentials
argument-hint: ""
allowed-tools:
  - Read
  - Bash
---

<objective>
Verify that the Azure DevOps MCP server is connected and working. Shows a clear success or failure message.
</objective>

<execution_context>
MCP server: azure-devops (registered in .mcp.json)
</execution_context>

<process>
1. **Test MCP connection:**
   Call `mcp__azure-devops__ado_core_list_projects` to verify the MCP server is connected and authenticated.

   - If it returns project data: display "Connected to Azure DevOps via MCP (verdo365)." and list the projects found.
   - If the tool is not available: display "Azure DevOps MCP server not connected. Check that `.mcp.json` is configured and restart Claude Code. Run `/devsprint-setup` to configure."
   - If it returns an auth error: display "MCP server registered but not authenticated. Restart Claude Code — a browser window will open for OAuth login."

2. **Verify work item access:**
   Call `mcp__azure-devops__ado_wit_my_work_items` to verify work item read access.

   - If it returns data: display "Work item access verified."
   - If it fails: display "Connected but work item access failed. Check your OAuth permissions."

3. **Check dashboard config (optional):**
   Check if `.planning/devsprint-config.json` exists.
   - If it exists: run `node ~/.claude/bin/devsprint-tools.cjs test --cwd $CWD` to verify dashboard PAT.
     - If exit 0: display "Dashboard config: OK"
     - If exit 1: display "Dashboard config: PAT invalid. Run `/devsprint-setup` to update."
   - If not found: display "Dashboard config: not configured (optional — only needed for web dashboard)."
</process>

<success_criteria>
- Clear pass/fail output for MCP connection
- Work item access verified
- Dashboard config status shown (if configured)
- Failure output includes actionable next step
</success_criteria>
