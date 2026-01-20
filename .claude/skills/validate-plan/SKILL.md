---
name: validate-plan
description: Use this skill when the user wants to validate completed work against a plan, perform code review, analyze gaps, update the roadmap, and commit changes. Trigger on phrases like "validate plan", "review changes", "check implementation", "gap analysis", or "finalize and commit".
version: 2.1.0
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

### Step 2.5: File Size Enforcement (BLOCKING)

**CRITICAL**: Oversized files harm maintainability. Files exceeding 2500 lines **block validation and commits**.

1. Count lines in all modified/added `.js` files:
   ```bash
   # Get line counts for changed JS files
   git diff --name-only HEAD | grep '\.js$' | xargs wc -l 2>/dev/null | sort -n
   ```

2. Check against thresholds (matching CLAUDE.md > File Size Guidelines):

   | Lines | Level | Action |
   |-------|-------|--------|
   | < 500 | Target | Ideal - proceed |
   | 500-999 | OK | Proceed |
   | 1000-1499 | NOTICE | Mention in report, continue |
   | 1500-2499 | WARNING | Flag prominently, continue with caution |
   | **2500+** | **BLOCKING** | **HALT - Do not proceed to Step 3** |

3. **Exemptions** (skip these files):
   - Files in `dist/`, `node_modules/`
   - Test files: `*.test.js`, `*.spec.js`
   - Migration files: `*.sql`
   - Minified files: `*.min.js`
   - Generated files (sprites, audio metadata)
   - Data template files (`api/src/db/templates/*.js`)

4. **If BLOCKING violations found**, output this format and STOP:

   ```markdown
   ## ⛔ FILE SIZE VIOLATION - BLOCKING

   The following files exceed the 2500-line limit and must be modularized before proceeding:

   | File | Lines | Excess |
   |------|-------|--------|
   | `path/to/file.js` | 3,259 | +759 |

   ### Required Actions

   1. Split oversized file(s) using modularization patterns from CLAUDE.md
   2. Re-run validation after refactoring

   ### Modularization Patterns

   See **CLAUDE.md > File Size Guidelines** for:
   - Re-export wrapper pattern (battleService.js example)
   - Domain module directory structure
   - Scene component extraction
   - Data manifest pattern

   **Validation halted. Fix file sizes before continuing.**
   ```

5. **Do NOT proceed to Step 3 if any BLOCKING violations exist.**

   **Existing Tech Debt Files:** Files listed in CLAUDE.md > Tech Debt are tracked separately.
   Changes to these files do NOT block validation unless they increase the line count.
   New files or files not in the tech debt list must comply with the 2500-line limit.

6. For WARNING-level files (1500-2499 lines), add to report but continue:
   ```markdown
   ### ⚠️ File Size Warnings

   These files are approaching the limit and should be considered for future modularization:

   | File | Lines | Status |
   |------|-------|--------|
   | `path/to/file.js` | 1,956 | Warning (limit: 2500) |
   ```

### Step 3: Module Loading Validation

**CRITICAL**: ESLint and tests may pass while the server cannot start due to runtime import errors (missing exports, circular dependencies, module resolution). This step catches those errors early.

1. Run `node --check` on all modified `.js` files to catch syntax errors:
   ```bash
   # For each modified file
   node --check api/src/routes/myRoute.js
   ```

2. Attempt to start the API server briefly to validate all imports resolve:
   ```bash
   # Start server with timeout - if it starts successfully, imports are valid
   timeout 10 npm run dev:api 2>&1 || true
   ```
   - Look for errors like: `SyntaxError: The requested module 'X' does not provide an export named 'Y'`
   - Look for: `Error [ERR_MODULE_NOT_FOUND]`
   - Look for: `Cannot find module`

3. If module loading fails:
   - Identify the problematic import statement
   - Read the source module to see what it actually exports
   - Fix the import to use the correct export name or pattern
   - Re-run validation

**Common patterns that cause runtime import errors:**
- Assuming a function exists without reading the module: `import { createRateLimiter } from './file.js'` when only `createLimiter` is exported
- Made-up constants like `COST_LEVELS` that don't exist
- Circular dependencies between modules
- Wrong relative path depth (`../` vs `../../`)

### Step 4: Run Lint and Tests

1. Execute `npm run lint` to check for code quality issues
   - **CRITICAL**: The `@shared` import alias only works in frontend (Vite)
   - API code must use relative paths: `../../../shared/constants.js`
   - ESLint will catch `@shared` imports in API code with `no-restricted-imports` rule
   - Fix all lint errors before proceeding (warnings can be deferred)
2. Execute `npm run test` to run the full test suite
3. Capture test results:
   - Number of tests passed/failed
   - Which test files have failures
   - Error messages for failures
4. If tests fail, note these for the code review context
5. Do NOT proceed to commit if lint errors or critical tests are failing (fix first)

### Step 5: Subagent Code Review

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

### Step 6: Game System Validation

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

**Shared Module Imports (always check):**
- Verify NO `@shared/` imports exist in `api/` code (use relative paths)
- Verify `@shared/` imports are used correctly in `frontend/` code (Vite alias)
- Run `grep -r "@shared" api/src/` to catch violations
- This is a recurring issue - ESLint catches it but manual verification is recommended

### Step 7: Gap Analysis

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

### Step 8: Implement Critical Tests

Use the `qa-expert` subagent to implement tests for gaps identified in steps 5-7:

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

### Step 9: Update Roadmap & Archive

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

### Step 10: Generate Commit

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

File size status:
- All files under 2500 lines ✓
- [or] Warnings: [file.js (1,956 lines)]

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

- **ALWAYS validate module loading before commit** - run `timeout 10 npm run dev:api` to catch missing export errors
- Always read the source file before importing from it - never assume an export exists
- Always read files before making judgments about them
- Run lint AND tests before and after making changes
- Use subagents for thorough review - don't skip this step
- Check that database schema matches route expectations
- Verify frontend components have corresponding API endpoints
- Implement tests for critical functionality - don't just suggest them
- Keep the roadmap fresh by removing completed items
- Flag any security concerns immediately
- Do not commit if lint errors are found - fix them first
- Do not commit if critical issues are found - report them first
- Do not commit if tests are failing - fix them first
- **ALWAYS verify no `@shared/` imports in API code** - this is a recurring issue
