---
name: azdev-setup
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
Prompt for Azure DevOps org URL, project name, and Personal Access Token (PAT). Store credentials in `.planning/azdev-config.json`. Auto-run a connection test after saving to confirm everything works.

On re-run with existing config, show current values (PAT masked) and let user choose to update or keep.
</objective>

<execution_context>
Config file: .planning/azdev-config.json
Helper: ~/.claude/get-shit-done/bin/azdev-tools.cjs
</execution_context>

<context>
$CWD is the project directory where .planning/ lives.

azdev-tools.cjs CLI contract:
  node ~/.claude/get-shit-done/bin/azdev-tools.cjs load-config --cwd $CWD
    -> stdout: JSON {"org":"...","project":"...","pat":"<raw-decoded>"}
    -> exit 0 on success, exit 1 if no config

  node ~/.claude/get-shit-done/bin/azdev-tools.cjs save-config --org "<org>" --project "<project>" --pat "<pat>" --cwd $CWD
    -> Normalizes org (strips URL prefix), base64-encodes PAT
    -> stdout: JSON {"status":"saved","org":"...","project":"..."}
    -> exit 0 on success, exit 1 on error

  node ~/.claude/get-shit-done/bin/azdev-tools.cjs test --cwd $CWD
    -> Success: stdout "Connected to {org}/{project}", exit 0
    -> Failure: stderr error message with fix suggestion, exit 1
</context>

<process>
1. **Check for existing config:**
   Run `node ~/.claude/get-shit-done/bin/azdev-tools.cjs load-config --cwd $CWD`
   - If exit 0 (config found): go to step 2
   - If exit 1 (no config): go to step 3

2. **Existing config — show and offer update/keep:**
   - Parse the JSON output to get current org, project, and pat values
   - Mask the PAT: show first 4 chars + "..." + last 4 chars (e.g. `abcd...wxyz`). If PAT is shorter than 12 chars, show `****` instead.
   - Use `AskUserQuestion` to ask: "Current config: org={org}, project={project}, PAT={masked}. Update credentials or keep current? (update/keep)"
   - If user says "keep" (or anything that means keep/no change): skip to step 7 (auto-test)
   - If user says "update" (or anything that means change): continue to step 3

3. **Prompt for org:**
   Use `AskUserQuestion` to ask: "Azure DevOps organisation URL or name (e.g., 'myorg' or 'https://dev.azure.com/myorg'):"
   Store the answer as `<org>`.

4. **Prompt for project:**
   Use `AskUserQuestion` to ask: "Azure DevOps project name:"
   Store the answer as `<project>`.

5. **Prompt for PAT:**
   Use `AskUserQuestion` to ask: "Personal Access Token (PAT). Needs vso.project + vso.work scopes:"
   Store the answer as `<pat>`.
   IMPORTANT: Treat this value as sensitive. Do not echo it back in plain text or log it anywhere.

6. **Save credentials:**
   Run `node ~/.claude/get-shit-done/bin/azdev-tools.cjs save-config --org "<org>" --project "<project>" --pat "<pat>" --cwd $CWD`
   - If exit 0: credentials saved. Continue to step 7.
   - If exit 1: display the error from stderr. Stop and tell user to try again.

   After a successful save, verify `.planning/azdev-config.json` is covered by `.gitignore`:
   - Read the root `.gitignore` file.
   - Check if `azdev-config.json` is listed directly, OR if `.planning/` is ignored as a directory (either pattern covers the config file).
   - If neither pattern is present: add `azdev-config.json` to `.gitignore`.
   - If already covered: no change needed.

7. **Auto-run connection test:**
   Run `node ~/.claude/get-shit-done/bin/azdev-tools.cjs test --cwd $CWD`
   - If exit 0: Show the success message from stdout to the user (e.g., "Connected to myorg/MyProject").
   - If exit 1: Show the error message from stderr to the user. Tell user: "Run `/azdev-setup` again to reconfigure credentials."
</process>

<success_criteria>
- Config file created or updated at `.planning/azdev-config.json`
- Connection test result shown to user after saving
- PAT never echoed back in plain text (masked in re-run display, not logged when saving)
- `.gitignore` covers `azdev-config.json` to prevent PAT leakage
</success_criteria>
