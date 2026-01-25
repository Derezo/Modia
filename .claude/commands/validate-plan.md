---
description: Validate completed work against the plan, perform code review, gap analysis, and commit
argument-hint: "[optional: specific phase to validate]"
---

# Validate Plan Command v3.0

Execute the validate-plan skill to perform comprehensive validation with parallel subagent architecture:

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

## Phase 3: Synthesis
1. Collect and deduplicate findings
2. Classify by severity (BLOCKER, CRITICAL, WARNING, INFO)
3. Generate unified validation report
4. Update roadmap with completed items
5. Commit changes or block with fix instructions

## Quality Gates

**BLOCKERS (Cannot Proceed):**
- File size > 3500 lines
- `@shared` imports in API code
- SQL injection patterns
- Missing auth middleware
- Lint errors
- Missing endpoint tests

**CRITICAL (Should Fix):**
- No tests for new business logic
- Missing error handling
- Undocumented API changes
- Complexity > 20

If an argument is provided, focus validation on that specific phase or feature.

$ARGUMENTS
