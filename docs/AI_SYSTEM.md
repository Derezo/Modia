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
│   ├── utilityFactors.js        # Factor calculation functions (11 factors)
│   ├── patternWeights.js        # Weight configurations (9 patterns)
│   ├── stateEvaluator.js        # Board state evaluation
│   ├── actionGenerator.js       # Enumerate legal actions
│   ├── lookahead.js             # Multi-actor minimax
│   ├── strategicPathfinding.js  # Multi-turn path planning
│   └── cache.js                 # Transposition table
├── aiService.js                 # Entry point, legacy fallback
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
| `MP_EFFICIENCY` | Value of conserving MP | -200 to +100 |
| `TARGET_PRIORITY` | Preference for specific targets | 0-100 |
| `strategicPathProgress` | Reward for following optimal path to enemies | 0-1 |
| `waitingPenalty` | Penalty for idle waiting when enemies far (use negative weight) | 0-1 |

### Factor Details

**strategicPathProgress**: Calculates how well a move follows the optimal path toward enemies. Uses `calculateStrategicPath()` to find the best route, then `scoreStrategicMovement()` to evaluate tiles. Returns normalized 0-1 score.

**waitingPenalty**: Discourages waiting when enemies are out of attack range. Returns 0 if an enemy is within range (waiting may be tactically valid), 0.3 if enemies are 1 turn away, or 0.8 if enemies are 2+ turns away. Applied with negative weight to penalize.

**MP_EFFICIENCY**: Returns -200 for zero-benefit actions (e.g., healing full-HP targets) to strongly penalize wasted MP. Otherwise scales 0-100 based on MP remaining and skill cost.

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

### Berserker
- Maximum aggression, ignores safety
- Pure damage focus (3.0 weight)
- Zero survival priority
- Highest strategic path progress (0.35)
- Strongest waiting penalty (-0.5)

### Ranged
- Maintains safe distance
- Kiting behavior
- Position quality focus

### Boss
- Adaptive behavior
- Balanced across factors
- Hard to predict

## Pattern Weight Reference

Complete weight values for all AI patterns:

| Factor | Aggressive | Defensive | Support | Tactical | Pack | Ambush | Berserker | Ranged | Boss |
|--------|-----------|-----------|---------|----------|------|--------|-----------|--------|------|
| DAMAGE_DEALT | 2.0 | 0.8 | 0.5 | 1.5 | 1.5 | 2.5 | **3.0** | 1.8 | 1.5 |
| DAMAGE_RECEIVED | 0.3 | 2.0 | 1.8 | 1.2 | 0.8 | 1.5 | **0.0** | 1.5 | 1.0 |
| KILL_POTENTIAL | 2.5 | 1.0 | 0.5 | **3.0** | 1.5 | **3.5** | 2.0 | 1.5 | 2.0 |
| POSITION_QUALITY | 0.8 | 1.5 | 1.2 | 2.0 | 1.5 | 2.5 | 0.3 | **2.5** | 1.5 |
| ALLY_SUPPORT | 0.5 | 1.5 | 2.5 | 1.0 | **3.0** | 0.3 | 0.0 | 0.8 | 1.0 |
| HEALING_VALUE | 0.3 | 1.5 | **3.0** | 1.0 | 1.2 | 0.2 | 0.0 | 0.5 | 1.5 |
| SURVIVAL_PRIORITY | 0.3 | **2.5** | 2.0 | 1.5 | 1.0 | 1.8 | 0.0 | 1.8 | 1.5 |
| MP_EFFICIENCY | 0.5 | 1.0 | 1.5 | 1.2 | 0.8 | 1.0 | 0.0 | 1.5 | 1.0 |
| TARGET_PRIORITY | 1.2 | 0.8 | 0.5 | 2.0 | 1.5 | 2.5 | 1.0 | 1.5 | 1.8 |
| strategicPathProgress | 0.25 | 0.10 | 0.15 | 0.20 | 0.20 | 0.10 | **0.35** | 0.15 | 0.20 |
| waitingPenalty | -0.3 | -0.1 | -0.1 | -0.2 | -0.25 | -0.05 | **-0.5** | -0.15 | -0.2 |

**Bold** values indicate the highest (or most extreme) weight for that factor.

### Optimal Player Weights

Used when simulating player behavior in lookahead:

| Factor | Weight |
|--------|--------|
| DAMAGE_DEALT | 1.8 |
| DAMAGE_RECEIVED | 1.2 |
| KILL_POTENTIAL | 2.5 |
| POSITION_QUALITY | 1.5 |
| ALLY_SUPPORT | 1.0 |
| HEALING_VALUE | 1.5 |
| SURVIVAL_PRIORITY | 1.5 |
| MP_EFFICIENCY | 0.8 |
| TARGET_PRIORITY | 2.0 |

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

## Strategic Pathfinding

The AI uses strategic pathfinding to plan movement over multiple turns, preventing units from getting stuck or waiting when enemies are far away.

### calculateStrategicPath()

Finds the optimal path from an AI unit to the nearest enemy:

```javascript
calculateStrategicPath(unit, state)
// Returns: { path, nextWaypoint, turnsToReach, targetEnemy }
```

- Uses A* pathfinding from `shared/pathfinding.js`
- Considers terrain and unit obstacles
- Calculates `turnsToReach` based on unit's movement range
- Returns the tile the unit should reach this turn (`nextWaypoint`)

### scoreStrategicMovement()

Scores a tile based on strategic path progress:

```javascript
scoreStrategicMovement(tile, strategicInfo, unit)
// Returns: 0-100 score
```

Scoring algorithm:
- **+40 points**: Tile is on the optimal path
- **+0-30 points**: Proximity to next waypoint (30 - distance * 5)
- **+0-30 points**: Progress toward enemy ((currentDist - newDist) * 10)

### Integration with Utility Factors

Strategic pathfinding integrates with utility factors:

1. **strategicPathProgress factor**: Calls `calculateStrategicPath()` and `scoreStrategicMovement()`, normalizes to 0-1
2. **waitingPenalty factor**: Uses `turnsToReach` to determine penalty severity
3. Both factors are weighted by pattern (berserker has highest path progress weight at 0.35)

### Example: Berserker Movement

```javascript
// Berserker pattern weights encourage aggressive advancement
{
  DAMAGE_DEALT: 3.0,          // Max damage focus
  SURVIVAL_PRIORITY: 0.0,     // No self-preservation
  strategicPathProgress: 0.35, // Strong path-following incentive
  waitingPenalty: -0.5        // Heavy penalty for waiting
}
// Result: Berserker always moves toward enemies, never waits
```

## Legacy AI Fallback

The AI system maintains legacy pattern functions as a fallback when utility AI fails or is disabled.

### Configuration Flags

```javascript
// api/src/services/aiService.js
const USE_UTILITY_AI = true;        // Enable/disable utility AI
const UTILITY_AI_TIME_BUDGET = 450; // Max decision time in ms
```

### Hybrid Decision Logic

When `USE_UTILITY_AI` is enabled, the system uses a hybrid approach:

```
1. Get quick decision (no lookahead) as baseline
2. Get lookahead decision (2-round simulation)
3. Compare results and choose:
   - If quick has offensive action + lookahead is passive + quick score > 100:
     → Use quick (prefer immediate offense)
   - If quick has 2-action sequence with offense + lookahead has 1 action + quick score > 50:
     → Use quick (prefer efficient sequences)
   - Otherwise:
     → Use lookahead (trust multi-turn planning)
```

This prevents the lookahead from being overly conservative when immediate action is better.

### Legacy Pattern Functions

If utility AI fails (returns null or throws), the system falls back to pattern-specific functions:

| AI Type | Legacy Function | Strategy |
|---------|-----------------|----------|
| aggressive | `aggressiveTurnAI()` | Move toward lowest-defense target, attack |
| defensive | `defensiveTurnAI()` | Retreat at low HP, protect wounded allies |
| support | `supportTurnAI()` | Heal allies, debuff enemies, maintain distance |
| tactical | `tacticalTurnAI()` | Target weakest enemy, smart positioning |
| pack | `packTurnAI()` | Coordinate with allies, swarm single target |
| hit-and-run | `hitAndRunTurnAI()` | Attack first, then retreat |
| ambush | `ambushTurnAI()` | Wait hidden, spring attack when close |

Legacy functions use simpler heuristics but provide robust fallback behavior.

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

### Debug Logging

Enable verbose AI logging via environment variable:

```bash
AI_DEBUG=true npm run dev:api
```

**Output includes:**
- `[AI] Lookahead: <unit> (<pattern>) | <action> | score: <score>` - Lookahead decisions
- `[AI] Quick: <unit> (<pattern>) | <action> | score: <score>` - Quick decisions
- `[AI] Sequences evaluated: <count>` - Number of move+action combinations
- `[AI] Top sequences:` - Top 3 alternatives with factor breakdowns
- `[AI] Execute: <unit> | <action summary>` - Turn execution start
- `[AI] Action: <unit> | <action type> <details>` - Individual action execution
- `[AI] Result: <unit> | <outcome>` - Action results with damage/healing values

**Action format in logs:**
- `move(x,y)` - Movement to tile
- `attack(targetId)` - Basic attack
- `skill:skillId(x,y)` - Skill usage
- `item:itemId` - Item usage
- Sequences: `move(x,y)+attack(target)` - Combined actions

### Two-Action Sequence Evaluation

The AI evaluates two-action sequences (move + action combinations) rather than individual actions. This allows for more intelligent decision-making where movement and action are considered together.

**Key methods:**
- `quickDecision()` - Returns a sequence of up to 2 actions without lookahead
- `getBestSequence()` - Evaluates all valid move+action combinations and returns the highest-scoring sequence

**Sequence scoring:**
1. Generate all reachable tiles for the unit
2. For each tile, generate all valid actions from that position
3. Score each (move, action) pair using utility factors
4. Return the sequence with the highest combined score

This approach prevents situations where the AI moves to a suboptimal position because it evaluated movement and action separately.

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
| `api/src/services/ai/patternWeights.js` | Weight configurations for 9 patterns |
| `api/src/services/ai/utilityFactors.js` | Factor calculations (11 factors) |
| `api/src/services/ai/stateEvaluator.js` | Action/state scoring |
| `api/src/services/ai/actionGenerator.js` | Legal action enumeration |
| `api/src/services/ai/lookahead.js` | Multi-actor minimax |
| `api/src/services/ai/cache.js` | Transposition table |
| `api/src/services/ai/strategicPathfinding.js` | Multi-turn path planning |
| `api/src/services/aiService.js` | Entry point, legacy fallback |
| `api/src/services/battleUnitFactory.js` | Unified unit creation |
| `api/src/services/npcSkillService.js` | NPC skill generation |
| `api/src/config/monsterSkillTrees.js` | Monster skill definitions |
| `api/src/migrations/010_unified_unit_system.sql` | Unit system schema |
| `api/src/migrations/011_npc_skills.sql` | NPC skills schema |
