# Modia Game Mechanics Improvements Document

> **ARCHIVED:** January 2026 - Roadmap Audit v8.0
>
> This document has been consolidated into `docs/ROADMAP_GAMEPLAY.md`:
> - Battle balance items → Section 2.4 Battle Balance
> - Economy balance items → Section 3.4 Gold Sinks
> - PvP System → Marked as FIXED (v7.0)
> - Skill cooldowns → Marked as FIXED (implemented in battle.js)
> - Quest system → COMPLETE (Section 1.1)
>
> Retained for historical reference of original improvement suggestions.

---

This document contains suggestions for improving game balance, progression systems, economy, content, and multiplayer features based on a comprehensive analysis of the codebase.

## Table of Contents

1. [Battle System Balance](#1-battle-system-balance)
2. [Progression Systems](#2-progression-systems)
3. [Economy Balance](#3-economy-balance)
4. [Content & World](#4-content--world)
5. [Multiplayer Features](#5-multiplayer-features)
6. [Priority Implementation List](#6-priority-implementation-list)

---

## 1. Battle System Balance

### 1.1 CT-Based Turn System

#### Current Implementation
- CT (Charge Time) system determines turn order
- Agility stat directly influences CT gain
- Located in `api/src/services/battleService.js`

#### Issue: Agility Dominance
At high levels, agility differences create extreme turn imbalance:
- Level 50 Ninja: ~100+ AGI = 2-3 turns before others act
- Level 50 Wizard: ~59 AGI = significantly fewer turns

#### Recommended Fix: Diminishing Returns
```javascript
// battleService.js - getCTGain function
function getEffectiveAgility(agi) {
  // Full value up to 50, diminishing returns above
  if (agi <= 50) return agi;
  return 50 + Math.sqrt(agi - 50) * 5;
}

function getCTGain(unit) {
  const baseGain = 10;
  const agiBonus = getEffectiveAgility(unit.agility) * 0.2;
  return baseGain + agiBonus;
}
```

**Impact:** High
**Complexity:** Simple

### 1.2 Damage Formula

#### Current Physical Damage
```javascript
damage = (STR + equipment) * skillPower - (VIT + defense) * 0.15
```

#### Issue: Linear Defense Scaling
At high levels, defense becomes negligible:
- 150 STR * 3.0 skill power = 450 raw damage
- 50 VIT * 0.15 = 7.5 reduction (1.6%)

#### Recommended Fix: Percentage-Based Reduction
```javascript
function calculateDamage(attacker, defender, skillPower = 100) {
  const rawDamage = (attacker.strength + attacker.attack) * (skillPower / 100);
  const defense = defender.vitality + defender.defense;

  // Asymptotic reduction: approaches 75% max at very high defense
  const reductionPercent = defense / (defense + 100);
  const maxReduction = 0.75;
  const actualReduction = Math.min(reductionPercent, maxReduction);

  return Math.max(1, Math.floor(rawDamage * (1 - actualReduction)));
}
```

**Impact:** High
**Complexity:** Simple

### 1.3 Status Effects

#### Currently Implemented
- Poison, Burn, Regen (DoT/HoT)
- Blind, Slow, Haste (stat modifiers)
- Stun, Silence (action prevention)

#### Missing from Documentation
- Vulnerability (increased damage taken)
- Weakness (reduced damage dealt)
- Attack Up/Down
- Defense Up/Down

#### Recommendation: Add Resistance System
```javascript
const STATUS_RESISTANCE = {
  // Base resistance by stat
  poison: (unit) => unit.vitality * 0.5,
  burn: (unit) => unit.vitality * 0.3,
  blind: (unit) => unit.luck * 0.4,
  silence: (unit) => unit.intelligence * 0.3,
  stun: (unit) => unit.vitality * 0.4,
  slow: (unit) => unit.agility * 0.3
};

function rollStatusApplication(target, effect, baseChance) {
  const resistance = (STATUS_RESISTANCE[effect]?.(target) || 0) / 100;
  const finalChance = baseChance * (1 - resistance);
  return Math.random() < finalChance;
}
```

**Impact:** Medium
**Complexity:** Moderate

### 1.4 Skill Cooldowns (FIXED)

**Status:** IMPLEMENTED in `api/src/routes/battle.js`

The skill cooldown system is now enforced server-side:
- `unit.skillCooldowns` object tracks remaining cooldown per skill
- Server validates cooldown before allowing skill use
- Cooldowns decrement when the unit's turn ends (in `advanceToNextActorWithCT`)
- Applies to all skill types (self-buff, ally heal, damage skills)

### 1.5 Enemy AI

#### Current Implementation (aiService.js)
5 of 7 documented archetypes implemented:
- Aggressive (rush to attack)
- Defensive (hold position)
- Ranged (maintain distance)
- Support (heal allies)
- Tank (protect allies)

#### Missing Archetypes
- **Hit-and-Run:** Attack then retreat
- **Ambush:** Wait for opportunity, burst damage

#### Critical Gap: Enemy Abilities Not Executing
Enemy templates have ability definitions, but the execution code is missing.

```javascript
// Enemy template has abilities
const goblin = {
  abilities: [{ id: 'slash', power: 100, chance: 0.5 }]
};

// AI decides to use ability, but processAction doesn't handle enemy skills
// Currently enemies only basic attack
```

#### Recommended Fix
Add enemy ability execution in `processAction`:
```javascript
case 'skill':
  if (unit.type === 'enemy') {
    // Look up enemy ability from template
    const ability = unit.abilities?.find(a => a.id === skillId);
    if (ability) {
      // Apply ability effects
      const damage = calculateDamage(unit, target, ability.power);
      // ...
    }
  }
```

**Impact:** High
**Complexity:** Moderate

---

## 2. Progression Systems

### 2.1 Class Advancement

#### Current State
- Placeholder level check at level 20
- No actual advancement quest system

#### Recommended Design
Class advancement should be quest-based with varied requirements:

```javascript
const ADVANCEMENT_REQUIREMENTS = {
  warrior_to_berserker: {
    level: 20,
    questChain: 'berserker_trials',
    achievements: ['kill_100_enemies', 'critical_kills_50'],
    items: [{ itemId: 'berserker_emblem', quantity: 1 }],
    skills: [{ skillId: 'heavy_strike', level: 5 }]
  },
  wizard_to_sorcerer: {
    level: 20,
    questChain: 'arcane_mastery',
    achievements: ['cast_1000_spells', 'elemental_mastery'],
    items: [{ itemId: 'arcane_crystal', quantity: 5 }],
    skills: [{ skillId: 'fireball', level: 5 }]
  }
  // ... etc
};
```

Character becomes unavailable during advancement period (adds weight to decision).

**Impact:** High
**Complexity:** High (new system)

### 2.2 Skill Trees

#### Current Implementation
- 4 base classes, 4 advanced classes
- 3 branches per class, ~10 skills per branch
- Skill XP system for advancement

#### Balance Analysis
- XP costs seem reasonable (~59,500 total to max one skill tree)
- Some skills may be underpowered compared to basic attacks

#### Recommendations
1. Add passive skill effects that scale with level
2. Create skill synergies within branches
3. Add "ultimate" skills at end of branches

### 2.3 Equipment Progression

#### Current Implementation
- 6 material tiers implemented
- Basic stat bonuses

#### Documentation Plans (Not Implemented)
- 12 material tiers total
- Set bonuses
- Advanced augmentation system

#### Recommended Priority
1. Complete remaining material tiers (7-12)
2. Add set bonuses for matching equipment
3. Implement augmentation at blacksmiths

---

## 3. Economy Balance

### 3.1 Gold Generation (Faucets)

#### Current Sources
- PvE battles: 30-250g base (scales with difficulty)
- NPC shop selling: 50% of base price
- Quest rewards (when implemented)

#### Analysis
Early game feels fine, but mid-late game may accumulate too quickly.

### 3.2 Gold Sinks (Missing)

#### Current Sinks
- NPC shop buying (with supply-based pricing)
- Marketplace purchases (transfers, not sink)

#### Issue
Once players have gear, there are limited ongoing gold sinks.

#### Recommended New Sinks
| Feature | Cost Range | Notes |
|---------|------------|-------|
| Fast travel | 50-500g | Based on distance |
| Equipment repair | 10-20% of item value | Durability system |
| Skill respec | 1000-5000g | One-time per respec |
| Guild upgrades | 10000g+ | Persistent benefits |
| Auction house fee | 5% of sale | Gold sink from trades |

### 3.3 Marketplace Improvements

#### Current System
- Order book with limit/market orders
- No transaction fees
- Good escrow system

#### Recommendations
1. **Add transaction fee** (5% seller fee) as gold sink
2. **Price history tracking** for market analysis
3. **Anti-manipulation:** Max deviation from recent trades
4. **Minimum trade volume** for price statistics

---

## 4. Content & World

### 4.1 Node Types

#### Currently Implemented (9 types)
- Castle, City, Village (settlements)
- Forest, Cave, Mountain, Bridge (battle zones)
- Guild (skill training)
- Palace (end-game)

#### Recommended Additions
| Node Type | Purpose |
|-----------|---------|
| Dungeon | Multi-floor instances |
| Raid | Group boss content |
| Arena | PvP battles |
| Crafting Station | Item creation |
| Guild Hall | Guild headquarters |

### 4.2 Encounter Design

#### Current System
- Random enemy selection per terrain
- Level scaling to party
- Random positions

#### Issues
- Encounters can feel repetitive
- No themed compositions
- No mini-boss encounters

#### Recommendations
```javascript
const ENCOUNTER_TEMPLATES = {
  goblin_camp: {
    terrain: ['forest', 'cave'],
    enemies: [
      { type: 'goblin', count: [3, 5] },
      { type: 'goblin_shaman', count: [0, 1] } // Healer
    ],
    formation: 'defensive', // Positions enemies strategically
    minLevel: 5
  },
  dragon_lair: {
    terrain: ['cave', 'mountain'],
    enemies: [
      { type: 'dragon', count: 1 },
      { type: 'kobold', count: [2, 4] }
    ],
    formation: 'boss', // Dragon in back, minions in front
    minLevel: 30,
    isBoss: true
  }
};
```

### 4.3 Procedural Generation

#### Current System
- `SeededRandom` for deterministic world generation
- Same seed = same world layout

#### Recommendations
1. Add region variety (biomes)
2. Implement dungeon generation
3. Add seasonal/event content

---

## 5. Multiplayer Features

### 5.1 PvP System (FIXED)

**Status:** IMPLEMENTED in `api/src/services/coliseumService.js`

The PvP battle creation system is now fully functional:
- `startMatch()` function creates actual battles in the database
- Both players' battle parties are loaded with equipment stats and skills
- Players are placed on opposite sides of the map (player1 bottom, player2 top)
- Battle record includes both `player1_id` and `player2_id`
- Characters are marked as `in_battle` for both players
- Both players join the battle WebSocket room
- Proper error handling with match cancellation on failure

### 5.2 Matchmaking

#### Current System
- Simple queue: first two players matched
- No skill-based matching

#### Recommended Improvements
```javascript
function findMatch(player, queue) {
  const playerRating = player.eloRating || 1000;
  const maxDiff = 200 + (player.waitTime * 10); // Expand range over time

  const match = queue.find(other => {
    const otherRating = other.eloRating || 1000;
    return Math.abs(playerRating - otherRating) <= maxDiff;
  });

  return match;
}
```

### 5.3 Social Features (Missing)

#### Current
- Tavern chat
- Party system (partially implemented)

#### Recommended Additions
| Feature | Priority | Complexity |
|---------|----------|------------|
| Friend list | High | Moderate |
| Leaderboards | High | Simple |
| Achievement sharing | Medium | Simple |
| Guild chat channels | Medium | Moderate |
| Player profiles | Low | Simple |

---

## 6. Priority Implementation List

### Critical (Fix First)

| Issue | Impact | Complexity | Status |
|-------|--------|------------|--------|
| PvP battle creation bug | Critical | Moderate | **FIXED** |
| Skill cooldowns not enforced | High | Simple | **FIXED** |
| Enemy abilities not executing | High | Moderate | PENDING |

### High Priority

| Issue | Impact | Complexity | Location |
|-------|--------|------------|----------|
| Defense scaling broken | High | Simple | `battleService.js` |
| Agility dominance | High | Simple | `battleService.js` |
| No economic gold sinks | Medium | Simple | Multiple |

### Medium Priority

| Issue | Impact | Complexity | Location |
|-------|--------|------------|----------|
| Missing status effects | Medium | Moderate | `battleService.js` |
| Missing AI archetypes | Medium | Moderate | `aiService.js` |
| Encounter variety | Medium | Moderate | `enemyService.js` |

### Low Priority (Enhancements)

| Feature | Impact | Complexity |
|---------|--------|------------|
| Set bonuses | Low | High |
| Skill synergies | Low | High |
| Advanced matchmaking | Low | Moderate |

---

## Implementation Notes

### Testing Recommendations

1. **Balance Testing**
   - Create test scenarios for damage formula changes
   - Test CT system with various agility values
   - Verify status effect application rates

2. **Economy Testing**
   - Track gold flow over simulated play sessions
   - Monitor marketplace activity
   - Verify gold sinks are effective

3. **PvP Testing**
   - Verify match creation works end-to-end
   - Test reconnection scenarios
   - Validate turn synchronization

### Backward Compatibility

When implementing balance changes:
1. Log formula changes for rollback capability
2. Consider gradual rollout with feature flags
3. Monitor player feedback and metrics
