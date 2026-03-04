# Roadmap: PlanningMe

## Overview

Four phases deliver the full workflow: stand up the API helper and verify credentials, then fetch and display the current sprint, then map repos and run AI analysis on selected tasks, and finally close the loop by pushing status updates back to Azure DevOps. Each phase delivers a coherent, independently verifiable capability before the next begins.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation** - Node.js helper script + Azure DevOps API connection with PAT auth (completed 2026-03-04)
- [x] **Phase 2: Sprint Data** - Fetch current sprint and display backlog in GSD skill (completed 2026-03-04)
- [x] **Phase 3: Analysis** - Repo mapping + task selection + AI technical breakdown (completed 2026-03-04)
- [x] **Phase 4: Status** - Push work item status updates back to Azure DevOps (completed 2026-03-04)

## Phase Details

### Phase 1: Foundation
**Goal**: User can connect to Azure DevOps and verify credentials work
**Depends on**: Nothing (first phase)
**Requirements**: API-01, API-02
**Success Criteria** (what must be TRUE):
  1. User can run a GSD skill command that prompts for organisation URL, project name, and PAT, and stores them for future use
  2. User can run a connection-test command and see a clear success or failure message confirming whether credentials are valid
  3. The `azdo-tools.cjs` helper script exists and handles all HTTP calls to the Azure DevOps REST API
**Plans:** 2/2 plans complete

Plans:
- [x] 01-01-PLAN.md — Create azdo-tools.cjs helper script (config management + HTTP client + connection test)
- [x] 01-02-PLAN.md — Create /gsd:azdo-setup and /gsd:azdo-test skill commands

### Phase 2: Sprint Data
**Goal**: User can view the current sprint backlog inside GSD
**Depends on**: Phase 1
**Requirements**: SPRT-01, SPRT-02, SPRT-03
**Success Criteria** (what must be TRUE):
  1. User can run a GSD skill command and see the active sprint name and iteration path fetched from Azure DevOps
  2. All user stories and tasks in the current sprint are listed with their title, description, acceptance criteria, and current state
  3. The backlog display is readable in a terminal context (no broken formatting)
**Plans:** 2/2 plans complete

Plans:
- [x] 02-01-PLAN.md — Extend azdo-tools.cjs with get-sprint and get-sprint-items CLI commands
- [x] 02-02-PLAN.md — Create /gsd:azdo-sprint skill command for backlog display

### Phase 3: Analysis
**Goal**: User can run /gsd:azdo-analyze to fetch assigned sprint stories, resolve target repos via branch links, and bootstrap GSD projects (PROJECT.md + ROADMAP.md) in each target repo
**Depends on**: Phase 2
**Requirements**: REPO-01, REPO-02, ANAL-01, ANAL-02, ANAL-03
**Success Criteria** (what must be TRUE):
  1. Branch links on user stories are resolved to target repos automatically (no manual repo mapping)
  2. Repo mappings are derived fresh from branch links each run (no stored state needed)
  3. User can run /gsd:azdo-analyze and see assigned stories grouped by target repo
  4. PROJECT.md and ROADMAP.md are generated in each target repo from Azure DevOps story data
  5. User can review and approve or request changes to each generated project before it is finalized
**Plans:** 2/2 plans complete

Plans:
- [x] 03-01-PLAN.md — Add get-branch-links command to azdo-tools.cjs (branch link resolution)
- [x] 03-02-PLAN.md — Create /gsd:azdo-analyze skill command (sprint-to-GSD-project pipeline)

### Phase 4: Status
**Goal**: Work item status updates happen automatically as a side effect of GSD execute-phase — tasks and stories transition through New, Active, and Resolved without manual commands
**Depends on**: Phase 3
**Requirements**: STAT-01
**Success Criteria** (what must be TRUE):
  1. User can change a work item's state (New, Active, Closed) from within a GSD skill command without opening Azure DevOps in a browser
  2. The state change is reflected in Azure DevOps immediately after the command runs
**Plans:** 2/2 plans complete

Plans:
- [ ] 04-01-PLAN.md — Add update-state and get-child-states CLI commands to azdo-tools.cjs
- [ ] 04-02-PLAN.md — Wire status updates into azdo-analyze (task map) and execute-phase (automatic transitions)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 2/2 | Complete    | 2026-03-04 |
| 2. Sprint Data | 2/2 | Complete   | 2026-03-04 |
| 3. Analysis | 2/2 | Complete   | 2026-03-04 |
| 4. Status | 2/2 | Complete   | 2026-03-04 |
