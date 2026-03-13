---
name: devsprint-setup
description: Configure Azure DevOps connection credentials
argument-hint: ""
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - AskUserQuestion
---

<objective>
Ensure the Azure DevOps MCP server is registered in `.mcp.json` for this project. The MCP server uses OAuth (browser login) — no PAT needed for Claude commands.

Optionally configure `.planning/devsprint-config.json` with team/area defaults and a PAT for the dashboard server (which can't use MCP).

On re-run with existing config, show current values and let user choose to update or keep.
</objective>

<execution_context>
MCP config: .mcp.json (in repo root or ~/.claude/.mcp.json)
Dashboard config: .planning/devsprint-config.json (optional — only needed for dashboard)
</execution_context>

<process>
1. **Check MCP server registration:**
   Check if `.mcp.json` exists in the project root (or `$CWD/.mcp.json`).
   - Read the file and check if it contains an `"azure-devops"` entry under `mcpServers`.
   - If present: display "MCP server already registered: azure-devops (verdo365)". Continue to step 2.
   - If missing or no azure-devops entry: create/update `.mcp.json`:
     ```json
     {
       "mcpServers": {
         "azure-devops": {
           "command": "npx",
           "args": ["-y", "@azure-devops/mcp", "verdo365"]
         }
       }
     }
     ```
     Display: "Registered Azure DevOps MCP server for org 'verdo365'."
     Display: "On first use, a browser window will open for OAuth login."

2. **Verify MCP connection:**
   Test the MCP connection by calling `mcp__azure-devops__ado_core_list_projects` (or equivalent project list tool).
   - If it works: display "MCP connection verified — connected to verdo365."
   - If it fails (tool not available): display "MCP server registered but not yet connected. Restart Claude Code to activate, then a browser login will be triggered on first use."

3. **Check for existing dashboard config:**
   Check if `.planning/devsprint-config.json` exists.
   - If it exists: read it and display:
     ```
     Dashboard config (for standalone dashboard server):
       Org:     {org}
       Project: {project}
       Team:    {team || "(not set)"}
       Area:    {area || "(not set)"}
       PAT:     {masked — first 4 + "..." + last 4}
     ```
   - Use `AskUserQuestion` to ask: "Update dashboard config or keep current?"
   - If "keep": skip to step 6.
   - If "update": continue to step 4.
   - If no config exists: use `AskUserQuestion` to ask: "Set up dashboard config? (Only needed if you use the web dashboard)"
     - If "no": display "Skipped dashboard config. MCP setup complete." Stop.
     - If "yes": continue to step 4.

4. **Configure dashboard credentials:**
   The dashboard server runs as standalone Node.js and needs a PAT for Azure DevOps API access.

   Use `AskUserQuestion` to prompt for:
   - Organization URL or name (e.g., 'verdo365')
   - Project name
   - Personal Access Token (PAT) with scopes: vso.project + vso.work + vso.code

5. **Auto-detect team and area:**
   Use MCP tools to detect team and area:
   - Call `mcp__azure-devops__ado_core_list_project_teams` with the project name to get teams.
   - Present team options via `AskUserQuestion`.
   - Call `mcp__azure-devops__ado_work_get_team_settings` with the selected team to get the default area path.
   - Display: "Auto-detected area: {area}"

   **Save dashboard config:**
   Write `.planning/devsprint-config.json` with org, project, base64-encoded PAT, team, and area.

   Verify `.planning/devsprint-config.json` is covered by `.gitignore`:
   - Read the root `.gitignore` file.
   - If `devsprint-config.json` is not covered: add it to `.gitignore`.

6. **Summary:**
   ```
   Setup complete:
     MCP server: azure-devops (verdo365) — OAuth
     Dashboard:  {configured / not configured}

   Claude commands use MCP (OAuth). Dashboard uses PAT from .planning/devsprint-config.json.
   ```
</process>

<success_criteria>
- `.mcp.json` contains azure-devops MCP server entry
- MCP connection tested (or user informed to restart)
- Dashboard config optionally set up with PAT for standalone server
- PAT never echoed back in plain text
- `.gitignore` covers `devsprint-config.json` if dashboard config exists
</success_criteria>
