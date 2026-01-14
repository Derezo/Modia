# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Modia is a browser-based MMORPG with tactical turn-based combat and procedural world generation. It's a monorepo with three workspaces: `api/` (Node.js/Express backend), `frontend/` (vanilla JS client with Canvas 2D), and `shared/` (constants used by both).

## Development Commands

```bash
# Quick start (after initial setup)
npm run dev:setup                       # Smart startup: checks ports, Docker, migrations, seeds, launches

# Manual startup
docker compose up -d                    # Start PostgreSQL (required first)
npm run dev                             # Start both API (port 3000) and frontend (port 8080)

# Individual services
npm run dev:api                         # API only
npm run dev:frontend                    # Frontend only

# Testing (server must be running - integration tests hit live endpoints)
npm run test                            # All workspaces (unit + integration + ratelimit)
npm run test -w api                     # API tests only
npm run test:unit -w api                # Unit tests + balance tests (fast, no server needed)
npm run test:integration -w api         # Integration tests (requires running server)
npm run test:ratelimit -w api           # Rate limit tests (TEST_RATE_LIMITS=true)
npm run test:quick -w api               # Alias for test:unit
npm run test -w shared                  # Shared module tests (battleMath, pathfinding, etc.)
node --test api/src/tests/integration/auth.integration.test.js  # Single test file

# E2E Testing (Playwright - auto-starts servers)
npx playwright test                     # Run all E2E tests
npx playwright test e2e/auth.spec.js    # Single spec file
npx playwright test --ui                # Interactive UI mode
npx playwright test --headed            # Run with visible browser
npx playwright test --debug             # Debug mode with inspector

# Database utilities
npm run db:migrate                      # Run pending migrations
npm run db:seed                         # Seed the world (procedural generation)
npm run db:reset                        # Re-run migrations + seed
npm run db:fresh                        # Drop all tables, re-migrate, re-seed
npm -w api run migrate:rollback         # Roll back last migration

# Other
npm run lint                            # Run ESLint
npm run doctor                          # Validate dev environment

# Asset Generation (requires Sharp)
npm run generate:all                    # Generate all sprite assets
npm run generate:characters             # Character sprites only
npm run generate:enemies                # Enemy sprites only
npm run generate:nodes                  # World map node icons
npm run generate:items                  # Item/equipment icons
npm run generate:icons                  # UI icons
```

## Architecture

### Backend (`api/`)
- **Entry point:** `src/index.js` - Express server with WebSocket upgrade
- **Routes:** `src/routes/` - auth, characters, party, world, battle, inventory, skills, shop, marketplace, chat, guild, coliseum, friends, lfg, notifications, settings
- **WebSocket:** `src/websocket/index.js` - Room-based subscriptions for chat, tavern presence, marketplace
- **Database:** PostgreSQL via `pg` pool in `src/config/database.js`
- **Migrations:** `src/migrations/` - Sequential SQL files (001_initial_schema.sql, etc.)
- **Auth:** JWT with 15min access tokens, 7-day refresh tokens

### Frontend (`frontend/`)
- **Build tool:** Vite for dev server and bundling
- **Entry:** `src/main.js` → `src/core/Game.js`
- **Scene-based architecture:** `src/scenes/` - Each screen extends base `Scene.js` (Login, Register, CharacterSelect, CharacterCreate, WorldMap, Battle, Inventory, Shop, Marketplace, Tavern, Formation)
- **Game loop:** RequestAnimationFrame with `update(deltaTime)` → `render(ctx)` cycle
- **Canvas layers:** Background, Game, HUD, Modal (rendered in order)
- **Static assets:** `public/assets/` - sprites, images served at `/assets/`
- **Shared imports:** Uses `@shared/` alias to import from shared workspace

### Shared (`shared/`)
- `constants.js` - Races, classes, stat formulas, `SeededRandom` class (Mulberry32)
- `terrain.js` - Terrain types, movement costs, passability checks
- `mapGeneration.js` - Seeded terrain and obstacle generation for battle maps
- `pathfinding.js` - Dijkstra and A* algorithms for movement/pathing
- `battleMath.js` - Damage formulas, hit/crit calculations for combat previews
- `nameData.js` - Procedural name generation data for NPCs/recruits
- All modules use ESM; imported by API (direct imports) and frontend (via Vite `@shared` alias)

### Data Flow
1. Frontend scenes call `api/client.js` for HTTP requests
2. API routes validate via middleware (`auth.js`, `rateLimiter.js`)
3. Routes query PostgreSQL with parameterized queries
4. Real-time updates pushed via WebSocket rooms

### Battle System (`api/src/services/` + `frontend/src/battle/`)
Multi-file system spanning backend and frontend:
- **Backend:** `battleService.js` (damage formulas, status effects), `battleWebsocket.js` (real-time sync), `battleTurnManager.js` (async turn processing), `battleReconnection.js` (state persistence), `aiService.js` + `services/ai/*.js` (utility-based AI with lookahead)
- **Frontend:** `BattleScene.js` orchestrates `BattleGrid.js` (tactical grid), `BattleUnit.js` (unit rendering), `BattleUI.js` (HUD), `BattleAnimations.js`, `BattlePathfinding.js`, `BattleCamera.js`, `BattleIntro.js`
- Damage formulas: Physical = `(STR + equipment) * skillPower - (VIT + defense) * 0.15`; Magic = `(INT + magicAttack) * skillPower - (INT + magicDefense) * 0.075`
- Turn order based on agility + random variance

### WebSocket Protocol
Room-based subscriptions at `/ws`:
- **Message types:** `auth`, `join_room`, `leave_room`, `chat_message`, `party_*`, `battle_*`, `coliseum_*`
- **Rooms:** `chat:global`, `tavern:{nodeId}`, `marketplace`, `party:{partyId}`, `battle:{battleId}`, `coliseum:{matchId}`
- Services: `chatService.js`, `presenceService.js`, `partyWebsocket.js`, `battleWebsocket.js`, `coliseumService.js`, `marketplaceWebsocket.js`

## Key Patterns

**Database queries:** Always use parameterized queries (`$1, $2`) via the pool in `src/config/database.js`

**World generation:** Deterministic from `WORLD_SEED` env var using `SeededRandom` - same seed always produces same world layout

**Environment variables:** Key env vars in `.env`:
- `DEBUG=true` - Enable detailed query logging and debug output
- `WORLD_SEED` - Seed for deterministic world generation
- `TEST_RATE_LIMITS=true` - Required to run rate limiter tests

**Character stats:** Base stats from race + (class growth × level) - see `calculateStats()` in `shared/constants.js`

**Scene lifecycle:** `enter()` → `update(dt)` / `render(ctx)` loop → `exit()` - scenes manage their own state and cleanup

**Responsive design:** Use `responsive` singleton from `src/core/Responsive.js` for breakpoint detection (`isMobile()`, `isTablet()`, `isDesktop()`). Scenes can override `onBreakpointChange()` and subscribe via `responsive.onChange()`.

**UI components:** Parchment UI system in `src/ui/parchment/` - use `ParchmentPanel`, `ParchmentModal`, `parchmentToast` for consistent game UI. Button variants: `primary`, `secondary`, `danger`, `ghost`.

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

These are hard-won lessons from debugging sessions. Read before making changes to these systems.

### Game Loop and DeltaTime

**CRITICAL:** `Game.js` passes `deltaTime` in **milliseconds** to all scenes/components. Components that need physics/animation calculations must convert to seconds internally:

```javascript
update(deltaTime) {
  const dt = deltaTime / 1000; // Convert ms to seconds for physics
  this.velocity += this.acceleration * dt;
}
```

See `docs/FRONTEND_TECHNICAL_PATTERNS.md` for the full convention and component reference table.

### Character Sprite Sheets

All character sprites are **vertical strips** (64x512 pixels = 8 frames stacked vertically):

```
Frame extraction: sourceY = frameIndex * frameHeight, NOT sourceX
Frames 0-3: Idle animation
Frames 4-7: Walk/action animation
```

**Common mistake:** Assuming horizontal layout causes blue/corrupted rendering.

### PostgreSQL TIMESTAMP Timezone Bug

PostgreSQL `TIMESTAMP` (without timezone) is parsed by Node.js as **local time**, not UTC. This caused stamina calculations to return -143 instead of 7.

**Fix in `database.js`:**
```javascript
pg.types.setTypeParser(1114, (val) => val === null ? null : new Date(val + 'Z'));
```

See `docs/TECHNICAL_ARCHITECTURE.md` section 3.5 for details.

### Canvas Context State

Always save/restore canvas state when making transformations:
```javascript
ctx.save();
ctx.translate(x, y);
ctx.scale(-1, 1);
ctx.drawImage(sprite, ...);
ctx.restore(); // CRITICAL
```

### Canvas-to-Viewport Coordinate Conversion

When positioning DOM elements over canvas content, canvas coordinates do NOT equal viewport coordinates due to scaling and centering:

```javascript
// Convert canvas coords to viewport coords for DOM positioning
const rect = this.game.canvas.getBoundingClientRect();
const scale = this.game.scale;
const viewportX = rect.left + (canvasX * scale);
const viewportY = rect.top + (canvasY * scale);
```

**Common mistake:** Using canvas coordinates directly for DOM positioning causes elements to appear in wrong location, especially with non-square viewports.

See `docs/FRONTEND_TECHNICAL_PATTERNS.md` Section 10 for full details and examples.

## Subagents

This project has specialized subagents in `.claude/agents/`. **Using subagents is strongly encouraged** - they have domain-specific context and produce better results. Use the Task tool with the appropriate `subagent_type`:

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
| `ui-ux-specialist` | Canvas UI design, responsive layouts |
| `qa-expert` | Testing strategies, validation |
| `code-reviewer` | Code quality review |
| `architect-reviewer` | System design review |
| `performance-engineer` | Optimization, profiling |
| `security-auditor` | Security review, OWASP checks |

## CI Pipeline

Pull requests run: lint → API tests → E2E tests (Playwright) → build. The pipeline requires PostgreSQL and auto-starts servers for testing.

## Documentation

Detailed specifications in `docs/`. Key files:
- `DEVELOPMENT_ROADMAP.md` - Links to `ROADMAP_TECHNICAL.md` and `ROADMAP_GAMEPLAY.md`
- `TECHNICAL_ARCHITECTURE.md` - System design, database schemas
- `API_SPECIFICATION.md` - REST and WebSocket endpoints
- `FRONTEND_TECHNICAL_PATTERNS.md` - Critical gotchas and component patterns
- `archive/COMPLETED_MILESTONES.md` - Archived completed work

**Roadmap maintenance:** Keep roadmaps fresh by moving completed items to `docs/archive/`.
