---
name: validate-plan
description: Use this skill when the user wants to validate completed work against a plan, perform code review, analyze gaps, update the roadmap, and commit changes. Trigger on phrases like "validate plan", "review changes", "check implementation", "gap analysis", or "finalize and commit".
version: 2.0.0
---

# Plan Validation and Code Review Skill

This skill performs comprehensive validation of completed implementation work against the project plan using specialized subagents and automated testing.

## Workflow

When invoked, execute these steps in order:

### Step 1: Load the Plan

1. Read the active plan file from `/home/wizard/.claude/plans/` (most recent `.md` file)
2. Parse the plan sections to identify:
   - Defined phases and tasks
   - Files to be created/modified
   - Success criteria
   - Implementation order

### Step 2: Inventory Changed Files

1. Run `git status` to see all modified/added files
2. Run `git diff --stat` to get change statistics
3. Categorize changes:
   - New files created
   - Existing files modified
   - Files deleted
4. Identify which systems are affected:
   - `api/src/routes/battle.js` or `api/src/services/battle*.js` → Battle system
   - `api/src/routes/shop.js`, `marketplace.js`, `inventory.js` → Economy system
   - `api/src/routes/auth.js`, `api/src/middleware/auth.js` → Auth system
   - `api/src/websocket/` → WebSocket system
   - `api/src/migrations/` → Database changes
   - `frontend/src/scenes/` → Scene lifecycle
   - `shared/` → Shared formulas/constants

### Step 3: Run Existing Tests

1. Execute `npm run test` to run the full test suite
2. Capture test results:
   - Number of tests passed/failed
   - Which test files have failures
   - Error messages for failures
3. If tests fail, note these for the code review context
4. Do NOT proceed to commit if critical tests are failing (fix first)

### Step 4: Subagent Code Review

Use the Task tool to invoke specialized subagents based on what was changed. Run applicable subagents in parallel:

**Always invoke:**
- `code-reviewer` subagent: Review all changed files for JavaScript/Node.js patterns, security, and code quality

**Conditionally invoke:**
- `security-auditor` subagent: When auth, economy, transaction, or user data code is touched
- `architect-reviewer` subagent: When significant structural changes are made (new services, major refactors, new API patterns)

Prompt template for subagents:
```
Review the following changed files for [specific focus]:
- [list of files]

Context: These changes implement [plan phase/feature].

Provide findings in this format:
- Critical (must fix): [issues]
- High (should fix): [issues]
- Medium (consider): [issues]
```

Collect all findings and consolidate into a single review report.

### Step 5: Game System Validation

Perform Modia-specific validation checks based on affected systems:

**Battle System (if changed):**
- Verify damage formulas match `shared/battleMath.js`
- Check turn order logic consistency
- Validate skill effects match `docs/SKILL_TREES.md`
- Verify AI patterns match `docs/AI_SYSTEM.md`

**Economy System (if changed):**
- Verify transaction integrity (gold reservations, item escrow)
- Check for negative quantity exploit prevention
- Validate price calculations and limits
- Check marketplace order limits enforcement

**Character/Stats (if changed):**
- Verify stat calculations match `shared/constants.js`
- Check race/class growth formulas
- Validate equipment bonus application

**WebSocket (if changed):**
- Validate message protocol matches `docs/BATTLE_MESSAGING_PROTOCOL.md`
- Check room subscription/unsubscription patterns
- Verify authentication on WebSocket handlers

**Memory Leak Prevention (frontend changes):**
- Check for event listener cleanup in scene `exit()` methods
- Verify `removeEventListener` calls match `addEventListener` calls
- Flag Canvas context `save()`/`restore()` mismatches
- Check for unsubscribed WebSocket handlers

**Database Migrations (if added):**
- Verify migrations have logical rollback capability
- Check that new tables/columns are used in routes
- Verify schema changes match API expectations
- Validate foreign key relationships

### Step 6: Gap Analysis

Compare implementation against plan:

1. **Completed Items**: List all plan items that are fully implemented
2. **Partial Items**: List items that are partially done with details
3. **Missing Items**: List items from the plan not yet implemented
4. **Extra Items**: List anything implemented not in the original plan
5. **Documentation Discrepancies**: Flag if code differs from docs

Output format:
```
## Gap Analysis

### Fully Completed
- [x] Item description

### Partially Completed
- [~] Item description
  - Done: [what's done]
  - Remaining: [what's left]

### Not Started
- [ ] Item description

### Out of Scope (Bonus)
- [+] Item description (not in plan but implemented)

### Documentation Discrepancies
- [!] [doc file]: [discrepancy description]
```

### Step 7: Implement Critical Tests

Use the `qa-expert` subagent to implement tests for gaps identified in steps 4-6:

1. Identify critical code paths lacking test coverage:
   - New API endpoints without tests
   - Modified business logic without test updates
   - Security-sensitive code paths
   - Game mechanics changes (damage, economy, progression)

2. Invoke `qa-expert` subagent with prompt:
```
Implement critical tests for the following code changes:
- [list of files/functions needing tests]

Context from code review:
- [relevant findings]

Use the existing test patterns from `api/src/tests/`:
- Use Node's built-in test runner (node:test)
- Use testHelper.js utilities (createTestUser, createTestCharacter, request)
- Follow existing test file structure

Create tests in the appropriate test file or create new test file if needed.
```

3. After tests are written, re-run `npm run test` to verify:
   - New tests pass
   - Existing tests still pass
   - No regressions introduced

### Step 8: Update Roadmap & Archive

1. Read `docs/DEVELOPMENT_ROADMAP.md`
2. Mark completed phases/items with checkboxes
3. **Remove completed items** from active sections (keep roadmap fresh)
4. Move significant completed work to documentation archive if one exists
5. Add any newly discovered TODO items or deferred work
6. Update phase completion percentages
7. Identify the next priority phase
8. Write summary of:
   - What was accomplished
   - Current project state
   - Recommended next steps (prioritized)

### Step 9: Generate Commit

1. Stage all relevant changes including new tests: `git add .`
2. Generate a comprehensive commit message including:
   - Summary of what was implemented
   - List of major features/fixes
   - Tests added
   - Reference to the plan phase completed
   - Next priority items

Commit message format:
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

Code review findings addressed:
- [Critical/High issues fixed]

Gap analysis:
- Completed: X items
- Remaining: Y items

Next priority:
- [Next task 1]
- [Next task 2]

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
```

## Subagent Reference

Available subagents for this project:

| Subagent | Use When | Focus |
|----------|----------|-------|
| `code-reviewer` | Always | JavaScript patterns, security, code quality |
| `qa-expert` | Implementing tests | Test coverage, game mechanics validation |
| `security-auditor` | Auth/economy/transaction code | Vulnerabilities, exploits, OWASP |
| `architect-reviewer` | Structural changes | System design, scalability, patterns |

## Output Format

After completing all steps, provide a structured summary:

```markdown
# Plan Validation Report

## Summary
[Executive summary of implementation status]

## Test Results
- Existing tests: X passed, Y failed
- New tests added: Z
- Coverage gaps addressed: [list]

## Code Review Results
[Summary of code quality findings by severity]

## Game System Validation
[Modia-specific checks passed/failed]

## Gap Analysis
[Completed vs remaining work]

## Roadmap Status
[Updated roadmap with completed items removed]

## Next Priority
[Top 3-5 next tasks in priority order]

## Commit
[Commit hash and message summary]
```

## Important Notes

- Always read files before making judgments about them
- Run tests before and after making changes
- Use subagents for thorough review - don't skip this step
- Check that database schema matches route expectations
- Verify frontend components have corresponding API endpoints
- Implement tests for critical functionality - don't just suggest them
- Keep the roadmap fresh by removing completed items
- Flag any security concerns immediately
- Do not commit if critical issues are found - report them first
- Do not commit if tests are failing - fix them first
