Initialize a persistent sprint context for this project. This creates a `sprint-context.md` file that will be automatically loaded at the start of every Claude session, so you never have to re-explain your project again.

## What to do

1. Check if `sprint-context.md` already exists in the current directory.
   - If it does, ask: "A sprint-context.md already exists. Do you want to (a) edit it, or (b) start fresh?"
   - If starting fresh, rename the existing file to `sprint-context.md.bak` before proceeding.

2. If no file exists (or starting fresh), gather project context by asking these questions ONE AT A TIME — wait for each answer before asking the next:

   **Q1:** "What does this project do? (one sentence)"

   **Q2:** "What's your tech stack? (e.g. React, Node, Postgres, etc.)"

   **Q3:** "Describe your repo layout briefly — what's in the main folders?"

   **Q4:** "What are the most important architectural decisions you've made? Tell me about 1-3 key choices, what you chose, and why. Mention anything you tried and rejected."

   **Q5:** "What coding conventions does this project use? Things like: naming patterns, error handling approach, where tests live, style preferences."

   **Q6:** "What are you currently working on this sprint? List anything in progress, blocked, or up next."

   **Q7:** "What rules should I NEVER break in this project? These are your hard constraints — things I keep forgetting, or things that would cause real damage if I got them wrong."

3. After collecting answers, create `sprint-context.md` in the current directory by filling in the template at `~/.claude/sprint-context-template.md` with the gathered information.

4. Check if `CLAUDE.md` exists in the current directory:
   - If it doesn't exist, create it with content that imports sprint-context.md:
     ```
     @sprint-context.md
     ```
   - If it exists, check if `@sprint-context.md` is already in it. If not, add this line at the top:
     ```
     @sprint-context.md
     ```
   - If `@sprint-context.md` is already present, skip this step.

5. Confirm to the user:
   ```
   ✓ sprint-context.md created
   ✓ CLAUDE.md updated (or created) to auto-load context

   Claude will now read your project context at the start of every session.

   Keep it fresh with:
   - /sprint-update — update after a working session
   - /sprint-status — see current context summary
   - /sprint-reset — archive and start a new sprint
   ```

6. Offer to do a quick validation: read back the key points from `sprint-context.md` to confirm everything was captured correctly. Ask: "Want me to read back what I captured? (yes/no)"

## Important notes

- Do not invent or assume any project details — only use what the user tells you.
- Keep each answer concise. Sprint context should be scannable, not a novel.
- Today's date for "Last updated" is the current date.
