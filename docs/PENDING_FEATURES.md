# Modia - Pending Features

## Document Information

| Field | Value |
|-------|-------|
| Project Name | Modia |
| Version | 1.0 |
| Last Updated | January 2026 |
| Purpose | Track unfinished work and planned features |

---

## 1. Code TODOs

Active TODO comments found in codebase:

| File | Line | Description | Priority |
|------|------|-------------|----------|
| ColiseumScene.js | 634 | Transition to BattleScene with PvP battle data | High |
| WorldMapScene.js | 398 | Show party invite modal | Medium |
| BattleScene.js | 2060 | Implement audio system | Low |
| coliseumService.js | 185 | Add skill-based matchmaking using partyLevel | Low |

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

#### PvP Battle Transition
- **Location**: ColiseumScene.js:634, coliseumService.js
- **Status**: Match found notification works, but UI doesn't transition to BattleScene
- **Dependencies**:
  - ColiseumScene needs to call BattleScene.start() with PvP data
  - battle.js needs PvP-specific initialization
- **Estimated Scope**: Medium (frontend-heavy)

#### Party Invite Modal
- **Location**: WorldMapScene.js:398
- **Status**: Party invites can be sent via API, but no accept/decline UI
- **Dependencies**:
  - Modal component for party invites
  - WebSocket handlers for invite notifications
- **Estimated Scope**: Small (UI-only)

### 3.2 Medium Priority (Quality of Life)

#### Leaderboard System
- **Location**: Not implemented
- **Tables Ready**: leaderboard_cache, pvp_ratings
- **Required Work**:
  - [ ] GET /api/leaderboard/:category endpoint
  - [ ] LeaderboardScene UI
  - [ ] Rating calculation on PvP match completion
  - [ ] Periodic cache refresh
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
- **Status**: Not started
- **Missing Features**:
  - [ ] Multi-phase boss system
  - [ ] HP threshold transitions
  - [ ] Phase-specific abilities
- **Estimated Scope**: Large

---

## 4. Feature Dependencies

```
PvP System Completion
├── PvP Battle Transition (HIGH)
│   └── Requires: ColiseumScene → BattleScene integration
├── PvP Rewards System
│   └── Requires: PvP battles working
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

## 7. Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Jan 2026 | - | Initial document from codebase audit |
