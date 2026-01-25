# Modia - Quest System (ARCHIVED)

> **ARCHIVED:** January 2026
> **Reason:** Restructured into modular documentation
> **Replaced by:** `docs/QUEST_SYSTEM.md` (index), `docs/GUILD_ADVANCEMENT.md`, `docs/DAILY_WEEKLY_QUESTS.md`

---

# Modia - Quest System

## Document Information

| Field | Value |
|-------|-------|
| Version | 1.0 |
| Last Updated | January 2026 |
| Purpose | Guild advancement quest system specification |

---

## Overview

The quest system in Modia is focused on **guild advancement** - allowing characters to progress from base classes (warrior, wizard, monk, chemist) through 4 tiers of specialization. Each tier requires completing a quest with material collection, enemy kills, node visits, and culminates in a boss trial against the guild's master.

### Class Advancement Path

```
Base Class (T0) → T1 → T2 → T3 → T4

Warrior Guild:    warrior → berserker → paladin → guardian → warlord
Wizard Guild:     wizard  → sorcerer  → summoner → conjurer → oracle
Monk Guild:       monk    → ninja     → martial_artist → brawler → ascetic
Chemist Guild:    chemist → alchemist → medic → plague_doctor → artificer
```

### Quest Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Quest Lifecycle                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. View Available    2. Accept Quest    3. Complete Objectives     │
│     ┌─────────┐          ┌─────────┐         ┌─────────────────┐   │
│     │ Guild   │───────▶  │ Quest   │───────▶ │ ◉ Materials     │   │
│     │ Hall    │          │ Active  │         │ ◉ Kill Enemies  │   │
│     └─────────┘          └─────────┘         │ ◉ Visit Nodes   │   │
│                                               └────────┬────────┘   │
│                                                        │            │
│  6. Class Upgrade    5. Defeat Boss    4. Boss Unlocks │            │
│     ┌─────────┐         ┌─────────┐         ┌─────────▼─────┐      │
│     │ New     │◀──────  │ Guild   │◀──────  │ Return to     │      │
│     │ Class!  │         │ Master  │         │ Guild Hall    │      │
│     └─────────┘         └─────────┘         └───────────────┘      │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Database Schema

### Core Tables

#### `advancement_quest_templates`

Static quest definitions for each class advancement path.

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL | Primary key |
| `guild_id` | VARCHAR(20) | Base guild: warrior, wizard, monk, chemist |
| `tier` | INTEGER | Quest tier (1-4) |
| `target_class` | VARCHAR(30) | Class to advance to |
| `prerequisite_class` | VARCHAR(30) | Required current class (NULL for T1) |
| `quest_name` | VARCHAR(100) | Display name |
| `quest_description` | TEXT | Quest flavor text |
| `material_requirements` | JSONB | Array of material objectives |
| `enemy_requirements` | JSONB | Array of kill objectives |
| `node_requirements` | JSONB | Array of exploration objectives |
| `boss_config` | JSONB | Guildmaster battle configuration |
| `gold_reward` | INTEGER | Gold awarded on completion |
| `xp_reward` | INTEGER | Experience awarded on completion |
| `title_reward` | VARCHAR(50) | Optional title earned |

**Requirement JSONB Schemas:**

```javascript
// material_requirements
[
  { "item_template_id": 1, "quantity": 5, "rarity": "common", "name": "Iron Ore" }
]

// enemy_requirements
[
  { "enemy_archetype": "beast", "count": 10, "zone_tier": 1 }
]

// node_requirements
[
  { "node_type": "forest", "count": 2, "min_tier": 1 }
]

// boss_config
{
  "guildmaster_class": "warrior",
  "phase_count": 1,
  "disciple_classes": ["warrior", "warrior"]
}
```

#### `character_quests`

Tracks active and completed quests per character.

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL | Primary key |
| `character_id` | INTEGER | FK to characters |
| `quest_template_id` | INTEGER | FK to quest templates |
| `status` | ENUM | 'active', 'boss_ready', 'completed', 'abandoned' |
| `material_progress` | JSONB | `{item_template_id: collected_count}` |
| `enemy_progress` | JSONB | `{enemy_archetype: kill_count}` |
| `node_progress` | JSONB | `{node_type: [visited_node_ids]}` |
| `started_at` | TIMESTAMP | Quest start time |
| `boss_unlocked_at` | TIMESTAMP | When objectives completed |
| `completed_at` | TIMESTAMP | Quest completion time |
| `abandoned_at` | TIMESTAMP | If quest was abandoned |

**Constraint:** One active quest per character (`UNIQUE(character_id)` with status filtering in app logic).

#### `character_quest_items`

Quest-specific items (not in regular inventory).

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL | Primary key |
| `character_id` | INTEGER | FK to characters |
| `quest_id` | INTEGER | FK to character_quests |
| `item_template_id` | INTEGER | Item type collected |
| `quantity` | INTEGER | Amount collected |
| `obtained_at` | TIMESTAMP | Collection time |

#### `character_titles`

Titles earned from quest completion.

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL | Primary key |
| `character_id` | INTEGER | FK to characters |
| `title` | VARCHAR(50) | Title text |
| `earned_at` | TIMESTAMP | When earned |
| `is_active` | BOOLEAN | Currently displayed title |

### Boss Battle Tables

#### `guildmaster_templates`

Boss templates for guild advancement trials.

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL | Primary key |
| `guild_class` | VARCHAR(32) | Class this guildmaster represents |
| `guild_id` | VARCHAR(20) | Base guild |
| `guild_tier` | INTEGER | Tier level (1-4) |
| `name` | VARCHAR(128) | Guildmaster name |
| `title` | VARCHAR(128) | Title/rank |
| `sprite_id` | VARCHAR(64) | Sprite asset ID |
| `base_level` | INTEGER | Base level (scaled to challenger) |
| `base_hp/mp` | INTEGER | Base HP/MP stats |
| `base_strength/int/agi/vit` | INTEGER | Core stats |
| `skills` | JSONB | Array of skill IDs |
| `phases` | JSONB | Phase configuration |
| `disciple_count` | INTEGER | Number of disciple units |
| `disciple_classes` | JSONB | Classes for disciple units |
| `ai_type` | VARCHAR(32) | AI archetype |
| `intro_dialogue` | TEXT | Pre-battle dialogue |
| `victory_dialogue` | TEXT | Player wins dialogue |
| `defeat_dialogue` | TEXT | Player loses dialogue |

**Phase Configuration:**
```javascript
[
  {
    "threshold": 1.0,        // Starts at 100% HP
    "name": "Trial of Strength",
    "abilities": ["power_strike", "shield_bash"],
    "statMods": {}
  },
  {
    "threshold": 0.5,        // Triggers at 50% HP
    "name": "BLOOD RAGE",
    "abilities": ["rage_strike", "rampage"],
    "statMods": { "attack": 1.5, "defense": 0.6 },
    "onEnter": { "effect": "berserk", "duration": 99 }
  }
]
```

#### `advancement_battle_history`

Tracks all advancement attempts.

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL | Primary key |
| `character_id` | INTEGER | FK to characters |
| `battle_id` | INTEGER | FK to battles |
| `guildmaster_template_id` | INTEGER | FK to guildmaster |
| `target_class` | VARCHAR(32) | Class attempted |
| `result` | VARCHAR(20) | 'victory', 'defeat', 'fled' |
| `duration_seconds` | INTEGER | Battle duration |
| `damage_dealt` | INTEGER | Total damage to boss |
| `damage_taken` | INTEGER | Total damage taken |
| `phases_reached` | INTEGER | Highest phase reached |
| `attempted_at` | TIMESTAMP | Attempt time |

---

## API Endpoints

All endpoints require authentication. Base path: `/api/advancement`

### GET `/available/:characterId`

Get available quests for a character.

**Response:**
```javascript
{
  "characterId": 1,
  "availableQuests": [
    {
      "id": 1,
      "guildId": "warrior",
      "tier": 1,
      "questName": "Path of Fury",
      "questDescription": "Prove your worth...",
      "targetClass": "berserker",
      "prerequisiteClass": null,
      "materialRequirements": [...],
      "enemyRequirements": [...],
      "nodeRequirements": [...],
      "rewards": { "gold": 500, "xp": 1000, "title": "Initiate of Fury" },
      "guildmasterName": "Vorn the Unyielding"
    }
  ]
}
```

**Eligibility Rules:**
- Character level >= 10
- No active quest in progress
- Current class matches prerequisite (or base class for T1)
- Not already at max tier for guild

### GET `/current/:characterId`

Get active quest progress.

**Response (has active quest):**
```javascript
{
  "characterId": 1,
  "hasActiveQuest": true,
  "quest": {
    "questId": 42,
    "templateId": 1,
    "questName": "Path of Fury",
    "questDescription": "...",
    "targetClass": "berserker",
    "guildId": "warrior",
    "tier": 1,
    "status": "active",  // or "boss_ready"
    "startedAt": "2026-01-12T10:00:00Z",
    "bossUnlockedAt": null,
    "rewards": { "gold": 500, "xp": 1000, "title": "Initiate of Fury" },
    "bossConfig": {...},
    "progress": {
      "materials": {
        "items": [{ "itemTemplateId": 1, "required": 5, "collected": 3, "complete": false }],
        "complete": false,
        "percentage": 60
      },
      "enemies": {
        "enemies": [{ "enemyArchetype": "beast", "required": 10, "killed": 10, "complete": true }],
        "complete": true,
        "percentage": 100
      },
      "nodes": {
        "nodes": [{ "nodeType": "forest", "required": 2, "visited": 1, "complete": false }],
        "complete": false,
        "percentage": 50
      },
      "allComplete": false
    }
  }
}
```

### POST `/accept`

Accept a quest.

**Request:**
```javascript
{
  "characterId": 1,
  "questTemplateId": 1
}
```

**Response:**
```javascript
{
  "success": true,
  "message": "Thornax has accepted the quest: Path of Fury",
  "quest": {
    "id": 42,
    "questName": "Path of Fury",
    "questDescription": "...",
    "targetClass": "berserker",
    "tier": 1
  }
}
```

### POST `/abandon/:characterId`

Abandon current quest. Progress is lost.

**Response:**
```javascript
{
  "success": true,
  "message": "Quest abandoned. You can start a new advancement quest at any time."
}
```

### GET `/boss/:characterId`

Check boss trial eligibility.

**Response (eligible):**
```javascript
{
  "characterId": 1,
  "eligible": true,
  "reason": "Ready to challenge the guildmaster",
  "bossConfig": {...},
  "targetClass": "berserker"
}
```

**Response (not eligible):**
```javascript
{
  "characterId": 1,
  "eligible": false,
  "reason": "Quest objectives not complete",
  "progress": {...}
}
```

### POST `/boss/start`

Start the boss trial battle.

**Request:**
```javascript
{
  "characterId": 1
}
```

**Requirements:**
- Character must be at a guild node
- Quest status must be 'boss_ready'
- Character not already in battle

**Response:**
```javascript
{
  "success": true,
  "message": "Boss trial against Vorn the Unyielding has begun!",
  "battleId": 123,
  "characterId": 1,
  "targetClass": "berserker",
  "mapSeed": 12345,
  "mapWidth": 32,
  "mapHeight": 32,
  "state": {...},  // Full battle state
  "guildmaster": {
    "name": "Vorn the Unyielding",
    "title": "Guildmaster of Warriors",
    "currentPhase": 1,
    "maxPhases": 1
  },
  "availableActions": {...}
}
```

### GET `/history/:characterId`

Get completed quest history.

**Response:**
```javascript
{
  "characterId": 1,
  "completedQuests": [
    {
      "questId": 42,
      "questName": "Path of Fury",
      "targetClass": "berserker",
      "tier": 1,
      "completedAt": "2026-01-10T15:30:00Z"
    }
  ]
}
```

---

## Progress Tracking

Quest progress is updated automatically through game hooks:

### Material Collection

Triggered when items drop from battles. The `itemDropService` calls `updateMaterialProgress()`.

```javascript
// advancementQuestService.js
export async function updateMaterialProgress(characterId, itemTemplateId, quantity = 1)
```

### Enemy Kills

Triggered when enemies are defeated in battle. Battle completion calls `updateEnemyProgress()`.

```javascript
// advancementQuestService.js
export async function updateEnemyProgress(characterId, enemyArchetype, count = 1)
```

### Node Visits

Triggered when traveling to new nodes. World travel calls `updateNodeProgress()`.

```javascript
// advancementQuestService.js
export async function updateNodeProgress(characterId, nodeId, nodeType)
```

### Status Transitions

```
active → boss_ready  (all objectives complete)
active → abandoned   (player abandons)
boss_ready → completed (boss defeated)
boss_ready → abandoned (player abandons)
```

When all objectives are complete, `checkAndUpdateQuestStatus()` automatically transitions the quest to 'boss_ready' and sets `boss_unlocked_at`.

---

## Boss Battle Mechanics

### Battle Configuration

Guildmaster battles are **solo** - only the challenging character participates against the guildmaster and disciples.

- **Scaling:** Guildmaster level = character level + 5
- **Disciples:** 2 units from lower tier classes
- **Phases:** Higher tier bosses have more phases

### Phase System

Phases trigger at HP thresholds:

1. Phase starts at 100% HP
2. When HP drops below threshold, phase transition occurs
3. Phase effects apply (stat modifiers, abilities, dialogue)
4. BossPhaseIndicator.js shows phase progression

Example phase configuration:
```javascript
{
  "threshold": 0.5,           // Triggers at 50% HP
  "name": "BLOOD RAGE",
  "abilities": ["rage_strike", "rampage"],
  "statMods": {
    "attack": 1.5,           // +50% attack
    "defense": 0.6           // -40% defense
  },
  "onEnter": {
    "effect": "berserk",     // Apply status effect
    "duration": 99
  }
}
```

### Victory Handling

On defeating the guildmaster:

1. Battle result sent to `completeQuest()`
2. Character class updated to target class
3. Stats recalculated for new class
4. Rewards distributed (gold, XP, title)
5. Quest status set to 'completed'
6. History record created in `advancement_battle_history`

---

## UI Components

### GuildAdvancementScene.js

Main scene for the guild advancement system.

**Features:**
- Quest board showing available/active quest
- Objective checklist with progress bars
- Guildmaster dialogue window
- Boss trial initiation
- Class advancement celebration

### BossPhaseIndicator.js

HUD component during boss battles.

**Displays:**
- Boss name and title
- Current HP bar
- Phase indicators (filled/empty dots)
- Phase name when transitioning

---

## Quest Templates (Seeded Data)

### Tier 1 Quests

| Guild | Quest Name | Materials | Enemies | Nodes | Rewards |
|-------|-----------|-----------|---------|-------|---------|
| Warrior → Berserker | Path of Fury | 5 Iron Ore | 10 Beasts | 2 Forest | 500g, 1000 XP |
| Wizard → Sorcerer | Arcane Awakening | 5 Arcane Crystal | 10 Magical | 2 Cave | 500g, 1000 XP |
| Monk → Ninja | Way of Shadows | 5 Shadow Essence | 10 Humanoid | 2 Mountain | 500g, 1000 XP |
| Chemist → Alchemist | Alchemical Foundation | 5 Philosopher's Dust | 10 Plant | 2 Forest | 500g, 1000 XP |

### Tier 2 Quests

| Guild | Quest Name | Materials | Enemies | Nodes | Rewards |
|-------|-----------|-----------|---------|-------|---------|
| Berserker → Paladin | Holy Oath | 8 Blessed Steel | 15 Undead | 3 Village | 1000g, 2500 XP |
| Sorcerer → Summoner | Pact of Summoning | 8 Spirit Binding Dust | 15 Elemental | 3 Cave | 1000g, 2500 XP |
| Ninja → Martial Artist | Perfect Form | 8 Tiger Claw | 15 Beast | 3 Mountain | 1000g, 2500 XP |
| Alchemist → Medic | Oath of Healing | 8 Lifeleaf Extract | 15 Plant | 3 Village | 1000g, 2500 XP |

---

## Helper Functions

### SQL Functions (Migration 020)

#### `can_start_advancement_quest(character_id, quest_template_id)`

Validates if a character can start a specific quest.

Checks:
- Character level >= 10
- No active quest
- Prerequisite class matches
- Base class for T1 quests

#### `check_quest_objectives_complete(quest_id)`

Returns TRUE if all objectives are satisfied.

Iterates through:
- Material requirements
- Enemy requirements
- Node requirements

---

## Related Files

| File | Purpose |
|------|---------|
| `api/src/routes/advancementQuest.js` | API endpoints |
| `api/src/services/advancementQuestService.js` | Quest business logic |
| `api/src/services/guildmasterBattleService.js` | Boss battle generation |
| `api/src/services/bossService.js` | Phase management |
| `api/src/migrations/020_guild_quest_system.sql` | Quest schema |
| `api/src/migrations/021_guildmaster_bosses.sql` | Boss schema + seeds |
| `frontend/src/scenes/GuildAdvancementScene.js` | Quest UI |
| `frontend/src/components/BossPhaseIndicator.js` | Boss HUD |

---

## Document History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | January 2026 | Initial documentation from code audit |
