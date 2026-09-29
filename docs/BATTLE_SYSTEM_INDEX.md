# Battle System Index

## Document Information

| Field | Value |
|-------|-------|
| Project Name | Modia |
| Version | 1.0 |
| Last Updated | January 2026 |
| Purpose | Unified navigation for battle system documentation |

---

## 1. Overview

The Modia battle system is a CT-based tactical combat system played on an 8x8 grid. This index provides unified navigation across all battle-related documentation and code components.

### 1.1 System Architecture Diagram

```
+-----------------------------------------------------------------------------+
|                           Battle System Overview                              |
+-----------------------------------------------------------------------------+
|                                                                               |
|  FRONTEND (Canvas 2D)                                                        |
|  +---------------------+     +---------------------+     +-----------------+ |
|  | BattleScene.js      |---->| BattleGrid.js       |     | BattleUI.js     | |
|  | (Orchestration)     |     | (Grid Rendering)    |     | (HUD/Menus)     | |
|  +---------------------+     +---------------------+     +-----------------+ |
|           |                          |                          |            |
|           v                          v                          v            |
|  +---------------------+     +---------------------+     +-----------------+ |
|  | BattleWebSocket     |     | BattleUnit.js       |     | BattleAnimations| |
|  | Manager.js          |     | (Unit Rendering)    |     | (Visual FX)     | |
|  +---------------------+     +---------------------+     +-----------------+ |
|           |                                                                   |
|           | WebSocket (battle:{battleId})                                    |
|           v                                                                   |
+-----------------------------------------------------------------------------+
|                                                                               |
|  BACKEND (Node.js/Express)                                                   |
|  +---------------------+     +---------------------+     +-----------------+ |
|  | battleWebsocket.js  |<--->| battleTurnManager.js|---->| battleService.js| |
|  | (WS Events)         |     | (Turn Processing)   |     | (Core Logic)    | |
|  +---------------------+     +---------------------+     +-----------------+ |
|           |                          |                          |            |
|           v                          v                          v            |
|  +---------------------+     +---------------------+     +-----------------+ |
|  | battleReconnection  |     | battle/             |     | aiService.js    | |
|  | .js                 |     | turnOrderService.js |     | + ai/ module    | |
|  +---------------------+     +---------------------+     +-----------------+ |
|                                       |                                       |
|                                       v                                       |
|                              +---------------------+                          |
|                              | PostgreSQL          |                          |
|                              | (Battle State)      |                          |
|                              +---------------------+                          |
|                                                                               |
+-----------------------------------------------------------------------------+
```

### 1.2 Data Flow

```
Player Action Flow:
  [Client] POST /api/battle/action --> [Server] Validate + Process --> [DB] Persist
       ^                                     |
       |                                     v
       +--- WebSocket: battle:action_result --+--- Broadcast to room

Turn Transition Flow:
  [Server] CT reaches 100 --> Determine next unit --> battle:turn_start broadcast
                                     |
                                     +--> If player: battle:your_turn (private)
                                     +--> If enemy: aiService.decideTurnActions()
```

---

## 2. Quick Reference Tables

### 2.1 Timing Constants

| Constant | Value | Context | Source |
|----------|-------|---------|--------|
| **Turn Timeouts** | | | |
| Player Turn Timeout | 60,000ms | PvE time limit | BATTLE_RECONNECTION.md |
| PvP Turn Timeout | 45,000ms | Competitive play | BATTLE_MESSAGING_PROTOCOL.md |
| AI Decision Time | < 500ms | Enemy turn processing | AI_SYSTEM.md |
| **Animations** | | | |
| Movement (per tile) | 150ms | Unit movement | BATTLE_ANIMATIONS.md |
| Basic Attack | 300ms | Attack animation | BATTLE_ANIMATIONS.md |
| Skill Animation | 500-1000ms | Varies by skill | BATTLE_ANIMATIONS.md |
| Damage Number | 800ms | Float up and fade | BATTLE_ANIMATIONS.md |
| Death Animation | 500ms | Fade out | BATTLE_ANIMATIONS.md |
| Status Effect | 300ms | Icon pulse | BATTLE_ANIMATIONS.md |
| **Intent Preview** | | | |
| Movement Range Preview | 500ms | Blue tiles display | BATTLE_ANIMATIONS.md |
| Attack Range Preview | 500ms | Red tiles display | BATTLE_ANIMATIONS.md |
| Path Preview | 300ms | Yellow arrows | BATTLE_ANIMATIONS.md |
| **Reconnection** | | | |
| Grace Period | 30,000ms | Reconnection window | BATTLE_RECONNECTION.md |
| Ping Timeout | 30,000ms | No pong response | BATTLE_RECONNECTION.md |
| Consecutive Timeout Forfeit | 3 | Auto-forfeit trigger | BATTLE_RECONNECTION.md |
| Message Buffer Timeout | 10,000ms | Buffered message limit | BATTLE_MESSAGING_PROTOCOL.md |

### 2.2 WebSocket Message Types

| Message Type | Direction | Purpose |
|--------------|-----------|---------|
| **Server to Client (Broadcasts)** | | |
| `battle:turn_start` | S -> C | Announce unit turn beginning |
| `battle:intent_highlight` | S -> C | Show enemy movement/attack preview |
| `battle:action_result` | S -> C | Result of action for animation |
| `battle:turn_end` | S -> C | Turn complete, announce next unit |
| `battle:your_turn` | S -> C (private) | Sent only to controlling player |
| `battle:player_disconnected` | S -> C | Player dropped from battle |
| `battle:player_reconnected` | S -> C | Player returned to battle |
| `battle:state_sync` | S -> C | Full state synchronization |
| `battle:end` | S -> C | Battle complete with rewards |
| **Client to Server** | | |
| `battle:player_action` | C -> S | Action submission (alt to HTTP) |
| `battle:ping` | C -> S | Keep-alive and latency |
| `battle:request_sync` | C -> S | Request state synchronization |

### 2.3 Key Formulas

| Formula | Expression | Source |
|---------|------------|--------|
| **CT System** | | |
| CT Accumulation | `CT_gain_per_tick = 5 + (AGI / 10)` | BATTLE_TURN_SYSTEM.md |
| Turn Threshold | CT reaches 100 | BATTLE_TURN_SYSTEM.md |
| **Damage** | | |
| Physical Base | `base = ATK * (skill_power / 100)` | GAME_DESIGN.md |
| Defense Reduction | `reduction = DEF / (DEF + 100)` | GAME_DESIGN.md |
| Final Damage | `floor(max(1, reduced_damage * crit_multiplier))` | GAME_DESIGN.md |
| Magic Defense Reduction | `MDEF / (MDEF + 80)`, MDEF = INT/2 + magicDefense | `shared/battleMath.js` |
| **Hit / Status** | | |
| Hit Chance (attacks and skills) | `clamp(95% - evasion - blind 30% + acc, 50%, 98%) * skill.accuracy` | BATTLE_TURN_SYSTEM.md 4.6 |
| Status Resistance | `min(50%, 10% + LCK/200)`, enemy-applied effects only | STATUS_EFFECTS.md 7 |
| Buff/Debuff Multipliers | `STATUS_EFFECT_REGISTRY` | STATUS_EFFECTS.md 2.7 |
| **Level/XP** | | |
| XP for Level N | `100 * N^2.8` | CHARACTER_PROGRESSION.md |
| Skill Cost | `baseCost * (level + 1)^1.5` | SKILL_TREES.md |

---

## 3. Document Navigation

### 3.1 Core Battle Documents

| Document | Description | Key Topics |
|----------|-------------|------------|
| [BATTLE_TURN_SYSTEM.md](BATTLE_TURN_SYSTEM.md) | CT-based turn order mechanics | Charge time accumulation, turn prediction, action system |
| [BATTLE_MESSAGING_PROTOCOL.md](BATTLE_MESSAGING_PROTOCOL.md) | Client-server communication | HTTP actions, WebSocket broadcasts, message formats |
| [BATTLE_ANIMATIONS.md](BATTLE_ANIMATIONS.md) | Visual feedback system | Intent visualization, damage numbers, status effects |
| [BATTLE_MODES.md](BATTLE_MODES.md) | Combat mode configurations | PVE_SOLO, PVE_COOP, PVP_DUEL, PVP_TEAM |
| [BATTLE_RECONNECTION.md](BATTLE_RECONNECTION.md) | State persistence and recovery | Disconnect handling, grace periods, state sync |
| [AI_SYSTEM.md](AI_SYSTEM.md) | Enemy AI behavior | Utility scoring, lookahead, pattern weights |
| [STATUS_EFFECTS.md](STATUS_EFFECTS.md) | Status effect taxonomy | DoT/HoT, CC, cleansing tiers, resistance, zodiac effects |

### 3.2 Document Relationships

```
                    +------------------------+
                    | BATTLE_TURN_SYSTEM.md  |
                    | (Turn Order Core)      |
                    +------------------------+
                              |
              +---------------+---------------+
              |                               |
              v                               v
+------------------------+     +------------------------+
| BATTLE_MESSAGING_      |     | AI_SYSTEM.md           |
| PROTOCOL.md            |     | (Enemy Decisions)      |
| (Communication)        |     +------------------------+
+------------------------+
              |
              v
+------------------------+     +------------------------+
| BATTLE_ANIMATIONS.md   |     | BATTLE_RECONNECTION.md |
| (Visual Feedback)      |     | (State Recovery)       |
+------------------------+     +------------------------+
              |
              v
+------------------------+
| BATTLE_MODES.md        |
| (Mode Configuration)   |
+------------------------+
```

---

## 4. Component Cross-Reference

### 4.1 Frontend Components

| File | Location | Purpose | Related Doc |
|------|----------|---------|-------------|
| `BattleScene.js` | `frontend/src/scenes/` | Main orchestrator, scene lifecycle | All battle docs |
| `BattleFormationScene.js` | `frontend/src/scenes/` | Pre-battle party positioning | BATTLE_MODES.md |
| `BattleGrid.js` | `frontend/src/battle/` | Grid rendering, tile highlights | BATTLE_ANIMATIONS.md |
| `BattleUnit.js` | `frontend/src/battle/` | Unit sprites, animations | BATTLE_ANIMATIONS.md |
| `BattleUI.js` | `frontend/src/battle/` | HUD, action menus, status bars | BATTLE_TURN_SYSTEM.md |
| `BattleAnimations.js` | `frontend/src/battle/` | Visual effects, damage numbers | BATTLE_ANIMATIONS.md |
| `BattleWebSocketManager.js` | `frontend/src/battle/` | WebSocket event handling | BATTLE_MESSAGING_PROTOCOL.md |
| `BattleCamera.js` | `frontend/src/battle/` | View control, panning, zoom | BATTLE_ANIMATIONS.md |
| `BattlePathfinding.js` | `frontend/src/battle/` | Client-side path preview | BATTLE_TURN_SYSTEM.md |
| `BattleActionBar.js` | `frontend/src/battle/` | Action button bar | BATTLE_TURN_SYSTEM.md |
| `BattleIntro.js` | `frontend/src/battle/` | Battle start sequence | BATTLE_ANIMATIONS.md |
| `BattleOutroSequence.js` | `frontend/src/battle/` | Victory/defeat sequence | BATTLE_MODES.md |
| `BattleLogPanel.js` | `frontend/src/battle/` | Combat log display | BATTLE_MESSAGING_PROTOCOL.md |
| `TurnOrderPanel.js` | `frontend/src/battle/` | Turn order display | BATTLE_TURN_SYSTEM.md |
| `BattleContextMenu.js` | `frontend/src/battle/` | Right-click context menu | BATTLE_TURN_SYSTEM.md |
| `RadialMenu.js` | `frontend/src/battle/` | Radial action selection | BATTLE_TURN_SYSTEM.md |
| `GridCursor.js` | `frontend/src/battle/` | Tile selection cursor | BATTLE_ANIMATIONS.md |
| `TerrainTooltip.js` | `frontend/src/battle/` | Terrain info display | BATTLE_MODES.md |
| `BattleFireworks.js` | `frontend/src/battle/` | Victory celebration effects | BATTLE_ANIMATIONS.md |
| `BossPhaseIndicator.js` | `frontend/src/battle/` | Boss phase transitions | BATTLE_MODES.md |
| `SkillEffectCategories.js` | `frontend/src/battle/` | Skill visual categories | BATTLE_ANIMATIONS.md |
| `BattleStatsTable.js` | `frontend/src/battle/` | Post-battle statistics display | BATTLE_MODES.md |
| `BattleStatsAggregator.js` | `frontend/src/battle/` | Unit battle statistics aggregation | BATTLE_MODES.md |

### 4.2 Backend Services

| File | Location | Purpose | Related Doc |
|------|----------|---------|-------------|
| **Core Services** | | | |
| `battleService.js` | `api/src/services/` | Core battle logic, state management | BATTLE_TURN_SYSTEM.md |
| `battleTurnManager.js` | `api/src/services/` | Async turn processing | BATTLE_TURN_SYSTEM.md |
| `battleWebsocket.js` | `api/src/services/` | WebSocket event broadcasting | BATTLE_MESSAGING_PROTOCOL.md |
| `battleReconnection.js` | `api/src/services/` | Disconnect handling, state persistence | BATTLE_RECONNECTION.md |
| `battleUnitFactory.js` | `api/src/services/` | Unified unit creation | AI_SYSTEM.md |
| `aiService.js` | `api/src/services/` | AI entry point | AI_SYSTEM.md |
| **Battle Module** | `api/src/services/battle/` | | |
| `turnOrderService.js` | `battle/` | CT calculations, turn prediction | BATTLE_TURN_SYSTEM.md |
| `damageCalculator.js` | `battle/` | Damage formula implementation | GAME_DESIGN.md |
| `chargeSystem.js` | `battle/` | CT accumulation logic | BATTLE_TURN_SYSTEM.md |
| `statusEffectManager.js` | `battle/` | Buff/debuff processing | BATTLE_TURN_SYSTEM.md |
| `actionProcessor.js` | `battle/` | Action execution | BATTLE_MESSAGING_PROTOCOL.md |
| `movementService.js` | `battle/` | Movement validation | BATTLE_TURN_SYSTEM.md |
| `aoeService.js` | `battle/` | Area of effect calculations | SKILL_TREES.md |
| `skillDefinitionService.js` | `battle/` | Skill data resolution | SKILL_TREES.md |
| `index.js` | `battle/` | Module exports | - |
| **AI Module** | `api/src/services/ai/` | | |
| `utilityAI.js` | `ai/` | Main coordinator class | AI_SYSTEM.md |
| `utilityFactors.js` | `ai/` | Factor calculation functions | AI_SYSTEM.md |
| `patternWeights.js` | `ai/` | Weight configurations | AI_SYSTEM.md |
| `stateEvaluator.js` | `ai/` | Board state evaluation | AI_SYSTEM.md |
| `actionGenerator.js` | `ai/` | Enumerate legal actions | AI_SYSTEM.md |
| `lookahead.js` | `ai/` | Multi-actor minimax | AI_SYSTEM.md |
| `strategicPathfinding.js` | `ai/` | Tactical path calculation | AI_SYSTEM.md |
| `cache.js` | `ai/` | Transposition table | AI_SYSTEM.md |
| `index.js` | `ai/` | Module exports | - |

### 4.3 Shared Modules

| File | Location | Purpose |
|------|----------|---------|
| `battleMath.js` | `shared/` | Damage formulas for combat previews |
| `pathfinding.js` | `shared/` | Dijkstra and A* algorithms |
| `constants.js` | `shared/` | Stats, races, classes |
| `mapgen/` | `shared/` | Battle map generation (archetypes, algorithms) |

---

## 5. Related Documents

### 5.1 Game Systems

| Document | Relevance to Battle |
|----------|---------------------|
| [GAME_DESIGN.md](GAME_DESIGN.md) | Combat formulas, status effects, action system |
| [SKILL_TREES.md](SKILL_TREES.md) | Skill definitions for 8 guilds |
| [CHARACTER_PROGRESSION.md](CHARACTER_PROGRESSION.md) | Stats, leveling, skill costs |
| [ENEMY_SYSTEM.md](ENEMY_SYSTEM.md) | Enemy templates, AI archetypes, scaling |
| [ITEM_SYSTEM.md](ITEM_SYSTEM.md) | Equipment effects on combat |

### 5.2 Technical References

| Document | Relevance to Battle |
|----------|---------------------|
| [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md) | Database schemas, system design |
| [API_SPECIFICATION.md](API_SPECIFICATION.md) | Battle REST endpoints |
| [FRONTEND_TECHNICAL_PATTERNS.md](FRONTEND_TECHNICAL_PATTERNS.md) | Canvas rendering, deltaTime |
| [ISOMETRIC_TILE_SYSTEM.md](ISOMETRIC_TILE_SYSTEM.md) | Battle terrain geometry, compiler, renderer contract, and validation |
| [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) | Parchment UI components |

---

## 6. Implementation Status

| Component | Status | Notes |
|-----------|--------|-------|
| PVE_SOLO Mode | Implemented | Full functionality |
| CT Turn System | Implemented | Server-authoritative |
| Utility AI | Implemented | 2-3 turn lookahead |
| WebSocket Sync | Implemented | Hybrid HTTP/WS protocol |
| Battle Reconnection | Implemented | 30s grace period |
| PVE_COOP Mode | Post-MVP | Requires party enhancements |
| PVP_DUEL | Partial | Coliseum queue exists |
| PVP_TEAM | Post-MVP | Requires team matchmaking |

---

## 7. Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | January 2026 | Initial index document |
| 1.1 | February 2026 | Added BattleStatsTable.js and BattleStatsAggregator.js to frontend components |
| 1.2 | September 2026 | Added magic defense, hit chance, status resistance and status registry to Key Formulas |
