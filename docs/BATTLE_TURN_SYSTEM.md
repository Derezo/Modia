# Modia - Battle Turn System

## Document Information

| Field | Value |
|-------|-------|
| Project Name | Modia |
| Version | 1.0 |
| Last Updated | January 2026 |
| System Type | CT-Based Turn Order with WebSocket Sync |

---

## 1. Overview

The battle turn system uses a Charge Time (CT) model to determine turn order. All units accumulate CT based on their agility stat, and a unit acts when its CT reaches 100. This document specifies the server-authoritative turn system with WebSocket-driven real-time updates.

### 1.1 Design Goals

- **Deterministic**: Same inputs produce same turn order
- **Fair**: Faster units act more frequently, proportional to agility
- **Responsive**: Real-time feedback via WebSocket
- **Server-Authoritative**: All calculations happen server-side

### 1.2 System Components

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Battle Turn System                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                  │
│  │  CT Engine   │───▶│ Turn State   │───▶│  WebSocket   │                  │
│  │  (Server)    │    │   Machine    │    │  Broadcast   │                  │
│  └──────────────┘    └──────────────┘    └──────────────┘                  │
│         │                   │                   │                           │
│         ▼                   ▼                   ▼                           │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                  │
│  │ Turn Order   │    │   Action     │    │   Client     │                  │
│  │ Prediction   │    │  Processor   │    │   Handler    │                  │
│  └──────────────┘    └──────────────┘    └──────────────┘                  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Charge Time (CT) System

### 2.1 Core Mechanics

The CT system determines when each unit takes their turn. All units accumulate CT simultaneously until one reaches the action threshold.

| Parameter | Value | Description |
|-----------|-------|-------------|
| CT Threshold | 100 | Unit acts when CT >= 100 |
| Starting CT | 0 | All units begin battle at 0 CT |
| CT Reset | 0 | CT resets to 0 after acting |

### 2.2 CT Accumulation Formula

```
CT_gain_per_tick = unit.agility

turns_to_first_action = ceil(100 / unit.agility)
```

**Example Calculations:**

| Unit | AGI | Ticks to Act | Actions per 100 Ticks |
|------|-----|--------------|----------------------|
| Fast Monk | 25 | 4 | ~25 |
| Normal Warrior | 15 | 7 | ~15 |
| Slow Wizard | 10 | 10 | ~10 |

### 2.3 CT Tick Loop

The server runs a CT tick loop during battle:

```
┌─────────────────────────────────────────────────────────────────┐
│                        CT Tick Loop                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   1. Check if any unit has CT >= 100                            │
│      │                                                          │
│      ├── YES ──▶ Select unit with highest CT                   │
│      │           (tie-breaker: lowest unit ID)                  │
│      │           │                                              │
│      │           ▼                                              │
│      │           Begin that unit's turn                         │
│      │           │                                              │
│      │           ▼                                              │
│      │           PAUSE tick loop until turn complete            │
│      │                                                          │
│      └── NO ───▶ Add AGI to each unit's CT                     │
│                  │                                              │
│                  ▼                                              │
│                  Repeat from step 1                             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.4 CT Modification Effects

Some abilities and status effects modify CT:

| Effect | CT Modification | Notes |
|--------|-----------------|-------|
| Haste | +50% CT gain | Stacks additively with AGI |
| Slow | -20% CT gain | Minimum CT gain is 1 |
| Delay (skill) | -50 CT | Cannot reduce below 0 |
| Quick (skill) | +25 CT | Cannot exceed threshold |
| Stun | Skip turn, CT = 0 | Lose accumulated CT |

---

## 3. Turn Order Calculation

### 3.1 Server Authority

Turn order is calculated **exclusively on the server**. The client receives turn order predictions for UI display but cannot influence the actual order.

```
┌─────────────────────────────────────────────────────────────────┐
│                    Turn Order Authority                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   SERVER (Authoritative)          CLIENT (Display Only)         │
│   ┌────────────────────┐          ┌────────────────────┐        │
│   │ • CT calculations  │          │ • Show turn order  │        │
│   │ • Turn selection   │  ─────▶  │ • Animate portraits│        │
│   │ • Action validation│          │ • Highlight active │        │
│   │ • State updates    │          │ • Show predictions │        │
│   └────────────────────┘          └────────────────────┘        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Priority Resolution

When multiple units reach CT >= 100 simultaneously:

1. **Primary**: Highest CT value acts first
2. **Secondary**: Lower unit ID acts first (deterministic tie-breaker)

```javascript
// Turn selection algorithm
function selectActiveUnit(units) {
  const readyUnits = units.filter(u => u.ct >= 100 && u.hp > 0);

  if (readyUnits.length === 0) return null;

  readyUnits.sort((a, b) => {
    // Higher CT first
    if (b.ct !== a.ct) return b.ct - a.ct;
    // Lower ID first (tie-breaker)
    return a.id - b.id;
  });

  return readyUnits[0];
}
```

### 3.3 Turn Prediction

The server provides turn predictions for UI display:

```json
{
  "type": "battle:turn_order",
  "payload": {
    "currentUnit": "char_1",
    "turnPredictions": [
      { "unitId": "enemy_2", "estimatedTicks": 3 },
      { "unitId": "char_3", "estimatedTicks": 5 },
      { "unitId": "char_1", "estimatedTicks": 8 },
      { "unitId": "enemy_1", "estimatedTicks": 10 }
    ]
  }
}
```

**Prediction Formula:**

```
ticks_until_action = ceil((100 - unit.ct) / unit.agility)
```

---

## 4. Two-Action System

### 4.1 Action Types per Turn

Each unit's turn allows up to **two actions**:

| Action Slot | Action Type | Description |
|-------------|-------------|-------------|
| MOVE | Movement | Move to a tile within range |
| ACT | Attack / Skill / Item | Offensive or support action |

### 4.2 Action Order Flexibility

Actions can be performed in **either order**:

```
┌─────────────────────────────────────────────────────────────────┐
│                      Turn Action Options                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Option A: Move → Act                                          │
│   ┌────────┐    ┌────────┐    ┌────────────┐                   │
│   │  MOVE  │───▶│  ACT   │───▶│ Turn Ends  │                   │
│   └────────┘    └────────┘    └────────────┘                   │
│                                                                  │
│   Option B: Act → Move                                          │
│   ┌────────┐    ┌────────┐    ┌────────────┐                   │
│   │  ACT   │───▶│  MOVE  │───▶│ Turn Ends  │                   │
│   └────────┘    └────────┘    └────────────┘                   │
│                                                                  │
│   Option C: Single Action + Wait                                │
│   ┌────────┐    ┌────────┐    ┌────────────┐                   │
│   │  MOVE  │───▶│  WAIT  │───▶│ Turn Ends  │                   │
│   └────────┘    └────────┘    └────────────┘                   │
│                                                                  │
│   Option D: Immediate Wait                                      │
│   ┌────────┐    ┌────────────┐                                  │
│   │  WAIT  │───▶│ Turn Ends  │                                  │
│   └────────┘    └────────────┘                                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 4.3 ACT Actions (Mutually Exclusive)

Only **one** ACT-type action per turn:

| ACT Type | Description | Consumes ACT Slot |
|----------|-------------|-------------------|
| Attack | Basic physical/magical attack | Yes |
| Skill | Use learned ability (costs MP) | Yes |
| Item | Use consumable from inventory | Yes |

### 4.4 Wait Action

The **Wait** action immediately ends the turn:

- Forfeits any unused MOVE action
- Forfeits any unused ACT action
- Unit's CT resets to 0
- Useful for strategic positioning in turn order

### 4.5 Status Effect Restrictions

Some status effects restrict available actions:

| Status Effect | Blocks MOVE | Blocks ACT | Behavior |
|---------------|-------------|------------|----------|
| Stun | Yes | Yes | Auto-ends turn immediately |
| Freeze | Yes | Yes | Auto-ends turn immediately |
| Sleep | Yes | Yes | Auto-ends turn (broken by damage) |
| Root | Yes | No | Can still Attack/Skill/Item |
| Silence | No | Skills only | Can Move and basic Attack |
| Disarm | No | Attack only | Can Move and use Skills/Items |

---

## 5. Turn State Machine

### 5.1 State Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Turn State Machine                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│                    ┌─────────────────────┐                                  │
│                    │  WAITING_FOR_TURN   │◀────────────────────┐            │
│                    │  (CT accumulation)  │                     │            │
│                    └──────────┬──────────┘                     │            │
│                               │ Unit reaches CT >= 100         │            │
│                               ▼                                 │            │
│                    ┌─────────────────────┐                     │            │
│                    │    TURN_STARTED     │                     │            │
│                    │ (broadcast to all)  │                     │            │
│                    └──────────┬──────────┘                     │            │
│                               │                                 │            │
│                               ▼                                 │            │
│               ┌──────────────────────────────┐                 │            │
│               │       AWAITING_ACTION        │◀────────┐       │            │
│               │  (waiting for player/AI)     │         │       │            │
│               └──────────────┬───────────────┘         │       │            │
│                              │ Action received         │       │            │
│                              ▼                         │       │            │
│               ┌──────────────────────────────┐         │       │            │
│               │      ACTION_RECEIVED         │         │       │            │
│               │   (validate action)          │         │       │            │
│               └──────────────┬───────────────┘         │       │            │
│                              │ Valid                   │       │            │
│                              ▼                         │       │            │
│               ┌──────────────────────────────┐         │       │            │
│               │     PROCESSING_ACTION        │         │       │            │
│               │  (execute effects)           │         │       │            │
│               └──────────────┬───────────────┘         │       │            │
│                              │                         │       │            │
│                              ▼                         │       │            │
│               ┌──────────────────────────────┐         │       │            │
│               │      ACTION_COMPLETE         │         │       │            │
│               │  (broadcast result)          │         │       │            │
│               └──────────────┬───────────────┘         │       │            │
│                              │                         │       │            │
│                   ┌──────────┴──────────┐              │       │            │
│                   │                     │              │       │            │
│         ┌─────────▼─────────┐ ┌─────────▼─────────┐    │       │            │
│         │  Actions remain?  │ │  Turn complete?   │    │       │            │
│         │  (partial turn)   │ │  (both used/wait) │    │       │            │
│         └─────────┬─────────┘ └─────────┬─────────┘    │       │            │
│                   │                     │              │       │            │
│                   │ Yes                 │ Yes          │       │            │
│                   └─────────────────────┼──────────────┘       │            │
│                                         │                      │            │
│                                         ▼                      │            │
│                          ┌──────────────────────────────┐      │            │
│                          │       TURN_COMPLETE          │      │            │
│                          │  (reset CT, next unit)       │──────┘            │
│                          └──────────────────────────────┘                   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 State Definitions

| State | Description | Next State(s) |
|-------|-------------|---------------|
| `waiting_for_turn` | CT accumulation phase, no active unit | `turn_started` |
| `turn_started` | Active unit determined, broadcast sent | `awaiting_action` |
| `awaiting_action` | Waiting for player input or AI calculation | `action_received` |
| `action_received` | Server received and is validating action | `processing_action` |
| `processing_action` | Executing action effects (damage, movement) | `action_complete` |
| `action_complete` | Action resolved, check if turn continues | `awaiting_action` or `turn_complete` |
| `turn_complete` | Both move and act used, or wait chosen | `waiting_for_turn` |

### 5.3 Turn State Data Structure

```javascript
{
  turnState: {
    state: "awaiting_action",
    activeUnitId: "char_1",
    turnNumber: 15,
    moveUsed: false,
    actUsed: false,
    turnStartTime: 1704556800000,
    timeoutAt: 1704556860000,
    pendingAction: null
  }
}
```

---

## 6. Server Turn Loop

### 6.1 Main Loop Architecture

The server runs an async turn loop that processes the battle:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Server Turn Loop                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   async function battleTurnLoop(battleId) {                                 │
│     while (battle.status === 'active') {                                    │
│                                                                              │
│       // 1. Accumulate CT until someone can act                             │
│       while (!hasReadyUnit(battle.units)) {                                 │
│         tickCT(battle.units);                                               │
│       }                                                                      │
│                                                                              │
│       // 2. Select active unit                                              │
│       const activeUnit = selectActiveUnit(battle.units);                    │
│       broadcast('battle:turn_start', { unitId: activeUnit.id });            │
│                                                                              │
│       // 3. Handle turn based on unit type                                  │
│       if (activeUnit.type === 'enemy') {                                    │
│         await handleEnemyTurn(activeUnit);                                  │
│       } else {                                                              │
│         await handlePlayerTurn(activeUnit);                                 │
│       }                                                                      │
│                                                                              │
│       // 4. Reset CT and check battle end                                   │
│       activeUnit.ct = 0;                                                    │
│       checkBattleEnd(battle);                                               │
│     }                                                                        │
│   }                                                                          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Player Turn Handling

```javascript
async function handlePlayerTurn(unit) {
  const timeout = 60000; // 60 seconds
  const turnStart = Date.now();

  broadcast('battle:turn_start', {
    unitId: unit.id,
    unitType: 'player_local',
    timeRemaining: timeout / 1000
  });

  while (!unit.turnComplete) {
    // Wait for action via HTTP POST or WebSocket
    const action = await Promise.race([
      waitForPlayerAction(unit.id),
      sleep(timeout - (Date.now() - turnStart))
    ]);

    if (!action) {
      // Timeout: auto-wait
      await executeAction(unit, { type: 'wait' });
      break;
    }

    if (validateAction(unit, action)) {
      await executeAction(unit, action);
    } else {
      sendError(unit.owner, 'Invalid action');
    }
  }

  broadcast('battle:turn_end', { unitId: unit.id });
}
```

### 6.3 Enemy Turn Handling

```javascript
async function handleEnemyTurn(unit) {
  broadcast('battle:turn_start', {
    unitId: unit.id,
    unitType: 'enemy'
  });

  // AI calculates action
  const aiDecision = calculateAIAction(unit);

  // Broadcast intent (for animation purposes)
  broadcast('battle:action_intent', {
    unitId: unit.id,
    actionType: aiDecision.type,
    targetId: aiDecision.targetId
  });

  // Delay for player to see intent (300-800ms based on action)
  await sleep(getActionDelay(aiDecision.type));

  // Execute and broadcast result
  const result = await executeAction(unit, aiDecision);

  broadcast('battle:action_result', {
    unitId: unit.id,
    action: aiDecision,
    result: result
  });

  broadcast('battle:turn_end', { unitId: unit.id });
}
```

### 6.4 Turn Timeout Configuration

| Setting | Value | Description |
|---------|-------|-------------|
| Player Turn Timeout | 60 seconds | Time limit for player action |
| Enemy Turn Delay | 300-800ms | Artificial delay for readability (see [BATTLE_ANIMATIONS.md](BATTLE_ANIMATIONS.md) for full visual timeline) |
| Timeout Warning | 10 seconds | Warning broadcast before timeout |
| PvP Turn Timeout | 45 seconds | Shorter timeout for PvP battles |

### 6.5 Timeout Behavior

```
┌─────────────────────────────────────────────────────────────────┐
│                     Turn Timeout Flow                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Turn Start (T=0)                                              │
│        │                                                        │
│        ▼                                                        │
│   Player has 60 seconds                                         │
│        │                                                        │
│        │  T=50s: Warning broadcast                              │
│        │  ┌────────────────────────────────┐                   │
│        ├─▶│ battle:turn_warning           │                   │
│        │  │ { secondsRemaining: 10 }       │                   │
│        │  └────────────────────────────────┘                   │
│        │                                                        │
│        │  T=55s: Urgent warning                                │
│        │  ┌────────────────────────────────┐                   │
│        ├─▶│ battle:turn_warning           │                   │
│        │  │ { secondsRemaining: 5, urgent }│                   │
│        │  └────────────────────────────────┘                   │
│        │                                                        │
│        │  T=60s: Timeout                                       │
│        ▼                                                        │
│   ┌────────────────────────────────┐                           │
│   │ Auto-execute WAIT action       │                           │
│   │ (forfeits remaining actions)   │                           │
│   └────────────────────────────────┘                           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 7. Client Turn Handling

### 7.1 WebSocket Message Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Client-Server Message Flow                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   SERVER                                          CLIENT                     │
│      │                                               │                      │
│      │──── battle:turn_start ────────────────────▶  │                      │
│      │     { unitId, unitType, timeRemaining }      │                      │
│      │                                               │                      │
│      │                                               │  Pan camera to unit  │
│      │                                               │  Show action menu    │
│      │                                               │  Start turn timer    │
│      │                                               │                      │
│      │◀──── POST /api/battle/action ─────────────── │                      │
│      │      { actionType: 'move', ... }             │                      │
│      │                                               │                      │
│      │──── battle:action_result ─────────────────▶  │                      │
│      │     { action, result, unitStates }           │                      │
│      │                                               │                      │
│      │                                               │  Play animation      │
│      │                                               │  Update unit states  │
│      │                                               │  Check if turn done  │
│      │                                               │                      │
│      │──── battle:turn_end ──────────────────────▶  │                      │
│      │     { unitId }                               │                      │
│      │                                               │                      │
│      │──── battle:turn_start ────────────────────▶  │  (next unit)         │
│      │     { unitId: 'enemy_1', ... }               │                      │
│      │                                               │                      │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Turn Start Handling (Client)

```javascript
// Client-side turn start handler
websocket.on('battle:turn_start', (payload) => {
  const { unitId, unitType, timeRemaining } = payload;
  const unit = findUnit(unitId);

  // 1. Pan camera to active unit
  battleCamera.panTo(unit.tileX, unit.tileY, {
    duration: 300,
    easing: 'easeOutQuad'
  });

  // 2. Highlight active unit
  battleGrid.setActiveUnit(unit);

  // 3. Handle based on unit type
  if (unitType === 'player_local') {
    // Show radial action menu
    battleUI.showActionMenu(unit, {
      canMove: !unit.moveUsed,
      canAct: !unit.actUsed
    });

    // Start turn timer
    battleUI.startTurnTimer(timeRemaining);

  } else if (unitType === 'enemy') {
    // Show "Enemy Turn" indicator
    battleUI.showEnemyTurnIndicator(unit);

  } else if (unitType === 'player_remote') {
    // PvP: Show "Waiting for opponent"
    battleUI.showWaitingIndicator(unit);
  }
});
```

### 7.3 Action Result Handling (Client)

```javascript
// Client-side action result handler
websocket.on('battle:action_result', async (payload) => {
  const { unitId, action, result, unitStates } = payload;
  const unit = findUnit(unitId);

  // 1. Play action animation
  await battleAnimations.playAction(unit, action, result);

  // 2. Update unit states
  for (const [id, state] of Object.entries(unitStates)) {
    const targetUnit = findUnit(id);
    targetUnit.hp = state.hp;
    targetUnit.mp = state.mp;
    targetUnit.statusEffects = state.statusEffects;

    // Update HP/MP bars
    battleUI.updateUnitBars(targetUnit);
  }

  // 3. Handle death animations
  if (result.kills) {
    for (const killedId of result.kills) {
      await battleAnimations.playDeath(findUnit(killedId));
    }
  }

  // 4. Update action menu if local player's turn continues
  if (unit.type === 'player_local' && !result.turnComplete) {
    battleUI.updateActionMenu(unit, {
      canMove: !unit.moveUsed,
      canAct: !unit.actUsed
    });
  }
});
```

### 7.4 Client State Indicators

| Unit Type | Active Indicator | Waiting Indicator |
|-----------|------------------|-------------------|
| `player_local` | Radial action menu | - |
| `player_remote` | - | "Waiting for [name]..." |
| `enemy` | - | "Enemy Turn" overlay |

---

## 8. Unit Types

### 8.1 Type Definitions

| Unit Type | Controller | Description |
|-----------|------------|-------------|
| `player_local` | Current player | Characters the local player can control |
| `player_remote` | Other player | Characters controlled by opponent (PvP/co-op) |
| `enemy` | AI | Server-controlled enemy units |

### 8.2 Type-Specific Behavior

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Unit Type Behaviors                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   player_local:                                                             │
│   ┌─────────────────────────────────────────────────────────────┐           │
│   │ • Client shows action menu                                   │           │
│   │ • Player selects action via UI                              │           │
│   │ • HTTP POST sends action to server                          │           │
│   │ • 60 second timeout (configurable)                          │           │
│   │ • Can see full movement/attack ranges                       │           │
│   └─────────────────────────────────────────────────────────────┘           │
│                                                                              │
│   player_remote:                                                            │
│   ┌─────────────────────────────────────────────────────────────┐           │
│   │ • Client shows "waiting" indicator                          │           │
│   │ • Receives action results via WebSocket                     │           │
│   │ • Cannot interact during their turn                         │           │
│   │ • Sees opponent's actions animated in real-time             │           │
│   └─────────────────────────────────────────────────────────────┘           │
│                                                                              │
│   enemy:                                                                    │
│   ┌─────────────────────────────────────────────────────────────┐           │
│   │ • AI calculates action on server                            │           │
│   │ • Brief delay before action for readability                 │           │
│   │ • Action intent broadcast before execution                  │           │
│   │ • No timeout (instant decision)                             │           │
│   │ • AI archetype determines behavior (aggressive, defensive)  │           │
│   └─────────────────────────────────────────────────────────────┘           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 8.3 Unit Data Structure

```javascript
{
  id: "char_1",              // Unique identifier
  type: "player_local",      // Unit type
  name: "Hero",              // Display name
  class: "warrior",          // Class/role
  level: 15,                 // Character level

  // Position
  tileX: 3,
  tileY: 5,

  // Stats
  hp: 180,
  maxHp: 200,
  mp: 45,
  maxMp: 60,
  agility: 18,

  // CT System
  ct: 72,                    // Current charge time

  // Turn State
  moveUsed: true,
  actUsed: false,

  // Status
  statusEffects: [
    { type: "attack_up", duration: 2 }
  ]
}
```

---

## 9. WebSocket Protocol

### 9.1 Battle Room Subscription

```javascript
// Join battle room
{
  "type": "join_room",
  "payload": {
    "room": "battle:123"
  }
}

// Response
{
  "type": "room_joined",
  "payload": {
    "room": "battle:123",
    "battleState": { ... }
  }
}
```

### 9.2 Turn-Related Messages

#### Turn Start
```json
{
  "type": "battle:turn_start",
  "payload": {
    "unitId": "char_1",
    "unitType": "player_local",
    "unitName": "Hero",
    "turnNumber": 15,
    "timeRemaining": 60,
    "availableActions": {
      "canMove": true,
      "canAct": true,
      "canWait": true
    },
    "turnOrder": [
      { "unitId": "enemy_2", "estimatedTicks": 3 },
      { "unitId": "char_3", "estimatedTicks": 5 }
    ]
  }
}
```

#### Action Intent (Enemy)
```json
{
  "type": "battle:action_intent",
  "payload": {
    "unitId": "enemy_1",
    "actionType": "attack",
    "targetId": "char_2",
    "targetPosition": { "x": 4, "y": 3 }
  }
}
```

#### Action Result
```json
{
  "type": "battle:action_result",
  "payload": {
    "unitId": "char_1",
    "action": {
      "type": "skill",
      "skillId": "warrior_bash",
      "targetId": "enemy_1"
    },
    "result": {
      "success": true,
      "damage": 125,
      "critical": false,
      "effectsApplied": ["stun"]
    },
    "unitStates": {
      "enemy_1": {
        "hp": 25,
        "maxHp": 150,
        "statusEffects": [
          { "type": "stun", "duration": 1 }
        ]
      }
    },
    "turnState": {
      "moveUsed": true,
      "actUsed": true,
      "turnComplete": true
    }
  }
}
```

#### Turn Timer Warning
```json
{
  "type": "battle:turn_warning",
  "payload": {
    "unitId": "char_1",
    "secondsRemaining": 10,
    "urgent": false
  }
}
```

#### Turn End
```json
{
  "type": "battle:turn_end",
  "payload": {
    "unitId": "char_1",
    "turnNumber": 15,
    "nextTurnPrediction": {
      "unitId": "enemy_2",
      "estimatedDelay": 0
    }
  }
}
```

### 9.3 Battle End Messages

```json
{
  "type": "battle:end",
  "payload": {
    "result": "victory",
    "turnCount": 23,
    "duration": 245000,
    "survivors": ["char_1", "char_3"],
    "rewards": {
      "xp": 450,
      "gold": 175,
      "items": [
        { "templateId": 101, "name": "Health Potion", "quantity": 1 }
      ]
    }
  }
}
```

---

## 10. Action Validation

### 10.1 Server-Side Validation

All actions are validated on the server before execution:

```javascript
function validateAction(unit, action) {
  // 1. Check if unit can act
  if (unit.hp <= 0) return { valid: false, error: 'Unit is defeated' };
  if (unit.id !== battle.activeUnitId) return { valid: false, error: 'Not this unit\'s turn' };

  // 2. Check status effects
  if (hasEffect(unit, 'stun') || hasEffect(unit, 'freeze')) {
    return { valid: false, error: 'Unit cannot act' };
  }

  // 3. Validate action type
  switch (action.type) {
    case 'move':
      if (unit.moveUsed) return { valid: false, error: 'Already moved this turn' };
      if (hasEffect(unit, 'root')) return { valid: false, error: 'Unit is rooted' };
      if (!isValidMoveTarget(unit, action.targetTile)) {
        return { valid: false, error: 'Invalid move target' };
      }
      break;

    case 'attack':
    case 'skill':
    case 'item':
      if (unit.actUsed) return { valid: false, error: 'Already acted this turn' };
      if (action.type === 'skill' && hasEffect(unit, 'silence')) {
        return { valid: false, error: 'Unit is silenced' };
      }
      // ... additional validation
      break;

    case 'wait':
      // Always valid
      break;

    default:
      return { valid: false, error: 'Unknown action type' };
  }

  return { valid: true };
}
```

### 10.2 Validation Error Response

```json
{
  "type": "battle:action_error",
  "payload": {
    "error": "Invalid move target",
    "code": "INVALID_TARGET",
    "action": {
      "type": "move",
      "targetTile": { "x": 5, "y": 3 }
    }
  }
}
```

---

## 11. Integration Points

### 11.1 Related Systems

| System | Integration |
|--------|-------------|
| BattleService | Damage calculation, status effects |
| BattlePathfinding | Movement validation, range calculation |
| BattleAI | Enemy decision making |
| BattleAnimations | Client-side visual feedback |
| BattleGrid | Tile validation, unit positioning |

### 11.2 API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /api/battle/action` | Submit player action |
| `GET /api/battle/current` | Get current battle state |
| `WebSocket battle:*` | Real-time turn updates |

### 11.3 Database Updates

Turn actions update the `battle_state` JSONB column:

```sql
UPDATE battles
SET battle_state = jsonb_set(
  battle_state,
  '{turnState}',
  $1::jsonb
)
WHERE id = $2;
```

---

## 12. Related Documents

| Document | Description |
|----------|-------------|
| [GAME_DESIGN.md](GAME_DESIGN.md) | Combat formulas, status effects, action system |
| [API_SPECIFICATION.md](API_SPECIFICATION.md) | Battle endpoints and WebSocket protocol |
| [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md) | Database schemas, battle_state structure |
| [ENEMY_SYSTEM.md](ENEMY_SYSTEM.md) | AI archetypes, enemy behavior |
| [BATTLE_MODES.md](BATTLE_MODES.md) | PvE/PvP mode configurations, matchmaking, rewards |

---

## 13. Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Jan 2026 | - | Initial document: CT system, turn state machine, WebSocket protocol |
