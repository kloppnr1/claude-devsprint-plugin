Update the sprint context document (`sprint-context.md`) with what happened in this session. This keeps your context fresh so the next session starts with accurate information.

## What to do

1. Check if `sprint-context.md` exists in the current directory.
   - If it doesn't exist, say: "No sprint-context.md found. Run /sprint-init first to set up persistent context."
   - Stop if not found.

2. Read the current `sprint-context.md`.

3. Based on the current conversation and work done in this session, determine what has changed. Look for:
   - Tasks that were completed (move from "In progress" → "Done this sprint")
   - New tasks that were started (add to "In progress")
   - New blockers discovered (add to "Blocked")
   - Architecture decisions made (add to Architecture Decisions table)
   - New conventions established (add to Coding Conventions)
   - New project rules that emerged from feedback (add to Project Rules)
   - Important context for the next session

4. If it's unclear what changed, ask: "What should I update? You can tell me what was completed, what's now blocked, or any decisions we made today."

5. Write a session note for today using this format:
   ```
   ### [TODAY'S DATE] — Session Summary
   - Completed: [what was finished]
   - Decided: [any architectural or technical decisions]
   - Context for next time: [what's important to know at the start of the next session]
   ```
   Add this at the top of the "Session Notes" section (newest first). Remove the oldest session note if there are already 3 notes (keep max 3).

6. Update the "Last updated" date at the top of the file.

7. Write all changes to `sprint-context.md`.

8. Confirm: "✓ sprint-context.md updated. Next session will start with this context."

## Important notes

- Only update what actually changed — don't rewrite sections that are still accurate.
- Session notes should be concise (3-5 bullets max).
- If something was completed, move it from "In progress" to "Done this sprint" — don't just add it to Done.
- If a project rule was violated and corrected during this session, add it to Project Rules.
- Preserve all existing content that wasn't changed.
