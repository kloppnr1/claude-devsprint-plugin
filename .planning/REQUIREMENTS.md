# Requirements: PlanningMe

**Defined:** 2026-03-04
**Core Value:** Seamlessly bridge Azure DevOps sprint tasks into GSD's planning and execution engine

## v1 Requirements

### API Connection

- [x] **API-01**: User can configure Azure DevOps connection with organisation URL, project name, and PAT
- [x] **API-02**: User can validate that the connection works and credentials are correct

### Sprint Data

- [ ] **SPRT-01**: System can fetch the current active sprint iteration from Azure DevOps
- [ ] **SPRT-02**: System can fetch all user stories and tasks from the current sprint
- [ ] **SPRT-03**: User can view sprint backlog with title, description, acceptance criteria, and state

### Task Analysis

- [ ] **ANAL-01**: User can select a task from the sprint backlog for AI analysis
- [ ] **ANAL-02**: AI analyzes the selected task and produces a technical breakdown (subtasks, approach, risks)
- [ ] **ANAL-03**: User can review the analysis result and approve or request changes

### Repo Mapping

- [ ] **REPO-01**: System asks user for local repo path when encountering a new DevOps project
- [ ] **REPO-02**: System remembers repo mappings for subsequent sessions

### Status

- [ ] **STAT-01**: System can update work item status in Azure DevOps (New → Active → Closed)

## v2 Requirements

### Code Execution

- **EXEC-01**: AI writes code based on the approved analysis
- **EXEC-02**: AI creates a pull request in Azure DevOps with the finished code
- **EXEC-03**: AI updates work item with link to PR

### Multi-task

- **MULTI-01**: User can select multiple tasks and have them analyzed in batch
- **MULTI-02**: AI suggests optimal execution order based on dependencies

## Out of Scope

| Feature | Reason |
|---------|--------|
| Web UI / standalone app | Pure GSD skills, no separate interface |
| MCP server | All DevOps interaction via helper scripts within skills |
| Multi-user support | Personal tool for one developer |
| Cross-repo tasks | Each task maps to exactly one repo |
| OAuth / service principal auth | PAT is sufficient for personal use |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| API-01 | Phase 1 | Complete |
| API-02 | Phase 1 | Complete |
| SPRT-01 | Phase 2 | Pending |
| SPRT-02 | Phase 2 | Pending |
| SPRT-03 | Phase 2 | Pending |
| ANAL-01 | Phase 3 | Pending |
| ANAL-02 | Phase 3 | Pending |
| ANAL-03 | Phase 3 | Pending |
| REPO-01 | Phase 3 | Pending |
| REPO-02 | Phase 3 | Pending |
| STAT-01 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 11 total
- Mapped to phases: 11
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-04*
*Last updated: 2026-03-04 after roadmap creation*
