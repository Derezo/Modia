# Modia - Gameplay Roadmap

## Document Information

| Field | Value |
|-------|-------|
| Version | 2.0 |
| Last Updated | January 2026 |
| Focus | Features, mechanics, UX, content |

---

## Status Summary

| Category | Completion | Status |
|----------|------------|--------|
| Core Mechanics | 95% | Near Complete |
| Combat System | 95% | Near Complete |
| Economy & Items | 85% | Near Complete |
| User Experience | 70% | In Progress |
| Social Features | 90% | Near Complete |
| World & Progression | 90% | Near Complete |

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

### 1.3 Audio System (Not Started)

- [ ] Web Audio API integration
- [ ] Sound effect loading/playback
- [ ] Battle music
- [ ] UI sounds
- [ ] Volume controls wired to settings

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

- [ ] Elemental damage system (fire/ice/lightning)
- [ ] Skill cooldowns
- [ ] Status effect duration display
- [ ] Battle log panel

### 2.2 Enemy System

- [ ] Ability execution system
- [ ] Ability cooldowns per enemy
- [ ] Ability trigger conditions

### 2.3 Advancement Trial Bosses (Complete)

> **Purpose:** 4 guildmaster bosses for advancement quests

- [x] Guildmaster templates seeded (guildmaster_templates table)
- [x] Solo battle mode (1 player vs guildmaster + disciples)
- [x] Phase-based mechanics (bossService.js)
- [x] Guildmaster scaled to challenger level + 5
- [x] Disciple units from lower tier classes

---

## 3. Economy & Items

### 3.1 Advanced Item System

Per ITEM_SYSTEM.md specifications:

- [ ] 5 intensity tiers (Minor → Supreme)
- [ ] Enemy-type prefixes (Dragonbane, etc.)
- [ ] Defensive augments
- [ ] Support augments
- [ ] Combat augments
- [ ] Set item bonuses
- [ ] Full metal tier progression (12 tiers)

### 3.2 Marketplace Enhancements

- [ ] Display item augments in listings
- [ ] Augment category filter
- [ ] Price suggestion based on augments
- [ ] Max 10 open orders enforcement

### 3.3 Shop System

- [ ] Stock refresh cycles (6-24 hours)
- [ ] Item decay system (10% daily)

---

## 4. User Experience

### 4.1 Settings System Expansion

#### Current (4 categories, ~12 settings)
- [x] Battle: actionMenuStyle
- [x] Audio: volumes, mute
- [x] Display: animations, numbers, grid
- [x] Accessibility: contrast, motion, text size

#### New Categories (7 total, ~55 settings)

**Battle Settings (13):**
- [ ] Camera: followMode, panSpeed, lerpSpeed
- [ ] Previews: movement, attack, terrain costs
- [ ] UX: confirmActions, autoEndTurn, skipEnemyAnimations
- [ ] Display: turnOrder, healthBars, statusIcons, battleLogVerbosity

**Gameplay Settings (12):**
- [ ] Tutorials: showTutorials, showNewFeatureHighlights
- [ ] Auto-save: enabled, interval
- [ ] Confirmations: shop, marketplace
- [ ] Convenience: itemComparison, autoTravel, questMarkers

**Social Settings (14):**
- [ ] Privacy: onlineStatus, partyInvites, DMs
- [ ] Chat: profanityFilter, mentionNotify, timestamps
- [ ] Guild: autoJoinChat, memberActivity

**Controls Settings (17):**
- [ ] Keybinds: camera, grid, inventory, map, save, cancel, confirm
- [ ] Mouse: sensitivity, invertY
- [ ] Touch: enabled, doubleTapConfirm, swipeGestures

**Accessibility (12):**
- [ ] Colorblind modes (protanopia, deuteranopia, tritanopia)
- [ ] Screen reader optimization
- [ ] Dyslexia font option
- [ ] Cursor size options
- [ ] Click-to-hold for motor accessibility
- [ ] Haptic feedback toggle

#### Implementation
- [ ] SettingsManager.js with event-driven updates
- [ ] Wire settings to actual game systems
- [ ] Add Gameplay, Social, Controls tabs

### 4.2 Mobile Optimization

- [ ] Touch-friendly controls
- [ ] Responsive layouts
- [ ] Swipe gestures
- [ ] Double-tap confirmation

### 4.3 UI Polish

- [ ] Loading indicators
- [ ] Tooltips and help text
- [ ] Animation polish
- [ ] Error feedback

---

## 5. World & Progression

### 5.1 World Map

- [ ] Node hover information (detailed tooltips)
- [ ] Mini-map display
- [x] Blocked/cleared node visuals (WorldMapScene.js)
- [ ] Quest markers

### 5.2 Character Progression

- [x] Remove old auto-advancement from skills.js
- [x] Guild hall advancement via quests (advancementQuest.js)
- [x] Quest chain completion required
- [ ] Title system (deferred to v1.1)

---

## 6. Post-MVP Features

### 6.1 Version 1.1

| Feature | Description | Priority |
|---------|-------------|----------|
| Remaining Advanced Guilds | 12 additional beyond MVP 4 | Medium |
| Guild Quest System | Non-advancement quests | Medium |
| Daily/Weekly Quests | Repeatable content | High |
| New Enemies | Additional enemy types | Medium |

### 6.2 Version 1.2

| Feature | Description | Priority |
|---------|-------------|----------|
| Player Guilds | Player-created organizations | Medium |
| Cooperative Battles | Team vs bosses | High |
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

| Document | Purpose | Status |
|----------|---------|--------|
| `docs/plans/2026-01-11-marketplace-item-augments-design.md` | Marketplace augment display | Approved |
| `/home/wizard/.claude/plans/robust-discovering-alpaca.md` | Quest system, node blocking, settings | Approved |

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
| 2.0 | Jan 2026 | Quest system complete (7 API endpoints, GuildAdvancementScene). Node blocking complete (visuals, BFS blocking). Boss integration complete (BossPhaseIndicator, WebSocket events). |
| 1.0 | Jan 2026 | Initial split from DEVELOPMENT_ROADMAP.md. Added quest system, node blocking, settings expansion. |
