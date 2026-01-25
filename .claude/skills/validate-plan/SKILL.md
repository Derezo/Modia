---
name: validate-plan
description: Use this skill when the user wants to validate completed work against a plan, perform code review, analyze gaps, update the roadmap, and commit changes. Trigger on phrases like "validate plan", "review changes", "check implementation", "gap analysis", or "finalize and commit".
version: 3.0.0
---

# Plan Validation and Code Review Skill v3.0

This skill performs comprehensive validation of completed implementation work using a parallel subagent architecture for thorough review.

## Architecture Overview

**Three-Phase Parallel Execution:**

```
Phase 1: Pre-Analysis (Parallel)
├── File Analyzer       → file_inventory
├── Lint Runner         → lint_results
├── Test Runner         → test_results
└── Plan Parser         → plan_context

Phase 2: Deep Analysis (Parallel)
├── code-reviewer       → code_review (always)
├── debt-detector       → debt_analysis (always)
├── qa-expert          → coverage_analysis (always)
├── security-auditor   → security_review (conditional)
├── architect-reviewer → arch_review (conditional)
└── documentation-checker → doc_sync (conditional)

Phase 3: Synthesis (Sequential)
├── Collect all findings
├── Deduplicate issues
├── Classify severity
├── Generate report
└── Commit or block
```

---

## Phase 1: Pre-Analysis (Run in Parallel)

Launch 4 parallel tasks to gather baseline information before deep analysis.

### Task 1.1: File Analyzer

```
Analyze changed files:
1. Run `git status` to see all modified/added/deleted files
2. Run `git diff --stat` for change statistics
3. Count lines in modified .js files: `wc -l`
4. Check file sizes against thresholds
5. Identify affected systems (battle, economy, auth, etc.)

Output: file_inventory
- files_modified: [list]
- files_added: [list]
- files_deleted: [list]
- lines_added: N
- lines_deleted: N
- file_sizes: { path: lines }
- size_violations: [BLOCKERS/WARNINGS]
- affected_systems: [battle, economy, ...]
```

### Task 1.2: Lint Runner

```
Execute linting:
1. Run `npm run lint`
2. Capture errors vs warnings
3. Categorize by type (import, style, security)
4. Check specifically for @shared violations in API

Output: lint_results
- errors: [list with file:line]
- warnings: [list with file:line]
- shared_violations: [list] (BLOCKER if any)
- passed: boolean
```

### Task 1.3: Test Runner

```
Execute tests:
1. Run `npm run test`
2. Capture pass/fail counts
3. List failing tests with error messages
4. Note skipped tests

Output: test_results
- total: N
- passed: N
- failed: N
- failures: [{ test, file, error }]
- skipped: N
- passed: boolean
```

### Task 1.4: Plan Parser

```
Load and parse plan:
1. Read active plan from /home/wizard/.claude/plans/ (most recent .md)
2. Extract phases and tasks
3. Extract success criteria
4. Extract files to be created/modified
5. Extract implementation order

Output: plan_context
- plan_file: path
- phases: [{ name, tasks, status }]
- success_criteria: [list]
- expected_files: [list]
- implementation_order: [list]
```

### Phase 1 Gate

**STOP if any Phase 1 BLOCKERS:**

| Blocker | Action |
|---------|--------|
| File > 3500 lines | Report, halt validation |
| `@shared` in API | Report, halt validation |
| Lint errors (not warnings) | Report, halt validation |
| Test failures | Report, continue to Phase 2 with warning |

---

## Phase 2: Deep Analysis (Run in Parallel)

Launch domain-specialized subagents. Always run 3 core agents; conditionally run additional agents based on affected systems.

### Always Invoked

#### 2.1: code-reviewer

```
Task tool with subagent_type: code-reviewer

Prompt:
Review the following changed files with structured checklists:
- [list files from file_inventory]

Context:
- Plan: [plan_context summary]
- Lint status: [lint_results summary]
- Test status: [test_results summary]

REQUIREMENTS:
1. Complete Security Checklist with YES/NO answers
2. Complete Memory Safety Checklist with YES/NO answers
3. Complete Pattern Conformance Checklist
4. Complete domain-specific Edge Case Checklists
5. Classify all findings by severity

Reference: docs/ESTABLISHED_PATTERNS.md
```

#### 2.2: debt-detector

```
Task tool with subagent_type: debt-detector

Prompt:
Analyze the following changed files for technical debt:
- [list files from file_inventory]

Check for:
1. Pattern conformance violations (reference: docs/ESTABLISHED_PATTERNS.md)
2. Coupling violations (services importing other services)
3. Architecture drift (code not in expected locations)
4. YAGNI violations (unnecessary abstractions)
5. Duplicated logic across files

Report: blockers, critical, warnings, info
```

#### 2.3: qa-expert

```
Task tool with subagent_type: qa-expert

Prompt:
Analyze test coverage for the following changes:
- [list files from file_inventory]
- Affected systems: [affected_systems]

REQUIREMENTS (BLOCKING):
1. New API endpoints MUST have integration tests
2. New service functions MUST have unit tests
3. Battle formula changes MUST have balance tests
4. Economy changes MUST have balance tests
5. Bug fixes MUST have regression tests

Complete edge case checklists for affected domains.
Report missing tests as BLOCKERS.
```

### Conditionally Invoked

#### 2.4: security-auditor (if auth/economy/transaction code touched)

```
Trigger when affected_systems includes: auth, economy, marketplace, inventory

Task tool with subagent_type: security-auditor

Prompt:
Security audit for changes in:
- [list security-relevant files]

Focus on:
- SQL injection vectors
- Authentication bypasses
- Authorization checks
- Transaction integrity
- Rate limiting gaps
- Input validation

Report all findings with severity.
```

#### 2.5: architect-reviewer (if significant structural changes)

```
Trigger when:
- New services created
- New routes created
- Major refactors (>500 lines changed)
- Shared module changes

Task tool with subagent_type: architect-reviewer

Prompt:
Architecture review for:
- [list structural changes]

Evaluate:
- System design consistency
- Scalability implications
- Pattern conformance
- Breaking changes to APIs

Reference: docs/TECHNICAL_ARCHITECTURE.md
```

#### 2.6: documentation-checker (if API/schema/formula changes)

```
Trigger when:
- API routes modified
- Database migrations added
- Battle formulas changed
- Economy logic changed
- New scenes created

Task tool with subagent_type: documentation-checker

Prompt:
Check documentation sync for:
- [list code changes]

Mapping rules:
- New endpoint → API_SPECIFICATION.md
- New migration → TECHNICAL_ARCHITECTURE.md
- Battle change → BATTLE_TURN_SYSTEM.md
- Economy change → ECONOMY_SYSTEM.md
- New scene → GAME_DESIGN.md

Report undocumented changes as CRITICAL.
```

---

## Phase 3: Synthesis

Collect all findings and generate unified report.

### Step 3.1: Collect Findings

Gather results from all Phase 2 agents:
- code_review findings
- debt_analysis findings
- coverage_analysis findings
- security_review findings (if run)
- arch_review findings (if run)
- doc_sync findings (if run)

### Step 3.2: Deduplicate

Remove overlapping issues found by multiple agents:
- Same file:line reported twice → keep highest severity
- Similar issues → consolidate with all sources noted

### Step 3.3: Classify Severity

Apply unified severity classification:

#### BLOCKER (Cannot Proceed)

- File size > 3500 lines
- `@shared` imports in API code
- SQL injection patterns detected
- Authentication bypass patterns
- Missing auth middleware on protected routes
- Import violations causing runtime errors
- Lint errors (not warnings)
- Critical test failures

#### CRITICAL (Strong Warning, Should Fix)

- No tests for new business logic
- Missing error handling for external calls
- Undocumented public API changes
- Breaking changes to shared modules
- Cyclomatic complexity > 20
- Security issues (non-critical)
- Memory leaks (missing cleanup)

#### WARNING (Flag in Report)

- Documentation out of sync
- Missing JSDoc on exports
- File size 1500-3499 lines without module summary
- Complexity > 15
- Pattern conformance violations
- Edge cases not covered

#### INFO (Note for Reference)

- Minor code style inconsistencies
- Suggestions for improvement
- Optional optimizations

### Step 3.4: Generate Report

```markdown
# Plan Validation Report v3.0

## Executive Summary
**Verdict:** BLOCKED / PASSED WITH CONCERNS / PASSED
**Files Changed:** N (A added, M modified, D deleted)
**Lines Changed:** +X, -Y
**Subagents Run:** N

## Phase 1: Pre-Analysis

### File Inventory
| File | Lines | Status |
|------|-------|--------|
| path/file.js | 450 | OK |
| path/big.js | 2,800 | WARNING |

### Lint Results
- Errors: 0
- Warnings: 3
- @shared violations: 0

### Test Results
- Passed: 145
- Failed: 0
- Skipped: 2

## Phase 2: Deep Analysis

### BLOCKERS (Must Fix)

1. **[SECURITY]** `api/src/routes/battle.js:45`
   - Source: code-reviewer, security-auditor
   - Issue: Unparameterized query with user input
   - Fix: Use parameterized syntax `$1`

### CRITICAL (Should Fix)

1. **[COVERAGE]** `POST /api/coliseum/challenge`
   - Source: qa-expert
   - Issue: New endpoint without integration test
   - Fix: Add test to coliseum.integration.test.js

2. **[DOCUMENTATION]** New endpoint undocumented
   - Source: documentation-checker
   - Issue: /api/coliseum/challenge not in API_SPECIFICATION.md
   - Fix: Add endpoint documentation

### WARNINGS

1. **[DEBT]** Duplicated validation logic
   - Source: debt-detector
   - Files: auth.js:23, characters.js:45
   - Recommendation: Extract to shared validation module

2. **[EDGE CASE]** Battle: target dies mid-action not tested
   - Source: qa-expert
   - Recommendation: Add overkill damage test

## Checklists Summary

### Security (code-reviewer)
| Item | Status |
|------|--------|
| Queries parameterized | YES |
| Input validation | YES |
| Auth middleware | YES |
| No secrets in code | YES |

### Test Coverage (qa-expert)
| Requirement | Status |
|-------------|--------|
| New endpoints tested | NO (BLOCKER) |
| Service functions tested | YES |
| Battle formulas tested | N/A |

### Pattern Conformance (debt-detector)
| Pattern | Status |
|---------|--------|
| Routes to services | YES |
| @shared usage | YES |
| Import patterns | YES |

## Gap Analysis

### Fully Completed
- [x] Phase 1: Initial setup
- [x] Phase 2: Core implementation

### Partially Completed
- [~] Phase 3: Polish
  - Done: Basic UI
  - Remaining: Animations

### Not Started
- [ ] Phase 4: Testing

## Metrics

| Metric | Value |
|--------|-------|
| Files analyzed | 12 |
| Total issues | 8 |
| Blockers | 1 |
| Critical | 2 |
| Warnings | 3 |
| Info | 2 |
| New tests required | 2 |

## Verdict

**BLOCKED** - 1 blocker must be resolved before commit:
1. Missing integration test for new endpoint

### Next Actions
1. Add integration test for /api/coliseum/challenge
2. Update API_SPECIFICATION.md with new endpoint
3. Review duplicated validation logic for extraction
```

### Step 3.5: Commit or Block

**If BLOCKERS exist:**
- Output full report
- List specific blockers
- Provide fix instructions
- DO NOT COMMIT

**If no BLOCKERS:**
- Proceed to commit
- Include metrics in commit message
- Update roadmap
- Archive completed items

---

## Commit Message Format

```
feat: [Phase Name] - [Brief Summary]

Implemented:
- [Feature 1]
- [Feature 2]
- [Feature 3]

Tests added:
- [test file]: [what it tests]

Files changed:
- [file1.js] - [brief description]
- [file2.js] - [brief description]

Validation Report (v3.0):
- Subagents run: 5 (code-reviewer, debt-detector, qa-expert, security-auditor, documentation-checker)
- Issues found: 3 warnings (resolved), 0 critical, 0 blockers
- Test coverage: All new endpoints tested
- File sizes: All under threshold

Gap analysis:
- Completed: X items
- Remaining: Y items

Next priority:
- [Next task 1]
- [Next task 2]

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
```

---

## Subagent Reference

| Subagent | Always? | Focus |
|----------|---------|-------|
| `code-reviewer` | Yes | Structured checklists, security, patterns |
| `debt-detector` | Yes | Technical debt, pattern conformance |
| `qa-expert` | Yes | Test coverage, edge cases |
| `security-auditor` | Conditional | Auth/economy/transaction security |
| `architect-reviewer` | Conditional | Structural changes, system design |
| `documentation-checker` | Conditional | Doc sync, API documentation |

---

## Quality Gates Summary

### BLOCKER Thresholds

| Check | Threshold |
|-------|-----------|
| File size | > 3500 lines |
| @shared imports in API | Any |
| Lint errors | Any (warnings OK) |
| SQL injection | Any pattern detected |
| Missing auth middleware | Protected routes |
| Missing endpoint tests | New API endpoints |
| Import violations | Runtime errors |

### CRITICAL Thresholds

| Check | Threshold |
|-------|-----------|
| No tests for business logic | New service functions |
| Missing error handling | External calls |
| Undocumented API changes | Breaking changes |
| Cyclomatic complexity | > 20 |
| Memory leaks | Unreleased resources |

### WARNING Thresholds

| Check | Threshold |
|-------|-----------|
| File size | 1500-3499 lines |
| Missing module summary | Files > 1500 lines |
| Complexity | > 15 |
| Documentation sync | Out of date |
| Edge cases | Not covered |

---

## Important Notes

- **Always run Phase 1 first** - blockers here prevent Phase 2
- **Run Phase 2 agents in parallel** - use Task tool with multiple calls
- **Wait for all Phase 2 results** before synthesis
- **Never commit with BLOCKERS** - fix them first
- **Keep roadmap fresh** - remove completed items
- **Document completion** - update relevant docs
- **Implement tests** - don't just suggest them
- **Verify module loading** - `timeout 10 npm run dev:api`
- **Check @shared imports** - recurring issue, always verify
