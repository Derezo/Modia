import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(
  testDirectory,
  '../../migrations/061_battle_map_v3_provenance.sql'
);
const rollbackPath = resolve(
  testDirectory,
  '../../migrations/061_battle_map_v3_provenance.rollback.sql'
);
const compact = sql => sql.replace(/\s+/g, ' ').trim();

describe('061 BattleMap V3 provenance migration', () => {
  it('adds V3 version support and durable immutable selection provenance', async () => {
    const sql = compact(await readFile(migrationPath, 'utf8'));

    for (const column of [
      'battle_map_content_id VARCHAR(128)',
      'battle_map_content_version INTEGER',
      'battle_map_catalog_release_id VARCHAR(128)',
      'battle_map_theme VARCHAR(64)',
      'battle_map_tier SMALLINT',
      'battle_map_selection_band VARCHAR(64)',
      'battle_map_selection_provenance JSONB'
    ]) {
      assert.ok(
        sql.includes(`ADD COLUMN IF NOT EXISTS ${column}`),
        `migration must add ${column}`
      );
    }

    assert.match(
      sql,
      /battle_map_schema_version = 3 AND terrain_generation_version = 3/
    );
    assert.match(
      sql,
      /battle_map_schema_version IN \(2, 3\) AND battle_map_full_hash ~ '\^sha256:\[0-9a-f\]\{64\}\$'/
    );
    assert.match(sql, /battle_map_content_version >= 1/);
    assert.match(sql, /jsonb_typeof\(battle_map_selection_provenance\) = 'object'/);
  });

  it('keeps legacy provenance empty and permits a nullable named-band tier', async () => {
    const sql = compact(await readFile(migrationPath, 'utf8'));

    assert.match(
      sql,
      /battle_map_schema_version IN \(1, 2\) AND battle_map_content_id IS NULL/
    );
    assert.match(
      sql,
      /battle_map_tier IS NULL OR battle_map_tier BETWEEN 1 AND 5/
    );
    assert.match(sql, /battle_map_selection_band IS NOT NULL/);
  });

  it('indexes release and content identity without making activation mutable', async () => {
    const sql = compact(await readFile(migrationPath, 'utf8'));

    assert.match(
      sql,
      /CREATE INDEX IF NOT EXISTS idx_battles_battle_map_catalog_release ON battles\(battle_map_catalog_release_id\)/
    );
    assert.match(
      sql,
      /CREATE INDEX IF NOT EXISTS idx_battles_battle_map_content ON battles\(battle_map_content_id, battle_map_content_version\)/
    );
    assert.doesNotMatch(sql, /enabled|feature_flag|rollout|kill_switch/i);
  });

  it('refuses rollback while V3 battles exist and restores the V1/V2 contract', async () => {
    const sql = compact(await readFile(rollbackPath, 'utf8'));

    assert.match(sql, /WHERE battle_map_schema_version = 3/);
    assert.match(sql, /IF EXISTS .* RAISE EXCEPTION/);
    assert.ok(
      sql.indexOf('RAISE EXCEPTION')
        < sql.indexOf('DROP COLUMN IF EXISTS battle_map_selection_provenance'),
      'rollback must reject V3 rows before dropping provenance'
    );
    assert.doesNotMatch(
      sql,
      /battle_map_schema_version = 3 AND terrain_generation_version = 3/
    );
    assert.match(sql, /DROP COLUMN IF EXISTS battle_map_content_id/);
  });
});
