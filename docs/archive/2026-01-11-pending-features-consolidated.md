# Modia - Pending Features

> **ARCHIVED:** January 2026 - Roadmap Audit v8.0
>
> This document has been superseded by updates to the main roadmaps:
> - `docs/ROADMAP_GAMEPLAY.md` - Section 5.3 Social Features
> - `docs/ROADMAP_TECHNICAL.md` - Section 6.1 Technical Debt
>
> Many items in this document have been completed or are now tracked in roadmaps.
> See status updates inline below.

## Document Information

| Field | Value |
|-------|-------|
| Project Name | Modia |
| Version | 4.0 |
| Last Updated | January 2026 |
| Purpose | Historical record of pending features (see archive note)

---

## 1. Code TODOs

Active TODO comments found in codebase:

| File | Line | Description | Priority | Status |
|------|------|-------------|----------|--------|
| ~~ColiseumScene.js~~ | ~~634~~ | ~~Transition to BattleScene with PvP battle data~~ | ~~High~~ | FIXED (Jan 2026) |
| WorldMapScene.js | 398 | Show party invite modal | Medium | Pending |
| BattleScene.js | 2060 | Implement audio system | Low | Pending |
| coliseumService.js | 185 | Add skill-based matchmaking using partyLevel | Low | Pending |

---

## 2. Unused Database Tables

Tables created but not fully integrated:

| Table | Migration | Status | Blocking Issue |
|-------|-----------|--------|----------------|
| coliseum_matches | 009_multiplayer_support.sql | Partial | `startMatch()` creates records but battle transition incomplete |
| leaderboard_cache | 009_multiplayer_support.sql | Unused | No API endpoints implemented |
| pvp_ratings | 009_multiplayer_support.sql | Unused | Never populated with player ratings |
| party_members | 009_multiplayer_support.sql | Partial | Party system uses direct character queries |

---

## 3. Planned But Unimplemented Features

### 3.1 High Priority (Blocking Gameplay)

#### ~~PvP Battle Transition~~ - COMPLETED
- **Location**: ColiseumScene.js:631-668
- **Status**: FIXED (January 2026)
- **Resolution**:
  - ColiseumScene now fetches battle state via `/battle/:id/rejoin` endpoint
  - Transitions to BattleScene with full battle data
  - Also fixed `/battle/current` endpoint to handle player2 in PvP matches

#### Party Invite Modal
- **Location**: WorldMapScene.js:811
- **Status**: ~~Party invites can be sent via API, but no accept/decline UI~~ **PARTIAL - Component exists but not wired**
- **Update (v8.0 audit)**: PartyInviteModal.js component exists but is NOT wired up in WorldMapScene. Tracked in ROADMAP_GAMEPLAY.md Section 5.3.
- **Dependencies**:
  - [x] Modal component for party invites (PartyInviteModal.js)
  - [x] WebSocket handlers for invite notifications
  - [ ] Wire up modal in WorldMapScene party:invite_received handler
- **Estimated Scope**: Small (wiring only)

### 3.2 Medium Priority (Quality of Life)

#### Leaderboard System
- **Location**: ~~Not implemented~~ **COMPLETE (v7.0)**
- **Tables Ready**: leaderboard_cache, pvp_ratings
- **Required Work**:
  - [x] GET /api/leaderboard/:category endpoint
  - [x] LeaderboardScene UI (LeaderboardScene.js)
  - [x] Rating calculation on PvP match completion (PPR-based)
  - [ ] Periodic cache refresh (deferred)
- **Estimated Scope**: Medium

#### Skill-Based Matchmaking
- **Location**: coliseumService.js:185
- **Status**: Current matchmaking is FIFO queue
- **Required Work**:
  - [ ] Calculate party strength rating
  - [ ] Match players within rating range
  - [ ] Expand range over time if no match
- **Estimated Scope**: Small

### 3.3 Low Priority (Polish)

#### Audio System
- **Location**: BattleScene.js:2060
- **Status**: Not started
- **Required Work**:
  - [ ] Web Audio API integration
  - [ ] Sound effect loading/playback
  - [ ] Background music system
  - [ ] Volume controls
- **Estimated Scope**: Large

#### Advanced Item System
- **Location**: itemDropService.js, ITEM_SYSTEM.md
- **Status**: Basic item generation works, advanced features not implemented
- **Missing Features**:
  - [ ] 5 intensity tiers (Minor → Supreme)
  - [ ] Enemy-type prefixes (Dragonbane, etc.)
  - [ ] Defensive augments
  - [ ] Set bonuses
  - [ ] Full material tier progression (12 tiers)
- **Estimated Scope**: Large

#### Enemy Abilities
- **Location**: ENEMY_SYSTEM.md, enemyService.js
- **Status**: Enemies have abilities field but it's unused
- **Missing Features**:
  - [ ] Ability execution system
  - [ ] Ability cooldowns
  - [ ] Ability trigger conditions
- **Estimated Scope**: Medium

#### Boss Mechanics
- **Location**: ENEMY_SYSTEM.md
- **Status**: ~~Not started~~ **COMPLETE (v7.4)**
- **Missing Features**:
  - [x] Multi-phase boss system (bossService.js)
  - [x] HP threshold transitions (phase detection)
  - [x] Phase-specific abilities (WebSocket events)
- **Estimated Scope**: Large

---

## 4. Feature Dependencies

```
PvP System Completion
├── ✅ PvP Battle Transition (COMPLETED)
│   └── ColiseumScene → BattleScene integration working
├── PvP Rewards System
│   └── Requires: PvP battles working (now unblocked)
├── Leaderboard System (MEDIUM)
│   └── Requires: pvp_ratings populated
└── Skill-Based Matchmaking (LOW)
    └── Requires: Party strength calculation

Party System Completion
├── Party Invite Modal (HIGH)
│   └── Requires: Modal UI component
└── party_members Table Integration
    └── Requires: Refactor party.js routes

Polish Features
├── Audio System (LOW)
│   └── Standalone
├── Advanced Items (LOW)
│   └── Standalone
└── Boss Mechanics (LOW)
    └── Requires: Enemy abilities system first
```

---

## 5. Quick Wins

Features that can be completed quickly:

| Feature | Scope | Files | Notes |
|---------|-------|-------|-------|
| Party invite modal | ~2 hours | WorldMapScene.js | Modal component exists, wire up |
| Fix coliseum_matches population | ~1 hour | coliseumService.js | Data flows exist, verify wiring |
| Battle log UI | ~3 hours | BattleUI.js | Text log of actions during battle |

---

## 6. Verification Commands

Check current TODO count:
```bash
grep -r "TODO" api/src frontend/public/src --include="*.js" | grep -v node_modules
```

Check unused tables:
```bash
# Connect to database and check row counts
psql -U modia -d modia -c "SELECT 'coliseum_matches' as table_name, COUNT(*) FROM coliseum_matches UNION ALL SELECT 'leaderboard_cache', COUNT(*) FROM leaderboard_cache UNION ALL SELECT 'pvp_ratings', COUNT(*) FROM pvp_ratings;"
```

---

## 7. Code Review Discoveries (v3.0)

Issues discovered during comprehensive multi-agent code review in January 2026.

### 7.1 Critical Issues (Security/Stability)

| Issue | Location | Impact | Priority |
|-------|----------|--------|----------|
| ~~Rate limiting missing on marketplace batch~~ | ~~marketplace.js~~ | ~~DoS vulnerability~~ | ✅ FIXED (marketplaceRateLimiter.js) |
| Rate limiting missing on battle actions | battle.js | Action spam | **Critical** |
| Rate limiting missing on WebSocket messages | websocket/index.js | Message flood | **Critical** |
| Event listener leak in Game.js | Game.js:resize | Memory leak | **Critical** |
| Event listener leak in InputHandler.js | InputHandler.js | Memory leak | **Critical** |

### 7.2 High Priority Issues

| Issue | Location | Impact |
|-------|----------|--------|
| Inline listeners without cleanup | LoginScene.js | Memory leak potential |
| Inline listeners without cleanup | WorldMapScene.js | Memory leak potential |
| Asset loading race conditions | AssetLoader.js | Rendering issues |
| asyncHandler missing | sprites.js | Unhandled promise rejections |
| Input validation gaps | Multiple routes | Security risk |
| Transaction isolation issues | shop.js | Race conditions (marketplace fixed with audit logging) |

### 7.3 Documentation Discrepancies

| Document | Issue | Code Reality |
|----------|-------|--------------|
| GAME_DESIGN.md | Race traits completely wrong | Human: +2 VIT/+1 INT not +1 STR/+1 INT |
| GAME_DESIGN.md | Critical chance cap 50% | Actually 30% in constants.js |
| GAME_DESIGN.md | XP formula exponent 2.2 | Actually 1.8 in constants.js |
| GAME_DESIGN.md | Level cap 100 | Actually 256 in constants.js |
| API_SPECIFICATION.md | Missing guild endpoints | /api/guild/* undocumented |
| ITEM_SYSTEM.md | Equipment slots differ | Code has different slot names |

### 7.4 Test Coverage Improvements Made

New test files created with 225+ tests:

| File | Tests | Coverage |
|------|-------|----------|
| chatService.test.js | 21 | Chat persistence, DMs, reactions |
| presenceService.test.js | 27 | Typing, presence, node tracking |
| coliseumService.test.js | 28 | Queue, matchmaking, cleanup |
| partyWebsocket.test.js | 31 | Invites, broadcasts, rooms |
| websocketIndex.test.js | 44 | Core WS module, utilities |
| battleMechanics.test.js | 75+ | CT system, AI, damage formulas |

---

## 8. Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 4.0 | Jan 2026 | - | **ARCHIVED:** Roadmap audit v8.0. Added archive notice. Updated status for Boss Mechanics (COMPLETE v7.4), Leaderboard System (COMPLETE v7.0), Party Invite Modal (PARTIAL - component exists). Consolidated into main roadmaps. |
| 3.0 | Jan 2026 | - | Added code review discoveries: 5 critical issues, 6 high priority issues, 6 documentation discrepancies. Documented 225+ new tests across 6 test files. |
| 2.0 | Jan 2026 | - | Marked PvP Battle Transition as COMPLETED; updated feature dependencies |
| 1.0 | Jan 2026 | - | Initial document from codebase audit |
