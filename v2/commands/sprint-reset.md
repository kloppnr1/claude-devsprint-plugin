Archive the current sprint context and start fresh for a new sprint. This preserves your architecture decisions and project rules while clearing the sprint-specific work items.

## What to do

1. Check if `sprint-context.md` exists in the current directory.
   - If it doesn't exist, say: "No sprint-context.md found. Run /sprint-init to set up persistent context."
   - Stop if not found.

2. Read the current `sprint-context.md`.

3. Ask for confirmation:
   ```
   This will:
   ✓ Archive current sprint-context.md → sprint-context.archive-[DATE].md
   ✓ Keep: Project Overview, Architecture Decisions, Coding Conventions, Project Rules
   ✓ Clear: Active Sprint (In Progress, Blocked, Up Next, Done), Session Notes

   Ready to start the new sprint? (yes/no)
   ```

4. If confirmed:
   a. Copy the current `sprint-context.md` to `sprint-context.archive-[TODAY'S DATE].md` (e.g., `sprint-context.archive-2026-03-15.md`)
   b. Ask: "What's the goal for this new sprint? (one sentence, or press Enter to skip)"
   c. Create a new `sprint-context.md` that preserves:
      - Project Overview (unchanged)
      - Architecture Decisions (unchanged)
      - Coding Conventions (unchanged)
      - Project Rules (unchanged)
   d. Reset these sections to empty/placeholder state:
      - Active Sprint: set the sprint goal to the answer from step (b), clear all lists
      - Session Notes: clear all entries
   e. Update "Last updated" to today's date.

5. Confirm:
   ```
   ✓ Archived to sprint-context.archive-[DATE].md
   ✓ New sprint-context.md ready with goal: "[SPRINT GOAL]"

   Your architecture decisions and project rules carried forward.
   Use /sprint-init to review the preserved context.
   ```

## Important notes

- Never delete the archive file — it's a record of what was done.
- Don't clear Architecture Decisions or Project Rules — these are permanent project knowledge.
- Session Notes are always cleared on reset — they're session-specific, not sprint-specific.
- If the user says "no" to confirmation, do nothing and say: "Reset cancelled. sprint-context.md unchanged."
