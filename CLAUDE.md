# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Modia is a browser-based MMORPG with tactical turn-based combat and procedural world generation. It's a monorepo with three workspaces: `api/` (Node.js/Express backend), `frontend/` (vanilla JS client with Canvas 2D), and `shared/` (constants used by both).

## Development Commands

Essential commands for daily development. Full reference: `docs/DEVELOPMENT_COMMANDS.md`

```bash
# Quick start
npm run dev:setup                       # Smart startup: checks ports, Docker, migrations, seeds, launches

# Manual startup
docker compose up -d                    # Start PostgreSQL (required first)
npm run dev                             # Start both API (port 3000) and frontend (port 8080)
npm run dev:all                         # Start API + frontend + admin (port 5173)

# Testing
npm run test -w api                     # API tests only
npm run test:unit -w api                # Unit tests (fast, no server needed)
node --test path/to/file.test.js        # Single test file
npm run test:e2e                        # Playwright E2E (auto-starts servers)
npm run test:load                       # Artillery load tests (load-tests/config.yml)

# Database
npm run db:reset                        # Re-run migrations + seed
npm run db:fresh                        # Drop all, re-migrate, re-seed
```

**Tooling:** `knip.json` configures dead-code detection (`npx knip`).

### Workspace Structure

| Workspace | Port | Purpose |
|-----------|------|---------|
| `api/` | 3000 | Node.js/Express backend |
| `frontend/` | 8080 | Vanilla JS game client (Vite) |
| `admin/` | 5173 | React asset manager dashboard (Vite) |
| `shared/` | - | Constants and utilities used by api/frontend |
| `e2e/` | - | Playwright E2E tests (auto-starts servers) |

Workspace-specific commands use `-w` flag: `npm run test -w api`, `npm run lint -w frontend`

## Architecture

### Backend (`api/`)
- **Entry point:** `src/index.js` - Express server with WebSocket upgrade
- **Routes:** `src/routes/` - auth, characters, party, world, battle, inventory, skills, shop, marketplace, chat, guild, coliseum, friends, lfg, notifications, settings, fishing, ruins, advancementQuest, clans, debug, leaderboard, relics, quests, feedback, health
- **WebSocket:** `src/websocket/index.js` - Room-based subscriptions for chat, tavern presence, marketplace
- **Database:** PostgreSQL via `pg` pool in `src/config/database.js`
- **Migrations:** `src/migrations/` - Sequential SQL files (001_initial_schema.sql, etc.)
- **Templates:** `src/db/templates/` - Data templates (items.js, enemies.js, fish.js, caravanItems.js)
- **Auth:** JWT with 1h access tokens, 7-day refresh tokens, auto-refresh 1min before expiry

### Frontend (`frontend/`)
- **Build tool:** Vite for dev server and bundling
- **Entry:** `src/main.js` → `src/core/Game.js`
- **Scene-based architecture:** `src/scenes/` - Each screen extends base `Scene.js` (Auth, CharacterSelect, CharacterCreate, WorldMap, Battle, Shop, Marketplace, Tavern, Formation, SocialHub, Coliseum, Recruitment, GuildAdvancement, Fishing, Leaderboard, Settings)
- **Game loop:** RequestAnimationFrame with `update(deltaTime)` → `render(ctx)` cycle
- **Canvas layers:** Background, Game, HUD, Modal (rendered in order)
- **Static assets:** `public/assets/` - sprites, images served at `/assets/`
- **Shared imports:** Uses `@shared/` alias to import from shared workspace

### Shared (`shared/`)
- `constants.js` - Races, classes, stat formulas, `SeededRandom` class (Mulberry32)
- `terrain.js` - Terrain types, movement costs, passability checks
- `mapGeneration.js` - Main entry point for battle map generation (8-phase archetype-based system)
- `mapgen/` - **Battle map generation modules:**
  - `AlgorithmPipeline.js` - Orchestrates algorithm selection and execution
  - `algorithms/` - Perlin noise, cellular automata, room carving, path carving, cluster placement
  - `archetypes/` - Curated map style definitions (cave, forest, mountain, etc.)
  - `graph/` - Graph-based topology and POI generation
  - `PRNGStreams.js` - Deterministic random number generation with multiple streams
- `pathfinding.js` - Dijkstra and A* algorithms for movement/pathing
- `battleMath.js` - Damage formulas, hit/crit calculations for combat previews
- `nameData.js` - Procedural name generation data for NPCs/recruits
- All modules use ESM; imported by API (direct imports) and frontend (via Vite `@shared` alias)

### Admin Dashboard (`admin/`)
- **Stack:** React 18 + Vite + Tailwind CSS + Radix UI
- **Purpose:** Asset generation management for AI-generated images and audio
- **Entry:** `src/main.jsx` → `src/App.jsx` (React Router)
- **Pages:** Dashboard, Tiles, Portraits, Items, Icons, Nodes, Overlays, Music, SoundEffects, Settings
- **Key features:**
  - Real-time generation status via WebSocket
  - Asset preview with variant selection (32px/48px/64px sizes)
  - Regeneration queue management
  - Theme customization and backup management
- **API routes:** `api/src/routes/admin.js`, `api/src/routes/adminAudio.js`
- **Testing:** Vitest + React Testing Library + MSW for mocking

### E2E Tests (`e2e/`)
- **Config:** `playwright.config.js` - Auto-starts API and frontend servers
- **Browsers:** Chromium, Firefox, WebKit, Mobile Chrome
- **Debug output:** `playwright-report/` (HTML), screenshots/video on failure
- **Pattern:** Page Object Model in `e2e/fixtures/` for reusable interactions

### Data Flow
1. Frontend scenes call `api/client.js` for HTTP requests
2. API routes validate via middleware (`auth.js`, `rateLimiter.js`)
3. Routes query PostgreSQL with parameterized queries
4. Real-time updates pushed via WebSocket rooms

### Battle System (`api/src/services/` + `frontend/src/battle/`)
Multi-file system spanning backend and frontend:
- **Backend:** `battleService.js` (damage formulas, status effects), `battleWebsocket.js` (real-time sync), `battleTurnManager.js` (async turn processing), `battleReconnection.js` (state persistence), `aiService.js` + `services/ai/*.js` (utility-based AI with lookahead)
- **Frontend:** `BattleScene.js` orchestrates `BattleGrid.js` (tactical grid), `BattleUnit.js` (unit rendering), `BattleUI.js` (HUD), `BattleAnimations.js`, `BattlePathfinding.js`, `BattleCamera.js`, `BattleIntro.js`, `BattleWebSocketManager.js` (WebSocket events and turn queue)
- Damage formulas: Physical = `(STR + equipment) * skillPower - (VIT + defense) * 0.15`; Magic = `(INT + magicAttack) * skillPower - (INT + magicDefense) * 0.075`
- Turn order based on agility + random variance

### Activity Nodes
Four activity node types with dedicated routes and services:
- **Fishing** (`fishingService.js`, `FishingScene.js`) - Auto-fishing with Big One events, 15 fish types
- **Ruins** (`ruins.js`, `RuinsPuzzleModal.js`) - 3x3/4x4/5x5 sliding puzzles with regional themes
- **Caravan** (`caravanService.js`, `ShopScene.js`) - 23 exclusive items with 48-hour seeded refresh
- **Watchtower** (`world.js`) - Fog reveal endpoint for map exploration

### Coliseum System (`api/src/services/coliseum/`)
PvP matchmaking and ranked battles:
- `index.js` - Main service orchestrator and public API
- `matchmaking.js` - ELO-based queue and player matching
- `matchLifecycle.js` - Match state machine (pending → active → complete)
- `turnTimer.js` - Turn timeout enforcement
- `statistics.js` - ELO calculations, win/loss tracking
- `queueBroadcaster.js` - Real-time queue position updates
- `constants.js` - Match config (turn limits, ELO K-factors)

### WebSocket Protocol
Room-based subscriptions at `/ws`:
- **Message types:** `auth`, `join_room`, `leave_room`, `chat_message`, `party_*`, `battle_*`, `coliseum_*`
- **Rooms:** `chat:global`, `tavern:{nodeId}`, `marketplace`, `party:{partyId}`, `battle:{battleId}`, `coliseum:{matchId}`
- Services: `chatService.js`, `presenceService.js`, `partyWebsocket.js`, `battleWebsocket.js`, `coliseumService.js`, `marketplaceWebsocket.js`

## Key Patterns

**Database queries:** Always use parameterized queries (`$1, $2`) via the pool in `src/config/database.js`

**World generation:** Deterministic from `WORLD_SEED` env var using `SeededRandom` - same seed always produces same world layout. The system uses a 5-region structure with Voronoi partitioning.

**Unit conversion:** 1 worldgen unit = 30 pixels. Max node spacing is 13.3 units (400px) - connections exceeding this trigger gap infill with intermediate nodes.

Worldgen modules in `api/src/db/worldgen/`:
- `castlePlacement.js` - Force-directed + Lloyd's relaxation for castle positions
- `voronoiPartitioning.js` - Region boundaries from castle positions
- `nodeGeneration.js` - Poisson disk sampling within each region
- `internalConnections.js` - MST + extra connections per region
- `interRegionConnections.js` - Bridges, wilderness zones, trade routes, palace, gap infill
- `validation.js` - Terminators, difficulty tiers, connectivity checks, max spacing validation
- `constants.js` - All worldgen configuration including thematic naming pools

**Environment variables:** Key env vars in `.env`:
- `DEBUG=true` - Enable detailed query logging and debug output
- `WORLD_SEED` - Seed for deterministic world generation
- `TEST_RATE_LIMITS=true` - Required to run rate limiter tests
- `NODE_ENV=production` - Enables stricter rate limits (600 base vs 1500 dev)

**Rate limiting:** Per-user rate limiting via `rateLimiterFactory.js`. Key limiters:
- `auth/refresh` - 20/15min per IP (unauthenticated)
- `world/travel` - 60/min per user (authenticated)
- Global limits scale by environment (300 base, 600 prod, 1500 dev)

**Character stats:** Base stats from race + (class growth × level) - see `calculateStats()` in `shared/constants.js`

**Scene lifecycle:** `enter()` → `update(dt)` / `render(ctx)` loop → `exit()` - scenes manage their own state and cleanup

**Responsive design:** Use `responsive` singleton from `src/core/Responsive.js` for breakpoint detection (`isMobile()`, `isTablet()`, `isDesktop()`). Scenes can override `onBreakpointChange()` and subscribe via `responsive.onChange()`.

**UI components:** Parchment UI system in `src/ui/parchment/` - use `ParchmentPanel`, `ParchmentModal`, `parchmentToast` for consistent game UI. Button variants: `primary`, `secondary`, `danger`, `ghost`.

## Security Best Practices

**CRITICAL:** The `validate-plan` skill (v4.1+) **blocks commits** for security violations. See `docs/ESTABLISHED_PATTERNS.md` Section 9 for full patterns.

| Pattern | ✅ Do This | ❌ Not This |
|---------|-----------|-------------|
| DB queries | `query('...WHERE id=$1', [id])` | `query(\`...WHERE id=${id}\`)` |
| User identity | `req.user.id` (from JWT) | `req.body.userId` (client-provided) |
| Ownership | `WHERE id=$1 AND user_id=$2` | `WHERE id=$1` (no user check) |
| Numeric input | `parseInt(val, 10)` + `isNaN()` | Direct `req.body.amount` usage |
| User text | `element.textContent = text` | `element.innerHTML = text` |
| Token validation | `jwt.verify(token, secret)` | `jwt.decode(token)` |
| WS handlers | Check `userId` first line | Process without auth check |
| Error responses | `{ error: 'Failed' }` | `{ error: err.stack }` |

**Testing:** Tests are organized into subdirectories:
- `integration/` - Require API server running (hit live endpoints)
- `unit/` - Fast tests, no server required
- `balance/` - Damage formulas, class viability, economy curves (runs with unit tests)
- `ratelimit/` - Rate limiter validation (requires `TEST_RATE_LIMITS=true`)

Use `testHelper.js` for utilities:
- `createTestUser()`, `createTestCharacter()` - Create test data
- `cleanupTestUser(userId)` - Delete user and cascade (characters, inventory, etc.)
- `registerCleanup(callback)` / `runCleanup()` - Test isolation
- `request()` - HTTP helper for API calls

For WebSocket tests, use `testUtils/wsTestHelper.js` (`createWsClient()`, `waitForMessage()`).

For tests needing multiple users/characters with auto-cleanup, use `createTestContext()`:
```javascript
const ctx = createTestContext();
const user1 = await ctx.createUser();
const char1 = await ctx.createCharacter(user1.accessToken);
// ... test logic ...
await ctx.cleanup(); // Deletes all created users/characters
```

## Critical Technical Gotchas

Hard-won lessons from debugging sessions. Full details: `docs/FRONTEND_TECHNICAL_PATTERNS.md`

| Gotcha | Symptom | Quick Fix |
|--------|---------|-----------|
| DeltaTime units | Animation 1000x too fast/slow | `deltaTime / 1000` for physics |
| Sprite sheet layout | Blue/corrupted rendering | Vertical strips: `sourceY = frame * height` |
| TIMESTAMP timezone | Negative stamina values | Type parser in `database.js` appends 'Z' |
| BIGINT string coercion | Level shows 145 instead of 5 | Type parser converts to int |
| Canvas state leaking | Sprites flipped/wrong | Always `ctx.save()` / `ctx.restore()` |
| DOM over canvas | UI in wrong location | Convert with `getBoundingClientRect()` + scale |
| @shared in API | Runtime import error | Use relative paths in API, `@shared` only in frontend |
| HP/MP naming | Shows "0/1" health | API=snake_case, Battle=camelCase; transform when needed |

**Most common issues:**

```javascript
// DeltaTime: Game loop passes milliseconds
update(deltaTime) {
  const dt = deltaTime / 1000; // Convert to seconds for physics
}

// Shared imports: API must use relative paths
// WRONG in API:  import { X } from '@shared/constants.js';
// CORRECT in API: import { X } from '../../../shared/constants.js';
```

## File Size Guidelines

File size limits prevent monolithic files. Full patterns: `docs/ESTABLISHED_PATTERNS.md` Section 10.

| Lines | Level | Action |
|-------|-------|--------|
| 500 | Target | Ideal file size |
| 1500 | Warning | Requires module summary comment |
| **3500** | **BLOCKING** | Must modularize before commit |

**Key patterns:** Re-export wrapper, domain module directories, scene component extraction. Use `wc -l` to check files.

## Subagents

This project has specialized subagents in `.claude/agents/`. **Using subagents is MANDATORY for all non-trivial tasks.** Subagent-driven development produces better results through domain-specific expertise. Use the Task tool with the appropriate `subagent_type`:

| Agent | Use Case |
|-------|----------|
| `frontend-developer` | Canvas 2D, scenes, vanilla JS UI |
| `backend-developer` | Express routes, services, PostgreSQL |
| `fullstack-developer` | End-to-end features spanning frontend/backend |
| `battle-systems-developer` | Combat, AI, damage formulas |
| `websocket-engineer` | Real-time features, room subscriptions |
| `postgres-pro` | Database optimization, queries |
| `debugger` | Bug investigation, state sync issues |
| `game-developer` | Game loop, procedural generation |
| `worldgen-specialist` | World map generation, Voronoi, MST, graph connectivity |
| `ui-ux-specialist` | Canvas UI design, responsive layouts |
| `qa-expert` | Testing strategies, validation |
| `code-reviewer` | Code quality review |
| `architect-reviewer` | System design review |
| `performance-engineer` | Optimization, profiling |
| `security-auditor` | Security review, OWASP checks |
| `javascript-pro` | ES2023+ features, async patterns, memory management |
| `test-automator` | Test framework, CI pipeline, E2E automation |
| `refactoring-specialist` | File size enforcement, modularization patterns |
| `documentation-maintainer` | Roadmaps, archives, spec synchronization |
| `documentation-checker` | Code-to-doc mapping, stale detection, API doc verification |
| `economy-balance-designer` | Gold flow, XP curves, item pricing, drop rates |
| `asset-pipeline-specialist` | AI image/audio generation, sprite conventions |
| `debt-detector` | Pattern conformance, coupling analysis, architecture drift |

### Subagent Enforcement Rules

**MANDATORY**: All plan execution and implementation tasks MUST dispatch subagents unless explicitly exempt.

**Exemptions (subagent optional):**
- Single-file changes under 10 lines
- Typo fixes and documentation corrections
- Simple renames or moves
- Direct user instruction to skip

**Selection Rules (Specificity First):**
1. Use the MOST SPECIALIZED agent that covers the task domain
2. When scope spans multiple domains, use `fullstack-developer` as coordinator
3. Never use a general agent when a specialist exists

| Task Domain | Primary Agent | Fallback |
|------------|---------------|----------|
| World map generation | `worldgen-specialist` | `game-developer` |
| Battle mechanics | `battle-systems-developer` | `game-developer` |
| Database queries | `postgres-pro` | `backend-developer` |
| Canvas rendering | `frontend-developer` | `ui-ux-specialist` |
| Real-time features | `websocket-engineer` | `backend-developer` |
| Economy/balance | `economy-balance-designer` | `game-developer` |
| File size issues | `refactoring-specialist` | `architect-reviewer` |
| Security concerns | `security-auditor` | `code-reviewer` |

**Parallel Dispatch:**
- Launch independent tasks as parallel subagents (single message, multiple Task tool calls)
- Use `blockedBy` for sequential dependencies
- Maximum 3-4 concurrent agents for context management

**Handoff Protocol:**
- If a subagent identifies an issue requiring different expertise, auto-dispatch the appropriate specialist
- Example: backend-developer finds security issue → dispatch security-auditor
- Always pass context from the originating agent to the specialist

**Review pairing:** After implementation, pair with a reviewer — `code-reviewer` for API, `ui-ux-specialist` for frontend, `architect-reviewer` for cross-cutting/database, `qa-expert` for battle/economy, `security-auditor` for WebSocket/auth surfaces.

## Deployment

**Production deploys are run from a workstation via the `lsd` CLI.** Configuration lives in `deploy.yaml`. There are no project-local deploy scripts (`scripts/deploy/` and `ecosystem.config.js` were removed in v0.5.0). PM2 process layout, nginx config, and `.env.production` are all rendered on the VPS by `lsd` at deploy time; secrets come from `lsd-vault`.

```bash
lsd plan modia              # print every phase + remote command (non-mutating)
lsd deploy modia            # deploy latest git tag
lsd deploy modia v0.5.0     # deploy a specific tag
lsd status modia            # current version + health
lsd history modia           # append-only ledger
lsd rollback modia          # roll back to previous release
```

Standard release flow: bump `package.json` version → commit → `git tag v<X.Y.Z>` → `git push --tags` → `lsd deploy modia`. Full reference: `docs/DEPLOYMENT.md`.

Health endpoint: `https://modia.mittonvillage.com/api/health`. Production runs on port 3110 (proxied by nginx).

## CI Pipeline

No GitHub Actions are wired up after the v0.5.0 lsd migration — legacy `.github/workflows/` was removed alongside the bash deploy scripts. Reintroduce CI workflows against `lsd`-managed deploys when needed; in the meantime, run lint/tests locally before tagging.

## Documentation

Detailed specifications in `docs/`. Key files:

**Planning & Architecture:**
- `DEVELOPMENT_COMMANDS.md` - Full command reference for dev, test, assets, audio, AI generation
- `DEVELOPMENT_ROADMAP.md` - Links to `ROADMAP_TECHNICAL.md` and `ROADMAP_GAMEPLAY.md`
- `TECHNICAL_ARCHITECTURE.md` - System design, database schemas
- `DEPLOYMENT.md` - Production deploy workflow (lsd CLI, deploy.yaml, secrets, rollback)
- `WORLDGEN_TECHNICAL_DEEP_DIVE.md` - 6-phase world generation algorithms, constants, gotchas
- `API_SPECIFICATION.md` - REST and WebSocket endpoints
- `FRONTEND_TECHNICAL_PATTERNS.md` - Critical gotchas and component patterns
- `ESTABLISHED_PATTERNS.md` - Canonical code patterns, security patterns, conformance checklists

**Game Systems:**
- `GAME_DESIGN.md` - Combat mechanics, class progression, world design
- `SKILL_TREES.md` - Skill definitions for 8 guilds (4 base + 4 advanced)
- `CHARACTER_PROGRESSION.md` - Formation, skill trees, guild advancement
- `ITEM_SYSTEM.md` - Equipment, rarity, drop tables
- `ENEMY_SYSTEM.md` - Enemy templates, AI archetypes, scaling
- `ECONOMY_SYSTEM.md` - Shops, marketplace, gold flow

**Battle System:**
- `BATTLE_SYSTEM_INDEX.md` - Unified navigation, component cross-reference, quick reference tables
- `BATTLE_TURN_SYSTEM.md` - CT-based turn order, two-action system
- `BATTLE_MESSAGING_PROTOCOL.md` - Hybrid HTTP/WebSocket battle protocol
- `BATTLE_ANIMATIONS.md` - Visual feedback, intent visualization
- `BATTLE_MODES.md` - PvE, PvP, Coliseum modes
- `BATTLE_RECONNECTION.md` - State persistence and reconnection
- `AI_SYSTEM.md` - Enemy AI behavior trees and utility functions
- `STATUS_EFFECTS.md` - Status effect taxonomy, cleansing tiers, resistance formulas

**UI & Assets:**
- `ASSET_SYSTEM_INDEX.md` - Unified asset pipeline navigation and quick reference
- `ASSET_PATH_CONFIGURATION.md` - Single source of truth (`shared/assetPaths.js`), consumer integration
- `ASSET_METADATA_SCHEMA.md` - JSON metadata conventions, underscore prefix pattern, category schemas
- `DESIGN_SYSTEM.md` - Parchment UI components, theming, responsive patterns
- `AI_IMAGE_GENERATION.md` - AI image generation pipeline, style guide, prompts
- `AUDIO_STYLE_GUIDE.md` - Audio prompt guidelines, regional music profiles, SFX patterns

**Archive:** `docs/archive/completed/COMPLETED_MILESTONES.md` - Archived completed work

**Archive structure:**
- `docs/archive/completed/` - Milestone tracking
- `docs/archive/design-docs/` - Dated design documents
- `docs/archive/deprecated/` - Superseded document versions
- `docs/archive/reports/` - Validation and analysis reports

**Roadmap maintenance:** Keep roadmaps fresh by moving completed items to `docs/archive/completed/`.

## Plan Execution Workflow

**CRITICAL: All plan execution MUST use subagent-driven development.**

### Before Starting Implementation
1. Review the plan file for task breakdown
2. Identify which subagent handles each task (use Specificity First rule)
3. Group independent tasks for parallel dispatch
4. Identify sequential dependencies

### During Implementation
1. **Dispatch subagents** using the Task tool with appropriate `subagent_type`
2. **Parallel tasks**: Launch in a single message with multiple Task tool calls
3. **Sequential tasks**: Wait for blocking tasks to complete before dispatching dependent tasks
4. **Monitor progress**: Check subagent outputs and verify completion
5. **Handle issues**: Auto-dispatch specialists when subagents report domain-specific problems

### Subagent Dispatch Template
```
Task(
  description: "Brief task summary",
  prompt: "Full context from plan, affected files, requirements, verification criteria",
  subagent_type: "appropriate-agent-name"
)
```

### Multi-Agent Coordination Example
```
// Frontend + Backend work in parallel
Task(subagent_type: "frontend-developer", prompt: "Implement CharacterCard component...")
Task(subagent_type: "backend-developer", prompt: "Add /api/characters/:id endpoint...")

// Then integration (sequential)
Task(subagent_type: "fullstack-developer", prompt: "Wire frontend to API, verify end-to-end...")
```

### Quality Gates (After Each Task)
- Run tests: `npm run test -w api` or `npm run test -w frontend`
- Run lint: `npm run lint`
- Verify file sizes under limits

### Validation
After completing a plan, use the `validate-plan` skill to:
- Run code-reviewer, debt-detector, qa-expert in parallel
- Remediate any issues via appropriate subagents
- Auto-commit after all issues resolved

### Prohibited Patterns
- Implementing plan tasks directly without dispatching subagents
- Using general agents when specialists exist
- Running sequential tasks that could be parallelized
- Skipping verification after subagent completion

### Legacy Code Policy
- Avoid creating legacy fallbacks when implementing new backend functionality or frontend components
- Always use the newly implemented components over legacy code and delete the legacy code
- When planning, seek advice from multiple agents for complex implementations and ask clarifying questions when they provide different opinions