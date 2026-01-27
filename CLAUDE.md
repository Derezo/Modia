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
npm run dev:admin                       # Admin dashboard only (port 5173)
npm run dev:all                         # API + frontend + admin concurrently

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
npm run db:status                       # Show migration status
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

# Audio Generation (requires Suno/ElevenLabs API keys)
npm run audio:generate                  # Generate all audio (music + SFX)
npm run audio:generate:music            # Generate music tracks only
npm run audio:generate:sfx              # Generate sound effects only
npm run audio:download                  # Download generated audio from Suno
npm run audio:validate                  # Validate audio file coverage
npm run audio:status                    # Quick status check of audio files
npm run audio:check                     # Full validation (status + manifest sync)

# Single-track generation with automatic download:
npm run audio:generate:music -- --key heartlands_tavern --wait

# Batch generation (two-step process for music):
npm run audio:generate:music -- --region heartlands
npm run audio:download

# SFX generation is synchronous (files download immediately):
npm run audio:generate:sfx -- --key attack_sword_1

# AI Image Generation (requires HuggingFace API token + image-generator project)
npm run ai:generate                     # Generate all pending images
npm run ai:generate:tiles               # Generate terrain tiles only
npm run ai:generate:portraits           # Generate character portraits only
npm run ai:generate:items               # Generate item sprites only
npm run ai:generate:icons               # Generate UI icons only
npm run ai:generate:nodes               # Generate world map nodes only
npm run ai:status                       # Quick status check of generated images
npm run ai:validate                     # Full validation of image files
npm run ai:migrate-paths                # Migrate assets to canonical paths with size variants

# Single asset generation:
npm run ai:generate:tiles -- --key forest_grass_1 --force
npm run ai:generate:portraits -- --race elf --class wizard

# Batch generation by filter:
npm run ai:generate:tiles -- --biome forest
npm run ai:generate:icons -- --category actions

# Preview without generating:
npm run ai:generate:tiles -- --dry-run
```

### Workspace Structure

The monorepo uses npm workspaces (defined in root `package.json`):

| Workspace | Port | Purpose |
|-----------|------|---------|
| `api/` | 3000 | Node.js/Express backend |
| `frontend/` | 8080 | Vanilla JS game client (Vite) |
| `admin/` | 5173 | React asset manager dashboard (Vite) |
| `shared/` | - | Constants and utilities used by api/frontend |

Workspace-specific commands use `-w` flag: `npm run test -w api`, `npm run lint -w frontend`

### Audio Prompt Guidelines (ElevenLabs SFX)

**CRITICAL: Maximum 1 comma per prompt.** ElevenLabs interprets commas as separate sounds, generating each sequentially (causing 16s files instead of 1s).

| Commas | Status |
|--------|--------|
| 0-1 | OK |
| 2+ | **BLOCKED** |

**Pattern:** Use "with" and "and" instead of commas: `"Fantasy sword slash with sharp metallic whoosh and light impact"`

The `generate-sfx.js` script blocks 2+ commas. Run with `--dry-run` to validate. See `docs/AUDIO_STYLE_GUIDE.md` for full guidelines.

## Architecture

### Backend (`api/`)
- **Entry point:** `src/index.js` - Express server with WebSocket upgrade
- **Routes:** `src/routes/` - auth, characters, party, world, battle, inventory, skills, shop, marketplace, chat, guild, coliseum, friends, lfg, notifications, settings, fishing, ruins, advancementQuest, clans, debug, leaderboard, relics
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

### PostgreSQL BIGINT String Coercion

PostgreSQL `BIGINT` columns are returned as **strings** by node-postgres because JavaScript Number can't safely represent all 64-bit integers. This causes arithmetic bugs when JavaScript performs string concatenation instead of addition:

```javascript
// BUG: String concatenation instead of numeric addition
const spent_xp = character.spent_xp;  // "13235" (string from DB!)
const newTotal = spent_xp + 1000;     // "132351000" (concatenation, not 14235!)
```

This caused the "Level 145" toast bug where skill purchases showed gaining 140+ levels.

**Fix in `database.js`:**
```javascript
pg.types.setTypeParser(20, (val) => val === null ? null : parseInt(val, 10));
```

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

### Shared Module Imports

**CRITICAL:** The `@shared/` import alias ONLY works in the frontend (configured in Vite). The API must use relative paths:

```javascript
// WRONG - API code (will fail at runtime)
import { SeededRandom } from '@shared/constants.js';

// CORRECT - API code (use relative path)
import { SeededRandom } from '../../../shared/constants.js';

// CORRECT - Frontend code (Vite alias works)
import { SeededRandom } from '@shared/constants.js';
```

**Why this happens:** The `@shared` alias is a Vite-specific path mapping. Node.js doesn't recognize it. ESLint is configured to catch this error (`no-restricted-imports` rule in `api/.eslintrc.json`).

## File Size Guidelines

File size enforcement prevents monolithic files that harm maintainability. Oversized files **block plan validation and commits**.

### Thresholds

| Lines | Level | Action |
|-------|-------|--------|
| 500 | Target | Ideal file size |
| 1000 | Notice | Note in review, continue |
| 1500 | Warning | Flag in report, requires module summary comment |
| 2500 | Warning | Strong warning, plan modularization |
| **3500** | **BLOCKING** | **Halt validation, require modularization** |

### Module Summary Requirements

Files exceeding 1500 lines MUST include a module summary comment at the top:

**JavaScript/TypeScript:**
```javascript
/**
 * @module BattleScene
 * @description Orchestrates tactical turn-based combat with grid-based movement.
 *
 * Key responsibilities:
 * - Battle initialization and state management
 * - Turn order and action processing
 * - Unit rendering and animation coordination
 * - WebSocket event handling for multiplayer sync
 *
 * @see BattleGrid.js - Grid rendering and pathfinding
 * @see BattleUnit.js - Individual unit rendering
 * @see BattleUI.js - HUD and action menus
 */
```

This helps AI assistants understand file purpose without reading the entire file.

### Reading Large Files

When working with files >2000 lines, use targeted reading to preserve context:

1. **Read the module summary first** (first 50 lines)
2. **Use grep to find specific functions/sections**
3. **Read in chunks using offset/limit parameters**

Example workflow:
```
# First, understand the file's purpose
Read file_path with limit=50

# Find the specific function you need
Grep for "function handleTurnEnd"

# Read just that section
Read file_path with offset=450, limit=100
```

Avoid reading entire large files unless absolutely necessary.

### Exemptions

- `dist/`, `node_modules/`, `.min.js` files
- Test files (`*.test.js`, `*.spec.js`)
- Migration files (`*.sql`)
- Generated files (sprites, audio metadata)

### Modularization Patterns

**1. Re-export Wrapper Pattern** (used for battleService.js)

Keep the main file as a thin coordinator that re-exports from modules:

```javascript
// battleService.js (wrapper - stays small)
export * from './battle/damageCalculations.js';
export * from './battle/statusEffects.js';
export * from './battle/rewards.js';
export { BattleService } from './battle/BattleService.js';
```

```
services/
  battleService.js          # Re-export wrapper (~50 lines)
  battle/
    damageCalculations.js   # Damage formulas
    statusEffects.js        # Status effect logic
    rewards.js              # XP/loot calculations
    BattleService.js        # Main service class
```

**2. Domain Module Directory**

Group related functionality into a directory with an index:

```
services/ai/
  index.js              # Public exports
  utilityAI.js          # Scoring logic
  lookahead.js          # Simulation
  actionGenerator.js    # Action enumeration
  stateEvaluator.js     # State analysis
```

**3. Scene Component Extraction** (frontend)

Extract rendering/logic into separate files:

```
scenes/
  BattleScene.js        # Orchestration only
battle/
  BattleGrid.js         # Grid rendering
  BattleUnit.js         # Unit rendering
  BattleUI.js           # HUD elements
  BattleAnimations.js   # Animation logic
```

**4. Data Manifest Pattern** (config/templates)

Split large data files by category:

```
audio-metadata/
  sfx/
    combat/
      weapons.json      # Weapon sounds
      deaths.json       # Death sounds
      status-effects.json
    manifest.json       # Index of all categories

ai-image-metadata/
  tiles/                # Battle terrain tiles by biome
    floors/, walls/, slopes/
  portraits/            # Character and enemy portraits
  items/                # Weapons, armor, consumables
  icons/                # UI action icons, status effects
  nodes/                # World map node icons
  manifest.json         # Master index
```

### Tech Debt: Existing Large Files

These files exceed or approach limits and are tracked in `docs/ROADMAP_TECHNICAL.md` section 8.1:

| File | Lines | Status |
|------|-------|--------|
| `frontend/src/scenes/WorldMapScene.js` | 2,951 | WARNING - plan modularization |
| `frontend/src/scenes/BattleScene.js` | 2,947 | WARNING - plan modularization |
| `api/src/services/marketplaceService.js` | 1,956 | WARNING |
| `frontend/src/battle/BattleUI.js` | 1,556 | WARNING - exceeds 1,500 threshold |
| `api/src/services/coliseumService.js` | 1,552 | WARNING |

*Last updated: 2026-01-26*

**Recent refactoring:** BattleScene.js WebSocket handling extracted to `BattleWebSocketManager.js` (766 lines). All files are now under the 3500-line blocking threshold.

**Note:** Changes to tech debt files do NOT block validation unless they increase the line count. New files must comply with the 3500-line limit.

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
| `economy-balance-designer` | Gold flow, XP curves, item pricing, drop rates |
| `asset-pipeline-specialist` | AI image/audio generation, sprite conventions |

## CI Pipeline

Pull requests run: lint → API tests → E2E tests (Playwright) → build. The pipeline requires PostgreSQL and auto-starts servers for testing.

## Documentation

Detailed specifications in `docs/`. Key files:

**Planning & Architecture:**
- `DEVELOPMENT_ROADMAP.md` - Links to `ROADMAP_TECHNICAL.md` and `ROADMAP_GAMEPLAY.md`
- `TECHNICAL_ARCHITECTURE.md` - System design, database schemas
- `WORLDGEN_TECHNICAL_DEEP_DIVE.md` - 6-phase world generation algorithms, constants, gotchas
- `API_SPECIFICATION.md` - REST and WebSocket endpoints
- `FRONTEND_TECHNICAL_PATTERNS.md` - Critical gotchas and component patterns

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

**UI & Assets:**
- `ASSET_SYSTEM_INDEX.md` - Unified asset pipeline navigation and quick reference
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

**Planning and Plan Execution**
- Avoid creating legacy fallbacks when implementing new backend functionality or frontend components.
- Always use the newly implemented components over legacy code and delete the legacy code
- Always use context specific subagents for all tasks, implementation routines
- When planning, seek advice from multiple agents for complex implementations and ask clarifying questions when they provide different opinions