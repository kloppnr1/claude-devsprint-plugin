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
- [ ] **Phase 3: Analysis** - Repo mapping + task selection + AI technical breakdown
- [ ] **Phase 4: Status** - Push work item status updates back to Azure DevOps

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
**Goal**: User can select a sprint task, map it to a local repo, and receive an AI technical breakdown
**Depends on**: Phase 2
**Requirements**: REPO-01, REPO-02, ANAL-01, ANAL-02, ANAL-03
**Success Criteria** (what must be TRUE):
  1. When a task belongs to a DevOps project seen for the first time, the skill asks the user for the local repo path and stores the mapping
  2. For subsequent tasks in the same project, no prompt appears — the stored mapping is used automatically
  3. User can select a task from the sprint backlog and trigger AI analysis on it
  4. AI produces a technical breakdown containing subtasks, implementation approach, and identified risks
  5. User can review the breakdown and either approve it or request changes before it is finalised
**Plans**: TBD

Plans:
(TBD — populated during plan-phase)

### Phase 4: Status
**Goal**: User can update work item status in Azure DevOps directly from GSD
**Depends on**: Phase 3
**Requirements**: STAT-01
**Success Criteria** (what must be TRUE):
  1. User can change a work item's state (New, Active, Closed) from within a GSD skill command without opening Azure DevOps in a browser
  2. The state change is reflected in Azure DevOps immediately after the command runs
**Plans**: TBD

Plans:
(TBD — populated during plan-phase)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 2/2 | Complete    | 2026-03-04 |
| 2. Sprint Data | 2/2 | Complete   | 2026-03-04 |
| 3. Analysis | 0/TBD | Not started | - |
| 4. Status | 0/TBD | Not started | - |
