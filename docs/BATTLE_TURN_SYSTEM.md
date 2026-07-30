# Modia - Battle Turn System

## Document Information

| Field | Value |
|-------|-------|
| Project Name | Modia |
| Version | 1.3 |
| Last Updated | July 2026 |
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
| Starting CT | `(AGI/2) + random(0,20)` | Faster units start with head start + variance |
| CT After Acting | `CT - 100` | CT carries over (not reset to 0) |

### 2.2 CT Accumulation Formula

The CT system uses **diminishing returns** to prevent high-agility units from completely dominating turn order. Doubling AGI does not double turn frequency.

```
CT_gain_per_tick = CT_BASE_GAIN + (AGI / CT_AGI_DIVISOR)
                 = 5 + (AGI / 10)

ticks_to_first_action = ceil(100 / CT_gain_per_tick)
```

**Constants (from `shared/battleMath.js`):**

| Constant | Value | Purpose |
|----------|-------|---------|
| `CT_THRESHOLD` | 100 | Unit acts when CT >= 100 |
| `CT_BASE_GAIN` | 5 | Minimum CT gain per tick |
| `CT_AGI_DIVISOR` | 10 | Agility scaling factor |

**Example Calculations:**

| Unit | AGI | CT/Tick | Ticks to Act | Relative Speed |
|------|-----|---------|--------------|----------------|
| Fast Monk | 50 | 10 | 10 | 1.67x |
| Normal Warrior | 20 | 7 | 15 | 1.17x |
| Slow Wizard | 10 | 6 | 17 | 1.0x (baseline) |
| Tank Knight | 5 | 5.5 | 19 | 0.92x |

**Design Rationale:**
- A unit with 50 AGI (10 CT/tick) is only 1.67x faster than a unit with 10 AGI (6 CT/tick)
- Without diminishing returns, 50 AGI would be 5x faster, making speed builds mandatory
- The base gain of 5 ensures even slow units get turns reasonably often

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
│      └── NO ───▶ Add (5 + AGI/10) to each unit's CT            │
│                  │                                              │
│                  ▼                                              │
│                  Repeat from step 1                             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.4 CT Modification Effects

Some abilities and status effects modify CT gain (implemented in `calculateCTGain()` in `shared/battleMath.js`). See [STATUS_EFFECTS.md](STATUS_EFFECTS.md) for full movement and CT modifier details.

| Effect | CT Modification | Implementation |
|--------|-----------------|----------------|
| Haste | +50% CT gain | `ctGain *= 1.5` |
| Slow | -50% CT gain | `ctGain *= 0.5` |
| Delay (skill) | -50 CT | Cannot reduce below 0 |
| Quick (skill) | +25 CT | Cannot exceed threshold |
| Stun | Skip turn, CT = 0 | Lose accumulated CT |

**Example with Haste/Slow:**
- Unit with 20 AGI: base CT gain = 5 + (20/10) = 7/tick
- With Haste: 7 * 1.5 = 10.5/tick
- With Slow: 7 * 0.5 = 3.5/tick

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
ct_gain = 5 + (unit.agility / 10)  // With haste/slow modifiers
ticks_until_action = ceil((100 - unit.ct) / ct_gain)
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

> For the full status effect taxonomy including cleansing, stacking, and resistance mechanics, see [STATUS_EFFECTS.md](STATUS_EFFECTS.md).

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

## 11. Two-Action Turn State Machine

### 11.1 Turn State Tracking

Each unit tracks turn state with the following properties:

```javascript
{
  moveUsed: false,    // Has movement action been used
  actUsed: false,     // Has act (attack/skill/item) been used
  turnPhase: 'ready', // Current turn phase: 'ready' | 'partial' | 'done'
  hasActed: false     // Legacy compatibility flag
}
```

**Reference:** `api/src/services/battle/statusEffectManager.js:96-101` (`resetTurnState`)

### 11.2 Turn Phase States

| Phase | Description | Transitions From | Transitions To |
|-------|-------------|------------------|----------------|
| `ready` | Turn just started, no actions taken | `done` (previous unit) | `partial`, `done` |
| `partial` | One action used, one remaining | `ready` | `done` |
| `done` | Both actions used or wait chosen | `ready`, `partial` | `ready` (next unit) |

### 11.3 State Transition Logic

```
                          ┌──────────────────────────────────────────────────┐
                          │                   READY                           │
                          │  moveUsed=false, actUsed=false                   │
                          └─────────────────────┬────────────────────────────┘
                                                │
                    ┌───────────────────────────┼───────────────────────────┐
                    │                           │                           │
                    ▼                           ▼                           ▼
          ┌─────────────────┐        ┌─────────────────┐        ┌─────────────────┐
          │ MOVE action     │        │ ACT action      │        │ WAIT action     │
          │ (moveUsed=true) │        │ (actUsed=true)  │        │                 │
          └────────┬────────┘        └────────┬────────┘        └────────┬────────┘
                   │                          │                          │
                   ▼                          ▼                          │
          ┌─────────────────────────────────────────────┐                │
          │                   PARTIAL                    │                │
          │  One action used, can still:                │                │
          │  - ACT (if moveUsed) or MOVE (if actUsed)  │                │
          │  - WAIT to end turn early                   │                │
          └─────────────────────┬───────────────────────┘                │
                                │                                         │
                    ┌───────────┼───────────┐                            │
                    ▼           ▼           ▼                            │
              ┌──────────┐ ┌──────────┐ ┌──────────┐                     │
              │ ACT      │ │ MOVE     │ │ WAIT     │                     │
              │ (if avl) │ │ (if avl) │ │          │                     │
              └────┬─────┘ └────┬─────┘ └────┬─────┘                     │
                   │            │            │                           │
                   └────────────┴────────────┴───────────────────────────┘
                                             │
                                             ▼
                          ┌──────────────────────────────────────────────────┐
                          │                    DONE                           │
                          │  moveUsed=true, actUsed=true                     │
                          │  (or WAIT chosen to end early)                   │
                          └──────────────────────────────────────────────────┘
```

**Reference:** `api/src/services/battle/actionProcessor.js:794-800`

### 11.4 Auto-End Turn Conditions

Turn automatically ends when the unit cannot perform any remaining actions:

```javascript
function shouldAutoEndTurn(unit) {
  const canMove = canUnitMove(unit) && !unit.moveUsed;
  const canAct = canUnitAct(unit) && !unit.actUsed;
  return !canMove && !canAct;
}
```

**Reference:** `api/src/services/battle/statusEffectManager.js:106-110`

---

## 12. Pre-Battle Formation System

### 12.1 Overview

Before combat begins, players position their characters on a 5x4 isometric grid. This formation determines initial battle positions.

**Reference:** `frontend/src/scenes/BattleFormationScene.js`

### 12.2 Formation Grid

| Property | Value | Description |
|----------|-------|-------------|
| Grid Width | 5 tiles | Horizontal placement slots |
| Grid Height | 4 tiles | Vertical placement slots |
| Max Characters | 5 | Maximum units in battle party |
| Placement Order | FIFO | Oldest placement removed if exceeding 5 |

### 12.3 Formation Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       Pre-Battle Formation Flow                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. Player enters node that triggers battle                                 │
│     │                                                                        │
│     ▼                                                                        │
│  2. BattleFormationScene loads                                              │
│     ├── Load party characters (slots 1-12, sorted by level)                 │
│     ├── Load enemy preview data                                             │
│     └── Initialize themed grid (based on node type or battle type)          │
│     │                                                                        │
│     ▼                                                                        │
│  3. Player places characters on grid                                        │
│     ├── Click empty tile: Place next unplaced character                     │
│     ├── Click occupied tile: Cycle to next character                        │
│     └── Long press: Remove character from tile                              │
│     │                                                                        │
│     ▼                                                                        │
│  4. Player clicks "Start Battle"                                            │
│     │                                                                        │
│     ▼                                                                        │
│  5. Formation sent to server                                                │
│     {                                                                        │
│       "formation": {                                                         │
│         "charId1": { "tileX": 0, "tileY": 0 },                              │
│         "charId2": { "tileX": 1, "tileY": 2 },                              │
│         ...                                                                  │
│       }                                                                      │
│     }                                                                        │
│     │                                                                        │
│     ▼                                                                        │
│  6. Server initializes battle with player positions                         │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 12.4 Battle Context Themes

| Battle Type | Theme Class | Visual Style |
|-------------|-------------|--------------|
| Standard PvE | `BattlefieldTheme` | Node-type based (forest, cave, etc.) |
| Coliseum PvP | `PitFighterTheme` | Arena combat style |
| Guild Wizard | `ArcaneChamberTheme` | Magical arcane chamber |
| Guild Warrior | `ArmoryTheme` | Military armory |
| Guild Monk | `DojoTheme` | Martial arts dojo |
| Guild Chemist | `ClockworkTheme` | Mechanical clockwork |

**Reference:** `frontend/src/scenes/BattleFormationScene.js:184-207`

---

## 13. Zodiac Signature Abilities

### 13.1 Overview

Units can gain temporary zodiac buffs by visiting Zodiac Shrine nodes on the world map. These buffs grant signature abilities usable once per battle.

**Reference:** `api/src/services/battle/statusEffectManager.js:144-563`

### 13.2 All Zodiac Abilities

| Zodiac | Ability Name | Effect | Targeting |
|--------|--------------|--------|-----------|
| Aries | Ram's Charge | +25 percentage points of crit chance on next basic attack | Self |
| Taurus | Unmovable | Immune to push/pull effects (battle-long) | Self |
| Gemini | Twin Strike | Next attack hits twice at 60% damage | Self |
| Cancer | Moonshield | Block next instance of damage | Self |
| Leo | Roar | Adjacent enemies lose 30 CT | AoE (range 1) |
| Virgo | Purify | Remove 1 debuff from self | Self |
| Libra | Balance | Next attack heals for damage dealt | Self |
| Scorpio | Venom Sting | Apply 3% HP poison for 4 turns | Target (attack range) |
| Sagittarius | Celestial Arrow | +2 range on next attack | Self |
| Capricorn | Mountain's Endurance | +25% physical and magical defense for 2 turns | Self |
| Aquarius | Cascade | Heal self for 20% of max HP | Self |
| Pisces | Dreamwave | 50% chance to sleep target 1 turn | Target (attack range) |

**Reference:** `shared/constants.js:209-294` (`ZODIAC_SHRINE_BUFFS`)

### 13.3 Ability Usage Rules

- Each active ability can only be used **once per battle across the owning
  party**, not once per character
- Usage is persisted in the battle snapshot via each owning unit's
  `usedZodiacAbilities` array
- A new battle receives a fresh use while the four-hour world blessing remains
  active
- Abilities require the unit to have the zodiac buff active (`unit.zodiacAbilities`)
- Buff duration on world map: 4 hours (does not decrement in battle)
- A signature is a free action: it does not consume MOVE or ACT and may be used
  after the unit's normal action
- Only the authoritative active character may activate a signature; it cannot
  interrupt another unit's turn
- Venom Sting and Dreamwave require a living opposing target in the source
  unit's current basic-attack range. Failed validation does not consume the use
- In PvP, each account has its own once-per-battle use
- Activation uses a durable command ID plus base state revision. Exact retries
  replay the stored outcome; random effects are not rerolled and presentation
  is emitted only for the winning commit

### 13.4 Ability Application Flow

```javascript
// Example: Applying Moonshield
applyZodiacAbility(battleState, sourceUnit, 'moonshield');

// Result:
{
  success: true,
  message: 'Moonshield activated! Next damage instance will be blocked.',
  effects: [{
    type: 'buff',
    target: 'self',
    effect: 'damage_shield',
    value: 1
  }],
  abilityKey: 'moonshield'
}
```

### 13.5 Special Mechanics

**Next-basic-attack effects:**

- Ram's Charge adds 25 percentage points to the next basic attack's critical
  rolls.
- Twin Strike changes the next basic attack into two independent 60%-damage
  hits.
- Balance heals for the actual HP damage dealt by that basic attack, including
  the target's healing-received crystal modifier.
- Celestial Arrow adds two tiles of range to the next basic attack.
- These effects are consumed by a valid basic-attack attempt, including a miss
  or an empty-tile swing. Invalid input does not consume them, and skills never
  consume them.

**Damage and duration mechanics:**

- Moonshield blocks and consumes itself on exactly the next positive damage
  instance. A hit in a multi-hit skill, an area hit, poison, and burn are each
  separate instances; later hits resolve normally.
- Venom Sting deals 3% of maximum HP at the start of each of the target's next
  four owner turns. Purify can remove it.
- Dreamwave sleep with duration one remains restrictive for the target's full
  owner turn, then expires at turn end.
- Mountain's Endurance raises both physical and magical defense by 25% for two
  full owner turns.
- Turn-start damage can defeat a unit. Defeated actors are skipped, and a
  last-team defeat enters the normal authoritative battle-completion flow
  without granting an extra turn.

---

## 14. Boss Phase Mechanics

### 14.1 Overview

Boss enemies can have multiple phases that trigger at HP thresholds. Transitioning phases can unlock new abilities, modify stats, and trigger special effects.

**Reference:** `api/src/services/bossService.js`

### 14.2 Boss Detection

```javascript
function isBoss(template) {
  return template.is_boss === true && template.phases && template.phases.length > 0;
}
```

### 14.3 Phase Configuration

Bosses define phases in their enemy template:

```javascript
{
  name: "Ancient Dragon",
  is_boss: true,
  phases: [
    {
      name: "Phase 1",
      threshold: 1.0,  // Active at 100% HP
      abilities: ['dragon_breath'],
      statMods: {}
    },
    {
      name: "Enraged",
      threshold: 0.5,  // Triggers at 50% HP
      abilities: ['dragon_breath', 'tail_swipe', 'inferno'],
      statMods: { attack: 1.3, agility: 1.2 },
      onEnter: {
        effect: 'rage',
        duration: 3,
        summon: 'dragon_whelp',
        count: 2
      }
    },
    {
      name: "Desperate",
      threshold: 0.2,  // Triggers at 20% HP
      abilities: ['dragon_breath', 'tail_swipe', 'inferno', 'apocalypse'],
      statMods: { attack: 1.5, defense: 0.8, agility: 1.5 },
      onEnter: {
        aura: 'fire_aura',
        damagePerTurn: 15
      }
    }
  ]
}
```

### 14.4 Phase Transition Effects

| Effect Type | Description | Example |
|-------------|-------------|---------|
| `statMods` | Multiply base stats | `{ attack: 1.3 }` = +30% attack |
| `abilities` | Unlock new skills | New skill added to boss.skills array |
| `onEnter.effect` | Apply status buff | Rage, fortify, haste |
| `onEnter.summon` | Spawn additional enemies | `{ summon: 'minion', count: 2 }` |
| `onEnter.aura` | Persistent damage aura | Deals damage to all enemies each boss turn |

**Reference:** `api/src/services/bossService.js:104-201`

### 14.5 Boss State Persistence

Boss phase state is persisted in the database for reconnection support:

```sql
CREATE TABLE boss_encounters (
  battle_id INT REFERENCES battles(id),
  enemy_template_id INT,
  unit_id VARCHAR(50),
  current_phase INT DEFAULT 1,
  max_phases INT,
  phase_triggered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (battle_id, unit_id)
);
```

---

## 15. Trait System Combat Modifiers

### 15.1 Overview

Traits are innate bonuses that guild recruits can have. In battle, traits modify damage, stats, and provide special effects at specific phases.

**Reference:** `api/src/services/traitService.js`, `api/src/services/traits/`

### 15.2 Effect Phases

| Phase | When Applied | Example Effects |
|-------|--------------|-----------------|
| `BATTLE_START` | Unit enters battle | HP bonus, movement bonus, range bonus |
| `ON_DAMAGE_DEALT` | Calculating outgoing damage | Physical/magic damage bonus |
| `ON_DAMAGE_RECEIVED` | Calculating incoming damage | Resistance, damage reduction |
| `ON_TURN_START` | Start of unit's turn | HP regeneration |
| `ON_ATTACK` | During attack rolls | Accuracy bonus, crit chance |
| `ON_DEATH` | Unit would die | Death save (survive with 1 HP) |
| `ON_REWARD` | Battle victory | XP/gold bonuses |

**Reference:** `api/src/services/traits/traitEffectRegistry.js:16-40`

### 15.3 Damage Modifier Traits

| Effect Type | Phase | Description |
|-------------|-------|-------------|
| `physical_damage_bonus` | ON_DAMAGE_DEALT | +X% to physical attacks |
| `magic_damage_bonus` | ON_DAMAGE_DEALT | +X% to magical attacks |
| `all_damage_bonus` | ON_DAMAGE_DEALT | +X% to all damage |
| `critical_damage_bonus` | ON_DAMAGE_DEALT | +X% on critical hits |
| `low_hp_damage_bonus` | ON_DAMAGE_DEALT | +X% when below 30% HP |
| `dragon_damage_bonus` | ON_DAMAGE_DEALT | +X% vs dragon enemies |
| `undead_damage_bonus` | ON_DAMAGE_DEALT | +X% vs undead enemies |
| `demon_damage_bonus` | ON_DAMAGE_DEALT | +X% vs demon enemies |
| `boss_damage_bonus` | ON_DAMAGE_DEALT | +X% vs boss enemies |

**Reference:** `api/src/services/traits/effects/damageEffects.js`

### 15.4 Defense Modifier Traits

| Effect Type | Phase | Description |
|-------------|-------|-------------|
| `physical_resistance` | ON_DAMAGE_RECEIVED | -X% physical damage taken |
| `magic_resistance` | ON_DAMAGE_RECEIVED | -X% magical damage taken |
| `all_resistance` | ON_DAMAGE_RECEIVED | -X% all damage taken (min 10%) |

**Reference:** `api/src/services/traits/effects/defenseEffects.js`

### 15.5 Combat Roll Modifier Traits

| Effect Type | Phase | Description |
|-------------|-------|-------------|
| `accuracy_bonus` | ON_ATTACK | +X% hit chance |
| `evasion_bonus` | ON_DAMAGE_RECEIVED | +X% dodge chance |
| `crit_chance_bonus` | ON_ATTACK | +X% critical hit chance |
| `luck_effectiveness` | ON_ATTACK | Multiplier on luck-based rolls |
| `mp_cost_reduction` | ON_ATTACK | -X% MP cost for skills |

**Reference:** `api/src/services/traits/effects/combatModifierEffects.js`

### 15.6 Special Traits

| Effect Type | Phase | Description |
|-------------|-------|-------------|
| `hp_bonus` | BATTLE_START | +X% max HP |
| `mp_bonus` | BATTLE_START | +X% max MP |
| `movement_bonus` | BATTLE_START | +X movement tiles |
| `range_bonus` | BATTLE_START | +X attack range tiles |
| `initiative_bonus` | BATTLE_START | +X% starting CT |
| `hp_regen_percent` | ON_TURN_START | Heal X% max HP per turn |
| `lifesteal` | ON_DAMAGE_DEALT | Heal X% of damage dealt |
| `death_save` | ON_DEATH | Survive fatal blow with 1 HP (once) |
| `xp_bonus` | ON_REWARD | +X% experience gained |
| `gold_bonus` | ON_REWARD | +X% gold gained |

### 15.7 Trait Application at Battle Start

```javascript
function applyBattleStartTraits(unit) {
  // Uses modular trait registry
  const results = applyEffectsForPhase(unit, EFFECT_PHASES.BATTLE_START);

  // Example applied effects:
  // - HP bonus: unit.maxHp += Math.floor(unit.maxHp * 0.10)
  // - Movement: unit.movement += 1
  // - Range: unit.attackRange += 1
}
```

**Reference:** `api/src/services/traitService.js:415-467`

---

## 16. Integration Points

### 16.1 Related Systems

| System | Integration |
|--------|-------------|
| BattleService | Damage calculation, status effects |
| BattlePathfinding | Movement validation, range calculation |
| BattleAI | Enemy decision making |
| BattleAnimations | Client-side visual feedback |
| BattleGrid | Tile validation, unit positioning |

### 16.2 API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /api/battle/action` | Submit player action |
| `GET /api/battle/current` | Get current battle state |
| `WebSocket battle:*` | Real-time turn updates |

### 16.3 Database Updates

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

## 17. Related Documents

| Document | Description |
|----------|-------------|
| [GAME_DESIGN.md](GAME_DESIGN.md) | Combat formulas, status effects, action system |
| [API_SPECIFICATION.md](API_SPECIFICATION.md) | Battle endpoints and WebSocket protocol |
| [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md) | Database schemas, battle_state structure |
| [ENEMY_SYSTEM.md](ENEMY_SYSTEM.md) | AI archetypes, enemy behavior |
| [BATTLE_MODES.md](BATTLE_MODES.md) | PvE/PvP mode configurations, matchmaking, rewards |

---

## 18. Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.3 | Jul 2026 | - | Completed Zodiac signature execution, targeting, once-per-party battle use, next-attack effects, full-turn status durations, and terminal turn-start damage handling. |
| 1.2 | Jan 2026 | - | Added sections 11-15: Two-action state machine, formation system, zodiac abilities, boss phases, trait modifiers |
| 1.1 | Jan 2026 | - | Fixed CT formula: documented diminishing returns formula `5 + (AGI/10)`, updated initial CT formula, corrected haste/slow modifiers |
| 1.0 | Jan 2026 | - | Initial document: CT system, turn state machine, WebSocket protocol |
