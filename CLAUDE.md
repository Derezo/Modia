# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Modia is a browser-based MMORPG with tactical turn-based combat and procedural world generation. It's a monorepo with three workspaces: `api/` (Node.js/Express backend), `frontend/` (vanilla JS client with Canvas 2D), and `shared/` (constants used by both).

## Development Commands

```bash
# Start PostgreSQL (required first)
docker compose up -d

# Copy environment variables
cp .env.example .env

# Install dependencies
npm install

# Run database migrations
npm run db:migrate

# Seed the world (procedural generation)
npm run db:seed

# Development (starts both API and frontend)
npm run dev

# Or run individually:
npm run dev:api        # API on port 3000
npm run dev:frontend   # Frontend on port 8080

# Linting
npm run lint

# Testing (server must be running - tests hit live endpoints)
npm run test                            # All workspaces
npm run test -w api                     # API tests only
node --test api/src/tests/auth.test.js  # Single test file (Node's built-in test runner)

# E2E Testing (Playwright - auto-starts servers)
npx playwright test                     # Run all E2E tests
npx playwright test e2e/auth.spec.js    # Single spec file
npx playwright test --ui                # Interactive UI mode
npx playwright show-report              # View HTML report

# Balance Testing (game balance validation)
node --test api/src/tests/balance/damageScaling.test.js
node --test api/src/tests/balance/classBalance.test.js
node --test api/src/tests/balance/economyBalance.test.js

# Database utilities
npm run db:reset                        # Re-run migrations + seed
npm run db:status                       # Show applied vs pending migrations
npm run db:fresh                        # Drop all tables, re-migrate, re-seed
npm -w api run migrate:rollback         # Roll back last migration

# Development environment
npm run dev:setup                       # Smart startup: checks ports, Docker, migrations, seeds, launches
npm run doctor                          # Validate dev environment (Node, Docker, DB, ports, .env)

# Asset Generation (requires PIXELLAB_API_KEY in .env)
npm run generate:all            # Generate all assets
npm run generate:tiles          # Tileset sprites
npm run generate:obstacles      # Obstacle sprites
npm run generate:characters     # Character sprites
npm run generate:enemies        # Enemy sprites
npm run generate:items          # Item sprites
npm run generate:nodes          # World map node sprites
npm run generate:portraits      # Character portraits
npm run generate:backdrop       # World map backdrop
npm run validate:sprites        # Validate all sprite prompts
npm run validate:enemy          # Validate enemy prompts only
npm run validate:character      # Validate character prompts only
```

## Architecture

### Backend (`api/`)
- **Entry point:** `src/index.js` - Express server with WebSocket upgrade
- **Routes:** `src/routes/` - auth, characters, party, world, battle, inventory, skills, shop, marketplace, chat, sprites, guild, coliseum, friends, lfg, notifications, settings
- **WebSocket:** `src/websocket/index.js` - Room-based subscriptions for chat, tavern presence, marketplace
- **Database:** PostgreSQL via `pg` pool in `src/config/database.js`
- **Migrations:** `src/migrations/` - Sequential SQL files (001_initial_schema.sql, etc.)
- **Auth:** JWT with 15min access tokens, 7-day refresh tokens
- **Asset Generation:** `src/scripts/` - PixelLab API integration for procedural sprite generation

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

**Character stats:** Base stats from race + (class growth × level) - see `calculateStats()` in `shared/constants.js`

**Scene lifecycle:** `enter()` → `update(dt)` / `render(ctx)` loop → `exit()` - scenes manage their own state and cleanup

**Testing:** Tests require the API server to be running. Use `testHelper.js` for test utilities (`createTestUser()`, `createTestCharacter()`, `request()`). For WebSocket tests, use `wsTestHelper.js` (`createWsClient()`, `waitForMessage()`). Balance tests in `api/src/tests/balance/` validate damage formulas, class viability, and economy curves.

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

## Subagents

This project has specialized subagents in `.claude/agents/` for different domains (frontend, backend, battle systems, debugging, etc.). **Using subagents is strongly encouraged** - they have domain-specific context and produce better results than working without them. Use the Task tool with the appropriate `subagent_type` to invoke them.

## Documentation

Detailed specifications, game design docs, and API references are in `docs/`.

**Roadmap maintenance:** Keep `docs/DEVELOPMENT_ROADMAP.md` fresh by removing completed items consistently and adding new todo or deferred items as they arise during development.
