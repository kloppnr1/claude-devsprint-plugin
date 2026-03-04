---
phase: 3
slug: analysis
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-04
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None — smoke tests use CLI tool directly with real credentials |
| **Config file** | None |
| **Quick run command** | `node ~/.claude/get-shit-done/bin/azdo-tools.cjs get-branch-links --id {storyId} --cwd .` |
| **Full suite command** | Manual smoke test via `/gsd:azdo-analyze` skill with real credentials |
| **Estimated runtime** | ~5 seconds (API call dependent) |

---

## Sampling Rate

- **After every task commit:** Run quick run command with a test story ID
- **After every plan wave:** Run full suite command
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | REPO-01 | smoke | `node ~/.claude/get-shit-done/bin/azdo-tools.cjs get-branch-links --id {storyId}` exits 0 with JSON array | ❌ W0 | ⬜ pending |
| 03-01-02 | 01 | 1 | REPO-02 | smoke | Output of get-branch-links includes `repositoryName` and `remoteUrl` fields | ❌ W0 | ⬜ pending |
| 03-02-01 | 02 | 2 | ANAL-01 | manual | Run `/gsd:azdo-analyze` and verify stories grouped by repo | manual-only | ⬜ pending |
| 03-02-02 | 02 | 2 | ANAL-02 | smoke | `ls {target-repo}/.planning/PROJECT.md {target-repo}/.planning/ROADMAP.md` — both exist after skill run | ❌ W0 | ⬜ pending |
| 03-02-03 | 02 | 2 | ANAL-03 | manual | Run skill, select "Request changes", verify re-generation | manual-only | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `~/.claude/get-shit-done/bin/azdo-tools.cjs` — extend with `get-branch-links` command
- [ ] `~/.claude/commands/gsd/azdo-analyze.md` — new skill file

*No test framework needed — smoke tests use the CLI tool directly with real credentials*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Skill fetches stories with `--me` filter and gets branch links | ANAL-01 | Requires live Azure DevOps credentials and sprint data | Run `/gsd:azdo-analyze`, verify stories grouped by repo |
| User can reject generated PROJECT.md and trigger regeneration | ANAL-03 | Interactive approval flow | Run skill, select "Request changes", verify re-generation |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
