# Modia - Quest System Overview

## Document Information

| Field | Value |
|-------|-------|
| Version | 2.0 |
| Last Updated | January 2026 |
| Purpose | Index document for all quest types |

---

## Overview

The quest system in Modia provides structured goals for character progression and player retention. There are two main quest categories:

1. **Guild Advancement Quests** - One-time quests for class progression
2. **Daily/Weekly Quests** - Repeatable quests for ongoing engagement

---

## Quest Types

### Guild Advancement Quests

> **Detailed Specification:** [GUILD_ADVANCEMENT.md](./GUILD_ADVANCEMENT.md)

Class advancement through guild hall quests. Each character can progress through 4 tiers of specialization per guild (warrior, wizard, monk, chemist).

**Key Features:**
- Material collection, enemy kills, node visit objectives
- Boss trial against guildmaster upon objective completion
- Class upgrade and stat recalculation on success
- One-time per tier (permanent progression)

**Database Tables:**
- `advancement_quest_templates` - Static quest definitions
- `character_quests` - Active/completed quest tracking
- `guildmaster_templates` - Boss configurations
- `advancement_battle_history` - Attempt records

**API Routes:** `/api/advancement/*`

---

### Daily/Weekly Quests

> **Detailed Specification:** [DAILY_WEEKLY_QUESTS.md](./DAILY_WEEKLY_QUESTS.md)

Repeatable quests that reset on a daily (UTC midnight) and weekly (Monday UTC midnight) basis. Designed for player retention and ongoing gold/XP rewards.

**Key Features:**
- 3 daily quests auto-assigned each day
- 2 weekly quests auto-assigned each week
- Variety of objective types (combat, exploration, activities, economy, social)
- Streak bonuses for consecutive daily completion (+10% per day, caps at +100%)
- Quest Board UI for tracking and claiming rewards

**Database Tables:**
- `daily_quest_templates` - Static quest pool
- `character_daily_quests` - Assigned quest tracking
- `daily_quest_history` - Completion history
- `character_login_streaks` - Streak tracking

**API Routes:** `/api/quests/*` (to be implemented)

---

## Common Patterns

### Progress Tracking

Both quest types use JSONB columns for flexible progress tracking:

```javascript
// Material progress
{ item_template_id: collected_count }

// Enemy progress
{ enemy_archetype: kill_count }

// Node progress
{ node_type: [visited_node_ids] }
```

Progress updates are triggered by hooks in existing game systems:
- Battle completion updates enemy kills and material drops
- World travel updates node visits
- Fishing/ruins/shop actions update activity counts

### Reward Distribution

Rewards are distributed upon quest completion and claim:

```javascript
{
  "gold": 500,
  "xp": 1000,
  "items": [{ "item_template_id": 1, "quantity": 1 }],
  "title": "Optional Title"
}
```

### Status Flow

**Advancement Quests:**
```
available → active → boss_ready → completed
                  ↘ abandoned
```

**Daily/Weekly Quests:**
```
assigned → in_progress → completed → claimed
                       ↘ expired (auto-removed at period end)
```

---

## Related Documentation

| Document | Description |
|----------|-------------|
| [GUILD_ADVANCEMENT.md](./GUILD_ADVANCEMENT.md) | Detailed guild advancement quest specification |
| [DAILY_WEEKLY_QUESTS.md](./DAILY_WEEKLY_QUESTS.md) | Detailed daily/weekly quest specification |
| [GAME_DESIGN.md](./GAME_DESIGN.md) | Overall game mechanics |
| [API_SPECIFICATION.md](./API_SPECIFICATION.md) | REST API endpoints |

---

## Document History

| Version | Date | Changes |
|---------|------|---------|
| 2.0 | January 2026 | Restructured as index document. Detailed content moved to GUILD_ADVANCEMENT.md. Added daily/weekly quest reference. |
| 1.0 | January 2026 | Initial guild advancement quest documentation |
