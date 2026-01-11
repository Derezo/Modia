# Changelog

All notable changes to Modia are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [7.3] - January 2026

### Fixed
- Duplicate path rendering on world map (single row per connection with normalized ID ordering)
- Node labels now render above fog of war overlay

### Changed
- Character movement now follows visual Catmull-Rom spline curves instead of straight lines
- Dynamic curve variance system (5% extreme, 20% significant, 75% soft curves)

### Files Modified
- `api/src/db/seed.js`
- `frontend/src/worldmap/PathRenderer.js`
- `frontend/src/worldmap/WorldMapCharacter.js`
- `frontend/src/scenes/WorldMapScene.js`

## [7.2] - January 2026

### Added
- Complete parchment component library (Panel, Button, Input, Dropdown, Modal, Toast, ProfileDropdown)
- Responsive framework with 3 breakpoints (Mobile <600px, Tablet 600-900px, Desktop >900px)
- SVG icon system with 6 categories and PNG build script
- Scene lifecycle `onBreakpointChange()` method
- World map enhancements: Catmull-Rom spline paths, progressive fog-of-war, mystery nodes

### Changed
- Migrated 6 scenes to parchment theme (WorldMap, Formation, Inventory, Tavern, Shop, SettingsModal)
- Updated DESIGN_SYSTEM.md and FRONTEND_TECHNICAL_PATTERNS.md

### Files Added
- `frontend/src/ui/parchment/` (component library)
- `frontend/src/core/Responsive.js`

## [7.1] - January 2026

### Added
- Procedural item naming with category-based augment deduplication
- 17 prefix augments + 17 suffix augments for equipment
- 20 consumable-specific augments
- Developer seed data (derezo/password user)
- Design document for marketplace item augments integration

### Changed
- Inventory API now returns generated names, bonus stats, and augment effects
- Frontend displays augments in tooltips

## [7.0] - January 2026

### Added
- **Notification System**: Toast popups + persistent notification center with type-specific actions
- **Friend System**: Friend requests with approval, blocking, favorites, notes, player search
- **Party System**: Invite modal with countdown, party status bar in HUD
- **CourtyardScene**: Real-time player lobby + persistent LFG board at Palace nodes
- **PPR Matchmaking**: Character Power Rating = stats + level + skills + equipment value
- **Rating System**: Weighted ELO with underdog bonus based on PPR ratio
- **Turn Timer**: 60s per turn with progressive penalty (2 skips = forfeit on 3rd)
- **Match Recording**: Full team snapshots for detailed history
- Leaderboards and match history UI in ColiseumScene

### Changed
- Overall completion revised to 85%

### Database
- Migration: `014_social_pvp_systems.sql`
  - notifications, friendships, lfg_posts, pvp_disconnects tables
  - Party schema fixes
  - coliseum_matches snapshot columns

## [6.2] - January 2026

### Added
- 225+ new tests across 6 test files
- Full test coverage for WebSocket services and battle mechanics

### Fixed
- Identified and documented 24 backend issues (3 critical)
- Identified and documented 15 frontend issues (2 critical)
- Fixed 21 documentation discrepancies (3 critical)

### Test Files Added
- `chatService.test.js`
- `presenceService.test.js`
- `coliseumService.test.js`
- `partyWebsocket.test.js`
- `websocketIndex.test.js`
- `battleMechanics.test.js`

## [6.1] - January 2026

### Added
- **Guild Recruitment System**: Party expansion via guild node recruitment
- 5 new database tables (traits, guild_recruits, recruit_traits, recruit_skills, character_traits)
- 31 seeded traits across 4 categories (combat, survival, utility, situational)
- Procedural name generator with 300 names
- Recruit generation with ±15% stat variance and 1-2 traits
- Lazy refresh system for recruit pools
- RecruitmentScene UI
- Trait integration in battle calculations

### Documentation
- New: `docs/GUILD_RECRUITMENT_SYSTEM.md`
- Updated: GAME_DESIGN.md, CHARACTER_PROGRESSION.md, ECONOMY_SYSTEM.md, TECHNICAL_ARCHITECTURE.md, API_SPECIFICATION.md

## [6.0] - January 2026

### Added
- **Utility-Based AI**: Complete rewrite with 9 weighted scoring factors
- **Multi-Actor Lookahead**: Simulates 2-3 turns ahead for all characters
- **9 AI Patterns**: aggressive, defensive, support, tactical, pack, ambush, berserker, ranged, boss
- **Monster Skill Trees**: 9 archetypes (beast, dragon, undead, elemental, humanoid, construct, demon, insect, plant)
- Unified BattleUnit factory
- Server-provided availableActions
- NPC skill generation service
- AI module in `api/src/services/ai/` (7 core files)

### Documentation
- New: `docs/AI_SYSTEM.md`

## [5.1] - January 2026

### Fixed
- Turn event queue to resolve HTTP/WebSocket race conditions causing camera bounce
- Enemy movement (resetTurnState vs initializeTurnState)
- AI pathfinding (obstacle-aware isReachable using calculatePathCost)
- Camera transition timing (updateTurnTransition in update loop)

## [5.0] - January 2026

### Added
- Real skills in battle loaded from character_skills table
- Status effects from skills with effect application
- Item menu in battle with consumables from inventory
- Equipment stat bonuses applied in combat
- Equipment requirements enforcement
- All 4 advanced guilds with ~60 skills total:
  - Berserker (Warrior advancement)
  - Sorcerer (Wizard advancement)
  - Ninja (Monk advancement)
  - Alchemist (Chemist advancement)
- Guild advancement system (level 20 requirement)
- ColiseumScene UI with matchmaking

### Changed
- Overall completion revised to 75%

## [4.0] - January 2026

### Changed
- Updated status after roadmap audit
- Many features confirmed working but previously undocumented
- Overall completion revised from 30% to 60%

## [3.0] - January 2026

### Changed
- **Status correction**: Thorough code verification
- Revised completion from 94% to 30%
- Added blocking issues section
- Added known placeholders tracker
- Split tasks into backend/frontend completion tracking

## [2.0] - January 2026

### Changed
- Documentation overhaul
- Updated task tracking to reflect XP-spending system
- Removed flee mechanic (respawn at last safe node on party wipe)

### Documentation
- New: `docs/SKILL_TREES.md`
- New: `docs/ENEMY_SYSTEM.md`

## [1.0] - January 2026

### Added
- Initial project setup
- Monorepo structure (api, frontend, shared)
- Authentication system (JWT with refresh tokens)
- Character creation with 4 races and 4 base classes
- World map with procedural generation
- Basic battle system
- Initial documentation suite
