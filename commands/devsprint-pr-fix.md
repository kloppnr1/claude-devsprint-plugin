---
name: devsprint-pr-fix
description: Fix PR review comments from Azure DevOps
argument-hint: "<story-id>"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
  - Agent
  - mcp__azure-devops__ado_repo_list_pull_requests_by_repo_or_project
  - mcp__azure-devops__ado_repo_list_pull_request_threads
---

<feedback_rule>
**CRITICAL — Free-text feedback rule:**
When the user needs to provide open-ended feedback or corrections, respond with a plain-text question and STOP. Wait for their free-text reply. Do NOT use `AskUserQuestion` with multiple-choice guesses for open-ended input — that creates frustrating loops. Only use `AskUserQuestion` for structured choices (yes/no, pick from a list).
</feedback_rule>

<context_rule>
**NEVER mention context usage, context limits, or suggest starting a new session.** NEVER offer to "save findings for later" or "continue in a new session" or "take this up in a fresh session". Auto-compact handles context automatically. Just keep working.
</context_rule>

<objective>
Fetch review comments from an Azure DevOps pull request, check out the PR branch, present the issues to the user, fix them, and push the fixes.

Arguments: `<story-id>` — required. Optional: `--pr-id <id> --repo-name <name>` to skip PR lookup.
Example: `/devsprint-pr-fix 42917`
Example with direct PR: `/devsprint-pr-fix 42917 --pr-id 4225 --repo-name NewSettlement.CustomerSupport`
</objective>

<execution_context>
Azure DevOps access: via MCP tools (mcp__azure-devops__ado_*)
Local helper (status reporting only): ~/.claude/bin/devsprint-tools.cjs
$CWD is the project directory where .planning/ lives.
</execution_context>

<context>
MCP tool contracts used by this command:

  mcp__azure-devops__ado_repo_list_pull_requests_by_repo_or_project
    -> Lists pull requests in a project
    -> Filter results client-side: find PRs whose title starts with "#{storyId}"
    -> Pick the most recent active PR
    -> Extract: prId, title, description, status, sourceBranch, targetBranch, createdBy, repoName, url, workItemIds

  mcp__azure-devops__ado_repo_list_pull_request_threads
    -> Fetches comment threads on a PR (requires repository name and PR ID)
    -> Filter threads client-side by status to get unresolved/active ones
    -> Each thread has: threadId, status, comments (author, content, publishedDate), filePath, lineNumber
    -> filePath and lineNumber are only present for file-level comments

Local helper (kept for file I/O only):
  node ~/.claude/bin/devsprint-tools.cjs report-status --command pr-fix --story-id {storyId} --story-title "{storyTitle}" --step "<step>" --detail "<detail>" --cwd $CWD
  node ~/.claude/bin/devsprint-tools.cjs clear-status --story-id {storyId} --cwd $CWD
</context>

<dashboard_status>
Report progress to the dashboard at EVERY major step by running:
`node ~/.claude/bin/devsprint-tools.cjs report-status --command pr-fix --story-id {storyId} --story-title "{storyTitle}" --step "<step>" --detail "<detail>" --cwd $CWD`

Steps to report: "Finding PR", "Fetching comments", "Checking out branch", "Running baseline tests", "Implementing fix", "Running tests", "Pushing fixes", "Done"

At the end (success or failure), clear status:
`node ~/.claude/bin/devsprint-tools.cjs clear-status --story-id {storyId} --cwd $CWD`
</dashboard_status>

<process>

**Step 1 — Parse arguments:**

Extract from the arguments:
- First argument: `storyId` (numeric, with or without `#` prefix) — required
- `--pr-id <id>`: PR ID (optional, skips find-pr step)
- `--repo-name <name>`: Repository name (optional, required with --pr-id)

If storyId is missing, display usage: "Usage: `/devsprint-pr-fix <story-id>`" and stop.

**Step 1.5 — Concurrency guard (per-story lock):**

Only one run (plan, execute, or PR-fix) may be active for a given story at a time. Before proceeding, check the agent status file:

```bash
cat "$CWD/.planning/devsprint-agent-status.json" 2>/dev/null
```

If the file exists and has an `active` object (not null), check:
- If `active.stories` contains a key matching the `storyId`, OR
- If `active.storyId` matches the `storyId`

Then **abort immediately** with this message:
> "Story #{storyId} already has an active run (step: {active.stories[storyId].step}). Wait for it to finish before starting another."

If the agent status has no `active` entry, or the story is not in it, proceed normally.

**Step 2 — (No prerequisites needed — MCP handles Azure DevOps auth automatically.)**

**Step 3 — Find PR by story ID:**

If `--pr-id` and `--repo-name` were provided, skip the PR lookup and use those values directly. Still call the MCP tool to get `sourceBranch` and `targetBranch`:

Call `mcp__azure-devops__ado_repo_list_pull_requests_by_repo_or_project` with project "Verdo Agile Development" to find PRs matching story #{storyId}. Filter the results to find PRs whose title starts with "#{storyId}". Pick the most recent active PR.

If no matching PR is found and no --pr-id was provided: show error. The story may not have a PR yet. Stop.

Parse the result. Store `prId`, `repoName`, `sourceBranch`, `targetBranch`. Display:
```
=== PR #{prId}: {title} ===
Status: {status}
Branch: {sourceBranch} -> {targetBranch}
Repo: {repoName}
URL: {url}
Linked stories: {workItemIds or "none"}
```

If status is "completed" or "abandoned": display "PR #{prId} is {status} — skipping." and stop. No prompt needed.

**Step 4 — Fetch PR comment threads:**

Call `mcp__azure-devops__ado_repo_list_pull_request_threads` with the repository name `{repoName}` and PR ID `{prId}`. Filter the returned threads by status to get only unresolved/active ones.

Parse the result. Extract `threads` array from the response.

If no active threads: display "No unresolved review comments on this PR. Nothing to fix." Stop.

**Step 5 — Present issues to user:**

Group comments by type:
- **File comments** (have `filePath`): group by file path
- **General comments** (no `filePath`): list separately

Display:
```
=== Active Review Comments ({count}) ===

File: {filePath}
  Line {lineNumber}: {first comment content (truncated to ~200 chars)}
    -> {reply comments if any}

File: {filePath2}
  Line {lineNumber}: {comment}

General:
  {comment content}
```

Default: fix all unresolved comments. Display the comments (so the user sees them) and proceed directly to Step 6. No prompt needed.

**Step 6 — Resolve local repo path and check out PR branch:**

1. Scan the parent directory of `$CWD` for a folder matching `repoName`:
   `test -d "{parentDir}/{repoName}/.git"`
   If not found: ask user for local path.

2. Navigate to the repo and check out the PR source branch:
   ```
   cd {repoPath}
   git fetch origin {sourceBranch}
   git checkout {sourceBranch}
   git pull origin {sourceBranch}
   ```

3. Run the full test suite to establish baseline (Step 4b.1 from devsprint-execute):
   - Detect and run all test commands (dotnet test, npm test, etc.)
   - If tests fail: warn user "Existing tests fail on {sourceBranch}." but continue — these are PR fixes, not new work.

**Step 7 — Fix the issues:**

For each selected comment thread:

1. **If file comment**: Read the file at `filePath`. Go to the area around `lineNumber`. Understand the reviewer's concern from the comment content.

2. **If general comment**: Understand what needs to change from the comment content.

3. **Implement the fix**:
   - Read the relevant file(s).
   - Make the minimum change needed to address the review comment.
   - Do NOT refactor surrounding code or make unrelated changes.

4. **Run tests** after each fix to confirm nothing breaks.

5. **Commit the fix** with a message like: `fix: {brief description of what was fixed} (PR review)`

**Step 8 — Final test run:**

Run the full test suite one final time after all fixes are applied.
- If tests pass: proceed to push.
- If tests fail: attempt to fix the failing tests. If they still fail after a second attempt: abort push, display "Tests still failing — push aborted. Fix manually." and stop. No prompt needed.

**Step 9 — Push fixes:**

Run: `git push origin {sourceBranch}`

Display:
```
=== PR Fix Complete ===

PR: #{prId} — {title}
Branch: {sourceBranch}
Fixes pushed: {count} commits

Comments addressed:
  {for each fixed thread:}
  - {filePath}:{lineNumber} — {brief description of fix}
  {end for}

PR URL: {url}

Next steps:
  Review the fixes in Azure DevOps and resolve the comment threads.
```

</process>

<error_handling>

- No PR found for story: "No PR found for story #{storyId}. The PR title should start with '#{storyId}'."
- No unresolved comments: "No unresolved review comments. Nothing to fix."
- Branch checkout fails: try `git stash` first, then retry. If still failing, show error.
- File from comment not found locally: warn "File {filePath} from review comment not found in repo. It may have been deleted or renamed." Skip that comment.
- Test failures after fix: warn user, ask whether to continue or stop.

</error_handling>

<success_criteria>
- `/devsprint-pr-fix 42917` finds the PR by story ID and fetches unresolved comments
- User sees all unresolved review comments grouped by file
- User can fix all or select specific comments
- PR branch is checked out and tests verified before changes
- Each fix is committed separately with descriptive message
- Full test suite runs after all fixes
- Fixes are pushed to the PR branch
- Clear summary of what was fixed
</success_criteria>
