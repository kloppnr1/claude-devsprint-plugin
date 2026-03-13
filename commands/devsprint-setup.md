---
name: devsprint-setup
description: Configure provider (GitHub or Azure DevOps) with MCP server
argument-hint: "[github|azdo]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - AskUserQuestion
  - mcp__azure-devops__ado_core_list_projects
  - mcp__azure-devops__ado_core_list_project_teams
  - mcp__azure-devops__ado_work_get_team_settings
  - mcp__github__get_me
---

<objective>
Configure which provider to use (GitHub or Azure DevOps). Register the appropriate MCP server in `.mcp.json`. Both providers use OAuth (browser login) — no PAT needed.

Store provider config in `.planning/devsprint-config.json` with provider-specific settings (org, project, team, area for azdo; owner, repo, assignee for github).

On re-run: show current config and let user update or keep.
</objective>

<execution_context>
MCP config: .mcp.json (in repo root)
Provider config: .planning/devsprint-config.json
</execution_context>

<provider_config>
The config file stores both providers side-by-side. Switching only changes the `provider` field:
```json
{
  "provider": "github",
  "github": { "owner": "...", "repo": "...", "assignee": "..." },
  "azdo": { "org": "...", "project": "...", "team": "...", "area": "...", "assignee": "..." }
}
```
</provider_config>

<process>
**Determine provider from argument:**
- If argument is `github` or `azdo`: use that provider.
- If no argument: use `AskUserQuestion` to ask "Which provider?" with options `["GitHub", "Azure DevOps"]`.

---

## GitHub setup

1. **Register MCP server:**
   Read `.mcp.json`. If no `"github"` entry exists, add it:
   ```json
   {
     "mcpServers": {
       "github": {
         "type": "url",
         "url": "https://api.githubcopilot.com/mcp/"
       }
     }
   }
   ```
   Preserve any existing entries (e.g., azure-devops).

2. **Verify connection:**
   Call `mcp__github__get_me` to verify OAuth works.
   - Success: display "Connected as {login}".
   - Failure: display "GitHub MCP not connected. Restart Claude Code — a browser login will be triggered on first use."

3. **Configure provider settings:**
   Read existing `.planning/devsprint-config.json` if it exists.
   - If `github` section already exists: show current values, ask "Update or keep?"
   - If "keep": skip to step 5.

   Use `AskUserQuestion` to prompt for:
   - GitHub owner (user or org, e.g., `kloppnr1`)
   - Repository name (e.g., `claude-devsprint-plugin`)
   - Assignee (GitHub username for filtering, e.g., `kloppnr1`)

4. **Save config:**
   Write `.planning/devsprint-config.json` with `provider: "github"` and the github section.
   Preserve any existing `azdo` section.

5. **Verify `.gitignore`:**
   Check `.gitignore` covers `devsprint-config.json`. Add if missing.

6. **Summary:**
   ```
   Setup complete:
     Provider: GitHub
     MCP: github (OAuth)
     Owner: {owner}
     Repo: {repo}
     Assignee: {assignee}
   ```

---

## Azure DevOps setup

1. **Register MCP server:**
   Read `.mcp.json`. If no `"azure-devops"` entry exists, ask for org name via `AskUserQuestion`:
   "Azure DevOps organisation name (e.g., 'verdo365'):"

   Add to `.mcp.json`:
   ```json
   {
     "mcpServers": {
       "azure-devops": {
         "command": "npx",
         "args": ["-y", "@azure-devops/mcp", "<orgName>"]
       }
     }
   }
   ```
   Preserve any existing entries (e.g., github).
   Display: "On first use, a browser window will open for OAuth login."

2. **Verify connection:**
   Call `mcp__azure-devops__ado_core_list_projects` to verify OAuth works.
   - Success: display "Connected to {orgName}."
   - Failure: display "Azure DevOps MCP not connected. Restart Claude Code — a browser login will be triggered on first use."

3. **Configure provider settings:**
   Read existing `.planning/devsprint-config.json` if it exists.
   - If `azdo` section already exists: show current values, ask "Update or keep?"
   - If "keep": skip to step 6.

   Use `AskUserQuestion` to prompt for:
   - Project name (e.g., "Verdo Agile Development")
   - Assignee name (e.g., "Martin Klopp Jensen")

4. **Auto-detect team:**
   Call `mcp__azure-devops__ado_core_list_project_teams` with the project name.
   - Success: present team names via `AskUserQuestion`: "Which team?"
   - Failure: warn "Could not list teams." Skip team/area.

5. **Auto-detect area:**
   If team was selected:
   Call `mcp__azure-devops__ado_work_get_team_settings` with team name.
   - Success: extract default area path. Display "Auto-detected area: {area}"
   - Failure: warn "Could not resolve area."

   **Save config:**
   Write `.planning/devsprint-config.json` with `provider: "azdo"` and the azdo section (org, project, team, area, assignee).
   Preserve any existing `github` section.

6. **Verify `.gitignore`:**
   Check `.gitignore` covers `devsprint-config.json`. Add if missing.

7. **Summary:**
   ```
   Setup complete:
     Provider: Azure DevOps
     MCP: azure-devops ({orgName}) — OAuth
     Project: {project}
     Team: {team}
     Area: {area}
     Assignee: {assignee}
   ```
</process>

<success_criteria>
- `.mcp.json` contains the correct MCP server entry for the chosen provider
- `.planning/devsprint-config.json` has provider field and provider-specific settings
- Both provider configs preserved side-by-side (switching doesn't delete the other)
- No PAT required — both providers use OAuth via MCP
- MCP connection tested (or user informed to restart)
- `.gitignore` covers `devsprint-config.json`
</success_criteria>
