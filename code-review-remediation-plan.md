# Code Review + Remediation Plan

## Context

The user asked for a comprehensive code review across the Modia project (MMORPG monorepo: api, frontend, admin, shared, e2e), followed by remediation of findings. The goals are:

1. Identify security vulnerabilities, logic problems, dead code, duplication, and pattern drift
2. Validate all tests pass and raise coverage above 70%
3. Remediate every issue surfaced

Four specialist audits have already completed (security-auditor, debt-detector, qa-expert, code-reviewer). Results were cross-verified by re-reading the flagged code — some findings were false positives and have been dropped from the remediation list.

### Audit results summary

**Tests & lint:** All 3,610 tests pass (API 2,938, shared 572, admin 100). Lint clean across workspaces. No failing tests to fix.

**Coverage (c8):**
- API: 57.32% statements (gap to 70% ≈ 12.7 points; ~150 tests)
- Admin: 6.77% statements (React components untested)
- Shared: tests exist, no coverage tool configured (`battleMath`, `mapGeneration`, `pathfinding` are well-covered)
- Frontend: 2 test files only

**Confirmed security findings:**
1. **CRITICAL — chat character impersonation:** `api/src/websocket/messageHandlers.js:125` — `chatService.saveMessage` is called with `characterId: payload.characterId` from the client without verifying that character belongs to the authenticated `userId`. A user can send chat messages attributed to another player's character.
2. **HIGH — party invite character spoofing:** `api/src/websocket/messageHandlers.js:658` — same issue; `characterId` from payload passed through to `partyWebsocket.sendInvite` without ownership check.
3. **MEDIUM — err.message leaked to client:** `api/src/routes/fishing.js:33,50,67,84` — raw `err.message` returned in responses; should use generic messages and log server-side.

Several audit items were **false positives** after verification and are excluded from remediation:
- "Template-literal SQL injection" in `audioMetadataService.js`/`adminAudio.js` — no `${}` interpolation in queries, only multi-line strings (safe).
- `whereClause` interpolation in `exceptionTrackingService.js`/`feedbackService.js` — `whereClause` is built from parameterized `$N` placeholders only (safe).
- "Hardcoded test bypass secret" in `rateLimiterFactory.js:29` — wrapped in `if (isProduction) return false` check so the secret is inert in prod. Low priority; keep as-is or move to env var.
- Blanket XSS claim on ~40 `innerHTML` sites — most build static HTML from internal data. Only sites interpolating user-controlled text need fixing; must audit case-by-case, not blanket-replace.

**Confirmed code-quality findings:**
4. **`api/src/routes/battle.js` (1,347 lines):** Contains significant business logic (reward calculation, enemy generation, trait loading) that belongs in `battleService.js`. Route should delegate.
5. **Files >1,500 lines missing module summary comments:** `BattleWebSocketManager.js` (1,472), `BattleUI.js` (1,464), `WorldMapScene.js` (1,600), `ShopScene.js` (1,306), `GuildAdvancementScene.js` (1,278), `coliseumStyles.js` (1,763).
6. **Magic number:** `api/src/routes/battle.js:526` uses `1000000` for map seed without a named constant.

**Confirmed dead code / debt findings (knip output):**
7. **16 unused files** across api/frontend/admin (examples: `admin/src/components/AnimationPlayer.jsx`, `api/src/utils/regenerationQueueUtils.js`, `frontend/src/audio/index.js`, `api/src/websocket/messageRouter.js`, `api/src/db/worldgen/index.js`).
8. **575 unused exports** — large number; most are intentional public API surface area and shouldn't be touched. Only remove ones that are truly unreachable *and* the file they're in also has no other consumers.
9. **32 unlisted `@shared` dependencies** in package.json files — workspace import metadata gap.
10. **Duplicated pagination/validation pattern:** The `parseInt(value, 10)` + `isNaN` + range check pattern is copy-pasted across marketplace, world discovery, achievement services (25+ sites). Extractable into a shared validator utility.

**Coverage gaps (under-tested high-impact files):**
- `api/src/services/dailyQuestService.js` (1,055 lines, 18.57%)
- `api/src/services/adminGenerationService.js` (1,098 lines, 24.59%)
- `api/src/websocket/messageHandlers.js` (1,171 lines, 26.47%)
- `api/src/services/actionProcessor.js` (1,058 lines, 50.37%)
- `api/src/services/battleTurnManager.js` (627 lines, 15.94%)
- `api/src/services/garrisonService.js` (591 lines, 18.61%)
- `api/src/services/enemyService.js` (331 lines, 24.47%)
- `api/src/services/coliseum/matchmaking.js` (353 lines, 23.51%)
- `api/src/services/coliseum/statistics.js` (385 lines, 17.66%)
- `api/src/services/marketplace/search.js` (262 lines, 12.97%)

---

## Scope decisions

The user said "remediate all problems." Taken literally that's thousands of individual changes (e.g., every innerHTML, every unused export). To stay useful rather than churning for months, I'm applying the following filters:

- **Include:** Every CONFIRMED security finding (1–3). All high-impact code-quality findings (4–6). Dead-code removal for clearly dead files from knip (7). Pagination validator extraction (10).
- **Include:** Coverage additions to cross the 70% threshold on the API workspace (shortest path: add tests to the 7 highest-impact under-covered services).
- **Defer with explicit note:** Blanket innerHTML replacement, 575 unused export cleanup, admin frontend coverage buildout (requires heavy MSW/RTL scaffolding; would double the plan). These become TODO items in a follow-up doc.
- **Skip:** Module-summary comment additions for 1.5k–3.5k line files. Useful polish, not a problem, not a security risk. Don't bundle with remediation.

If you want the deferred items pulled in, say so and I'll rescope.

---

## Remediation Steps

### Phase 1 — Security (BLOCKING)

**S1. Fix WebSocket character ownership validation** (CRITICAL + HIGH)
- File: `api/src/websocket/messageHandlers.js`
- Add a helper `verifyCharacterOwnership(characterId, userId) → boolean` that runs `SELECT 1 FROM characters WHERE id = $1 AND user_id = $2`. Prefer to extend an existing helper in `api/src/services/characterService.js` if one exists — check there first; don't duplicate.
- In `handleChatMessage` (line ~125): before calling `chatService.saveMessage`, verify ownership. On failure, send error and return.
- In `handlePrivateMessage` (line ~172): same check when `characterId` is provided.
- In `handlePartyInvite` (line ~658): same check before `partyWebsocket.sendInvite`.
- Add unit tests in `api/src/tests/unit/websocket/messageHandlers.unit.test.js` (create file if needed) covering: (a) owned character succeeds, (b) unowned character returns error and does not save, (c) missing characterId still rejected as before.

**S2. Sanitize fishing route error responses** (MEDIUM)
- File: `api/src/routes/fishing.js` lines 33, 50, 67, 84
- Replace `res.status(500).json({ error: err.message })` with `res.status(500).json({ error: 'Failed to ...' })` matching the operation. Ensure `console.error` (or the project logger) still captures the original err server-side.
- Confirm no tests depend on the previous error shape; grep for `'fishing'` in `api/src/tests/`.

### Phase 2 — Code quality

**C1. Extract business logic from `api/src/routes/battle.js` into `battleService.js`**
- File: `api/src/routes/battle.js` (1,347 lines)
- Reward calculation, enemy generation, and trait-loading blocks (roughly lines 119–500 per audit) should become named exports of `api/src/services/battleService.js`. Route handlers call them and handle HTTP concerns only.
- Also: replace the magic `1000000` map-seed literal with `const MAP_SEED_MODULUS = 1_000_000` defined at top of the route file (or in `api/src/services/battleService.js` if it already owns the generation path).
- Reuse existing functions where possible — grep `battleService.js` first for `calculateRewards`, `generateEnemies`, `loadTraits` patterns that may already exist.
- Do NOT add backwards-compat shims for the route shape; internal refactor only.
- Run `npm run test -w api` after, verify all battle tests still pass.

**C2. Extract shared pagination/input validator**
- New file: `api/src/utils/validateNumericParam.js`
- Export `validatePositiveInt(value, { min, max, default: def })` returning `{ valid, value, error }`.
- Replace the ~25 inline `parseInt` + `isNaN` + range-check sites in:
  - `api/src/routes/marketplace*.js`
  - `api/src/routes/world.js` (discovery endpoints)
  - `api/src/services/marketplace/search.js`
  - Any achievement/quest routes using the pattern
- Use grep `parseInt\(.*10\)` to find candidates; replace only where shape matches.

### Phase 3 — Dead code

**D1. Remove knip-identified unused files**
- Run `npx knip --reporter json > /tmp/knip.json` to get the precise list.
- For each file in the "unusedFiles" list: verify zero imports with `grep -r "from.*<filename>" --include="*.js" --include="*.jsx"`. Delete only if zero hits.
- Explicitly inspect before deleting (these were flagged but may be entry points for tooling):
  - `ecosystem.config.js` — PM2 config, may be used at deploy time. Keep.
  - `api/src/db/worldgen/index.js` — verify no module expects it as barrel.
  - `frontend/src/audio/index.js` — verify no dynamic imports.
- Do NOT touch the 575 unused exports; scope-creep.

**D2. Add `@shared` to frontend/admin `package.json` dependencies**
- `frontend/package.json` and `admin/package.json` import from `@shared` but don't list it. Add `"@shared": "*"` under `dependencies` (or whatever workspace protocol the repo uses — check `api/package.json` for the pattern). API already handles shared via relative paths so no change needed there.

### Phase 4 — Coverage to 70% on API workspace

Goal: move API c8 statements from 57.32% → ≥70% (12.7-point gap).

**Targets (ranked by lines × gap):**

| File | Lines | Current | Tests needed |
|------|-------|---------|-------------|
| `services/dailyQuestService.js` | 1,055 | 18.57% | ~20 tests |
| `services/adminGenerationService.js` | 1,098 | 24.59% | ~18 tests |
| `websocket/messageHandlers.js` | 1,171 | 26.47% | ~18 tests (dovetails with S1) |
| `services/actionProcessor.js` | 1,058 | 50.37% | ~10 tests |
| `services/battleTurnManager.js` | 627 | 15.94% | ~15 tests |
| `services/garrisonService.js` | 591 | 18.61% | ~12 tests |
| `services/enemyService.js` | 331 | 24.47% | ~8 tests |
| `services/marketplace/search.js` | 262 | 12.97% | ~6 tests |

Approach: **unit tests** with dependency injection / mocks (no integration tests — too slow for the coverage push). Use existing patterns from the strong tests already in the repo:
- `api/src/tests/unit/coliseum/matchLifecycle.unit.test.js` for dependency mocking patterns.
- `api/src/tests/unit/battleService.combat.unit.test.js` for `withSeededRandom()` deterministic patterns.

For each file: cover the happy path of each exported function, plus 1–2 error branches. Don't chase 100% — stop when workspace c8 crosses 70%.

Verification after Phase 4: `npm run test:coverage -w api | tail -30` — confirm statements ≥70%.

### Phase 5 — Verification

1. `npm run test:unit -w api` — all green
2. `npm run test -w shared` — all green
3. `npm run test -w admin` — all green
4. `npm run lint` — all green
5. `npm run test:coverage -w api` — statements ≥70%
6. `npx knip` — fewer unused files than baseline
7. `npm run test:integration -w api` (requires running API + DB) — all green; validates the S1 WebSocket ownership changes against a real DB
8. Manual smoke: start `npm run dev:setup`, send a chat message in global/party, send a party invite — confirm everything still works for the happy path

### Out of scope (explicitly deferred)

These surfaced in the audits but are NOT included in this plan. Surface them in a follow-up if desired:

- Admin workspace frontend coverage buildout (6.77% → 70%). Requires substantial MSW + React Testing Library scaffolding. Estimate: separate 2–4 day task.
- Frontend (game client) unit test infrastructure. Only 2 test files today. Canvas-heavy code is hard to unit-test; focus should be Playwright E2E expansion instead.
- Blanket `innerHTML` → `textContent` conversion. ~40 sites; most don't touch user-controlled data. Case-by-case audit needed, not blanket change.
- 575 unused exports cleanup. Many are intentional public API. Would need each owner/domain's judgment.
- Module-summary comments on files 1.5k–3.5k lines. Polish, not a problem.
- `TEST_BYPASS_SECRET` → env var. Currently inert in prod; low value move.
- Further modularization of `BattleScene.js` (2,654 lines). Active refactor already in progress per recent commits.

---

## Critical files to modify

**Security:**
- `api/src/websocket/messageHandlers.js` (S1 — ownership checks)
- `api/src/routes/fishing.js` (S2 — error sanitization)
- `api/src/services/characterService.js` or new helper file (S1 — ownership helper)
- `api/src/tests/unit/websocket/messageHandlers.unit.test.js` (new or extended)

**Code quality:**
- `api/src/routes/battle.js` (C1 — extract business logic)
- `api/src/services/battleService.js` (C1 — receive extracted logic)
- `api/src/utils/validateNumericParam.js` (C2 — new shared validator)
- Marketplace/world route files (C2 — adopt validator)

**Dead code:**
- Files identified by `npx knip` (D1)
- `frontend/package.json`, `admin/package.json` (D2)

**Coverage (new test files):**
- `api/src/tests/unit/services/dailyQuestService.unit.test.js` (new)
- `api/src/tests/unit/services/adminGenerationService.unit.test.js` (new)
- `api/src/tests/unit/websocket/messageHandlers.unit.test.js` (new or extended, dovetails with S1)
- `api/src/tests/unit/services/actionProcessor.unit.test.js` (new, or extend existing)
- `api/src/tests/unit/services/battleTurnManager.unit.test.js` (already exists at 1,390 lines — extend)
- `api/src/tests/unit/services/garrisonService.unit.test.js` (new)
- `api/src/tests/unit/services/enemyService.unit.test.js` (new)
- `api/src/tests/unit/services/marketplace/search.unit.test.js` (new)

## Reusable utilities to consult

Before writing anything new:
- `api/src/services/characterService.js` — likely has ownership helpers for S1
- `api/src/middleware/errorHandler.js` — `AppError` / `asyncHandler` for C1 route cleanup
- `api/src/tests/testHelper.js` — `createTestContext()`, `createTestUser()`, `cleanupTestUser()`
- `api/src/tests/testUtils/wsTestHelper.js` — `createWsClient()`, `waitForMessage()` for S1 tests
- `shared/constants.js` `withSeededRandom` — for deterministic coverage tests

## Estimated scope

- Phase 1 (security): ~3 small edits + 1 new test file. High confidence, low risk.
- Phase 2 (quality): substantial — C1 moves several hundred lines from route into service. Medium risk; covered by existing battle tests, but run full suite after.
- Phase 3 (dead code): safe deletes after verification, plus tiny package.json edits.
- Phase 4 (coverage): the big one. ~100 new unit tests across 8 files to cross the 70% line.
- Phase 5: verification runs only.

Subagent plan: dispatch `security-auditor` + `backend-developer` for Phase 1 in parallel, then `backend-developer` for C1, `refactoring-specialist` for C2, `debt-detector`/`general-purpose` for D1–D2, then `test-automator` in parallel across the 8 Phase-4 targets. Final validation via `validate-plan` skill.
