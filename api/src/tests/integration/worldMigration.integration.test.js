import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import dotenv from 'dotenv';

import { createSeedPool } from '../../db/seed.js';
import {
  executePlayerPreservingWorldMigration,
  planPlayerPreservingWorldMigration,
} from '../../db/worldMigration.js';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testDirectory, '../../../../');

const optedIn = process.env.RUN_WORLD_MIGRATION_INTEGRATION === 'true';
const optInSkipReason = optedIn
  ? false
  : 'set RUN_WORLD_MIGRATION_INTEGRATION=true to run';

const FORBIDDEN_DATABASE_NAMES = new Set([
  'modia',
  'postgres',
  'template0',
  'template1',
]);
const RUINS_PUZZLE_MARKER = 'glyphs';

function isUnmistakablyDisposable(databaseName) {
  return /(?:^|[_-])(?:test|testing|ci|disposable|ephemeral)(?:[_-]|$)/i
    .test(databaseName);
}

function assertDisposableDatabase(databaseName) {
  const normalized = String(databaseName ?? '').trim().toLowerCase();
  assert.ok(normalized, 'database name must be explicit');
  assert.equal(
    FORBIDDEN_DATABASE_NAMES.has(normalized),
    false,
    `refusing forbidden PostgreSQL target "${databaseName}"`
  );
  assert.equal(
    isUnmistakablyDisposable(normalized),
    true,
    `refusing non-disposable PostgreSQL target "${databaseName}"`
  );
}

function changedPlanHash(planHash) {
  const replacement = planHash[0] === '0' ? '1' : '0';
  return `${replacement}${planHash.slice(1)}`;
}

async function captureWorldIdentity(client) {
  const result = await client.query(`
    SELECT id, node_key, node_type::text AS node_type,
           x_coord, y_coord, region_id
    FROM world_nodes
    ORDER BY id
  `);
  return result.rows;
}

async function captureFixture(client, fixture) {
  // A pg Client supports one in-flight query at a time. Keep this capture
  // serialized so the disposable integration test exercises the same protocol
  // ordering as the migration transaction.
  const character = await client.query(
    `SELECT to_jsonb(characters) - 'current_node_id' AS value,
            current_node_id
     FROM characters
     WHERE id = $1`,
    [fixture.characterId]
  );
  const inventory = await client.query(
    `SELECT to_jsonb(character_items) AS value
     FROM character_items
     WHERE id = $1`,
    [fixture.inventoryId]
  );
  const skills = await client.query(
    `SELECT to_jsonb(character_skills) AS value
     FROM character_skills
     WHERE character_id = $1
     ORDER BY id`,
    [fixture.characterId]
  );
  const traits = await client.query(
    `SELECT to_jsonb(character_traits) AS value
     FROM character_traits
     WHERE character_id = $1
     ORDER BY id`,
    [fixture.characterId]
  );
  const quest = await client.query(
    `SELECT to_jsonb(character_quests) - 'node_progress' AS value,
            node_progress
     FROM character_quests
     WHERE id = $1`,
    [fixture.questId]
  );
  const discoveries = await client.query(
    `SELECT node_id, discovery_method,
            to_char(
              discovered_at,
              'YYYY-MM-DD"T"HH24:MI:SS.US'
            ) AS discovered_at
     FROM user_node_discovery
     WHERE user_id = $1
     ORDER BY node_id`,
    [fixture.userId]
  );
  const clearances = await client.query(
    `SELECT node_id,
            to_char(
              cleared_at,
              'YYYY-MM-DD"T"HH24:MI:SS.US'
            ) AS cleared_at,
            battle_id
     FROM user_node_clearance
     WHERE user_id = $1
     ORDER BY node_id`,
    [fixture.userId]
  );
  const battle = await client.query(
    `SELECT to_jsonb(battles) - 'node_id' AS value, node_id
     FROM battles
     WHERE id = $1`,
    [fixture.battleId]
  );
  const ruinsCompletions = await client.query(
    `SELECT node_id, puzzle_solved, reward_claimed, completed_at
     FROM user_ruins_completions
     WHERE user_id = $1
     ORDER BY node_id`,
    [fixture.userId]
  );

  return {
    character: character.rows[0],
    inventory: inventory.rows,
    skills: skills.rows,
    traits: traits.rows,
    quest: quest.rows[0],
    discoveries: discoveries.rows,
    clearances: clearances.rows,
    battle: battle.rows[0],
    ruinsCompletions: ruinsCompletions.rows,
  };
}

async function modelLegacyV2SourceState(client) {
  const regionRacesBefore = await client.query(
    `SELECT id, race::text AS race
     FROM world_regions
     ORDER BY id`
  );
  assert.ok(
    regionRacesBefore.rows.length > 0,
    'seed the disposable database before modeling legacy-v2 state'
  );

  const identityTrigger = await client.query(
    `SELECT trigger_row.tgenabled
     FROM pg_trigger AS trigger_row
     WHERE trigger_row.tgrelid = 'public.world_regions'::regclass
       AND trigger_row.tgname =
         'trg_world_regions_generator_identity_immutable'
       AND NOT trigger_row.tgisinternal`
  );
  assert.deepEqual(
    identityTrigger.rows,
    [{ tgenabled: 'O' }],
    'region generator identity trigger must start enabled'
  );

  // Test-only historical-state construction: migration 049 gives normal v3
  // seeds immutable generator identities, and those updates remain correctly
  // forbidden. The live legacy-v2 source instead has these fields unset.
  await client.query('SAVEPOINT model_legacy_v2_region_identity');
  try {
    await client.query(
      `ALTER TABLE world_regions
       DISABLE TRIGGER trg_world_regions_generator_identity_immutable`
    );
    await client.query(
      `UPDATE world_regions
       SET castle_key = NULL,
           generator_x = NULL,
           generator_y = NULL`
    );
    await client.query(
      'SET CONSTRAINTS trg_world_regions_castle_coherence IMMEDIATE'
    );
    await client.query(
      `ALTER TABLE world_regions
       ENABLE TRIGGER trg_world_regions_generator_identity_immutable`
    );
    await client.query('RELEASE SAVEPOINT model_legacy_v2_region_identity');
  } catch (error) {
    // Trigger state is transactional. Rolling back this savepoint restores the
    // original enabled state even if clearing the historical fields fails.
    await client.query('ROLLBACK TO SAVEPOINT model_legacy_v2_region_identity');
    await client.query('RELEASE SAVEPOINT model_legacy_v2_region_identity');
    throw error;
  }

  const restoredIdentityTrigger = await client.query(
    `SELECT trigger_row.tgenabled
     FROM pg_trigger AS trigger_row
     WHERE trigger_row.tgrelid = 'public.world_regions'::regclass
       AND trigger_row.tgname =
         'trg_world_regions_generator_identity_immutable'
       AND NOT trigger_row.tgisinternal`
  );
  assert.deepEqual(
    restoredIdentityTrigger.rows,
    [{ tgenabled: 'O' }],
    'region generator identity trigger was not restored before planning'
  );

  await client.query(
    'UPDATE seed_metadata SET seed_version = 2 WHERE id = 1'
  );

  const legacyRegions = await client.query(
    `SELECT id, race::text AS race, castle_key, generator_x, generator_y
     FROM world_regions
     ORDER BY id`
  );
  assert.deepEqual(
    legacyRegions.rows.map(({ id, race }) => ({ id, race })),
    regionRacesBefore.rows,
    'modeling legacy-v2 generator identity changed a region race'
  );
  for (const region of legacyRegions.rows) {
    assert.equal(region.castle_key, null);
    assert.equal(region.generator_x, null);
    assert.equal(region.generator_y, null);
  }

  const metadata = await client.query(
    'SELECT seed_version FROM seed_metadata WHERE id = 1'
  );
  assert.equal(metadata.rows.length, 1);
  assert.equal(
    Number(metadata.rows[0].seed_version),
    2,
    'disposable source metadata does not model seed version 2'
  );
}

async function createRepresentativeFixture(client) {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const prerequisite = await client.query(`
    SELECT combat.id AS combat_node_id,
           combat.node_type::text AS combat_node_type,
           region.id AS home_region_id,
           region.race AS home_region_race,
           ruins.id AS ruins_node_id,
           item.id AS item_template_id,
           trait.id AS trait_id,
           quest.id AS quest_template_id
    FROM LATERAL (
      SELECT id, node_type, region_id
      FROM world_nodes
      WHERE node_type::text = 'forest'
      ORDER BY id
      LIMIT 1
    ) AS combat
    JOIN world_regions AS region ON region.id = combat.region_id
    CROSS JOIN LATERAL (
      SELECT id
      FROM world_nodes
      WHERE node_type::text = 'ruins'
      ORDER BY id
      LIMIT 1
    ) AS ruins
    CROSS JOIN LATERAL (
      SELECT id FROM item_templates ORDER BY id LIMIT 1
    ) AS item
    CROSS JOIN LATERAL (
      SELECT id FROM traits ORDER BY id LIMIT 1
    ) AS trait
    CROSS JOIN LATERAL (
      SELECT id FROM advancement_quest_templates ORDER BY id LIMIT 1
    ) AS quest
  `);
  assert.equal(
    prerequisite.rows.length,
    1,
    'seed a world, item templates, traits, and advancement quests first'
  );
  const source = prerequisite.rows[0];

  await client.query('BEGIN');
  try {
    await modelLegacyV2SourceState(client);

    const user = await client.query(
      `INSERT INTO users (username, email, password_hash, gold)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [
        `wmig_${suffix}`,
        `wmig_${suffix}@example.invalid`,
        'world-migration-integration-only',
        9876,
      ]
    );
    const userId = user.rows[0].id;

    await client.query(
      `UPDATE world_nodes
       SET ruins_reward_tier = 1,
           ruins_puzzle_type = $2
       WHERE id = $1`,
      [source.ruins_node_id, RUINS_PUZZLE_MARKER]
    );

    // The user trigger adds initial fog state. Replace it with a precise
    // fixture so discovery merge/remapping assertions are deterministic.
    await client.query(
      'DELETE FROM user_node_discovery WHERE user_id = $1',
      [userId]
    );

    const character = await client.query(
      `INSERT INTO characters (
         user_id, name, race, class, gender, level, experience,
         hp_current, hp_max, mp_current, mp_max,
         strength, intelligence, agility, vitality, luck,
         current_node_id, in_battle, party_slot,
         stamina, max_stamina, spent_xp, home_region_id
       )
       VALUES (
         $1, $2, $3::race_type, 'warrior', 'other', 17, 43210,
         143, 160, 51, 70,
         29, 12, 18, 26, 15,
         $4, TRUE, 1,
         6, 11, 7654, $5
       )
       RETURNING id`,
      [
        userId,
        `Migrator_${suffix.slice(0, 8)}`,
        source.home_region_race,
        source.combat_node_id,
        source.home_region_id,
      ]
    );
    const characterId = character.rows[0].id;

    const inventory = await client.query(
      `INSERT INTO character_items (
         character_id, user_id, item_template_id, quantity,
         is_equipped, equipped_slot, modifications, listed
       )
       VALUES (
         NULL, $1, $2, 7, FALSE, NULL,
         '{"integration_marker":"preserve-me","upgrade":3}'::jsonb, FALSE
       )
       RETURNING id`,
      [userId, source.item_template_id]
    );

    await client.query(
      `INSERT INTO character_skills (character_id, skill_id, level)
       VALUES ($1, $2, 37)`,
      [characterId, `integration_skill_${suffix}`]
    );
    await client.query(
      `INSERT INTO character_traits (character_id, trait_id)
       VALUES ($1, $2)`,
      [characterId, source.trait_id]
    );

    const quest = await client.query(
      `INSERT INTO character_quests (
         character_id, quest_template_id, status,
         material_progress, enemy_progress, node_progress
       )
       VALUES (
         $1, $2, 'active',
         '{"iron_shard":4,"moon_herb":2}'::jsonb,
         '{"dire_wolf":9}'::jsonb,
         jsonb_build_object('forest', jsonb_build_array($3::integer))
       )
       RETURNING id`,
      [characterId, source.quest_template_id, source.combat_node_id]
    );

    const battle = await client.query(
      `INSERT INTO battles (
         battle_type, status, node_id, battle_state, map_seed,
         map_width, map_height, player1_id, challenger_character_id
       )
       VALUES (
         'pve', 'active', $1,
         '{"round":3,"turn":"player","integration_marker":"preserve-me"}'::jsonb,
         424242, 9, 7, $2, $3
       )
       RETURNING id`,
      [source.combat_node_id, userId, characterId]
    );

    await client.query(
      `INSERT INTO user_node_discovery (
         user_id, node_id, discovery_method, discovered_at
       )
       VALUES ($1, $2, 'travel', '2026-01-02T03:04:05.123456')`,
      [userId, source.combat_node_id]
    );
    await client.query(
      `INSERT INTO user_node_clearance (
         user_id, node_id, cleared_at, battle_id
       )
       VALUES ($1, $2, '2026-01-03T04:05:06.654321', $3)`,
      [userId, source.combat_node_id, battle.rows[0].id]
    );
    await client.query(
      `INSERT INTO user_ruins_completions (
         user_id, node_id, puzzle_solved, reward_claimed, completed_at
       )
       VALUES ($1, $2, TRUE, TRUE, '2026-01-04T05:06:07Z')`,
      [userId, source.ruins_node_id]
    );

    await client.query('COMMIT');
    return {
      userId,
      characterId,
      inventoryId: inventory.rows[0].id,
      questId: quest.rows[0].id,
      battleId: battle.rows[0].id,
      sourceNodeId: Number(source.combat_node_id),
      sourceNodeType: source.combat_node_type,
      sourceRuinsNodeId: Number(source.ruins_node_id),
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

it('atomically regenerates a disposable world while preserving player state', {
  skip: optInSkipReason,
  timeout: 300_000,
}, async () => {
  dotenv.config({ path: resolve(projectRoot, '.env') });
  assertDisposableDatabase(process.env.DB_NAME);

  const pool = createSeedPool(process.env);
  const client = await pool.connect();

  try {
    const database = await client.query(
      'SELECT current_database() AS database_name'
    );
    assertDisposableDatabase(database.rows[0].database_name);

    const schema = await client.query(`
      SELECT
        to_regclass('public.world_migration_runs') IS NOT NULL
          AS audit_migration_applied,
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'world_nodes'
            AND column_name = 'node_key'
        ) AS worldgen_integrity_applied,
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'seed_metadata'
            AND column_name = 'migration_overlay'
        ) AS overlay_migration_applied,
        (SELECT COUNT(*)::int FROM world_nodes) AS node_count,
        (SELECT COUNT(*)::int FROM seed_metadata) AS metadata_count
    `);
    assert.equal(
      schema.rows[0].audit_migration_applied,
      true,
      'apply database migrations through 051 before running this test'
    );
    assert.equal(
      schema.rows[0].worldgen_integrity_applied,
      true,
      'apply database migrations through 051 before running this test'
    );
    assert.equal(
      schema.rows[0].overlay_migration_applied,
      true,
      'apply database migrations through 051 before running this test'
    );
    assert.ok(
      Number(schema.rows[0].node_count) > 0,
      'seed the disposable database before running this test'
    );
    assert.equal(
      Number(schema.rows[0].metadata_count),
      1,
      'seed the disposable database before running this test'
    );

    const fixture = await createRepresentativeFixture(client);
    const beforeFixture = await captureFixture(client, fixture);
    const beforeWorld = await captureWorldIdentity(client);
    const auditBefore = await client.query(
      'SELECT COUNT(*)::int AS count FROM world_migration_runs'
    );

    assert.equal(beforeFixture.discoveries.length, 1);
    assert.equal(beforeFixture.clearances.length, 1);
    assert.deepEqual(
      beforeFixture.ruinsCompletions.map((row) => ({
        nodeId: Number(row.node_id),
        puzzleSolved: row.puzzle_solved,
        rewardClaimed: row.reward_claimed,
      })),
      [{
        nodeId: fixture.sourceRuinsNodeId,
        puzzleSolved: true,
        rewardClaimed: true,
      }]
    );
    assert.deepEqual(
      beforeFixture.quest.node_progress,
      { forest: [fixture.sourceNodeId] }
    );

    const targetSeed = 24681357;
    const plan = await planPlayerPreservingWorldMigration({
      client,
      worldSeed: targetSeed,
    });
    assert.match(plan.planHash, /^[0-9a-f]{64}$/);
    assert.equal(plan.sourceSeedVersion, 2);
    assert.ok(plan.semanticOverlay, 'ruins completion did not create an overlay');
    const overlayAssignment = plan.semanticOverlay.assignments.find(
      (assignment) =>
        assignment.sourceLegacyNodeId === fixture.sourceRuinsNodeId
    );
    assert.ok(overlayAssignment, 'ruins completion has no overlay assignment');
    assert.deepEqual(overlayAssignment.after, {
      ruinsTier: 1,
      ruinsPuzzleType: RUINS_PUZZLE_MARKER,
    });
    assert.equal(overlayAssignment.changed, true);
    assert.equal(overlayAssignment.affectedCompletionCount, 1);
    assert.equal(overlayAssignment.affectedUserCount, 1);

    const plannedRuinsCarrier = plan.targetWorld.nodes.find(
      (node) => node.nodeKey === overlayAssignment.targetNodeKey
    );
    assert.ok(plannedRuinsCarrier, 'overlay carrier is absent from target world');
    assert.equal(plannedRuinsCarrier.nodeType, 'ruins');
    assert.equal(plannedRuinsCarrier.ruinsTier, 1);
    assert.equal(
      plannedRuinsCarrier.ruinsPuzzleType,
      RUINS_PUZZLE_MARKER
    );
    const plannedRuinsMapping = plan.mapping.mappings.find(
      (mapping) => mapping.legacyNodeId === fixture.sourceRuinsNodeId
    );
    assert.ok(plannedRuinsMapping, 'ruins completion has no planned remap');
    assert.equal(
      plannedRuinsMapping.targetNodeKey,
      overlayAssignment.targetNodeKey
    );
    assert.equal(plannedRuinsMapping.eligibilityConstraintApplied, true);
    assert.deepEqual(
      plannedRuinsMapping.requiredTargetNodeKeys,
      [overlayAssignment.targetNodeKey]
    );

    await assert.rejects(
      executePlayerPreservingWorldMigration({
        pool,
        worldSeed: targetSeed,
        expectedPlanHash: changedPlanHash(plan.planHash),
        initiatedBy: 'world-migration-integration-mismatch',
      }),
      /Confirmed migration plan changed/
    );
    assert.deepEqual(
      await captureWorldIdentity(client),
      beforeWorld,
      'plan-hash mismatch changed the source world'
    );
    assert.deepEqual(
      await captureFixture(client, fixture),
      beforeFixture,
      'plan-hash mismatch changed player state'
    );
    const auditAfterMismatch = await client.query(
      'SELECT COUNT(*)::int AS count FROM world_migration_runs'
    );
    assert.equal(
      auditAfterMismatch.rows[0].count,
      auditBefore.rows[0].count,
      'plan-hash mismatch committed an audit row'
    );

    const result = await executePlayerPreservingWorldMigration({
      pool,
      worldSeed: targetSeed,
      expectedPlanHash: plan.planHash,
      initiatedBy: 'world-migration-integration',
    });
    assert.deepEqual(
      result.preservationReport.semanticOverlay,
      plan.semanticOverlay
    );
    assert.equal(
      result.verificationReport.semanticOverlayHash,
      plan.semanticOverlay.overlayHash
    );
    const afterFixture = await captureFixture(client, fixture);

    assert.deepEqual(afterFixture.character.value, beforeFixture.character.value);
    assert.deepEqual(afterFixture.inventory, beforeFixture.inventory);
    assert.deepEqual(afterFixture.skills, beforeFixture.skills);
    assert.deepEqual(afterFixture.traits, beforeFixture.traits);
    assert.deepEqual(afterFixture.quest.value, beforeFixture.quest.value);
    assert.deepEqual(afterFixture.battle.value, beforeFixture.battle.value);

    const mapping = await client.query(
      `SELECT new_node_id, new_node_key
       FROM world_migration_node_maps
       WHERE migration_id = $1 AND old_node_id = $2`,
      [result.migrationId, fixture.sourceNodeId]
    );
    assert.equal(mapping.rows.length, 1);
    const targetNodeId = Number(mapping.rows[0].new_node_id);
    const ruinsMapping = await client.query(
      `SELECT new_node_id, new_node_key
       FROM world_migration_node_maps
       WHERE migration_id = $1 AND old_node_id = $2`,
      [result.migrationId, fixture.sourceRuinsNodeId]
    );
    assert.equal(ruinsMapping.rows.length, 1);
    const targetRuinsNodeId = Number(ruinsMapping.rows[0].new_node_id);
    assert.equal(
      ruinsMapping.rows[0].new_node_key,
      overlayAssignment.targetNodeKey
    );

    assert.equal(afterFixture.character.current_node_id, targetNodeId);
    assert.equal(afterFixture.battle.node_id, targetNodeId);
    assert.deepEqual(
      afterFixture.quest.node_progress,
      { forest: [targetNodeId] }
    );
    assert.deepEqual(
      afterFixture.discoveries.map((row) => ({
        ...row,
        node_id: Number(row.node_id),
      })),
      beforeFixture.discoveries.map((row) => ({
        ...row,
        node_id: targetNodeId,
      }))
    );
    assert.deepEqual(
      afterFixture.clearances.map((row) => ({
        ...row,
        node_id: Number(row.node_id),
      })),
      beforeFixture.clearances.map((row) => ({
        ...row,
        node_id: targetNodeId,
      }))
    );
    assert.deepEqual(
      afterFixture.ruinsCompletions.map((row) => ({
        ...row,
        node_id: Number(row.node_id),
      })),
      beforeFixture.ruinsCompletions.map((row) => ({
        ...row,
        node_id: targetRuinsNodeId,
      }))
    );

    const nodeReferences = await client.query(
      `SELECT id, node_key, node_type::text AS node_type
       FROM world_nodes
       WHERE id = ANY($1::int[])
       ORDER BY id`,
      [[targetNodeId, fixture.sourceNodeId]]
    );
    assert.deepEqual(
      nodeReferences.rows,
      [{
        id: targetNodeId,
        node_key: mapping.rows[0].new_node_key,
        node_type: fixture.sourceNodeType,
      }],
      'fixture node references did not move exclusively to the target graph'
    );

    const persistedRuinsCarrier = await client.query(
      `SELECT node_key, node_type::text AS node_type,
              ruins_reward_tier, ruins_puzzle_type
       FROM world_nodes
       WHERE id = $1`,
      [targetRuinsNodeId]
    );
    assert.deepEqual(persistedRuinsCarrier.rows, [{
      node_key: overlayAssignment.targetNodeKey,
      node_type: 'ruins',
      ruins_reward_tier: 1,
      ruins_puzzle_type: RUINS_PUZZLE_MARKER,
    }]);

    const persistedMetadata = await client.query(
      'SELECT migration_overlay FROM seed_metadata WHERE id = 1'
    );
    assert.equal(persistedMetadata.rows.length, 1);
    assert.deepEqual(
      persistedMetadata.rows[0].migration_overlay,
      plan.semanticOverlay
    );

    const audit = await client.query(
      `SELECT status, plan_hash, initiated_by,
              preservation_report, verification_report
       FROM world_migration_runs
       WHERE id = $1`,
      [result.migrationId]
    );
    assert.equal(audit.rows.length, 1);
    assert.equal(audit.rows[0].status, 'committed');
    assert.equal(audit.rows[0].plan_hash, plan.planHash);
    assert.equal(audit.rows[0].initiated_by, 'world-migration-integration');
    assert.equal(
      audit.rows[0].verification_report.noLegacyReferences,
      true
    );
    assert.deepEqual(
      audit.rows[0].preservation_report.semanticOverlay,
      plan.semanticOverlay
    );
    assert.equal(
      audit.rows[0].verification_report.semanticOverlayHash,
      plan.semanticOverlay.overlayHash
    );

    const ruinsArchive = await client.query(
      `SELECT disposition, source_row
       FROM world_migration_progress_archive
       WHERE migration_id = $1
         AND source_table = 'user_ruins_completions'
         AND (source_row ->> 'user_id')::integer = $2
         AND (source_row ->> 'node_id')::integer = $3`,
      [result.migrationId, fixture.userId, fixture.sourceRuinsNodeId]
    );
    assert.equal(ruinsArchive.rows.length, 1);
    assert.equal(ruinsArchive.rows[0].disposition, 'mapped');
    assert.equal(
      Number(ruinsArchive.rows[0].source_row.user_id),
      Number(fixture.userId)
    );
    assert.equal(
      Number(ruinsArchive.rows[0].source_row.node_id),
      fixture.sourceRuinsNodeId
    );
    assert.equal(ruinsArchive.rows[0].source_row.puzzle_solved, true);
    assert.equal(ruinsArchive.rows[0].source_row.reward_claimed, true);

    const auditCounts = await client.query(
      `SELECT
         (SELECT COUNT(*)::int
          FROM world_migration_node_maps
          WHERE migration_id = $1) AS node_map_count,
         (SELECT COUNT(*)::int
          FROM world_migration_progress_archive
          WHERE migration_id = $1) AS archive_count,
         (SELECT array_agg(DISTINCT source_table ORDER BY source_table)
          FROM world_migration_progress_archive
          WHERE migration_id = $1) AS archived_tables`,
      [result.migrationId]
    );
    assert.equal(
      auditCounts.rows[0].node_map_count,
      beforeWorld.length,
      'audit did not record every source-node mapping'
    );
    assert.ok(auditCounts.rows[0].archive_count > beforeWorld.length);
    for (const expectedTable of [
      'battles',
      'character_quests',
      'characters',
      'user_node_clearance',
      'user_node_discovery',
      'world_nodes',
    ]) {
      assert.ok(
        auditCounts.rows[0].archived_tables.includes(expectedTable),
        `audit archive omitted ${expectedTable}`
      );
    }
  } finally {
    client.release();
    await pool.end();
  }
});
