# Modia - Gameplay Roadmap

## Document Information

| Field | Value |
|-------|-------|
| Version | 7.0 |
| Last Updated | January 2026 |
| Focus | Features, mechanics, UX, content |

---

## Status Summary

| Category | Completion | Status |
|----------|------------|--------|
| Core Mechanics | 100% | Complete |
| Combat System | 99% | Near Complete |
| Economy & Items | 95% | Near Complete |
| User Experience | 95% | Near Complete |
| Social Features | 95% | Complete |
| World & Progression | 98% | Near Complete |

---

## 1. Core Mechanics (NEW)

### 1.1 Quest System (Complete)

> **Purpose:** Class advancement through guild hall quests

#### Database Tables
- [x] `advancement_quest_templates` - Quest definitions (020_guild_quest_system.sql)
- [x] `character_quests` - Quest progress with JSONB tracking
- [x] `guildmaster_templates` - Guildmaster boss templates (021_guildmaster_bosses.sql)
- [ ] `character_titles` - Earned titles (deferred to v1.1)

#### Quest System (Implemented)
- [x] Material collection quest requirements
- [x] Enemy kill quest requirements
- [x] Node visit quest requirements
- [x] Boss fight quest (solo guildmaster battle)
- [x] Progress tracking via battle/world/inventory hooks

#### UI Components
- [x] GuildAdvancementScene.js - Quest board + guildmaster dialog
- [x] BossPhaseIndicator.js - Boss HP and phase display
- [ ] QuestTracker.js - HUD objectives (deferred)

#### API Routes (advancementQuest.js)
- [x] `GET /api/advancement/available/:characterId`
- [x] `GET /api/advancement/current/:characterId`
- [x] `POST /api/advancement/accept`
- [x] `POST /api/advancement/abandon/:characterId`
- [x] `GET /api/advancement/boss/:characterId`
- [x] `POST /api/advancement/boss/start`
- [x] `GET /api/advancement/history/:characterId`

### 1.2 Node Blocking System (Complete)

> **Purpose:** Require battles at combat nodes to progress

#### Blocking Node Types
- [x] Forest nodes - require clearing
- [x] Bridge nodes - require clearing
- [x] Mountain nodes - require clearing
- [x] Cave nodes - require clearing

#### Database
- [x] `user_node_clearance` table (019_node_blocking.sql)
- [x] Clearance on battle victory (battle.js)

#### Behavior
- [x] Block travel THROUGH until cleared
- [x] Allow travel TO blocked nodes
- [x] Allow travel FROM blocked nodes (return to cleared areas)
- [x] BFS pathfinding respects blocked intermediate nodes

#### Visuals (WorldMapScene.js)
- [x] Red tint + lock icon (blocked)
- [x] Green checkmark (cleared)
- [x] Orange path preview through blocked

### 1.3 Audio System (Complete - v9.0)

- [x] Web Audio API integration
- [x] Sound effect loading/playback
- [x] Scene-based music system
- [x] Battle music and UI sounds
- [x] Volume controls wired to settings

### 1.4 Boss Battle Integration (Complete)

- [x] bossService.js with phase transitions
- [x] Database migration (018_boss_mechanics.sql)
- [x] 3 boss templates seeded
- [x] guildmasterBattleService.js for advancement battles
- [x] Integration with battleService (phase damage detection)
- [x] BossPhaseIndicator.js frontend component
- [x] WebSocket phase transition events (battleWebsocket.js)

---

## 2. Combat System Enhancements

### 2.1 Battle Engine

- [x] Battle log panel (scrollable combat history with damage/healing/status events) - v9.0
- [x] Elemental damage system (8 elements, resistances, enemy/racial templates) - v9.0
- [x] Skill cooldowns (battleService.js lines 1317-1322, 1777-1781) - v9.1
- [x] Status effect duration display (BattleUnit.js duration numbers on icons) - v9.1
- [x] Elevation-aware tilemap rendering (coordinate transformation, depth sorting, click detection) - v9.7
- [x] Frontend/backend 3D pathfinding synchronization (movement highlights match server validation) - v9.7
- [x] Tile cycling for overlapping elevations (auto-cycle 1.5s, Tab key, mobile long-press) - v9.8
- [x] Occlusion transparency (35% alpha for tiles blocking units) - v9.8
- [x] Height movement animation (parabolic arc for elevation transitions) - v9.8

### 2.2 Enemy System

> **Note:** Ability execution is deferred to post-MVP. Enemies currently use basic attacks with scaling damage.

- [ ] Ability execution system (use defined abilities array in enemy templates) - **Deferred**
- [ ] Ability cooldowns per enemy - **Deferred**
- [ ] Ability trigger conditions - **Deferred**
- [ ] New enemy types (Tier 5+ for endgame content)

### 2.3 Advancement Trial Bosses (Complete)

> **Purpose:** 4 guildmaster bosses for advancement quests

- [x] Guildmaster templates seeded (guildmaster_templates table)
- [x] Solo battle mode (1 player vs guildmaster + disciples)
- [x] Phase-based mechanics (bossService.js)
- [x] Guildmaster scaled to challenger level + 5
- [x] Disciple units from lower tier classes

### 2.4 Battle Balance (Complete - v8.8)

> **Purpose:** FFT-style tactical combat with meaningful stat choices

#### Defense Formula Rebalance
- [x] Percentage-based damage reduction with diminishing returns
  - Physical: `defense / (defense + 100)`
  - Magical: `defense / (defense + 80)`
- [x] Effective cap at ~80% reduction (300+ defense)
- [x] VIT contributes to physical defense, INT/2 to magic defense

#### CT Turn Order System (FFT-style)
- [x] CT gain formula: `5 + (AGI / 10)` - diminishing returns
- [x] Haste/Slow modifiers (1.5x / 0.5x)
- [x] Action at CT >= 100 threshold
- [x] Initial CT: `(AGI / 2) + random(0, 20)`

#### LCK Stat Overhaul
- [x] LCK now grows with level (0.3-1.5 per level by class)
- [x] Crit chance: `5% base + LCK/300` (cap 50%)
- [x] Crit damage: `1.5 + LCK/500` (orcs +15% bonus)
- [x] Evasion: `2% base + agiDiff/400 + LCK/400` (cap 35%)
- [x] Status resistance: `10% base + LCK/200` (cap 50%)

#### VIT HP Bonus
- [x] HP formula: `baseHP + floor(level/2 + VIT * 0.5)`
- [x] High VIT builds have significantly more HP

#### Enemy Scaling
- [x] Archetype-based growth rates (beast, humanoid, undead, elemental, dragon, boss)
- [x] Tier multipliers: 0.8x/1.0x/1.25x/1.5x/2.0x
- [x] Enemies match player power at equivalent levels

#### Skill Progression
- [x] Polynomial cost: `baseCost * level^1.5` (achievable max level)
- [x] Power scaling: +0.8%/level for basic, +0.5%/level for advanced

#### Remaining (v8.9)
- [ ] Variable CT costs (Move+Act: 100, Move OR Act: 80, Wait: 60)
- [x] Status duration display in battle UI (BattleUnit.js) - v9.1
- [ ] Enemy ability execution system

---

## 3. Economy & Items

### 3.1 Advanced Item System

Per ITEM_SYSTEM.md specifications:

> **Note:** Core item system is complete. Advanced augments deferred to post-MVP.

- [x] Basic item augments (stat bonuses, damage bonuses)
- [x] Item rarity system (common to legendary)
- [x] Equipment slots and requirements
- [ ] 5 intensity tiers (Minor → Supreme) - **Post-MVP**
- [ ] Enemy-type prefixes (Dragonbane, etc.) - **Post-MVP**
- [ ] Defensive augments - **Post-MVP**
- [ ] Support augments - **Post-MVP**
- [ ] Combat augments - **Post-MVP**
- [ ] Set item bonuses - **Post-MVP**
- [ ] Full metal tier progression (12 tiers) - **Post-MVP**

### 3.2 Marketplace Enhancements

- [x] Display item augments in listings (ItemDataTable integration)
- [x] Augment category filter (itemDataTableColumns.js)
- [x] Price suggestion based on augments (calculateSuggestedPrice)
- [x] Max 10 open orders enforcement (implemented in marketplace.js)
- [x] Order expiration system (7-day, orderExpirationService.js)
- [x] Market Dashboard with parchment price chart (MarketDashboard.js)
- [x] My Listings tab (ItemDataTable integration)
- [x] My Inventory tab for listing items (getSellableInventory API)

### 3.3 Shop System

- [x] Stock refresh cycles (6-24 hours) - shopRefreshService.js
- [x] ItemDataTable integration for Shop Buy/Sell tabs
- [x] Supply level display with color-coded badges
- [ ] Item decay system (10% daily)

### 3.4 Gold Sinks (Complete - v9.0)

> **Purpose:** Prevent late-game gold inflation

**High Priority (Complete):**
- [x] Marketplace fee (5% seller fee on sales)
- [x] Fast travel costs (50-500g by distance)
- [x] Stamina restore for gold (100g per point)

**Medium Priority:**
- [ ] Skill respec fee (1000-5000g scaling)
- [ ] Formation slot unlock (2000g per slot)
- [ ] Storage expansion (5000g per 10 slots)

**Low Priority (Complex):**
- [ ] Equipment repair system (requires durability)
- [ ] Guild upgrade costs (player guilds feature)

### 3.5 Relic System (Complete - v9.0)

> **Purpose:** Rare collectibles providing permanent bonuses

- [x] Relic item category and templates
- [x] Relic discovery from ruins and special events
- [x] Permanent stat bonuses from owned relics
- [x] Relic collection UI

---

## 4. User Experience

### 4.1 Settings System Expansion (Complete - v9.0)

#### Current (7 categories, ~44 settings)
- [x] Battle: actionMenuStyle, camera settings, previews, battle log verbosity
- [x] Audio: master, music, sfx volumes, mute toggles
- [x] Display: animations, damage numbers, grid overlay, health bars
- [x] Accessibility: colorblind modes (protanopia, deuteranopia, tritanopia), high contrast, reduced motion, text size
- [x] Gameplay: tutorials, auto-save, confirmations
- [x] Social: online status, party invites, chat settings
- [x] Controls: keybinds, mouse sensitivity, touch settings

#### Implemented Features
- [x] SettingsManager.js with event-driven updates
- [x] Settings wired to game systems (audio, battle, accessibility)
- [x] 8-tab settings UI (Battle, Audio, Display, Accessibility, Gameplay, Social, Controls, Developer)
- [x] Developer Settings with debug logging toggles (audio, network, state, battle, performance)
- [x] FPS counter overlay and slow frame warnings
- [x] Colorblind mode filters applied to canvas rendering
- [x] Settings persistence to localStorage and database

#### Remaining (Post-MVP)
- [ ] Screen reader optimization
- [ ] Dyslexia font option (OpenDyslexic)
- [ ] Haptic feedback toggle (mobile)

### 4.2 Mobile Optimization

- [ ] Touch gesture improvements (momentum pan, pinch-to-zoom)
- [ ] Minimum 44px tap targets for accessibility
- [ ] Swipe gestures for navigation
- [ ] Double-tap confirmation
- [ ] Responsive layouts (already partial via Responsive.js)
- [ ] Portrait/landscape adaptation for battle UI

### 4.3 Formation & Inventory Integration (Complete - v8.2)

> **Design Document:** [2026-01-12-formation-inventory-integration-design.md](./plans/2026-01-12-formation-inventory-integration-design.md)

**Goal:** Unify party management into FormationScene, eliminate separate InventoryScene.

#### New Components
- [x] Accordion.js - Collapsible panel with state persistence
- [x] CharacterCard.js - Parchment-styled party member card with badges
- [x] PartyStatsSummary.js - Party composition and stats bar
- [x] CharacterPicker.js - Character selection for consumables
- [x] ItemsModal.js - Full inventory view with DataTable
- [x] ItemDetailModal.js - Item details and use consumable action
- [x] CharacterModal.js - Character details with Equipment/Skills accordions
- [x] EquipmentSlotModal.js - Equipment slot management with stat comparison
- [x] SkillDetailModal.js - Revamped skill view with progression table

#### DataTable Enhancements
- [x] statComparison rendering (integrated directly in EquipmentSlotModal)
- [x] Equipment slot list rendering (custom implementation in CharacterModal)

#### FormationScene Redesign
- [x] Full-screen character card grid (responsive: 4/3/2 columns)
- [x] Party stats summary bar (composition, avg level, power, skill points)
- [x] Items button in header → ItemsModal
- [x] Character card click → CharacterModal
- [x] Remove "Slots 1-5" misleading text
- [x] Remove right-side detail panel

#### Extra Features
- [x] Character card badges (red: equipment upgrade, yellow: skill points)
- [x] Quick Equip Best button (auto-equip optimal items)
- [x] Context-dependent accordion states (open if action available)

#### Cleanup
- [x] Delete InventoryScene.js
- [x] Delete InventoryPanel.js
- [x] Remove Inventory from ProfileDropdown menu

#### BattleFormationScene Enhancements (v8.3)
- [x] Show all 12 party characters (was limited to 5)
- [x] Click-to-cycle through all 12 characters for placement
- [x] Direction indicator (red border highlight) showing enemy side
- [x] Level-based default sorting for character roster

#### FormationScene Enhancements (v8.3)
- [x] Sorting options (Level, Class, Name) with toggle buttons
- [x] Remove empty slot placeholders (show only existing characters)

### 4.4 UI Polish

- [ ] Loading state indicators (spinners, skeleton screens)
- [ ] Tooltips for terrain costs, skill descriptions, stat explanations
- [ ] Keyboard navigation system (focus indicators, tab navigation)
- [ ] Canvas object pooling (reduce GC pressure for animations)
- [ ] Animation polish
- [x] Error feedback (parchment toast consolidation)
- [x] Color scheme corrections (dark brown text, gold accents only)
- [x] Element color system (skill type icons with muted backgrounds)
- [x] Progress bar readability (text outlines)
- [x] Icon component doubling fix
- [x] Turn Order Panel redesign (collapsed/expanded states, parchment styling)
- [x] Enemy icon generation system (16 programmatic SVG icons)
- [x] Stat display formatting (full names in modals, abbreviations in lists)
- [x] Augment effect descriptions (show actual effects, not augment names)
- [x] Equipment comparison cards (side-by-side with stat change summary)
- [x] Responsive equip modal (stacks on mobile <600px)
- [x] Tap-to-preview in Turn Order (camera pan, target panel preview)

---

## 5. World & Progression

### 5.1 World Map

- [x] Node hover information (detailed tooltips) - v9.6 NodeHoverTooltip.js with progressive disclosure
- [x] Mini-map display (WorldMapMinimap.js with click-to-navigate, fog of war, region colors) - v9.1
- [x] Blocked/cleared node visuals (WorldMapScene.js)
- [x] Quest markers - v9.6 QuestMarkerManager.js, QuestProgressHUD.js
- [x] Terrain obstacles rendering (lakes, mountains, forests)
- [x] Compact node options panel with type badge
- [x] Settlement adjacency rules (no village-village, city-city, etc.)
- [x] Connection count constraints (castle 5+, city 3+, bridge exactly 2)

### 5.1.1 Terminator Treasure Nodes (Complete)

> **Purpose:** Reward exploration with unique nodes at map edges

#### Node Types
- [x] Chest nodes - One-time gold rewards (scaling with distance)
- [x] Shrine nodes - Timed buffs with 24-hour cooldown
- [x] Discovery nodes - Lore unlocks (revisitable)

#### Database
- [x] 027_terminator_nodes.sql - New node types, tracking tables
- [x] 028_world_obstacles.sql - Terrain obstacle storage
- [x] user_chest_claims table - One-time claim tracking
- [x] user_shrine_visits table - Buff tracking with cooldown
- [x] user_discoveries table - Lore progress tracking

#### API Endpoints
- [x] POST /api/world/nodes/:id/claim-chest
- [x] POST /api/world/nodes/:id/visit-shrine
- [x] POST /api/world/nodes/:id/discover
- [x] GET /api/world/obstacles
- [x] GET /api/world/active-buffs
- [x] GET /api/world/my-discoveries

#### Security
- [x] Location validation (must be at node to interact)
- [x] Race condition prevention (atomic claim inserts)
- [x] Integer overflow protection on gold updates

### 5.1.2 Regional World Generation (Complete - v8.4)

> **Purpose:** Replace single-castle world with 5-region Voronoi-based system
> **Design Doc:** [Regional World Generation Design](./plans/2026-01-13-regional-world-generation-design.md)

#### 5-Region System
- [x] Voronoi partitioning from castle positions (d3-delaunay)
- [x] Force-directed castle placement (25 unit minimum distance)
- [x] Lloyd's relaxation for even spread
- [x] Organic region boundaries stored as polygons

#### Racial Regions
- [x] Heartlands (Human) - Forest dominant
- [x] Sylvan Reaches (Elf) - Forest dominant
- [x] Iron Depths (Dwarf) - Cave dominant
- [x] Shadowmere (Vampire) - Cave dominant
- [x] Bloodplains (Orc) - Mountain dominant

#### Ring-Based Structure (per region)
- [x] Ring 0 - Castle core (battle node guards)
- [x] Ring 1 - Inner civilization (cities, villages)
- [x] Ring 2 - Frontier (keeps, guilds)
- [x] Ring 3 - Wilderness edge (terminators)

#### Inter-Region Connections
- [x] Bridge chokepoints (1-2 per border)
- [x] Border wilderness zones (mixed terrain)
- [x] Trade routes (safe corridors between cities)
- [x] Grand Palace at multi-region vertex

#### Node Generation
- [x] Poisson disk sampling within Voronoi cells
- [x] 70/30 terrain distribution (dominant/secondary)
- [x] MST + extra connections for connectivity
- [x] Settlement adjacency rules enforced

#### API Endpoints
- [x] GET /api/world/regions - List all regions
- [x] GET /api/world/regions/:id - Single region details
- [x] POST /api/characters/respawn - Return to home castle

#### Character Spawning
- [x] Race-based spawn at racial homeland castle
- [x] home_region_id tracking for respawn
- [x] Updated character creation flow

#### Database (029_regional_world.sql)
- [x] world_regions table with boundaries
- [x] region_id, region_race, ring_distance on world_nodes
- [x] Foreign keys and indexes

### 5.1.3 World Generation Improvements (Complete - v9.7)

> **Purpose:** Enhance world variety with new node types, better distribution, and improved connectivity
> **Migration:** 031_expanded_node_types.sql

#### New Node Types
- [x] Fishing spots - Resource mini-game locations
- [x] Merchant caravans - Traveling traders with random inventory
- [x] Ruins - Puzzle/exploration for treasure
- [x] Watchtowers - Reveal nearby undiscovered nodes (very rare, outer rings)
- [x] Farms - Additional settlement type for outer areas

#### Zodiac Shrine System (Complete - v9.6)
- [x] 12 zodiac shrines placed (one of each type): Aries, Taurus, Gemini, Cancer, Leo, Virgo, Libra, Scorpio, Sagittarius, Capricorn, Aquarius, Pisces
- [x] Shrine placement: outer areas, evenly distributed with MIN_SPACING=15
- [x] shrine_buff_type column for zodiac identification
- [x] Zodiac crystal collection system (collect all 12 for bonus)
- [x] Unique blessings per zodiac type (ZODIAC_SHRINE_BUFFS in constants.js)
- [x] Relic collection modal (RelicCollectionModal.js)
- [x] Zodiac indicator HUD element (ZodiacIndicator.js)
- [x] Shrine tooltip with crystal status (NodeHoverTooltip.js)

#### Guild Distribution Enhancement
- [x] 3 guilds per region (up from 1)
- [x] Primary guild in Ring 1 (race-appropriate type)
- [x] 2 secondary guilds in Rings 2-3 (different types)
- [x] Race-to-guild mapping: Orc→Warrior, Elf→Wizard, Human→Monk, Dwarf→Chemist

#### Node Distribution Rebalancing
- [x] Target: 40-50% battle nodes (down from 60-70%)
- [x] Target: 20-30% activity/neutral nodes
- [x] Target: 20-30% settlements
- [x] Farms in outer areas, not near castles

#### Connection Improvements
- [x] Max connection distance: 10-12 world units
- [x] Inter-region bridges with subtle river/canyon visual
- [x] Gap infill via intermediate nodes (implemented in inter-region connections)

#### Node Distribution Quality (Complete - v9.7)
- [x] Global guild same-type spacing (~100 units / 3000px between same types)
- [x] Battle terrain anti-clustering (prevent 3+ same-type nodes clustering)
- [x] Zodiac shrine validation (exactly 12 shrines or generation fails)
- [x] Guild distribution validation (3 different guild types per region)

#### Activity Node Features (Complete - v8.6)
- [x] Fishing mini-game implementation (FishingScene.js, fishingService.js)
- [x] Merchant caravan inventory and trading mechanics (caravanService.js, ShopScene.js)
- [x] Ruins sliding tile puzzle system (RuinsPuzzleModal.js, ruins.js)
- [x] Watchtower reveal mechanic (world.js watchtower-view endpoint)

### 5.2 Character Progression

- [x] Remove old auto-advancement from skills.js
- [x] Guild hall advancement via quests (advancementQuest.js)
- [x] Quest chain completion required
- [ ] Title system (deferred to v1.1)

### 5.2.1 Skill System Overhaul (Complete - v8.1)

> **Purpose:** Comprehensive skill progression with visual feedback

#### Character Leveling from Spent XP
- [x] spent_xp column tracking (026_skill_system_overhaul.sql)
- [x] Level threshold formula: level^2.8 * 100
- [x] characterLevelService.js with level calculations
- [x] Level-up stat gains based on CLASS_GROWTH
- [x] Multiple level-up support in single skill learning

#### Skill Scaling System
- [x] skillScaling.js config module
- [x] Linear scaling formula: baseValue + (level - 1) * increment
- [x] Max skill level 100 for all skills
- [x] Per-skill scaling overrides via scaling property
- [x] Scaled attributes in battle (power, effectChance, effectDuration)

#### Visual Effect Categories (13 Categories)
- [x] SkillEffectCategories.js with color palettes
- [x] Category-based particle effects (burst, fall, rise, orbit, swirl)
- [x] Automatic category inference from skill properties
- [x] Self-targeting skill detection and aura effects

#### UI Updates
- [x] SkillTreePanel.js XP progress bar
- [x] Skill attribute preview with scaling comparison
- [x] Level-up toast notifications with stat gains

#### Files Created/Modified
- `api/src/migrations/026_skill_system_overhaul.sql` (new)
- `api/src/services/characterLevelService.js` (new)
- `api/src/config/skillScaling.js` (new)
- `frontend/src/battle/SkillEffectCategories.js` (new)
- `api/src/config/skillTrees.js` (modified)
- `api/src/routes/skills.js` (modified)
- `api/src/services/battleService.js` (modified)
- `frontend/src/battle/BattleAnimations.js` (modified)
- `frontend/src/scenes/BattleScene.js` (modified)
- `frontend/src/components/SkillTreePanel.js` (modified)

### 5.3 Social Features (Complete)

> **Purpose:** Complete social system UI integration

#### Unified Social Hub (v8.0) - COMPLETE
- [x] SocialHubScene.js with 5-tab navigation (Friends, Party, Requests, LFG, Clan)
- [x] FriendsTab.js - Friends list with status, favorites, search
- [x] FriendCard.js - Compact Discord-like friend display
- [x] RequestsTab.js - Unified inbox for friend/party/clan invites
- [x] PartyTab.js - Party management with Quick Party Formation
- [x] LFGTab.js - Migrated from CourtyardScene
- [x] ClanTab.js - Clan create/join/chat MVP
- [x] Clan system (025_clans.sql migration, API routes, service)
- [x] ProfileDropdown friends button wired to Social Hub
- [x] CourtyardScene deprecated (redirects to Social Hub LFG tab)

#### Backend (Complete - v7.0)
- [x] Friend API routes (requests, blocking, favorites, search)
- [x] Party system with invites
- [x] Clan API routes (create, join, leave, disband, invite, chat)

#### Tavern 2.0 (Future - Post-MVP)

> **Note:** Basic TavernScene exists with presence and chat. Advanced features below are deferred.

- [x] TavernScene with presence indicator
- [x] Node-scoped chat (tavern:nodeId rooms)
- [ ] Real-time movement in tavern space
- [ ] Position sync via WebSocket
- [ ] Proximity-based chat bubbles
- [ ] Interaction zones (bar, tables, fireplace)
- [ ] Emote system (/wave, /sit, /dance)
- [ ] Quest board for daily quests

---

## 6. Post-MVP Features

### 6.1 Version 1.1

| Feature | Description | Priority |
|---------|-------------|----------|
| Daily/Weekly Quest System | Repeatable content loop for player retention | **High** |
| Remaining Advanced Guilds | 12 additional beyond MVP 4 | Medium |
| Guild Quest System | Non-advancement quests | Medium |
| New Enemies | Additional enemy types (Tier 5+) | Medium |

#### Code TODOs (from audit)

| TODO | File:Line | Description |
|------|-----------|-------------|
| Quest completion verification | relicService.js:206 | Relic "quest" acquisition type needs real quest check |
| Item drops from chests | world.js:973 | Chest treasure nodes only award gold, items stubbed |
| Lore content system | world.js:1147 | Discovery nodes return generic lore, need database |
| Quick party formation | SocialHubScene.js:479 | UI placeholder in Party tab |
| Clan chat/management | SocialHubScene.js:518 | UI placeholder in Clan tab |

### 6.2 Version 1.2

| Feature | Description | Priority |
|---------|-------------|----------|
| Player Guilds | Player-created organizations | Medium |
| Cooperative Battles | Team vs bosses (see [BATTLE_MODES.md](BATTLE_MODES.md)) | High |
| PvP Team Battles | 2v2, 3v3, 4v4 modes (see [BATTLE_MODES.md](BATTLE_MODES.md)) | Medium |
| Equipment Crafting | Item creation system | Medium |
| Achievement System | Milestones and rewards | Medium |

### 6.3 Long-term Vision

| Feature | Description |
|---------|-------------|
| New Regions | Expand world map |
| New Races/Classes | More character options |
| Seasonal Events | Limited-time content |
| Battle Replay | Store action log, playback |
| Spectator Mode | Observe live battles |
| Tournament Brackets | Organized PvP events |
| Seasonal Rankings | Competitive seasons |

---

## Active Design Documents

*All design documents have been implemented and moved to `docs/archive/`.*

Recent implementations:
- `2026-01-13-regional-world-generation-design.md` → v8.4
- `2026-01-12-formation-inventory-integration-design.md` → v8.2
- `2026-01-12-icon-quality-redesign.md` → v7.9
- `2026-01-11-marketplace-item-augments-design.md` → v8.1

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Unbalanced combat | High | Iterative testing, player feedback |
| Boring progression | High | Quest system, daily quests |
| Economy inflation | Medium | Gold sinks, monitoring |
| Feature creep | Medium | MVP focus, phased releases |

---

## Document History

| Version | Date | Changes |
|---------|------|---------|
| 9.1 | Jan 2026 | World Generation Quality (v9.7): Global guild same-type spacing (~100 units between same guild types). Battle terrain anti-clustering (prevent 3+ same-type nodes clustering). Zodiac shrine validation (exactly 12 or fail). Removed unused GAP_INFILL_CONFIG. Section 5.1.3 now complete. |
| 9.0 | Jan 2026 | Documentation Audit: Marked enemy ability execution as deferred. Updated Advanced Item System with implementation status. Updated Tavern 2.0 section noting TavernScene exists. Added BATTLE_MODES.md reference for PvP modes. |
| 8.0 | Jan 2026 | Battle Tilemap Rendering v9.7: Elevation-aware coordinate system (Y offset 8px/level), depth sorting with painter's algorithm, elevation-aware click detection. Frontend/backend 3D pathfinding synchronization. Archetype elevation profiles (6 archetypes: openField, caveRooms, mountainPass, bridgeCrossing, arena, volcano). Elevation constraints (variation limits, ramp requirements, peak/pit ratios). Code quality: BattleGrid cleanup, deterministic noise fix, elevation validation. |
| 7.0 | Jan 2026 | World & Progression Polish v9.6: Zodiac Shrine System complete with crystal collection, RelicCollectionModal.js for viewing relic/crystal collection, ZodiacIndicator.js HUD element showing collection progress, NodeHoverTooltip.js enhanced with zodiac crystal status. Quest markers system complete with QuestMarkerManager.js and QuestProgressHUD.js. World & Progression now 98% complete. |
| 6.0 | Jan 2026 | Documentation Consolidation v9.1: Marked Skill Cooldowns COMPLETE (battleService.js:1317-1322, 1777-1781). Marked Status Effect Duration Display COMPLETE (BattleUnit.js). Marked Mini-map Display COMPLETE (WorldMapMinimap.js 700+ lines with click-to-navigate). Added TODO items from code audit to Post-MVP section (quest completion verification, item drops from chests, lore content system, quick party formation, clan chat/management). Combat System 99%, World & Progression 96%. |
| 5.0 | Jan 2026 | Gameplay Features v9.0: Audio System complete (Web Audio API, scene-based music, SFX, volume controls). Battle Log Panel complete (scrollable combat history, color-coded entries). Elemental Damage System complete (8 elements, resistances, enemy/racial templates). Gold Sinks complete (marketplace 5% fee, fast travel 50-500g, stamina restore 100g/point). Relic System complete (rare collectibles, permanent bonuses). Settings Expansion complete (7 categories, ~44 settings, colorblind modes). Core Mechanics now 100%, Combat System 98%, Economy 95%, UX 95%. |
| 4.1 | Jan 2026 | Project cleanup audit: Added battle log panel, elemental damage system to Battle Engine. Added Tier 5+ enemies to Enemy System. Enhanced Mobile Optimization with touch gestures, 44px tap targets. Added loading indicators, keyboard navigation, tooltips, object pooling to UI Polish. Elevated Daily/Weekly Quests priority. Archived all design documents (regional world gen, formation integration, icon quality, marketplace augments). |
| 4.0 | Jan 2026 | Battle System Formula Overhaul (v8.8): Complete FFT-style tactical combat rebalance. Defense now uses diminishing returns formula (DEF/(DEF+100) for physical, MDEF/(MDEF+80) for magical). CT turn order system replaces initiative (ctGain=5+AGI/10, act at CT>=100, haste/slow modifiers). LCK stat now scales with level (0.3-1.5 per level by class) and affects crits (5%+LCK/300), evasion (2%+agiDiff/400+LCK/400), and status resistance (10%+LCK/200). VIT provides HP bonus (level/2+VIT*0.5). Polynomial skill costs (baseCost*level^1.5) make max level achievable. Archetype-based enemy scaling with tier multipliers. New: formulaValidation.test.js (31 tests). Combat System now 95% complete. |
| 3.1 | Jan 2026 | Activity Node Features (v8.6): All 4 activity node systems implemented. Fishing: FishingScene.js with idle auto-fishing, Big One events, session management (fishingService.js), fish templates (15 types, 5 rarities). Ruins: RuinsPuzzleModal.js with 3x3/4x4/5x5 sliding tile puzzles, regional themes, tier-based rewards, one-time completion. Caravan: Extended ShopScene.js with exclusive items (23 items), 48-hour refresh cycle, seeded inventory, stock tracking. Watchtower: Presence-based fog reveal endpoint. Security: FOR UPDATE locks, MAX_GOLD caps, input validation. |
| 3.0 | Jan 2026 | World Generation Improvements (v8.5): New node types (fishing spots, merchant caravans, ruins, watchtowers, farms). Guild distribution enhanced (3 per region, race-appropriate primary guild). Node distribution rebalancing (40-50% battle target). Bridge visual enhancement with river/canyon hints. Zodiac shrine system planned (12 unique shrines with collection quest). Migration 031_expanded_node_types.sql. Flickering bug fixed in WorldMapScene.js. |
| 2.9 | Jan 2026 | Formation System Improvements (v8.3): BattleFormationScene now shows all 12 party characters instead of only 5, with click-to-cycle placement and direction indicator (red border highlight) showing enemy side. FormationScene adds sorting options (Level/Class/Name toggle buttons) and removes empty slot placeholders. Code quality: timer cleanup, canvas save/restore, stable sorting. |
| 2.8 | Jan 2026 | Character Portrait Enhancement v2: 120 portraits enhanced with gender differentiation (face shapes, eye styling, cheekbones), race distinctiveness (vampire fangs, elf circlets, orc hair contrast, dwarf sideburns), and class identity (warrior insignia, monk chi glow, sorcerer dark aura, ninja weapons, berserker rage glow). New utility functions and palettes added. |
| 2.7 | Jan 2026 | Formation & Inventory Integration complete (v8.2): 9 new components (Accordion, CharacterCard, PartyStatsSummary, CharacterPicker, ItemsModal, ItemDetailModal, CharacterModal, EquipmentSlotModal, SkillDetailModal). FormationScene redesigned with modal architecture. InventoryScene/InventoryPanel deleted. User Experience updated to 85%. |
| 2.6 | Jan 2026 | Skill System Overhaul complete (v8.1): Character leveling from spent XP (formula: level^2.8 * 100), skill scaling to level 100, 13 visual effect categories, self-targeting skill handling. New files: characterLevelService.js, skillScaling.js, SkillEffectCategories.js, migration 026. UI: XP progress bar, scaling preview, level-up toasts. |
| 2.5 | Jan 2026 | Unified Social Hub complete: SocialHubScene with 5 tabs (Friends, Party, Requests, LFG, Clan). FriendsTab with search, FriendCard component, RequestsTab unified inbox, PartyTab with Quick Party Formation, LFGTab migrated from CourtyardScene, ClanTab MVP with create/join/chat. Clan system (025_clans.sql, routes, service). Social Features updated to 95%. |
| 2.4 | Jan 2026 | Turn Order Panel redesign: collapsed/expanded states, parchment styling, tap-to-preview with camera pan. Programmatic SVG icon generation system for 16 enemy icons. Target panel priority system. |
| 2.3 | Jan 2026 | ItemDataTable & Marketplace Enhancement complete: Shop/Marketplace ItemDataTable integration, MarketDashboard with parchment price chart, order expiration system (7-day), shop stock refresh cycles, sellable inventory API, augment filter, JSDoc documentation. Economy & Items updated to 90%. |
| 2.2 | Jan 2026 | Roadmap audit v8.0: Added Section 2.4 Battle Balance (defense formula, agility, enemy abilities). Added Section 3.4 Gold Sinks. Added Section 5.3 Social Features (FriendsScene, PartyInviteModal wiring, Tavern 2.0). Corrected completion percentages. Marked max orders as complete. |
| 2.1 | Jan 2026 | UI/UX styling overhaul complete (v7.7). Color scheme corrections, toast consolidation, element colors, progress bar readability. |
| 2.0 | Jan 2026 | Quest system complete (7 API endpoints, GuildAdvancementScene). Node blocking complete (visuals, BFS blocking). Boss integration complete (BossPhaseIndicator, WebSocket events). |
| 1.0 | Jan 2026 | Initial split from DEVELOPMENT_ROADMAP.md. Added quest system, node blocking, settings expansion. |
