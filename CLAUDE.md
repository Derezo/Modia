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
npm -w api run migrate:rollback         # Roll back last migration

# Asset Generation (requires PIXELLAB_API_KEY in .env)
npm run generate:all            # Generate all assets
npm run generate:tiles          # Tileset sprites
npm run generate:obstacles      # Obstacle sprites
npm run generate:characters     # Character sprites
npm run generate:enemies        # Enemy sprites
npm run generate:items          # Item sprites
npm run generate:nodes          # World map node sprites
npm run validate:sprites        # Validate all sprite prompts
npm run validate:enemy          # Validate enemy prompts only
npm run validate:character      # Validate character prompts only
```

## Architecture

### Backend (`api/`)
- **Entry point:** `src/index.js` - Express server with WebSocket upgrade
- **Routes:** `src/routes/` - auth, characters, party, world, battle, inventory, skills, shop, marketplace, chat, sprites
- **WebSocket:** `src/websocket/index.js` - Room-based subscriptions for chat, tavern presence, marketplace
- **Database:** PostgreSQL via `pg` pool in `src/config/database.js`
- **Migrations:** `src/migrations/` - Sequential SQL files (001_initial_schema.sql, etc.)
- **Auth:** JWT with 15min access tokens, 7-day refresh tokens
- **Asset Generation:** `src/scripts/` - PixelLab API integration for procedural sprite generation

### Frontend (`frontend/public/`)
- **No build step** - Vanilla ES modules served directly
- **Entry:** `src/main.js` → `src/core/Game.js`
- **Scene-based architecture:** `src/scenes/` - Each screen extends base `Scene.js` (Login, Register, CharacterSelect, CharacterCreate, WorldMap, Battle, Inventory, Shop, Marketplace, Tavern, Formation)
- **Game loop:** RequestAnimationFrame with `update(deltaTime)` → `render(ctx)` cycle
- **Canvas layers:** Background, Game, HUD, Modal (rendered in order)

### Shared (`shared/`)
- `constants.js` - Races, classes, stat formulas, `SeededRandom` class (Mulberry32)
- Imported by both API (CommonJS) and frontend (ES modules)

### Data Flow
1. Frontend scenes call `api/client.js` for HTTP requests
2. API routes validate via middleware (`auth.js`, `rateLimiter.js`)
3. Routes query PostgreSQL with parameterized queries
4. Real-time updates pushed via WebSocket rooms

## Key Patterns

**Database queries:** Always use parameterized queries (`$1, $2`) via the pool in `src/config/database.js`

**World generation:** Deterministic from `WORLD_SEED` env var using `SeededRandom` - same seed always produces same world layout

**Character stats:** Base stats from race + (class growth × level) - see `calculateStats()` in `shared/constants.js`

**Scene lifecycle:** `enter()` → `update(dt)` / `render(ctx)` loop → `exit()` - scenes manage their own state and cleanup

**Testing:** Tests require the API server to be running. Use `testHelper.js` for test utilities (`createTestUser()`, `createTestCharacter()`, `request()`)

## Documentation

Detailed specifications are in `docs/`:
- `TECHNICAL_ARCHITECTURE.md` - Database schemas, system design
- `API_SPECIFICATION.md` - REST endpoints and WebSocket protocol
- `GAME_DESIGN.md` - Combat formulas, world structure
- `CHARACTER_PROGRESSION.md`, `SKILL_TREES.md` - Skills and guild system
- `ITEM_SYSTEM.md`, `ECONOMY_SYSTEM.md`, `ENEMY_SYSTEM.md` - Game mechanics
- `PIXELLAB_REFERENCE.md` - PixelLab API usage for sprite generation
- `DEVELOPMENT_ROADMAP.md` - Feature roadmap and implementation status
