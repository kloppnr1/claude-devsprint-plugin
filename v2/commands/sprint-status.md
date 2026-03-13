Show a formatted summary of the current sprint context — what's in progress, what's blocked, what's coming up, and any active project rules.

## What to do

1. Check if `sprint-context.md` exists in the current directory.
   - If it doesn't exist, say: "No sprint-context.md found. Run /sprint-init to set up persistent context."
   - Stop if not found.

2. Read `sprint-context.md`.

3. Output a formatted status summary:

```
## Sprint Status: [PROJECT NAME]
Last updated: [DATE]

### In Progress
[list items, or "Nothing in progress"]

### Blocked
[list items with reason, or "Nothing blocked"]

### Up Next
[list items, or "Queue is empty"]

### Done This Sprint
[list last 3-5 items, or "Nothing completed yet"]

### Active Rules
[list project rules, or "No rules defined"]

---
Run /sprint-update to sync after your session.
```

4. If `sprint-context.md` hasn't been updated in more than 7 days, add a warning:
   ```
   ⚠️  Context last updated [N] days ago — may be stale. Run /sprint-update to refresh.
   ```

## Important notes

- Keep the output scannable — this is a quick reference, not a full document.
- Don't include Architecture Decisions or Coding Conventions in the status output — those are reference material, not daily-use info.
