# Character Progression

| Document | Version | Last Updated |
|----------|---------|--------------|
| Character Progression Specification | 2.0 | 2026-01-06 |

## Table of Contents

1. [Overview](#1-overview)
2. [Formation Screen](#2-formation-screen)
3. [Equipment System](#3-equipment-system)
4. [Skill System](#4-skill-system)
5. [Guild System](#5-guild-system)
6. [Skill Tree JSON Schema](#6-skill-tree-json-schema)
7. [Example Skill Trees](#7-example-skill-trees)

---

## 1. Overview

Character progression in Modia is driven by a skill-based leveling system. Characters earn XP from battles, accumulate it in a pool, and spend it to learn and improve skills. Both character level and guild level are determined by XP spent on skills, creating a flexible progression where players choose how to develop their characters.

### Core Concepts

| Concept | Description |
|---------|-------------|
| **XP Pool** | Accumulated experience from battles, waiting to be spent |
| **Character Level** | Based on **total XP spent** across all skills in all guilds |
| **Guild Level** | Based on XP spent on skills **within that specific guild** |
| **Skill Level** | Each skill can be leveled 1-100 with granular improvements |

### Progression Flow

```
Battle → Earn XP → XP added to Pool → Spend XP on Skills → Character/Guild Level Up
```

### Key Mechanics

1. **XP is currency**: Earning XP doesn't automatically level you up - you must spend it
2. **Player choice**: Decide whether to master one skill or spread XP across many
3. **Multi-guild**: Characters can join multiple guilds, each with separate guild levels
4. **Skill preservation**: When advancing guilds, previous skills remain usable but frozen

### Level Thresholds

Character and guild levels are calculated from cumulative XP spent:

**Formula**: `XP Required for Level N = 100 × N^2.2`

| Level | Total XP Spent | Level | Total XP Spent |
|-------|----------------|-------|----------------|
| 1 | 0 | 25 | 158,489 |
| 5 | 3,400 | 50 | 794,328 |
| 10 | 15,849 | 75 | 2,371,374 |
| 15 | 47,863 | 100 | 3,981,072 (Max) |
| 20 | 95,499 | | |

*Note: Maximum character level is 100.*

---

## 2. Formation Screen

The Formation Screen is the central hub for party and character management.

### 2.1 Screen Layout

```
+----------------------------------------------------------+
|                    FORMATION SCREEN                       |
+----------------------------------------------------------+
|                                                          |
|  +------+  +------+  +------+  +------+  +------+        |
|  | Char |  | Char |  | Char |  | Char |  | Char |        |
|  |  1   |  |  2   |  |  3   |  |  4   |  |  5   |        |
|  +------+  +------+  +------+  +------+  +------+        |
|                                                          |
|  +------+  +------+  +------+  +------+  +------+        |
|  | Char |  | Char |  | Char |  | Char |  | Char |        |
|  |  6   |  |  7   |  |  8   |  |  9   |  |  10  |        |
|  +------+  +------+  +------+  +------+  +------+        |
|                                                          |
|  +------+  +------+                                       |
|  | Char |  | Char |                   [MENU]             |
|  |  11  |  |  12  |                                      |
|  +------+  +------+                                       |
|                                                          |
+----------------------------------------------------------+
```

### 2.2 Character Grid

- **Maximum Characters**: 12
- **Battle Party**: Slots 1-5 (highlighted border)
- **Display**: Character portrait, name, level, class icon
- **Selection**: Click/tap to select, click again to deselect
- **Reorder**: Drag and drop to swap positions

### 2.3 Menu States

#### No Character Selected

| Option | Action |
|--------|--------|
| **Inventory** | View all items across party |
| **Exit** | Return to world map |

#### Character Selected

| Option | Action |
|--------|--------|
| **Equip** | Open equipment screen |
| **Learn** | Open skill tree screen |
| **Guild** | Open guild advancement screen |
| **Dispatch** | Remove character from party |

### 2.4 Character Card Display

```
+------------------+
|    [Portrait]    |
|                  |
|   "Hero Name"    |
|   Lv.50 Warrior  |
|                  |
| HP: 450/450      |
| MP: 80/80        |
+------------------+
```

---

## 3. Equipment System

### 3.1 Equipment Slots

| Slot | Display Position | Accepts |
|------|------------------|---------|
| Main Hand | Left side | Weapons |
| Off Hand | Right side | Shields, Orbs, Secondary |
| Head | Top center | Helmets, Hats |
| Body | Center | Armor, Robes |
| Feet | Bottom center | Boots |
| Accessory 1 | Bottom left | Any accessory |
| Accessory 2 | Bottom right | Any accessory |

### 3.2 Equip Screen Layout

```
+----------------------------------------------------------+
|  [Character Name]  Lv.50 Warrior                         |
+----------------------------------------------------------+
|                                                          |
|        [Head]           |    INVENTORY                   |
|                         |    +-----------------------+   |
|  [Off Hand] [Body] [Main Hand]  | Iron Sword        |   |
|                         |    | Steel Shield        |   |
|        [Feet]           |    | Warrior's Amulet    |   |
|                         |    | Copper Ring         |   |
|  [Acc 1]    [Acc 2]     |    | ...                 |   |
|                         |    +-----------------------+   |
|                                                          |
|  STATS              |  SELECTED ITEM                     |
|  STR: 45 (+5)       |  Steel Shield (Rare)               |
|  INT: 12            |  Defense: 18                       |
|  AGI: 28            |  Block: 8%                         |
|  VIT: 38 (+3)       |  +5 VIT                            |
|  LUK: 15            |  Req: Lv.25, Warrior               |
|                     |                                    |
|  ATK: 156           |  [EQUIP]  [COMPARE]                |
|  DEF: 89 (+18)      |                                    |
+----------------------------------------------------------+
```

### 3.3 Equipment Requirements

Items may have requirements that must be met to equip:

| Requirement | Check |
|-------------|-------|
| Level | Character level >= item level requirement |
| Class | Character class in item's classRequirement array |

**Requirement Display:**
- Met: Green text
- Not Met: Red text (item cannot be equipped)

### 3.4 Stat Comparison

When selecting an item, show stat changes:

| Format | Meaning |
|--------|---------|
| `STR: 45 (+5)` | Stat would increase by 5 |
| `AGI: 28 (-2)` | Stat would decrease by 2 |
| `VIT: 38` | No change |

---

## 4. Skill System

### 4.1 Overview

Characters learn and improve skills by spending XP from their pool. When XP is spent:
- The skill gains a level (up to 100)
- The spent XP contributes to **Character Level** (total across all guilds)
- The spent XP contributes to **Guild Level** (within that guild only)

### 4.2 XP Pool

**Earning XP:**
- Characters earn XP by participating in and **winning** battles
- Each participant receives: `XP = (sum of enemy levels) × 10`
- Earned XP goes into the character's **XP Pool** (not spent automatically)

**Example:**
```
Battle: 3 enemies (Lv.5, Lv.7, Lv.8) = total enemy levels: 20
XP Reward per character: 20 × 10 = 200 XP

Party of 5 wins → each character gains 200 XP to their pool
```

**Spending XP:**
- Player chooses which skills to invest XP in
- Each skill level costs XP (scaling with skill level)
- Spent XP is tracked for level calculations

```
XP Pool: 5,000
  ├── Spend 100 XP on Bash Lv.1 → Pool: 4,900, Total Spent: 100
  ├── Spend 110 XP on Bash Lv.2 → Pool: 4,790, Total Spent: 210
  └── Spend 120 XP on Bash Lv.3 → Pool: 4,670, Total Spent: 330
```

### 4.3 Skill Levels (1-100)

Each skill can be leveled from 1 to 100, with small incremental improvements per level.

#### XP Cost Progression

| Skill Level | Base Cost Multiplier | Example (100 base) |
|-------------|---------------------|-------------------|
| 1 | 1.0x | 100 XP |
| 2 | 1.1x | 110 XP |
| 3 | 1.2x | 120 XP |
| 10 | 1.9x | 190 XP |
| 25 | 3.4x | 340 XP |
| 50 | 5.9x | 590 XP |
| 75 | 8.4x | 840 XP |
| 100 | 10.9x | 1,090 XP |

**Formula**: `costForLevel = baseCost × (1 + (level - 1) × 0.1)`

**Total XP to Max a Skill (100 levels)**:
- 100 base cost skill: ~59,500 XP total
- 200 base cost skill: ~119,000 XP total

### 4.4 Skill Scaling Types

Skills scale differently based on their type. The scaling definition determines how the skill improves from level 1 to 100.

#### Type 1: Damage Range (High Variance)

Some skills have wide damage ranges that tighten as skill level increases:

**Example: Bash (Warrior)**
| Skill Level | Min Damage | Max Damage | Description |
|-------------|------------|------------|-------------|
| 1 | 10% ATK | 200% ATK | Highly unpredictable |
| 25 | 32% ATK | 275% ATK | Less variance |
| 50 | 55% ATK | 350% ATK | More consistent |
| 75 | 77% ATK | 425% ATK | Reliable damage |
| 100 | 100% ATK | 500% ATK | Maximum power |

**Scaling Formula**:
```
minDamage = baseMin + ((maxMin - baseMin) × (level - 1) / 99)
maxDamage = baseMax + ((maxMax - baseMax) × (level - 1) / 99)

Where:
  baseMin = 10%, maxMin = 100%
  baseMax = 200%, maxMax = 500%
```

#### Type 2: Static Power (Predictable)

Some skills have fixed multipliers that scale linearly:

**Example: Power Strike (Warrior)**
| Skill Level | Damage | Description |
|-------------|--------|-------------|
| 1 | 150% ATK | Base power |
| 50 | 225% ATK | Mid-level |
| 100 | 300% ATK | Maximum |

**Scaling Formula**:
```
damage = basePower + (powerPerLevel × (level - 1))

Where:
  basePower = 150%
  powerPerLevel = 1.52% (150 / 99)
```

#### Type 3: Area of Effect

Some skills increase their area coverage:

**Example: Cleave (Warrior)**
| Skill Level | Damage | AoE Tiles | Cone Angle |
|-------------|--------|-----------|------------|
| 1 | 80% ATK | 2 | 60° |
| 50 | 115% ATK | 3 | 90° |
| 100 | 150% ATK | 4 | 120° |

#### Type 4: Status Effects

Some skills improve effect potency, duration, or chance:

**Example: Poison Flask (Chemist)**
| Skill Level | Damage | Poison Chance | Poison Duration | Poison DPS |
|-------------|--------|---------------|-----------------|------------|
| 1 | 50% INT | 30% | 2 turns | 5% max HP |
| 50 | 75% INT | 65% | 3 turns | 10% max HP |
| 100 | 100% INT | 100% | 4 turns | 15% max HP |

#### Type 5: Resource Efficiency

Some skills reduce costs or cooldowns at higher levels:

**Example: Meditate (Monk)**
| Skill Level | MP Restored | Cooldown |
|-------------|-------------|----------|
| 1 | 10% max MP | 5 turns |
| 50 | 20% max MP | 4 turns |
| 100 | 30% max MP | 3 turns |

### 4.5 Skill Categories

Skills fall into two categories, both with 100 levels:

#### Active Skills

Skills used in combat by selecting them from the skill menu:
- Consume MP (usually)
- Have cooldowns (sometimes)
- Target enemies, allies, or self
- Examples: Bash, Fireball, Heal

#### Passive/Inherent Skills

Skills that provide permanent bonuses without activation:
- Always active once learned
- Scale with skill level (100 levels)
- No MP cost or cooldown
- Examples: Parry, Weapon Mastery, Critical Eye

**Passive Skill Examples:**

| Skill | Effect at Lv.1 | Effect at Lv.100 |
|-------|----------------|------------------|
| **Parry** | +1% Evasion | +25% Evasion |
| **Sword Mastery** | +2% damage with swords | +50% damage with swords |
| **Critical Eye** | +0.5% Crit Chance | +15% Crit Chance |
| **Heavy Armor** | Can equip heavy armor | Can equip + 25% DEF from heavy armor |
| **Dual Wield** | Can equip off-hand weapon | Can equip + 40% off-hand damage |

Passive skills use the same XP cost and leveling system as active skills.

### 4.6 Learn Screen Layout

```
+----------------------------------------------------------+
|  [Character Name]                                        |
|  Character Lv.25    Warrior Lv.18    XP Pool: 12,450     |
+----------------------------------------------------------+
|                                                          |
|  GUILD: WARRIOR                    [Switch Guild ▼]      |
|                                                          |
|  SKILL BRANCHES                                          |
|  [OFFENSE]     [DEFENSE]     [UTILITY]                   |
|                                                          |
+----------------------------------------------------------+
|                    OFFENSE BRANCH                        |
+----------------------------------------------------------+
|                                                          |
|  [Bash]------->[Power Strike]------->[Cleave]            |
|   Lv.47/100      Lv.12/100            Lv.0/100           |
|   Next: 560 XP   Next: 310 XP         UNLOCK: 500 XP     |
|                                                          |
|  [Slash]------->[Cross Cut]                              |
|   Lv.33/100      Lv.0/100                                |
|   Next: 420 XP   LOCKED (Slash 25)                       |
|                                                          |
+----------------------------------------------------------+
|  SELECTED: Bash (Lv.47/100)                              |
|  A powerful shield strike.                               |
|                                                          |
|  MP Cost: 8                                              |
|  Damage: 52% - 343% ATK (random)                         |
|  At Lv.100: 100% - 500% ATK                              |
|                                                          |
|  Next Level: 560 XP                                      |
|  Prerequisite: None                                      |
|                                                          |
|  [LEVEL UP]  [+10 LEVELS: 6,200 XP]                      |
+----------------------------------------------------------+
```

### 4.7 Skill States

| State | Display | Action |
|-------|---------|--------|
| **Maxed** | "100/100" | Cannot upgrade further |
| **Learned** | "47/100" | Can upgrade with XP |
| **Available** | "0/100" | Can unlock with base XP cost |
| **Locked** | "LOCKED" | Prerequisites not met |
| **Frozen** | "47/100 ❄" | From previous guild, cannot upgrade |

### 4.8 Prerequisites

Skills may require:
- **Guild Level**: Minimum guild level to unlock
- **Prerequisite Skills**: Other skills at minimum level

**Example Unlock Requirements:**
- Bash: None (starter skill)
- Power Strike: Warrior Guild Lv.5, Bash Lv.25
- Cleave: Warrior Guild Lv.15, Power Strike Lv.50
- Executioner: Warrior Guild Lv.30, Cleave Lv.75

### 4.9 Bulk Leveling

For convenience, players can level skills in bulk:

| Option | Description |
|--------|-------------|
| **+1 Level** | Standard single level up |
| **+10 Levels** | Level up 10 times (shows total cost) |
| **Max Affordable** | Spend all available XP on this skill |

---

## 5. Guild System

### 5.1 Overview

Guilds represent class specializations. Each guild has its own skill tree and guild level. Characters can belong to **multiple guilds** over their lifetime, with **no cap** on the number of guilds.

**Key Concepts:**
- **Guild Level**: Calculated from XP spent on that guild's skills only
- **Active Guild**: The currently selected guild for skill learning
- **Previous Guilds**: Skills remain usable but are **frozen** (cannot be upgraded)
- **Multi-Guild**: A character can be Warrior Lv.50 AND Berserker Lv.30 simultaneously

### 5.2 Guild Progression

When a character joins a new guild:
1. They start at **Guild Level 1** in the new guild
2. A new skill tree becomes available
3. **Previous guild skills are frozen** - usable in combat but cannot spend more XP
4. **Character Level is unaffected** - it's based on total XP spent across all guilds
5. XP Pool is shared across all guilds

**Example Progression:**
```
Character: "Roland"
Character Level: 72 (based on ~52,000 total XP spent)

Guild History:
├── Warrior Lv.50 ❄ (FROZEN)
│   ├── Bash Lv.100 ❄
│   ├── Power Strike Lv.75 ❄
│   └── Guard Lv.45 ❄
│
└── Berserker Lv.22 (ACTIVE)
    ├── Rage Strike Lv.35
    ├── Blood Frenzy Lv.18
    └── Reckless Charge Lv.0 (available)

XP Pool: 8,430 (can only spend on Berserker skills)
```

### 5.3 Advancement Requirements

To advance from a base guild to an advanced guild:

| Requirement | Description |
|-------------|-------------|
| **Guild Level** | Current guild level must be 50+ |
| **Guild Quest** | Complete the advancement quest at the class guild node |
| **Guild Visit** | Must physically travel to the guild node on world map |

**Notes:**
- Character Level is NOT a requirement - only Guild Level matters
- You can advance to any advanced guild from your current guild's options
- Once advanced, you cannot go back (but you keep all previous skills)

### 5.4 Guild Screen Layout

```
+----------------------------------------------------------+
|  [Character Name]                                        |
|  Character Lv.72    XP Pool: 8,430                       |
+----------------------------------------------------------+
|                                                          |
|  GUILD MEMBERSHIPS                                       |
|                                                          |
|  +------------------+  +------------------+               |
|  |    WARRIOR       |  |    BERSERKER     |               |
|  |    Lv.50 ❄       |  |    Lv.22 ✓       |               |
|  |    (Frozen)      |  |    (Active)      |               |
|  |                  |  |                  |               |
|  |  [VIEW SKILLS]   |  |  [LEARN SKILLS]  |               |
|  +------------------+  +------------------+               |
|                                                          |
+----------------------------------------------------------+
|  ADVANCEMENT OPTIONS (Berserker Lv.50 Required)          |
|                                                          |
|  +------------------+  +------------------+               |
|  |  BLOOD KNIGHT    |  |   REAVER         |               |
|  |  Vampiric DPS    |  |   Destruction    |               |
|  |                  |  |                  |               |
|  |  Quest: NOT DONE |  |  Quest: NOT DONE |               |
|  |  [LOCKED]        |  |  [LOCKED]        |               |
|  +------------------+  +------------------+               |
|                                                          |
+----------------------------------------------------------+
```

### 5.5 Skill Freezing

When a character advances to a new guild:

| Aspect | Frozen Guild | Active Guild |
|--------|--------------|--------------|
| Use skills in combat | Yes | Yes |
| Spend XP on skills | No | Yes |
| View skill tree | Yes | Yes |
| Skill levels | Preserved | Can increase |
| Equipment | Still usable | Still usable |

**Frozen Skill Display:**
```
+------------------+
|  [Bash]          |
|  Lv.100/100 ❄    |
|  (FROZEN)        |
|                  |
|  Cannot upgrade  |
|  in this guild   |
+------------------+
```

### 5.6 Multi-Guild Combat

In combat, characters can use skills from **all** their guilds:

```
SKILL SELECTION (Roland - Warrior/Berserker)

[Warrior Skills]        [Berserker Skills]
├── Bash Lv.100         ├── Rage Strike Lv.35
├── Power Strike Lv.75  ├── Blood Frenzy Lv.18
└── Guard Lv.45         └── (more...)
```

This allows for powerful hybrid builds combining skills from multiple guilds.

### 5.7 Guild Advancement Paths

#### Warrior Advancements

| Advanced Class | Role | Description |
|----------------|------|-------------|
| **Paladin** | Tank/Support | Holy knight with healing abilities and party-wide defensive buffs. Gains holy magic at the cost of raw damage. |
| **Berserker** | Pure DPS | Rage-fueled warrior who sacrifices defense for devastating offense. Gains rage mechanics that increase damage at low HP. |
| **Guardian** | Pure Tank | Immovable defender with taunt abilities and damage redirection. Can intercept attacks meant for allies. Movement reduced to 2. |
| **Warlord** | Tank/Utility | Battlefield commander with party-wide offensive buffs and war cries. Leadership auras boost nearby allies' stats. |

#### Wizard Advancements

| Advanced Class | Role | Description |
|----------------|------|-------------|
| **Sorcerer** | Burst DPS | Master of raw magical power. Specializes in high-damage single-target spells with amplified critical hits. |
| **Summoner** | Pet DPS | Commands magical creatures to fight alongside the party. Summons persist across turns and act independently. |
| **Conjurer** | Control Mage | Manipulates the battlefield with terrain effects, barriers, and area denial. Excels at crowd control. |
| **Oracle** | Support Mage | Divination specialist with foresight abilities. Can predict and negate enemy actions, buff allies with prophetic insights. |

#### Monk Advancements

| Advanced Class | Role | Description |
|----------------|------|-------------|
| **Ninja** | Assassin | Stealth specialist with guaranteed critical strikes from hidden. Highest AGI growth, gains evasion-based damage reduction. Movement 5. |
| **Martial Artist** | Combo DPS | Master of chained attacks. Gains combo system where consecutive attacks increase damage multiplicatively. |
| **Brawler** | Bruiser | Grappling specialist with counter-attacks. Higher VIT than base monk, can disable enemies with holds. Movement reduced to 3. |
| **Ascetic** | Ki Support | Inner focus master with powerful ki abilities. Can convert HP to MP and vice versa. Party-wide meditation buffs. |

#### Chemist Advancements

| Advanced Class | Role | Description |
|----------------|------|-------------|
| **Alchemist** | Offensive Support | Transmutation specialist with explosive compounds. Gains powerful AoE damage and terrain-altering effects. |
| **Medic** | Pure Healer | Emergency medicine expert with powerful single-target heals. Can revive fallen allies once per battle. |
| **Plague Doctor** | Debuffer | Disease specialist with spreading DoT effects. Enemies affected by plague spread it to others on death. |
| **Artificer** | Utility | Gadget master who deploys turrets and traps. Can create temporary barriers and summon mechanical constructs. |

### 5.8 Guild Quests

> **Note**: Guild quests are deferred to post-MVP. For MVP, characters remain in their starting base guild. Advanced guild functionality will be implemented after core systems are complete.

Guild quests unlock advanced guild options. Characters are sent from base guild nodes on the world map to complete advancement quests.

#### Quest Requirements

| Requirement | Description |
|-------------|-------------|
| **Base Guild Match** | Character must belong to the guild matching the node (e.g., Warrior at Warriors' Guild) |
| **Guild Level** | Some quests require minimum guild level |
| **Advanced Guild** | Some quests require already having a specific advanced guild |
| **Special Items** | Some quests require rare items or equipment from battles/other quests |

#### Quest Mechanics

- **One quest at a time**: Each character can only be on one guild quest
- **Character unavailable**: While on a quest, the character cannot participate in battles or other activities
- **Completion**: Quests complete after a certain number of **game actions** (e.g., battles won by other party members)
- **Permanent unlock**: Once unlocked, the advanced guild is available forever for that character

#### Quest Flow

```
1. Travel to base guild node (e.g., Warriors' Guild)
2. Select character who meets requirements
3. Choose advanced guild quest (e.g., "Path of the Berserker")
4. Character departs on quest (unavailable)
5. Complete required game actions with remaining party
6. Quest completes → Advanced guild unlocked
7. Character can now switch to Berserker at any time
```

#### Quest Types

| Quest Type | Description |
|------------|-------------|
| **Trial of Combat** | Requires party to win X battles while character is away |
| **Trial of Wisdom** | Requires party to visit specific locations |
| **Trial of Endurance** | Requires party to win battles without any defeats |
| **Trial of Service** | Requires party to complete specific tasks |

*Detailed quest specifications will be documented separately.*

---

## 6. Skill Tree JSON Schema

### 6.1 File Location

Skill trees are stored as JSON files:
```
shared/data/skill_trees/
  warrior.json
  wizard.json
  monk.json
  chemist.json
  paladin.json
  berserker.json
  ... (one file per guild)
```

### 6.2 Complete Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "SkillTreeSchema",
  "description": "Schema for guild skill trees with 100-level skills",

  "type": "object",
  "properties": {
    "guildId": {
      "type": "string",
      "description": "Guild identifier (e.g., 'warrior', 'berserker')"
    },
    "guildName": {
      "type": "string",
      "description": "Display name"
    },
    "baseGuild": {
      "type": ["string", "null"],
      "description": "Parent guild for advanced guilds, null for base guilds"
    },
    "branches": {
      "type": "array",
      "items": { "$ref": "#/definitions/branch" }
    },
    "advancementOptions": {
      "type": "array",
      "items": { "$ref": "#/definitions/advancementOption" },
      "description": "Guilds this guild can advance to"
    }
  },
  "required": ["guildId", "guildName", "branches"],

  "definitions": {
    "branch": {
      "type": "object",
      "properties": {
        "branchId": { "type": "string" },
        "branchName": { "type": "string" },
        "description": { "type": "string" },
        "skills": {
          "type": "array",
          "items": { "$ref": "#/definitions/skill" }
        }
      },
      "required": ["branchId", "branchName", "skills"]
    },

    "skill": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^[a-z_]+$"
        },
        "name": { "type": "string" },
        "description": { "type": "string" },
        "tier": {
          "type": "integer",
          "minimum": 1,
          "maximum": 5,
          "description": "Skill tier for UI organization"
        },
        "guildLevelRequired": {
          "type": "integer",
          "minimum": 1,
          "description": "Guild level required to unlock"
        },
        "baseXpCost": {
          "type": "integer",
          "minimum": 0,
          "description": "XP cost for level 1; scales with formula"
        },
        "prerequisites": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "skillId": { "type": "string" },
              "level": { "type": "integer", "minimum": 1 }
            },
            "required": ["skillId"]
          }
        },
        "maxLevel": {
          "type": "integer",
          "default": 100,
          "description": "Maximum skill level (default 100)"
        },
        "mpCost": {
          "type": "integer",
          "minimum": 0,
          "description": "MP cost to use skill"
        },
        "cooldown": {
          "type": "integer",
          "minimum": 0,
          "description": "Cooldown in turns"
        },
        "range": {
          "type": "integer",
          "minimum": 0,
          "description": "Range in tiles (0 = self)"
        },
        "scaling": {
          "$ref": "#/definitions/skillScaling",
          "description": "How the skill improves from level 1 to max"
        },
        "effects": {
          "type": "array",
          "items": { "$ref": "#/definitions/effect" }
        },
        "tags": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "basic", "offensive", "defensive", "healing",
              "buff", "debuff", "aoe", "single_target",
              "melee", "ranged", "ultimate", "passive",
              "toggle", "combo_starter", "combo_finisher"
            ]
          }
        }
      },
      "required": ["id", "name", "description", "tier", "guildLevelRequired", "baseXpCost", "maxLevel", "mpCost", "range", "scaling", "effects"]
    },

    "skillScaling": {
      "type": "object",
      "description": "Defines how skill properties scale from level 1 to max level",
      "properties": {
        "type": {
          "type": "string",
          "enum": ["damage_range", "static_power", "aoe", "status_effect", "resource"],
          "description": "Primary scaling type"
        },
        "damageRange": {
          "type": "object",
          "description": "For high-variance damage skills",
          "properties": {
            "minAtLevel1": { "type": "number" },
            "minAtMaxLevel": { "type": "number" },
            "maxAtLevel1": { "type": "number" },
            "maxAtMaxLevel": { "type": "number" },
            "scalingStat": { "type": "string" }
          }
        },
        "staticPower": {
          "type": "object",
          "description": "For predictable damage skills",
          "properties": {
            "powerAtLevel1": { "type": "number" },
            "powerAtMaxLevel": { "type": "number" },
            "scalingStat": { "type": "string" }
          }
        },
        "aoeScaling": {
          "type": "object",
          "description": "For area-of-effect skills",
          "properties": {
            "radiusAtLevel1": { "type": "integer" },
            "radiusAtMaxLevel": { "type": "integer" },
            "angleAtLevel1": { "type": "integer" },
            "angleAtMaxLevel": { "type": "integer" }
          }
        },
        "statusScaling": {
          "type": "object",
          "description": "For skills with status effects",
          "properties": {
            "chanceAtLevel1": { "type": "integer" },
            "chanceAtMaxLevel": { "type": "integer" },
            "durationAtLevel1": { "type": "integer" },
            "durationAtMaxLevel": { "type": "integer" },
            "potencyAtLevel1": { "type": "number" },
            "potencyAtMaxLevel": { "type": "number" }
          }
        },
        "resourceScaling": {
          "type": "object",
          "description": "For skills that scale efficiency",
          "properties": {
            "valueAtLevel1": { "type": "number" },
            "valueAtMaxLevel": { "type": "number" },
            "cooldownAtLevel1": { "type": "integer" },
            "cooldownAtMaxLevel": { "type": "integer" }
          }
        }
      },
      "required": ["type"]
    },

    "effect": {
      "type": "object",
      "properties": {
        "type": {
          "type": "string",
          "enum": ["damage", "heal", "buff", "debuff", "summon", "terrain", "special"]
        },
        "damageType": {
          "type": "string",
          "enum": ["physical", "magical", "fire", "ice", "lightning", "holy", "dark", "poison", "true"]
        },
        "targetType": {
          "type": "string",
          "enum": ["self", "single_enemy", "single_ally", "all_enemies", "all_allies", "aoe_circle", "aoe_line", "aoe_cone"]
        },
        "statusEffect": { "$ref": "#/definitions/statusEffect" },
        "buffEffect": { "$ref": "#/definitions/buffEffect" }
      },
      "required": ["type", "targetType"]
    },

    "statusEffect": {
      "type": "object",
      "properties": {
        "effect": {
          "type": "string",
          "enum": ["poison", "burn", "freeze", "stun", "slow", "blind", "silence", "bleed"]
        }
      },
      "required": ["effect"]
    },

    "buffEffect": {
      "type": "object",
      "properties": {
        "stat": {
          "type": "string",
          "enum": ["ATK", "DEF", "MATK", "MDEF", "AGI", "CRIT", "EVASION", "MOVEMENT"]
        },
        "stacks": { "type": "boolean" }
      },
      "required": ["stat"]
    },

    "advancementOption": {
      "type": "object",
      "properties": {
        "guildId": { "type": "string" },
        "guildName": { "type": "string" },
        "guildLevelRequired": { "type": "integer", "default": 50 },
        "questId": { "type": "string" },
        "description": { "type": "string" }
      },
      "required": ["guildId", "guildName", "questId"]
    }
  }
}
```

### 6.3 Scaling Calculation

At runtime, skill values are calculated using linear interpolation:

```javascript
function calculateSkillValue(baseValue, maxValue, currentLevel, maxLevel) {
  const progress = (currentLevel - 1) / (maxLevel - 1);
  return baseValue + (maxValue - baseValue) * progress;
}

// Example: Bash damage range at level 47
// minDamage = 10 + (100 - 10) * (46/99) = 10 + 41.8 = 51.8%
// maxDamage = 200 + (500 - 200) * (46/99) = 200 + 139.4 = 339.4%
```

### 6.4 XP Cost Calculation

```javascript
function calculateXpCost(baseXpCost, targetLevel) {
  // Cost increases by 10% per level
  return Math.floor(baseXpCost * (1 + (targetLevel - 1) * 0.1));
}

function calculateTotalXpToLevel(baseXpCost, targetLevel) {
  let total = 0;
  for (let i = 1; i <= targetLevel; i++) {
    total += calculateXpCost(baseXpCost, i);
  }
  return total;
}
```

---

## 7. Example Skill Trees

Each guild contains **10-20 skills** across 2-4 branches, including both active and passive skills. Complete skill definitions for all guilds will be documented in a separate **SKILL_TREES.md** design document.

The examples below demonstrate the schema structure with a subset of skills.

### 7.1 Warrior Guild (Base)

```json
{
  "guildId": "warrior",
  "guildName": "Warrior",
  "baseGuild": null,
  "branches": [
    {
      "branchId": "warrior_offense",
      "branchName": "Offense",
      "description": "Devastating physical attacks",
      "skills": [
        {
          "id": "warrior_bash",
          "name": "Bash",
          "description": "A powerful strike with unpredictable damage.",
          "tier": 1,
          "guildLevelRequired": 1,
          "baseXpCost": 100,
          "prerequisites": [],
          "maxLevel": 100,
          "mpCost": 5,
          "cooldown": 0,
          "range": 1,
          "scaling": {
            "type": "damage_range",
            "damageRange": {
              "minAtLevel1": 10,
              "minAtMaxLevel": 100,
              "maxAtLevel1": 200,
              "maxAtMaxLevel": 500,
              "scalingStat": "STR"
            }
          },
          "effects": [
            {
              "type": "damage",
              "damageType": "physical",
              "targetType": "single_enemy"
            }
          ],
          "tags": ["basic", "offensive", "melee", "single_target"]
        },
        {
          "id": "warrior_power_strike",
          "name": "Power Strike",
          "description": "A devastating overhead blow with consistent damage.",
          "tier": 2,
          "guildLevelRequired": 5,
          "baseXpCost": 150,
          "prerequisites": [{ "skillId": "warrior_bash", "level": 25 }],
          "maxLevel": 100,
          "mpCost": 12,
          "cooldown": 2,
          "range": 1,
          "scaling": {
            "type": "static_power",
            "staticPower": {
              "powerAtLevel1": 150,
              "powerAtMaxLevel": 300,
              "scalingStat": "STR"
            }
          },
          "effects": [
            {
              "type": "damage",
              "damageType": "physical",
              "targetType": "single_enemy"
            },
            {
              "type": "debuff",
              "targetType": "single_enemy",
              "buffEffect": { "stat": "DEF", "stacks": false }
            }
          ],
          "tags": ["offensive", "melee", "single_target", "debuff"]
        },
        {
          "id": "warrior_cleave",
          "name": "Cleave",
          "description": "A wide slash that grows in area as mastered.",
          "tier": 3,
          "guildLevelRequired": 15,
          "baseXpCost": 200,
          "prerequisites": [{ "skillId": "warrior_power_strike", "level": 50 }],
          "maxLevel": 100,
          "mpCost": 20,
          "cooldown": 3,
          "range": 1,
          "scaling": {
            "type": "aoe",
            "staticPower": {
              "powerAtLevel1": 80,
              "powerAtMaxLevel": 150,
              "scalingStat": "STR"
            },
            "aoeScaling": {
              "radiusAtLevel1": 2,
              "radiusAtMaxLevel": 4,
              "angleAtLevel1": 60,
              "angleAtMaxLevel": 120
            }
          },
          "effects": [
            {
              "type": "damage",
              "damageType": "physical",
              "targetType": "aoe_cone"
            }
          ],
          "tags": ["offensive", "melee", "aoe"]
        }
      ]
    },
    {
      "branchId": "warrior_defense",
      "branchName": "Defense",
      "description": "Protective techniques",
      "skills": [
        {
          "id": "warrior_shield_bash",
          "name": "Shield Bash",
          "description": "Slam your shield with increasing stun chance.",
          "tier": 1,
          "guildLevelRequired": 1,
          "baseXpCost": 100,
          "prerequisites": [],
          "maxLevel": 100,
          "mpCost": 8,
          "cooldown": 1,
          "range": 1,
          "scaling": {
            "type": "status_effect",
            "staticPower": {
              "powerAtLevel1": 60,
              "powerAtMaxLevel": 120,
              "scalingStat": "STR"
            },
            "statusScaling": {
              "chanceAtLevel1": 15,
              "chanceAtMaxLevel": 50,
              "durationAtLevel1": 1,
              "durationAtMaxLevel": 2
            }
          },
          "effects": [
            {
              "type": "damage",
              "damageType": "physical",
              "targetType": "single_enemy"
            },
            {
              "type": "debuff",
              "targetType": "single_enemy",
              "statusEffect": { "effect": "stun" }
            }
          ],
          "tags": ["offensive", "defensive", "melee", "debuff"]
        },
        {
          "id": "warrior_guard",
          "name": "Guard",
          "description": "Defensive stance with improving efficiency.",
          "tier": 2,
          "guildLevelRequired": 8,
          "baseXpCost": 120,
          "prerequisites": [{ "skillId": "warrior_shield_bash", "level": 20 }],
          "maxLevel": 100,
          "mpCost": 10,
          "cooldown": 3,
          "range": 0,
          "scaling": {
            "type": "resource",
            "resourceScaling": {
              "valueAtLevel1": 30,
              "valueAtMaxLevel": 80,
              "cooldownAtLevel1": 4,
              "cooldownAtMaxLevel": 2
            }
          },
          "effects": [
            {
              "type": "buff",
              "targetType": "self",
              "buffEffect": { "stat": "DEF", "stacks": false }
            }
          ],
          "tags": ["defensive", "buff"]
        }
      ]
    }
  ],
  "advancementOptions": [
    {
      "guildId": "paladin",
      "guildName": "Paladin",
      "guildLevelRequired": 50,
      "questId": "paladin_trial",
      "description": "Holy knight with healing abilities"
    },
    {
      "guildId": "berserker",
      "guildName": "Berserker",
      "guildLevelRequired": 50,
      "questId": "berserker_trial",
      "description": "Rage-fueled warrior"
    },
    {
      "guildId": "guardian",
      "guildName": "Guardian",
      "guildLevelRequired": 50,
      "questId": "guardian_trial",
      "description": "Immovable defender"
    },
    {
      "guildId": "warlord",
      "guildName": "Warlord",
      "guildLevelRequired": 50,
      "questId": "warlord_trial",
      "description": "Battlefield commander"
    }
  ]
}
```

### 7.2 Other Base Guilds

The Wizard, Monk, and Chemist guilds follow the same schema pattern as Warrior above. Each has:
- 2-3 skill branches with thematic focus
- Skills with `maxLevel: 100` and appropriate scaling types
- `advancementOptions` for their 4 advanced guilds

**Wizard** branches: Fire Magic, Ice Magic, Lightning Magic
**Monk** branches: Martial Arts, Ki Mastery, Body Techniques
**Chemist** branches: Potion Craft, Acid Craft, Bomb Craft

### 7.3 Advanced Guild Example (Berserker)

Advanced guilds reference their `baseGuild` and have their own unique skill trees:

```json
{
  "guildId": "berserker",
  "guildName": "Berserker",
  "baseGuild": "warrior",
  "branches": [
    {
      "branchId": "berserker_rage",
      "branchName": "Rage",
      "description": "Fury-powered attacks that grow stronger as HP drops",
      "skills": [
        {
          "id": "berserker_rage_strike",
          "name": "Rage Strike",
          "description": "A furious attack that deals more damage at low HP.",
          "tier": 1,
          "guildLevelRequired": 1,
          "baseXpCost": 120,
          "prerequisites": [],
          "maxLevel": 100,
          "mpCost": 0,
          "cooldown": 0,
          "range": 1,
          "scaling": {
            "type": "damage_range",
            "damageRange": {
              "minAtLevel1": 50,
              "minAtMaxLevel": 150,
              "maxAtLevel1": 250,
              "maxAtMaxLevel": 600,
              "scalingStat": "STR"
            },
            "note": "Damage increases by 1% per 1% missing HP"
          },
          "effects": [
            {
              "type": "damage",
              "damageType": "physical",
              "targetType": "single_enemy"
            }
          ],
          "tags": ["basic", "offensive", "melee", "single_target"]
        },
        {
          "id": "berserker_blood_frenzy",
          "name": "Blood Frenzy",
          "description": "Enter a frenzy, boosting damage but taking more.",
          "tier": 2,
          "guildLevelRequired": 10,
          "baseXpCost": 180,
          "prerequisites": [{ "skillId": "berserker_rage_strike", "level": 30 }],
          "maxLevel": 100,
          "mpCost": 0,
          "cooldown": 5,
          "range": 0,
          "scaling": {
            "type": "resource",
            "resourceScaling": {
              "valueAtLevel1": 20,
              "valueAtMaxLevel": 50,
              "cooldownAtLevel1": 6,
              "cooldownAtMaxLevel": 3
            },
            "note": "+ATK% buff, but also +damage taken %"
          },
          "effects": [
            {
              "type": "buff",
              "targetType": "self",
              "buffEffect": { "stat": "ATK", "stacks": false }
            },
            {
              "type": "debuff",
              "targetType": "self",
              "buffEffect": { "stat": "DEF", "stacks": false }
            }
          ],
          "tags": ["offensive", "buff", "debuff", "toggle"]
        }
      ]
    }
  ],
  "advancementOptions": []
}
```

---

## Related Documents

| Document | Description |
|----------|-------------|
| [GAME_DESIGN.md](GAME_DESIGN.md) | Base class stats and combat formulas |
| [ITEM_SYSTEM.md](ITEM_SYSTEM.md) | Equipment and item generation |
| [ECONOMY_SYSTEM.md](ECONOMY_SYSTEM.md) | NPC shops, marketplace, gold economy |
| [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md) | Database schemas |
| [API_SPECIFICATION.md](API_SPECIFICATION.md) | Character and skill endpoints |
