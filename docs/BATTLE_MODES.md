# Modia - Battle Mode Configuration

## Document Information

| Field | Value |
|-------|-------|
| Project Name | Modia |
| Version | 1.2 |
| Last Updated | September 2026 |
| System Type | Battle Mode Definitions and Configuration |

---

## Implementation Status

> **Important:** This document contains specifications for all planned battle modes. Many modes are not yet implemented.

| Mode | Status | Notes |
|------|--------|-------|
| **PVE_SOLO** | **Implemented** | Full functionality in MVP |
| **PVE_COOP** | Post-MVP | Requires party system enhancements |
| **PVP_DUEL** | Partial | Coliseum queue exists, needs refinement |
| **PVP_TEAM** | Post-MVP | Requires team matchmaking system |
| **PVP_FFA** | Post-MVP | Complex spawn and elimination logic |

*Specifications for unimplemented modes are retained for future development reference.*

---

## 1. Overview

### 1.1 Purpose

Battle modes define the configuration for different types of combat encounters in Modia. Each mode specifies player count, enemy configuration, team structure, timing rules, and reward distribution. All modes share the same core combat system (CT-based turns on an 8x8 grid) but differ in matchmaking, team assignment, and win conditions.

### 1.2 Mode Categories

```
+---------------------------+---------------------------+
|        PvE Modes          |        PvP Modes          |
+---------------------------+---------------------------+
| - PVE_SOLO (MVP)          | - PVP_DUEL                |
| - PVE_COOP (Future)       | - PVP_TEAM                |
|                           | - PVP_FFA                 |
+---------------------------+---------------------------+
```

### 1.3 Shared Combat Foundation

All battle modes use:

| Component | Specification |
|-----------|---------------|
| Grid Size | 8x8 tactical grid |
| Turn System | CT-based (see [BATTLE_TURN_SYSTEM.md](BATTLE_TURN_SYSTEM.md)) |
| Action System | 1 Move + 1 Act per turn |
| Damage Formulas | Physical/Magical (see [GAME_DESIGN.md](GAME_DESIGN.md)) |
| Status Effects | Standard effect library |
| Terrain Types | Passable/Impassable with movement costs |

---

## 2. PvE Modes

### 2.1 PVE_SOLO (Current MVP)

Single player battles against AI-controlled enemies at world nodes.

#### Configuration

```javascript
{
  mode: 'PVE_SOLO',
  players: 1,
  playerUnits: [1, 5],      // 1-5 characters from formation
  enemies: 'dynamic',        // Generated based on node
  teams: false,              // No team mechanics
  turnTimeout: 0,            // No timeout for solo
  reconnect: false           // No need for solo
}
```

#### Mode Details

| Parameter | Value | Description |
|-----------|-------|-------------|
| Player Count | 1 | Single player only |
| Player Units | 1-5 | Characters from battle party |
| Enemy Count | 1-6 | Based on node difficulty tier |
| Enemy Types | Variable | Based on node terrain type |
| Turn Timeout | None | Player can take unlimited time |
| Reconnection | N/A | Session persists locally |

#### Enemy Generation Rules

```
+-------------------+------------+-------------+------------------+
| Node Type         | Difficulty | Enemy Count | Level Scaling    |
+-------------------+------------+-------------+------------------+
| Forest (Tier 1)   | Easy       | 1-3         | party_avg * 0.9  |
| Cave (Tier 2)     | Medium     | 2-4         | party_avg * 1.0  |
| Mountain (Tier 3) | Hard       | 3-5         | party_avg * 1.2  |
| Bridge (Tier 4)   | Boss       | 2-4 + Boss  | party_avg * 1.5  |
+-------------------+------------+-------------+------------------+
```

#### Win/Lose Conditions

| Result | Condition | Outcome |
|--------|-----------|---------|
| Victory | All enemies defeated | Rewards granted, return to node |
| Defeat | All player units defeated | No rewards, return to last safe node |

---

### 2.2 PVE_COOP (Post-MVP - Not Implemented)

> **Status:** This mode is planned for post-MVP development.

Cooperative multiplayer battles where multiple players fight AI enemies together.

#### Configuration

```javascript
{
  mode: 'PVE_COOP',
  players: [2, 4],          // 2-4 players
  playerUnits: [1, 3],      // 1-3 characters per player
  enemies: 'dynamic',        // Scaled for party size
  teams: 'all_players_one_team',
  turnTimeout: 60000,        // 60 second turn timer
  reconnect: true            // Allow reconnection
}
```

#### Mode Details

| Parameter | Value | Description |
|-----------|-------|-------------|
| Player Count | 2-4 | Multiple cooperating players |
| Units Per Player | 1-3 | Reduced per-player to balance total |
| Max Total Units | 6 | Combined player units capped |
| Enemy Scaling | +50% per additional player | Enemies scale with party size |
| Turn Timeout | 60 seconds | Keeps pace for all players |

#### Turn Order Integration

```
+-----------------------------------------------------------------------+
|                      Co-op Turn Order                                  |
+-----------------------------------------------------------------------+
|                                                                        |
|   All units (from all players) use standard CT accumulation            |
|                                                                        |
|   Turn order example (3 players):                                      |
|   +--------+----------------+----------------+----------------+        |
|   | CT 100 | Player 1 Monk  |                |                |        |
|   | CT 95  |                | Enemy Goblin   |                |        |
|   | CT 88  |                |                | Player 3 Wizard|        |
|   | CT 75  | Player 1 Tank  |                |                |        |
|   | CT 70  |                | Player 2 Healer|                |        |
|   +--------+----------------+----------------+----------------+        |
|                                                                        |
|   Each player controls only their own units when it's their turn       |
|                                                                        |
+-----------------------------------------------------------------------+
```

#### Coordination Features

| Feature | Description |
|---------|-------------|
| Shared Visibility | All players see full battlefield |
| Target Indicators | Show teammate targeting intentions |
| Ready Check | Host can start when all ready |
| Vote Surrender | Requires majority to surrender |

#### Win/Lose Conditions

| Result | Condition | Outcome |
|--------|-----------|---------|
| Victory | All enemies defeated | Rewards split among players |
| Defeat | All player units (all players) defeated | No rewards for anyone |

---

## 3. PvP Modes

### 3.1 PVP_DUEL (Partial Implementation)

> **Status:** Coliseum queue UI exists. Full battle flow needs refinement.

One-on-one competitive battle between two players.

#### Configuration

```javascript
{
  mode: 'PVP_DUEL',
  players: 2,
  playerUnits: [1, 5],      // Each player brings 1-5 characters
  enemies: 0,                // No AI enemies
  teams: false,              // No team mechanics
  turnTimeout: 60000,        // 60 second turn timer
  reconnect: true            // Allow reconnection with grace period
}
```

#### Mode Details

| Parameter | Value | Description |
|-----------|-------|-------------|
| Player Count | 2 | Exactly two players |
| Units Per Player | 1-5 | Full battle party each |
| Total Units | 2-10 | Both players combined |
| Turn Timeout | 60 seconds | Per-turn time limit |
| Reconnect Grace | 30 seconds | Time before auto-forfeit |

#### Matchmaking Criteria

```
+-----------------------------------------------------------------------+
|                     Duel Matchmaking                                   |
+-----------------------------------------------------------------------+
|                                                                        |
|   Primary: Average Party Level                                         |
|   +-----------------------------------------------------------------+ |
|   | Player A avg level 25  <-->  Player B avg level 22              | |
|   | Acceptable range: +/- 10 levels                                 | |
|   +-----------------------------------------------------------------+ |
|                                                                        |
|   Secondary: Queue Time Expansion                                      |
|   +-----------------------------------------------------------------+ |
|   | 0-30s:   +/- 5 levels                                           | |
|   | 30-60s:  +/- 10 levels                                          | |
|   | 60-90s:  +/- 15 levels                                          | |
|   | 90-120s: +/- 20 levels                                          | |
|   | 120s+:   Any available opponent                                 | |
|   +-----------------------------------------------------------------+ |
|                                                                        |
+-----------------------------------------------------------------------+
```

#### PvP-Specific Rules

| Rule | Specification |
|------|---------------|
| Item Usage | Disabled (competitive balance) |
| First Turn | Random determination |
| Surrender | Available after turn 3 |
| AFK Detection | Auto-wait after 2 consecutive timeouts |

#### Win/Lose Conditions

| Result | Condition | Outcome |
|--------|-----------|---------|
| Victory | All opponent units defeated | Full rewards |
| Defeat | All your units defeated | Participation rewards |
| Forfeit | Surrender or disconnect timeout | No rewards |
| Mutual knockout | Both sides wiped out by the same action | No draw. The side whose action caused it loses and the opponent wins (see [BATTLE_TURN_SYSTEM.md 4.8](BATTLE_TURN_SYSTEM.md#48-battle-end-and-mutual-knockout)). This applies only when the caller passes the acting team; otherwise team 2 wins. |

---

### 3.2 PVP_TEAM (Post-MVP - Not Implemented)

> **Status:** This mode is planned for post-MVP development.

Team-based competitive battles (2v2, 3v3, or 4v4).

#### Configuration

```javascript
{
  mode: 'PVP_TEAM',
  players: [4, 8],          // 4, 6, or 8 players total
  playerUnits: [1, 2],      // Limited per player for balance
  enemies: 0,
  teams: 'balanced',         // Automatic team balancing
  teamSize: [2, 4],         // 2v2, 3v3, or 4v4
  turnTimeout: 45000,        // 45 second turn timer
  reconnect: true
}
```

#### Team Configurations

| Format | Players | Units/Player | Total Units/Team |
|--------|---------|--------------|------------------|
| 2v2 | 4 | 2 | 4 |
| 3v3 | 6 | 2 | 6 |
| 4v4 | 8 | 1-2 | 6-8 |

#### Team Balance Algorithm

```
+-----------------------------------------------------------------------+
|                     Team Balancing                                     |
+-----------------------------------------------------------------------+
|                                                                        |
|   1. Calculate combined power rating for queued players:              |
|      power = sum(character.level) * class_weight                      |
|                                                                        |
|   2. Sort players by power rating                                     |
|                                                                        |
|   3. Assign to teams using snake draft:                               |
|      Team A: 1st, 4th, 5th, 8th...                                    |
|      Team B: 2nd, 3rd, 6th, 7th...                                    |
|                                                                        |
|   4. Validate team power difference < 15%                             |
|                                                                        |
|   Example 4-player (2v2):                                             |
|   +----------------+----------------+                                  |
|   |    Team A      |    Team B      |                                  |
|   +----------------+----------------+                                  |
|   | Player 1 (Lv25)| Player 2 (Lv24)|                                  |
|   | Player 4 (Lv20)| Player 3 (Lv22)|                                  |
|   +----------------+----------------+                                  |
|   | Total: 45      | Total: 46      |                                  |
|   +----------------+----------------+                                  |
|                                                                        |
+-----------------------------------------------------------------------+
```

#### Team Communication

| Feature | Description |
|---------|-------------|
| Team Chat | Pre-battle and during battle |
| Ping System | Quick tactical communication |
| Turn Indicator | Shows which teammate is acting |

#### Win/Lose Conditions

| Result | Condition | Outcome |
|--------|-----------|---------|
| Victory | All opposing team units defeated | Team rewards |
| Defeat | All your team units defeated | Participation rewards |
| Individual Disconnect | Teammate can continue | Match continues |
| Team Forfeit | Vote required | No rewards for forfeiting team |

---

### 3.3 PVP_FFA (Post-MVP - Not Implemented)

> **Status:** This mode is planned for post-MVP development (Phase 3+).

Every player for themselves in a multi-player battle royale style encounter.

#### Configuration

```javascript
{
  mode: 'PVP_FFA',
  players: [3, 8],          // 3-8 players
  playerUnits: [1, 2],      // Limited units per player
  enemies: 0,
  teams: false,              // No teams
  turnTimeout: 45000,
  reconnect: true
}
```

#### Mode Details

| Parameter | Value | Description |
|-----------|-------|-------------|
| Player Count | 3-8 | Flexible player count |
| Units Per Player | 1-2 | Limited for balance |
| Max Total Units | 16 | Grid capacity limit |
| Turn Timeout | 45 seconds | Faster pace required |

#### Spawn Distribution

```
+-----------------------------------------------------------------------+
|                     FFA Spawn Zones (8 players)                        |
+-----------------------------------------------------------------------+
|                                                                        |
|     0   1   2   3   4   5   6   7                                     |
|   +---+---+---+---+---+---+---+---+                                   |
| 0 |P1 |P1 |   |   |   |   |P2 |P2 |                                   |
|   +---+---+---+---+---+---+---+---+                                   |
| 1 |P1 |   |   |   |   |   |   |P2 |                                   |
|   +---+---+---+---+---+---+---+---+                                   |
| 2 |   |   |   |   |   |   |   |   |                                   |
|   +---+---+---+---+---+---+---+---+                                   |
| 3 |P8 |   |   |   |   |   |   |P3 |                                   |
|   +---+---+---+---+---+---+---+---+                                   |
| 4 |P8 |   |   |   |   |   |   |P3 |                                   |
|   +---+---+---+---+---+---+---+---+                                   |
| 5 |   |   |   |   |   |   |   |   |                                   |
|   +---+---+---+---+---+---+---+---+                                   |
| 6 |P7 |   |   |   |   |   |   |P4 |                                   |
|   +---+---+---+---+---+---+---+---+                                   |
| 7 |P7 |P7 |   |   |   |   |P5 |P5 |                                   |
|   +---+---+---+---+---+---+---+---+                                   |
|         P6 P6                                                          |
|                                                                        |
|   Spawn zones distributed around edges and corners                    |
|                                                                        |
+-----------------------------------------------------------------------+
```

#### Placement and Scoring

| Placement | Description | Reward Multiplier |
|-----------|-------------|-------------------|
| 1st | Last player standing | 100% |
| 2nd | Second-to-last eliminated | 60% |
| 3rd | Third-to-last eliminated | 40% |
| 4th+ | Earlier eliminations | 20% |

#### Future: Shrinking Safe Zone

```
+-----------------------------------------------------------------------+
|                   Shrinking Zone (Future Feature)                      |
+-----------------------------------------------------------------------+
|                                                                        |
|   Phase 1 (Turns 1-10): Full 8x8 grid available                       |
|                                                                        |
|   Phase 2 (Turns 11-20): Outer ring becomes dangerous                 |
|   +---+---+---+---+---+---+---+---+                                   |
|   | X | X | X | X | X | X | X | X |  X = Danger zone                  |
|   +---+---+---+---+---+---+---+---+      (5% HP damage/turn)          |
|   | X |   |   |   |   |   |   | X |                                   |
|   | X |   |   |   |   |   |   | X |                                   |
|   | X |   |   |   |   |   |   | X |                                   |
|   | X |   |   |   |   |   |   | X |                                   |
|   | X |   |   |   |   |   |   | X |                                   |
|   | X |   |   |   |   |   |   | X |                                   |
|   | X | X | X | X | X | X | X | X |                                   |
|   +---+---+---+---+---+---+---+---+                                   |
|                                                                        |
|   Phase 3 (Turns 21+): Further shrinkage to 4x4 center               |
|                                                                        |
+-----------------------------------------------------------------------+
```

---

## 4. Battle Configuration Schema

### 4.1 Complete BattleConfig Type

```typescript
interface BattleConfig {
  // Mode identification
  mode: BattleMode;

  // Player configuration
  players: number | [number, number];     // Exact count or [min, max]
  playerUnits: [number, number];          // [min, max] units per player

  // Enemy configuration (PvE only)
  enemies: 'dynamic' | 'fixed' | number;  // Generation method or fixed count
  enemyScaling?: EnemyScalingConfig;

  // Team configuration
  teams: boolean | 'balanced' | 'all_players_one_team';
  teamSize?: [number, number];            // For team modes
  teamBalance?: TeamBalanceAlgorithm;

  // Timing configuration
  turnTimeout: number;                    // Milliseconds (0 = unlimited)
  reconnectGrace?: number;                // Milliseconds before forfeit

  // Map configuration
  mapSize: [number, number];              // [width, height]
  spawnZones: SpawnZoneConfig;
  terrain?: TerrainConfig;

  // Rewards configuration
  rewards: RewardsConfig;
}
```

### 4.2 Enum Definitions

```typescript
type BattleMode =
  | 'PVE_SOLO'
  | 'PVE_COOP'
  | 'PVP_DUEL'
  | 'PVP_TEAM'
  | 'PVP_FFA';

type TeamBalanceAlgorithm =
  | 'snake_draft'      // Alternating picks by power
  | 'random'           // Random assignment
  | 'captain_pick';    // Future: captains choose
```

### 4.3 Spawn Zone Configuration

```typescript
interface SpawnZoneConfig {
  type: 'corners' | 'sides' | 'distributed' | 'custom';

  // For PvE
  playerZone?: GridRect;    // Player spawn area
  enemyZone?: GridRect;     // Enemy spawn area

  // For PvP
  teamZones?: GridRect[];   // One per team
  playerZones?: GridRect[]; // One per player (FFA)

  // Zone size
  zoneSize: [number, number]; // [width, height] per zone
}

interface GridRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
```

### 4.4 Rewards Configuration

```typescript
interface RewardsConfig {
  gold: {
    enabled: boolean;
    baseAmount?: number;
    scaling?: 'difficulty' | 'player_count' | 'none';
    split?: 'equal' | 'performance' | 'winner_only';
  };

  experience: {
    enabled: boolean;
    baseAmount?: number;
    scaling?: 'difficulty' | 'enemy_levels' | 'none';
    distribution?: 'all_participants' | 'survivors' | 'winner';
  };

  rating: {
    enabled: boolean;
    system?: 'elo' | 'mmr' | 'flat';
    kFactor?: number;
  };

  items: {
    enabled: boolean;
    dropTable?: string;
    guaranteedDrops?: number;
  };
}
```

---

## 5. Spawn Zone Configuration

### 5.1 PvE Spawn Zones

Standard PvE battles place players and enemies at opposite corners.

```
+-----------------------------------------------------------------------+
|                     PvE Spawn Layout                                   |
+-----------------------------------------------------------------------+
|                                                                        |
|     0   1   2   3   4   5   6   7                                     |
|   +---+---+---+---+---+---+---+---+                                   |
| 0 |   |   |   |   |   |   | E | E |   E = Enemy spawn zone            |
|   +---+---+---+---+---+---+---+---+                                   |
| 1 |   |   |   |   |   |   | E | E |                                   |
|   +---+---+---+---+---+---+---+---+                                   |
| 2 |   |   |   |   |   |   |   |   |                                   |
|   +---+---+---+---+---+---+---+---+                                   |
| 3 |   |   |   |   |   |   |   |   |                                   |
|   +---+---+---+---+---+---+---+---+                                   |
| 4 |   |   |   |   |   |   |   |   |                                   |
|   +---+---+---+---+---+---+---+---+                                   |
| 5 |   |   |   |   |   |   |   |   |                                   |
|   +---+---+---+---+---+---+---+---+                                   |
| 6 | P | P |   |   |   |   |   |   |   P = Player spawn zone           |
|   +---+---+---+---+---+---+---+---+                                   |
| 7 | P | P | P |   |   |   |   |   |                                   |
|   +---+---+---+---+---+---+---+---+                                   |
|                                                                        |
|   Player Zone: (0,5) to (2,7) - 5x5 area (bottom-left corner)        |
|   Enemy Zone: (5,0) to (7,2) - 5x5 area (top-right corner)           |
|                                                                        |
+-----------------------------------------------------------------------+
```

### 5.2 PvP 1v1 (Duel) Spawn Zones

Two players at opposite corners with equal spawn areas.

```
+-----------------------------------------------------------------------+
|                     Duel Spawn Layout                                  |
+-----------------------------------------------------------------------+
|                                                                        |
|     0   1   2   3   4   5   6   7                                     |
|   +---+---+---+---+---+---+---+---+                                   |
| 0 |   |   |   |   |   |   |P2 |P2 |                                   |
|   +---+---+---+---+---+---+---+---+                                   |
| 1 |   |   |   |   |   |   |P2 |P2 |                                   |
|   +---+---+---+---+---+---+---+---+                                   |
| 2 |   |   |   |   |   |   |P2 |   |                                   |
|   +---+---+---+---+---+---+---+---+                                   |
| 3 |   |   |   |   |   |   |   |   |                                   |
|   +---+---+---+---+---+---+---+---+                                   |
| 4 |   |   |   |   |   |   |   |   |                                   |
|   +---+---+---+---+---+---+---+---+                                   |
| 5 |   |P1 |   |   |   |   |   |   |                                   |
|   +---+---+---+---+---+---+---+---+                                   |
| 6 |P1 |P1 |   |   |   |   |   |   |                                   |
|   +---+---+---+---+---+---+---+---+                                   |
| 7 |P1 |P1 |   |   |   |   |   |   |                                   |
|   +---+---+---+---+---+---+---+---+                                   |
|                                                                        |
+-----------------------------------------------------------------------+
```

### 5.3 PvP Team Spawn Zones

Teams spawn on opposite sides (left vs right or top vs bottom).

```
+-----------------------------------------------------------------------+
|                     Team (2v2) Spawn Layout                            |
+-----------------------------------------------------------------------+
|                                                                        |
|     0   1   2   3   4   5   6   7                                     |
|   +---+---+---+---+---+---+---+---+                                   |
| 0 |A1 |A1 |   |   |   |   |B1 |B1 |                                   |
|   +---+---+---+---+---+---+---+---+                                   |
| 1 |A1 |   |   |   |   |   |   |B1 |                                   |
|   +---+---+---+---+---+---+---+---+                                   |
| 2 |   |   |   |   |   |   |   |   |                                   |
|   +---+---+---+---+---+---+---+---+                                   |
| 3 |   |   |   |   |   |   |   |   |                                   |
|   +---+---+---+---+---+---+---+---+                                   |
| 4 |   |   |   |   |   |   |   |   |                                   |
|   +---+---+---+---+---+---+---+---+                                   |
| 5 |   |   |   |   |   |   |   |   |                                   |
|   +---+---+---+---+---+---+---+---+                                   |
| 6 |A2 |   |   |   |   |   |   |B2 |                                   |
|   +---+---+---+---+---+---+---+---+                                   |
| 7 |A2 |A2 |   |   |   |   |B2 |B2 |                                   |
|   +---+---+---+---+---+---+---+---+                                   |
|                                                                        |
|   Team A (Players 1,2): Left side                                     |
|   Team B (Players 3,4): Right side                                    |
|                                                                        |
+-----------------------------------------------------------------------+
```

### 5.4 FFA Spawn Zones

Distributed around edges and corners based on player count.

```
+-----------------------------------------------------------------------+
|                     FFA Spawn Layout (6 players)                       |
+-----------------------------------------------------------------------+
|                                                                        |
|     0   1   2   3   4   5   6   7                                     |
|   +---+---+---+---+---+---+---+---+                                   |
| 0 |P1 |P1 |   |   |   |   |P2 |P2 |                                   |
|   +---+---+---+---+---+---+---+---+                                   |
| 1 |P1 |   |   |   |   |   |   |P2 |                                   |
|   +---+---+---+---+---+---+---+---+                                   |
| 2 |   |   |   |   |   |   |   |   |                                   |
|   +---+---+---+---+---+---+---+---+                                   |
| 3 |P6 |   |   |   |   |   |   |P3 |                                   |
|   +---+---+---+---+---+---+---+---+                                   |
| 4 |P6 |   |   |   |   |   |   |P3 |                                   |
|   +---+---+---+---+---+---+---+---+                                   |
| 5 |   |   |   |   |   |   |   |   |                                   |
|   +---+---+---+---+---+---+---+---+                                   |
| 6 |P5 |   |   |   |   |   |   |P4 |                                   |
|   +---+---+---+---+---+---+---+---+                                   |
| 7 |P5 |P5 |   |   |   |   |P4 |P4 |                                   |
|   +---+---+---+---+---+---+---+---+                                   |
|                                                                        |
+-----------------------------------------------------------------------+
```

---

## 6. Matchmaking Rules by Mode

### 6.1 Queue Configuration

| Mode | Queue Type | Min Wait | Max Wait | Expansion |
|------|------------|----------|----------|-----------|
| PVE_SOLO | Instant | 0s | 0s | N/A |
| PVE_COOP | Party-based | 5s | 120s | +1 player/30s |
| PVP_DUEL | Skill-based | 5s | 120s | +5 levels/30s |
| PVP_TEAM | Balanced | 10s | 180s | +10% power/30s |
| PVP_FFA | Fill-based | 15s | 180s | Start at min players |

### 6.2 Level Range Matching

```
+-----------------------------------------------------------------------+
|                     Level Matching Formula                             |
+-----------------------------------------------------------------------+
|                                                                        |
|   base_range = 10                                                     |
|   expanded_range = base_range + floor(queue_time / 30) * 5            |
|   max_range = 30                                                      |
|                                                                        |
|   match if: abs(player_avg_level - opponent_avg_level) <= range       |
|                                                                        |
|   Example:                                                            |
|   +------------------+------------------+------------------+           |
|   | Queue Time       | Level Range      | Lv25 can match   |           |
|   +------------------+------------------+------------------+           |
|   | 0-29 seconds     | +/- 10           | Lv15-35          |           |
|   | 30-59 seconds    | +/- 15           | Lv10-40          |           |
|   | 60-89 seconds    | +/- 20           | Lv5-45           |           |
|   | 90+ seconds      | +/- 25 (capped)  | Lv1-50           |           |
|   +------------------+------------------+------------------+           |
|                                                                        |
+-----------------------------------------------------------------------+
```

### 6.3 Team Balancing Algorithm

```
+-----------------------------------------------------------------------+
|                     Team Balance Process                               |
+-----------------------------------------------------------------------+
|                                                                        |
|   1. Calculate player power rating:                                   |
|      power = sum(unit.level * class_weight * equipment_bonus)         |
|                                                                        |
|      Class weights:                                                   |
|      +-------------+--------+                                          |
|      | Class       | Weight |                                          |
|      +-------------+--------+                                          |
|      | Warrior     | 1.0    |                                          |
|      | Wizard      | 1.1    |                                          |
|      | Monk        | 1.0    |                                          |
|      | Chemist     | 0.9    |                                          |
|      +-------------+--------+                                          |
|                                                                        |
|   2. Sort players by power descending                                 |
|                                                                        |
|   3. Snake draft assignment:                                          |
|      Round 1: A, B                                                    |
|      Round 2: B, A                                                    |
|      Round 3: A, B                                                    |
|      ...                                                              |
|                                                                        |
|   4. Validate balance:                                                |
|      team_diff = abs(teamA_power - teamB_power)                       |
|      max_diff = avg_power * 0.15                                      |
|                                                                        |
|      if (team_diff > max_diff) { requeue or swap lowest player }      |
|                                                                        |
+-----------------------------------------------------------------------+
```

### 6.4 Estimated Wait Times

| Mode | Peak Hours | Off-Peak | Low Population |
|------|------------|----------|----------------|
| PVE_SOLO | Instant | Instant | Instant |
| PVE_COOP | 15-30s | 30-60s | 60-120s |
| PVP_DUEL | 10-20s | 30-60s | 60-120s |
| PVP_TEAM | 30-60s | 60-120s | 120-180s |
| PVP_FFA | 20-40s | 45-90s | May not fire |

---

## 7. Rewards by Mode

### 7.1 Reward Summary Table

| Mode | Gold | XP | Rating | Items |
|------|------|-----|--------|-------|
| PVE_SOLO | Yes | Yes | No | Yes |
| PVE_COOP | Yes (split) | Yes | No | Yes (split) |
| PVP_DUEL | Yes | Yes | Yes | No |
| PVP_TEAM | Yes | Yes | Yes | No |
| PVP_FFA | Winner only | Yes | Yes | No |

### 7.2 PvE Reward Calculations

```
+-----------------------------------------------------------------------+
|                     PvE Solo Rewards                                   |
+-----------------------------------------------------------------------+
|                                                                        |
|   Gold:                                                               |
|   base_gold = difficulty_tier * 30                                    |
|   bonus = random(0.8, 1.2)                                            |
|   total_gold = floor(base_gold * enemy_count * bonus)                 |
|                                                                        |
|   Experience (per character):                                         |
|   base_xp = sum(enemy.level * 10)                                     |
|   difficulty_bonus = 1 + (difficulty_tier * 0.1)                      |
|   total_xp = floor(base_xp * difficulty_bonus)                        |
|                                                                        |
|   Items:                                                              |
|   Each enemy has drop table with 1-3 roll chances                     |
|   Drop rate modified by luck stat                                     |
|                                                                        |
+-----------------------------------------------------------------------+
```

### 7.3 PvE Co-op Reward Distribution

```
+-----------------------------------------------------------------------+
|                     Co-op Reward Split                                 |
+-----------------------------------------------------------------------+
|                                                                        |
|   Gold: Equal split among all players                                 |
|   +--------------------------------------------------+                |
|   | Total Gold: 400                                   |                |
|   | 2 Players: 200 each                               |                |
|   | 3 Players: 133 each                               |                |
|   | 4 Players: 100 each                               |                |
|   +--------------------------------------------------+                |
|                                                                        |
|   Experience: Full amount to each player's characters                |
|   (No split - encourages cooperation)                                 |
|                                                                        |
|   Items: Round-robin distribution                                     |
|   +--------------------------------------------------+                |
|   | Drop 1 -> Player 1                                |                |
|   | Drop 2 -> Player 2                                |                |
|   | Drop 3 -> Player 3                                |                |
|   | Drop 4 -> Player 1 (cycle continues)              |                |
|   +--------------------------------------------------+                |
|                                                                        |
+-----------------------------------------------------------------------+
```

### 7.4 PvP Reward Calculations

```
+-----------------------------------------------------------------------+
|                     PvP Duel Rewards                                   |
+-----------------------------------------------------------------------+
|                                                                        |
|   Victory:                                                            |
|   +--------------------------------------------------+                |
|   | Gold: 100 base + (opponent_avg_level * 2)         |                |
|   | XP: 500 + (opponent_avg_level * 20)               |                |
|   | Rating: +K * (1 - expected_outcome)               |                |
|   +--------------------------------------------------+                |
|                                                                        |
|   Defeat:                                                             |
|   +--------------------------------------------------+                |
|   | Gold: 0                                           |                |
|   | XP: 100 (participation)                           |                |
|   | Rating: -K * expected_outcome                     |                |
|   +--------------------------------------------------+                |
|                                                                        |
|   K-Factor: 32 (standard), 48 (placement matches)                    |
|                                                                        |
+-----------------------------------------------------------------------+
```

### 7.5 PvP FFA Placement Rewards

| Placement | Gold Multiplier | XP Multiplier | Rating Change |
|-----------|-----------------|---------------|---------------|
| 1st | 100% | 100% | +30 to +50 |
| 2nd | 60% | 80% | +10 to +20 |
| 3rd | 40% | 60% | 0 to +10 |
| 4th | 20% | 40% | -5 to 0 |
| 5th+ | 0% | 25% | -10 to -20 |

---

## 8. Mode-Specific Rules

### 8.1 Turn Timer Rules

| Mode | Turn Time | Warnings | Timeout Action |
|------|-----------|----------|----------------|
| PVE_SOLO | Unlimited | None | N/A |
| PVE_COOP | 60s | 10s, 5s | Auto-wait |
| PVP_DUEL | 60s | 10s, 5s | Auto-wait |
| PVP_TEAM | 45s | 10s, 5s | Auto-wait |
| PVP_FFA | 45s | 10s, 5s | Auto-wait |

### 8.2 Disconnection Handling

```
+-----------------------------------------------------------------------+
|                     Disconnect Protocol                                |
+-----------------------------------------------------------------------+
|                                                                        |
|   PVE_SOLO:                                                           |
|   - Battle state saved to database                                    |
|   - Player can resume on reconnect                                    |
|   - No timeout                                                        |
|                                                                        |
|   PVE_COOP:                                                           |
|   - 60 second grace period                                            |
|   - AI takes over disconnected player's units                         |
|   - If all players disconnect, battle abandoned                       |
|                                                                        |
|   PVP_DUEL:                                                           |
|   - 30 second grace period                                            |
|   - Opponent sees "Waiting for reconnection..."                       |
|   - After timeout: auto-forfeit for disconnected player               |
|                                                                        |
|   PVP_TEAM:                                                           |
|   - 90 second grace period                                            |
|   - Teammates continue playing                                        |
|   - AI does NOT take over (teammate disadvantage)                     |
|   - After timeout: units removed, match continues                     |
|                                                                        |
|   PVP_FFA:                                                            |
|   - 60 second grace period (shorter due to many players)             |
|   - After timeout: units eliminated, player placed accordingly        |
|                                                                        |
+-----------------------------------------------------------------------+
```

### 8.3 Surrender Rules

| Mode | Minimum Turn | Vote Required | Consequence |
|------|--------------|---------------|-------------|
| PVE_SOLO | N/A | N/A | Forfeit available |
| PVE_COOP | 3 | Majority | All players leave |
| PVP_DUEL | 3 | N/A | Loss recorded |
| PVP_TEAM | 3 | Majority of team | Team loses |
| PVP_FFA | 3 | N/A | Eliminated, placed last |

---

## 9. Implementation Status

### 9.1 Current Implementation (MVP)

| Mode | Status | Notes |
|------|--------|-------|
| PVE_SOLO | Implemented | Full functionality |
| PVE_COOP | Not Started | Post-MVP |
| PVP_DUEL | Partial | Coliseum UI exists, needs refinement |
| PVP_TEAM | Not Started | Post-MVP |
| PVP_FFA | Not Started | Post-MVP |

### 9.2 Implementation Priority

```
+-----------------------------------------------------------------------+
|                     Implementation Roadmap                             |
+-----------------------------------------------------------------------+
|                                                                        |
|   Phase 1 (MVP):                                                      |
|   [x] PVE_SOLO - Complete                                             |
|   [~] PVP_DUEL - Coliseum queue exists, needs polish                  |
|                                                                        |
|   Phase 2 (Post-MVP):                                                 |
|   [ ] PVE_COOP - Party system required                                |
|   [ ] PVP_TEAM - Team matchmaking system                              |
|                                                                        |
|   Phase 3 (Future):                                                   |
|   [ ] PVP_FFA - Complex spawn and elimination logic                   |
|   [ ] Ranked modes with seasons                                       |
|   [ ] Tournament support                                              |
|                                                                        |
+-----------------------------------------------------------------------+
```

---

## 10. Related Documents

| Document | Description |
|----------|-------------|
| [BATTLE_TURN_SYSTEM.md](BATTLE_TURN_SYSTEM.md) | CT system, turn state machine, WebSocket protocol |
| [GAME_DESIGN.md](GAME_DESIGN.md) | Combat formulas, status effects, classes |
| [API_SPECIFICATION.md](API_SPECIFICATION.md) | Battle endpoints, Coliseum WebSocket events |
| [ENEMY_SYSTEM.md](ENEMY_SYSTEM.md) | Enemy templates, AI archetypes for PvE |
| [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md) | Database schemas, battle_state structure |

---

## 11. Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Jan 2026 | - | Initial document: All battle mode configurations |
| 1.1 | Jan 2026 | - | Added prominent implementation status section; marked unimplemented modes |
| 1.2 | Sep 2026 | - | Replaced the PvP draw outcome with the mutual knockout rule |
