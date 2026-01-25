---
name: validate-plan
description: Use this skill when the user wants to validate completed work against a plan, perform code review, analyze gaps, remediate issues, and commit changes. Trigger on phrases like "validate plan", "review changes", "check implementation", "gap analysis", or "finalize and commit".
version: 4.0.0
---

# Plan Validation and Code Review Skill v4.0

This skill performs comprehensive validation of completed implementation work using a parallel subagent architecture for thorough review, **then remediates all issues before committing**.

## Core Principle: Remediation-First

**This skill does NOT just report issues—it FIXES them.**

- Blockers and critical issues → Dispatch subagents to fix
- Ambiguous intent → Ask user for clarification via AskUserQuestion
- Held-back plan items → Implement or explicitly defer with user approval
- All remediations verified → Commit automatically

## Architecture Overview

**Four-Phase Execution:**

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

Phase 3: Remediation Execution (Sequential)
├── Create TodoWrite tasks for all issues
├── For BLOCKERS: Dispatch subagent → Verify fix
├── For CRITICAL: Dispatch subagent → Verify fix
├── For held-back items: AskUserQuestion → Implement or defer
├── For ambiguous issues: AskUserQuestion → Resolve
└── Gate: All issues remediated OR user-approved deferral

Phase 4: Synthesis & Commit (Sequential)
├── Collect remediation results
├── Generate final report
├── Update roadmap
├── Archive completed items
└── Commit (unconditional after Phase 3 passes)
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

## Phase 3: Remediation Execution

**This is the core differentiator of v4.0.** Instead of generating a report with "Next Actions" for the user, this phase actively fixes issues.

### Step 3.1: Create Remediation Task List

After Phase 2 completes, create TodoWrite tasks for all findings:

```javascript
// For each BLOCKER issue
TaskCreate({
  subject: "[BLOCKER] Fix SQL injection in battle.js:45",
  description: "Unparameterized query detected. Replace string interpolation with $1 syntax.",
  activeForm: "Fixing SQL injection vulnerability"
});

// For each CRITICAL issue
TaskCreate({
  subject: "[CRITICAL] Add integration test for /api/coliseum/challenge",
  description: "New endpoint lacks test coverage. Add to coliseum.integration.test.js.",
  activeForm: "Adding integration test for coliseum challenge"
});

// For each held-back plan item
TaskCreate({
  subject: "[HELD-BACK] Phase 3 animations not implemented",
  description: "Plan specified animations but none were implemented. Clarify with user.",
  activeForm: "Clarifying held-back plan item"
});
```

### Step 3.2: Remediation Subagent Dispatch Matrix

Use the appropriate subagent for each issue type:

| Issue Type | Subagent | Context to Provide |
|------------|----------|-------------------|
| Missing tests | `qa-expert` | File paths, endpoint signatures, expected behaviors |
| Security issues | `security-auditor` + `backend-developer` | Vulnerability details, attack vectors, fix patterns |
| Documentation gaps | `documentation-maintainer` | Code changes, expected doc locations, format |
| Code quality issues | `code-reviewer` + `refactoring-specialist` | Files, specific issues, patterns to follow |
| Architecture drift | `architect-reviewer` + `fullstack-developer` | Expected patterns, current violations |
| Lint errors | `code-reviewer` | Error messages, file locations |
| File size violations | `refactoring-specialist` | File path, modularization strategy |
| Held-back features | Ask user → `frontend-developer` / `backend-developer` / `fullstack-developer` | Original requirements, plan context |

### Step 3.3: Remediation Flow

```dot
digraph remediation {
    "Issue from Phase 2" -> "Clear fix approach?";
    "Clear fix approach?" -> "Dispatch subagent" [label="yes"];
    "Clear fix approach?" -> "AskUserQuestion" [label="no/ambiguous"];
    "AskUserQuestion" -> "User response";
    "User response" -> "Dispatch subagent" [label="implement"];
    "User response" -> "Mark deferred (user approved)" [label="defer"];
    "Dispatch subagent" -> "Verify fix";
    "Verify fix" -> "Fixed?" [label="check"];
    "Fixed?" -> "TaskUpdate: completed" [label="yes"];
    "Fixed?" -> "Retry with more context" [label="no"];
    "TaskUpdate: completed" -> "Next issue";
    "Retry with more context" -> "Dispatch subagent" [label="max 2 retries"];
    "Retry with more context" -> "Escalate to user" [label="still failing"];
}
```

### Step 3.4: Clarification Triggers

Use AskUserQuestion when encountering:

| Trigger | Question Format |
|---------|-----------------|
| Ambiguous implementation intent | "The plan mentions [X] but implementation differs. Should I: (a) implement as planned, (b) update plan to match implementation, (c) defer for now?" |
| Held-back items without clear reason | "Phase [N] task [X] was not implemented. Should I: (a) implement it now, (b) defer to next iteration, (c) remove from plan?" |
| Multiple valid remediation approaches | "Found [issue]. I can fix this by: (a) [approach 1], (b) [approach 2]. Which approach?" |
| Breaking changes requiring approval | "Fixing [issue] requires changing [public API/schema/interface]. This may break [X]. Proceed?" |
| Unclear success criteria | "How should I verify [feature] is working correctly? Options: (a) [test approach 1], (b) [test approach 2]" |

### Step 3.5: BLOCKER Remediation

For each BLOCKER, dispatch the appropriate subagent:

```
Task tool prompt template for BLOCKER fixes:

You are fixing a BLOCKER issue that prevents commit.

Issue: [issue description]
File: [file path]
Line: [line number]
Source: [which Phase 2 agent found it]

Context:
- Plan: [relevant plan context]
- Pattern to follow: [reference to ESTABLISHED_PATTERNS.md section]

REQUIREMENTS:
1. Fix the issue completely
2. Verify the fix (run relevant test/lint/check)
3. Return confirmation with before/after

Do NOT just report - IMPLEMENT the fix.
```

### Step 3.6: CRITICAL Remediation

For each CRITICAL issue:

```
Task tool prompt template for CRITICAL fixes:

You are addressing a CRITICAL issue that should be fixed before commit.

Issue: [issue description]
Category: [COVERAGE/DOCUMENTATION/DEBT/SECURITY]
Files affected: [list]

REQUIREMENTS:
1. Implement the fix
2. If adding tests, follow patterns in existing test files
3. If updating docs, follow existing doc format
4. Verify your changes work

Return confirmation of what was fixed.
```

### Step 3.7: Held-Back Item Handling

```dot
digraph heldback {
    "Held-back item detected" -> "Reason documented in changes?";
    "Reason documented in changes?" -> "Valid intentional deferral?" [label="yes"];
    "Reason documented in changes?" -> "AskUserQuestion: Implement or defer?" [label="no"];
    "Valid intentional deferral?" -> "Log as intentional, continue" [label="yes"];
    "Valid intentional deferral?" -> "AskUserQuestion: Clarify intent" [label="unclear"];
    "AskUserQuestion: Implement or defer?" -> "Dispatch appropriate subagent" [label="implement now"];
    "AskUserQuestion: Implement or defer?" -> "Log as user-approved deferral" [label="defer"];
    "AskUserQuestion: Clarify intent" -> "Dispatch or defer based on response";
}
```

### Step 3.8: Verification Gate

**DO NOT proceed to Phase 4 until:**

- [ ] All BLOCKER issues are fixed and verified
- [ ] All CRITICAL issues are fixed OR user-approved deferral
- [ ] All held-back items are implemented OR user-approved deferral
- [ ] Lint passes (re-run after fixes)
- [ ] Tests pass (re-run after fixes)

If verification fails after max retries, escalate to user with AskUserQuestion.

---

## Phase 4: Synthesis & Commit

**This phase runs ONLY after Phase 3 completes successfully.** All blockers should be resolved.

### Step 4.1: Collect Final State

Gather remediation results:
- Original Phase 2 findings
- Remediations applied (with before/after)
- Verifications passed
- User-approved deferrals (if any)
- Final lint/test results

### Step 4.2: Classify Remaining Items

After remediation, classify any remaining items:

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

### Step 4.3: Generate Final Report

```markdown
# Plan Validation Report v4.0

## Executive Summary
**Verdict:** COMMITTED (all issues remediated)
**Files Changed:** N (A added, M modified, D deleted)
**Lines Changed:** +X, -Y
**Subagents Run:** N (analysis) + M (remediation)

## Phase 1: Pre-Analysis

### File Inventory
| File | Lines | Status |
|------|-------|--------|
| path/file.js | 450 | OK |
| path/big.js | 2,800 | WARNING |

### Lint Results
- Initial: 2 errors, 3 warnings
- After remediation: 0 errors, 3 warnings

### Test Results
- Initial: 143 passed, 2 failed
- After remediation: 147 passed, 0 failed

## Phase 2: Issues Identified

### BLOCKERS Found
1. **[SECURITY]** `api/src/routes/battle.js:45` - Unparameterized query
2. **[COVERAGE]** Missing test for /api/coliseum/challenge

### CRITICAL Found
1. **[DOCUMENTATION]** New endpoint undocumented

### WARNINGS Found
1. **[DEBT]** Duplicated validation logic (deferred)

## Phase 3: Remediations Applied

### BLOCKER Fixes
| Issue | Subagent | Action | Verified |
|-------|----------|--------|----------|
| SQL injection battle.js:45 | security-auditor + backend-developer | Parameterized query | YES - lint passes |
| Missing test coliseum/challenge | qa-expert | Added integration test | YES - test passes |

### CRITICAL Fixes
| Issue | Subagent | Action | Verified |
|-------|----------|--------|----------|
| Undocumented endpoint | documentation-maintainer | Updated API_SPECIFICATION.md | YES - doc sync check |

### User-Approved Deferrals
| Issue | Reason | Approved |
|-------|--------|----------|
| Duplicated validation logic | Low priority, extract in future refactor | YES - user confirmed |

## Phase 4: Final State

### Checklists Summary (Post-Remediation)
| Check | Status |
|-------|--------|
| All queries parameterized | YES |
| All new endpoints tested | YES |
| Documentation synced | YES |
| Lint passes | YES |
| Tests pass | YES |

### Gap Analysis
- [x] Phase 1: Initial setup - COMPLETE
- [x] Phase 2: Core implementation - COMPLETE
- [~] Phase 3: Polish - PARTIAL (animations deferred with user approval)

## Metrics

| Metric | Before | After |
|--------|--------|-------|
| Blockers | 2 | 0 |
| Critical | 1 | 0 |
| Warnings | 1 | 1 (deferred) |
| Test count | 145 | 149 |
```

### Step 4.4: Unconditional Commit

**After Phase 3 verification gate passes, ALWAYS commit:**

1. All blockers have been remediated and verified
2. All critical issues have been fixed or user-approved deferral
3. Lint passes, tests pass
4. Proceed directly to commit - no user confirmation needed

**Commit includes:**
- Summary of implemented features
- List of remediations applied
- User-approved deferrals noted
- Updated roadmap
- Archived completed items

---

## Commit Message Format

```
feat: [Phase Name] - [Brief Summary]

Implemented:
- [Feature 1]
- [Feature 2]
- [Feature 3]

Remediations applied:
- [BLOCKER] [Issue]: [How fixed]
- [CRITICAL] [Issue]: [How fixed]

User-approved deferrals:
- [Issue]: [Reason for deferral]

Tests added:
- [test file]: [what it tests]

Files changed:
- [file1.js] - [brief description]
- [file2.js] - [brief description]

Validation Report (v4.0):
- Analysis subagents: 5 (code-reviewer, debt-detector, qa-expert, security-auditor, documentation-checker)
- Remediation subagents: 3 (backend-developer, qa-expert, documentation-maintainer)
- Issues found: 2 blockers, 1 critical, 1 warning
- Issues remediated: 2 blockers, 1 critical
- Issues deferred: 1 warning (user-approved)
- Final state: All tests pass, lint clean

Gap analysis:
- Completed: X items
- Deferred (approved): Y items

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

### Execution Flow
- **Phase 1 first** - blockers here prevent Phase 2
- **Phase 2 agents in parallel** - use Task tool with multiple calls
- **Phase 3 is sequential** - remediate one issue at a time, verify each
- **Phase 4 commits unconditionally** - after Phase 3 gate passes

### Remediation-First Principles
- **FIX issues, don't just report them** - this is the core v4.0 change
- **Use subagents for fixes** - dispatch appropriate agent for each issue type
- **Verify every fix** - re-run lint/test after each remediation
- **Ask when unclear** - use AskUserQuestion for ambiguous situations
- **Track with TodoWrite** - create tasks for each remediation

### Clarification Requirements
- **Ambiguous intent** - ask before implementing
- **Held-back items** - ask user: implement now or defer?
- **Multiple approaches** - ask user which approach to use
- **Breaking changes** - get explicit approval before proceeding

### Post-Remediation
- **Always commit after Phase 3 passes** - no user confirmation needed
- **Keep roadmap fresh** - remove completed items
- **Archive completed work** - update docs/archive/
- **Include remediation summary** - in commit message

### Verification Checks
- **Lint must pass** - after all fixes
- **Tests must pass** - after all fixes
- **Module loading** - verify with `timeout 10 npm run dev:api`
- **@shared imports** - recurring issue, always verify
