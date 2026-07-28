import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(
  testDirectory,
  '../../migrations/049_worldgen_integrity.sql'
);
const rollbackPath = resolve(
  testDirectory,
  '../../migrations/049_worldgen_integrity.rollback.sql'
);

const compact = (sql) => sql.replace(/\s+/g, ' ').trim();

describe('049 worldgen integrity migration', () => {
  it('keeps ordinary connections outside the nullable route envelope', async () => {
    const sql = compact(await readFile(migrationPath, 'utf8'));

    for (const column of [
      'route_id',
      'route_pair_key',
      'region_pair',
      'route_kind',
      'segment_index',
      'segment_kind',
      'difficulty_policy'
    ]) {
      assert.match(sql, new RegExp(`ADD COLUMN IF NOT EXISTS ${column} `));
      assert.match(sql, new RegExp(`ALTER COLUMN ${column} DROP DEFAULT`));
    }

    assert.match(
      sql,
      /route_kind IS NULL AND route_id IS NULL AND route_pair_key IS NULL AND region_pair IS NULL AND segment_index IS NULL/
    );
    assert.doesNotMatch(sql, /route_kind VARCHAR\(32\) NOT NULL DEFAULT/);
    assert.doesNotMatch(sql, /region_pair JSONB NOT NULL DEFAULT/);
  });

  it('constrains routed connections to canonical pair and policy domains', async () => {
    const sql = compact(await readFile(migrationPath, 'utf8'));

    assert.match(
      sql,
      /route_kind IN \('bridge', 'trade', 'wilderness', 'palace'\)/
    );
    assert.match(
      sql,
      /route_id = route_kind \|\| ':' \|\| worldgen_region_route_suffix\(region_pair\)/
    );
    assert.match(
      sql,
      /route_pair_key = 'route-pair:' \|\| worldgen_region_route_suffix\(region_pair\)/
    );
    assert.match(
      sql,
      /OR \(route_kind = 'palace' AND route_pair_key IS NULL\)/
    );
    assert.match(sql, /segment_order = segment_index/);
    assert.match(sql, /WHEN 'bridge' THEN 'standard_bridge'/);
    assert.match(sql, /WHEN 'trade' THEN 'lower_risk_trade'/);
    assert.match(sql, /WHEN 'wilderness' THEN 'higher_risk_wilderness'/);
    assert.match(sql, /WHEN 'palace' THEN 'palace_approach'/);
    assert.match(
      sql,
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_world_node_connections_route_segment ON world_node_connections\(route_id, segment_index\) WHERE route_id IS NOT NULL/
    );
  });

  it('accepts a canonical multi-region palace while keeping other routes pair-shaped', async () => {
    const sql = compact(await readFile(migrationPath, 'utf8'));
    const palaceRegionPair = [1, 3, 4];
    const palaceRouteId = `palace:${palaceRegionPair.join('-')}`;

    assert.equal(palaceRouteId, 'palace:1-3-4');
    assert.match(
      sql,
      /CREATE OR REPLACE FUNCTION worldgen_region_ids_are_canonical\( region_ids JSONB, required_length INTEGER DEFAULT NULL \)/
    );
    assert.match(
      sql,
      /jsonb_array_length\(region_ids\) < 2/
    );
    assert.match(sql, /jsonb_typeof\(region_id_json\) <> 'number'/);
    assert.match(sql, /region_id_value > 2147483647/);
    assert.match(sql, /region_id_value <= previous_region_id/);
    assert.match(
      sql,
      /CASE WHEN route_kind = 'palace' THEN NULL ELSE 2 END/
    );
    assert.match(
      sql,
      /route_kind \|\| ':' \|\| worldgen_region_route_suffix\(region_pair\)/
    );
    assert.match(
      sql,
      /OR \(route_kind = 'palace' AND route_pair_key IS NULL\)/
    );
  });

  it('persists write-once castle generator identity with deferred coherence', async () => {
    const sql = compact(await readFile(migrationPath, 'utf8'));

    assert.match(sql, /ADD COLUMN IF NOT EXISTS castle_key VARCHAR\(200\)/);
    assert.match(sql, /ADD COLUMN IF NOT EXISTS generator_x INTEGER/);
    assert.match(sql, /ADD COLUMN IF NOT EXISTS generator_y INTEGER/);
    assert.match(
      sql,
      /castle_key IS NULL AND generator_x IS NULL AND generator_y IS NULL/
    );
    assert.match(sql, /castle_key = 'castle:' \|\| id/);
    assert.match(sql, /worldgen_region_identity_is_immutable/);
    assert.match(
      sql,
      /checked_castle\.x_coord IS DISTINCT FROM checked_region\.generator_x/
    );
    assert.match(
      sql,
      /checked_castle\.y_coord IS DISTINCT FROM checked_region\.generator_y/
    );
    assert.match(sql, /DEFERRABLE INITIALLY DEFERRED/);
  });

  it('persists node opening and route-tier round-trip metadata', async () => {
    const sql = compact(await readFile(migrationPath, 'utf8'));

    for (const column of [
      'opening_role',
      'opening_destination_node_key',
      'route_id',
      'route_pair_key',
      'region_pair',
      'route_kind',
      'route_order',
      'segment_index',
      'segment_kind',
      'difficulty_policy',
      'route_difficulty_tier'
    ]) {
      assert.match(sql, new RegExp(`ADD COLUMN IF NOT EXISTS ${column} `));
    }

    assert.match(sql, /opening_role = 'designated_safe_destination'/);
    assert.match(sql, /opening_role = 'tier_1_boundary'/);
    assert.match(
      sql,
      /FOREIGN KEY \(opening_destination_node_key\) REFERENCES world_nodes\(node_key\)/
    );
    assert.match(sql, /route_difficulty_tier BETWEEN 1 AND 5/);
  });

  it('persists explicit opening-edge roles with a constrained domain', async () => {
    const sql = compact(await readFile(migrationPath, 'utf8'));

    assert.match(sql, /ADD COLUMN IF NOT EXISTS opening_role VARCHAR\(64\)/);
    assert.match(sql, /world_node_connections_opening_role_check/);
    assert.match(sql, /'designated_safe_edge'/);
    assert.match(sql, /'tier_1_boundary_edge'/);
    assert.match(sql, /idx_world_node_connections_opening_role/);
    assert.match(
      sql,
      /ADD COLUMN IF NOT EXISTS route_difficulty_tier INTEGER/
    );
    assert.match(
      sql,
      /route_kind IN \('trade', 'wilderness'\) AND route_difficulty_tier BETWEEN 1 AND 5/
    );
  });

  it('reports the guarded legacy ruins Tier-1 backfill count', async () => {
    const sql = compact(await readFile(migrationPath, 'utf8'));

    assert.match(sql, /legacy_ruins_count INTEGER/);
    assert.match(
      sql,
      /SET ruins_reward_tier = 1 WHERE node_type::text = 'ruins'/
    );
    assert.match(
      sql,
      /RAISE NOTICE '049_worldgen_integrity: backfilled % legacy ruins row\(s\) to reward Tier 1', legacy_ruins_count/
    );
  });

  it('rolls back every trigger, function, index, constraint, and column family', async () => {
    const sql = compact(await readFile(rollbackPath, 'utf8'));

    for (const objectName of [
      'trg_world_nodes_castle_coherence',
      'trg_world_regions_castle_coherence',
      'trg_world_regions_generator_identity_immutable',
      'worldgen_check_region_castle_from_node',
      'worldgen_check_region_castle_from_region',
      'worldgen_assert_region_castle_coherence',
      'worldgen_region_identity_is_immutable',
      'worldgen_region_route_suffix',
      'worldgen_region_ids_are_canonical',
      'idx_world_node_connections_route_segment',
      'idx_world_node_connections_opening_role',
      'idx_world_regions_generator_coordinates',
      'idx_world_nodes_route_segment'
    ]) {
      assert.match(sql, new RegExp(objectName));
    }

    for (const column of [
      'castle_key',
      'generator_x',
      'generator_y',
      'opening_role',
      'opening_destination_node_key',
      'segment_index',
      'route_difficulty_tier'
    ]) {
      assert.match(sql, new RegExp(`DROP COLUMN IF EXISTS ${column}`));
    }
    assert.match(sql, /ALTER COLUMN path_type DROP NOT NULL/);
  });
});
