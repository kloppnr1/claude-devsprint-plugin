---
phase: 04
slug: status
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-04
---

# Phase 04 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None — smoke tests via CLI tool with real credentials (same pattern as Phase 3) |
| **Config file** | None |
| **Quick run command** | `node ~/.claude/get-shit-done/bin/azdev-tools.cjs update-state --id {testItemId} --state Active --cwd .` |
| **Full suite command** | Manual smoke test — run execute-phase on a test story and verify DevOps state changes |
| **Estimated runtime** | ~5 seconds per API call |

---

## Sampling Rate

- **After every task commit:** Run quick command — verify `update-state` exits 0
- **After every plan wave:** Manual check — verify story state in Azure DevOps UI
- **Before `/gsd:verify-work`:** Full manual smoke test
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | STAT-01 | smoke | `node ~/.claude/get-shit-done/bin/azdev-tools.cjs update-state --id {id} --state Active --cwd .` | ❌ W0 | ⬜ pending |
| 04-01-02 | 01 | 1 | STAT-01 | smoke | `node ~/.claude/get-shit-done/bin/azdev-tools.cjs update-state --id {id} --state Resolved --cwd .` | ❌ W0 | ⬜ pending |
| 04-01-03 | 01 | 1 | STAT-01 | smoke | `node ~/.claude/get-shit-done/bin/azdev-tools.cjs get-child-states --id {storyId} --cwd .` | ❌ W0 | ⬜ pending |
| 04-02-01 | 02 | 2 | STAT-01 | manual | Run execute-phase with test story, verify state in DevOps | manual-only | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `azdev-tools.cjs` — add `update-state` command (STAT-01 task state updates)
- [ ] `azdev-tools.cjs` — add `get-child-states` command (STAT-01 sibling check)
- [ ] `.planning/azdev-task-map.json` schema — defined by azdev-analyze.md modification

*No test framework needed — same pattern as Phase 3 (smoke tests via CLI with real credentials)*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Story resolves when all children resolved | STAT-01 | Requires real multi-task story in DevOps sprint | Run execute-phase on a story with multiple tasks, verify story state changes in DevOps UI |
| Notification when non-code tasks remain open | STAT-01 | Requires real story with mixed task types | Execute story with code + manual tasks, verify notification text appears |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
