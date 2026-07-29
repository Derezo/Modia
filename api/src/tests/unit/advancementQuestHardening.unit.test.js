import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

import {
  abandonQuestWithClient,
  acceptQuestWithClient,
  calculateEnemyProgress,
  calculateMaterialProgress,
  calculateNodeProgress,
  completeQuestWithClient,
  getAdvancementGuildLocationError,
  getAdvancementNodeIdError,
  getGuildForClass,
  getNextAdvancementStep
} from '../../services/advancementQuestService.js';
import {
  buildGuildmasterCreationKey,
  persistAdvancementBattleIdentity,
  reserveGuildmasterBattleAttempt,
  resolveGuildmasterOpponentClass
} from '../../services/guildmasterBattleService.js';

describe('advancement quest hardening', () => {
  it('maps base and advanced classes to their owning guild', () => {
    assert.equal(getGuildForClass('warrior'), 'warrior');
    assert.equal(getGuildForClass('berserker'), 'warrior');
    assert.equal(getGuildForClass('summoner'), 'wizard');
    assert.equal(getGuildForClass('martial_artist'), 'monk');
    assert.equal(getGuildForClass('medic'), 'chemist');
    assert.equal(getGuildForClass('unknown'), null);
  });

  it('requires the exact current node and matching character, quest, and node guilds', () => {
    const character = {
      class: 'berserker',
      current_node_id: 12
    };
    const node = {
      id: 12,
      node_type: 'guild',
      guild_class: 'warrior'
    };

    assert.equal(
      getAdvancementGuildLocationError(character, node, 12, 'warrior'),
      null
    );
    assert.equal(
      getAdvancementGuildLocationError(character, node, 13, 'warrior'),
      'Character is not at the selected guild node'
    );
    assert.equal(
      getAdvancementGuildLocationError(character, node, 12, 'wizard'),
      'Advancement quest does not match the character guild'
    );
    assert.equal(
      getAdvancementGuildLocationError(
        character,
        { ...node, guild_class: 'wizard' },
        12,
        'warrior'
      ),
      'Selected guild does not match the advancement quest guild'
    );
  });

  it('requires a positive integer node ID for advancement writes', () => {
    assert.equal(getAdvancementNodeIdError(undefined), 'nodeId is required');
    assert.equal(getAdvancementNodeIdError(null), 'nodeId is required');
    assert.equal(getAdvancementNodeIdError('12'), 'Valid nodeId is required');
    assert.equal(getAdvancementNodeIdError(0), 'Valid nodeId is required');
    assert.equal(getAdvancementNodeIdError(12), null);
  });

  it('derives the exact next tier from the locked character state', () => {
    assert.deepEqual(
      getNextAdvancementStep({ class: 'wizard', level: 10 }),
      {
        guildId: 'wizard',
        tier: 1,
        prerequisiteClass: null,
        targetClass: 'sorcerer'
      }
    );
    assert.deepEqual(
      getNextAdvancementStep({ class: 'sorcerer', level: 20 }),
      {
        guildId: 'wizard',
        tier: 2,
        prerequisiteClass: 'sorcerer',
        targetClass: 'summoner'
      }
    );
    assert.equal(
      getNextAdvancementStep({ class: 'wizard', level: 9 }),
      null
    );
    assert.equal(
      getNextAdvancementStep({ class: 'wizard' }),
      null
    );
  });

  it('revalidates the requested template after locking the character', async () => {
    const calls = [];
    const client = {
      async query(sql, params) {
        calls.push({ sql, params });
        if (sql.includes('FROM characters')) {
          return {
            rows: [{
              id: 7,
              class: 'sorcerer',
              level: 20,
              current_node_id: 12
            }]
          };
        }
        if (sql.includes('FROM character_quests')) {
          return { rows: [] };
        }
        if (sql.includes('FROM advancement_quest_templates')) {
          assert.deepEqual(params, [41, 'wizard', 2, 'sorcerer', 'summoner']);
          return { rows: [] };
        }
        throw new Error(`Unexpected query: ${sql}`);
      }
    };

    await assert.rejects(
      acceptQuestWithClient(client, 7, 41, 12),
      /Quest not available for this character/
    );
    assert.match(calls[0].sql, /FOR UPDATE/);
    assert.match(calls[2].sql, /target_class = \$5/);
  });

  it('keeps objective display metadata in calculated progress DTOs', () => {
    const materials = calculateMaterialProgress([
      {
        item_template_id: 7,
        quantity: 3,
        rarity: 'uncommon',
        name: 'Blessed Steel'
      }
    ], { 7: 2 });
    const enemies = calculateEnemyProgress([
      {
        enemy_archetype: 'undead',
        count: 4,
        zone_tier: 2,
        name: 'Restless Dead'
      }
    ], { undead: 4 });
    const nodes = calculateNodeProgress([
      {
        node_type: 'village',
        count: 2,
        min_tier: 1,
        name: 'Sacred Villages'
      }
    ], { village: [5] });

    assert.deepEqual(materials.items[0], {
      itemTemplateId: 7,
      name: 'Blessed Steel',
      rarity: 'uncommon',
      required: 3,
      collected: 2,
      complete: false
    });
    assert.deepEqual(enemies.enemies[0], {
      enemyArchetype: 'undead',
      name: 'Restless Dead',
      zoneTier: 2,
      required: 4,
      killed: 4,
      complete: true
    });
    assert.deepEqual(nodes.nodes[0], {
      nodeType: 'village',
      name: 'Sacred Villages',
      minTier: 1,
      required: 2,
      visited: 1,
      complete: false
    });
  });

  it('separates the configured opponent template from the awarded target class', () => {
    const targetClass = 'paladin';
    const bossConfig = { guildmaster_class: 'berserker' };

    assert.equal(
      resolveGuildmasterOpponentClass(targetClass, bossConfig),
      'berserker'
    );
    assert.equal(
      resolveGuildmasterOpponentClass(targetClass, null),
      targetClass
    );
  });

  it('persists the awarded target class used by completion authorization', async () => {
    const calls = [];
    let persistedTargetClass = null;
    const client = {
      async query(sql, params) {
        calls.push({ sql, params });
        if (sql.includes('UPDATE battles')) {
          persistedTargetClass = params[0];
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('SELECT cq.id AS quest_id')) {
          assert.match(sql, /b\.target_class = aqt\.target_class/);
          return persistedTargetClass === 'paladin'
            ? {
                rows: [{
                  quest_id: 5,
                  status: 'completed',
                  target_class: 'paladin',
                  prerequisite_class: 'berserker',
                  guild_id: 'warrior',
                  tier: 2,
                  gold_reward: 100,
                  xp_reward: 50,
                  title_reward: 'Knight of Light',
                  name: 'Ada',
                  class: 'paladin',
                  race: 'human',
                  level: 20,
                  user_id: 3
                }]
              }
            : { rows: [] };
        }
        return { rowCount: 1, rows: [] };
      }
    };

    await persistAdvancementBattleIdentity(
      client,
      42,
      'paladin',
      9
    );
    const completion = await completeQuestWithClient(client, 7, 42);

    assert.equal(completion.newClass, 'paladin');
    assert.equal(calls.length, 2);
    assert.match(calls[0].sql, /SET target_class = \$1/);
    assert.match(calls[0].sql, /guildmaster_template_id = \$2/);
    assert.deepEqual(calls[0].params, ['paladin', 9, 42]);
  });

  it('allocates a fresh serialized guildmaster attempt after a defeat', async () => {
    const calls = [];
    const client = {
      async query(sql, params) {
        calls.push({ sql, params });
        if (sql.includes('FROM characters')) {
          return {
            rows: [{
              id: 7,
              user_id: 3,
              class: 'sorcerer',
              current_node_id: 12,
              in_battle: false,
              node_type: 'guild',
              node_guild_id: 'wizard'
            }]
          };
        }
        if (sql.includes('FROM character_quests')) {
          return {
            rows: [{
              quest_id: 31,
              guild_id: 'wizard',
              target_class: 'summoner',
              prerequisite_class: 'sorcerer'
            }]
          };
        }
        if (sql.includes('FROM battles')) {
          assert.match(sql, /status IN \('active', 'victory'\)/);
          return {
            rows: [{
              attempt_count: 1,
              blocking_attempt_count: 0
            }]
          };
        }
        throw new Error(`Unexpected query: ${sql}`);
      }
    };

    const attempt = await reserveGuildmasterBattleAttempt(client, {
      userId: 3,
      challengerId: 7,
      advancementQuestId: 31,
      targetClass: 'summoner',
      nodeId: 12
    });

    assert.equal(attempt, 2);
    assert.match(calls[0].sql, /FOR UPDATE/);
    assert.match(calls[1].sql, /status = 'boss_ready'/);
    assert.match(calls[1].sql, /FOR UPDATE OF cq/);
    assert.deepEqual(calls[2].params, [7, 'summoner', 12]);
    assert.equal(
      buildGuildmasterCreationKey({
        userId: 3,
        challengerId: 7,
        targetClass: 'summoner',
        nodeId: 12,
        attempt
      }),
      'guildmaster:3:7:summoner:12:attempt:2'
    );
  });

  it('does not reserve another trial while a victory awaits promotion', async () => {
    const client = {
      async query(sql) {
        if (sql.includes('FROM characters')) {
          return {
            rows: [{
              id: 7,
              user_id: 3,
              class: 'sorcerer',
              current_node_id: 12,
              in_battle: false,
              node_type: 'guild',
              node_guild_id: 'wizard'
            }]
          };
        }
        if (sql.includes('FROM character_quests')) {
          return {
            rows: [{
              quest_id: 31,
              guild_id: 'wizard',
              target_class: 'summoner',
              prerequisite_class: 'sorcerer'
            }]
          };
        }
        if (sql.includes('FROM battles')) {
          return {
            rows: [{
              attempt_count: 1,
              blocking_attempt_count: 1
            }]
          };
        }
        throw new Error(`Unexpected query: ${sql}`);
      }
    };

    await assert.rejects(
      reserveGuildmasterBattleAttempt(client, {
        userId: 3,
        challengerId: 7,
        advancementQuestId: 31,
        targetClass: 'summoner',
        nodeId: 12
      }),
      error => {
        assert.equal(error.code, 'ADVANCEMENT_BATTLE_STATE_CHANGED');
        assert.match(error.message, /victory is being finalized/);
        return true;
      }
    );
  });

  it('rejects a second active guildmaster battle under the character lock', async () => {
    const client = {
      async query(sql) {
        assert.match(sql, /FOR UPDATE/);
        return { rows: [{ id: 7, in_battle: true }] };
      }
    };

    await assert.rejects(
      reserveGuildmasterBattleAttempt(client, {
        userId: 3,
        challengerId: 7,
        advancementQuestId: 31,
        targetClass: 'summoner',
        nodeId: 12
      }),
      error => {
        assert.equal(error.message, 'Character is already in battle');
        assert.equal(error.code, 'ADVANCEMENT_BATTLE_ALREADY_ACTIVE');
        return true;
      }
    );
  });

  it('rejects a boss trial when the locked quest or location changed', async () => {
    const client = {
      async query(sql) {
        if (sql.includes('FROM characters')) {
          return {
            rows: [{
              id: 7,
              user_id: 3,
              class: 'sorcerer',
              current_node_id: 13,
              in_battle: false,
              node_type: 'guild',
              node_guild_id: 'wizard'
            }]
          };
        }
        if (sql.includes('FROM character_quests')) {
          return {
            rows: [{
              quest_id: 31,
              guild_id: 'wizard',
              target_class: 'summoner',
              prerequisite_class: 'sorcerer'
            }]
          };
        }
        throw new Error(`Unexpected query: ${sql}`);
      }
    };

    await assert.rejects(
      reserveGuildmasterBattleAttempt(client, {
        userId: 3,
        challengerId: 7,
        advancementQuestId: 31,
        targetClass: 'summoner',
        nodeId: 12
      }),
      error => {
        assert.equal(error.code, 'ADVANCEMENT_BATTLE_STATE_CHANGED');
        return true;
      }
    );
  });

  it('serializes quest abandonment on the same character and quest locks', async () => {
    const calls = [];
    const client = {
      async query(sql, params) {
        calls.push({ sql, params });
        if (sql.includes('FROM characters')) {
          return { rows: [{ id: 7, in_battle: false }] };
        }
        if (sql.includes('FROM character_quests')) {
          return { rows: [{ id: 31 }] };
        }
        if (sql.includes('UPDATE character_quests')) {
          return { rows: [{ id: 31 }] };
        }
        throw new Error(`Unexpected query: ${sql}`);
      }
    };

    assert.equal(await abandonQuestWithClient(client, 7), true);
    assert.match(calls[0].sql, /FOR UPDATE/);
    assert.match(calls[1].sql, /FOR UPDATE/);
    assert.deepEqual(calls[2].params, [31]);
  });

  it('does not abandon a quest after its boss trial wins the character lock', async () => {
    const client = {
      async query(sql) {
        assert.match(sql, /FOR UPDATE/);
        return { rows: [{ id: 7, in_battle: true }] };
      }
    };

    await assert.rejects(
      abandonQuestWithClient(client, 7),
      error => {
        assert.equal(error.code, 'ADVANCEMENT_QUEST_BATTLE_ACTIVE');
        return true;
      }
    );
  });

  it('replaces the all-history unique constraint with an active-only index', async () => {
    const sql = await readFile(
      new URL('../../migrations/057_fix_advancement_quest_history.sql', import.meta.url),
      'utf8'
    );

    assert.match(
      sql,
      /DROP CONSTRAINT IF EXISTS one_active_quest_per_character/
    );
    assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS/);
    assert.match(sql, /ON character_quests\(character_id\)/);
    assert.match(sql, /WHERE status IN \('active', 'boss_ready'\)/);
    assert.doesNotMatch(sql, /WHERE status IN \([^)]*completed/);
    assert.doesNotMatch(sql, /WHERE status IN \([^)]*abandoned/);
  });

  it('restores the previous quest uniqueness rule on migration rollback', async () => {
    const sql = await readFile(
      new URL(
        '../../migrations/057_fix_advancement_quest_history.rollback.sql',
        import.meta.url
      ),
      'utf8'
    );

    const preconditionIndex = sql.indexOf('HAVING COUNT(*) > 1');
    const dropIndex = sql.indexOf('DROP INDEX IF EXISTS');
    assert.ok(preconditionIndex >= 0);
    assert.ok(dropIndex > preconditionIndex);
    assert.match(sql, /RAISE EXCEPTION/);
    assert.match(sql, /DROP INDEX IF EXISTS idx_character_quests_one_active/);
    assert.match(
      sql,
      /ADD CONSTRAINT one_active_quest_per_character UNIQUE \(character_id\)/
    );
  });
});
