# Modia - Development Roadmap

## Document Information

| Field | Value |
|-------|-------|
| Project Name | Modia |
| Version | 7.0 |
| Last Updated | January 2026 |

---

## Status Summary

| Phase | Name | Completion | Status |
|-------|------|------------|--------|
| 1 | Foundation | 100% | Complete |
| 2 | Characters & World | 95% | Complete |
| 3 | Combat System | 95% | Near Complete |
| 4 | Economy & Inventory | 95% | Near Complete |
| 5 | Multiplayer | 85% | Near Complete |
| 6 | Polish & Launch | 25% | In Progress |

**Overall: ~85%**

---

## Blocking Issues

Critical items for complete gameplay loop:

| Issue | Location | Impact | Priority |
|-------|----------|--------|----------|
| ~~**PvP action endpoint broken**~~ | ~~battle.js:action~~ | ~~Player2 cannot submit actions~~ | ✅ FIXED |
| ~~PvP battle transition incomplete~~ | ~~ColiseumScene.js:634~~ | ~~Match found but UI doesn't transition~~ | ✅ FIXED |
| ~~Party invite modal missing~~ | ~~WorldMapScene.js:398~~ | ~~No accept/decline UI for invites~~ | ✅ FIXED (PartyInviteModal.js) |
| ~~No multi-player party tables~~ | ~~Database schema~~ | ~~Cannot form parties~~ | ✅ FIXED (009_multiplayer_support.sql) |
| ~~Database 2-player limit~~ | ~~battles table~~ | ~~Schema only supports 2 players~~ | ✅ FIXED (battle_players table) |
| Audio system missing | BattleScene.js:2060 | No sound effects or music | Low |
| ~~Leaderboards missing~~ | ~~-~~ | ~~No player rankings~~ | ✅ FIXED (ColiseumScene.js) |
| ~~Skill-based matchmaking~~ | ~~coliseumService.js:185~~ | ~~Matches not balanced by level~~ | ✅ FIXED (PPR-based matchmaking) |

### Code Review Discoveries (v6.2)

**Critical Issues (Security/Stability):**

| Issue | Location | Impact | Priority |
|-------|----------|--------|----------|
| ~~Rate limiting missing on marketplace batch~~ | ~~marketplace.js~~ | ~~DoS vulnerability~~ | ✅ FIXED (marketplaceRateLimiter.js) |
| ~~Rate limiting missing on battle actions~~ | ~~battle.js~~ | ~~Can spam actions~~ | ✅ FIXED (battleRateLimiter.js) |
| ~~Rate limiting missing on WebSocket messages~~ | ~~websocket/index.js~~ | ~~Message flood attack~~ | ✅ FIXED (checkRateLimit) |
| ~~Event listener leak in Game.js~~ | ~~Game.js:resize~~ | ~~Memory leak over time~~ | ✅ FIXED (destroy method) |
| ~~Event listener leak in InputHandler.js~~ | ~~InputHandler.js~~ | ~~Memory leak over time~~ | ✅ FIXED (destroy method) |
| ~~Doc: Race traits mismatch~~ | ~~GAME_DESIGN.md vs constants.js~~ | ~~Incorrect documentation~~ | ✅ FIXED |
| ~~Doc: Critical chance cap~~ | ~~GAME_DESIGN.md (50% vs 30%)~~ | ~~Incorrect documentation~~ | ✅ FIXED |
| ~~Doc: XP formula exponent~~ | ~~GAME_DESIGN.md (2.2 vs 1.8)~~ | ~~Incorrect documentation~~ | ✅ FIXED |

### Battle System Architecture Overhaul (Complete)

Phase 2 implementation of the hybrid HTTP/WebSocket battle system. See plan file: `/home/wizard/.claude/plans/drifting-soaring-quasar.md`

| Task | Status | Files |
|------|--------|-------|
| Documentation (Phase 1) | ✅ Complete | BATTLE_TURN_SYSTEM.md, BATTLE_MESSAGING_PROTOCOL.md, BATTLE_MODES.md, BATTLE_RECONNECTION.md, BATTLE_ANIMATIONS.md |
| Fix PvP action endpoint | ✅ Complete | api/src/routes/battle.js |
| Database migrations for multiplayer | ✅ Complete | 009_multiplayer_support.sql (parties, party_members, battle_players, pvp_ratings, coliseum_matches) |
| Backend WebSocket infrastructure | ✅ Complete | battleWebsocket.js (new message types) |
| Backend async turn processing | ✅ Complete | battleTurnManager.js (new), battle.js (async-only) |
| Frontend WebSocket handlers | ✅ Complete | BattleScene.js (all handlers) |
| Frontend intent visualization | ✅ Complete | BattleUI.js, BattleGrid.js (highlight types, colors, pulsing) |
| Reconnection system | ✅ Complete | battleReconnection.js, rejoin endpoint, BattleScene handlers |
| Multi-player party system | ✅ Complete | party.js routes (create, join, invite, leave) |
| Remove deprecated sync mode | ✅ Complete | battle.js, battleService.js (async-only architecture) |

**Architecture Summary:** All enemy turns now processed asynchronously via WebSocket. Server sends intent highlights (movement range, attack range, target tile) with timing delays before executing actions. Deprecated sync mode completely removed for cleaner codebase.

### Battle Formation Scene Enhancement (Complete - January 2026)

Major visual and UX overhaul of the BattleFormationScene with context-aware theming, responsive layout, and immersive ambient effects. See plan: `/home/wizard/.claude/plans/composed-riding-newell.md`

| Task | Status | Files |
|------|--------|-------|
| Refactored layout (side drawer, fixed structure) | ✅ Complete | BattleFormationScene.js |
| FormationTheme base class | ✅ Complete | formation/FormationTheme.js |
| Theme detection (coliseum vs guild vs standard) | ✅ Complete | BattleFormationScene.js |
| Mobile responsive layout with bottom sheet | ✅ Complete | BattleFormationScene.js |
| Diorama grid with biome terrain | ✅ Complete | formation/FormationGrid.js |
| Placement slot highlighting (pulsing gold) | ✅ Complete | FormationGrid.js |
| Themed Start Battle buttons (6 SVG variants) | ✅ Complete | formation/StartBattleButton.js |
| Environmental animations (per-biome particles) | ✅ Complete | BattlefieldTheme.js |
| Rising tension system | ✅ Complete | FormationTheme.js |
| Battlefield Overview theme (standard battles) | ✅ Complete | themes/BattlefieldTheme.js |
| Pit Fighter's Circle theme (Coliseum) | ✅ Complete | themes/PitFighterTheme.js |
| Arcane Circle Chamber theme (Wizard Guild) | ✅ Complete | themes/ArcaneChamberTheme.js |
| Armory Staging Ground theme (Warrior Guild) | ✅ Complete | themes/ArmoryTheme.js |
| Traditional Dojo theme (Monk Guild) | ✅ Complete | themes/DojoTheme.js |
| Clockwork Factory theme (Chemist Guild) | ✅ Complete | themes/ClockworkTheme.js |

**Key Fixes:** Fixed layout shift bug (side drawer with fixed 280px width), added mobile-first responsive design with bottom sheet for party roster, created 6 unique themed environments with distinct ambient effects, particles, and Start Battle button variants.

### Turn Event Queue & Camera Fixes (Complete - January 2026)

Resolved critical camera bouncing and enemy movement issues in the async battle system. See plan: `/home/wizard/.claude/plans/serialized-moseying-milner.md`

| Task | Status | Files |
|------|--------|-------|
| Turn event queue system | ✅ Complete | BattleScene.js (queueTurnEvent, processTurnEventQueue) |
| Camera transition timing | ✅ Complete | BattleCamera.js (updateTurnTransition in update loop) |
| Follow target tracking | ✅ Complete | BattleScene.js (setFollowTarget in processTurnStartEvent) |
| Enemy resetTurnState fix | ✅ Complete | battleTurnManager.js (resetTurnState vs initializeTurnState) |
| AI pathfinding obstacles | ✅ Complete | aiService.js (isReachable using calculatePathCost) |
| Handler queue bypass fixes | ✅ Complete | BattleScene.js (handleRemoteYourTurn, handleRemoteStateUpdate) |

**Root Cause:** HTTP responses arrived before WebSocket events, causing multiple camera control systems to fight. Fixed by implementing a sequential turn event queue where all camera transitions wait for completion before advancing.

### Guild Recruitment System (Complete - January 2026)

Implemented party expansion via guild node recruitment. See documentation: `docs/GUILD_RECRUITMENT_SYSTEM.md`

| Task | Status | Files |
|------|--------|-------|
| Database schema (5 tables) | ✅ Complete | 012_guild_recruitment.sql |
| Trait seed data (31 traits) | ✅ Complete | 012_guild_recruitment.sql |
| Procedural name generator | ✅ Complete | nameGenerator.js, nameData.js |
| Recruit generation service | ✅ Complete | recruitService.js |
| Trait effect calculations | ✅ Complete | traitService.js |
| Guild API endpoints (3) | ✅ Complete | guild.js (info, recruits, purchase) |
| Lazy refresh system | ✅ Complete | recruitService.js |
| RecruitmentScene UI | ✅ Complete | RecruitmentScene.js |
| WorldMapScene integration | ✅ Complete | WorldMapScene.js |
| Battle trait application | ✅ Complete | traitService.js, battleService.js |

**Key Features:**
- **Recruit Uniqueness**: ±15% stat variance, 1-2 traits, 0-2 starting skills, 50-150 XP pool
- **Pricing**: 2,000g base + stat variance + 8,000g per extra trait + 750g per skill
- **Pool System**: 10 recruits per guild, shared pool, daily refresh per node
- **Emergency Restock**: 3 basic recruits (1-trait cap) when pool empties
- **Trait System**: 31 traits in 4 categories (combat, survival, utility, situational)
- **Battle Integration**: Traits apply to damage, crit, HP/MP, movement, initiative, regen, lifesteal

**Suggested Improvements (TODO):**
- [ ] Class-weighted trait selection (warriors more likely to get combat traits)
- [ ] Limit emergency restocks (cooldown between restocks)
- [ ] Scale recruit level with player progression
- [ ] Exponential pricing for high stat variance
- [ ] Recruit comparison tools (compare to existing party)
- [ ] Buff situational traits (currently too weak)
- [ ] Tier trait pricing by rarity

---

### Marketplace Security & UI Enhancement (Complete - January 2026)

Comprehensive marketplace improvements: security hardening, medieval UI theme, castle node integration, and real-time WebSocket updates. See plan: `/home/wizard/.claude/plans/nifty-greeting-cosmos.md`

| Task | Status | Files |
|------|--------|-------|
| Rate limiting middleware | ✅ Complete | api/src/middleware/marketplaceRateLimiter.js |
| Order count enforcement (max 10) | ✅ Complete | marketplaceService.js, shared/constants.js |
| Audit logging system | ✅ Complete | 015_marketplace_audit.sql, marketplaceAuditService.js |
| Castle node access middleware | ✅ Complete | api/src/middleware/marketplaceAccess.js |
| Frontend location validation | ✅ Complete | MarketplaceScene.js (enter(), showTravelPrompt()) |
| WebSocket service | ✅ Complete | api/src/services/marketplaceWebsocket.js |
| WebSocket message handlers | ✅ Complete | api/src/websocket/index.js (marketplace_subscribe/unsubscribe) |
| Service layer WebSocket integration | ✅ Complete | marketplaceService.js (broadcasts on trades/orders) |
| Frontend WebSocket integration | ✅ Complete | MarketplaceScene.js, api/websocket.js |
| Medieval parchment UI theme | ✅ Complete | MarketplaceScene.js (addStyles()) |
| MarketConfirmDialog component | ✅ Complete | frontend/src/components/MarketConfirmDialog.js |
| MarketToast component | ✅ Complete | frontend/src/components/MarketToast.js |

**Key Features:**
- **Security**: Endpoint-specific rate limits (5-60 req/min), max 10 open orders per user, comprehensive audit logging
- **Castle-Only Access**: Marketplace restricted to castle node, travel prompts for users at other locations
- **Real-Time Updates**: WebSocket broadcasts for order book changes, trade notifications, fill alerts
- **Medieval Theme**: Parchment backgrounds, wooden frames, wax seal buttons, ledger-style order book
- **UX Components**: Confirmation dialogs for all trades, toast notifications for events

---

### World Map Travel System Enhancement (Complete - January 2026)

Enhanced world map navigation with multi-node travel, stamina system, and character visualization. See plan: `/home/wizard/.claude/plans/keen-stirring-island.md`

| Task | Status | Files |
|------|--------|-------|
| Stamina database migration | ✅ Complete | 016_stamina_system.sql |
| Stamina service | ✅ Complete | api/src/services/staminaService.js |
| Character route stamina integration | ✅ Complete | api/src/routes/characters.js |
| BFS world pathfinding | ✅ Complete | api/src/routes/world.js |
| Multi-node travel endpoint | ✅ Complete | api/src/routes/world.js |
| Path preview endpoint | ✅ Complete | api/src/routes/world.js |
| WorldMapCharacter component | ✅ Complete | frontend/src/worldmap/WorldMapCharacter.js |
| StaminaBar component | ✅ Complete | frontend/src/worldmap/StaminaBar.js |
| Walking animation system | ✅ Complete | WorldMapCharacter.js, WorldMapScene.js |
| Path preview rendering | ✅ Complete | WorldMapScene.js |
| Enhanced node tooltips | ✅ Complete | WorldMapScene.js |
| API client methods | ✅ Complete | frontend/src/api/client.js |

**Key Features:**
- **Multi-Node Travel**: Players can travel to any previously discovered node (not just adjacent)
- **Stamina System**: 8 max stamina, 1 per node traveled, regenerates 1 every 2 minutes
- **Character Visualization**: Party leader sprite displayed on world map with walking animation
- **Path Preview**: Golden highlight on hover showing route to destination with stamina cost
- **Server-Side Pathfinding**: BFS algorithm finds shortest path between nodes
- **Animated Travel**: Character walks along bezier paths between nodes with dust particles
- **Camera Follow**: Smooth camera tracking during travel animation
- **Intermediate Discovery**: All nodes along travel path are discovered automatically

---

### Advanced AI System (Complete - January 2026)

Major overhaul of NPC AI with utility-based scoring and multi-actor lookahead. See plan: `/home/wizard/.claude/plans/merry-dreaming-stallman.md` and documentation: `docs/AI_SYSTEM.md`

| Task | Status | Files |
|------|--------|-------|
| Unified BattleUnit factory | ✅ Complete | battleUnitFactory.js |
| Server-side pathfinding (getReachableTiles) | ✅ Complete | battleService.js |
| Server-provided availableActions | ✅ Complete | battleService.js, battle.js |
| Database migration (unified units) | ✅ Complete | 010_unified_unit_system.sql |
| Monster skill trees config | ✅ Complete | config/monsterSkillTrees.js |
| NPC skill database migration | ✅ Complete | 011_npc_skills.sql |
| NPC skill generation service | ✅ Complete | npcSkillService.js |
| Utility AI module (7 files) | ✅ Complete | services/ai/*.js |
| Multi-actor lookahead (2-3 rounds) | ✅ Complete | ai/lookahead.js |
| AI pattern weights (9 patterns) | ✅ Complete | ai/patternWeights.js |
| Transposition table & caching | ✅ Complete | ai/cache.js |
| aiService.js integration | ✅ Complete | aiService.js |
| Frontend server-action integration | ✅ Complete | BattleScene.js |
| AI_SYSTEM.md documentation | ✅ Complete | docs/AI_SYSTEM.md |

**Key Features:**
- **Utility-Based Scoring**: 9 weighted factors (damage dealt/received, kill potential, position quality, etc.)
- **Multi-Actor Lookahead**: Simulates 2-3 turns ahead considering ALL characters (allies and enemies)
- **9 AI Patterns**: aggressive, defensive, support, tactical, pack, ambush, berserker, ranged, boss
- **Monster Skill Trees**: 9 archetypes (beast, dragon, undead, elemental, humanoid, construct, demon, insect, plant) with themed skill branches
- **Humanoid NPC Skills**: NPCs with humanoid archetype use player guild skill trees
- **Performance Optimized**: Alpha-beta pruning, transposition table, killer moves, iterative deepening with 450ms time budget

### Comprehensive Code Review (v6.1 → v6.2)

A systematic multi-agent code review was performed in January 2026, covering backend, frontend, tests, and documentation.

#### Test Coverage Enhancement (225+ New Tests)

| Test File | Tests Added | Coverage Area |
|-----------|-------------|---------------|
| chatService.test.js | 21 | Message persistence, history, DMs, reactions |
| presenceService.test.js | 27 | Typing indicators, node presence, cache |
| coliseumService.test.js | 28 | Queue management, matchmaking, cleanup |
| partyWebsocket.test.js | 31 | Invites, broadcasts, room management |
| websocketIndex.test.js | 44 | Core WebSocket module, utilities, rooms |
| battleMechanics.test.js | 75+ | CT turn order, AI patterns, damage formulas, status effects |

**Total New Tests:** 225+ across 6 new test files. All tests passing.

#### Code Quality Findings

**Backend Issues Identified (24 total):**
- 3 Critical: Rate limiting missing on marketplace batch operations, battle actions, WebSocket messages
- 8 High: Input validation gaps, transaction isolation, asyncHandler missing in sprites route
- 9 Medium: Hardcoded values, inconsistent error handling, typing indicator memory leak
- 4 Low: Documentation gaps, dead code removal, console.log statements

**Frontend Issues Identified (15 total):**
- 2 Critical: Event listener leaks in Game.js resize and InputHandler.js
- 4 High: Inline listeners without cleanup in LoginScene.js, WorldMapScene.js, asset loading race conditions
- 5 Medium: BattleActionBar cleanup needed, StateManager stale reference warnings, hardcoded animation timings
- 4 Low: JSDoc missing, console.log statements, magic numbers

**Positives Identified:**
- Backend: Excellent SQL injection prevention, strong auth system, proper transaction handling
- Frontend: Good AbortController usage pattern, WebSocket unsubscriber pattern, clean component composition

#### Documentation vs Code Discrepancies (21 total)

**Critical (Must Fix):**
1. Race traits in GAME_DESIGN.md differ significantly from shared/constants.js
2. Critical chance cap is 30% in code, documented as 50%
3. XP formula exponent is 1.8 in code, documented as 2.2

**Medium (Should Fix):**
- Level cap is 256 in code, 100 in docs
- XP pool skill learning tables missing actual values
- Equipment slots differ between docs and code
- Several API endpoints undocumented

**See:** `docs/TECHNICAL_IMPROVEMENTS.md` for full details.

### Security Audit Completed (v5.0 → v6.0)

A comprehensive security audit was performed in January 2026. See `docs/TECHNICAL_IMPROVEMENTS.md` for full details.

**Critical Security Fixes Applied:**
| Fix | Location | Status |
|-----|----------|--------|
| JWT secret validation in production | `api/src/config/jwt.js` | FIXED |
| Rate limiting enabled by default | `api/src/middleware/rateLimiter.js` | FIXED |
| Battle range validation (anti-cheat) | `api/src/routes/battle.js` | FIXED |
| Negative quantity exploit prevention | `shop.js`, `marketplace.js`, `inventory.js` | FIXED |
| Maximum marketplace price limits | `api/src/routes/marketplace.js` | FIXED |
| WebSocket room authorization | `api/src/websocket/index.js` | FIXED |
| Security headers (helmet) | `api/src/index.js` | FIXED |
| partyWebsocket.js reference error | `api/src/services/partyWebsocket.js` | FIXED |

**New Documentation:**
- `docs/TECHNICAL_IMPROVEMENTS.md` - Security, networking, code quality guide
- `docs/GAME_MECHANICS_IMPROVEMENTS.md` - Balance and feature improvement suggestions

### Social & PvP Systems (Complete - January 2026)

Major implementation of multiplayer social features and complete PvP system. See plan: `/home/wizard/.claude/plans/twinkly-yawning-crown.md`

| Task | Status | Files |
|------|--------|-------|
| Notification system (service, API, components) | ✅ Complete | notificationService.js, notifications.js, ToastManager.js, NotificationBell.js, NotificationCenter.js |
| Friend system (requests, blocking, favorites) | ✅ Complete | friendService.js, friends.js, TavernScene.js |
| Party system fixes (schema, invite modal) | ✅ Complete | 014_social_pvp_systems.sql, PartyInviteModal.js, PartyStatusBar.js |
| Courtyard scene (Palace social hub) | ✅ Complete | CourtyardScene.js, lfg.js |
| LFG (Looking For Group) system | ✅ Complete | lfg.js routes, CourtyardScene.js |
| Player search by username | ✅ Complete | friends.js (/api/players/search) |
| Character valuation algorithm (PPR) | ✅ Complete | characterValuationService.js |
| PPR-based matchmaking | ✅ Complete | coliseumService.js |
| Weighted ELO rating system | ✅ Complete | ratingService.js |
| PvP turn timer (60s) | ✅ Complete | coliseumService.js, BattleUI.js |
| Surrender with rating penalty | ✅ Complete | coliseumService.js, BattleScene.js |
| Disconnect forfeit (5 min, weekly grace) | ✅ Complete | coliseumService.js, ratingService.js |
| Match snapshots for history | ✅ Complete | coliseumService.js |
| Leaderboards UI | ✅ Complete | ColiseumScene.js, coliseum.js routes |
| Match history UI | ✅ Complete | ColiseumScene.js, coliseum.js routes |

**Key Features:**
- **Notification System**: Toast popups + persistent notification center with type-specific actions
- **Friend System**: Friend requests with approval, blocking, favorites, notes, player search
- **Party System**: Invite modal with countdown, party status bar in HUD
- **Courtyard Scene**: Real-time player lobby + persistent LFG board at Palace nodes
- **PPR Matchmaking**: Character Power Rating = stats + level + skills + equipment value (top 5 characters)
- **Rating System**: Weighted ELO with underdog bonus based on PPR ratio
- **Turn Timer**: 60s per turn, progressive penalty (2 skips = forfeit on 3rd)
- **Match Recording**: Full team snapshots (characters + equipment) for detailed history

**Database Migration:** `014_social_pvp_systems.sql`
- notifications table
- friendships table
- lfg_posts table
- pvp_disconnects table
- Party schema fixes (column renames, missing columns)
- coliseum_matches snapshot columns

**Future Roadmap (Documented):**
- Battle replay system (store action log, playback viewer)
- Spectator mode (observe live battles)
- Tournament brackets
- Seasonal rankings

### Recently Resolved (v4.0 → v5.0)

| Issue | Resolution |
|-------|------------|
| Mock skills in battle | Real skills now loaded from character_skills table |
| Equipment bonuses ignored | Equipment stat bonuses now applied to battle stats |
| No items in battle | Item menu added to battle with consumable usage |
| Advanced guilds missing | All 4 advanced guilds implemented (Berserker, Sorcerer, Ninja, Alchemist) |
| ColiseumScene missing | Full ColiseumScene UI with queue selection and matchmaking |
| Guild advancement missing | Characters can advance to advanced guilds at level 20 |
| Battle Formation UX issues | Glass morphism cards, empty grid start, long-press bug fixed, animated title |

---

## Recently Completed (v3.0 → v4.0)

Features previously listed as "not implemented" that ARE working:

| Feature | Status | Evidence |
|---------|--------|----------|
| Gold awarded after battle | ✓ WORKING | battle.js:651 stores gold to users table |
| Shop system (buy/sell) | ✓ WORKING | shop.js (536 lines), ShopScene.js (807 lines) |
| Marketplace (order book) | ✓ WORKING | marketplace.js (357 lines), gold reservations, item escrow |
| Equipment UI | ✓ WORKING | InventoryPanel.js with drag-and-drop equip/unequip |
| Skill learning UI | ✓ WORKING | SkillTreePanel.js with XP pool spending |
| Inventory access | ✓ WORKING | Menu → Inventory button, InventoryScene.js |
| TavernScene | ✓ WORKING | Full chat system with DMs, reactions, presence |
| Battle drops to inventory | ✓ WORKING | battle.js:663-670 stores items to party leader |

---

## Known Placeholders in Code

| File | Line | Text | Fix Required |
|------|------|------|--------------|
| BattleScene.js | 526 | Mock skills by class | Load real character_skills from DB |
| BattleScene.js | 470 | "TODO: Implement audio system" | Add Web Audio API |

---

## Code TODOs

Active TODO comments found in codebase (January 2026 audit):

| File | Line | TODO | Priority |
|------|------|------|----------|
| ColiseumScene.js | 634 | Transition to BattleScene with PvP battle data | High |
| WorldMapScene.js | 398 | Show party invite modal | Medium |
| BattleScene.js | 2060 | Implement audio system | Low |
| coliseumService.js | 185 | Add skill-based matchmaking using partyLevel | Low |

---

## Unused Database Tables

Tables created but not fully wired to application logic:

| Table | Status | Issue |
|-------|--------|-------|
| coliseum_matches | Schema exists | startMatch() creates matches but battle transition incomplete |
| leaderboard_cache | Seeded | No API endpoints implemented |
| pvp_ratings | Created | Never populated with player ratings |
| party_members | Created | Party system uses direct character queries instead |

---

## 1. Development Overview

### 1.1 Development Philosophy

- **Iterative Development**: Build in small, testable increments
- **Playable Early**: Each phase produces a functional game state
- **Documentation First**: Requirements documented before implementation
- **Test As You Go**: Verify each feature before moving on

### 1.2 Phase Summary

| Phase | Focus | Key Deliverables |
|-------|-------|------------------|
| 1 | Foundation | Auth, DB, Project Setup |
| 2 | Characters & World | Character CRUD, World Map |
| 3 | Combat | Battle System, Skills, PvE |
| 4 | Economy | Items, Shops, Inventory, Marketplace |
| 5 | Multiplayer | WebSocket, Chat, PvP, Trading |
| 6 | Polish & Launch | UI, Balance, Deployment |

---

## 2. Phase 1: Foundation (100% Complete)

### 2.1 Objectives

Establish the technical foundation for the project including authentication, database, and project structure.

### 2.2 Tasks

#### 2.2.1 Project Setup

- [x] Initialize monorepo with npm workspaces
- [x] Create API package structure
- [x] Create frontend package structure
- [x] Create shared constants package
- [x] Configure PM2 ecosystem file
- [x] Create .env.example template
- [x] Create .gitignore

#### 2.2.2 Database

- [x] Design complete database schema
- [x] Create migration system
- [x] Write 001_initial_schema.sql migration
- [x] Create database seeding script
- [x] Implement world generation seed
- [ ] Test migration rollback

#### 2.2.3 Authentication API

- [x] POST /api/auth/register
- [x] POST /api/auth/login
- [x] POST /api/auth/refresh
- [x] POST /api/auth/logout
- [x] GET /api/auth/me
- [x] JWT token generation/verification
- [x] Password hashing with bcrypt
- [x] Rate limiting middleware

#### 2.2.4 Frontend Foundation

- [x] HTML entry point
- [x] CSS base styles
- [x] Game class and loop
- [x] StateManager implementation
- [x] SceneManager implementation
- [x] InputHandler implementation
- [x] API client wrapper
- [x] WebSocket client wrapper

#### 2.2.5 Auth UI

- [x] LoginScene implementation
- [x] RegisterScene implementation
- [x] Form validation feedback
- [x] Loading states
- [x] Error handling UI

### 2.3 Acceptance Criteria

- [x] User can register a new account
- [x] User can log in with existing credentials
- [x] Invalid credentials show error message
- [x] JWT tokens are stored and used for API calls
- [x] Session persists across page refresh
- [x] User can log out

### 2.4 Testing Checklist

- [x] Register with valid credentials -> Success
- [x] Register with duplicate username -> Error
- [x] Register with invalid email -> Error
- [x] Login with valid credentials -> Success
- [x] Login with wrong password -> Error
- [x] Access protected route without token -> 401
- [x] Access protected route with valid token -> Success
- [x] Refresh token before expiry -> New access token
- [x] Use expired refresh token -> Error

---

## 3. Phase 2: Characters & World (95% Complete)

### 3.1 Objectives

Implement character creation, management, and world map navigation.

### 3.2 Tasks

#### 3.2.1 Character API

- [x] GET /api/characters (list)
- [x] POST /api/characters (create)
- [x] GET /api/characters/:id (details)
- [x] PUT /api/characters/:id (update)
- [x] DELETE /api/characters/:id
- [x] GET /api/characters/:id/stats
- [x] Character stat calculation service
- [x] Race/class validation

#### 3.2.2 Party API

- [x] GET /api/party
- [x] PUT /api/party (formation)
- [x] PUT /api/party/battle
- [x] Validation for party constraints

#### 3.2.3 World API

- [x] GET /api/world/seed
- [x] GET /api/world/nodes
- [x] GET /api/world/nodes/:id
- [x] POST /api/world/travel
- [x] GET /api/world/current
- [x] Node adjacency validation
- [x] Travel restrictions

#### 3.2.4 World Generation

- [x] SeededRandom implementation
- [x] World generation algorithm
- [x] Node placement (rings)
- [x] Guild placement (4 nodes)
- [x] Palace placement (1 node)
- [x] Connection generation
- [x] Feature assignment
- [x] Name generation variety
- [x] Difficulty tier calculation

#### 3.2.5 Character UI

- [x] CharacterSelectScene
- [x] CharacterCreateScene
- [x] Race selection interface
- [x] Class selection interface
- [x] Stat preview display (in FormationScene)
- [x] Character card component
- [x] FormationScene implementation (partial - Stats tab works)

#### 3.2.6 World Map UI

- [x] WorldMapScene basic implementation
- [x] Node rendering
- [x] Connection rendering
- [x] Current position indicator
- [x] Travel to adjacent nodes
- [x] Pan and zoom controls
- [ ] Node hover information
- [x] Node type icons/colors
- [ ] Mini-map display

### 3.3 Acceptance Criteria

- [x] User can create character with name/race/class
- [x] Character appears in selection screen
- [x] User can delete character
- [x] World map displays all nodes
- [x] User can travel to adjacent nodes
- [x] Cannot travel to non-adjacent nodes
- [x] Current location is highlighted
- [x] Node features are displayed

### 3.4 Testing Checklist

- [x] Create character with all race/class combinations
- [x] Attempt to create 13th character -> Error
- [x] Delete character -> Removed from list
- [x] View world map -> All nodes visible
- [x] Click adjacent node -> Travel succeeds
- [x] Click non-adjacent node -> Travel fails
- [x] World generation is deterministic (same seed = same world)

---

## 4. Phase 3: Combat System (90% Complete)

### 4.1 Objectives

Implement the core turn-based tactical battle system for PvE encounters.

### 4.2 Tasks

#### 4.2.1 Battle API

- [x] POST /api/battle/start
- [x] GET /api/battle/current
- [x] POST /api/battle/action
- [x] GET /api/battle/rewards/:id
- [x] Battle state validation
- [x] Turn order management
- [x] Action resolution

> **Note**: Flee mechanic removed from design. Characters respawn at last safe node on party wipe.

#### 4.2.2 Battle Engine

- [x] Battle state machine
- [x] Initiative calculation
- [x] Movement system
  - [x] Base movement: 3 tiles for all classes
  - [x] Pathfinding (A*)
  - [x] Terrain costs (Forest: 2, Water: 2, Normal: 1)
- [x] Attack system
  - [x] Damage calculation
  - [x] Critical hits
  - [ ] Elemental damage
- [x] Skill system in battle
  - [x] Load learned skills from character_skills table
  - [x] Skill usage in battle UI (Skill menu)
  - [x] MP consumption
  - [x] Area of effect
  - [ ] Skill cooldowns
- [x] Status effects (no stacking, refresh duration only)
  - [x] Effect application from skills in battle
  - [ ] Duration tracking display
  - [x] Turn-end processing (processStatusEffects)
- [x] Win/lose detection
- [x] Reward calculation

#### 4.2.2.1 Skill Learning API

- [x] POST /api/skills/learn
- [x] GET /api/skills/tree/:guildId
- [x] GET /api/characters/:id/skills
- [x] GET /api/guilds
- [ ] GET /api/guilds/:guildId (detailed)
- [ ] GET /api/characters/:id/guilds

#### 4.2.2.2 Base Guild Skills (4 Guilds)

- [x] Warrior guild skills (Offense, Defense, Passive branches)
- [x] Wizard guild skills (Fire, Ice, Lightning, Passive branches)
- [x] Monk guild skills (Strikes, Spirit, Passive branches)
- [x] Chemist guild skills (Healing, Offense, Utility branches)

#### 4.2.2.3 Advanced Guild Skills (4 Guilds - COMPLETE)

> All 4 advanced guilds implemented with full skill trees (~60 skills total)

- [x] Berserker guild (Warrior advancement) - 15 skills
  - [x] Rage Branch (rage_strike, blood_frenzy, enraged_fury, bloodlust, reckless_power, berserker_rage, unstoppable, rampage)
  - [x] Recklessness Branch (reckless_charge, wild_swing, berserker_leap, martyrs_resolve, death_wish, final_stand, self_destruction)
- [x] Sorcerer guild (Wizard advancement) - 15 skills
  - [x] Arcane Power Branch (arcane_bolt, mana_shield, spell_amplify, arcane_mastery, penetrating_magic, arcane_explosion, infinite_mana, armageddon)
  - [x] Elemental Mastery Branch (elemental_surge, dual_element, elemental_convergence, element_overload, elemental_storm, primal_mastery, elemental_avatar)
- [x] Ninja guild (Monk advancement) - 15 skills
  - [x] Stealth Branch (shadow_step, vanish, backstab, assassination, silent_step, shadow_clone, death_mark, one_thousand_cuts)
  - [x] Ninjutsu Branch (kunai_throw, kunai_barrage, ninja_smoke_bomb, poison_blade, ninja_tools, explosive_tag, ninjutsu_mastery)
- [x] Alchemist guild (Chemist advancement) - 14 skills
  - [x] Transmutation Branch (transmute_metal, golden_touch, matter_reshape, lead_to_gold, philosophers_stone, perfect_transmutation, alchemical_mastery)
  - [x] Explosives Branch (fire_bomb, cluster_bomb, flashbang, napalm_flask, remote_detonator, tactical_nuke, alchemical_warfare)

#### 4.2.2.4 Skill System Enhancements

- [ ] 5-tier skill system with guild level requirements
- [ ] Ultimate skills (Tier 5) for all guilds
- [ ] Skill scaling formula implementation
- [ ] Skill levels 1-100 (currently 5-20)
- [ ] Guild advancement quests

#### 4.2.3 Enemy System

- [x] Enemy template database (see ENEMY_SYSTEM.md)
- [x] enemyService.js implementation
- [x] Enemy spawning by node type and difficulty tier
- [x] Level scaling (enemy_level = avg_party_level x tier_multiplier)
- [x] Difficulty tier multipliers (0.9x - 2.15x)
- [x] Enemy encounter variety (commit 1f8ad4f, 2026-01-07)
  - [x] Randomized enemy count (3-7) weighted by difficulty tier
  - [x] Level scaling based on formation characters only
  - [x] Randomized enemy positions on right side of map
  - [x] Server-driven encounter preview API

#### 4.2.3.1 Enemy AI Archetypes (9/9 Implemented - Utility AI)

> **Note:** All AI patterns now use the new utility-based AI system with multi-actor lookahead. See `docs/AI_SYSTEM.md` for details.

- [x] Aggressive (high damage dealt weight, low survival priority)
- [x] Defensive (high survival priority, safe positioning)
- [x] Support (prioritizes healing, maintains distance)
- [x] Tactical (balanced weights, high kill potential focus)
- [x] Pack (high ally support, swarm behavior)
- [x] Ambush (position-focused, waits for optimal strikes)
- [x] Berserker (extreme aggression, minimal self-preservation)
- [x] Ranged (maintains safe distance, kiting behavior)
- [x] Boss (adaptive, balanced across all factors)

#### 4.2.3.2 Enemy Abilities (NOT IMPLEMENTED)

- [ ] Ability execution system (abilities field exists but unused)
- [ ] Ability cooldowns per enemy
- [ ] Ability range checking
- [ ] Ability trigger conditions

#### 4.2.3.3 Boss Mechanics (NOT IMPLEMENTED)

- [ ] Multi-phase boss system
- [ ] HP threshold phase transitions
- [ ] Stat modifiers per phase
- [ ] Phase-specific ability unlocks

#### 4.2.3.4 Enemy Defenses (NOT IMPLEMENTED)

- [ ] Elemental resistance system
- [ ] Status effect immunities
- [ ] Special passive abilities (flight, regeneration, etc.)

#### 4.2.4 Battle Map Generation

- [x] Terrain generation by node type
- [x] Spawn point calculation
- [x] Passability validation
- [x] Path verification

#### 4.2.5 Battle UI

- [x] BattleScene implementation
- [x] Isometric tile rendering
- [x] Unit sprites
- [x] Movement range overlay
- [x] Attack range overlay
- [x] Action menu
  - [x] Move option
  - [x] Attack option
  - [x] Skill submenu (real skills from character_skills)
  - [x] Item submenu (consumables from inventory)
  - [x] Wait option
- [x] Turn order display
- [x] HP/MP bars
- [ ] Battle log
- [x] Victory/defeat screens
- [x] Reward display (RewardsModal)

#### 4.2.6 Isometric Rendering

- [x] Coordinate conversion (screen <-> tile)
- [x] Tile drawing order (depth sort)
- [x] Unit positioning
- [x] Animation system
  - [x] Idle animation
  - [x] Attack animation
  - [x] Damage animation
  - [x] Movement animation
  - [x] Damage numbers
  - [x] Particle effects

#### 4.2.7 Audio System (NOT IMPLEMENTED)

- [ ] Web Audio API integration
- [ ] Sound effect playback
- [ ] Battle music
- [ ] UI sounds

### 4.3 Acceptance Criteria

- [x] User can initiate battle at battle nodes
- [x] Battle map generates correctly
- [x] Units display in correct positions
- [x] Player can move units within range (base: 3 tiles)
- [x] Player can attack enemies in range
- [x] Damage is calculated correctly
- [x] Enemies take turns and act (5/7 AI archetypes)
- [x] Battle ends on victory/defeat
- [x] Rewards are displayed correctly
- [x] XP is added to character's XP pool for skill spending
- [x] Skills can be used in battle (loaded from character_skills)
- [x] Items can be used in battle (consumables from inventory)

### 4.4 Testing Checklist

- [x] Start battle at Forest node -> Forest-themed map
- [x] Start battle at Cave node -> Cave-themed map
- [x] Move unit -> Valid positions only (3 tiles base)
- [x] Attack enemy -> Damage applied
- [x] Defeat enemy -> Removed from battle
- [x] Defeat all enemies -> Victory
- [x] All player units defeated -> Respawn at safe node
- [x] Use skill in battle -> Effect applied, status effects work
- [x] Use item in battle -> HP/MP restored
- [x] XP awarded -> Added to XP pool for skill spending

---

## 5. Phase 4: Economy & Inventory (95% Complete)

### 5.1 Objectives

Implement the item system, inventory management, NPC shops, and player marketplace.

### 5.2 Tasks

#### 5.2.1 Item System Backend

- [x] Item template database
- [x] itemDropService.js implementation
- [x] Rarity rolling (Common 70%, Uncommon 20%, Rare 8%, Epic 1.8%, Legendary 0.2%)
- [x] Material tier generation (6 material groups by level)
- [x] Seeded random for deterministic drops
- [x] Basic item augmentation (8 augments)

#### 5.2.1.1 Advanced Item System (Per ITEM_SYSTEM.md - NOT IMPLEMENTED)

- [ ] 5 intensity tiers (Minor, Lesser, Standard, Greater, Supreme)
- [ ] Enemy-type prefixes (Dragonbane, Wyrmslayer, Demonslayer, etc.)
- [ ] Defensive augments (Physical Defense, Magical Defense, Blocking, Reflection)
- [ ] Support augments (Health/Mana Regen, Lifesteal, XP/Gold bonuses)
- [ ] Combat augments (Critical Hit, Attack Speed, Evasion, Armor Penetration)
- [ ] Unique augments (Whirlwind, Cleave, Riposte, Execute, etc.)
- [ ] Set item bonuses
- [ ] Full metal tier progression (12 tiers: Copper -> Celestial)
- [ ] Wood material tiers (10 tiers: Pine -> Celestial Oak)
- [ ] Cloth/Leather material tiers (10 tiers: Linen -> Starcloth)
- [ ] Material special properties (Silver anti-undead, Mythril movement, etc.)
- [ ] Complex stat scaling formula per docs
- [ ] Rarity price multipliers as documented (1x-50x)
- [ ] Priority-based naming system
- [ ] Terrain-specific drop modifiers

#### 5.2.2 Inventory API

- [x] GET /api/inventory/:characterId
- [x] POST /api/inventory/equip
- [x] POST /api/inventory/unequip
- [x] POST /api/inventory/use
- [x] POST /api/inventory/discard

#### 5.2.3 Inventory UI

- [x] FormationScene equipment tab functional
- [x] Wire equip/unequip buttons to API
- [x] Display equipped items on character
- [x] Stat comparison display
- [x] Item detail modal

#### 5.2.4 Skill Learning UI

- [x] FormationScene skills tab functional
- [x] Wire skill learning to skills API
- [x] XP pool display and spending
- [x] Skill tree visualization

#### 5.2.5 Shop API

- [x] GET /api/shops/:nodeId/:shopType - Get shop inventory
- [x] POST /api/shops/:nodeId/:shopType/buy - Purchase items
- [x] POST /api/shops/:nodeId/:shopType/sell - Sell items
- [x] GET /api/shops/:nodeId/:shopType/sell-inventory - Sellable items

#### 5.2.6 Shop System

- [x] ShopScene UI (807 lines, full implementation)
- [x] Blacksmith shop inventory
- [x] Apothecary shop inventory
- [x] Farm shop inventory
- [x] Dynamic supply-based pricing (60-120% of base)
- [ ] Stock refresh cycles (6-24 hours)
- [x] Player-sold item tracking
- [ ] Item decay system (10% daily surplus decay)

#### 5.2.7 Gold System

- [x] Gold tracking in player/character data (users.gold column)
- [x] Gold awarding after battle victory
- [x] Gold balance display in UI
- [x] Gold deduction on purchases

#### 5.2.8 Item Integration

- [x] Item drop service generates drops after battle
- [x] Drops wired to battle rewards endpoint
- [x] Item use in battle (Item menu with consumables)
- [x] Equipment stat application in combat (attack, defense, magicAttack, magicDefense bonuses)
- [x] Consumable effects (in and out of battle)
- [x] Equipment requirements enforcement (level, class, race)

### 5.3 Acceptance Criteria

- [x] Characters have accessible inventory
- [x] Items can be equipped/unequipped via UI
- [x] Equipment affects stats (attack, defense, magicAttack, magicDefense applied in combat)
- [x] NPC shops sell items
- [x] User can buy items with gold
- [x] User can sell items for gold
- [x] Consumables work in battle (Item menu)
- [x] Loot drops after battles and goes to inventory

### 5.4 Testing Checklist

- [x] View inventory -> Shows items
- [x] Equip weapon -> Item equipped, stats applied
- [x] Unequip weapon -> Item unequipped
- [x] Buy item -> Gold deducted, item added
- [x] Sell item -> Gold added, item removed
- [x] Use potion in battle -> HP restored
- [x] Win battle -> Loot received in inventory

---

## 6. Phase 5: Multiplayer Features (85% Complete)

### 6.1 Objectives

Implement real-time multiplayer features including chat, trading, and PvP.

### 6.2 Tasks

#### 6.2.1 WebSocket Infrastructure

- [x] WebSocket server setup
- [x] Connection management
- [x] Authentication via JWT
- [x] Room/channel system
- [x] Heartbeat/keepalive
- [x] Reconnection handling (documented in BATTLE_RECONNECTION.md)
- [ ] Cross-instance messaging (future)

#### 6.2.2 Tavern Chat

- [x] join_room event
- [x] leave_room event
- [x] chat_message event
- [x] TavernScene UI (full implementation)
- [x] Message history (100 messages)
- [x] User list display
- [x] 160-character message limit UI
- [x] Private messages (DMs)
- [x] Emoji reactions
- [x] Typing indicators
- [x] Presence status (online/away/busy)

#### 6.2.3 Marketplace API

- [x] GET /api/marketplace/orderbook/:itemTemplateId
- [x] GET /api/marketplace/orders/mine
- [x] POST /api/marketplace/orders/limit
- [x] POST /api/marketplace/orders/market
- [x] DELETE /api/marketplace/orders/:orderId
- [x] GET /api/marketplace/history/:itemTemplateId
- [x] GET /api/marketplace/search - Search tradeable items
- [x] GET /api/marketplace/my-trades - User's trade history
- [x] GET /api/marketplace/stats/:itemTemplateId - Market stats

#### 6.2.4 Marketplace System

- [x] MarketplaceScene UI
- [x] Order book display with bid/ask spread
- [x] Limit order system
- [x] Market order execution
- [x] Gold reservation for buy orders (gold_reservations table)
- [x] Item escrow for sell orders (item_escrow table)
- [x] Price/time priority matching
- [x] Partial fill handling
- [ ] Max 10 open orders per player (not enforced)
- [ ] WebSocket listing updates (backend events exist)

#### 6.2.5 Coliseum PvP

- [x] coliseum_queue_join event
- [x] coliseum_queue_leave event
- [x] ColiseumScene UI (queue selection, matchmaking status, ready check)
- [x] Matchmaking service (coliseumService.js)
- [x] Match found notification and ready check
- [x] PvP battle initialization (coliseumService.startMatch())
- [x] Real-time turn sync (battle WebSocket events)
- [x] pvp:queue_joined, pvp:match_found events
- [x] pvp:opponent_action, pvp:disconnect events
- [x] Turn timer (60 seconds with progressive penalty)
- [x] Surrender option (with 25% rating penalty)
- [x] Match results recording (with snapshots)
- [x] PvP rewards (rating-based)
- [x] PPR-based matchmaking (±15% range, expanding)
- [x] Weighted ELO with underdog bonus
- [x] Disconnect forfeit (5 min, weekly grace)

#### 6.2.6 Leaderboards (IMPLEMENTED)

- [x] GET /api/coliseum/leaderboard
- [x] PvP rating leaderboard (by queue type)
- [x] Win/loss tracking and streaks
- [x] Leaderboards UI in ColiseumScene
- [ ] LeaderboardScene UI
- [ ] Real-time leaderboard updates

#### 6.2.7 Guild Advancement System (IMPLEMENTED)

- [x] GET /api/skills/advancement/:characterId - Check advancement eligibility
- [x] POST /api/skills/advance - Advance to advanced guild
- [x] Level 20 requirement for advancement
- [x] Class progression paths (warrior→berserker, wizard→sorcerer, monk→ninja, chemist→alchemist)
- [x] Stat recalculation on advancement
- [x] SkillTreePanel advancement UI
- [ ] GET /api/guilds/:guildId (detailed)
- [ ] GET /api/characters/:id/guilds (memberships)

#### 6.2.8 Friend System (IMPLEMENTED)

- [x] GET /api/friends - List friends with online status
- [x] GET /api/friends/requests - Pending incoming requests
- [x] POST /api/friends/request/:username - Send friend request
- [x] POST /api/friends/accept/:requestId - Accept request
- [x] POST /api/friends/decline/:requestId - Decline request
- [x] DELETE /api/friends/:friendId - Unfriend
- [x] POST /api/friends/:friendId/block - Block user
- [x] DELETE /api/friends/:friendId/block - Unblock user
- [x] PUT /api/friends/:friendId - Update favorite/note
- [x] GET /api/players/search?q= - Search by username
- [x] Friend notifications via notification system

#### 6.2.9 Notification System (IMPLEMENTED)

- [x] GET /api/notifications - List notifications
- [x] GET /api/notifications/unread-count - Badge count
- [x] POST /api/notifications/:id/read - Mark as read
- [x] DELETE /api/notifications/:id - Dismiss
- [x] Real-time WebSocket delivery
- [x] ToastManager component (popup notifications)
- [x] NotificationBell component (HUD icon with badge)
- [x] NotificationCenter component (slide-out drawer)

#### 6.2.10 LFG System (IMPLEMENTED)

- [x] GET /api/lfg - List active LFG posts
- [x] POST /api/lfg - Create LFG post
- [x] DELETE /api/lfg/:postId - Remove own post
- [x] POST /api/lfg/:postId/apply - Apply to join
- [x] CourtyardScene UI (Palace social hub)
- [x] Real-time player lobby
- [x] Persistent LFG board

### 6.3 Acceptance Criteria

- [x] Users can chat in Tavern
- [x] Chat messages appear in real-time
- [x] Users can list items for sale
- [x] Users can purchase listings
- [ ] Listings update in real-time
- [x] Users can queue for PvP
- [x] Matched players enter battle
- [x] PvP battles work correctly
- [x] Leaderboards display rankings
- [x] Users can add/remove friends
- [x] Users can search for other players
- [x] Users receive notifications in real-time
- [x] Party invites can be accepted/declined

### 6.4 Testing Checklist

- [x] Two users chat -> Messages visible to both
- [x] Create marketplace listing -> Appears for all
- [x] Purchase listing -> Item transferred, gold transferred
- [x] Queue for PvP -> Wait for match
- [x] Two users queue -> Matched together
- [x] Complete PvP battle -> Results recorded
- [x] Check leaderboard -> Rankings correct
- [x] Send friend request -> Recipient receives notification
- [x] Accept party invite -> Joins party

---

## 7. Phase 6: Polish & Launch (25% Complete)

### 7.1 Objectives

Finalize the game for initial release with UI polish, balance, and deployment.

### 7.2 Tasks

#### 7.2.1 Missing Scenes

- [x] TavernScene (full chat, presence, DMs)
- [x] ShopScene (buy/sell with dynamic pricing)
- [x] MarketplaceScene (order book, limit/market orders)
- [x] ColiseumScene (queue UI, matchmaking, leaderboards, match history)
- [x] CourtyardScene (Palace social hub, LFG board)
- [x] RecruitmentScene (Guild NPC recruitment)
- [ ] LeaderboardScene (general leaderboards - level, gold, etc.)
- [ ] SettingsScene

#### 7.2.2 UI/UX Polish

- [x] Parchment-style character detail cards (ParchmentCard component)
- [x] Unified character card rendering (BattleFormationScene + BattleUI)
- [x] Animated title text with gradient shimmer effect
- [x] 64x64 portraits (upgraded from 48x48)
- [x] HP/MP bars with inline current/max values
- [x] Battle formation UX improvements (empty grid start, FIFO placement, long-press fix)
- [ ] Consistent visual theme
- [ ] Responsive design testing
- [ ] Mobile touch optimization
- [ ] Loading indicators
- [ ] Error messages
- [ ] Success feedback
- [ ] Tooltips and help text
- [ ] Smooth transitions
- [ ] Animation polish

#### 7.2.3 Game Balance

- [ ] Stat curve review
- [ ] Damage formula tuning
- [ ] Enemy difficulty scaling
- [ ] Gold economy balance
- [ ] Experience curve review
- [ ] Item pricing balance
- [ ] PvP matchmaking tuning

#### 7.2.4 Performance

- [ ] API response time audit
- [ ] Database query optimization
- [ ] Frontend render performance
- [ ] Memory usage profiling
- [ ] WebSocket efficiency
- [ ] Asset optimization

#### 7.2.5 Testing

- [ ] Full gameplay walkthrough
- [ ] Edge case testing
- [ ] Cross-browser testing
- [ ] Mobile device testing
- [ ] Load testing (25 users)
- [ ] Security audit

#### 7.2.6 Deployment

- [ ] VPS server setup
- [ ] PostgreSQL installation
- [ ] Node.js installation
- [ ] Nginx configuration
- [ ] SSL certificate (Let's Encrypt)
- [ ] PM2 configuration
- [ ] Domain setup
- [ ] Monitoring setup
- [ ] Backup strategy
- [ ] Deployment documentation

#### 7.2.7 Documentation

- [x] PROJECT_REQUIREMENTS.md (v2.0)
- [x] TECHNICAL_ARCHITECTURE.md (v2.0)
- [x] GAME_DESIGN.md (v2.0)
- [x] DEVELOPMENT_ROADMAP.md (v3.0)
- [x] API_SPECIFICATION.md (v2.0)
- [x] CHARACTER_PROGRESSION.md (v2.0)
- [x] ITEM_SYSTEM.md (v2.0)
- [x] ECONOMY_SYSTEM.md (v2.0)
- [x] SKILL_TREES.md (v1.0)
- [x] ENEMY_SYSTEM.md (v1.0)
- [x] BATTLE_TURN_SYSTEM.md (v1.0) - CT system, turn state machine, WebSocket protocol
- [x] BATTLE_MESSAGING_PROTOCOL.md (v1.0) - Hybrid HTTP/WebSocket protocol, state sync, timing constants
- [x] BATTLE_RECONNECTION.md (v1.0) - Reconnection flow, state persistence, anti-abuse
- [x] BATTLE_ANIMATIONS.md (v1.0) - Animation system, intent visualization, timing constants
- [x] AI_SYSTEM.md (v1.0) - Utility-based AI, multi-actor lookahead, NPC skill system, monster archetypes
- [ ] README.md (setup guide)
- [ ] CONTRIBUTING.md
- [ ] CHANGELOG.md

### 7.3 Launch Checklist

- [ ] All Phase 1-5 features complete
- [ ] All critical bugs fixed
- [ ] Performance targets met
- [ ] Security review passed
- [ ] Deployment successful
- [ ] DNS configured
- [ ] SSL working
- [ ] Monitoring active
- [ ] Backup tested

---

## 8. Post-Launch Roadmap

### 8.1 Immediate Post-Launch

- Bug fixes and hotfixes
- Performance monitoring
- Player feedback collection
- Balance adjustments

### 8.2 Version 1.1 Features

| Feature | Description |
|---------|-------------|
| Remaining Advanced Guilds | 12 additional guilds beyond MVP's 4 advanced |
| Guild Quest System | Guild advancement through quests |
| More Skills | Expand skill trees beyond MVP definitions |
| New Enemies | Additional enemy types per terrain |
| Quest System | Daily/weekly quests |

### 8.3 Version 1.2 Features

| Feature | Description |
|---------|-------------|
| Player Guilds | Player-created guilds |
| Cooperative Battles | Team vs bosses |
| Equipment Crafting | Item creation |
| Achievement System | Milestones and rewards |

### 8.4 Long-term Vision

| Feature | Description |
|---------|-------------|
| New Regions | Expand world map |
| New Races/Classes | More character options |
| Seasonal Events | Limited-time content |
| Mobile App | Native mobile clients |
| Bot Detection | Advanced WebSocket abuse pattern detection algorithm |

---

## 9. Risk Assessment

### 9.1 Technical Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| WebSocket scalability | High | Redis pub/sub for multi-instance |
| Database bottleneck | Medium | Query optimization, read replicas |
| Memory limits | Medium | PM2 memory restart, profiling |
| Browser compatibility | Low | Progressive enhancement, polyfills |

### 9.2 Game Design Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Unbalanced combat | High | Iterative testing, player feedback |
| Boring progression | High | Multiple progression paths |
| Economy inflation | Medium | Gold sinks, monitoring |
| Low player retention | High | Daily rewards, social features |

### 9.3 Project Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Scope creep | High | Strict MVP definition |
| Technical debt | Medium | Regular refactoring |
| Documentation lag | Low | Document during development |

---

## 10. Success Metrics

### 10.1 Technical Metrics

| Metric | Target |
|--------|--------|
| API uptime | 99% |
| API response time (p95) | < 200ms |
| WebSocket latency | < 100ms |
| Error rate | < 1% |
| Concurrent users | 25 |

### 10.2 Game Metrics

| Metric | Target |
|--------|--------|
| New registrations | Track |
| Daily active users | Track |
| Session duration | > 15 min average |
| Battle completion rate | > 80% |
| Character progression | Track levels |

---

## 11. Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Jan 2026 | - | Initial document |
| 2.0 | Jan 2026 | - | Documentation overhaul: Updated task tracking to reflect XP-spending system, removed flee mechanic, added SKILL_TREES.md and ENEMY_SYSTEM.md references |
| 3.0 | Jan 2026 | - | **Status correction**: Thorough code verification revealed inflated completion percentages. Revised overall from 94% to 30%. Added blocking issues section, known placeholders tracker, all documented but unimplemented features (4 advanced guilds, enemy abilities, boss mechanics, shop system, marketplace, enhanced item system). Split tasks into backend/frontend completion tracking. |
| 4.0 | Jan 2026 | - | Updated status after roadmap audit. Many features were working but not documented. Revised overall from 30% to 60%. |
| 5.0 | Jan 2026 | - | **Major feature completion**: Real skills in battle (character_skills), status effects from skills, item menu in battle, equipment stat bonuses applied, equipment requirements enforced, all 4 advanced guilds (Berserker, Sorcerer, Ninja, Alchemist ~60 skills), guild advancement system (level 20), ColiseumScene UI with matchmaking. Overall revised to 75%. |
| 5.1 | Jan 2026 | - | **Turn event queue & camera fixes**: Implemented sequential turn event queue to resolve HTTP/WebSocket race conditions causing camera bounce. Fixed enemy movement (resetTurnState), AI pathfinding (obstacle-aware isReachable), and camera transition timing (updateTurnTransition in update loop). |
| 6.0 | Jan 2026 | - | **Advanced AI System overhaul**: Complete rewrite of NPC AI with utility-based scoring, multi-actor lookahead (2-3 rounds), 9 AI patterns (aggressive, defensive, support, tactical, pack, ambush, berserker, ranged, boss), monster skill trees (9 archetypes with themed skill branches), unified BattleUnit factory, server-provided availableActions, NPC skill generation service. New AI module in `api/src/services/ai/` with 7 core files. Added `docs/AI_SYSTEM.md` documentation. |
| 6.1 | Jan 2026 | - | **Guild Recruitment System**: Party expansion via guild node recruitment. 5 new database tables (traits, guild_recruits, recruit_traits, recruit_skills, character_traits), 31 seeded traits across 4 categories, procedural name generator (300 names), recruit generation with ±15% stat variance and 1-2 traits, lazy refresh system, RecruitmentScene UI, trait integration in battle calculations. New documentation: `docs/GUILD_RECRUITMENT_SYSTEM.md`. Updated GAME_DESIGN.md, CHARACTER_PROGRESSION.md, ECONOMY_SYSTEM.md, TECHNICAL_ARCHITECTURE.md, API_SPECIFICATION.md. |
| 6.2 | Jan 2026 | - | **Comprehensive Code Review**: Multi-agent systematic review of entire codebase. Added 225+ new tests across 6 test files (chatService, presenceService, coliseumService, partyWebsocket, websocketIndex, battleMechanics). Identified 24 backend issues (3 critical), 15 frontend issues (2 critical), and 21 documentation discrepancies (3 critical). Full test coverage now for WebSocket services and battle mechanics. |
| 7.0 | Jan 2026 | - | **Social & PvP Systems**: Complete multiplayer social features and PvP system. Notification system (service, API, ToastManager, NotificationBell, NotificationCenter). Friend system (requests, blocking, favorites, search). Party system fixes (schema corrections, PartyInviteModal, PartyStatusBar). CourtyardScene (Palace social hub with LFG board). Character Power Rating (PPR) valuation algorithm. PPR-based matchmaking with ±15% range. Weighted ELO rating system with underdog bonus. PvP turn timer (60s, progressive penalty). Surrender/forfeit with rating penalties. Disconnect handling (5 min forfeit, weekly grace). Match snapshots for history. Leaderboards and match history UI in ColiseumScene. Database migration 014_social_pvp_systems.sql. Overall revised to 85%. |
