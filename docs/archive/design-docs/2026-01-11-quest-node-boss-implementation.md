# Implementation Plan: Quest System, Node Blocking, and Boss Integration

## Overview

This plan implements three interconnected systems for guild-based class advancement:
1. **Guild Quest System** - Level 10+ quest chains for class advancement
2. **Node Blocking System** - Combat nodes must be cleared to pass through
3. **Boss Integration** - Complete existing boss system + guildmaster battles

---

## Design Decisions Summary

| Decision | Choice |
|----------|--------|
| Advancement level requirement | Level 10 |
| Quest requirements | Mixed: materials + enemy kills + node visits |
| Advancement paths per guild | 4 tiers (16 total advanced classes) |
| Quest difficulty | Hybrid: harder quests + harder bosses + harder zones |
| Node blocking | Hard block on ALL combat nodes |
| Quest tracking | One advancement quest per character |
| Guild hall UI | Hybrid: quest board overview + guildmaster NPC dialog |
| Boss design | Guildmaster (target class) + disciples (lower tiers) |

### Tier Ordering (T1-T4 by difficulty)

| Guild | T1 | T2 | T3 | T4 |
|-------|----|----|----|----|
| Warrior | Berserker | Paladin | Guardian | Warlord |
| Wizard | Sorcerer | Summoner | Conjurer | Oracle (debuff/status) |
| Monk | Ninja | Martial Artist | Brawler | Ascetic |
| Chemist | Alchemist | Medic | Plague Doctor | Artificer |

### Quest Scaling by Tier

| Component | T1 | T2 | T3 | T4 |
|-----------|----|----|----|----|
| Materials | 5 common | 8 uncommon | 12 rare | 15 rare + 3 epic |
| Enemy kills | 10 easy zone | 15 mid zone | 20 hard zone | 25 + elites |
| Nodes visited | 2 | 3 | 4 | 5 (dangerous) |
| Boss phases | 1 | 2 | 2 + summons | 3 + auras + enrage |

### Boss Composition

- **Guildmaster** = Fully mastered version of TARGET class
- **Disciples** = Lower tier classes from same guild tree
- Example: Warrior → Warlord (T4) = Warlord boss + Warrior + Paladin + Berserker + Guardian disciples

---

## Phase 1: Database Migrations

### Migration 019: Node Blocking System

**File:** `api/src/migrations/019_node_blocking.sql`

```sql
CREATE TABLE user_node_clearance (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  node_id INTEGER NOT NULL REFERENCES world_nodes(id) ON DELETE CASCADE,
  cleared_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  battle_id INTEGER REFERENCES battles(id),
  UNIQUE(user_id, node_id)
);

CREATE INDEX idx_user_clearance_user ON user_node_clearance(user_id);
CREATE INDEX idx_user_clearance_node ON user_node_clearance(node_id);
```

### Migration 020: Quest System

**File:** `api/src/migrations/020_guild_quest_system.sql`

```sql
CREATE TABLE advancement_quest_templates (
  id SERIAL PRIMARY KEY,
  guild_id VARCHAR(20) NOT NULL,
  tier INTEGER NOT NULL CHECK (tier >= 1 AND tier <= 4),
  target_class VARCHAR(30) NOT NULL,
  prerequisite_class VARCHAR(30),
  quest_name VARCHAR(100) NOT NULL,
  quest_description TEXT NOT NULL,
  material_requirements JSONB NOT NULL DEFAULT '[]',
  enemy_requirements JSONB NOT NULL DEFAULT '[]',
  node_requirements JSONB NOT NULL DEFAULT '[]',
  boss_config JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_guild_tier UNIQUE (guild_id, tier)
);

CREATE TABLE character_quests (
  id SERIAL PRIMARY KEY,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  quest_template_id INTEGER NOT NULL REFERENCES advancement_quest_templates(id),
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'boss_ready', 'completed', 'abandoned')),
  material_progress JSONB DEFAULT '{}',
  enemy_progress JSONB DEFAULT '{}',
  node_progress JSONB DEFAULT '{}',
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  CONSTRAINT one_active_quest UNIQUE (character_id) WHERE status IN ('active', 'boss_ready')
);
```

### Migration 021: Guildmaster Bosses

**File:** `api/src/migrations/021_guildmaster_bosses.sql`

```sql
CREATE TABLE guildmaster_templates (
  id SERIAL PRIMARY KEY,
  guild_class VARCHAR(32) NOT NULL UNIQUE,
  guild_tier INTEGER NOT NULL CHECK (guild_tier BETWEEN 1 AND 4),
  name VARCHAR(128) NOT NULL,
  title VARCHAR(128),
  sprite_id VARCHAR(64) NOT NULL,
  base_level INTEGER DEFAULT 50,
  base_hp INTEGER NOT NULL,
  base_mp INTEGER NOT NULL,
  base_strength INTEGER NOT NULL,
  base_intelligence INTEGER NOT NULL,
  base_agility INTEGER NOT NULL,
  base_vitality INTEGER NOT NULL,
  attack_bonus INTEGER DEFAULT 0,
  defense_bonus INTEGER DEFAULT 0,
  skills JSONB NOT NULL DEFAULT '[]',
  phases JSONB NOT NULL DEFAULT '[]',
  disciple_count INTEGER DEFAULT 2,
  disciple_classes JSONB DEFAULT '[]',
  ai_type VARCHAR(32) DEFAULT 'tactical',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE battles
  ADD COLUMN IF NOT EXISTS is_advancement_battle BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS challenger_character_id INTEGER REFERENCES characters(id);
```

---

## Phase 2: Backend Implementation

### 2.1 Node Blocking (world.js)

**Critical File:** `api/src/routes/world.js`

**Changes:**
1. Add `getBlockedNodes(userId)` helper function
2. Modify `bfsPath()` to skip blocked intermediate nodes (allow destination)
3. Update `findWorldPath()` to accept userId and use blocking
4. Enhance `/api/world/nodes` response with `cleared` and `blocked` fields
5. Enhance `/api/world/path/:targetNodeId` with `blockedNodes` array
6. Update `/api/world/travel` to validate path not blocked

### 2.2 Node Clearance on Victory (battle.js)

**Critical File:** `api/src/routes/battle.js`

**Add to `handleBattleEnd()`:**
```javascript
if (status === 'victory' && nodeId) {
  await query(
    `INSERT INTO user_node_clearance (user_id, node_id, battle_id)
     VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [userId, nodeId, battleId]
  );
}
```

### 2.3 Quest Service

**New File:** `api/src/services/advancementQuestService.js`

**Functions:**
- `getAvailableQuests(characterId)` - Returns quests character can start
- `acceptQuest(characterId, questTemplateId)` - Creates character_quest
- `getQuestProgress(characterId)` - Returns progress breakdown
- `updateMaterialProgress(characterId, itemId, quantity)`
- `updateEnemyProgress(characterId, enemyType)`
- `updateNodeProgress(characterId, nodeId, nodeType)`
- `checkQuestCompletion(characterId)` - Returns true if objectives met
- `canStartBossTrial(characterId)` - Validates ready for boss
- `completeQuest(characterId)` - Applies class advancement
- `abandonQuest(characterId)` - Clears progress

### 2.4 Quest Routes

**New File:** `api/src/routes/advancementQuest.js`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/advancement/available/:characterId` | Available quests |
| GET | `/api/advancement/current/:characterId` | Active quest + progress |
| POST | `/api/advancement/accept` | Accept quest |
| POST | `/api/advancement/abandon/:characterId` | Abandon quest |
| POST | `/api/advancement/boss/start` | Start solo boss trial |
| POST | `/api/advancement/complete/:characterId` | Complete and advance |

### 2.5 Remove Old Advancement

**Critical File:** `api/src/routes/skills.js`

**Remove lines 201-328:** Auto-advancement at level 20

### 2.6 Boss Integration

**Critical File:** `api/src/services/bossService.js` (already 70% complete)

**Add to `api/src/routes/battle.js` after enemy generation:**
```javascript
initialState.bossStates = {};
for (const enemy of enemies) {
  if (bossService.isBoss(enemy)) {
    const bossState = bossService.initializeBossState(enemy, battleId);
    initialState.bossStates[enemy.id] = bossState;
    enemy.isBoss = true;
    enemy.currentPhase = bossState.currentPhase;
    enemy.maxPhases = bossState.maxPhases;
  }
}
```

**Add to `api/src/services/battleService.js` after damage:**
```javascript
if (target.type === 'enemy' && state.bossStates?.[target.id]) {
  const transition = bossService.processBossDamage(target, state.bossStates[target.id], damage, state);
  if (transition) result.phaseTransition = transition;
}
```

### 2.7 Guildmaster Battle Service

**New File:** `api/src/services/guildmasterBattleService.js`

**Functions:**
- `generateGuildmasterBattle(character, targetClass)` - Creates solo battle state
- `createGuildmasterUnit(template, challengerLevel)` - Scales boss stats
- `generateDisciples(template, challengerLevel)` - Creates disciple units
- `createSoloPlayerUnit(character)` - Single character unit

### 2.8 WebSocket Events

**Add to `api/src/services/battleWebsocket.js`:**

```javascript
async function broadcastPhaseTransition(battleId, transition) {
  ws.broadcastToRoom(`battle:${battleId}`, {
    type: 'battle:phase_transition',
    payload: { battleId, ...transition, timestamp: Date.now() }
  });
}
```

---

## Phase 3: Frontend Implementation

### 3.1 Node Blocking Visuals (WorldMapScene.js)

**Critical File:** `frontend/src/scenes/WorldMapScene.js`

**Changes:**
1. Update `loadWorldData()` to use new node properties (`cleared`, `blocked`)
2. Add blocked indicator: red tint + lock icon
3. Add cleared indicator: green checkmark
4. Modify path preview to highlight blocked nodes in red
5. Update travel error handling for blocking messages

### 3.2 Guild Advancement Scene

**New File:** `frontend/src/scenes/GuildAdvancementScene.js`

**Layout:**
- Header: Guild name, character info
- Left: Quest board (4 advancement paths with requirements)
- Right: Guildmaster dialog panel
- Bottom: Action buttons (Accept/Abandon/Start Trial)

### 3.3 Quest Components

**New Files:**
- `frontend/src/components/QuestBoard.js` - Available quests display
- `frontend/src/components/QuestJournal.js` - Active quest progress
- `frontend/src/components/GuildmasterDialog.js` - NPC interaction

### 3.4 Boss Phase Indicator

**New File:** `frontend/src/battle/BossPhaseIndicator.js`

**Features:**
- Boss name and title
- Phase name display
- Phase dots (filled for completed phases)
- HP bar
- Phase transition animation

**Integration in BattleScene.js:**
```javascript
import { BossPhaseIndicator } from '../battle/BossPhaseIndicator.js';

// In enter()
if (data.state.bossStates) {
  this.bossPhaseIndicator = new BossPhaseIndicator(this.game);
}

// WebSocket handler
wsClient.on('battle:phase_transition', (payload) => {
  this.bossPhaseIndicator?.playPhaseTransition(payload);
});
```

---

## Phase 4: Shared Constants

**File:** `shared/constants.js`

```javascript
export const GUILD_ADVANCEMENT_TIERS = {
  warrior: ['berserker', 'paladin', 'guardian', 'warlord'],
  wizard: ['sorcerer', 'summoner', 'conjurer', 'oracle'],
  monk: ['ninja', 'martial_artist', 'brawler', 'ascetic'],
  chemist: ['alchemist', 'medic', 'plague_doctor', 'artificer']
};

export const ADVANCEMENT_QUEST_MIN_LEVEL = 10;

export const TIER_REQUIREMENTS = {
  1: { materials: 5, enemies: 10, nodes: 2, bossPhases: 1 },
  2: { materials: 8, enemies: 15, nodes: 3, bossPhases: 2 },
  3: { materials: 12, enemies: 20, nodes: 4, bossPhases: 2, hasSummons: true },
  4: { materialsRare: 15, materialsEpic: 3, enemies: 25, nodes: 5, bossPhases: 3 }
};
```

---

## Implementation Order

### Week 1: Foundation
1. Create migrations (019, 020, 021)
2. Add shared constants
3. Seed T1/T2 quest and boss templates
4. Implement node blocking (backend)
5. Remove old auto-advancement code

### Week 2: Quest System
1. Create advancementQuestService.js
2. Create quest API routes
3. Integrate progress tracking (battle, world, inventory hooks)
4. Create GuildAdvancementScene frontend

### Week 3: Boss Integration
1. Complete existing boss system integration
2. Create guildmasterBattleService.js
3. Implement solo battle mode
4. Add WebSocket phase events

### Week 4: Frontend & Polish
1. Implement node blocking visuals
2. Create BossPhaseIndicator component
3. Create quest UI components
4. Balance testing and edge cases

---

## Critical Files Summary

| System | File | Changes |
|--------|------|---------|
| Node Blocking | `api/src/routes/world.js` | BFS blocking, clearance API |
| Node Blocking | `api/src/routes/battle.js` | Victory clearance insert |
| Node Blocking | `frontend/src/scenes/WorldMapScene.js` | Visual indicators |
| Quest System | `api/src/services/advancementQuestService.js` | New file |
| Quest System | `api/src/routes/advancementQuest.js` | New file |
| Quest System | `api/src/routes/skills.js` | Remove lines 201-328 |
| Boss System | `api/src/services/bossService.js` | Already exists (integrate) |
| Boss System | `api/src/routes/battle.js` | Boss state init, phase detection |
| Boss System | `api/src/services/battleService.js` | Phase transition after damage |
| Boss System | `api/src/services/guildmasterBattleService.js` | New file |
| Frontend | `frontend/src/scenes/GuildAdvancementScene.js` | New file |
| Frontend | `frontend/src/battle/BossPhaseIndicator.js` | New file |

---

## Verification Plan

### Unit Tests
- Quest progress tracking (material, enemy, node)
- Node clearance on victory
- BFS pathfinding with blocked nodes
- Boss phase transitions

### Integration Tests
- Full quest acceptance → completion flow
- Advancement battle generation
- WebSocket phase transition events

### E2E Tests
- Travel blocked by uncleared node
- Quest UI interaction flow
- Complete advancement quest and verify class change

### Manual Testing
- Play through T1 advancement quest for each guild
- Verify boss phase animations
- Test edge cases: disconnect during boss fight, abandon quest
