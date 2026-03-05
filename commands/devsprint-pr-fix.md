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
---

<objective>
Fetch review comments from an Azure DevOps pull request, check out the PR branch, present the issues to the user, fix them, and push the fixes.

Arguments: `<story-id>` — required. The PR and repository are auto-detected by searching for a PR whose title starts with `#{storyId}`.
Example: `/devsprint-pr-fix 42917`
</objective>

<execution_context>
Helper: ~/.claude/bin/devsprint-tools.cjs
Config file: .planning/devsprint-config.json
$CWD is the project directory where .planning/ lives.
</execution_context>

<context>
devsprint-tools.cjs CLI contracts used by this command:

  node ~/.claude/bin/devsprint-tools.cjs load-config --cwd $CWD
    -> stdout: JSON {"org":"...","project":"...","pat":"<raw-decoded>"}

  node ~/.claude/bin/devsprint-tools.cjs find-pr --story-id <id> --cwd $CWD
    -> Searches all repos for a PR whose title starts with "#{storyId}"
    -> Returns the most recent matching PR (active PRs preferred over completed)
    -> stdout: JSON {"prId":N,"title":"...","description":"...","status":"...","sourceBranch":"...","targetBranch":"...","createdBy":"...","repoName":"...","url":"...","workItemIds":[...]}

  node ~/.claude/bin/devsprint-tools.cjs get-pr-threads --pr-id <id> --repo-name <name> [--active-only] --cwd $CWD
    -> Fetches comment threads on a PR (repo-name required here, obtained from find-pr)
    -> stdout: JSON {"repoName":"...","threads":[{"threadId":N,"status":"active|fixed|closed|...","comments":[{"author":"...","content":"...","publishedDate":"..."}],"filePath":"/src/...", "lineNumber":N}]}
    -> filePath and lineNumber are only present for file-level comments
    -> --active-only: filter to threads with status "active"
</context>

<process>

**Step 1 — Parse arguments:**

Extract `storyId` from the arguments.
- First argument: Story ID (numeric, with or without `#` prefix)

If missing, display usage: "Usage: `/devsprint-pr-fix <story-id>`" and stop.

**Step 2 — Check prerequisites:**

1. Verify `~/.claude/bin/devsprint-tools.cjs` exists.
2. Run `load-config` to verify Azure DevOps connection.

**Step 3 — Find PR by story ID:**

Run: `node ~/.claude/bin/devsprint-tools.cjs find-pr --story-id {storyId} --cwd $CWD`

If exit 1: show error. The story may not have a PR yet. Stop.

Parse the JSON. Store `prId`, `repoName`, `sourceBranch`, `targetBranch`. Display:
```
=== PR #{prId}: {title} ===
Status: {status}
Branch: {sourceBranch} -> {targetBranch}
Repo: {repoName}
URL: {url}
Linked stories: {workItemIds or "none"}
```

If status is "completed" or "abandoned": warn "PR is already {status}. Continue anyway?" Use AskUserQuestion. If no, stop.

**Step 4 — Fetch PR comment threads:**

Run: `node ~/.claude/bin/devsprint-tools.cjs get-pr-threads --pr-id {prId} --repo-name {repoName} --active-only --cwd $CWD`

Parse the JSON. Extract `threads` array from the response.

If no active threads: display "No active review comments on this PR. Nothing to fix." Stop.

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

Use `AskUserQuestion`:
- Question: "Fix all active comments, or select specific ones?"
- Options: "Fix all" / "Let me select"

If "Let me select": present each comment and let user include/exclude. Store the selected thread IDs.
If "Fix all": use all active threads.

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
- If tests fail: warn user and ask whether to push anyway or fix first.

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
- No active comments: "No active review comments. Nothing to fix."
- Branch checkout fails: try `git stash` first, then retry. If still failing, show error.
- File from comment not found locally: warn "File {filePath} from review comment not found in repo. It may have been deleted or renamed." Skip that comment.
- Test failures after fix: warn user, ask whether to continue or stop.

</error_handling>

<success_criteria>
- `/devsprint-pr-fix 42917` finds the PR by story ID and fetches active comments
- User sees all active review comments grouped by file
- User can fix all or select specific comments
- PR branch is checked out and tests verified before changes
- Each fix is committed separately with descriptive message
- Full test suite runs after all fixes
- Fixes are pushed to the PR branch
- Clear summary of what was fixed
</success_criteria>
