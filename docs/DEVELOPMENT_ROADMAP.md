# Modia - Development Roadmap

## Document Information

| Field | Value |
|-------|-------|
| Project Name | Modia |
| Version | 31.0 |
| Last Updated | January 2026 |

---

## Roadmap Structure

The roadmap is split into two focused documents:

| Document | Focus | Version | Link |
|----------|-------|---------|------|
| **ROADMAP_TECHNICAL.md** | Infrastructure, deployment, testing, performance, CI/CD | v2.1 | [View](./ROADMAP_TECHNICAL.md) |
| **ROADMAP_GAMEPLAY.md** | Features, mechanics, UX, content, settings | v7.0 | [View](./ROADMAP_GAMEPLAY.md) |

> **Note:** Sub-roadmaps maintain independent version numbers reflecting their update frequency.

> **Completed milestones** are archived in `docs/archive/completed/COMPLETED_MILESTONES.md`

---

## Overall Status

| Track | Completion | Status |
|-------|------------|--------|
| Technical | 45% | In Progress |
| Gameplay | 98% | Near Complete |
| **Combined** | **~78%** | In Progress |

---

## Phase Summary

| Phase | Name | Completion | Status |
|-------|------|------------|--------|
| 1 | Foundation | 100% | Complete |
| 2 | Characters & World | 98% | Near Complete |
| 3 | Combat System | 98% | Near Complete |
| 4 | Economy & Inventory | 95% | Near Complete |
| 5 | Multiplayer | 80% | In Progress (PvP modes partial) |
| 6 | Polish & Launch | 50% | In Progress |

*Updated: 2026-01-22 - Adjusted completion % after documentation audit*

---

## Current Sprint Focus

### High Priority - Gameplay

| Item | Location | Status |
|------|----------|--------|
| Social Hub (Friends, Party, Clans) | SocialHubScene.js, social/tabs/* | **COMPLETE** |
| Formation & Inventory Integration | FormationScene.js, modals/* | **COMPLETE** |
| ~~Battle Balance (Defense)~~ | ~~battleService.js~~ | **COMPLETE** (v8.8) |
| ~~Gold Sinks~~ | ~~marketplace.js, world.js~~ | **COMPLETE** (v9.0) |
| ~~Audio System~~ | ~~AudioManager.js~~ | **COMPLETE** (v9.0) |
| ~~Settings Expansion~~ | ~~SettingsScene.js~~ | **COMPLETE** (v9.0) |
| ~~Elemental Damage~~ | ~~battleService.js, elements.js~~ | **COMPLETE** (v9.0) |
| ~~Battle Log Panel~~ | ~~BattleLogPanel.js~~ | **COMPLETE** (v9.0) |
| ~~Skill Cooldowns~~ | ~~battleService.js~~ | **COMPLETE** (v9.1) |
| ~~Daily/Weekly Quests~~ | ~~dailyQuestService.js, QuestBoardScene.js~~ | **COMPLETE** (v9.2) |

### High Priority - Technical

| Item | Location | Details |
|------|----------|---------|
| ~~Rate Limit Security~~ | ~~rateLimiterFactory.js, auth.js~~ | **COMPLETE** (v8.7) |
| ~~VPS Deployment Scripts~~ | ~~Infrastructure~~ | **COMPLETE** (v8.7: setup.sh, deploy.sh, nginx, backup) |
| E2E Tests | Playwright | Full gameplay coverage |

---

## Quick Links

### Documentation
- [Technical Architecture](./TECHNICAL_ARCHITECTURE.md)
- [Battle System Index](./BATTLE_SYSTEM_INDEX.md)
- [Worldgen Technical Deep Dive](./WORLDGEN_TECHNICAL_DEEP_DIVE.md)
- [API Specification](./API_SPECIFICATION.md)
- [Game Design](./GAME_DESIGN.md)

### Design Documents (Archived)
*All design documents have been implemented and archived.*
- [Regional World Generation](./archive/2026-01-13-regional-world-generation-design.md) - v8.4
- [Formation & Inventory Integration](./archive/2026-01-12-formation-inventory-integration-design.md) - v8.2
- [Marketplace Augments](./archive/2026-01-11-marketplace-item-augments-design.md) - v8.1

### Archives
- [Completed Milestones](./archive/COMPLETED_MILESTONES.md)

---

## Success Metrics

### Technical Targets

| Metric | Target |
|--------|--------|
| API uptime | 99% |
| API response time (p95) | < 200ms |
| WebSocket latency | < 100ms |
| Error rate | < 1% |
| Concurrent users | 25 |

### Gameplay Targets

| Metric | Target |
|--------|--------|
| Session duration | > 15 min |
| Battle completion rate | > 80% |
| Daily active users | Track |

---

## Document History

| Version | Date | Changes |
|---------|------|---------|
| 31.0 | Jan 2026 | Documentation Audit v9.8: Comprehensive documentation review with ~78% alignment. Updated CHARACTER_PROGRESSION.md (v3.0): Level formula to 2.8 exponent, polynomial skill costs. Updated SKILL_TREES.md (v2.0): Removed tier XP multipliers, simplified prerequisites. Updated BATTLE_MODES.md (v1.1): Added implementation status section. Updated ROADMAP_TECHNICAL.md (v2.1): Verified file sizes, audited known issues. Updated ROADMAP_GAMEPLAY.md (v7.0): Marked deferred items, added TavernScene status. Phase completion percentages adjusted. |
| 30.0 | Jan 2026 | Battle Map Visual Overhaul (v9.5): Isometric terrain sprite system with 64 generated sprites (7 terrain types × 4 variants + elevation variants). New generate-terrain-tiles.js using Sharp SVG-to-PNG. Updated BattleGrid.js with elevation-aware rendering, click detection, fallback wall faces. AssetLoader.js enhanced with getElevatedTile(), biome resolution. Fixed movement desync: status effects now use flat modifiers (+/-1) matching server, added e.type check, added all movement-preventing effects (stun/freeze/sleep/root). New movement-sync.integration.test.js (20 tests). Rock terrain now brown-red (#8b4513) for clear distinction from stone. |
| 29.0 | Jan 2026 | Battle Map Cleanup: Removed CoverGridSystem (tactical cover deemed unnecessary). Removed decorative obstacles entirely from codebase. Simplified map generation by removing cover strategies from archetypes. Files deleted: CoverGridSystem.js, coverGridSystem.test.js, decorative obstacle sprites. Cleaner battle maps with only functional terrain. |
| 28.0 | Jan 2026 | Legacy Map Generation Removal: Removed all backward-compatibility code from mapGeneration.js. Deleted generateTerrainLegacy(), generateWithPipeline(), and all legacy obstacle functions. Removed useArchetypes and useNewPipeline flags. Archetype-based system is now the only code path. Unknown node types fall back to 'openField' archetype. File reduced from 989 to 693 lines (~296 lines removed). All 265 tests pass. |
| 27.0 | Jan 2026 | Battle Map Generation Overhaul (v9.4): 8-phase modular procedural map generation. New modules: PRNGStreams (Mulberry32 with stream isolation), 14 map archetypes with weighted selection, LayerContext for algorithm cooperation, TopologyGraph/POI/GraphBuilder for topology-driven generation, ConstraintValidator with automatic repair, StyleProfiles with 6 presets. (Note: CoverGridSystem removed in v29.0) |
| 26.0 | Jan 2026 | XP/Leveling Bug Fixes: Fixed HP/MP never updating on level up (critical bug: level 256 monk with only 118 HP). Fixed XP cost formula mismatch between frontend (exponential) and backend (polynomial). Fixed API response field name (`xpRemaining` instead of `availableXp`). Capped all skill requirements at level 5 (was 10-25). Added skill name display in prerequisites (was showing IDs). Added level-up toast when character levels via skill learning. New migration: 037_fix_character_hp_mp.sql. |
| 25.0 | Jan 2026 | Documentation Consolidation v9.1: Skill Cooldowns marked COMPLETE (backend implemented in battleService.js). Status Effect Duration Display marked COMPLETE (BattleUnit.js). Mini-map Display marked COMPLETE (WorldMapMinimap.js with click-to-navigate). Quest documentation restructured into index + detailed specs (QUEST_SYSTEM.md, GUILD_ADVANCEMENT.md, DAILY_WEEKLY_QUESTS.md). Added TODO items from code audit to roadmaps. Archived stale documentation. |
| 24.0 | Jan 2026 | Gameplay Features v9.0: Audio System (Web Audio API, scene-based music, SFX, volume controls). Settings Expansion (7 categories, ~44 settings, colorblind modes). Elemental Damage System (8 elements, resistances, enemy/racial templates). Battle Log Panel (scrollable combat history, color-coded entries). Gold Sinks (marketplace 5% fee, fast travel, stamina restore). Relic System (rare collectibles, permanent bonuses). Gameplay track now 98%. Sprint focus updated with remaining high-priority items. |
| 23.0 | Jan 2026 | Project cleanup audit: Installed knip for dead code analysis. Removed unused 'serve' dependency. Fixed console.log statements in marketplace.js (now uses logger). Archived 4 design documents (regional world gen, formation, icons, marketplace). Added v8.3-v8.8 to COMPLETED_MILESTONES.md. Updated ROADMAP_TECHNICAL.md v1.5 (marked infrastructure complete, added known issues). Updated ROADMAP_GAMEPLAY.md v4.1 (added battle log, elemental damage, touch gestures, keyboard nav). Technical track now 45%, Gameplay 92%. |
| 22.0 | Jan 2026 | Battle System Formula Overhaul (v8.8): FFT-style tactical combat rebalance. Defense with diminishing returns (DEF/(DEF+100)). CT turn order system (ctGain=5+AGI/10, act at CT>=100). LCK now scales with level and affects crits/evasion/status resist. VIT provides HP bonus (level/2 + VIT*0.5). Polynomial skill costs (baseCost*level^1.5) for achievable max level. Archetype-based enemy scaling matching player growth. New files: formulaValidation.test.js. Modified: battleMath.js, constants.js, battleService.js, battleUnitFactory.js, skills.js, skillScaling.js, enemies.js, test files. Combat System now 95% complete. |
| 21.0 | Jan 2026 | Security & Infrastructure (v8.7): Trust proxy for proper IP detection behind nginx. Per-user rate limiting for authenticated requests (tied to userId). New rate limiters: auth/refresh (20/15min IP), world/travel (60/min user), gameplay actions. Global limits increased (300 base, 600 prod, 1500 dev). JWT extended to 1h with automatic refresh 1min before expiry. TokenRefreshManager for seamless token renewal + 401 retry logic. VPS deployment scripts: setup.sh (Node.js 20, PM2, PostgreSQL, Nginx), deploy.sh (zero-downtime with rollback), nginx.conf.template (WebSocket, SSL, caching), backup.sh (pg_dump with 7-day retention). |
| 20.0 | Jan 2026 | Activity Node Systems (v8.6): Complete implementation of all 4 activity node types. Fishing: FishingScene.js with auto-fishing, Big One events, 15 fish types, session management. Ruins: RuinsPuzzleModal.js with 3x3/4x4/5x5 sliding puzzles, regional themes, tier rewards. Caravan: ShopScene.js extension with 23 exclusive items, 48-hour refresh, seeded inventory. Watchtower: Fog reveal endpoint. Security: FOR UPDATE locks, MAX_GOLD caps, advisory locks for race conditions. New files: fishingService.js, caravanService.js, ruins.js, fishing.js, fish.js, caravanItems.js, FishingScene.js, RuinsPuzzleModal.js. |
| 19.0 | Jan 2026 | World Generation Improvements (v8.5): New node types (fishing_spot, merchant_caravan, ruins, watchtower, farm). Guild distribution: 3 per region with race-appropriate primary guild. Node distribution: 40-50% battle target. 12 zodiac shrines placed globally. Bridge visual enhancement (river/canyon hint). Flickering bug fixed (canvas save/restore). Migration: 031_expanded_node_types.sql. 3 new tests for worldgen validation. |
| 18.0 | Jan 2026 | AI Enemy Skill System Fix: Fixed `getSkillDefinition` to support monster archetype skills (beast, insect, dragon, etc.). Added `getSkillRangeTiles` for accurate skill range visualization. Fixed target ID property mismatch in action generator. New test suite: battleService.unit.test.js (26 tests). Combat System now functional for all enemy types. |
| 17.0 | Jan 2026 | Technical Debt Cleanup: Modularized seed.js from 4862 to 918 lines into 12 worldgen modules. Added LRU cache limits to WorldMapScene pathPreviewCache. Created composite database indexes for regional queries. Fixed phase3.test.js imports. |
| 16.0 | Jan 2026 | World Map Enhancement: Terminator treasure nodes (chest/shrine/discovery), terrain obstacles (lakes, mountains, forests), compact node options panel with type badge, settlement adjacency rules preventing same-type connections, connection count constraints. 6 new API endpoints, 2 new migrations, security hardening (location validation, race condition prevention). |
| 15.0 | Jan 2026 | Character Portrait Enhancement v2: Comprehensive overhaul of 120 character portraits (5 races × 3 genders × 8 classes). Added gender-specific face rendering (face shapes, eyes, cheekbones). Enhanced race distinctiveness (vampire fangs 4px, elf circlet with gem, orc hair contrast, dwarf female sideburns). Improved class identity (warrior insignia, monk chi glow, sorcerer dark aura, ninja clan symbol/weapons, berserker rage glow). New utils: drawGenderedEyes(), drawCheekbones(), drawEyeGlow(), drawSymbol(), orcHair/darkMagic palettes. |
| 14.0 | Jan 2026 | Item Detail & Equip Modal Improvements: New statDisplay.js utility for consistent stat/augment formatting. ItemDetailModal shows full stat names and augment effect descriptions. EquipmentSlotModal redesigned with side-by-side comparison cards, stat changes summary, responsive mobile layout. |
| 13.0 | Jan 2026 | Profile Image Generation System (v8.2): Programmatic SVG portrait generation for 92 missing portraits (76 character + 16 enemy). New races: Dwarf, Vampire, Orc. All enemy types now have portraits. |
| 12.0 | Jan 2026 | Formation & Inventory Integration complete (v8.2): Modal-based party management with 9 new components (Accordion, CharacterCard, PartyStatsSummary, CharacterPicker, ItemsModal, ItemDetailModal, CharacterModal, EquipmentSlotModal, SkillDetailModal). FormationScene redesigned with character grid. InventoryScene/InventoryPanel deleted. User Experience at 85%. |
| 11.0 | Jan 2026 | Unified Social Hub complete (v8.0): SocialHubScene with 5 tabs (Friends, Party, Requests, LFG, Clan). Clan system MVP with create/join/invite/chat. CourtyardScene deprecated. Social features at 95%. |
| 10.0 | Jan 2026 | Roadmap audit v8.0: Corrected completion percentages across all phases. Updated sprint focus with Friends UI, PartyInviteModal, Battle Balance, Gold Sinks. Added rate limit security to technical priorities. |
| 9.0 | Jan 2026 | Split roadmap into ROADMAP_TECHNICAL.md and ROADMAP_GAMEPLAY.md. Added quest system, node blocking, settings expansion to gameplay track. |
| 8.0 | Jan 2026 | Major cleanup, archived completed milestones |
| 7.0-7.6 | Jan 2026 | Social/PvP, parchment UI, world map, boss mechanics, title animation |
| 6.0-6.2 | Jan 2026 | Advanced AI, guild recruitment, code review |
| 1.0-5.1 | Jan 2026 | Initial development through multiplayer |
