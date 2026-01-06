---
name: validate-plan
description: Use this skill when the user wants to validate completed work against a plan, perform code review, analyze gaps, update the roadmap, and commit changes. Trigger on phrases like "validate plan", "review changes", "check implementation", "gap analysis", or "finalize and commit".
version: 1.0.0
---

# Plan Validation and Code Review Skill

This skill performs comprehensive validation of completed implementation work against the project plan.

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

### Step 3: Code Review

For each changed file, analyze:

1. **Correctness**: Does the code implement what the plan specified?
2. **Quality**: Check for:
   - Proper error handling
   - Input validation
   - Security concerns (SQL injection, XSS, etc.)
   - Memory leaks (event listeners, subscriptions)
   - Consistent coding style
3. **Completeness**: Are all required functions/endpoints implemented?
4. **Integration**: Do components properly connect to each other?

Use this checklist format:
```
## Code Review: [filename]
- [ ] Implements planned functionality
- [ ] Error handling present
- [ ] Input validation
- [ ] No security vulnerabilities
- [ ] Follows project patterns
- [ ] Properly integrated
Notes: [any issues found]
```

### Step 4: Gap Analysis

Compare implementation against plan:

1. **Completed Items**: List all plan items that are fully implemented
2. **Partial Items**: List items that are partially done with details
3. **Missing Items**: List items from the plan not yet implemented
4. **Extra Items**: List anything implemented not in the original plan

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
```

### Step 5: Update Roadmap

1. Read the plan file
2. Mark completed phases/items
3. Identify the next priority phase
4. Write a summary of:
   - What was accomplished
   - Current project state
   - Recommended next steps (prioritized)

### Step 6: Generate Commit

1. Stage all relevant changes: `git add .`
2. Generate a comprehensive commit message including:
   - Summary of what was implemented
   - List of major features/fixes
   - Reference to the plan phase completed
   - Next priority items

Commit message format:
```
feat: [Phase Name] - [Brief Summary]

Implemented:
- [Feature 1]
- [Feature 2]
- [Feature 3]

Files changed:
- [file1.js] - [brief description]
- [file2.js] - [brief description]

Gap analysis:
- Completed: X items
- Remaining: Y items

Next priority:
- [Next task 1]
- [Next task 2]

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
```

## Output Format

After completing all steps, provide a structured summary:

```markdown
# Plan Validation Report

## Summary
[Executive summary of implementation status]

## Code Review Results
[Summary of code quality findings]

## Gap Analysis
[Completed vs remaining work]

## Roadmap Status
[Updated roadmap with completed items marked]

## Next Priority
[Top 3-5 next tasks in priority order]

## Commit
[Commit hash and message summary]
```

## Important Notes

- Always read files before making judgments about them
- Check that database schema matches route expectations
- Verify frontend components have corresponding API endpoints
- Ensure tests exist for critical functionality
- Flag any security concerns immediately
- Do not commit if critical issues are found - report them first
