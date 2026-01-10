# CT-Based Turn System Design

## Overview

Replace the current static turn order system with a Charge Time (CT) based system where unit speed (agility) determines turn frequency. Fast units act more often than slow units.

## Core Mechanics

### CT Accumulation

- Each unit has a `ct` field starting at 0
- CT threshold for acting: 100
- Each "tick", all alive units gain CT equal to their agility
- When CT >= 100, unit can act
- After acting, CT is reduced by 100 (not reset to 0, preserving overflow)

### Turn Resolution

1. Advance all units' CT by their agility until at least one unit has CT >= 100
2. If multiple units have CT >= 100, resolve by:
   - Highest CT value first
   - Tie-breaker: highest agility
   - Second tie-breaker: players before enemies
3. Acting unit's CT reduced by 100
4. If actor is enemy: AI decides and executes action, then repeat from step 1
5. If actor is player: wait for player input

### Example

Units: Wizard (25 AGI), Warrior (15 AGI), Goblin (10 AGI)

| Tick | Wizard CT | Warrior CT | Goblin CT | Action |
|------|-----------|------------|-----------|--------|
| 0 | 0 | 0 | 0 | - |
| 1 | 25 | 15 | 10 | - |
| 2 | 50 | 30 | 20 | - |
| 3 | 75 | 45 | 30 | - |
| 4 | 100 | 60 | 40 | Wizard acts, CT -> 0 |
| 5 | 25 | 75 | 50 | - |
| 6 | 50 | 90 | 60 | - |
| 7 | 75 | 105 | 70 | Warrior acts, CT -> 5 |

Result: Wizard acts ~2.5x as often as Goblin.

## Turn Prediction

Predict next 10 turns by simulating CT advancement without modifying actual state:

```javascript
function predictTurnOrder(units, currentCTs, count = 10) {
  const predictions = [];
  const simCT = { ...currentCTs };
  const aliveUnits = units.filter(u => u.hp > 0);

  while (predictions.length < count) {
    // Advance until someone can act
    while (!aliveUnits.some(u => simCT[u.id] >= 100)) {
      for (const unit of aliveUnits) {
        simCT[unit.id] += unit.agility;
      }
    }

    // Find actor (highest CT, then AGI, then player priority)
    const ready = aliveUnits.filter(u => simCT[u.id] >= 100);
    ready.sort((a, b) => {
      if (simCT[b.id] !== simCT[a.id]) return simCT[b.id] - simCT[a.id];
      if (b.agility !== a.agility) return b.agility - a.agility;
      return (a.type === 'player' ? 0 : 1) - (b.type === 'player' ? 0 : 1);
    });

    const actor = ready[0];
    predictions.push(actor);
    simCT[actor.id] -= 100;
  }

  return predictions;
}
```

## UI Changes

### Turn Order Panel

Current: Static list of all units, active unit highlighted

New: List of next 10 predicted turns, same unit can appear multiple times

```
Turn Order
┌─────────────┐
│ 1. ★ Wizard │  <- current turn
│ 2.   Warrior│
│ 3.   Wizard │  <- appears again (fast)
│ 4.   Goblin │
│ 5.   Wizard │
│ ...         │
└─────────────┘
```

## Files to Modify

1. **api/src/routes/battle.js**
   - Add `ct: 0` to initial unit state
   - Replace `advanceToNextUnit()` with CT-based `advanceToNextActor()`
   - Process one turn at a time (not batch enemy turns)
   - Include turn predictions in response

2. **api/src/services/battleService.js** (new functions)
   - `predictTurnOrder(state, count)` - predict next N turns
   - `getNextActor(state)` - find unit with highest CT >= 100

3. **frontend/public/src/battle/BattleUI.js**
   - Update `updateTurnOrder()` to display predictions array
   - Show turn numbers and repeat indicators
   - Scroll/highlight current turn

4. **frontend/public/src/scenes/BattleScene.js**
   - Handle new turn prediction data from server
   - Update UI with predictions after each action

## State Changes

### Battle State

```javascript
{
  turn: 1,                    // Global turn counter (optional, for display)
  activeUnitId: 'unit_1',     // ID of unit whose turn it is (replaces activeUnitIndex)
  units: [
    {
      id: 'unit_1',
      ct: 45,                 // NEW: current charge time
      agility: 15,
      // ... other fields
    }
  ],
  turnPredictions: [          // NEW: predicted next 10 turns
    { id: 'unit_2', name: 'Wizard' },
    { id: 'unit_1', name: 'Warrior' },
    // ...
  ]
}
```

## Migration

- Existing active battles: Initialize all units with `ct: 0` on first action
- No database schema changes needed (state is JSON)
