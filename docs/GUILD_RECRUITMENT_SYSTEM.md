# Guild Recruitment System

## Document Information

| Field | Value |
|-------|-------|
| Version | 1.0 |
| Last Updated | January 2026 |
| Status | Implemented |

---

## Overview

The Guild Recruitment System allows players to recruit permanent party members at guild nodes. Each guild offers class-specific recruits with randomized stats, traits, and starting skills.

### Key Features

- **Guild-Specific Recruits**: Each guild offers recruits of its class (Warriors Guild → Warriors)
- **Shared Pool**: 10 recruits per guild, first-come-first-served among all players
- **Daily Refresh**: Each guild refreshes at a unique time (staggered across 0, 6, 12, 18 UTC)
- **Emergency Restock**: 3 basic recruits spawn when all 10 are purchased
- **Trait System**: Permanent passive bonuses that apply in battle
- **Stat Variance**: ±15% from baseline creates unique recruits

---

## Recruit Generation

### Stat Variance

Each recruit has stats that vary from the race/class baseline:

```
variance = random(-15%, +15%)
final_stat = baseline_stat × (1 + variance)
```

All stats use the same variance percentage for that recruit.

### Trait Assignment

| Trait Count | Probability |
|-------------|-------------|
| 1 trait | 92% |
| 2 traits | 8% |

Trait rarity distribution:

| Rarity | Probability | Price Impact |
|--------|-------------|--------------|
| Common | 70% | - |
| Uncommon | 20% | - |
| Rare | 8% | - |
| Legendary | 2% | - |

Emergency restocks are capped at 1 trait maximum.

### Skill Assignment

| Skill Count | Probability |
|-------------|-------------|
| 0 skills | 60% |
| 1 skill | 30% |
| 2 skills | 10% |

Skills are selected from the class's tier 1-2 skills, excluding the starter skill.

### XP Pool

Each recruit starts with 50-150 XP in their pool, giving a small head start.

---

## Pricing Formula

```
Price = BASE_PRICE × (1 + stat_variance/100) + TRAIT_BONUS × (traits - 1) + SKILL_BONUS × skills
```

| Component | Value |
|-----------|-------|
| BASE_PRICE | 2,000g |
| TRAIT_BONUS | 8,000g per trait beyond first |
| SKILL_BONUS | 750g per starting skill |

### Price Examples

| Recruit Type | Price Range |
|--------------|-------------|
| Basic (1 common trait, 0 skills, avg stats) | ~2,000g |
| Good (1 trait, 1 skill, +10% stats) | ~2,900g |
| Premium (2 traits, 0 skills, avg stats) | ~10,000g |
| Exceptional (2 traits, 2 skills, +15% stats) | ~12,000g |

---

## Trait System

### Categories

**Combat (8 traits)**
- Physical/magical damage bonuses
- Critical hit chance and damage
- Accuracy and precision

**Survival (8 traits)**
- HP/MP bonuses
- Regeneration
- Damage resistance
- Death save (Second Wind)

**Utility (7 traits)**
- Movement range
- Initiative bonuses
- XP and gold bonuses
- Evasion

**Situational (8 traits)**
- Damage vs specific enemy types (dragons, undead, demons, bosses)
- Terrain movement bonuses
- Low-HP damage bonuses

### Trait Effects in Battle

Traits apply automatically during battle:

| Effect Type | Application Point |
|-------------|-------------------|
| Damage bonuses | calculatePhysicalDamage(), calculateMagicalDamage() |
| Crit bonuses | Damage calculation |
| HP/MP bonuses | Battle start (applyBattleStartTraits) |
| Movement bonus | getMovementRange() |
| Initiative | calculateInitiative() |
| HP regen | processStatusEffects() each turn |
| Lifesteal | After dealing damage |
| Death save | When damage would kill unit |

---

## Refresh System

### Daily Refresh

Each guild node has a unique refresh hour (0-23 UTC), staggered:
- Warrior Guild: One of 0, 6, 12, 18 UTC
- Wizard Guild: Different from Warrior
- Monk Guild: Different from above
- Chemist Guild: Different from above

At refresh time, all unpurchased recruits are replaced with 10 new ones.

### Lazy Refresh

Refresh is triggered on first access after the refresh time, not by a cron job. This reduces server load and ensures players always see fresh data.

### Emergency Restock

When all 10 recruits are purchased:
- 3 emergency recruits spawn immediately
- Emergency recruits have maximum 1 trait
- No further emergency restocks until daily refresh

---

## API Endpoints

### GET /api/guild/:nodeId/info

Returns guild information and refresh timing.

**Response:**
```json
{
  "nodeId": 5,
  "nodeName": "Warriors Guild Hall",
  "guildClass": "warrior",
  "recruitRefreshHour": 12,
  "lastRefresh": "2026-01-09T12:00:00.000Z",
  "nextRefresh": "2026-01-10T12:00:00.000Z",
  "recruitCount": 8,
  "actionLabel": "Recruit Soldier"
}
```

### GET /api/guild/:nodeId/recruits

Returns available recruits with traits and skills.

**Response:**
```json
{
  "nodeId": 5,
  "recruits": [
    {
      "id": 123,
      "name": "Roland",
      "race": "human",
      "gender": "male",
      "class": "warrior",
      "level": 1,
      "hp_max": 115,
      "mp_max": 52,
      "strength": 12,
      "intelligence": 10,
      "agility": 11,
      "vitality": 11,
      "luck": 10,
      "stat_variance_percent": 8.5,
      "xp_pool": 87,
      "price": 2170,
      "traits": [
        {
          "id": 5,
          "name": "Tough Skin",
          "description": "+5% HP",
          "category": "survival",
          "rarity": "common",
          "effect_type": "hp_bonus",
          "effect_value": 5.0
        }
      ],
      "skills": ["power_slash"]
    }
  ]
}
```

### POST /api/guild/:nodeId/recruit/:recruitId/purchase

Purchase a recruit and create a new character.

**Requirements:**
- User must have discovered the guild node
- User must have enough gold
- Recruit must not be already purchased
- User must have party slot available (< 12 characters)

**Response:**
```json
{
  "success": true,
  "message": "Successfully recruited Roland",
  "character": { /* full character object */ },
  "goldSpent": 2170,
  "remainingGold": 5830
}
```

---

## Database Schema

### Tables

```sql
-- Trait definitions
CREATE TABLE traits (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  description TEXT NOT NULL,
  category VARCHAR(20) NOT NULL,  -- combat, survival, utility, situational
  rarity VARCHAR(20) NOT NULL,    -- common, uncommon, rare, legendary
  effect_type VARCHAR(50) NOT NULL,
  effect_value DECIMAL(5,2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Guild recruit pool
CREATE TABLE guild_recruits (
  id SERIAL PRIMARY KEY,
  node_id INTEGER NOT NULL REFERENCES world_nodes(id),
  name VARCHAR(50) NOT NULL,
  race VARCHAR(20) NOT NULL,
  gender VARCHAR(20) NOT NULL,
  class VARCHAR(20) NOT NULL,
  level INTEGER DEFAULT 1,
  hp_max INTEGER NOT NULL,
  mp_max INTEGER NOT NULL,
  strength INTEGER NOT NULL,
  intelligence INTEGER NOT NULL,
  agility INTEGER NOT NULL,
  vitality INTEGER NOT NULL,
  luck INTEGER NOT NULL,
  stat_variance_percent DECIMAL(5,2) DEFAULT 0,
  xp_pool INTEGER NOT NULL,
  price INTEGER NOT NULL,
  is_emergency_restock BOOLEAN DEFAULT FALSE,
  purchased_by INTEGER REFERENCES users(id),
  purchased_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Recruit traits junction
CREATE TABLE recruit_traits (
  id SERIAL PRIMARY KEY,
  recruit_id INTEGER NOT NULL REFERENCES guild_recruits(id) ON DELETE CASCADE,
  trait_id INTEGER NOT NULL REFERENCES traits(id),
  UNIQUE(recruit_id, trait_id)
);

-- Recruit starting skills junction
CREATE TABLE recruit_skills (
  id SERIAL PRIMARY KEY,
  recruit_id INTEGER NOT NULL REFERENCES guild_recruits(id) ON DELETE CASCADE,
  skill_id VARCHAR(50) NOT NULL,
  UNIQUE(recruit_id, skill_id)
);

-- Character traits (permanent)
CREATE TABLE character_traits (
  id SERIAL PRIMARY KEY,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  trait_id INTEGER NOT NULL REFERENCES traits(id),
  acquired_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(character_id, trait_id)
);

-- Guild node refresh columns
ALTER TABLE world_nodes ADD COLUMN recruit_refresh_hour INTEGER;
ALTER TABLE world_nodes ADD COLUMN last_recruit_refresh TIMESTAMP;
```

---

## UI/UX

### Action Labels (Class-Specific)

| Guild | Action Button |
|-------|---------------|
| Warrior | "Recruit Soldier" |
| Wizard | "Take on Apprentice" |
| Monk | "Accept Initiate" |
| Chemist | "Hire Assistant" |

### RecruitmentScene

- **Header**: Guild name, action label, refresh countdown, player gold
- **Card Grid**: 10 parchment-style cards showing recruits
- **Empty Slots**: Show "Sold" for purchased recruits
- **Detail Panel**: Full stats, trait descriptions, skills, purchase button
- **Trait Indicators**: Colored by rarity (gray/green/blue/orange)

---

## Future Enhancements

### Planned (Deferred)

- **Character Sell-back/Marketplace** - Complex due to leveling, skills, equipment
- **Guild Reputation** - Discounts or better recruits based on standing
- **Recruit Quests** - Special high-quality recruits from completing guild quests
- **Advanced Class Recruits** - Higher level guilds offer advanced class recruits

### Suggested Improvements

Based on game design review:

**Critical Priority:**
- [ ] Add class-weighted trait selection (warriors more likely to get combat traits)
- [ ] Limit emergency restocks (1 per day, or cooldown between restocks)
- [ ] Scale recruit level with player progression

**Important:**
- [ ] Exponential pricing for stat variance (high variance should cost more)
- [ ] Recruit comparison tools (compare to existing party)
- [ ] Buff situational traits (currently too weak)
- [ ] Tier trait pricing by rarity (legendary costs more than common)

**Nice-to-Have:**
- [ ] Recruit backstory/personality generation
- [ ] Guild reputation system
- [ ] Reservation system (hold recruit for limited time)
- [ ] Trait codex (discover and track all traits)

---

## Files Reference

### Backend
- `api/src/migrations/012_guild_recruitment.sql` - Database schema
- `api/src/services/recruitService.js` - Recruit generation, pricing, purchase
- `api/src/services/traitService.js` - Trait effect calculations
- `api/src/routes/guild.js` - API endpoints
- `api/src/utils/nameGenerator.js` - Procedural name generation
- `api/src/db/seed.js` - Refresh hour assignment

### Frontend
- `frontend/public/src/scenes/RecruitmentScene.js` - Recruitment UI
- `frontend/public/src/scenes/WorldMapScene.js` - Guild integration
- `frontend/public/src/api/client.js` - API methods
- `frontend/public/src/battle/BattleUnit.js` - Trait indicators

### Shared
- `shared/nameData.js` - Race-specific name pools

---

## Document History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | Jan 2026 | Initial documentation for implemented system |
