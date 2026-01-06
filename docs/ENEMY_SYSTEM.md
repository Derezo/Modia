# Enemy System

| Document | Version | Last Updated |
|----------|---------|--------------|
| Enemy System Specification | 1.0 | 2026-01-06 |

## Table of Contents

1. [Overview](#1-overview)
2. [Enemy Level Scaling](#2-enemy-level-scaling)
3. [Enemy Types by Terrain](#3-enemy-types-by-terrain)
4. [AI Archetypes](#4-ai-archetypes)
5. [Enemy Templates](#5-enemy-templates)
6. [Boss Encounters](#6-boss-encounters)
7. [Enemy Template Schema](#7-enemy-template-schema)
8. [Related Documents](#related-documents)

---

## 1. Overview

Enemies in Modia are generated from templates that define their base stats, abilities, and behavior patterns. Enemy stats scale with player level to maintain challenge throughout progression.

### 1.1 Core Concepts

- **Template**: Base definition with stats, abilities, and AI archetype
- **Instance**: Generated enemy with scaled stats for the current encounter
- **AI Archetype**: Behavior pattern determining how the enemy acts in combat
- **Terrain Type**: Where the enemy appears (forest, cave, mountain, bridge)
- **Difficulty Tier**: Overall challenge rating (1-5)

### 1.2 Enemy Categories

| Category | Description | Examples |
|----------|-------------|----------|
| Melee | Close-range attackers | Goblins, Wolves, Skeletons |
| Ranged | Attack from distance | Archers, Mages, Spitters |
| Tank | High HP, draw aggro | Golems, Treants, Trolls |
| Support | Buff allies, debuff players | Shamans, Priests, Enchanters |
| Swarm | Low HP, attack in groups | Bats, Rats, Insects |
| Boss | Powerful unique encounters | Troll King, Dragon, Demon Lord |

---

## 2. Enemy Level Scaling

Enemy stats scale dynamically based on the average level of the player's party.

### 2.1 Level Calculation Formula

```
enemy_level = floor(avg_party_level × tier_multiplier)
```

### 2.2 Tier Multipliers

| Terrain | Tier | Multiplier Range | Notes |
|---------|------|------------------|-------|
| Forest | 1 | 0.8 - 1.0 | Starting area |
| Cave | 2 | 1.0 - 1.2 | Mid-level |
| Mountain | 3 | 1.2 - 1.5 | High-level |
| Bridge Boss | 4 | 1.5 - 2.0 | Boss encounters |
| Palace | 5 | 1.8 - 2.5 | End-game |

### 2.3 Stat Scaling Formula

```
scaled_hp = base_hp × (1 + enemy_level × 0.10)
scaled_atk = base_atk × (1 + enemy_level × 0.05)
scaled_def = base_def × (1 + enemy_level × 0.05)
scaled_matk = base_matk × (1 + enemy_level × 0.05)
scaled_mdef = base_mdef × (1 + enemy_level × 0.05)
```

### 2.4 Reward Scaling

```
xp_reward = base_xp × (1 + enemy_level × 0.08)
gold_min = base_gold_min × (1 + enemy_level × 0.05)
gold_max = base_gold_max × (1 + enemy_level × 0.05)
```

---

## 3. Enemy Types by Terrain

### 3.1 Forest (Difficulty Tier 1-2)

| Enemy | Type | HP | STR | AGI | AI | Special Abilities |
|-------|------|-----|-----|-----|-----|-------------------|
| Forest Sprite | Flying | Low | Low | High | Hit-and-run | Evasion +20%, Wind Gust |
| Goblin Warrior | Melee | Med | Med | Med | Aggressive | Steal (10% gold) |
| Goblin Archer | Ranged | Low | Med | High | Kite | Poison Arrow |
| Gray Wolf | Pack | Med | High | High | Pack tactics | +15% damage when grouped |
| Alpha Wolf | Pack Leader | High | High | Med | Tactical | Howl (buff pack) |
| Treant Guardian | Tank | V.High | Med | V.Low | Defensive | Root (immobilize), Immobile |
| Mushroom Colony | Swarm | Low×5 | Low | Low | Spread | Poison Cloud on death |
| Forest Spider | Ambush | Med | Med | High | Ambush | Web (slow), Poison Bite |
| Wild Boar | Charge | Med | High | Med | Aggressive | Charge (+50% first hit) |
| Dryad | Support | Low | Low | Med | Support | Heal, Entangle |

### 3.2 Cave (Difficulty Tier 2-3)

| Enemy | Type | HP | STR | AGI | AI | Special Abilities |
|-------|------|-----|-----|-----|-----|-------------------|
| Stone Golem | Tank | V.High | High | V.Low | Counter | 50% physical resist, Slam |
| Skeleton Warrior | Melee | Med | Med | Med | Aggressive | Undead, immune to poison |
| Skeleton Archer | Ranged | Low | Med | Med | Kite | Undead, Pierce Shot |
| Skeleton Mage | Mage | Low | Low | Low | AoE | Undead, Dark Bolt, Drain Life |
| Crystal Elemental | Mage | Med | Low | Med | AoE | Elemental weakness cycle |
| Cave Bat Swarm | Evasive | V.Low×6 | Low | V.High | Disrupt | Confusion, Screech (stun) |
| Mimic Chest | Ambush | High | High | Low | Surprise | Disguise, Bite, Gold Drop |
| Giant Spider | Tank | High | High | Med | Defensive | Web Trap, Venomous Fangs |
| Zombie | Melee | Med | Med | V.Low | Aggressive | Undead, Regen 5%/turn |
| Ghost | Mage | Low | Low | High | Hit-and-run | Incorporeal (50% phys resist), Chill |

### 3.3 Mountain (Difficulty Tier 3-4)

| Enemy | Type | HP | STR | AGI | AI | Special Abilities |
|-------|------|-----|-----|-----|-----|-------------------|
| Mountain Troll | Regen | High | V.High | Low | Focus squishy | Regen 20%/turn, Club Smash |
| Troll Shaman | Support | Med | Med | Low | Support | Heal Troll, Earth Shield |
| Harpy | Flyer | Med | Med | High | Strafe | Flight, Screech (confuse) |
| Harpy Matriarch | Leader | High | High | High | Tactical | Summon Harpies, Wind Slash |
| Boulder Elemental | AoE | V.High | High | V.Low | Zone control | Earthquake (AoE), Rockslide |
| Frost Wyvern | Boss | V.High | High | Med | Setup | Ice Storm, Frost Breath |
| Echo Knight | Duo | Med×2 | High | Med | Sync | Linked damage, Berserk on partner death |
| Yeti | Tank | V.High | V.High | Low | Aggressive | Ice Punch, Freeze (stun) |
| Gargoyle | Ambush | High | High | Med | Ambush | Stone Form (90% resist idle), Dive |
| Wyvern Rider | Mounted | High | High | High | Tactical | Lance Charge, Flight |

### 3.4 Bridge (Difficulty Tier 2-4)

| Enemy | Type | HP | STR | AGI | AI | Special Abilities |
|-------|------|-----|-----|-----|-----|-------------------|
| Bandit Captain | Leader | High | High | Med | Tactical | Rally (buff allies), Dual Wield |
| Bandit Archer | Ranged | Low | Med | High | Kite | Aimed Shot, Smoke Bomb |
| Bandit Rogue | Melee | Med | Med | High | Assassin | Backstab (+100% from behind) |
| Mercenary Guard | Tank | High | High | Med | Defensive | Shield Wall, Protect ally |
| Mercenary Mage | Mage | Low | Low | Med | AoE | Fireball, Magic Barrier |
| Toll Troll | Greed | Med | Med | Low | Hoard | Gold Absorption (steals gold on hit) |
| Bridge Keeper | Boss | V.High | V.High | Low | Defensive | None Shall Pass, Knockback |
| Highwayman | Melee | Med | High | High | Aggressive | Steal Item, Quick Draw |

### 3.5 Palace (Difficulty Tier 4-5)

| Enemy | Type | HP | STR | AGI | AI | Special Abilities |
|-------|------|-----|-----|-----|-----|-------------------|
| Royal Guard | Tank | High | High | Med | Defensive | Formation, Shield Bash |
| Court Mage | Mage | Med | Low | Med | AoE | Arcane Blast, Time Stop |
| Shadow Assassin | Assassin | Med | V.High | V.High | Assassin | Invisibility, Execute |
| Demon Knight | Melee | V.High | V.High | Med | Aggressive | Dark Slash, Lifesteal |
| Demon Mage | Mage | Med | High | Med | AoE | Hellfire, Summon Imp |
| Archdemon | Boss | V.High | V.High | High | Tactical | Multi-phase, Enrage |
| Dragon | Boss | V.High | V.High | Med | Tactical | Fire Breath, Tail Swipe, Flight |

---

## 4. AI Archetypes

### 4.1 Aggressive

- **Behavior**: Target highest DPS, charge forward immediately
- **Priority**: Attack > Move > Skill
- **Target Selection**: Lowest DEF or highest ATK player
- **Retreat Threshold**: Never retreats

```
aggressive_turn():
    target = findLowestDefensePlayer()
    if canAttack(target):
        attack(target)
    else:
        moveToward(target)
        if canAttack(target):
            attack(target)
```

### 4.2 Defensive

- **Behavior**: Protect allies, maintain distance, retreat at 50% HP
- **Priority**: Protect > Position > Attack
- **Target Selection**: Nearest threat to protected ally
- **Retreat Threshold**: 50% HP

```
defensive_turn():
    if hasAllyToProtect():
        ally = getMostVulnerableAlly()
        if allyUnderAttack(ally):
            moveToProtect(ally)
            if canAttack(ally.attacker):
                attack(ally.attacker)
            return

    if hp < maxHp * 0.5:
        retreatFromCombat()
        return

    target = findNearestEnemy()
    if canAttack(target):
        attack(target)
```

### 4.3 Support

- **Behavior**: Heal/buff allies, debuff players, avoid frontline
- **Priority**: Heal > Buff > Debuff > Move
- **Target Selection**: Lowest HP ally or highest threat player
- **Retreat Threshold**: 30% HP

```
support_turn():
    woundedAlly = findWoundedAlly(threshold: 0.7)
    if woundedAlly and hasHealSkill():
        heal(woundedAlly)
        return

    unbuffedAlly = findUnbuffedAlly()
    if unbuffedAlly and hasBuffSkill():
        buff(unbuffedAlly)
        return

    highThreat = findHighestThreatPlayer()
    if hasDebuffSkill() and not isDebuffed(highThreat):
        debuff(highThreat)
        return

    maintainDistance(minRange: 3)
```

### 4.4 Tactical

- **Behavior**: Control positions, setup combos, adapt to player actions
- **Priority**: Position > Setup > Execute
- **Target Selection**: Based on tactical advantage
- **Retreat Threshold**: Context-dependent

```
tactical_turn():
    // Analyze battlefield
    threats = analyzeThreatLevel()
    opportunities = findOpportunities()

    // Position for advantage
    bestPosition = calculateOptimalPosition()
    if currentPosition != bestPosition:
        moveToward(bestPosition)

    // Execute best action
    if hasSetupOpportunity():
        executeSetup()  // e.g., place trap, buff self
    else if hasComboOpportunity():
        executeCombo()
    else:
        standardAttack(getPriorityTarget())
```

### 4.5 Pack Tactics

- **Behavior**: Coordinate with pack members, bonus when grouped
- **Priority**: Group > Coordinate > Attack
- **Target Selection**: Same target as pack leader or other pack members

```
pack_turn():
    if hasPackLeader():
        target = packLeader.currentTarget
    else:
        target = findPackTarget()

    // Stay close to pack
    if distanceToNearestPackMember() > 2:
        moveTowardPack()
    else if canAttack(target):
        attack(target)  // +15% damage when adjacent to pack member
    else:
        moveToward(target)
```

### 4.6 Hit-and-Run

- **Behavior**: Attack then retreat, avoid being cornered
- **Priority**: Escape Route > Attack > Move

```
hitandrun_turn():
    if justAttacked:
        retreatToSafeDistance()
        return

    target = findVulnerableTarget()
    if canAttackAndRetreat(target):
        attack(target)
        justAttacked = true
    else:
        positionForNextAttack()
```

### 4.7 Ambush

- **Behavior**: Hide until opportunity, massive first strike
- **Priority**: Wait > Strike > Flee

```
ambush_turn():
    if isHidden:
        target = findIsolatedTarget()
        if targetInRange(target) and isVulnerable(target):
            ambushStrike(target)  // +100% damage
            isHidden = false
        else:
            stayHidden()
    else:
        // Standard aggressive behavior after revealed
        aggressive_turn()
```

---

## 5. Enemy Templates

### 5.1 Forest Enemies

#### Goblin Warrior

```json
{
  "templateId": "goblin_warrior",
  "name": "Goblin Warrior",
  "enemyType": "melee",
  "terrainType": "forest",
  "difficultyTier": 1,
  "baseLevel": 1,
  "hp": 80,
  "mp": 20,
  "strength": 12,
  "intelligence": 6,
  "agility": 10,
  "vitality": 8,
  "luck": 8,
  "movement": 3,
  "attackRange": 1,
  "aiArchetype": "aggressive",
  "xpReward": 15,
  "goldMin": 5,
  "goldMax": 15,
  "abilities": [
    { "id": "attack", "type": "basic" },
    { "id": "steal", "type": "special", "chance": 0.10, "effect": "steal_gold" }
  ],
  "dropTable": "dt_goblin_forest",
  "sprite": "goblin_warrior"
}
```

#### Gray Wolf

```json
{
  "templateId": "gray_wolf",
  "name": "Gray Wolf",
  "enemyType": "pack",
  "terrainType": "forest",
  "difficultyTier": 1,
  "baseLevel": 3,
  "hp": 100,
  "mp": 0,
  "strength": 14,
  "intelligence": 4,
  "agility": 14,
  "vitality": 10,
  "luck": 6,
  "movement": 4,
  "attackRange": 1,
  "aiArchetype": "pack",
  "xpReward": 20,
  "goldMin": 3,
  "goldMax": 10,
  "abilities": [
    { "id": "attack", "type": "basic" },
    { "id": "pack_bonus", "type": "passive", "effect": "+15% damage when adjacent to pack" }
  ],
  "dropTable": "dt_wolf_forest",
  "sprite": "gray_wolf"
}
```

#### Treant Guardian

```json
{
  "templateId": "treant_guardian",
  "name": "Treant Guardian",
  "enemyType": "tank",
  "terrainType": "forest",
  "difficultyTier": 2,
  "baseLevel": 8,
  "hp": 350,
  "mp": 50,
  "strength": 18,
  "intelligence": 8,
  "agility": 2,
  "vitality": 25,
  "luck": 5,
  "movement": 0,
  "attackRange": 2,
  "aiArchetype": "defensive",
  "xpReward": 80,
  "goldMin": 20,
  "goldMax": 50,
  "abilities": [
    { "id": "branch_slam", "type": "basic", "damage": 1.2 },
    { "id": "root", "type": "special", "cooldown": 3, "effect": "immobilize", "duration": 2 },
    { "id": "regenerate", "type": "passive", "effect": "heal_5_percent_per_turn" }
  ],
  "dropTable": "dt_treant_forest",
  "sprite": "treant"
}
```

### 5.2 Cave Enemies

#### Stone Golem

```json
{
  "templateId": "stone_golem",
  "name": "Stone Golem",
  "enemyType": "tank",
  "terrainType": "cave",
  "difficultyTier": 2,
  "baseLevel": 15,
  "hp": 500,
  "mp": 0,
  "strength": 22,
  "intelligence": 2,
  "agility": 3,
  "vitality": 30,
  "luck": 2,
  "movement": 2,
  "attackRange": 1,
  "aiArchetype": "defensive",
  "xpReward": 100,
  "goldMin": 30,
  "goldMax": 80,
  "abilities": [
    { "id": "slam", "type": "basic", "damage": 1.5 },
    { "id": "stone_skin", "type": "passive", "effect": "50_physical_resist" },
    { "id": "earthquake", "type": "special", "cooldown": 4, "effect": "aoe_damage", "range": 2 }
  ],
  "dropTable": "dt_golem_cave",
  "sprite": "stone_golem"
}
```

#### Skeleton Mage

```json
{
  "templateId": "skeleton_mage",
  "name": "Skeleton Mage",
  "enemyType": "mage",
  "terrainType": "cave",
  "difficultyTier": 2,
  "baseLevel": 12,
  "hp": 120,
  "mp": 150,
  "strength": 5,
  "intelligence": 18,
  "agility": 8,
  "vitality": 6,
  "luck": 8,
  "movement": 3,
  "attackRange": 4,
  "aiArchetype": "support",
  "xpReward": 75,
  "goldMin": 25,
  "goldMax": 60,
  "abilities": [
    { "id": "dark_bolt", "type": "basic", "element": "dark", "range": 4 },
    { "id": "drain_life", "type": "special", "cooldown": 3, "effect": "damage_and_heal" },
    { "id": "undead", "type": "passive", "effect": "poison_immune" }
  ],
  "dropTable": "dt_skeleton_cave",
  "sprite": "skeleton_mage"
}
```

### 5.3 Mountain Enemies

#### Mountain Troll

```json
{
  "templateId": "mountain_troll",
  "name": "Mountain Troll",
  "enemyType": "regen",
  "terrainType": "mountain",
  "difficultyTier": 3,
  "baseLevel": 25,
  "hp": 800,
  "mp": 0,
  "strength": 35,
  "intelligence": 4,
  "agility": 6,
  "vitality": 40,
  "luck": 3,
  "movement": 3,
  "attackRange": 1,
  "aiArchetype": "aggressive",
  "xpReward": 200,
  "goldMin": 80,
  "goldMax": 200,
  "abilities": [
    { "id": "club_smash", "type": "basic", "damage": 1.8 },
    { "id": "regeneration", "type": "passive", "effect": "heal_20_percent_per_turn" },
    { "id": "enrage", "type": "trigger", "condition": "below_30_hp", "effect": "+50% damage" }
  ],
  "dropTable": "dt_troll_mountain",
  "sprite": "mountain_troll"
}
```

#### Frost Wyvern

```json
{
  "templateId": "frost_wyvern",
  "name": "Frost Wyvern",
  "enemyType": "boss",
  "terrainType": "mountain",
  "difficultyTier": 4,
  "baseLevel": 35,
  "hp": 2000,
  "mp": 300,
  "strength": 45,
  "intelligence": 30,
  "agility": 20,
  "vitality": 50,
  "luck": 10,
  "movement": 4,
  "attackRange": 1,
  "aiArchetype": "tactical",
  "xpReward": 1000,
  "goldMin": 300,
  "goldMax": 800,
  "abilities": [
    { "id": "claw_attack", "type": "basic", "damage": 1.5 },
    { "id": "frost_breath", "type": "special", "cooldown": 2, "effect": "cone_ice_damage", "range": 3 },
    { "id": "ice_storm", "type": "ultimate", "cooldown": 5, "effect": "aoe_freeze", "range": 4 },
    { "id": "flight", "type": "passive", "effect": "ignore_terrain" }
  ],
  "dropTable": "dt_wyvern_boss",
  "sprite": "frost_wyvern"
}
```

---

## 6. Boss Encounters

### 6.1 Boss Mechanics

Bosses have special mechanics that distinguish them from regular enemies:

| Mechanic | Description |
|----------|-------------|
| Multi-Phase | Stats/abilities change at HP thresholds |
| Enrage Timer | Damage increases over time |
| Minion Summon | Spawns additional enemies |
| Immunity Phases | Temporary invulnerability |
| AoE Attacks | Large-scale damage abilities |
| Targeted Attacks | Must be dodged/blocked |

### 6.2 Example Boss: Troll King (Bridge)

```json
{
  "templateId": "troll_king",
  "name": "Troll King",
  "enemyType": "boss",
  "terrainType": "bridge",
  "difficultyTier": 4,
  "baseLevel": 30,
  "hp": 3000,
  "mp": 100,
  "strength": 50,
  "intelligence": 10,
  "agility": 8,
  "vitality": 60,
  "luck": 5,
  "movement": 3,
  "attackRange": 2,
  "aiArchetype": "tactical",
  "xpReward": 1500,
  "goldMin": 500,
  "goldMax": 1200,
  "phases": [
    {
      "hpThreshold": 1.0,
      "name": "Phase 1",
      "abilities": ["club_smash", "rock_throw", "regeneration"]
    },
    {
      "hpThreshold": 0.5,
      "name": "Phase 2 - Enraged",
      "abilities": ["frenzied_smash", "ground_pound", "call_trolls"],
      "statModifiers": { "strength": 1.25, "agility": 1.5 }
    },
    {
      "hpThreshold": 0.2,
      "name": "Phase 3 - Desperate",
      "abilities": ["death_grip", "rampage", "massive_regeneration"],
      "statModifiers": { "strength": 1.5, "vitality": 0.5 }
    }
  ],
  "dropTable": "dt_troll_king_boss",
  "sprite": "troll_king"
}
```

### 6.3 Boss Drop Rules

| Rule | Description |
|------|-------------|
| Guaranteed Rare+ | At least one item is rare or better |
| Legendary Chance | 10% chance for legendary drop |
| Unique Items | Some bosses drop boss-specific items |
| Multiple Drops | 2-4 items per kill |

---

## 7. Enemy Template Schema

### 7.1 Full Schema Definition

```json
{
  "templateId": "string (unique identifier)",
  "name": "string (display name)",
  "description": "string (optional flavor text)",

  "enemyType": "melee|ranged|tank|support|swarm|boss|mage|pack|ambush",
  "terrainType": "forest|cave|mountain|bridge|palace",
  "difficultyTier": "integer (1-5)",
  "baseLevel": "integer",

  "hp": "integer (base HP)",
  "mp": "integer (base MP)",
  "strength": "integer",
  "intelligence": "integer",
  "agility": "integer",
  "vitality": "integer",
  "luck": "integer",

  "movement": "integer (tiles per turn)",
  "attackRange": "integer (tiles)",

  "aiArchetype": "aggressive|defensive|support|tactical|pack|hitandrun|ambush",

  "xpReward": "integer (base XP)",
  "goldMin": "integer",
  "goldMax": "integer",

  "abilities": [
    {
      "id": "string",
      "type": "basic|special|passive|ultimate|trigger",
      "damage": "float (multiplier, optional)",
      "element": "string (optional)",
      "cooldown": "integer (turns, optional)",
      "effect": "string (effect type)",
      "range": "integer (optional)",
      "duration": "integer (optional)",
      "chance": "float (0-1, optional)",
      "condition": "string (for triggers, optional)"
    }
  ],

  "phases": [
    {
      "hpThreshold": "float (0-1)",
      "name": "string",
      "abilities": ["ability_ids"],
      "statModifiers": {
        "stat": "float (multiplier)"
      }
    }
  ],

  "resistances": {
    "physical": "float (-1 to 1, optional)",
    "fire": "float",
    "ice": "float",
    "lightning": "float",
    "poison": "float",
    "holy": "float",
    "dark": "float"
  },

  "immunities": ["status_effect_ids"],

  "dropTable": "string (drop table reference)",
  "sprite": "string (sprite asset reference)"
}
```

### 7.2 Ability Effect Types

| Effect Type | Description |
|-------------|-------------|
| damage | Deal damage |
| heal | Restore HP |
| buff | Increase ally stats |
| debuff | Decrease enemy stats |
| status | Apply status effect |
| summon | Spawn additional enemies |
| aoe_damage | Area damage |
| cone_damage | Cone-shaped attack |
| lifesteal | Damage and heal |
| immobilize | Prevent movement |
| stun | Skip turn |
| poison | Damage over time |
| knockback | Push target away |

---

## Related Documents

| Document | Description |
|----------|-------------|
| [GAME_DESIGN.md](GAME_DESIGN.md) | Core game mechanics |
| [ITEM_SYSTEM.md](ITEM_SYSTEM.md) | Drop tables and loot |
| [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md) | Database schema for enemy_templates |
| [API_SPECIFICATION.md](API_SPECIFICATION.md) | Battle endpoints |

---

## Document History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-01-06 | Initial document |
