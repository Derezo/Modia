# Modia - Daily/Weekly Quests

## Document Information

| Field | Value |
|-------|-------|
| Version | 1.0 |
| Last Updated | January 2026 |
| Purpose | Detailed specification for daily and weekly quest system |
| Parent Document | [QUEST_SYSTEM.md](./QUEST_SYSTEM.md) |
| Implementation Status | **COMPLETE** - Full backend, frontend, and progress tracking |

---

## Overview

Daily and weekly quests provide repeatable content loops for player retention. Unlike guild advancement quests (one-time progression), these quests reset on a regular schedule and offer scaling rewards.

### Design Goals

1. **Player Retention** - Give players a reason to log in daily
2. **Variety** - Diverse objective types covering all game systems
3. **Progression** - Streak bonuses reward consistent engagement
4. **Accessibility** - Quests appropriate for all character levels

---

## Quest Assignment

### Daily Quests

- **Count:** 3 quests auto-assigned per character
- **Reset:** UTC midnight (00:00 UTC)
- **Selection:** Weighted random from eligible pool based on character level
- **Behavior:** Quests expire and are replaced at next reset (uncompleted quests disappear)

### Weekly Quests

- **Count:** 2 quests auto-assigned per character
- **Reset:** Monday UTC midnight (00:00 UTC Monday)
- **Selection:** Weighted random from eligible pool based on character level
- **Behavior:** Quests expire and are replaced at next reset

### Selection Algorithm

```javascript
// Pseudocode for quest selection
function selectQuests(characterLevel, period, count) {
  const eligibleQuests = templates.filter(q =>
    q.period === period &&
    q.is_active &&
    q.min_level <= characterLevel &&
    q.max_level >= characterLevel
  );

  // Weighted random selection
  const selected = [];
  const totalWeight = eligibleQuests.reduce((sum, q) => sum + q.selection_weight, 0);

  while (selected.length < count && eligibleQuests.length > 0) {
    const random = Math.random() * totalWeight;
    let cumulative = 0;

    for (const quest of eligibleQuests) {
      cumulative += quest.selection_weight;
      if (random <= cumulative) {
        selected.push(quest);
        eligibleQuests.splice(eligibleQuests.indexOf(quest), 1);
        break;
      }
    }
  }

  return selected;
}
```

---

## Quest Access (UI)

### QuestBoardScene (New)

A dedicated scene for viewing and managing daily/weekly quests.

**Access Points:**
- Tavern nodes: "Quest Board" option in node menu
- World map header: Quest Board button (persistent access)

**Layout:**
```
┌─────────────────────────────────────────────────────────┐
│  QUEST BOARD                              [X] Close     │
├─────────────────────────────────────────────────────────┤
│  [Daily]  [Weekly]                    Streak: 🔥 5 days │
│                                       Bonus: +50%       │
├─────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────┐  │
│  │ 🗡️ Monster Hunter                    [✓ CLAIM]   │  │
│  │ Defeat 10 enemies in battle                       │  │
│  │ ████████████████████ 10/10                        │  │
│  │ Rewards: 200 gold, 100 XP (+50% bonus)           │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │ 🗺️ Explorer                          IN PROGRESS   │  │
│  │ Visit 5 different map nodes                       │  │
│  │ ████████░░░░░░░░░░░░ 3/5                          │  │
│  │ Rewards: 150 gold, 75 XP                          │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │ 🎣 Casual Angler                     IN PROGRESS   │  │
│  │ Catch 5 fish                                      │  │
│  │ ░░░░░░░░░░░░░░░░░░░░ 0/5                          │  │
│  │ Rewards: 150 gold, 75 XP                          │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ─────────────────────────────────────────────────────  │
│  Next Reset: 5h 23m                                     │
└─────────────────────────────────────────────────────────┘
```

**Features:**
- Daily/Weekly tab toggle
- Quest cards showing objective, progress bar, rewards
- CLAIM button when complete (per-quest)
- Streak display with current bonus percentage
- Countdown to next reset

---

## Quest Types & Objectives

Based on migration 034 seed data, the following objective types are supported:

### Combat Objectives

| Type | Description | Example Quests |
|------|-------------|----------------|
| `kill_enemies` | Defeat enemies in battle | "Defeat 10/20 enemies", "Defeat 15 specific type" |
| `complete_battles` | Win battles | "Win 3/5/20/50 battles" |

### Exploration Objectives

| Type | Description | Example Quests |
|------|-------------|----------------|
| `visit_nodes` | Travel to map nodes | "Visit 5/10 nodes", "Visit 3 taverns", "Visit 2 shrines" |
| `visit_regions` | Visit different regions | "Visit nodes in all 5 regions" |

### Activity Objectives

| Type | Description | Example Quests |
|------|-------------|----------------|
| `fish_catches` | Catch fish at fishing spots | "Catch 5/15/50 fish", "Catch 3 Big Ones" |
| `puzzle_solves` | Complete ruins puzzles | "Complete 1/3/10 puzzles" |

### Economy Objectives

| Type | Description | Example Quests |
|------|-------------|----------------|
| `gold_earned` | Earn gold from any source | "Earn 500/2000 gold" |
| `items_sold` | Sell items on marketplace | "Sell 3 items" |

### Social Objectives

| Type | Description | Example Quests |
|------|-------------|----------------|
| `coliseum_wins` | Win PvP matches | "Win 5/15 Coliseum matches" |
| `party_battles` | Complete battles with a party | "Complete 10 battles with a party" |

---

## Quest Templates (Seeded Data)

### Daily Quests

| Key | Name | Objective | Target | Rewards | Difficulty | Min Level |
|-----|------|-----------|--------|---------|------------|-----------|
| daily_kill_10_enemies | Monster Hunter | kill_enemies | 10 | 200g, 100 XP | easy | 1 |
| daily_kill_20_enemies | Seasoned Hunter | kill_enemies | 20 | 400g, 200 XP | normal | 5 |
| daily_kill_specific_type | Bounty Hunter | kill_enemies | 15 | 350g, 175 XP | normal | 5 |
| daily_battles_3 | Battle Ready | complete_battles | 3 | 300g, 150 XP | normal | 1 |
| daily_battles_5 | Veteran Fighter | complete_battles | 5 | 500g, 250 XP | hard | 10 |
| daily_visit_nodes_5 | Explorer | visit_nodes | 5 | 150g, 75 XP | easy | 1 |
| daily_visit_nodes_10 | Wanderer | visit_nodes | 10 | 300g, 150 XP | normal | 5 |
| daily_visit_taverns | Social Butterfly | visit_nodes (tavern) | 3 | 200g, 100 XP | normal | 1 |
| daily_visit_shrines | Pilgrim | visit_nodes (shrine) | 2 | 250g, 125 XP | normal | 5 |
| daily_fish_5 | Casual Angler | fish_catches | 5 | 150g, 75 XP | easy | 1 |
| daily_fish_15 | Dedicated Fisher | fish_catches | 15 | 350g, 175 XP | normal | 5 |
| daily_puzzle_1 | Puzzle Novice | puzzle_solves | 1 | 200g, 100 XP | normal | 5 |
| daily_puzzle_3 | Puzzle Master | puzzle_solves | 3 | 500g, 250 XP | hard | 10 |
| daily_gold_earned_500 | Gold Digger | gold_earned | 500 | 100g, 50 XP | easy | 1 |
| daily_gold_earned_2000 | Treasure Hunter | gold_earned | 2000 | 400g, 200 XP | normal | 10 |
| daily_sell_items_3 | Merchant | items_sold | 3 | 300g, 150 XP | normal | 5 |

### Weekly Quests

| Key | Name | Objective | Target | Rewards | Difficulty | Min Level |
|-----|------|-----------|--------|---------|------------|-----------|
| weekly_kill_100_enemies | Warmonger | kill_enemies | 100 | 2000g, 1000 XP | normal | 1 |
| weekly_kill_200_enemies | Slayer | kill_enemies | 200 | 4000g, 2000 XP | hard | 10 |
| weekly_battles_20 | Battle Commander | complete_battles | 20 | 2500g, 1250 XP | normal | 5 |
| weekly_battles_50 | War Hero | complete_battles | 50 | 5000g, 2500 XP | elite | 20 |
| weekly_visit_nodes_30 | Cartographer | visit_nodes | 30 | 1500g, 750 XP | normal | 1 |
| weekly_visit_all_regions | World Traveler | visit_regions | 5 | 3000g, 1500 XP | hard | 10 |
| weekly_fish_50 | Master Angler | fish_catches | 50 | 1500g, 750 XP | normal | 1 |
| weekly_fish_big_one | Big Game Fisher | fish_catches (big_one) | 3 | 3000g, 1500 XP | hard | 10 |
| weekly_puzzle_10 | Archaeologist | puzzle_solves | 10 | 2500g, 1250 XP | normal | 5 |
| weekly_coliseum_5 | Arena Champion | coliseum_wins | 5 | 2000g, 1000 XP | normal | 15 |
| weekly_coliseum_15 | Coliseum Legend | coliseum_wins | 15 | 5000g, 2500 XP | elite | 20 |
| weekly_party_battles_10 | Team Player | party_battles | 10 | 2000g, 1000 XP | normal | 5 |

---

## Progress Tracking

Progress is updated automatically through hooks in existing game systems.

### Integration Points

| Objective Type | Service Hook | Trigger Point |
|----------------|--------------|---------------|
| kill_enemies | battleService.js | Battle completion, enemy defeat |
| complete_battles | battleService.js | Battle victory |
| visit_nodes | world.js | Travel to node |
| visit_regions | world.js | Travel to new region |
| fish_catches | fishingService.js | Fish caught |
| puzzle_solves | ruins.js | Puzzle completed |
| gold_earned | Various | Gold added to character |
| items_sold | marketplace.js | Marketplace sale confirmed |
| coliseum_wins | coliseumService.js | PvP victory |
| party_battles | battleService.js | Party battle victory |

### Progress Update Flow

```javascript
// Example: Battle completion hook
async function onBattleComplete(characterId, battleResult) {
  if (battleResult.victory) {
    // Update kill count
    await dailyQuestService.updateProgress(
      characterId,
      'kill_enemies',
      battleResult.enemiesDefeated
    );

    // Update battle count
    await dailyQuestService.updateProgress(
      characterId,
      'complete_battles',
      1
    );

    // Check party battle
    if (battleResult.wasPartyBattle) {
      await dailyQuestService.updateProgress(
        characterId,
        'party_battles',
        1
      );
    }
  }
}
```

---

## Reward System

### Base Rewards

Rewards are defined per-quest in the template:
```javascript
{
  "gold": 500,
  "xp": 250,
  "items": []  // Optional item rewards
}
```

### Streak Bonuses

Consecutive daily quest completion grants bonus rewards:

| Streak Days | Bonus Multiplier |
|-------------|------------------|
| 1 | +0% (base) |
| 2 | +10% |
| 3 | +20% |
| 4 | +30% |
| 5 | +40% |
| 6 | +50% |
| 7 | +60% |
| 8 | +70% |
| 9 | +80% |
| 10+ | +100% (cap) |

**Streak Rules:**
- Streak increments when at least 1 daily quest is completed before next reset
- Streak resets to 0 if no daily quests are completed before reset
- Weekly quests do not affect streak
- Streak bonus applies to all daily quest rewards

### Reward Calculation

```javascript
function calculateReward(baseReward, streakDays) {
  const bonusPercent = Math.min(streakDays - 1, 10) * 10;
  const multiplier = 1 + (bonusPercent / 100);

  return {
    gold: Math.floor(baseReward.gold * multiplier),
    xp: Math.floor(baseReward.xp * multiplier)
  };
}
```

### Claiming Rewards

- Rewards must be manually claimed via CLAIM button
- Claimed rewards are immediately added to character
- Unclaimed rewards expire at period reset (forfeited)

---

## Database Schema

### Tables (Migration 034)

#### `daily_quest_templates`

Static quest definitions.

| Column | Type | Description |
|--------|------|-------------|
| id | SERIAL | Primary key |
| quest_key | VARCHAR(50) | Unique internal key |
| period | quest_period | 'daily' or 'weekly' |
| quest_name | VARCHAR(100) | Display name |
| quest_description | TEXT | Objective description |
| objective_type | VARCHAR(30) | Type of objective |
| objective_requirements | JSONB | Additional requirements |
| target_count | INTEGER | Count needed to complete |
| rewards | JSONB | Gold, XP, items |
| difficulty | VARCHAR(20) | easy/normal/hard/elite |
| selection_weight | INTEGER | Random selection weight |
| min_level | INTEGER | Minimum character level |
| max_level | INTEGER | Maximum character level |
| is_active | BOOLEAN | In active rotation |

#### `character_daily_quests`

Assigned quests per character.

| Column | Type | Description |
|--------|------|-------------|
| id | SERIAL | Primary key |
| character_id | INTEGER | FK to characters |
| quest_template_id | INTEGER | FK to daily_quest_templates |
| period | quest_period | 'daily' or 'weekly' |
| current_progress | INTEGER | Current count |
| target_progress | INTEGER | Target count (copied from template) |
| is_completed | BOOLEAN | Objective met |
| rewards_claimed | BOOLEAN | Rewards collected |
| period_start | TIMESTAMP | Start of assignment period |
| period_end | TIMESTAMP | Expiration time |
| assigned_at | TIMESTAMP | When assigned |
| completed_at | TIMESTAMP | When completed |
| claimed_at | TIMESTAMP | When claimed |

#### `daily_quest_history`

Completion records for statistics.

| Column | Type | Description |
|--------|------|-------------|
| id | SERIAL | Primary key |
| character_id | INTEGER | FK to characters |
| quest_template_id | INTEGER | FK to daily_quest_templates |
| period | quest_period | 'daily' or 'weekly' |
| rewards_granted | JSONB | Actual rewards given |
| period_start | TIMESTAMP | Period of completion |
| completed_at | TIMESTAMP | Completion time |
| consecutive_days | INTEGER | Streak at completion |

#### `character_login_streaks`

Streak tracking per character.

| Column | Type | Description |
|--------|------|-------------|
| character_id | INTEGER | PK, FK to characters |
| current_streak | INTEGER | Current consecutive days |
| longest_streak | INTEGER | All-time record |
| last_login_date | DATE | Last activity date |
| last_daily_reset | TIMESTAMP | Last daily refresh |
| last_weekly_reset | TIMESTAMP | Last weekly refresh |

### Helper Functions

```sql
-- Get current daily period start (UTC midnight today)
get_daily_period_start() → TIMESTAMP

-- Get current weekly period start (Monday UTC midnight)
get_weekly_period_start() → TIMESTAMP

-- Get period end based on period type
get_period_end(period, start) → TIMESTAMP

-- Check if character needs daily quest refresh
needs_daily_quest_refresh(character_id) → BOOLEAN

-- Check if character needs weekly quest refresh
needs_weekly_quest_refresh(character_id) → BOOLEAN
```

---

## API Endpoints

Base path: `/api/quests`

### GET `/daily/:characterId`

Get current daily quests with progress.

**Response:**
```javascript
{
  "characterId": 1,
  "dailyQuests": [
    {
      "id": 42,
      "questKey": "daily_kill_10_enemies",
      "questName": "Monster Hunter",
      "questDescription": "Defeat 10 enemies in battle",
      "objectiveType": "kill_enemies",
      "currentProgress": 7,
      "targetProgress": 10,
      "isCompleted": false,
      "rewardsClaimed": false,
      "rewards": { "gold": 200, "xp": 100 },
      "difficulty": "easy"
    }
    // ... 2 more quests
  ],
  "periodEnd": "2026-01-20T00:00:00Z",
  "streak": {
    "currentStreak": 5,
    "bonusPercent": 50
  }
}
```

### GET `/weekly/:characterId`

Get current weekly quests with progress.

**Response:**
```javascript
{
  "characterId": 1,
  "weeklyQuests": [
    {
      "id": 43,
      "questKey": "weekly_kill_100_enemies",
      "questName": "Warmonger",
      "questDescription": "Defeat 100 enemies in battle",
      "objectiveType": "kill_enemies",
      "currentProgress": 45,
      "targetProgress": 100,
      "isCompleted": false,
      "rewardsClaimed": false,
      "rewards": { "gold": 2000, "xp": 1000 },
      "difficulty": "normal"
    }
    // ... 1 more quest
  ],
  "periodEnd": "2026-01-27T00:00:00Z"
}
```

### POST `/:questId/claim`

Claim rewards for a completed quest.

**Request:**
```javascript
{
  "characterId": 1
}
```

**Response (success):**
```javascript
{
  "success": true,
  "message": "Rewards claimed for Monster Hunter!",
  "rewards": {
    "gold": 300,  // Includes 50% streak bonus
    "xp": 150,
    "items": []
  },
  "newGoldTotal": 5300,
  "newXpTotal": 12150
}
```

**Response (error):**
```javascript
{
  "success": false,
  "error": "Quest not completed or already claimed"
}
```

### GET `/streaks/:characterId`

Get streak information.

**Response:**
```javascript
{
  "characterId": 1,
  "currentStreak": 5,
  "longestStreak": 12,
  "bonusPercent": 50,
  "lastLoginDate": "2026-01-19",
  "streakWillResetAt": "2026-01-20T00:00:00Z"
}
```

---

## Frontend Components

### QuestBoardScene.js (New)

Main scene for quest management.

**State:**
```javascript
{
  activeTab: 'daily',  // 'daily' | 'weekly'
  quests: [],
  streak: { currentStreak: 0, bonusPercent: 0 },
  periodEnd: null,
  loading: false
}
```

**Methods:**
- `loadDailyQuests()` - Fetch daily quests from API
- `loadWeeklyQuests()` - Fetch weekly quests from API
- `claimReward(questId)` - POST to claim endpoint
- `renderQuestCard(quest)` - Draw individual quest card
- `renderStreakDisplay()` - Draw streak info and bonus

### QuestProgressHook.js (New)

Service for updating quest progress from game events.

```javascript
// Called from various services
export async function updateQuestProgress(characterId, objectiveType, amount) {
  const response = await api.post('/api/quests/progress', {
    characterId,
    objectiveType,
    amount
  });

  // Optionally show toast for quest completion
  if (response.completedQuests.length > 0) {
    parchmentToast.success(`Quest complete: ${response.completedQuests[0].questName}`);
  }
}
```

### Integration with Existing Scenes

**WorldMapScene.js:**
- Add Quest Board button to header (next to Formation button)
- Show notification badge when quests are claimable

**TavernScene.js:**
- Add "Quest Board" option in node menu
- Navigate to QuestBoardScene on selection

---

## Implementation Checklist

### Backend

- [ ] Create `dailyQuestService.js` with core logic
- [ ] Add quest assignment on character login
- [ ] Add progress update hooks to battle, world, fishing, ruins, marketplace services
- [ ] Create API endpoints (daily, weekly, claim, streaks)
- [ ] Add streak calculation and bonus logic
- [ ] Schedule periodic cleanup of expired quests

### Frontend

- [ ] Create `QuestBoardScene.js` with tab UI
- [ ] Create quest card component with progress bar
- [ ] Add streak display with fire emoji animation
- [ ] Add CLAIM button with success animation
- [ ] Integrate Quest Board button in WorldMapScene header
- [ ] Add Quest Board option to TavernScene
- [ ] Add notification badge for claimable quests

### Testing

- [ ] Unit tests for quest selection algorithm
- [ ] Unit tests for streak calculation
- [ ] Integration tests for progress updates
- [ ] Integration tests for reward claiming
- [ ] E2E test for full quest flow

---

## Related Documents

- [QUEST_SYSTEM.md](./QUEST_SYSTEM.md) - Parent document for all quest systems
- [GUILD_ADVANCEMENT.md](./GUILD_ADVANCEMENT.md) - One-time guild advancement quests
- [ECONOMY_SYSTEM.md](./ECONOMY_SYSTEM.md) - Gold rewards, economy balance
- [GAME_DESIGN.md](./GAME_DESIGN.md) - Combat mechanics, progression systems
- [TECHNICAL_ARCHITECTURE.md](./TECHNICAL_ARCHITECTURE.md) - Database schemas, service architecture
- [API_SPECIFICATION.md](./API_SPECIFICATION.md) - Quest API endpoint definitions

---

## Document History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | January 2026 | Initial specification based on migration 034 schema |
