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

**Testing:** Tests require the API server to be running. Use `testHelper.js` for test utilities (`createTestUser()`, `createTestCharacter()`, `request()`)

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

This project has specialized subagents in `.claude/agents/` that should be used when planning or implementing features. **Use the Task tool with the appropriate `subagent_type` to invoke these agents.**

### When to Use Subagents

| Agent | Use When |
|-------|----------|
| `fullstack-developer` | Building end-to-end features spanning database, API, and UI |
| `game-developer` | Working on game mechanics, Canvas rendering, scene management |
| `battle-systems-developer` | Implementing combat, AI patterns, damage formulas, pathfinding |
| `backend-developer` | Creating REST endpoints, server logic, authentication |
| `frontend-developer` | Building scenes, Canvas UI, vanilla JS components |
| `websocket-engineer` | Adding real-time features, battle sync, chat, party coordination |
| `postgres-pro` | Database schema design, query optimization, migrations |
| `ui-ux-specialist` | UI components, medieval theme styling, player experience |
| `performance-engineer` | Optimizing FPS, API response times, database queries |
| `security-auditor` | Reviewing auth, SQL injection, game economy exploits |
| `code-reviewer` | Code quality review, pattern enforcement, security checks |
| `qa-expert` | Test coverage analysis, game mechanics validation |
| `debugger` | Investigating bugs, rendering issues, state sync problems |
| `architect-reviewer` | Architecture decisions, scalability assessment, technical debt |

### Agent Selection by Task Type

**New Features:**
- Simple feature: `fullstack-developer`
- Battle/combat feature: `battle-systems-developer` + `websocket-engineer`
- UI-heavy feature: `frontend-developer` + `ui-ux-specialist`
- Real-time feature: `websocket-engineer` + `backend-developer`

**Bug Fixes:**
- General debugging: `debugger`
- Performance issues: `performance-engineer`
- Database/query issues: `postgres-pro`
- WebSocket issues: `websocket-engineer`

**Code Quality:**
- Pre-commit review: `code-reviewer`
- Security audit: `security-auditor`
- Architecture review: `architect-reviewer`
- Test coverage: `qa-expert`

**Planning:**
- New game system: `game-developer` + `architect-reviewer`
- API design: `backend-developer`
- Database schema: `postgres-pro`

### Example Invocations

```javascript
// For a new marketplace feature
Task(subagent_type="fullstack-developer", prompt="Implement auction system for marketplace")

// For battle AI improvements
Task(subagent_type="battle-systems-developer", prompt="Add flanking bonus to AI tactical pattern")

// For performance issues
Task(subagent_type="performance-engineer", prompt="Optimize BattleScene render loop")

// For security review
Task(subagent_type="security-auditor", prompt="Audit marketplace transaction endpoints")
```

### Parallel Agent Usage

For complex tasks, run multiple agents in parallel:
- Feature implementation: `fullstack-developer` + `qa-expert` (implement then test)
- Security-critical changes: `backend-developer` + `security-auditor`
- Performance work: `performance-engineer` + `postgres-pro` (frontend + database)

## Documentation

Detailed specifications are in `docs/`:
- `TECHNICAL_ARCHITECTURE.md` - Database schemas, system design
- `FRONTEND_TECHNICAL_PATTERNS.md` - DeltaTime, sprite sheets, camera, debugging gotchas
- `API_SPECIFICATION.md` - REST endpoints and WebSocket protocol
- `GAME_DESIGN.md` - Combat formulas, world structure
- `CHARACTER_PROGRESSION.md`, `SKILL_TREES.md` - Skills and guild system
- `ITEM_SYSTEM.md`, `ECONOMY_SYSTEM.md`, `ENEMY_SYSTEM.md` - Game mechanics
- `AI_SYSTEM.md` - Utility-based AI with multi-actor lookahead
- `BATTLE_*.md` - Turn system, messaging protocol, animations, reconnection
- `GUILD_RECRUITMENT_SYSTEM.md` - NPC recruitment at guild nodes
- `PIXELLAB_REFERENCE.md` - PixelLab API usage for sprite generation
- `DEVELOPMENT_ROADMAP.md` - Feature roadmap and implementation status
