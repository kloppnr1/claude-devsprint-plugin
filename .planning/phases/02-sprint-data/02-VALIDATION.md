---
phase: 2
slug: sprint-data
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-04
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None — smoke tests via Node.js CLI (same as Phase 1) |
| **Config file** | None |
| **Quick run command** | `node ~/.claude/get-shit-done/bin/azdo-tools.cjs get-sprint --cwd C:/Users/sen.makj/source/repos/PlanningMe` |
| **Full suite command** | Manual smoke test via `/gsd:azdo-sprint` skill |
| **Estimated runtime** | ~5 seconds (network calls to Azure DevOps) |

---

## Sampling Rate

- **After every task commit:** Run `node ~/.claude/get-shit-done/bin/azdo-tools.cjs get-sprint --cwd $CWD`
- **After every plan wave:** Both `get-sprint` and `get-sprint-items` exit 0 with valid JSON
- **Before `/gsd:verify-work`:** `/gsd:azdo-sprint` must display readable backlog
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 2-01-01 | 01 | 1 | SPRT-01 | smoke | `node ~/.claude/get-shit-done/bin/azdo-tools.cjs get-sprint --cwd $CWD; echo "exit: $?"` | ❌ W0 | ⬜ pending |
| 2-01-02 | 01 | 1 | SPRT-01 | smoke | `node ~/.claude/get-shit-done/bin/azdo-tools.cjs get-sprint --cwd $CWD \| node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d.iterationId ? 'OK' : 'MISSING')"` | ❌ W0 | ⬜ pending |
| 2-01-03 | 01 | 1 | SPRT-02 | smoke | `node ~/.claude/get-shit-done/bin/azdo-tools.cjs get-sprint-items --cwd $CWD; echo "exit: $?"` | ❌ W0 | ⬜ pending |
| 2-01-04 | 01 | 1 | SPRT-02 | smoke | `node ~/.claude/get-shit-done/bin/azdo-tools.cjs get-sprint-items --cwd $CWD \| node -e "const a=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(a[0].title ? 'OK' : 'MISSING')"` | ❌ W0 | ⬜ pending |
| 2-02-01 | 02 | 2 | SPRT-03 | manual | Run `/gsd:azdo-sprint` and visually verify output | N/A | ⬜ pending |
| 2-02-02 | 02 | 2 | SPRT-03 | manual | Check no HTML tags in displayed text | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `~/.claude/get-shit-done/bin/azdo-tools.cjs` — extend with `get-sprint` and `get-sprint-items` commands
- [ ] `~/.claude/commands/gsd/azdo-sprint.md` — new skill file

*No test framework needed — smoke tests use CLI tool directly with real credentials.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `/gsd:azdo-sprint` displays sprint name and items readably | SPRT-03 | Visual formatting check | Run `/gsd:azdo-sprint`, verify sprint name, iteration path, and work items display without broken formatting |
| Description/AcceptanceCriteria contain no HTML tags | SPRT-03 | Output inspection | Check that `<p>`, `<br>`, `<strong>` etc. do not appear in displayed text |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
