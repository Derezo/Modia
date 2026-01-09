# AI System Documentation

This document describes the advanced utility-based AI system for NPC decision making in Modia.

## Overview

The AI system provides sophisticated tactical decision making for enemy NPCs in battle. It uses utility-based scoring with multi-actor lookahead to produce intelligent, pattern-based behavior.

### Key Features

- **Utility-Based Scoring**: Actions are scored using weighted factors
- **Multi-Actor Lookahead**: Simulates 2-3 turns ahead, considering all characters
- **Pattern-Based Weights**: Different AI patterns (aggressive, defensive, tactical, etc.)
- **Unified Unit System**: Players and NPCs share the same BattleUnit abstraction
- **NPC Skill System**: Monster skill trees and guild skills for humanoid NPCs
- **Server-Authoritative Actions**: Server calculates and provides valid actions to client

## Architecture

```
api/src/services/
├── ai/                          # Utility AI module
│   ├── index.js                 # Module exports
│   ├── utilityAI.js             # Main coordinator class
│   ├── utilityFactors.js        # Factor calculation functions
│   ├── patternWeights.js        # Weight configurations
│   ├── stateEvaluator.js        # Board state evaluation
│   ├── actionGenerator.js       # Enumerate legal actions
│   ├── lookahead.js             # Multi-actor minimax
│   └── cache.js                 # Transposition table
├── aiService.js                 # Entry point (uses utility AI)
├── battleUnitFactory.js         # Unified unit creation
├── npcSkillService.js           # NPC skill generation
└── battleService.js             # Battle logic + available actions
```

## AI Decision Flow

```
1. Enemy turn begins
   ↓
2. aiService.decideTurnActions(enemy, battleState)
   ↓
3. UtilityAI.decideTurnActions()
   ↓
4. Lookahead.iterativeDeepening()
   - Simulates 2-3 rounds
   - Considers all actors (allies + enemies)
   - Alpha-beta pruning
   ↓
5. Returns best action with score
   ↓
6. Convert to legacy format
   ↓
7. Execute action
```

## Utility Factors

Each action is scored using these factors:

| Factor | Description | Range |
|--------|-------------|-------|
| `DAMAGE_DEALT` | Expected damage from action | 0-1000+ |
| `DAMAGE_RECEIVED` | Expected incoming damage at position | 0-1000+ |
| `KILL_POTENTIAL` | Bonus for lethal actions | 0-2+ |
| `POSITION_QUALITY` | Tactical value of position | -100 to +100 |
| `ALLY_SUPPORT` | Proximity to friendly units | 0-50 |
| `HEALING_VALUE` | Value of support actions | 0-500 |
| `SURVIVAL_PRIORITY` | Self-preservation importance | 0-200 |
| `MP_EFFICIENCY` | Value of conserving MP | 0-100 |
| `TARGET_PRIORITY` | Preference for specific targets | 0-100 |

## AI Patterns

### Aggressive
- High damage dealt weight
- Low survival priority
- Seeks kills relentlessly

### Defensive
- High survival priority
- Focuses on safe positions
- Protects allies

### Support
- Prioritizes healing allies
- High ally support weight
- Maintains distance

### Tactical
- Balanced weights
- High kill potential focus
- Smart positioning

### Pack
- High ally support weight
- Coordinates with nearby allies
- Swarm behavior

### Ambush
- High kill potential
- Position-focused
- Waits for optimal strikes

### Ranged
- Maintains safe distance
- Kiting behavior
- Position quality focus

### Boss
- Adaptive behavior
- Balanced across factors
- Hard to predict

## Multi-Actor Lookahead

The AI doesn't just consider its own actions - it simulates what ALL characters will do:

```javascript
// Simulate full turn order
Turn Order: [Enemy A, Player 1, Enemy B, Player 2]

Round 1:
  Enemy A acts → Player 1 predicted → Enemy B acts → Player 2 predicted

Round 2:
  (repeat with updated state)

Round 3:
  (repeat with updated state)
```

### Actor Behavior Prediction

| Actor Type | Prediction Method |
|------------|-------------------|
| Self | Full utility evaluation |
| Allied NPCs | Same pattern weights |
| Player characters | Optimal/aggressive play assumed |
| Other enemy NPCs | Their pattern weights |

## NPC Skill System

### Monster Archetypes

Each monster archetype has themed skill branches:

| Archetype | Branches | Example Skills |
|-----------|----------|----------------|
| Beast | Predator, Pack | Bite, Pounce, Howl |
| Dragon | Breath, Physical, Presence | Fire Breath, Tail Swipe, Roar |
| Undead | Necrotic, Physical | Life Drain, Bone Strike |
| Elemental | Fire, Ice, Lightning, Earth | Flame Burst, Frost Bolt |
| Humanoid | Melee, Ranged, Magic | Slash, Arrow Shot, Fireball |
| Construct | Tank, Siege | Slam, Boulder Hurl |
| Demon | Hellfire, Corruption | Hellfire Bolt, Corrupt |
| Insect | Swarm | Sting, Web Shot |
| Plant | Nature | Vine Lash, Entangle |

### Skill Selection Algorithm

```
Max Skill Slots = 2 + floor(level/15) + floor(tier/2)  (capped at 6)
Skill Level = floor(enemyLevel * 0.4) + 1 + tierBonus + variance
Power Scaling = basePower * (1 + (skillLevel-1) * 0.05)
```

### Humanoid NPCs

Humanoid NPCs use player guild skill trees (warrior, wizard, monk, chemist, etc.) instead of monster skills.

## Server-Provided Actions

The server calculates available actions and sends them to the client:

```javascript
// Response from /api/battle/action
{
  state: { ... },
  actionResult: { ... },
  availableActions: {
    canMove: true,
    canAct: true,
    movement: {
      range: 3,
      reachableTiles: [{ x, y, cost }, ...]
    },
    attacks: {
      range: 1,
      targets: [{ tileX, tileY, id, distance }, ...]
    },
    skills: [{
      id: 'fireball',
      name: 'Fireball',
      range: 4,
      mpCost: 18,
      targets: [{ tileX, tileY, unitId }, ...]
    }],
    items: [...]
  }
}
```

The client prefers server-provided data for targeting, falling back to client-side calculation if unavailable.

## Performance Optimizations

### Time Budget
- Target: <500ms per AI decision
- Iterative deepening with time checks
- Hard cap at 3 rounds lookahead

### Transposition Table
- Caches evaluated positions
- Hash: unit positions + HP + MP + depth
- Max 10,000 entries

### Move Ordering
- Killer moves tracked per depth
- History heuristic for good moves
- Attacks evaluated before moves

### Action Pruning
- Top 50 actions for deciding unit
- Top 30 actions for other actors
- Quick heuristic scoring

## Database Tables

### enemy_templates (extended)
```sql
enemy_class VARCHAR(32)      -- monster, warrior, wizard
archetype VARCHAR(32)        -- beast, dragon, humanoid
guild VARCHAR(32)            -- For humanoids: warrior, wizard
guild_level INTEGER          -- Skill progression
movement INTEGER             -- Movement range
attack_range INTEGER         -- Attack range
attack_bonus INTEGER         -- Combat bonuses
defense_bonus INTEGER
```

### npc_skill_templates
```sql
skill_id VARCHAR(64)         -- Unique skill identifier
archetype VARCHAR(32)        -- Monster archetype
branch VARCHAR(32)           -- Skill branch
name VARCHAR(64)
power INTEGER
range INTEGER
mp_cost INTEGER
damage_type VARCHAR(16)
effect VARCHAR(32)
priority INTEGER             -- AI usage priority (1-10)
```

### enemy_template_skills
```sql
enemy_template_id INTEGER    -- Link to enemy template
skill_id VARCHAR(64)         -- Skill from npc_skill_templates
min_enemy_level INTEGER      -- Minimum level to unlock
unlock_chance DECIMAL        -- Probability of having skill
level_scaling DECIMAL        -- Skill level growth rate
```

## Configuration

### Enabling/Disabling Utility AI

In `api/src/services/aiService.js`:

```javascript
const USE_UTILITY_AI = true;  // Set to false for legacy AI
const UTILITY_AI_TIME_BUDGET = 450;  // ms
```

### Adding New AI Patterns

1. Add weights in `patternWeights.js`:
```javascript
newPattern: {
  name: 'New Pattern',
  description: 'Description',
  weights: {
    DAMAGE_DEALT: 1.5,
    // ... other weights
  }
}
```

2. Pattern is automatically available via `aiType` field on enemies

### Adding Monster Skills

1. Add to `api/src/config/monsterSkillTrees.js`
2. Add to migration `011_npc_skills.sql`
3. Skills auto-populate via `npcSkillService.generateEnemySkills()`

## Testing

### Manual Testing
- Play battles against various enemy types
- Verify AI makes smart decisions
- Check tactical AI flanks and positions

### Verification Points
- AI prefers attacks over waits
- Defensive AI retreats at low HP
- Pack AI targets same enemy
- Support AI heals wounded allies
- Boss AI uses varied tactics

## Files Summary

| File | Purpose |
|------|---------|
| `api/src/services/ai/utilityAI.js` | Main AI coordinator |
| `api/src/services/ai/patternWeights.js` | Weight configurations |
| `api/src/services/ai/utilityFactors.js` | Factor calculations |
| `api/src/services/ai/stateEvaluator.js` | Action/state scoring |
| `api/src/services/ai/actionGenerator.js` | Legal action enumeration |
| `api/src/services/ai/lookahead.js` | Multi-actor minimax |
| `api/src/services/ai/cache.js` | Transposition table |
| `api/src/services/aiService.js` | Entry point |
| `api/src/services/battleUnitFactory.js` | Unified unit creation |
| `api/src/services/npcSkillService.js` | NPC skill generation |
| `api/src/config/monsterSkillTrees.js` | Monster skill definitions |
| `api/src/migrations/010_unified_unit_system.sql` | Unit system schema |
| `api/src/migrations/011_npc_skills.sql` | NPC skills schema |
