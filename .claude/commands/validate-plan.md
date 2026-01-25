---
description: Validate completed work against the plan, remediate issues, and commit
argument-hint: "[optional: specific phase to validate]"
---

# Validate Plan Command v4.0

Execute the validate-plan skill to perform comprehensive validation with parallel subagent architecture, **then remediate all issues before committing**.

## Core Principle: Remediation-First

This skill does NOT just report issues—it FIXES them:
- Blockers and critical issues → Dispatch subagents to fix
- Ambiguous intent → Ask user for clarification
- Held-back plan items → Implement or explicitly defer with user approval
- All remediations verified → Commit automatically

## Phase 1: Pre-Analysis (Parallel)
1. Analyze changed files, count lines, check size thresholds
2. Run lint and capture errors/warnings
3. Run tests and capture pass/fail
4. Parse active plan for requirements

## Phase 2: Deep Analysis (Parallel Subagents)
- **code-reviewer**: Security checklists, memory safety, patterns (always)
- **debt-detector**: Technical debt, pattern conformance (always)
- **qa-expert**: Test coverage, edge cases (always)
- **security-auditor**: Auth/economy security (conditional)
- **architect-reviewer**: Structural changes (conditional)
- **documentation-checker**: Doc sync validation (conditional)

## Phase 3: Remediation Execution (Sequential)
1. Create TodoWrite tasks for all issues
2. For each BLOCKER: Dispatch subagent → Verify fix
3. For each CRITICAL: Dispatch subagent → Verify fix
4. For held-back items: AskUserQuestion → Implement or defer
5. For ambiguous issues: AskUserQuestion → Resolve
6. Gate: All issues remediated OR user-approved deferral

## Phase 4: Synthesis & Commit
1. Collect remediation results
2. Generate final report (with before/after)
3. Update roadmap with completed items
4. Archive completed work
5. Commit changes (unconditional after Phase 3 passes)

## Quality Gates

**BLOCKERS (Must Remediate):**
- File size > 3500 lines
- `@shared` imports in API code
- SQL injection patterns
- Missing auth middleware
- Lint errors
- Missing endpoint tests

**CRITICAL (Should Remediate):**
- No tests for new business logic
- Missing error handling
- Undocumented API changes
- Complexity > 20

## Remediation Subagent Matrix

| Issue Type | Subagent |
|------------|----------|
| Missing tests | `qa-expert` |
| Security issues | `security-auditor` + `backend-developer` |
| Documentation gaps | `documentation-maintainer` |
| Code quality | `code-reviewer` + `refactoring-specialist` |
| Architecture drift | `architect-reviewer` + `fullstack-developer` |
| Held-back features | Ask user → appropriate developer subagent |

If an argument is provided, focus validation on that specific phase or feature.

$ARGUMENTS
